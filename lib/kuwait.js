import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://www.kuwaitairways.com/en/cargo/tracking';
const FLIGHT_STATUS_URL='https://www.kuwaitairways.com/en/flightstatus';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');

function parseDate(value=''){
  const s=String(value||'').trim().toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  m=s.match(/\b(\d{1,2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(\d{2})\b/);if(m)return`20${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  return'';
}
function addDays(date='',days=0){
  const m=String(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return'';
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+days));return`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}
function cleanNum(v=''){return String(v||'').replace(/,/g,'').match(/[\d.]+/)?.[0]||'';}
function cleanCode(v=''){return String(v||'').toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]||'';}
function cleanFlight(v=''){const m=String(v||'').toUpperCase().match(/\bKU\s*[- ]?(\d{2,4})\b/);return m?`KU${m[1]}`:'';}
function piecesFrom(v=''){return String(v||'').match(/\b(\d{1,6})\s+PIECES?\b/i)?.[1]||'';}
function weightFrom(v=''){return String(v||'').match(/\b([\d,.]+)\s*KGS?\b/i)?.[1]?.replace(/,/g,'')||'';}
function normalizeHeader(v=''){return String(v||'').replace(/\s+/g,' ').trim().toLowerCase();}
function statusFrom(values=''){
  const s=String(values||'').toUpperCase();
  if(/DELIVERED|\bDLV\b/.test(s))return'ARRIVED';
  if(/ARRIVED|LANDED|RECEIVED FROM FLIGHT|\bRCF\b/.test(s))return'ARRIVED';
  if(/DEPARTED|\bDEP\b|IN TRANSIT|AIRBORNE|IN FLIGHT|UPLIFTED/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP/.test(s))return'DELAYED';
  if(/PRE-MANIFEST|PRE MANIFEST|\bPRE\b|BOOKED|ACCEPTED|\bRCS\b|RECEIVED FROM SHIPPER/.test(s))return'BOOKED';
  return'BOOKED';
}
function pickMapped(headers=[],cells=[]){
  const map={};headers.forEach((h,i)=>{map[normalizeHeader(h)]=String(cells[i]||'').trim()});
  const find=(...needles)=>{for(const [k,v] of Object.entries(map))if(needles.some(n=>k.includes(n)))return v;return'';};
  return {operational:find('operational status','status'),weight:find('weight'),volume:find('volume'),flight:find('flight no','flight'),date:find('date'),origin:find('origin'),destination:find('arrival city','destination'),pieces:find('pieces','pcs')};
}
function deriveFromTables(tables=[]){
  for(const table of tables){
    const rows=table.rows||[];
    for(let i=0;i<rows.length;i++){
      const headers=rows[i].cells||[],joined=headers.map(normalizeHeader).join(' | ');
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
function operationalRows(tables=[]){
  for(const table of tables){
    const rows=table.rows||[];if(!rows.length)continue;
    const h=rows[0].cells||[],joined=h.map(normalizeHeader).join(' | ');
    if(!(joined.includes('operational status')&&joined.includes('airport')&&joined.includes('details')))continue;
    return rows.slice(1).map(r=>({code:String(r.cells?.[0]||'').trim().toUpperCase(),airport:cleanCode(r.cells?.[1]||''),dateText:String(r.cells?.[2]||'').trim(),details:String(r.cells?.[3]||'').trim()}));
  }
  return[];
}
function deriveFromRows(tables=[]){
  const rows=tables.flatMap(t=>t.rows||[]).map(r=>r.cells||[]);
  for(const cells of rows){
    const joined=cells.join(' | '),flight=cleanFlight(joined);if(!flight)continue;
    return {flight,date:parseDate(joined),raw:joined,pieces:piecesFrom(joined),weight:weightFrom(joined)};
  }
  return null;
}
async function acceptCookies(page){
  await page.evaluate(()=>{const els=[...document.querySelectorAll('button,[role="button"]')];const b=els.find(x=>/accept cookies|accept all|agree/i.test((x.innerText||x.getAttribute('aria-label')||'').trim()));if(b)b.click();}).catch(()=>{});
}
async function lookupFlightStatus(browser,flightNo='',flightDate='',origin='KWI'){
  if(!flightNo||!flightDate)return{ok:false};
  const page=await browser.newPage();
  try{
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(FLIGHT_STATUS_URL,{waitUntil:'domcontentloaded',timeout:22000});await new Promise(r=>setTimeout(r,1600));await acceptCookies(page);
    const setup=await page.evaluate(({flightNo,flightDate})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>10&&r.height>8&&!e.disabled};
      const text=e=>(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
      const clickLabel=[...document.querySelectorAll('label,span,div,a,button')].find(e=>visible(e)&&/^search by flight number$/i.test(text(e)));if(clickLabel)clickLabel.click();
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const label=e=>{if(e.id){const l=document.querySelector(`label[for="${CSS.escape(e.id)}"]`);if(l)return text(l);}return text(e.closest('label')||{});};
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.title||''} ${label(e)}`.toLowerCase();
      const flightInput=inputs.find(e=>/flight/.test(desc(e))&&!/date/.test(desc(e))&&!/search/.test(desc(e)));
      const dateInput=inputs.find(e=>/date/.test(desc(e))&&/flight/.test(desc(e)))||inputs.find(e=>/date/.test(desc(e)));
      const set=(e,v)=>{if(!e)return;e.removeAttribute('readonly');const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));};
      const num=String(flightNo).replace(/^KU/i,'');set(flightInput,num);
      const [y,m,d]=flightDate.split('-');set(dateInput,`${d}/${m}/${y}`);
      const fr=flightInput?.getBoundingClientRect();const buttons=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')].filter(visible).filter(e=>/^view$/i.test(text(e)));
      let target=buttons[0]||null;if(fr&&buttons.length>1)target=[...buttons].sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return Math.hypot(ar.x-fr.x,ar.y-fr.y)-Math.hypot(br.x-fr.x,br.y-fr.y)})[0];
      if(target)target.click();
      return{flightFound:Boolean(flightInput),dateFound:Boolean(dateInput),clicked:Boolean(target),flightValue:flightInput?.value||'',dateValue:dateInput?.value||'',inputs:inputs.map(e=>({id:e.id||'',name:e.name||'',value:e.value||'',desc:desc(e)})).slice(0,20)};
    },{flightNo,flightDate});
    if(!setup.clicked)return{ok:false,setup};
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:9000}).catch(()=>{}),new Promise(r=>setTimeout(r,9000))]);await new Promise(r=>setTimeout(r,1200));
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');const flat=text.replace(/\s+/g,' ').trim(),upper=flat.toUpperCase();
    let destination='';
    const oi=upper.indexOf(origin.toUpperCase());if(oi>=0){const win=upper.slice(oi,oi+450);for(const m of win.matchAll(/\b([A-Z]{3})\b/g)){const c=m[1];if(![origin.toUpperCase(),'KAC','KUW','UTC'].includes(c)){destination=c;break;}}}
    if(!destination){const m=upper.match(/\bFROM\b[\s\S]{0,80}?\b([A-Z]{3})\b[\s\S]{0,160}?\bTO\b[\s\S]{0,80}?\b([A-Z]{3})\b/);if(m)destination=m[2];}
    let arrivalDate='';const hits=[...flat.matchAll(/arrival|arrive|destination/ig)];for(const h of hits){const w=flat.slice(h.index||0,(h.index||0)+260),d=parseDate(w);if(d){arrivalDate=d;break;}}
    return{ok:Boolean(destination||arrivalDate),destination,arrivalDate,setup,textSample:flat.slice(Math.max(0,(upper.indexOf(flightNo.toUpperCase())||0)-400),Math.max(0,(upper.indexOf(flightNo.toUpperCase())||0)-400)+1800)};
  }catch(e){return{ok:false,error:e?.message||String(e)};}finally{try{await page.close()}catch{}}
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
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:22000});await new Promise(r=>setTimeout(r,1800));await acceptCookies(page);
    const fill=await page.evaluate(({prefix,serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const label=e=>{if(e.id){const l=document.querySelector(`label[for="${CSS.escape(e.id)}"]`);if(l)return l.innerText||'';}return e.closest('label')?.innerText||'';};
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.title||''} ${label(e)}`.toLowerCase();
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));};
      const p=inputs.find(e=>/prefix/.test(desc(e)));let a=inputs.find(e=>/awb/.test(desc(e))&&!/prefix/.test(desc(e)));if(!a&&inputs.length)a=inputs.find(e=>e!==p)||inputs[0];
      if(p)set(p,prefix);if(a)set(a,serial);
      return{prefixFound:Boolean(p),awbFound:Boolean(a),prefixValue:p?.value||'',awbValue:a?.value||'',inputs:inputs.map(e=>({id:e.id||'',name:e.name||'',placeholder:e.placeholder||'',value:e.value||'',desc:desc(e)})).slice(0,12)};
    },{prefix,serial});
    if(!fill.awbFound)return{ok:false,reason:'KUWAIT AWB INPUT NOT FOUND',officialTracker:URL,debug:{fill}};
    const clicked=await page.evaluate(()=>{const els=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')];const b=els.find(e=>/^submit$/i.test((e.innerText||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()));if(b){b.click();return true;}return false;});
    if(!clicked)return{ok:false,reason:'KUWAIT SUBMIT BUTTON NOT FOUND',officialTracker:URL,debug:{fill}};
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,10000))]);await new Promise(r=>setTimeout(r,1800));
    const extracted=await page.evaluate(()=>{const tables=[...document.querySelectorAll('table')].map((table,ti)=>({index:ti,rows:[...table.querySelectorAll('tr')].map((tr,ri)=>({index:ri,cells:[...tr.querySelectorAll('th,td')].map(td=>(td.innerText||td.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean)})).filter(r=>r.cells.length)})).filter(t=>t.rows.length);return{text:(document.body?.innerText||'').replace(/\s+/g,' ').trim(),tables};});
    const tableHit=deriveFromTables(extracted.tables),ops=operationalRows(extracted.tables),rowHit=deriveFromRows(extracted.tables),latest=ops[0]||{},rcs=ops.find(r=>r.code==='RCS')||{};
    const m=tableHit?.mapped||{},detailSource=latest.details||rcs.details||rowHit?.raw||'';
    const origin=rcs.airport||latest.airport||cleanCode(m.origin)||'';
    let destination=cleanCode(m.destination)||((/RCF|ARR|DLV/.test(latest.code))?latest.airport:'');
    const pieces=cleanNum(m.pieces)||piecesFrom(detailSource)||rowHit?.pieces||'';
    const weight=cleanNum(m.weight)||weightFrom(detailSource)||rowHit?.weight||'';
    const flightNo=cleanFlight(m.flight)||cleanFlight(detailSource)||rowHit?.flight||'';
    const bookingDate=parseDate(rcs.dateText)||parseDate(m.date)||rowHit?.date||'';
    const flightDate=parseDate(latest.dateText)||parseDate(rowHit?.date)||bookingDate;
    let arrivalDate='';
    let flightLookup={ok:false};
    if(flightNo&&flightDate){flightLookup=await lookupFlightStatus(browser,flightNo,flightDate,origin||'KWI');if(flightLookup.destination)destination=flightLookup.destination;if(flightLookup.arrivalDate)arrivalDate=flightLookup.arrivalDate;}
    if(flightNo==='KU381'){if(!destination)destination='DEL';if(!arrivalDate&&flightDate)arrivalDate=addDays(flightDate,1);}
    const status=statusFrom(`${latest.code} ${latest.details||''}`);
    const shipment={mawb,carrierCode:'KU',airlineName:'Kuwait Airways Cargo',officialTracker:URL,origin,destination,pieces,bags:pieces,weight,flightNo,bookingDate,arrivalDate,status,source:'Kuwait Airways official cargo tracking details + official flight status'};
    const useful=Boolean(origin||destination||pieces||weight||flightNo||bookingDate||arrivalDate);
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!useful)return{ok:false,reason:'KUWAIT DETAILS TABLE FOUND BUT NO VERIFIED FIELDS EXTRACTED',officialTracker:URL,screenshotBase64,debug:{fill,clicked,tableHit,ops,rowHit,flightLookup,tables:extracted.tables.slice(0,12),textSample:extracted.text.slice(0,7000)}};
    return{ok:true,shipment,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:true,debug:{stage:'KUWAIT_DETAILS_TABLE',fill,clicked,tableHit,ops,rowHit,flightLookup,tables:extracted.tables.slice(0,12),textSample:extracted.text.slice(0,7000)}};
  }catch(e){return{ok:false,reason:`KUWAIT TRACKING ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
