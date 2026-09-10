import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://www.trackingmore.com/id/aircargo/saudia-cargo-tracking';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digits=v=>String(v||'').replace(/\D/g,'');
const first=(text,rx)=>clean((String(text||'').match(rx)||[])[1]||'');
function mapStatus(raw=''){const s=String(raw||'').toUpperCase();if(/DLV|DELIVERED|ARRIVED/.test(s))return'ARRIVED';if(/DEP|IN TRANSIT|TRANSIT|FLIGHT|MANIFEST/.test(s))return'IN TRANSIT';if(/BKD|BOOKED|RCS/.test(s))return'BOOKED';if(/DELAY|LATE|EXCEPTION/.test(s))return'DELAYED';return s||'TRACKING'}
function parse(text='',mawb=''){
  const t=clean(text);const full=digits(mawb),serial=full.slice(3),flat=digits(t);if(full&&!flat.includes(full)&&serial&&!flat.includes(serial))return null;
  const destination=first(t,/(?:Destination|Tujuan)\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const origin=first(t,/(?:Origin|Asal)\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
  const pieces=first(t,/(?:Pieces|Piece|PCS|Jumlah)\s*[:\-]?\s*(\d{1,6})\b/i);
  const weight=first(t,/(?:Weight|Berat)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS?)?/i).replace(/,/g,'');
  const flightNo=first(t,/(?:Flight(?:\s*(?:No\.?|Number))?|Penerbangan)\s*[:\-]?\s*([A-Z]{2}\s*\d{1,4})\b/i).replace(/\s+/g,'').toUpperCase();
  const flightDate=first(t,/(?:Flight Date|Tanggal Penerbangan)\s*[:\-]?\s*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
  const arrivalDate=first(t,/(?:Actual Date|Arrival Date|Tanggal Kedatangan)\s*[:\-]?\s*([^|]{6,30})/i);
  const sourceStatus=first(t,/(?:Status|Event)\s*[:\-]?\s*(DLV|BKD|XXX|ARR|DEP|RCS|RCF|MAN|Delivered|Arrived|Booked|In Transit|Departed|Delayed)/i).toUpperCase();
  if(!destination&&!origin&&!pieces&&!weight&&!flightNo&&!flightDate&&!arrivalDate&&!sourceStatus)return null;
  return{mawb,carrierCode:'SV',airlineName:'Saudia Cargo',officialTracker:URL,origin,destination,pieces,bags:pieces,weight,flightNo,flightDate,arrivalDate,arrivalTime:'',arrivalIsActual:Boolean(arrivalDate&&/DLV|ARRIVED|DELIVERED/i.test(sourceStatus)),sourceStatus,status:mapStatus(sourceStatus),source:'TrackingMore public Saudia cargo page'};
}
export async function trackSaudiaViaTrackingMorePublic(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;const bodies=[];const debug={stage:'OPEN',network:[]};
  try{chromium.setGraphicsMode=false;browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});const page=await browser.newPage();await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('response',async r=>{try{const u=r.url(),ct=String(r.headers()['content-type']||'');if(!/trackingmore/i.test(u)||!/json|text|javascript|html/i.test(ct))return;const body=await r.text();if(body&&body.length<800000){bodies.push(body);if(/awb|aircargo|track|shipment|flight|status/i.test(`${u} ${body}`))debug.network.push({url:u,status:r.status(),sample:clean(body).slice(0,600)})}}catch{}});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:35000});await sleep(2200);
    const found=await page.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>40&&r.height>18&&!e.disabled&&!e.readOnly};const xs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','checkbox','radio','password','email'].includes(String(e.type||'text').toLowerCase()));const x=xs.find(e=>/awb|tracking|waybill|297-72328572/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||xs[0];if(!x)return null;x.dataset.mayaviTmAwb='1';return{x:x.placeholder||'',all:xs.slice(0,8).map(e=>({placeholder:e.placeholder||'',name:e.name||'',id:e.id||''}))}}).catch(()=>null);
    debug.inputs=found;if(!found)return{ok:false,reason:'TRACKINGMORE AWB INPUT NOT FOUND',officialTracker:URL,debug:{...debug,stage:'INPUT_NOT_FOUND'}};
    await page.click('[data-mayavi-tm-awb="1"]',{clickCount:3}).catch(()=>{});await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.type(mawb,{delay:35});await sleep(350);
    const action=await page.evaluate(()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled};const txt=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const xs=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"]')].filter(vis);const x=xs.find(e=>/^(track|track now|track shipment|cek|lacak)$/i.test(txt(e)))||xs.find(e=>/track|lacak/i.test(txt(e)));if(!x)return null;x.dataset.mayaviTmTrack='1';return{label:txt(x),tag:x.tagName}}).catch(()=>null);debug.action=action;
    if(action)await page.click('[data-mayavi-tm-track="1"]',{delay:100}).catch(()=>{});else{await page.focus('[data-mayavi-tm-awb="1"]').catch(()=>{});await page.keyboard.press('Enter').catch(()=>{}});
    const end=Date.now()+30000;let combined='';while(Date.now()<end){combined=`${await page.evaluate(()=>document.body?.innerText||'').catch(()=> '')}\n${bodies.join('\n')}`;const shipment=parse(combined,mawb);if(shipment)return{ok:true,shipment,officialTracker:URL,debug:{...debug,stage:'TM_PUBLIC_SUCCESS'}};await sleep(500)}
    return{ok:false,reason:'TRACKINGMORE PUBLIC RESULT NOT READABLE',officialTracker:URL,debug:{...debug,stage:'RESULT_TIMEOUT',sample:clean(combined).slice(0,2200)}};
  }catch(e){return{ok:false,reason:`TRACKINGMORE PUBLIC ERROR: ${e?.message||e}`,officialTracker:URL,debug:{...debug,stage:'ERROR'}}}finally{try{if(browser)await browser.close()}catch{}}
}
