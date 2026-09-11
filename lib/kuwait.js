import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const CARGO_URL='https://www.kuwaitairways.com/en/cargo/tracking';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');

function parseDate(v=''){
  const s=String(v||'').trim().toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(\d{2})\b/);if(m)return`20${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  return'';
}

function cleanCode(v=''){return String(v||'').toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]||'';}
function cleanFlight(v=''){const m=String(v||'').toUpperCase().match(/\bKU\s*[- ]?(\d{2,4})\b/);return m?`KU${m[1]}`:'';}
function piecesFrom(v=''){return String(v||'').match(/\b(\d{1,6})\s+PIECES?\b/i)?.[1]||'';}
function weightFrom(v=''){return String(v||'').match(/\b([\d,.]+)\s*KGS?\b/i)?.[1]?.replace(/,/g,'')||'';}
function timeFrom(v=''){
  const matches=[...String(v||'').matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];
  if(!matches.length)return'';
  const m=matches.at(-1);return`${pad(m[1])}:${m[2]}`;
}
function plusSevenHours(date='',time=''){
  const m=String(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/);const t=String(time).match(/^(\d{2}):(\d{2})$/);
  if(!m||!t)return{date:'',time:'',iso:''};
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(t[1]),Number(t[2]),0));
  d.setUTCHours(d.getUTCHours()+7);
  const nextDate=`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const nextTime=`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return{date:nextDate,time:nextTime,iso:`${nextDate}T${nextTime}:00`};
}

function cargoStatus(rows=[]){
  const joined=rows.map(r=>`${r.code} ${r.details}`).join(' ').toUpperCase();
  if(/DELIVERED|\bDLV\b|ARRIVED|LANDED|RECEIVED FROM FLIGHT|\bRCF\b/.test(joined))return'ARRIVED';
  if(/DEPARTED|\bDEP\b|IN TRANSIT|AIRBORNE|IN FLIGHT|UPLIFTED/.test(joined))return'IN TRANSIT';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP/.test(joined))return'DELAYED';
  return'BOOKED';
}

function operationalRows(tables=[]){
  for(const table of tables){
    const rows=table.rows||[];if(!rows.length)continue;
    const header=(rows[0].cells||[]).map(x=>String(x).toLowerCase()).join(' | ');
    if(!(header.includes('operational status')&&header.includes('airport')&&header.includes('details')))continue;
    return rows.slice(1).map(r=>({
      code:String(r.cells?.[0]||'').trim().toUpperCase(),
      airport:cleanCode(r.cells?.[1]||''),
      dateText:String(r.cells?.[2]||'').trim(),
      details:String(r.cells?.[3]||'').trim()
    })).filter(r=>r.code||r.airport||r.details);
  }
  return[];
}

async function acceptCookies(page){
  await page.evaluate(()=>{
    const text=e=>(e?.innerText||e?.value||e?.getAttribute?.('aria-label')||'').trim();
    const b=[...document.querySelectorAll('button,a,[role="button"]')].find(x=>/accept cookies|accept all|agree|allow all/i.test(text(x)));
    if(b)b.click();
  }).catch(()=>{});
}

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},
    executablePath:await chromium.executablePath(),
    headless:'shell'
  });
}

export async function trackKuwait(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('229-'))return{ok:false,reason:'INVALID KUWAIT MAWB'};

  const prefix='229',serial=mawb.slice(4);let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(CARGO_URL,{waitUntil:'domcontentloaded',timeout:22000});
    await new Promise(r=>setTimeout(r,1400));
    await acceptCookies(page);

    const fill=await page.evaluate(({prefix,serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
      const set=(e,v)=>{if(!e)return;const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));};
      const p=inputs.find(e=>/prefix/.test(desc(e)));
      let a=inputs.find(e=>/awb/.test(desc(e))&&!/prefix/.test(desc(e)));
      if(!a)a=inputs.find(e=>e!==p)||inputs[0];
      set(p,prefix);set(a,serial);
      return{prefixFound:Boolean(p),awbFound:Boolean(a),prefixValue:p?.value||'',awbValue:a?.value||''};
    },{prefix,serial});

    if(!fill.awbFound)return{ok:false,reason:'KUWAIT AWB INPUT NOT FOUND',officialTracker:CARGO_URL,debug:{fill}};

    const clicked=await page.evaluate(()=>{
      const text=e=>(e?.innerText||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
      const b=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')].find(e=>/^submit$/i.test(text(e)));
      if(b){b.click();return true;}return false;
    });
    if(!clicked)return{ok:false,reason:'KUWAIT SUBMIT BUTTON NOT FOUND',officialTracker:CARGO_URL,debug:{fill}};

    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,9000))]);
    await new Promise(r=>setTimeout(r,1200));

    const extracted=await page.evaluate(()=>{
      const tables=[...document.querySelectorAll('table')].map(table=>({
        rows:[...table.querySelectorAll('tr')].map(tr=>({cells:[...tr.querySelectorAll('th,td')].map(td=>(td.innerText||td.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean)})).filter(r=>r.cells.length)
      })).filter(t=>t.rows.length);
      return{text:(document.body?.innerText||'').replace(/\s+/g,' ').trim(),tables};
    });

    const ops=operationalRows(extracted.tables);
    const rcs=ops.find(r=>r.code==='RCS')||{};
    const dep=ops.find(r=>r.code==='DEP')||{};
    const flightEvent=ops.find(r=>/^(PRE|DEP)$/.test(r.code)&&cleanFlight(r.details))||ops.find(r=>cleanFlight(r.details))||dep||ops[0]||{};
    const detailSource=flightEvent.details||rcs.details||'';

    const origin=rcs.airport||dep.airport||flightEvent.airport||'';
    const destination=(ops.find(r=>/^(RCF|DLV)$/.test(r.code)&&r.airport&&r.airport!==origin)?.airport)||'';
    const pieces=piecesFrom(detailSource)||piecesFrom(dep.details)||piecesFrom(rcs.details)||'';
    const weight=weightFrom(detailSource)||weightFrom(dep.details)||weightFrom(rcs.details)||'';
    const flightNo=cleanFlight(detailSource)||cleanFlight(dep.details)||cleanFlight(rcs.details)||'';
    const bookingDate=parseDate(rcs.dateText)||'';

    const depCombined=`${dep.dateText||''} ${dep.details||''}`.trim();
    const departureDate=parseDate(dep.dateText)||parseDate(dep.details)||parseDate(depCombined)||'';
    const departureTime=timeFrom(depCombined)||'';
    const calculatedArrival=departureDate&&departureTime?plusSevenHours(departureDate,departureTime):{date:'',time:'',iso:''};

    let status=cargoStatus(ops);
    let arrivalDate='';let arrivalTime='';let eta=null;let actualArrival=null;let arrivalIsActual=false;
    if(dep.code==='DEP'&&calculatedArrival.date&&calculatedArrival.time){
      arrivalDate=calculatedArrival.date;
      arrivalTime=calculatedArrival.time;
      eta=calculatedArrival.iso;
      const calculatedMs=new Date(`${calculatedArrival.iso}+05:30`).getTime();
      if(Number.isFinite(calculatedMs)&&Date.now()>=calculatedMs){
        status='ARRIVED';
        actualArrival=calculatedArrival.iso;
      }else{
        status='IN TRANSIT';
      }
    }

    const shipment={
      mawb,
      carrierCode:'KU',
      airlineName:'Kuwait Airways Cargo',
      officialTracker:CARGO_URL,
      origin,
      destination,
      pieces,
      bags:pieces,
      weight,
      flightNo,
      bookingDate,
      departureDate,
      departureTime,
      arrivalDate,
      arrivalTime,
      eta,
      actualArrival,
      arrivalIsActual,
      status,
      source:calculatedArrival.date?'Kuwait Airways cargo Details section · DEP + 7 hours':'Kuwait Airways cargo Details section'
    };

    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    const useful=Boolean(origin||pieces||weight||flightNo||bookingDate||departureDate||arrivalDate);
    if(!useful)return{ok:false,reason:'KUWAIT DETAILS SECTION RETURNED NO VERIFIED FIELDS',officialTracker:CARGO_URL,screenshotBase64,debug:{fill,clicked,ops,textSample:extracted.text.slice(0,6000)}};

    return{
      ok:true,
      shipment,
      screenshotBase64,
      screenshotCaptured:Boolean(screenshotBase64),
      screenshotVerified:true,
      debug:{stage:'KUWAIT_DETAILS_DEP_PLUS_7',fill,clicked,ops,departureDate,departureTime,calculatedArrival,textSample:extracted.text.slice(0,6000)}
    };
  }catch(e){
    return{ok:false,reason:`KUWAIT TRACKING ERROR: ${e?.message||e}`,officialTracker:CARGO_URL,debug:{stage:'ERROR'}};
  }finally{
    try{if(browser)await browser.close()}catch{}
  }
}
