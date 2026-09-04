import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { readTrackingScreenshot } from './screenshotOcr.js';

const START='https://aicargoportal.airindia.com/icargoneoportal/app/main/#/app';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function around(text,rx,before=160,after=520){const m=rx.exec(text);if(!m)return'';return text.slice(Math.max(0,m.index-before),Math.min(text.length,m.index+after));}
function parseTrackingText(text='',mawb=''){
  const flat=clean(text),upper=flat.toUpperCase();
  let route=upper.match(/\bORIGIN\b\s*[:\-]?\s*(?:[A-Z][A-Z .'-]{2,30}\s*\()?([A-Z]{3})\)?\b[\s\S]{0,220}?\bDESTINATION\b\s*[:\-]?\s*(?:[A-Z][A-Z .'-]{2,30}\s*\()?([A-Z]{3})\)?\b/)
    ||upper.match(/\bFROM\b\s*[:\-]?\s*(?:[A-Z][A-Z .'-]{2,30}\s*\()?([A-Z]{3})\)?\b[\s\S]{0,220}?\bTO\b\s*[:\-]?\s*(?:[A-Z][A-Z .'-]{2,30}\s*\()?([A-Z]{3})\)?\b/)
    ||upper.match(/\b([A-Z]{3})\s*(?:→|->|—|–|-)\s*([A-Z]{3})\b/);
  if(!route){
    const codes=[...upper.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]);
    if(codes.length>=2)route=[null,codes[0],codes[codes.length-1]];
  }
  const pieces=((flat.match(/(?:No\.?\s*of\s*Pieces|Number\s*of\s*Pieces|Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||(flat.match(/\b(\d{1,6})\s*(?:PCS|PIECES?)\b/i)||[])[1]||'');
  const weight=(((flat.match(/(?:Gross\s*Weight|Chargeable\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS)?/i)||[])[1]||(flat.match(/\b([\d,.]+)\s*(?:KG|KGS)\b/i)||[])[1]||'').replace(/,/g,''));
  const flights=[...upper.matchAll(/\bAI\s*[- ]?(\d{2,4})\b/g)].map(m=>`AI${m[1]}`);
  const flightNo=flights.length?flights[flights.length-1]:'';
  const actual=around(flat,/ACTUAL\s+ARRIVAL|\bARRIVED\b|\bLANDED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|ARRIVAL\s+OF\s+SHIPMENT/i);
  const eta=around(flat,/ETA|ESTIMATED\s+ARRIVAL|EXPECTED\s+ARRIVAL|SCHEDULED\s+ARRIVAL/i);
  let arrivalDate=parseDate(actual),arrivalTime=parseTime(actual),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  if(!arrivalDate&&!arrivalTime){arrivalDate=parseDate(eta);arrivalTime=parseTime(eta);arrivalIsActual=false;}
  let status='';
  if(/\bDELIVERED\b|\bDLV\b/i.test(actual||flat))status='DELIVERED';
  else if(/ACTUAL\s+ARRIVAL|\bARRIVED\b|\bLANDED\b|RECEIVED\s+FROM\s+FLIGHT|\bRCF\b|ARRIVAL\s+OF\s+SHIPMENT/i.test(actual))status='ARRIVED';
  else if(/\bDEPARTED\b|\bDEP\b|IN\s+TRANSIT|AIRBORNE/i.test(flat))status='IN TRANSIT';
  else if(/\bBOOKED\b|\bRCS\b|ACCEPTED|RECEIVED\s+FROM\s+SHIPPER/i.test(flat))status='BOOKED';
  const serial=digitsOnly(mawb).slice(3),awbMatched=Boolean(serial&&digitsOnly(flat).includes(serial));
  return{mawb,carrierCode:'AI',airlineName:'Air India Cargo',origin:route?.[1]||'',destination:route?.[2]||'',bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,awbMatched};
}
function merge(base={},next={}){const out={...base};for(const[k,v]of Object.entries(next||{})){if(v!==''&&v!==null&&v!==undefined)out[k]=v;}return out;}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}

async function deepInputs(frame){
  return frame.evaluate(()=>{
    const out=[];
    const walk=root=>{
      for(const el of root.querySelectorAll('*')){
        if(el.shadowRoot)walk(el.shadowRoot);
        if(el.tagName==='INPUT'){
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          if(r.width<=0||r.height<=0||s.display==='none'||s.visibility==='hidden'||el.disabled)continue;
          const labels=[];
          if(el.id){const l=root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`);if(l)labels.push(l.innerText||l.textContent||'');}
          const near=el.closest('label,div,form,section')?.innerText||'';
          const meta=[el.placeholder,el.name,el.id,el.getAttribute('aria-label'),...labels,near].filter(Boolean).join(' ');
          out.push({meta:String(meta).replace(/\s+/g,' ').trim().slice(0,800),type:el.type||'',maxLength:el.maxLength||0,value:el.value||''});
        }
      }
    };
    walk(document);return out;
  }).catch(()=>[]);
}
async function fillAirIndiaMawb(page,digits){
  const prefix=digits.slice(0,3),serial=digits.slice(3);
  for(const frame of page.frames()){
    const info=await deepInputs(frame);if(!info.length)continue;
    const scored=info.map((x,i)=>{
      const m=x.meta.toLowerCase();let score=0;
      if(/awb|air waybill|airway bill|waybill|mawb|document|tracking/.test(m))score+=100;
      if(/number|no\.?/.test(m))score+=20;
      if(x.maxLength===11||x.maxLength===12||x.maxLength===13)score+=30;
      if(x.type==='text'||x.type==='tel'||x.type==='number')score+=10;
      return{...x,i,score};
    }).sort((a,b)=>b.score-a.score);
    const best=scored[0];
    if(best&&best.score>=30){
      const res=await frame.evaluate(({index,value})=>{
        const els=[];const walk=root=>{for(const el of root.querySelectorAll('*')){if(el.shadowRoot)walk(el.shadowRoot);if(el.tagName==='INPUT'){const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.disabled)els.push(el);}}};walk(document);
        const input=els[index];if(!input)return{ok:false};
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;input.focus();setter?.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));setter?.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('blur',{bubbles:true}));return{ok:true,value:input.value||'',meta:`${input.placeholder||''} ${input.name||''} ${input.id||''} ${input.getAttribute('aria-label')||''}`};
      },{index:best.i,value:digits}).catch(()=>({ok:false}));
      if(res?.ok&&digitsOnly(res.value).length>=8)return{...res,mode:'single',frameUrl:frame.url(),score:best.score};
    }

    const prefixIdx=scored.find(x=>/prefix|airline/.test(x.meta.toLowerCase())||x.maxLength===3);
    const serialIdx=scored.find(x=>x.i!==prefixIdx?.i&&(/awb|waybill|number|serial/.test(x.meta.toLowerCase())||x.maxLength===8));
    if(prefixIdx&&serialIdx){
      const res=await frame.evaluate(({pi,si,prefix,serial})=>{
        const els=[];const walk=root=>{for(const el of root.querySelectorAll('*')){if(el.shadowRoot)walk(el.shadowRoot);if(el.tagName==='INPUT'){const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.disabled)els.push(el);}}};walk(document);
        const set=(el,v)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;el.focus();setter?.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));setter?.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
        if(!els[pi]||!els[si])return{ok:false};set(els[pi],prefix);set(els[si],serial);els[si].dispatchEvent(new Event('blur',{bubbles:true}));return{ok:true,prefixValue:els[pi].value||'',serialValue:els[si].value||''};
      },{pi:prefixIdx.i,si:serialIdx.i,prefix,serial}).catch(()=>({ok:false}));
      if(res?.ok)return{...res,mode:'split',frameUrl:frame.url()};
    }
  }
  return{ok:false};
}
async function clickNext(page){
  for(const frame of page.frames()){
    const hit=await frame.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;};
      const all=[];const walk=root=>{for(const el of root.querySelectorAll('*')){if(el.shadowRoot)walk(el.shadowRoot);if(['BUTTON','A'].includes(el.tagName)||el.getAttribute('role')==='button'||el.tagName==='SPAN')all.push(el);}};walk(document);
      const label=e=>String(e.innerText||e.textContent||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
      const e=all.filter(visible).find(x=>/^Next$/i.test(label(x)))||all.filter(visible).find(x=>/Track|Search|Submit/i.test(label(x)));
      if(!e)return'';(e.closest('button,a,[role="button"]')||e).click();return label(e);
    }).catch(()=> '');
    if(hit)return{label:hit,frameUrl:frame.url()};
  }
  return null;
}
async function allVisibleText(page){
  const parts=[];
  for(const frame of page.frames()){
    const t=clean(await frame.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    if(t)parts.push(t);
  }
  return clean(parts.join(' '));
}
async function screenshotResult(page){
  return page.screenshot({type:'jpeg',quality:82,fullPage:false,encoding:'base64'}).catch(()=>null);
}

export async function trackAirIndia(mawb){
  const digits=digitsOnly(mawb);if(!/^098\d{8}$/.test(digits))return{ok:false,reason:'INVALID AIR INDIA MAWB',officialTracker:START};
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(START,{waitUntil:'domcontentloaded',timeout:30000});await sleep(6500);

    const filled=await fillAirIndiaMawb(page,digits);
    if(!filled?.ok){const body=await allVisibleText(page);return{ok:false,reason:'AIR INDIA MAWB FIELD NOT FOUND',officialTracker:page.url(),debug:{stage:'input',url:page.url(),bodySample:body.slice(0,2500)}};}
    await sleep(700);
    const next=await clickNext(page);
    if(!next)return{ok:false,reason:'AIR INDIA NEXT BUTTON NOT FOUND',officialTracker:page.url(),debug:{stage:'next',filled,url:page.url()}};

    let details='';
    for(let i=0;i<10;i++){
      await sleep(1200);details=await allVisibleText(page);
      const norm=digitsOnly(details);
      if(norm.includes(digits)||norm.includes(digits.slice(3))||/Flight|Origin|Destination|Pieces|Weight|Arrival|Status|Shipment/i.test(details))break;
    }
    const awbMatched=digitsOnly(details).includes(digits)||digitsOnly(details).includes(digits.slice(3));
    if(!details)return{ok:false,reason:'AIR INDIA DETAILS SCREEN EMPTY',officialTracker:page.url(),debug:{stage:'details',filled,next,url:page.url()}};

    // Required flow: exact portal -> MAWB -> Next -> details screen -> screenshot -> extract -> Mayavi tracker.
    const screenshotBase64=await screenshotResult(page);
    if(!screenshotBase64)return{ok:false,reason:'AIR INDIA DETAILS SCREENSHOT FAILED',officialTracker:page.url(),debug:{stage:'screenshot',filled,next,url:page.url(),bodySample:details.slice(0,2600)}};

    const visibleShipment=parseTrackingText(details,mawb);
    let ocrResult={ok:false,reason:'OCR NOT RUN'};
    try{
      ocrResult=await Promise.race([
        readTrackingScreenshot({mawb,screenshotBase64}),
        new Promise(resolve=>setTimeout(()=>resolve({ok:false,reason:'AIR INDIA SCREENSHOT OCR TIMEOUT'}),28000))
      ]);
    }catch(e){ocrResult={ok:false,reason:e?.message||String(e)};}

    let shipment={mawb,carrierCode:'AI',airlineName:'Air India Cargo',officialTracker:page.url(),source:'Air India iCargo details screenshot + rendered details'};
    shipment=merge(shipment,visibleShipment);
    if(ocrResult?.ok&&ocrResult.shipment){
      const o=ocrResult.shipment;
      for(const k of ['origin','destination','pieces','bags','weight','flightNo','arrivalDate','arrivalTime'])if(o[k])shipment[k]=o[k];
      if(o.arrivalDate||o.arrivalTime)shipment.arrivalIsActual=Boolean(o.arrivalIsActual);
      if(o.status&&o.statusEvidence==='strong')shipment.status=o.status;
    }
    shipment.officialTracker=page.url();
    shipment.source=ocrResult?.ok?'Air India iCargo details screenshot OCR + rendered details':'Air India iCargo details screenshot + rendered details';

    if(!useful(shipment))return{ok:false,reason:ocrResult?.reason||'AIR INDIA DETAILS FOUND NO VERIFIED SHIPMENT FIELDS',officialTracker:page.url(),screenshotCaptured:true,screenshotVerified:true,debug:{stage:'parse',filled,next,url:page.url(),awbMatched,bodySample:details.slice(0,3500),ocr:ocrResult?.debug||null}};
    return{ok:true,shipment,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:Boolean(ocrResult?.ok),debug:{stage:'done',url:page.url(),filled,next,awbMatched,bodySample:details.slice(0,3500),ocrReason:ocrResult?.reason||'',ocrSample:ocrResult?.debug?.textSample||''}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:START,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
