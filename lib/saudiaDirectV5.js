import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://saudiacargo.com/en/digital-services?tab=trackShipment';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digits=v=>String(v||'').replace(/\D/g,'');

function first(text,rx){return clean((String(text||'').match(rx)||[])[1]||'');}
function mapStatus(raw=''){
  const s=String(raw||'').trim().toUpperCase();
  if(s==='DLV'||s==='ARR')return 'ARRIVED';
  if(s==='XXX'||s==='DEP'||s==='RCF'||s==='MAN')return 'IN TRANSIT';
  if(s==='BKD'||s==='RCS')return 'BOOKED';
  if(s==='DLY')return 'DELAYED';
  return s||'TRACKING';
}

function parseResultCard(text='',mawb=''){
  const t=clean(text);
  if(!t)return null;
  const wanted=digits(mawb);
  if(wanted&&!digits(t).includes(wanted))return null;

  const destination=first(t,/\bDestination\s*:?\s*([A-Z]{3})\b/i).toUpperCase();
  const sourceStatus=first(t,/\bStatus\s*:?\s*([A-Z]{3})\b/i).toUpperCase();
  const pieces=first(t,/\bTotal\s*Pieces\s*:?\s*(\d{1,6})\b/i);
  const weight=first(t,/\bWeight\s*:?\s*([\d,.]+)\s*(?:KG|KGS?)\b/i).replace(/,/g,'');
  const flightDigits=first(t,/\bFlight\s*No\.?\s*:?\s*SV\s*[- ]?(\d{1,4})\b/i);
  const flightNo=flightDigits?`SV${flightDigits}`:'';
  const flightDate=first(t,/\bFlight\s*Date\s*:?\s*([0-3]?\d[A-Z]{3}\d{2,4})\b/i).toUpperCase();
  const volume=first(t,/\bVolume\s*:?\s*([\d,.]+)\s*(?:M3|M³|CBM)?\b/i).replace(/,/g,'');
  const segmentNo=first(t,/\bSegment\s*No\.?\s*:?\s*(\d+)\b/i);
  const eventDateTime=first(t,/\bDate\s*:?\s*([^A-Za-z]{0,4}[0-2]?\d:[0-5]\d\s*[-–—]\s*[0-3]?\d[A-Z]{3}\d{2,4})\b/i);

  if(!(destination||sourceStatus||pieces||weight||flightNo))return null;

  return {
    mawb,
    carrierCode:'SV',
    airlineName:'Saudia Cargo',
    officialTracker:URL,
    destination,
    bags:pieces,
    pieces,
    weight,
    flightNo,
    flightDate,
    volume,
    segmentNo,
    sourceStatus,
    status:mapStatus(sourceStatus),
    // Do not use DLV/summary Date as flight arrival. ETA/actual arrival is handled separately.
    arrivalDate:'',
    arrivalTime:'',
    arrivalIsActual:false,
    sourceEventDateTime:eventDateTime,
    source:'Saudia Cargo official Submit result card'
  };
}

async function pageText(page){return page.evaluate(()=>document.body?.innerText||'').catch(()=> '');}

async function markAwbInput(page){
  return page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>40&&r.height>18&&!e.disabled&&!e.readOnly;};
    const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));
    const found=inputs.find(e=>/awb|air\s*waybill|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('section,form,div')?.innerText||''}`))||inputs[0];
    if(!found)return false;
    found.dataset.mayaviSaudiaAwb='1';
    found.scrollIntoView({block:'center'});
    return true;
  }).catch(()=>false);
}

async function clickSubmit(page,timeout=10000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    const hit=await page.evaluate(()=>{
      const input=document.querySelector('[data-mayavi-saudia-awb="1"]');
      if(!input)return null;
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled;};
      const txt=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
      const candidates=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],span,div')].filter(visible);
      const exact=candidates.filter(e=>/^Submit$/i.test(txt(e))).sort((a,b)=>txt(a).length-txt(b).length)[0];
      if(exact){
        let clickable=exact.closest('button,a,[role="button"]')||exact;
        if(!['BUTTON','A','INPUT'].includes(clickable.tagName)&&clickable.getAttribute('role')!=='button'){
          const p=exact.parentElement;
          const sibling=p?.querySelector('button,a,[role="button"],input[type="submit"],input[type="button"]');
          if(sibling&&visible(sibling))clickable=sibling;
        }
        clickable.dataset.mayaviSaudiaSubmit='1';
        clickable.scrollIntoView({block:'center'});
        return {mode:'EXACT_SUBMIT',text:txt(exact)};
      }
      const ir=input.getBoundingClientRect(),cy=ir.top+ir.height/2;
      const buttons=candidates.filter(e=>['BUTTON','A','INPUT'].includes(e.tagName)||e.getAttribute('role')==='button').map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.left>=ir.left&&x.r.left<=ir.right+260&&x.r.top>=ir.bottom-30&&x.r.top<=ir.bottom+140).sort((a,b)=>Math.abs((a.r.top+a.r.height/2)-cy)-Math.abs((b.r.top+b.r.height/2)-cy));
      if(!buttons.length)return null;
      buttons[0].e.dataset.mayaviSaudiaSubmit='1';
      buttons[0].e.scrollIntoView({block:'center'});
      return {mode:'NEAR_AWB_BUTTON',text:txt(buttons[0].e)};
    }).catch(()=>null);
    if(hit){
      try{await page.click('[data-mayavi-saudia-submit="1"]');}catch{await page.evaluate(()=>document.querySelector('[data-mayavi-saudia-submit="1"]')?.click()).catch(()=>{});}
      return hit;
    }
    await sleep(300);
  }
  return null;
}

async function waitForResult(page,mawb,timeout=22000){
  const wanted=digits(mawb),end=Date.now()+timeout;
  let latest='';
  while(Date.now()<end){
    latest=await pageText(page);
    const normalized=clean(latest);
    if(digits(normalized).includes(wanted)&&/\bStatus\b/i.test(normalized)&&/\bTotal\s*Pieces\b/i.test(normalized)&&/\bFlight\s*No\.?\b/i.test(normalized))return latest;
    await sleep(500);
  }
  return latest;
}

export async function trackSaudiaDirect(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;
  const debug={stage:'OPEN',submit:null};
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
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(1800);

    if(!await markAwbInput(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL,debug:{stage:'AWB_INPUT_NOT_FOUND'}};
    const awbDigits=digits(mawb);
    await page.click('[data-mayavi-saudia-awb="1"]',{clickCount:3}).catch(()=>{});
    await page.keyboard.press('Control+A').catch(()=>{});
    await page.keyboard.press('Backspace').catch(()=>{});
    await page.type('[data-mayavi-saudia-awb="1"]',awbDigits,{delay:35});

    const submit=await clickSubmit(page);
    debug.submit=submit;
    if(!submit)return{ok:false,reason:'SAUDIA SUBMIT BUTTON NOT FOUND',officialTracker:URL,debug:{...debug,stage:'SUBMIT_NOT_FOUND'}};

    const text=await waitForResult(page,mawb,22000);
    debug.resultSample=clean(text).slice(0,5000);
    const shipment=parseResultCard(text,mawb);
    if(!shipment)return{ok:false,reason:'SAUDIA SUBMIT RESULT CARD NOT READABLE',officialTracker:URL,debug:{...debug,stage:'RESULT_NOT_READABLE'}};

    return{ok:true,shipment,officialTracker:URL,debug:{...debug,stage:'RESULT_CARD_SUCCESS'}};
  }catch(e){
    return{ok:false,reason:`SAUDIA TRACKING ERROR: ${e?.message||e}`,officialTracker:URL,debug:{...debug,stage:'ERROR'}};
  }finally{
    try{if(browser)await browser.close();}catch{}
  }
}
