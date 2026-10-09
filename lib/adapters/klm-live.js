import fs from 'node:fs';
import { normalizeMawb } from '../airlines.js';

const tidy = s => String(s || '').replace(/\s+/g, ' ').trim();
const URL_BASE = 'https://www.afklcargo.com/mycargo/shipment/detail/';
const months = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
const timeZone = {FRA:'Europe/Berlin',AMS:'Europe/Amsterdam',DEL:'Asia/Kolkata'};
function parseLocal(value, station) {
  const m = tidy(value).match(/(\d{1,2})\s+([A-Z]{3})\s+(\d{2}:\d{2})/i);
  if (!m) return null;
  const year = new Date().getUTCFullYear();
  const month = months[m[2].toUpperCase()];
  if (month === undefined) return null;
  const date = `${year}-${String(month+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // DEL times on myCargo's Local Time setting are already India local.
  if (station === 'DEL') return {date,time:m[3]};
  // Other stations are retained as local values; no invented UTC offset.
  return {date,time:m[3],timeZone:timeZone[station]||null};
}
function parseKlm(text, mawb) {
  const raw = String(text||'');
  const t = tidy(raw);
  if (!t.includes(mawb)) return null;
  const route = t.match(/\b([A-Z]{3})\s*(?:→|➜|✈|-)\s*([A-Z]{3})\b/);
  const quantity = t.match(/\b(\d{1,5})\s*pcs\s*,?\s*([\d,.]+)\s*kg\b/i);
  const pieces = quantity?.[1] || (t.match(/\b(\d{1,5})\s*pieces\b/i)||[])[1] || '';
  const weight = quantity?.[2]?.replace(/,/g,'') || (t.match(/\b([\d,.]+)\s*kg\b/i)||[])[1]?.replace(/,/g,'') || '';
  const flightMatches = [...t.matchAll(/\b(KL\s?\d{3,4})\b/ig)];
  const flightNo = flightMatches.length ? flightMatches.at(-1)[1].replace(/\s/g,'').toUpperCase() : '';
  const destBlock = raw.match(/\bDEL\s+ARRIVAL\s+(?:\d+\s*pcs\s+)?(Estimated:|Actual:)?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{2}:\d{2})/i);
  const arrival = destBlock ? parseLocal(destBlock[2],'DEL') : null;
  const actual = Boolean(destBlock && /Actual:/i.test(destBlock[1]||''));
  const delivered = /\bDEL\s+DELIVERED\s+\d+\s*pcs\s+(?!Estimated)/i.test(raw);
  const accepted = /\bACCEPTED\b/i.test(t);
  const departed = /\bDEPARTED\s+\d+\s*pcs\s+(?!Estimated:)/i.test(raw);
  const status = delivered?'DELIVERED':actual?'ARRIVED':departed?'IN TRANSIT':accepted?'ACCEPTED':'TRACKING';
  if (!(route || pieces || weight || flightNo || arrival)) return null;
  return {mawb,carrierCode:'KL',airlineName:'KLM Cargo',
    origin:route?.[1]||'',destination:route?.[2]||'',
    bags:pieces,pieces,weight,flightNo,
    arrivalDate:arrival?.date||'',arrivalTime:arrival?.time||'',
    arrivalIsActual:actual,arrivalEstimate:Boolean(arrival&&!actual),
    status,officialTracker:URL_BASE+mawb,
    source:'Air France KLM myCargo official Station View',
    arrivalTimeSource:arrival?'myCargo DEL station local time (IST)':'',
    timeZone:'Asia/Kolkata'};
}
export async function trackKlmLive(value) {
  const mawb = normalizeMawb(value);
  if (!mawb || !mawb.startsWith('074-')) return {ok:false,reason:'Invalid KLM MAWB'};
  let browser;
  const url=URL_BASE+mawb;
  try {
    const puppeteer=(await import('puppeteer-core')).default;
    const candidates=[process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].filter(Boolean);
    let executablePath=candidates.find(p=>fs.existsSync(p));
    let args=['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'];
    if(!executablePath){
      const mod=await import('@sparticuz/chromium');
      const chromium=mod.default||mod;
      executablePath=await chromium.executablePath();args=chromium.args;
    }
    browser=await puppeteer.launch({executablePath,args,headless:true});
    const page=await browser.newPage();
    await page.setViewport({width:1365,height:1000});
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
    await page.waitForFunction((awb)=>document.body?.innerText?.includes(awb) && /Shipment details|Flight schedule|Progress details/i.test(document.body.innerText),{timeout:15000},mawb).catch(()=>{});
    const text=await page.evaluate(()=>document.body?.innerText||'');
    const shipment=parseKlm(text,mawb);
    if(!shipment)return {ok:false,reason:'KLM official page did not expose verified shipment details',debug:{url,bodyLength:text.length}};
    return {ok:true,airline:{name:'KLM Cargo',iata:'KL',url},shipment,debug:{url,bodyLength:text.length}};
  }catch(e){return {ok:false,reason:String(e?.message||e).slice(0,200),debug:{url}};}
  finally{if(browser)await browser.close().catch(()=>{});}
}
