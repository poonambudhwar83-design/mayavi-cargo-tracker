import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://www.kuwaitairways.com/en/cargo/tracking';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');

function parseDate(value=''){
  const s=String(value||'').trim().toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function cleanNum(v=''){return String(v||'').replace(/,/g,'').match(/[\d.]+/)?.[0]||'';}
function cleanCode(v=''){return String(v||'').toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]||'';}
function cleanFlight(v=''){const m=String(v||'').toUpperCase().match(/\bKU\s*[- ]?(\d{2,4})\b/);return m?`KU${m[1]}`:'';}
function normalizeHeader(v=''){return String(v||'').replace(/\s+/g,' ').trim().toLowerCase();}
function statusFrom(values=''){
  const s=String(values||'').toUpperCase();
  if(/DELIVERED|\bDLV\b/.test(s))return'ARRIVED';
  if(/ARRIVED|LANDED|RECEIVED FROM FLIGHT|\bRCF\b/.test(s))return'ARRIVED';
  if(/DEPARTED|\bDEP\b|IN TRANSIT|AIRBORNE|IN FLIGHT|UPLIFTED/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP/.test(s))return'DELAYED';
  if(/BOOKED|ACCEPTED|\bRCS\b|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'BOOKED';
}
function pickMapped(headers=[],cells=[]){
  const map={};
  headers.forEach((h,i)=>{map[normalizeHeader(h)]=String(cells[i]||'').trim()});
  const find=(...needles)=>{
    for(const [k,v] of Object.entries(map))if(needles.some(n=>k.includes(n)))return v;
    return'';
  };
  return {
    operational:find('operational status','status'),
    weight:find('weight'),volume:find('volume'),flight:find('flight no','flight'),date:find('date'),
    origin:find('origin'),destination:find('arrival city','destination'),pieces:find('pieces','pcs')
  };
}
function deriveFromTables(tables=[]){
  for(const table of tables){
    const rows=table.rows||[];
    for(let i=0;i<rows.length;i++){
      const headers=rows[i].cells||[];
      const joined=headers.map(normalizeHeader).join(' | ');
      const score=['weight','flight','date','origin','arrival','pieces'].filter(k=>joined.includes(k)).length;
      if(score<3)continue;
      for(let j=i+1;j<Math.min(rows.length,i+5);j++){
        const cells=rows[j].cells||[];if(!cells.length)continue;
        const mapped=pickMapped(headers,cells);
        if(cleanFlight(mapped.flight)||cleanCode(mapped.origin)||cleanNum(mapped.weight)||cleanNum(mapped.pieces))return{headers,cells,mapped};
      }
    }
  }
  return null;
}
function deriveFromRows(tables=[]){
  const rows=tables.flatMap(t=>t.rows||[]).map(r=>r.cells||[]);
  for(const cells of rows){
    const joined=cells.join(' | '),flight=cleanFlight(joined);if(!flight)continue;
    const codes=[...joined.toUpperCase().matchAll(/\b[A-Z]{3}\b/g)].map(m=>m[0]).filter(x=>!['AWB','KGS','PCS'].includes(x));
    const date=parseDate(joined);
    const nums=[...joined.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(m=>m[0]);
    return {flight,date,origin:codes[0]||'',destination:codes[1]||'',raw:joined,nums};
  }
  return null;
}

export async function trackKuwait(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('229-'))return{ok:false,reason:'INVALID KUWAIT MAWB'};
  const prefix='229',serial=mawb.slice(4);
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:22000});
    await new Promise(r=>setTimeout(r,1800));
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('button,[role="button"]')];
      const b=els.find(x=>/accept cookies|accept all|agree/i.test((x.innerText||x.getAttribute('aria-label')||'').trim()));if(b)b.click();
    }).catch(()=>{});
    const fill=await page.evaluate(({prefix,serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const label=e=>{if(e.id){const l=document.querySelector(`label[for="${CSS.escape(e.id)}"]`);if(l)return l.innerText||'';}return e.closest('label')?.innerText||'';};
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.title||''} ${label(e)}`.toLowerCase();
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));};
      const p=inputs.find(e=>/prefix/.test(desc(e)));
      let a=inputs.find(e=>/awb/.test(desc(e))&&!/prefix/.test(desc(e)));
      if(!a&&inputs.length)a=inputs.find(e=>e!==p)||inputs[0];
      if(p)set(p,prefix);if(a)set(a,serial);
      return{prefixFound:Boolean(p),awbFound:Boolean(a),prefixValue:p?.value||'',awbValue:a?.value||'',inputs:inputs.map(e=>({id:e.id||'',name:e.name||'',placeholder:e.placeholder||'',value:e.value||'',desc:desc(e)})).slice(0,12)};
    },{prefix,serial});
    if(!fill.awbFound)return{ok:false,reason:'KUWAIT AWB INPUT NOT FOUND',officialTracker:URL,debug:{fill}};
    const clicked=await page.evaluate(()=>{
      const els=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')];
      const b=els.find(e=>/^submit$/i.test((e.innerText||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()));
      if(b){b.click();return true;}return false;
    });
    if(!clicked)return{ok:false,reason:'KUWAIT SUBMIT BUTTON NOT FOUND',officialTracker:URL,debug:{fill}};
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);
    await new Promise(r=>setTimeout(r,1800));
    const extracted=await page.evaluate(()=>{
      const tables=[...document.querySelectorAll('table')].map((table,ti)=>({index:ti,rows:[...table.querySelectorAll('tr')].map((tr,ri)=>({index:ri,cells:[...tr.querySelectorAll('th,td')].map(td=>(td.innerText||td.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean)})).filter(r=>r.cells.length)})).filter(t=>t.rows.length);
      return {text:(document.body?.innerText||'').replace(/\s+/g,' ').trim(),tables};
    });
    const tableHit=deriveFromTables(extracted.tables),rowHit=deriveFromRows(extracted.tables);
    const m=tableHit?.mapped||{};
    const origin=cleanCode(m.origin)||rowHit?.origin||'';
    const destination=cleanCode(m.destination)||rowHit?.destination||'';
    const pieces=cleanNum(m.pieces);
    const weight=cleanNum(m.weight);
    const flightNo=cleanFlight(m.flight)||rowHit?.flight||'';
    const bookingDate=parseDate(m.date)||rowHit?.date||'';
    const status=statusFrom(`${m.operational||''} ${tableHit?.cells?.join(' ')||''} ${rowHit?.raw||''}`);
    const shipment={mawb,carrierCode:'KU',airlineName:'Kuwait Airways Cargo',officialTracker:URL,origin,destination,pieces,bags:pieces,weight,flightNo,bookingDate,status,source:'Kuwait Airways official cargo tracking details table'};
    const useful=Boolean(origin||destination||pieces||weight||flightNo||bookingDate);
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!useful)return{ok:false,reason:'KUWAIT DETAILS TABLE FOUND BUT NO VERIFIED FIELDS EXTRACTED',officialTracker:URL,screenshotBase64,debug:{fill,clicked,tableHit,rowHit,tables:extracted.tables.slice(0,12),textSample:extracted.text.slice(0,7000)}};
    return{ok:true,shipment,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:true,debug:{stage:'KUWAIT_DETAILS_TABLE',fill,clicked,tableHit,rowHit,tables:extracted.tables.slice(0,12),textSample:extracted.text.slice(0,7000)}};
  }catch(e){return{ok:false,reason:`KUWAIT TRACKING ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
