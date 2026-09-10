import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://sal.sa/trackshipment';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digits=v=>String(v||'').replace(/\D/g,'');
const first=(text,rx)=>clean((String(text||'').match(rx)||[])[1]||'');

function mapStatus(raw=''){
  const s=String(raw||'').toUpperCase();
  if(/DLV|DELIVER|ARRIVED|RECEIVED FROM FLIGHT|ARRIVAL/.test(s))return'ARRIVED';
  if(/DEPARTED|DEP\b|IN TRANSIT|MANIFEST|AIRBORNE|FLIGHT/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|EXCEPTION/.test(s))return'DELAYED';
  if(/BOOKED|BKD|RCS|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'TRACKING';
}

function parseSal(text='',mawb=''){
  const t=clean(text);if(!t)return null;
  const full=digits(mawb),serial=full.slice(3),flat=digits(t);
  if(full&&!flat.includes(full)&&serial&&!flat.includes(serial))return null;

  const destination=first(t,/(?:\bDESTINATION\b|\bDestination\b)\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const origin=first(t,/(?:\bORIGIN\b|\bOrigin\b)\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const statusRaw=first(t,/\bStatus\b\s*[:\-]?\s*([^]*?)(?=\bDate\b|\bTotal\s+Pieces\b|\bTotal\s+Weight\b|\bTotal\s+Volume\b|\bMore\s+Shipment\s+Details\b)/i);
  const pieces=first(t,/(?:\bTotal\s+Pieces\b|\bNo\.\s*of\s*Pieces\b|\bPieces\b)\s*[:\-]?\s*(\d{1,6})\b/i);
  const weight=first(t,/(?:\bTotal\s+Weight\b|\bWeight\b)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS?)?/i).replace(/,/g,'');
  const volume=first(t,/(?:\bTotal\s+Volume\b|\bVolume\b)\s*[:\-]?\s*([\d,.]+)\s*(?:M3|M³|CBM)?/i).replace(/,/g,'');
  const flightNo=first(t,/\bFlight\s+Number\b\s*[:\-]?\s*([A-Z]{2}\s*\d{1,4})\b/i).replace(/\s+/g,'').toUpperCase();
  const flightDate=first(t,/\bFlight\s+Date\b\s*[:\-]?\s*([^]*?)(?=\bArrival\s+Date\b|\bArrival\s+Time\b|\bNo\.\s*of\s*Pieces\b|\bWeight\b|\bPrint\b)/i);
  const arrivalDate=first(t,/\bArrival\s+Date\b\s*[:\-]?\s*([^]*?)(?=\bArrival\s+Time\b|\bNo\.\s*of\s*Pieces\b|\bWeight\b|\bPrint\b)/i);
  const arrivalTime=first(t,/\bArrival\s+Time\b\s*[:\-]?\s*(\d{1,2}:\d{2})\b/i);
  const segmentNo=first(t,/\bSegment\s+Number\b\s*[:\-]?\s*(\d+)\b/i);
  const airport=first(t,/\bAirport\b\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();

  const useful=Boolean(destination||origin||pieces||weight||flightNo||flightDate||arrivalDate||arrivalTime||statusRaw);
  if(!useful)return null;
  return {
    mawb,
    carrierCode:'SV',
    airlineName:'Saudia Cargo',
    officialTracker:URL,
    origin,
    destination,
    bags:pieces,
    pieces,
    weight,
    volume,
    flightNo,
    flightDate,
    arrivalDate,
    arrivalTime,
    arrivalIsActual:Boolean(arrivalDate&&arrivalTime&&/ARRIVED|DELIVERED|RECEIVED FROM FLIGHT/i.test(statusRaw)),
    segmentNo,
    airport,
    sourceStatus:statusRaw,
    status:mapStatus(statusRaw),
    source:'SAL public shipment tracking'
  };
}

async function bodyText(page){return page.evaluate(()=>document.body?.innerText||'').catch(()=> '');}

async function markAwbInput(page){
  return page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>40&&r.height>18&&!e.disabled&&!e.readOnly};
    const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button','password','email'].includes(String(e.type||'text').toLowerCase()));
    const found=inputs.find(e=>/awb|air\s*waybill|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('form,section,div')?.innerText||''}`))||inputs[0];
    if(!found)return false;found.dataset.mayaviSalAwb='1';found.scrollIntoView({block:'center'});return true;
  }).catch(()=>false);
}

async function fillAwb(page,mawb){
  await page.click('[data-mayavi-sal-awb="1"]',{clickCount:3}).catch(()=>{});
  await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
  await page.type('[data-mayavi-sal-awb="1"]',digits(mawb),{delay:30});
  await page.evaluate(()=>{const e=document.querySelector('[data-mayavi-sal-awb="1"]');if(!e)return;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();}).catch(()=>{});
}

async function clickTrack(page,timeout=12000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    const hit=await page.evaluate(()=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled};
      const txt=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
      const all=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')].filter(visible);
      for(const label of ['Track Shipment','Track a Shipment','Track','Search','Submit']){
        const x=all.find(e=>txt(e).toLowerCase()===label.toLowerCase());
        if(x){x.dataset.mayaviSalTrack='1';x.scrollIntoView({block:'center'});return txt(x);}
      }
      return'';
    }).catch(()=> '');
    if(hit){try{await page.click('[data-mayavi-sal-track="1"]')}catch{await page.evaluate(()=>document.querySelector('[data-mayavi-sal-track="1"]')?.click()).catch(()=>{})}return hit;}
    await sleep(300);
  }
  return'';
}

export async function trackSaudiaViaSal(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;const network=[],debug={stage:'OPEN',network:[]};
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({
      args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],
      defaultViewport:{width:1440,height:1100},
      executablePath:await chromium.executablePath(),
      headless:'shell'
    });
    const page=await browser.newPage();
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async r=>{try{
      const u=r.url(),ct=String(r.headers()['content-type']||'');
      if(!/sal\.sa|portalapisprd\.sal\.sa/i.test(u)||!/json|text|javascript/i.test(ct))return;
      const body=await r.text();if(body&&body.length<500000){network.push(body);if(/track|shipment|awb|flight|status/i.test(`${u} ${body}`))debug.network.push({url:u,status:r.status(),sample:clean(body).slice(0,320)});}
    }catch{}});

    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1800);
    let combined=`${await bodyText(page)}\n${network.join('\n')}`;
    let shipment=parseSal(combined,mawb);
    if(shipment)return{ok:true,shipment,officialTracker:URL,debug:{...debug,stage:'SAL_RESULT_ALREADY_PRESENT'}};

    if(!await markAwbInput(page))return{ok:false,reason:'SAL AWB INPUT NOT FOUND',officialTracker:URL,debug:{...debug,stage:'INPUT_NOT_FOUND',sample:clean(await bodyText(page)).slice(0,1500)}};
    await fillAwb(page,mawb);
    const action=await clickTrack(page);debug.action=action;
    if(!action)return{ok:false,reason:'SAL TRACK BUTTON NOT FOUND',officialTracker:URL,debug:{...debug,stage:'TRACK_BUTTON_NOT_FOUND'}};

    const end=Date.now()+30000;
    while(Date.now()<end){
      combined=`${await bodyText(page)}\n${network.join('\n')}`;
      shipment=parseSal(combined,mawb);
      if(shipment)return{ok:true,shipment,officialTracker:URL,debug:{...debug,stage:'SAL_RESULT_SUCCESS'}};
      if(/no shipment|not found|invalid awb|no result/i.test(combined))return{ok:false,reason:'SAL RETURNED NO SHIPMENT RESULT',officialTracker:URL,debug:{...debug,stage:'NO_RESULT',sample:clean(combined).slice(0,1800)}};
      await sleep(500);
    }
    return{ok:false,reason:'SAL RESULT NOT READABLE',officialTracker:URL,debug:{...debug,stage:'RESULT_TIMEOUT',sample:clean(combined).slice(0,2200)}};
  }catch(e){return{ok:false,reason:`SAL TRACKING ERROR: ${e?.message||e}`,officialTracker:URL,debug:{...debug,stage:'ERROR'}}}
  finally{try{if(browser)await browser.close()}catch{}}
}
