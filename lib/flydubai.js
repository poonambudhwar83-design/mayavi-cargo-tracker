// Flydubai FZ/141: separate verified reader for the airline's Mercator SkyChain
// public Trackshipmt screen. No login, CAPTCHA bypass or guessed timestamps.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

export const FLYDUBAI_TRACKER='https://prdcgofz.mercator.com/skychain/app?service=page/nwp:Trackshipmt';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digits=s=>String(s||'').replace(/\D/g,'');
const pad=n=>String(n).padStart(2,'0');
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
function dateOf(v=''){
  let m=String(v).match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(m)return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
  m=String(v).match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if(m)return m[3]+'-'+pad(m[2])+'-'+pad(m[1]);
  m=String(v).toUpperCase().match(/\b(\d{1,2})[\s-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,-]+(20\d{2})\b/);
  return m?m[3]+'-'+MONTHS[m[2]]+'-'+pad(m[1]):'';
}
function timeOf(v=''){
  const s=String(v).toUpperCase();
  let m=s.match(/\b(\d{1,2}):([0-5]\d)\s*([AP]M)\b/);
  if(m){let h=Number(m[1])%12+(m[3]==='PM'?12:0);return pad(h)+':'+m[2];}
  m=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
  return m?pad(m[1])+':'+m[2]:'';
}
function value(s,re){return (String(s).match(re)||[])[1]||'';}
function airport(s){return /^[A-Z]{3}$/.test(String(s||''))?String(s):'';}
function movementRows(rows=[]){
  const movements=[];
  for(const row of rows){
    const r=clean(row),upper=r.toUpperCase();
    const label=value(upper,/\b(ARRIVED|ARR|RCF|RECEIVED FROM FLIGHT|DEPARTED|DEP|OFFLOADED|OFLD|BOOKED|RCS)\b/);
    if(!label)continue;
    const flight=value(upper,/\b(FZ\s*[- ]?\d{2,4}[A-Z]?)\b/).replace(/[\s-]/g,'');
    const airports=[...upper.matchAll(/\b([A-Z]{3})\b/g)].map(x=>x[1]).filter(x=>!['FOW','RCS','DEP','ARR','RCF','AWB','ETA','ETD','ATA','ATD','FZD','PCS','KGS','FRT','FZC','UTC','IST'].includes(x));
    const from=airport(value(upper,/\b(?:FROM|ORIGIN|DEP(?:ARTURE)?(?:\s+STATION)?)\s*[:| -]+\s*([A-Z]{3})\b/));
    const to=airport(value(upper,/\b(?:TO|DESTINATION|ARRIVAL(?:\s+STATION)?|AT)\s*[:| -]+\s*([A-Z]{3})\b/));
    const date=dateOf(r),time=timeOf(r);
    movements.push({label,flight,from,to,airports,date,time,raw:r});
  }
  return movements;
}
export function parseFlydubaiText(text='',rows=[],mawb=''){
  const normalized=normalizeMawb(mawb),all=digits(normalized),serial=all.slice(3);
  if(!normalized.startsWith('141-'))return null;
  const raw=String(text||''),flat=clean(raw),upper=flat.toUpperCase();
  // A pre-filled form or unrelated page must not count as a live response.
  const explicit=new RegExp('(?:^|\\D)141[-\\s]?'+serial+'(?:\\D|$)').test(flat)
    ||new RegExp('(?:AWB|AIR\\s*WAYBILL|SHIPMENT)[\\s:#-]{0,20}'+serial+'\\b','i').test(flat);
  if(!explicit||/\b(?:CAPTCHA|VERIFY YOU ARE HUMAN|ACCESS DENIED|CLOUDFLARE)\b/i.test(flat))return null;
  const origin=airport(value(upper,/\b(?:ORIGIN|FROM\s+STATION|DEPARTURE\s+STATION)\s*[:| -]+\s*([A-Z]{3})\b/))
    ||airport(value(upper,/\b([A-Z]{3})\s*(?:-|->|→)\s*[A-Z]{3}\b/));
  const destination=airport(value(upper,/\b(?:DESTINATION|TO\s+STATION|ARRIVAL\s+STATION)\s*[:| -]+\s*([A-Z]{3})\b/))
    ||airport(value(upper,/\b[A-Z]{3}\s*(?:-|->|→)\s*([A-Z]{3})\b/));
  const pieces=value(flat,/\b(?:TOTAL\s+PIECES|PIECES|PCS|BAGS|NO\.?\s*OF\s*PIECES)\s*[:|#-]?\s*(\d{1,6})\b/i)
    ||value(flat,/\b(\d{1,6})\s*(?:PCS|PIECES|BAGS)\b/i);
  const weight=value(flat,/\b(?:GROSS\s*WEIGHT|TOTAL\s*WEIGHT|WEIGHT)\s*[:|#-]?\s*([\d,]+(?:\.\d+)?)\s*(?:KG|KGS)?\b/i).replace(/,/g,'');
  const movements=movementRows(rows);
  const dated=movements.filter(x=>x.date&&x.time);
  const actualFinal=destination?dated.filter(x=>/^(ARR|ARRIVED|RCF|RECEIVED FROM FLIGHT)$/.test(x.label)&&
    (x.to===destination||new RegExp('(?:\\bAT\\s+|\\|\\s*)'+destination+'\\b').test(x.raw.toUpperCase()))).at(-1):null;
  const expectedRows=dated.filter(x=>x.flight&&/ETA|EXPECTED|SCHEDULED/i.test(x.raw));
  const matchingExpected=expectedRows.filter(x=>!destination||x.to===destination||new RegExp('\\b'+destination+'\\b').test(x.raw)).at(-1);
  // Do not use an intermediate DXB arrival as the destination arrival.
  const departureRows=dated.filter(x=>/^(DEP|DEPARTED)$/.test(x.label));
  const firstDeparture=departureRows.find(x=>!origin||x.from===origin||new RegExp('\\b'+origin+'\\b').test(x.raw))||null;
  const latest=movements.at(-1);
  const offloaded=movements.some(x=>/OFFLOAD|OFLD/.test(x.label));
  const hasMovement=movements.length>0;
  const hasDetails=Boolean((origin&&destination)||pieces||weight||(hasMovement&&movements.some(x=>x.flight)));
  if(!hasDetails)return null;
  const flightNo=actualFinal?.flight||matchingExpected?.flight||dated.filter(x=>x.flight).at(-1)?.flight
    ||value(upper,/\b(FZ\s*[- ]?\d{2,4}[A-Z]?)\b/).replace(/[\s-]/g,'');
  const bookingLabel=raw.match(/(?:BOOKED|BOOKING\s+DATE|RCS|ACCEPTED)[^\n]{0,100}/i)?.[0]||'';
  const status=actualFinal?'ARRIVED':offloaded?'DELAYED':departureRows.length?'IN TRANSIT':hasMovement?'BOOKED':'TRACKING';
  const candidate=actualFinal||matchingExpected;
  return {mawb:normalized,carrierCode:'FZ',airlineName:'flydubai Cargo',
    origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate:dateOf(bookingLabel),
    departureDate:firstDeparture?.date||'',departureTime:firstDeparture?.time||'',
    departureFlightNo:firstDeparture?.flight||'',departureOrigin:origin,
    departureDestination:firstDeparture?.to||'',departureIsActual:Boolean(firstDeparture),
    arrivalDate:candidate?.date||'',arrivalTime:candidate?.time||'',arrivalIsActual:Boolean(actualFinal),
    arrivalTimeZone:'LOCAL',departureTimeZone:'LOCAL',status,
    source:'flydubai official Mercator SkyChain AWB-matched live result',
    officialTracker:FLYDUBAI_TRACKER,
    flydubaiLiveVerifiedAt:new Date().toISOString(),
    flydubaiEvidence:{matchedMawb:true,movementCount:movements.length,finalArrivalConfirmed:Boolean(actualFinal)}
  };
}
async function pageContents(page){
  const texts=[],rows=[];
  for(const frame of page.frames()){
    try{
      const v=await frame.evaluate(()=>({
        text:document.body?.innerText||'',
        rows:[...document.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(c=>c.innerText?.trim()||'').join(' | ')).filter(Boolean).slice(0,350)
      }));
      if(v.text)texts.push(v.text);
      if(v.rows)rows.push(...v.rows);
    }catch{}
  }
  return{text:texts.join('\n'),rows};
}
async function fillForm(page,serial){
  for(const frame of page.frames()){
    try{
      const list=await frame.$$('input:not([type="hidden"]),textarea');
      const fields=[];
      for(const el of list){
        const m=await el.evaluate(e=>{const r=e.getBoundingClientRect();return{
          visible:r.width>5&&r.height>5&&!e.disabled&&!e.readOnly,
          name:String(e.name||'')+' '+String(e.id||'')+' '+String(e.placeholder||'')+' '+String(e.getAttribute('aria-label')||''),
          max:e.maxLength,value:e.value||''
        }}).catch(()=>null);
        if(m?.visible)fields.push({el,...m});
      }
      let prefix=fields.find(x=>/prefix/i.test(x.name)||x.value==='141');
      let serialInput=fields.find(x=>x!==prefix&&(/AWB.*(number|no)|number|suffix|serial/i.test(x.name)||x.max===8));
      if(!serialInput)serialInput=fields.find(x=>x!==prefix&&/awb|waybill|shipment/i.test(x.name));
      if(!serialInput)continue;
      if(prefix&&prefix.value!=='141'){
        await prefix.el.click({clickCount:3});await prefix.el.type('141',{delay:35});
      }
      await serialInput.el.click({clickCount:3});
      await serialInput.el.press('Backspace');
      const entry=serialInput.max===8||prefix?serial:'141'+serial;
      await serialInput.el.type(entry,{delay:40});
      const entered=await serialInput.el.evaluate(e=>e.value).catch(()=>'');
      if(entered!==entry)continue;
      let clicked=false;
      for(const btn of await frame.$$('button,input[type="submit"],input[type="button"],a')){
        const meta=await btn.evaluate(e=>{const r=e.getBoundingClientRect();return{
          visible:r.width>4&&r.height>4&&!e.disabled,
          label:String(e.innerText||e.value||e.getAttribute('aria-label')||'').trim()
        }}).catch(()=>null);
        if(meta?.visible&&/^(TRACK|TRACK SHIPMENT|SEARCH|SUBMIT)$/i.test(meta.label)){
          await btn.click().catch(()=>{});clicked=true;break;
        }
      }
      if(!clicked)await serialInput.el.press('Enter');
      return{ok:true,clicked,entered:entry};
    }catch{}
  }
  return{ok:false,reason:'FLYDUBAI_TRACKING_INPUT_NOT_FOUND'};
}
export async function trackFlydubai(value){
  const mawb=normalizeMawb(value);
  if(!mawb.startsWith('141-'))return{ok:false,reason:'FLYDUBAI_PREFIX_MUST_BE_141',officialTracker:FLYDUBAI_TRACKER};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
      executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:1440,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36');
    await page.goto(FLYDUBAI_TRACKER,{waitUntil:'domcontentloaded',timeout:25000});
    await sleep(1200);
    const form=await fillForm(page,mawb.slice(4));
    if(!form.ok)return{ok:false,reason:form.reason,officialTracker:FLYDUBAI_TRACKER,debug:{stage:'FORM_NOT_FOUND'}};
    for(let i=0;i<9;i++){
      await sleep(i===0?1800:900);
      const data=await pageContents(page);
      if(/captcha|verify you are human|access denied|security challenge/i.test(data.text))
        return{ok:false,reason:'FLYDUBAI_SITE_REQUIRES_MANUAL_VERIFICATION',officialTracker:FLYDUBAI_TRACKER,debug:{stage:'BLOCKED'}};
      if(/no record|no shipment|invalid (?:awb|airway)|not found/i.test(data.text))
        return{ok:false,reason:'FLYDUBAI_AWB_NOT_FOUND',officialTracker:FLYDUBAI_TRACKER,debug:{stage:'NO_RECORD'}};
      const shipment=parseFlydubaiText(data.text,data.rows,mawb);
      if(shipment)return{ok:true,shipment,officialTracker:FLYDUBAI_TRACKER,debug:{stage:'LIVE_AWB_MATCHED',movementCount:shipment.flydubaiEvidence.movementCount}};
    }
    return{ok:false,reason:'FLYDUBAI_NO_VERIFIED_AWB_DETAILS',officialTracker:FLYDUBAI_TRACKER,debug:{stage:'NO_VERIFIED_DETAILS'}};
  }catch(err){
    return{ok:false,reason:'FLYDUBAI_TRACKING_FAILED: '+String(err?.message||err).slice(0,180),officialTracker:FLYDUBAI_TRACKER,debug:{stage:'OFFICIAL_UNAVAILABLE'}};
  }finally{if(browser)await browser.close().catch(()=>{});}
}
