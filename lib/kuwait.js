import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const CARGO_URL='https://www.kuwaitairways.com/en/cargo/tracking';
const FLIGHTAWARE_FLEET_URL='https://www.flightaware.com/live/fleet/KAC';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const DAY='MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY';
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
  const m=String(date||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return'';
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+days));
  return`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}
function time24(value=''){
  const m=String(value||'').match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);if(!m)return'';
  let h=Number(m[1]);if(m[3].toUpperCase()==='AM'&&h===12)h=0;if(m[3].toUpperCase()==='PM'&&h<12)h+=12;
  return`${pad(h)}:${m[2]}`;
}
function cleanNum(v=''){return String(v||'').replace(/,/g,'').match(/[\d.]+/)?.[0]||'';}
function cleanCode(v=''){return String(v||'').toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]||'';}
function airportCode(v=''){
  const s=String(v||'').toUpperCase();
  return s.match(/\(([A-Z]{3})\s*\/\s*[A-Z0-9]{4}\)/)?.[1]||s.match(/\b([A-Z]{3})\s*\/\s*[A-Z0-9]{4}\b/)?.[1]||'';
}
function cleanFlight(v=''){const m=String(v||'').toUpperCase().match(/\bKU\s*[- ]?(\d{2,4})\b/);return m?`KU${m[1]}`:'';}
function piecesFrom(v=''){return String(v||'').match(/\b(\d{1,6})\s+PIECES?\b/i)?.[1]||'';}
function weightFrom(v=''){return String(v||'').match(/\b([\d,.]+)\s*KGS?\b/i)?.[1]?.replace(/,/g,'')||'';}
function normalizeHeader(v=''){return String(v||'').replace(/\s+/g,' ').trim().toLowerCase();}
function cargoStatus(values=''){
  const s=String(values||'').toUpperCase();
  if(/DELIVERED|\bDLV\b|ARRIVED|LANDED|RECEIVED FROM FLIGHT|\bRCF\b/.test(s))return'ARRIVED';
  if(/DEPARTED|\bDEP\b|IN TRANSIT|AIRBORNE|IN FLIGHT|UPLIFTED/.test(s))return'IN TRANSIT';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP/.test(s))return'DELAYED';
  return'BOOKED';
}
function flightAwareStatus(values=''){
  const s=String(values||'').toUpperCase();
  if(/\bLANDED\b|\bARRIVED\b|ARRIVAL COMPLETE|AT DESTINATION/.test(s))return'ARRIVED';
  if(/\bIN AIR\b|\bEN ROUTE\b|\bAIRBORNE\b|\bDEPARTED\b|\bIN FLIGHT\b|TOOK OFF|LEFT .*? AGO/.test(s))return'IN TRANSIT';
  if(/\bDELAYED\b|CANCELLED|CANCELED/.test(s))return'DELAYED';
  if(/EXPECTED TO DEPART|SCHEDULED|AT ORIGIN|BOARDING|DEPARTURE SCHEDULED/.test(s))return'BOOKED';
  return'';
}
function pickMapped(headers=[],cells=[]){
  const map={};headers.forEach((h,i)=>{map[normalizeHeader(h)]=String(cells[i]||'').trim()});
  const find=(...needles)=>{for(const [k,v] of Object.entries(map))if(needles.some(n=>k.includes(n)))return v;return'';};
  return{weight:find('weight'),flight:find('flight no','flight'),date:find('date'),origin:find('origin'),pieces:find('pieces','pcs')};
}
function deriveFromTables(tables=[]){
  for(const table of tables){
    const rows=table.rows||[];
    for(let i=0;i<rows.length;i++){
      const headers=rows[i].cells||[],joined=headers.map(normalizeHeader).join(' | ');
      const score=['weight','flight','date','origin','pieces'].filter(k=>joined.includes(k)).length;if(score<3)continue;
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
    return rows.slice(1).map(r=>({
      code:String(r.cells?.[0]||'').trim().toUpperCase(),
      airport:cleanCode(r.cells?.[1]||''),
      dateText:String(r.cells?.[2]||'').trim(),
      details:String(r.cells?.[3]||'').trim()
    }));
  }
  return[];
}
function deriveFromRows(tables=[]){
  for(const cells of tables.flatMap(t=>t.rows||[]).map(r=>r.cells||[])){
    const raw=cells.join(' | '),flight=cleanFlight(raw);if(!flight)continue;
    return{flight,date:parseDate(raw),raw,pieces:piecesFrom(raw),weight:weightFrom(raw)};
  }
  return null;
}
async function acceptCookies(page){
  await page.evaluate(()=>{
    const text=e=>(e?.innerText||e?.value||e?.getAttribute?.('aria-label')||'').trim();
    const b=[...document.querySelectorAll('button,[role="button"],a')].find(x=>/accept cookies|accept all|agree|allow all/i.test(text(x)));if(b)b.click();
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
function parseLivePanel(extracted={},flightNo=''){
  const panel=extracted.panelText||extracted.pageText||'',upper=panel.toUpperCase();
  const uniqueAirports=[];
  for(const a of extracted.airportLinks||[]){
    if(a.iata&&!uniqueAirports.includes(a.iata)&&!['KAC','KUW','IST','EDT','UTC'].includes(a.iata))uniqueAirports.push(a.iata);
  }
  let origin=uniqueAirports[0]||'',destination=uniqueAirports[1]||'';
  if(!origin||!destination){
    const codes=[...upper.matchAll(/\b([A-Z]{3})\b/g)].map(m=>m[1]).filter(c=>!['KAC','KUW','IST','EDT','UTC','AM','PM'].includes(c));
    const uniq=[...new Set(codes)];if(!origin)origin=uniq[0]||'';if(!destination)destination=uniq.find(c=>c!==origin)||'';
  }
  const dateRx=new RegExp(`\\b(?:${DAY})\\s+(\\d{1,2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(20\\d{2})\\b`,'gi');
  const dates=[...panel.matchAll(dateRx)].map(m=>`${m[3]}-${MONTH[m[2].toUpperCase()]}-${pad(m[1])}`);
  const times=[...panel.matchAll(/\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/gi)].map(m=>time24(m[1])).filter(Boolean);
  const departureDate=dates[0]||'',arrivalDate=dates[1]||dates[0]||'';
  const departureTime=times[0]||'',arrivalTime=times[1]||times[0]||'';
  const status=flightAwareStatus(panel)||flightAwareStatus(extracted.pageText);
  return{
    ok:Boolean(destination||arrivalDate||arrivalTime||status),
    destination,flightOrigin:origin,departureDate,departureTime,arrivalDate,arrivalTime,
    arrivalIsActual:status==='ARRIVED',status,url:extracted.url,panelSample:panel.slice(0,4500),flightNo
  };
}
async function exactHistoryForDate(page,kac,flightDate=''){
  if(!flightDate)return{ok:false,reason:'NO CARGO FLIGHT DATE'};
  const historyUrl=`https://www.flightaware.com/live/flight/${kac}/history`;
  await page.goto(historyUrl,{waitUntil:'domcontentloaded',timeout:22000});
  await new Promise(r=>setTimeout(r,1600));
  await acceptCookies(page);
  const tables=await page.evaluate(()=>{
    const clean=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
    return[...document.querySelectorAll('table')].map(table=>({rows:[...table.querySelectorAll('tr')].map(tr=>({cells:[...tr.querySelectorAll('th,td')].map(clean)})).filter(r=>r.cells.length)})).filter(t=>t.rows.length);
  });
  for(const table of tables){
    const rows=table.rows||[];
    for(let h=0;h<rows.length;h++){
      const headers=(rows[h].cells||[]).map(normalizeHeader);
      const dateI=headers.findIndex(x=>x==='date'||x.includes('date'));
      const originI=headers.findIndex(x=>x.includes('origin'));
      const destI=headers.findIndex(x=>x.includes('destination'));
      const depI=headers.findIndex(x=>x.includes('departure'));
      const arrI=headers.findIndex(x=>x.includes('arrival'));
      if(Math.min(dateI,originI,destI,depI,arrI)<0)continue;
      for(let r=h+1;r<rows.length;r++){
        const cells=rows[r].cells||[];
        if(parseDate(cells[dateI]||'')!==flightDate)continue;
        const origin=airportCode(cells[originI]||'');
        const destination=airportCode(cells[destI]||'');
        const departureText=String(cells[depI]||'');
        const arrivalText=String(cells[arrI]||'');
        const departureTime=time24(departureText);
        const arrivalTime=time24(arrivalText);
        const offset=Number(arrivalText.match(/\(\+(\d+)\)/)?.[1]||0);
        const arrivalDate=addDays(flightDate,offset);
        const rowText=cells.join(' | ');
        let status='BOOKED';
        if(/CANCELLED|CANCELED|DELAYED/i.test(rowText))status='DELAYED';
        else if(/SCHEDULED/i.test(rowText))status='BOOKED';
        else if(departureTime&&arrivalTime)status='ARRIVED';
        else if(departureTime)status='IN TRANSIT';
        return{
          ok:true,matchedFlightDate:true,source:'FlightAware exact-date history',
          flightOrigin:origin,destination,departureDate:flightDate,departureTime,
          arrivalDate,arrivalTime,status,arrivalIsActual:status==='ARRIVED',
          url:historyUrl,historyRow:rowText
        };
      }
    }
  }
  return{ok:false,matchedFlightDate:false,reason:`NO FLIGHTAWARE HISTORY ROW FOR ${flightDate}`,url:historyUrl};
}
async function lookupFlightAware(browser,flightNo='',flightDate=''){
  if(!flightNo)return{ok:false,reason:'NO FLIGHT NUMBER'};
  const page=await browser.newPage(),number=String(flightNo).replace(/^KU/i,''),kac=`KAC${number}`;
  try{
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(FLIGHTAWARE_FLEET_URL,{waitUntil:'domcontentloaded',timeout:22000});
    await new Promise(r=>setTimeout(r,1300));
    await acceptCookies(page);
    const setup=await page.evaluate(({flightNo})=>{
      const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>10&&r.height>8&&!e.disabled};
      const text=e=>(e?.innerText||e?.textContent||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
      const button=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')].find(e=>visible(e)&&/^track flight$/i.test(text(e)));
      if(!button)return{clicked:false,reason:'TRACK FLIGHT BUTTON NOT FOUND'};
      let scope=button.closest('form')||button.parentElement||document.body;
      for(let i=0;i<4&&scope&&![...scope.querySelectorAll('input')].some(visible);i++)scope=scope.parentElement;
      const inputs=[...(scope||document).querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const br=button.getBoundingClientRect();
      const input=[...inputs].sort((a,b)=>{const ar=a.getBoundingClientRect(),cr=b.getBoundingClientRect();return Math.hypot(ar.x-br.x,ar.y-br.y)-Math.hypot(cr.x-br.x,cr.y-br.y)})[0]||null;
      if(!input)return{clicked:false,reason:'FLIGHT INPUT NOT FOUND'};
      const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(input,flightNo);
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      button.click();return{clicked:true,value:input.value||'',button:text(button)};
    },{flightNo});
    await Promise.race([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:9000}).catch(()=>{}),new Promise(r=>setTimeout(r,7000))]);
    if(!/\/live\/flight\//i.test(page.url()))await page.goto(`https://www.flightaware.com/live/flight/${kac}`,{waitUntil:'domcontentloaded',timeout:22000});
    await new Promise(r=>setTimeout(r,1600));
    const extracted=await page.evaluate(({kac,flightNo})=>{
      const clean=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
      const marker=[...document.querySelectorAll('body *')].find(e=>{const t=clean(e).toUpperCase();return t.includes(kac)&&t.includes(String(flightNo).toUpperCase())&&t.length<180;});
      let panel=marker||document.body;
      for(let i=0;i<8&&panel?.parentElement;i++){const t=clean(panel);if(/departing from/i.test(t)&&/arriving at/i.test(t)&&t.length<5000)break;panel=panel.parentElement;}
      const panelText=clean(panel),pageText=clean(document.body);
      const airportLinks=[...(panel||document).querySelectorAll('a')].map(a=>clean(a)).map(t=>({text:t,iata:(t.match(/(?:-|\(|\b)([A-Z]{3})(?:\)|\b)\s*$/)||[])[1]||''})).filter(x=>x.iata);
      return{panelText,pageText:pageText.slice(0,12000),airportLinks,url:location.href};
    },{kac,flightNo});
    const live=parseLivePanel(extracted,flightNo);
    const history=await exactHistoryForDate(page,kac,flightDate).catch(e=>({ok:false,reason:e?.message||String(e)}));
    if(history.ok)return{...history,setup,livePage:live};
    if(live.ok&&(!flightDate||live.departureDate===flightDate))return{...live,setup,matchedFlightDate:true,source:'FlightAware live exact-date flight'};
    return{
      ok:false,reason:`FLIGHTAWARE FLIGHT NUMBER MATCHED BUT DATE DID NOT MATCH CARGO FLIGHT DATE ${flightDate||''}`,
      setup,livePage:live,history
    };
  }catch(e){return{ok:false,reason:`FLIGHTAWARE ERROR: ${e?.message||e}`,url:page.url()};}
  finally{try{await page.close()}catch{}}
}

export async function trackKuwait(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('229-'))return{ok:false,reason:'INVALID KUWAIT MAWB'};
  const prefix='229',serial=mawb.slice(4);let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(CARGO_URL,{waitUntil:'domcontentloaded',timeout:22000});
    await new Promise(r=>setTimeout(r,1500));
    await acceptCookies(page);
    const fill=await page.evaluate(({prefix,serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
      const set=(e,v)=>{if(!e)return;const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));};
      const p=inputs.find(e=>/prefix/.test(desc(e)));
      let a=inputs.find(e=>/awb/.test(desc(e))&&!/prefix/.test(desc(e)));if(!a)a=inputs.find(e=>e!==p)||inputs[0];
      set(p,prefix);set(a,serial);
      return{prefixFound:Boolean(p),awbFound:Boolean(a),prefixValue:p?.value||'',awbValue:a?.value||''};
    },{prefix,serial});
    if(!fill.awbFound)return{ok:false,reason:'KUWAIT AWB INPUT NOT FOUND',officialTracker:CARGO_URL,debug:{fill}};
    const clicked=await page.evaluate(()=>{
      const text=e=>(e?.innerText||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
      const b=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')].find(e=>/^submit$/i.test(text(e)));if(b){b.click();return true;}return false;
    });
    if(!clicked)return{ok:false,reason:'KUWAIT SUBMIT BUTTON NOT FOUND',officialTracker:CARGO_URL,debug:{fill}};
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:10000}).catch(()=>{}),new Promise(r=>setTimeout(r,9000))]);
    await new Promise(r=>setTimeout(r,1300));
    const extracted=await page.evaluate(()=>{
      const tables=[...document.querySelectorAll('table')].map((table,ti)=>({
        index:ti,
        rows:[...table.querySelectorAll('tr')].map((tr,ri)=>({index:ri,cells:[...tr.querySelectorAll('th,td')].map(td=>(td.innerText||td.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean)})).filter(r=>r.cells.length)
      })).filter(t=>t.rows.length);
      return{text:(document.body?.innerText||'').replace(/\s+/g,' ').trim(),tables};
    });
    const tableHit=deriveFromTables(extracted.tables),ops=operationalRows(extracted.tables),rowHit=deriveFromRows(extracted.tables);
    const rcs=ops.find(r=>r.code==='RCS')||{};
    const pre=ops.find(r=>r.code==='PRE')||ops.find(r=>r.code==='DEP')||ops[0]||{};
    const latest=ops[0]||{};
    const m=tableHit?.mapped||{};
    const detailSource=pre.details||latest.details||rcs.details||rowHit?.raw||'';
    const origin=rcs.airport||pre.airport||latest.airport||cleanCode(m.origin)||'';
    const pieces=cleanNum(m.pieces)||piecesFrom(detailSource)||rowHit?.pieces||'';
    const weight=cleanNum(m.weight)||weightFrom(detailSource)||rowHit?.weight||'';
    const flightNo=cleanFlight(m.flight)||cleanFlight(detailSource)||rowHit?.flight||'';
    const bookingDate=parseDate(rcs.dateText)||parseDate(m.date)||rowHit?.date||'';
    const flightDate=parseDate(pre.dateText)||rowHit?.date||bookingDate;
    const flightLookup=flightNo?await lookupFlightAware(browser,flightNo,flightDate):{ok:false,reason:'NO FLIGHT NUMBER FROM CARGO DETAILS'};
    const status=flightLookup.status||cargoStatus(`${latest.code} ${latest.details||''}`);
    const shipment={
      mawb,carrierCode:'KU',airlineName:'Kuwait Airways Cargo',officialTracker:CARGO_URL,
      origin,pieces,bags:pieces,weight,flightNo,bookingDate,
      destination:flightLookup.destination||'',arrivalDate:flightLookup.arrivalDate||'',arrivalTime:flightLookup.arrivalTime||'',
      arrivalIsActual:Boolean(flightLookup.arrivalIsActual),status,
      source:flightLookup.ok?'Kuwait Airways cargo Details + FlightAware exact flight-date status':'Kuwait Airways cargo Details'
    };
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    const useful=Boolean(origin||pieces||weight||flightNo||bookingDate||shipment.destination||shipment.arrivalDate||shipment.arrivalTime);
    if(!useful)return{ok:false,reason:'KUWAIT TWO-LINK FLOW RETURNED NO VERIFIED FIELDS',officialTracker:CARGO_URL,screenshotBase64,debug:{fill,clicked,ops,rowHit,flightDate,flightLookup,textSample:extracted.text.slice(0,6000)}};
    return{
      ok:true,shipment,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:true,
      debug:{stage:'KUWAIT_CARGO_PLUS_FLIGHTAWARE_EXACT_DATE',fill,clicked,ops,rowHit,flightDate,flightLookup,textSample:extracted.text.slice(0,6000)}
    };
  }catch(e){return{ok:false,reason:`KUWAIT TRACKING ERROR: ${e?.message||e}`,officialTracker:CARGO_URL,debug:{stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
