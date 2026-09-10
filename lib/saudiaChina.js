import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://china.saudiacargo.com/e-services/track-shipment';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const digits=v=>String(v||'').replace(/\D/g,'');
const first=(text,rx)=>clean((String(text||'').match(rx)||[])[1]||'');

function mapStatus(raw=''){
  const s=String(raw||'').trim().toUpperCase();
  if(s==='DLV'||/DELIVERED|ARRIVED/.test(s))return'ARRIVED';
  if(s==='XXX'||/DEP|RCF|MAN|IN TRANSIT|DEPARTED/.test(s))return'IN TRANSIT';
  if(s==='BKD'||/RCS|BOOKED/.test(s))return'BOOKED';
  if(/DLY|DELAY|LATE/.test(s))return'DELAYED';
  return s||'TRACKING';
}
function extractJsonPayloads(text=''){
  const out=[String(text||'')];
  try{const obj=JSON.parse(String(text||''));out.push(JSON.stringify(obj));if(typeof obj?.message==='string'){out.push(obj.message);try{out.push(JSON.stringify(JSON.parse(obj.message)))}catch{}}if(typeof obj?.data==='string')out.push(obj.data);if(obj?.data&&typeof obj.data==='object')out.push(JSON.stringify(obj.data));}catch{}
  return out.join('\n');
}
function parse(text='',mawb=''){
  const t=clean(extractJsonPayloads(text));if(!t)return null;
  const full=digits(mawb),serial=full.slice(3),flat=digits(t);if(full&&!flat.includes(full)&&serial&&!flat.includes(serial))return null;
  const destination=first(t,/(?:\bDestination\b|["']destination["'])\s*["':=\s-]*([A-Z]{3})\b/i).toUpperCase();
  const origin=first(t,/(?:\bOrigin\b|["']origin["'])\s*["':=\s-]*([A-Z]{3})\b/i).toUpperCase();
  const sourceStatus=first(t,/(?:\bStatus\b|["'](?:status|state|milestone)["'])\s*["':=\s-]*(DLV|XXX|BKD|ARR|DEP|RCF|MAN|RCS|DLY|[A-Za-z ]{4,30})/i).toUpperCase();
  const pieces=first(t,/(?:\bTotal\s*(?:Number\s*Of\s*)?Pieces\b|["'](?:totalPieces|pieceCount|pieces|totalNoOfPieces|pcs)["'])\s*["':=\s-]*(\d{1,6})\b/i);
  const weight=first(t,/(?:\bWeight\b|["'](?:weight|grossWeight|totalWeight)["'])\s*["':=\s-]*([\d,.]+)(?:\s*(?:KG|KGS?))?/i).replace(/,/g,'');
  const f=first(t,/(?:\bFlight\s*(?:No\.?|Number)\b|["'](?:flightNo|flightNumber)["'])\s*["':=\s-]*(?:SV\s*[- ]?)?(\d{1,4})\b/i);const flightNo=f?`SV${f}`:'';
  const flightDate=first(t,/(?:\bFlight\s*Date\b|["']flightDate["'])\s*["':=\s-]*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
  const arrivalDate=first(t,/(?:\bArrival\s*Date\b|["']arrivalDate["'])\s*["':=\s-]*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
  const arrivalTime=first(t,/(?:\bArrival\s*Time\b|["']arrivalTime["'])\s*["':=\s-]*(\d{1,2}:\d{2})\b/i);
  const meaningful=Boolean(destination||origin||sourceStatus||pieces||weight||flightNo||flightDate||arrivalDate||arrivalTime);if(!meaningful)return null;
  return{mawb,carrierCode:'SV',airlineName:'Saudia Cargo',officialTracker:URL,origin,destination,pieces,bags:pieces,weight,flightNo,flightDate,arrivalDate,arrivalTime,arrivalIsActual:Boolean(arrivalDate&&/DLV|ARRIVED|DELIVERED/i.test(sourceStatus)),sourceStatus,status:mapStatus(sourceStatus),source:'Saudia Cargo China public tracking'};
}
async function bodyText(page){return page.evaluate(()=>document.body?.innerText||'').catch(()=> '');}
async function probeScripts(page){
  return page.evaluate(async()=>{
    const scripts=[...document.scripts].map(s=>s.src).filter(Boolean).filter(u=>/e-services|track-shipment|webpack|main/i.test(u)).slice(0,12);
    const out=[];
    for(const u of scripts){try{const txt=await fetch(u).then(r=>r.text());const hits=[];const rx=/.{0,100}(?:awb|trackShipment|track-shipment|track shipment|\/apis?\/|axios|fetch\().{0,220}/ig;let m;while((m=rx.exec(txt))&&hits.length<12)hits.push(m[0].replace(/\s+/g,' '));out.push({url:u,hits});}catch(e){out.push({url:u,error:String(e)})}}
    return out;
  }).catch(()=>[]);
}
async function findInput(page){return page.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>30&&r.height>15&&!e.disabled&&!e.readOnly};const xs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button','password','email'].includes(String(e.type||'text').toLowerCase()));const x=xs.find(e=>/awb|065-000000|air\s*waybill|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('form,section,div')?.innerText||''}`))||xs[0];if(!x)return null;x.dataset.mayaviChinaAwb='1';x.scrollIntoView({block:'center'});const parents=[];let p=x;for(let i=0;i<5&&p;i++,p=p.parentElement)parents.push((p.innerText||'').replace(/\s+/g,' ').trim().slice(0,500));return{placeholder:x.placeholder||'',name:x.name||'',id:x.id||'',parents};}).catch(()=>null)}
async function setAwb(page,mawb){await page.evaluate((v)=>{const e=document.querySelector('[data-mayavi-china-awb="1"]');if(!e)return;const proto=Object.getPrototypeOf(e),setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(e,v);else e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},mawb).catch(()=>{});await sleep(250);return page.$eval('[data-mayavi-china-awb="1"]',e=>e.value).catch(()=> '')}
async function clickTrack(page){
  const nearby=await page.evaluate(()=>{const input=document.querySelector('[data-mayavi-china-awb="1"]');if(!input)return null;const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled};const txt=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();let root=input.closest('form');if(!root){root=input.parentElement;for(let i=0;i<5&&root;i++,root=root.parentElement){if(root.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]').length)break;}}const xs=[...(root||document).querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')].filter(visible);let x=xs.find(e=>/^(追踪货物|追踪|track shipment|track|search|submit)$/i.test(txt(e)));if(!x)x=xs.find(e=>/track|追踪/i.test(txt(e)));if(!x)return null;x.dataset.mayaviChinaTrack='1';x.scrollIntoView({block:'center'});return{label:txt(x),tag:x.tagName,type:x.getAttribute('type')||'',href:x.getAttribute('href')||''};}).catch(()=>null);
  if(nearby){await page.click('[data-mayavi-china-track="1"]',{delay:100}).catch(async()=>{await page.evaluate(()=>document.querySelector('[data-mayavi-china-track="1"]')?.click()).catch(()=>{})});return nearby;}
  await page.focus('[data-mayavi-china-awb="1"]').catch(()=>{});await page.keyboard.press('Enter').catch(()=>{});return{label:'ENTER',tag:'INPUT',type:'keyboard',href:''};
}
export async function trackSaudiaViaChina(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  let browser;const bodies=[];const debug={stage:'OPEN',network:[]};
  try{chromium.setGraphicsMode=false;browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=zh-CN,zh,en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});const page=await browser.newPage();await page.setExtraHTTPHeaders({'Accept-Language':'zh-CN,zh;q=0.9,en;q=0.8'});
    page.on('response',async r=>{try{const u=r.url(),ct=String(r.headers()['content-type']||'');if(!/china\.saudiacargo\.com|azurewebsites\.net|saudiacargo/i.test(u)||!/json|text|javascript|html/i.test(ct))return;const body=await r.text();if(body&&body.length<800000){bodies.push(body);if(/track|shipment|awb|flight|status|api/i.test(`${u} ${body}`))debug.network.push({url:u,status:r.status(),sample:clean(body).slice(0,800)});}}catch{}});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:35000});await sleep(1800);debug.scriptProbe=await probeScripts(page);const info=await findInput(page);debug.input=info;if(!info)return{ok:false,reason:'CHINA SAUDIA AWB INPUT NOT FOUND',officialTracker:URL,debug:{...debug,stage:'INPUT_NOT_FOUND',sample:clean(await bodyText(page)).slice(0,1800)}};
    debug.typedValue=await setAwb(page,mawb);debug.action=await clickTrack(page);
    const end=Date.now()+30000;let combined='';while(Date.now()<end){combined=`${await bodyText(page)}\n${bodies.join('\n')}`;const shipment=parse(combined,mawb);if(shipment)return{ok:true,shipment,officialTracker:URL,debug:{...debug,stage:'CHINA_RESULT_SUCCESS'}};await sleep(500)}
    return{ok:false,reason:'CHINA SAUDIA RESULT NOT READABLE',officialTracker:URL,debug:{...debug,stage:'RESULT_TIMEOUT',sample:clean(combined).slice(0,2200)}};
  }catch(e){return{ok:false,reason:`CHINA SAUDIA ERROR: ${e?.message||e}`,officialTracker:URL,debug:{...debug,stage:'ERROR'}}}finally{try{if(browser)await browser.close()}catch{}}
}
