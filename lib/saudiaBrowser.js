import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://china.saudiacargo.com/e-services';
const pad=v=>String(v).padStart(2,'0');
const first=(s,rx)=>(String(s).match(rx)||[])[1]||'';

function translate(s=''){
  return String(s)
    .replace(/货物追踪|追踪货物/g,'Track Shipment')
    .replace(/目的地/g,'Destination')
    .replace(/始发地|起点|出发地/g,'Origin')
    .replace(/件数/g,'Pieces')
    .replace(/航段/g,'Segment')
    .replace(/航班/g,'Flight')
    .replace(/重量/g,'Weight')
    .replace(/到达|抵达|到港/g,'Arrived')
    .replace(/出发|离港|起飞/g,'Departed')
    .replace(/日期/g,'Date')
    .replace(/时间/g,'Time')
    .replace(/已交付/g,'Delivered')
    .replace(/\s+/g,' ')
    .trim();
}
function parseDate(s=''){
  let m=String(s).match(/(20\d{2})[-\/.]([01]?\d)[-\/.]([0-3]?\d)/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=String(s).match(/(20\d{2})年([01]?\d)月([0-3]?\d)日/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=String(s).match(/([0-3]?\d)[-\/.]([01]?\d)[-\.\/](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function parseResult(raw,mawb){
  const text=translate(raw),upper=text.toUpperCase();
  const route=upper.match(/\bORIGIN\b\s*[:\-]?\s*([A-Z]{3})\b[\s\S]{0,220}?\bDESTINATION\b\s*[:\-]?\s*([A-Z]{3})\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/);
  let origin=route?.[1]||'',destination=route?.[2]||'';
  const svRows=[...upper.matchAll(/\bSV[-\s]?(\d{2,4})\b/g)];
  const flightNo=svRows.length?`SV${svRows[svRows.length-1][1]}`:'';
  const pieces=first(text,/(?:Pieces?|Pcs?|Number of Pieces)\s*[:\-]?\s*(\d{1,6})/i)||first(text,/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i);
  const weight=(first(text,/(?:Gross Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||first(text,/\b([\d,.]+)\s*(?:KG|KGS)\b/i)).replace(/,/g,'');
  const segmentNo=first(text,/(?:Segment(?: No\.?| Number)?)\s*[:#\-]?\s*([A-Z0-9-]+)/i);
  let status='TRACKING';
  if(/DELIVERED|\bDLV\b/i.test(text))status='DELIVERED';
  else if(/ARRIVED|LANDED|\bRCF\b|RECEIVED FROM FLIGHT/i.test(text))status='ARRIVED';
  else if(/DEPARTED|IN TRANSIT|AIRBORNE|\bDEP\b/i.test(text))status='IN TRANSIT';
  else if(/BOOKED|ACCEPTED|\bRCS\b/i.test(text))status='BOOKED';
  const arrivalBlock=(text.match(/(?:Actual Arrival|Arrived|Arrival|ATA)[\s\S]{0,300}/i)||[])[0]||'';
  const etaBlock=(text.match(/(?:Estimated Arrival|Expected Arrival|Scheduled Arrival|ETA)[\s\S]{0,300}/i)||[])[0]||'';
  let arrivalDate=parseDate(arrivalBlock),arrivalTime=parseTime(arrivalBlock),arrivalIsActual=status==='ARRIVED'&&Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(etaBlock);arrivalTime=parseTime(etaBlock);arrivalIsActual=false;}
  if((!origin||!destination)&&flightNo){
    const fm=upper.indexOf(flightNo);if(fm>=0){const w=upper.slice(Math.max(0,fm-260),fm+420);const codes=[...w.matchAll(/\b[A-Z]{3}\b/g)].map(x=>x[0]).filter(x=>!['AWB','PCS','KGS'].includes(x));if(codes.length>=2){origin=origin||codes[0];destination=destination||codes[codes.length-1];}}
  }
  return{mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,segmentNo,officialTracker:URL,source:'Saudia Cargo browser segment reader (translated to English)'};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}

export async function trackSaudiaWithBrowser(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:20000});
    await new Promise(r=>setTimeout(r,2200));

    const setup=await page.evaluate((mawb)=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const awb=inputs.find(e=>/065-000000|awb|airway/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
      if(!awb)return{filled:false,submitMode:'',buttonTexts:[]};
      set(awb,mawb);
      awb.focus();
      const txt=e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.title||'').replace(/\s+/g,' ').trim();
      const form=awb.closest('form');
      const all=[...document.querySelectorAll('button,input[type="submit"],[role="button"],a')].filter(visible);
      const buttonTexts=all.slice(0,50).map(txt).filter(Boolean);
      let btn=all.find(e=>/track\s*shipment/i.test(txt(e))||/追踪货物/.test(txt(e)));
      if(!btn&&form)btn=[...form.querySelectorAll('button,input[type="submit"],[role="button"]')].find(visible)||null;
      if(btn){const label=txt(btn)||'FORM_BUTTON';btn.click();return{filled:true,submitMode:`click:${label}`,buttonTexts};}
      if(form&&typeof form.requestSubmit==='function'){form.requestSubmit();return{filled:true,submitMode:'requestSubmit',buttonTexts};}
      return{filled:true,submitMode:'keyboard-enter',buttonTexts};
    },mawb);

    if(!setup.filled)return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',officialTracker:URL,debug:{stage:'NO_INPUT',setup}};
    if(setup.submitMode==='keyboard-enter')await page.keyboard.press('Enter');

    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);
    await new Promise(r=>setTimeout(r,1800));

    let initialText=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    const beforeLen=initialText.length;
    const segmentClick=await page.evaluate(()=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10};
      const els=[...document.querySelectorAll('button,[role="button"],a,tr,div')].filter(visible);
      const txt=e=>(e.innerText||e.getAttribute('aria-label')||e.title||'').replace(/\s+/g,' ').trim();
      const cands=els.map(e=>({e,t:txt(e)})).filter(x=>x.t&&x.t.length<600&&(/segment|航段/i.test(x.t)||/\bSV[-\s]?\d{2,4}\b/i.test(x.t)));
      if(!cands.length)return'';
      const target=cands[cands.length-1];target.e.click();return target.t.slice(0,220);
    }).catch(()=> '');
    if(segmentClick){await new Promise(r=>setTimeout(r,1600));await page.waitForNetworkIdle({idleTime:700,timeout:5000}).catch(()=>{});}

    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=>initialText);
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    const shipment=parseResult(text,mawb);
    if(useful(shipment))return{ok:true,shipment,screenshotBase64,debug:{stage:'SUCCESS',setup,segmentClick,textGrew:text.length>beforeLen,pageText:translate(text).slice(0,9000)}};
    return{ok:false,reason:'SAUDIA RESULT OPENED BUT NO VERIFIED SEGMENT FIELDS FOUND',officialTracker:URL,screenshotBase64,debug:{stage:'NO_FIELDS',setup,segmentClick,pageText:translate(text).slice(0,9000)}};
  }catch(e){return{ok:false,reason:`SAUDIA BROWSER ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
