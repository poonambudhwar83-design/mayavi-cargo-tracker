import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { trackFlightStatusSnapshot } from './flightStatusSnapshot.js';

const OFFICIAL='https://www.maskargo.com/en/home.html';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

function parseDate(v=''){
  const s=String(v||'').toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s\-,]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(\d{1,2})[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  m=s.match(/\b(\d{1,2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(\d{2})\b/);if(m)return`20${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  return'';
}
function parseTime(v=''){
  const s=String(v||'').toUpperCase();
  let m=s.match(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/);
  if(m){let h=Number(m[1]);if(m[3]==='PM'&&h<12)h+=12;if(m[3]==='AM'&&h===12)h=0;return`${pad(h)}:${m[2]}`;}
  m=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';
}
function code(v=''){return String(v||'').toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]||'';}
function flightNo(v=''){const m=String(v||'').toUpperCase().match(/\bMH\s*[- ]?(\d{1,4})\b/);return m?`MH${m[1]}`:'';}
function numeric(v=''){return String(v||'').replace(/,/g,'').match(/[\d.]+/)?.[0]||'';}
function statusFrom(v=''){
  const s=String(v||'').toUpperCase();
  if(/DELIVERED|\bDLV\b/.test(s))return'DELIVERED';
  if(/ARRIVED|RECEIVED FROM FLIGHT|\bRCF\b|LANDED/.test(s))return'ARRIVED';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
  if(/DEPARTED|\bDEP\b|AIRBORNE|IN FLIGHT|IN TRANSIT|UPLIFTED/.test(s))return'IN TRANSIT';
  if(/BOOKED|CONFIRMED|ACCEPTED|RECEIVED FROM SHIPPER|\bRCS\b|MANIFESTED/.test(s))return'BOOKED';
  return'TRACKING';
}
function indexOfHeader(headers,rx){return headers.findIndex(h=>rx.test(String(h||'').toLowerCase()));}
function normalizeHeaders(cells=[]){return cells.map(x=>clean(x).toLowerCase());}

function shipmentDetailsFromTables(tables=[]){
  for(const table of tables){
    const rows=table?.rows||[];if(!rows.length)continue;
    const headers=normalizeHeaders(rows[0]?.cells||[]);
    const oi=indexOfHeader(headers,/^origin$/),di=indexOfHeader(headers,/^destination$/),pi=indexOfHeader(headers,/pieces|pcs/),wi=indexOfHeader(headers,/weight/),si=indexOfHeader(headers,/shipment\s*date|date/),sti=indexOfHeader(headers,/status/);
    if(oi<0||di<0||pi<0||wi<0)continue;
    const r=rows.slice(1).find(x=>(x.cells||[]).length>=Math.max(oi,di,pi,wi)+1);if(!r)continue;
    const c=r.cells||[];
    return{origin:code(c[oi]),destination:code(c[di]),pieces:numeric(c[pi]),weight:numeric(c[wi]),shipmentDate:si>=0?parseDate(c[si]):'',shipmentStatus:sti>=0?clean(c[sti]):''};
  }
  return null;
}
function shipmentDetailsFromText(text=''){
  const flat=clean(text);
  const origin=code((flat.match(/\bOrigin\b\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||'');
  const destination=code((flat.match(/\bDestination\b\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||'');
  const pieces=numeric((flat.match(/\bPieces?\b\s*[:\-]?\s*(\d{1,6})/i)||[])[1]||'');
  const weight=numeric((flat.match(/\bWeight\b\s*[:\-]?\s*([\d,.]+)/i)||[])[1]||'');
  const shipmentDate=parseDate((flat.match(/\bShipment\s*Date\b\s*[:\-]?\s*([^|]{0,40})/i)||[])[1]||'');
  const shipmentStatus=clean((flat.match(/\bStatus\b\s*[:\-]?\s*([A-Za-z ]{2,35})/i)||[])[1]||'');
  return{origin,destination,pieces,weight,shipmentDate,shipmentStatus};
}
function flightRowsFromTables(tables=[]){
  for(const table of tables){
    const rows=table?.rows||[];if(rows.length<2)continue;
    const h=normalizeHeaders(rows[0]?.cells||[]);
    const fi=indexOfHeader(h,/^flight$|flight\s*(no|number)/),fdi=indexOfHeader(h,/flight\s*date|^date$/),odi=indexOfHeader(h,/airport\s*departure|departure\s*airport|^departure$/),oai=indexOfHeader(h,/airport\s*arrival|arrival\s*airport|^arrival$/),pi=indexOfHeader(h,/pieces|pcs/),wi=indexOfHeader(h,/weight/),si=indexOfHeader(h,/status/);
    if(fi<0||fdi<0||odi<0||oai<0)continue;
    const out=[];
    for(const row of rows.slice(1)){
      const c=row.cells||[];if(c.length<Math.max(fi,fdi,odi,oai)+1)continue;
      const f=flightNo(c[fi]);const dep=code(c[odi]),arr=code(c[oai]),date=parseDate(c[fdi]);
      if(!f&&!dep&&!arr&&!date)continue;
      out.push({flightNo:f,flightDate:date,origin:dep,destination:arr,pieces:pi>=0?numeric(c[pi]):'',weight:wi>=0?numeric(c[wi]):'',status:si>=0?clean(c[si]):'',raw:c.map(clean).join(' | ')});
    }
    if(out.length)return out;
  }
  return[];
}
function flightRowsFromText(text=''){
  const flat=clean(text),out=[];
  const rx=/\b(MH\s*[- ]?\d{1,4})\b\s+((?:\d{1,2}[-\/][A-Za-z]{3}[-\/]\d{2,4})|(?:\d{1,2}[-\/]\d{1,2}[-\/]20\d{2})|(?:20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}))\s+([A-Z]{3})\s+([A-Z]{3})\s+(\d{1,6})\s+([\d,.]+)(?:\s+([A-Za-z ]{2,30}))?/ig;
  for(const m of flat.matchAll(rx))out.push({flightNo:flightNo(m[1]),flightDate:parseDate(m[2]),origin:m[3].toUpperCase(),destination:m[4].toUpperCase(),pieces:m[5],weight:m[6].replace(/,/g,''),status:clean(m[7]||''),raw:m[0]});
  return out;
}
function chooseLegs(flights=[],origin='',destination=''){
  const originLeg=flights.find(x=>x.origin===origin)||flights[0]||null;
  const destMatches=destination?flights.filter(x=>x.destination===destination):[];
  const finalLeg=destMatches.at(-1)||flights.at(-1)||null;
  const via=flights.length>1&&originLeg&&finalLeg&&originLeg.destination&&originLeg.destination!==destination?originLeg.destination:'';
  return{originLeg,finalLeg,via};
}
function parseShipment(extracted,mawb){
  const text=extracted?.text||'',serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  const flat=clean(text);
  if(!flat||/NO (?:SHIPMENT|RECORD|AWB).*FOUND|INVALID (?:AWB|AIRWAY)|NO DATA FOUND/i.test(flat))return null;
  if(!(flat.includes(serial)||flat.replace(/\D/g,'').includes(digits)))return null;

  const tableSummary=shipmentDetailsFromTables(extracted.tables)||{};
  const textSummary=shipmentDetailsFromText(flat);
  const summary={...textSummary,...Object.fromEntries(Object.entries(tableSummary).filter(([,v])=>v))};
  let flights=flightRowsFromTables(extracted.tables);if(!flights.length)flights=flightRowsFromText(flat);
  const {originLeg,finalLeg,via}=chooseLegs(flights,summary.origin,summary.destination);

  const origin=summary.origin||originLeg?.origin||'',destination=summary.destination||finalLeg?.destination||'';
  const pieces=summary.pieces||finalLeg?.pieces||originLeg?.pieces||'';
  const weight=summary.weight||finalLeg?.weight||originLeg?.weight||'';
  const bookingDate=summary.shipmentDate||'';
  const flight=finalLeg?.flightNo||originLeg?.flightNo||'';
  const flightDate=finalLeg?.flightDate||originLeg?.flightDate||'';
  const departureDate=originLeg?.flightDate||'';
  const rowStatus=[summary.shipmentStatus,...flights.map(x=>x.status)].filter(Boolean).join(' ');
  let status=statusFrom(rowStatus||flat);

  const actualArrivalBlock=(flat.match(/(?:Actual\s*Arrival|Arrived|Received\s*from\s*Flight|\bRCF\b|Landed)[\s\S]{0,180}/i)||[])[0]||'';
  const actualDepartureBlock=(flat.match(/(?:Actual\s*Departure|Departed|\bDEP\b|Airborne)[\s\S]{0,180}/i)||[])[0]||'';
  let arrivalDate=parseDate(actualArrivalBlock),arrivalTime=parseTime(actualArrivalBlock),arrivalIsActual=Boolean(arrivalDate||arrivalTime);
  const departureTime=parseTime(actualDepartureBlock);
  const departureIsActual=Boolean(departureTime&&/ACTUAL|DEPARTED|\bDEP\b|AIRBORNE/i.test(actualDepartureBlock));

  if(status==='ARRIVED'&&destination&&finalLeg?.destination&&finalLeg.destination!==destination)status='IN TRANSIT';
  const useful=Boolean((origin&&destination)||pieces||weight||flight||bookingDate||flightDate||status!=='TRACKING');
  if(!useful)return null;
  return{
    mawb,carrierCode:'MH',airlineName:'Malaysia Airlines Cargo / MASkargo',
    origin,destination,via,pieces,bags:pieces,weight,
    flightNo:flight,flightDate,bookingDate,
    departureDate,departureTime,departureIsActual,
    departureFlightNo:originLeg?.flightNo||'',departureOrigin:originLeg?.origin||origin,departureDestination:originLeg?.destination||'',
    arrivalDate,arrivalTime,arrivalIsActual,
    status,officialTracker:OFFICIAL,source:'MASkargo Shipment Details + Flight Details',
    malaysiaFlightRows:flights
  };
}
async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],defaultViewport:{width:1440,height:1200,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}
async function acceptCookies(page){
  for(const frame of page.frames()){try{await frame.evaluate(()=>{const txt=e=>(e?.innerText||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();const b=[...document.querySelectorAll('button,a,[role="button"]')].find(e=>/accept all|accept cookies|allow all|agree/i.test(txt(e)));if(b)b.click();});}catch{}}
}
async function clickShipmentTrackingTile(page){
  for(let pass=0;pass<6;pass++){
    for(const frame of page.frames()){try{
      const clicked=await frame.evaluate(()=>{const txt=e=>(e?.innerText||e?.textContent||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();const els=[...document.querySelectorAll('a,button,[role="button"],div,span')];const target=els.find(e=>/^shipment tracking$/i.test(txt(e)))||els.find(e=>/track your shipment/i.test(txt(e)));if(!target)return'';const clickable=target.closest('a,button,[role="button"]')||target;clickable.click();return txt(target);});
      if(clicked)return clicked;
    }catch{}}
    await sleep(400);
  }
  return'';
}
async function fillExactMalaysiaForm(page,serial){
  for(let pass=0;pass<10;pass++){
    for(const frame of page.frames()){try{
      const result=await frame.evaluate(({serial})=>{
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>18&&r.height>10&&!e.disabled};
        const all=[...document.querySelectorAll('input,textarea')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
        const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();
        const set=(e,v)=>{if(!e)return;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const d=Object.getOwnPropertyDescriptor(proto,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));};
        const prefixInput=all.find(e=>/prefix/.test(desc(e)));
        const awbInput=all.find(e=>/awb\s*(number|no)|airway\s*bill/.test(desc(e))&&!/prefix/.test(desc(e)));
        if(!prefixInput||!awbInput)return{ok:false,inputCount:all.length,descriptions:all.map(desc)};
        set(prefixInput,'232');set(awbInput,serial);
        const text=e=>(e?.innerText||e?.value||e?.textContent||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
        const buttons=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')].filter(visible);
        const submit=buttons.find(e=>/^shipment tracking$/i.test(text(e)))||buttons.find(e=>/^track shipment$/i.test(text(e)));
        if(!submit)return{ok:false,prefixValue:prefixInput.value||'',awbValue:awbInput.value||'',buttonMissing:true};
        submit.click();
        return{ok:true,prefixValue:prefixInput.value||'',awbValue:awbInput.value||'',clicked:text(submit)};
      },{serial});
      if(result?.ok)return{...result,frameUrl:frame.url()};
    }catch{}}
    await sleep(450);
  }
  return null;
}
async function extractAll(page,network=[]){
  const texts=[],tables=[];
  for(const frame of page.frames()){try{
    const data=await frame.evaluate(()=>({
      text:document.body?.innerText||'',
      tables:[...document.querySelectorAll('table')].map(table=>({rows:[...table.querySelectorAll('tr')].map(tr=>({cells:[...tr.querySelectorAll('th,td')].map(td=>(td.innerText||td.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean)})).filter(r=>r.cells.length)})).filter(t=>t.rows.length)
    }));
    if(data.text)texts.push(data.text);tables.push(...data.tables);
  }catch{}}
  for(const n of network){if(n?.body)texts.push(n.body)}
  return{text:texts.join('\n'),tables};
}

export async function trackMalaysia(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('232-'))return{ok:false,reason:'INVALID MALAYSIA AIRLINES MAWB',officialTracker:OFFICIAL};
  const serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');let browser,lastDebug={};
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const network=[];
    page.on('response',async response=>{try{
      const u=response.url(),ct=(response.headers()['content-type']||'').toLowerCase();
      if(!/(json|text|javascript|xml)/.test(ct)&&!/track|shipment|awb|cargo|event|status/i.test(u))return;
      const body=await response.text();if(!body||body.length>240000)return;
      if(body.includes(serial)||body.replace(/\D/g,'').includes(digits)||/shipment details|flight details|awb|pieces|weight|airport departure|airport arrival/i.test(body))network.push({url:u,status:response.status(),body:body.slice(0,120000)});
    }catch{}});
    await page.goto(OFFICIAL,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(2200);await acceptCookies(page);await sleep(500);

    const tile=await clickShipmentTrackingTile(page);
    await sleep(900);
    const submitted=await fillExactMalaysiaForm(page,serial);
    if(!submitted)return{ok:false,reason:'MASKARGO PREFIX/AWB FORM OR SHIPMENT TRACKING BUTTON NOT FOUND',officialTracker:OFFICIAL,debug:{stage:'FORM_NOT_FOUND',tile,frames:page.frames().map(f=>f.url())}};

    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:12000}).catch(()=>{}),sleep(9000)]);
    await sleep(1000);
    const extracted=await extractAll(page,network);
    let shipment=parseShipment(extracted,mawb);
    lastDebug={stage:'MASKARGO_SHIPMENT_DETAILS',tile,submitted,resultUrl:page.url(),network:network.map(x=>({url:x.url,status:x.status,sample:clean(x.body).slice(0,900)})).slice(-10),tables:extracted.tables.slice(0,8),textSample:clean(extracted.text).slice(0,8500)};
    if(!shipment)return{ok:false,reason:'MASKARGO RETURNED NO VERIFIED SHIPMENT DETAILS',officialTracker:OFFICIAL,debug:lastDebug};

    const finalRows=Array.isArray(shipment.malaysiaFlightRows)?shipment.malaysiaFlightRows:[];
    const finalLeg=finalRows.filter(x=>!shipment.destination||x.destination===shipment.destination).at(-1)||finalRows.at(-1)||null;
    let flightStatus=null;
    if(finalLeg?.flightNo&&finalLeg?.flightDate&&finalLeg?.origin&&finalLeg?.destination){
      flightStatus=await trackFlightStatusSnapshot({flightNo:finalLeg.flightNo,origin:finalLeg.origin,destination:finalLeg.destination,date:finalLeg.flightDate}).catch(()=>null);
      if(flightStatus?.ok){
        if(flightStatus.arrivalDate)shipment.arrivalDate=flightStatus.arrivalDate;
        if(flightStatus.arrivalTime)shipment.arrivalTime=flightStatus.arrivalTime;
        if(flightStatus.arrivalTimeZone)shipment.arrivalTimeZone=flightStatus.arrivalTimeZone;
        if(flightStatus.arrivalTimeSource)shipment.arrivalTimeSource=flightStatus.arrivalTimeSource;
        shipment.arrivalIsActual=flightStatus.arrivalIsActual===true;
        if(flightStatus.status==='ARRIVED')shipment.status='ARRIVED';
        else if(/DEPART|IN TRANSIT|AIRBORNE/i.test(String(flightStatus.status||'')))shipment.status='IN TRANSIT';
      }
    }
    if(shipment.departureDate&&shipment.departureTime)shipment.departureTimeSource=shipment.departureIsActual?'MASkargo actual origin departure':'MASkargo origin flight detail';

    delete shipment.malaysiaFlightRows;
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    return{ok:true,shipment,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:true,debug:{...lastDebug,flightStatus:flightStatus?.ok?{status:flightStatus.status||'',arrivalDate:flightStatus.arrivalDate||'',arrivalTime:flightStatus.arrivalTime||'',source:flightStatus.source||flightStatus.arrivalTimeSource||''}:null}};
  }catch(e){return{ok:false,reason:`MALAYSIA AIRLINES TRACKING ERROR: ${e?.message||e}`,officialTracker:OFFICIAL,debug:{...lastDebug,stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
