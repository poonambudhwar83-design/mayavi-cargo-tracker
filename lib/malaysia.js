import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { trackFlightStatusSnapshot } from './flightStatusSnapshot.js';

const OFFICIAL='https://www.maskargo.com/en/home.html';
const TRACKING_FORM='https://www.maskargo.com/en/shipment-tracking.html';
const trackingUrl=serial=>`${TRACKING_FORM}?prefixNumber=232&awbNumber=${encodeURIComponent(serial)}`;
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
  const pick=rx=>clean((flat.match(rx)||[])[1]||'');
  let origin=code(
    pick(/\bOrigin\b(?:\s*Airport)?\s*[:\-]?\s*["']?([A-Z]{3})\b/i)
    ||pick(/\b(?:Airport\s*Departure|Departure\s*Airport)\b\s*[:\-]?\s*["']?([A-Z]{3})\b/i)
  );
  let destination=code(
    pick(/\bDestination\b(?:\s*Airport)?\s*[:\-]?\s*["']?([A-Z]{3})\b/i)
    ||pick(/\b(?:Airport\s*Arrival|Arrival\s*Airport)\b\s*[:\-]?\s*["']?([A-Z]{3})\b/i)
  );
  const route=flat.match(/\(([A-Z]{3})\)\s*(?:→|->|–|—|TO)\s*[^|]{0,120}?\(([A-Z]{3})\)/i)
    ||flat.match(/\b([A-Z]{3})\s*(?:→|->|–|—|TO)\s*([A-Z]{3})\b/i);
  if(route){origin=origin||String(route[1]).toUpperCase();destination=destination||String(route[2]).toUpperCase();}
  const pieces=numeric(
    pick(/\bTotal\s*Package\b\s*[:\-]?\s*(\d{1,6})\s*Piece(?:\(s\)|s)?/i)
    ||pick(/\b(?:No\.?\s*of\s*)?(?:Pieces?|PCS)\b(?:\s*\([^)]*\))?\s*[:\-]?\s*["']?(\d{1,6})/i)
    ||pick(/["']?(?:pieces|pcs|totalPieces|total_pieces)["']?\s*:\s*["']?(\d{1,6})/i)
  );
  const weight=numeric(
    pick(/\bTotal\s*Package\b[\s\S]{0,80}?\|\s*([\d,.]+)\s*kg\b/i)
    ||pick(/\b(?:Gross\s*)?Weight\b(?:\s*\([^)]*\)|\s*(?:KG|KGS))?\s*[:\-]?\s*["']?([\d,.]+)/i)
    ||pick(/\b([\d,.]+)\s*kg\b/i)
    ||pick(/["']?(?:weight|grossWeight|gross_weight|totalWeight|total_weight)["']?\s*:\s*["']?([\d,.]+)/i)
  );
  let shipmentDate=parseDate(
    pick(/\b(?:Shipment\s*Date|AWB\s*Date|Booking\s*Date)\b\s*[:\-]?\s*["']?([^|"'}]{0,40})/i)
  );
  const bookingBlock=(flat.match(/.{0,90}\bBooking\s+Confirmed\b.{0,90}/i)||[])[0]||'';
  if(!shipmentDate&&bookingBlock)shipmentDate=parseDate(bookingBlock);
  const shipmentStatus=clean(
    pick(/\bShipment\s*Status\b\s*[:\-]?\s*([A-Za-z ]{2,35})/i)
    ||pick(/\b(Goods\s+Accepted|Booking\s+Confirmed|Manifested|Departed|Arrived|Delivered)\b/i)
  );
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

function endpointCandidatesFromNetwork(network=[]){
  const out=[];
  for(const n of network){
    const body=String(n?.body||'');if(!body)continue;
    const patterns=[
      /["']shipmentTrackingApiEndpoint["']\s*:\s*["']([^"']+)["']/ig,
      /["'](?:apiEndpoint|endpoint|trackingEndpoint)["']\s*:\s*["']([^"']*(?:shipment|tracking|awb)[^"']*)["']/ig,
      /(https?:\\\/\\\/[^"'\\s]+(?:shipment|tracking|awb)[^"'\\s]*)/ig,
      /([/][A-Za-z0-9_./?=&%-]*(?:shipment|tracking|awb)[A-Za-z0-9_./?=&%-]*)/ig
    ];
    for(const rx of patterns){for(const m of body.matchAll(rx)){const v=String(m[1]||'').replace(/\\u002F/g,'/').replace(/\\\//g,'/');if(v&&v.length<700&&!out.includes(v))out.push(v)}}
  }
  return out.slice(0,30);
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
    arrivalDate,arrivalTime,arrivalIsActual,arrivalVerifiedAbsent:!(arrivalDate||arrivalTime),
    status,officialTracker:trackingUrl(serial),source:'MASkargo Shipment Details + Tracking Details',
    malaysiaFlightRows:flights
  };
}
async function launch(){
  chromium.setGraphicsMode=false;
  const options={args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],defaultViewport:{width:1440,height:1200,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'};
  let lastError;
  for(let attempt=1;attempt<=4;attempt++){
    try{return await puppeteer.launch(options)}catch(e){
      lastError=e;
      if(!/ETXTBSY|EBUSY|text file busy/i.test(String(e?.message||e))||attempt===4)throw e;
      await sleep(450*attempt);
    }
  }
  throw lastError;
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
async function fillMalaysiaFormByTyping(page,serial){
  for(const frame of page.frames()){try{
    const prefix=await frame.$('#prefixfield,[name="prefixfield"],input[aria-label*="Prefix" i],input[placeholder*="Prefix" i]');
    const awb=await frame.$('#awbnumberfield,[name="awbnumberfield"],input[aria-label*="AWB Number" i],input[placeholder*="AWB Number" i]');
    if(!prefix||!awb)continue;
    await prefix.click().catch(()=>{});
    await page.keyboard.down('Control').catch(()=>{});
    await page.keyboard.press('A').catch(()=>{});
    await page.keyboard.up('Control').catch(()=>{});
    await page.keyboard.press('Backspace').catch(()=>{});
    await prefix.type('232',{delay:90});
    await awb.click().catch(()=>{});
    await page.keyboard.down('Control').catch(()=>{});
    await page.keyboard.press('A').catch(()=>{});
    await page.keyboard.up('Control').catch(()=>{});
    await page.keyboard.press('Backspace').catch(()=>{});
    await awb.type(serial,{delay:90});
    await sleep(350);
    const values={prefix:await prefix.evaluate(e=>String(e.value||'')),awb:await awb.evaluate(e=>String(e.value||''))};
    const clicked=await frame.evaluate(()=>{
      const visible=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>10&&r.height>8&&!e.disabled}catch{return false}};
      const txt=e=>(e?.innerText||e?.textContent||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
      const els=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')].filter(visible);
      const b=els.find(e=>/^shipment tracking$/i.test(txt(e)))||els.find(e=>/track\s*(shipment|awb|cargo)|^track$|^search$/i.test(txt(e)));
      if(!b)return'';
      b.click();return txt(b);
    }).catch(()=> '');
    if(clicked)return{ok:true,mode:'native-typing',prefixValue:values.prefix,awbValue:values.awb,clicked,frameUrl:frame.url()};
    await awb.press('Enter').catch(()=>{});
    return{ok:true,mode:'native-typing-enter',prefixValue:values.prefix,awbValue:values.awb,clicked:'ENTER',frameUrl:frame.url()};
  }catch{}}
  return null;
}
async function fillExactMalaysiaForm(page,serial){
  for(let pass=0;pass<12;pass++){
    for(const frame of page.frames()){try{
      const result=await frame.evaluate(({serial})=>{
        const visible=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>14&&r.height>8&&!e.disabled}catch{return false}};
        const txt=e=>(e?.innerText||e?.textContent||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
        const labelText=e=>{
          const id=e?.id||'';
          let explicit=null;
          try{explicit=id?document.querySelector(`label[for="${CSS.escape(id)}"]`):null}catch{}
          let parent=e?.parentElement,near='';
          for(let i=0;i<3&&parent;i++,parent=parent.parentElement)near+=' '+txt(parent);
          return `${explicit?txt(explicit):''} ${near}`;
        };
        const desc=e=>`${e?.name||''} ${e?.id||''} ${e?.placeholder||''} ${e?.getAttribute?.('aria-label')||''} ${e?.getAttribute?.('title')||''} ${labelText(e)}`.toLowerCase();
        const controls=[...document.querySelectorAll('input,textarea,select,[role="combobox"]')].filter(visible);
        const inputs=controls.filter(e=>e.tagName==='INPUT'||e.tagName==='TEXTAREA');
        const prefixControl=controls.find(e=>/awb\s*prefix|prefix|airline\s*code/.test(desc(e)));
        let awbInput=inputs.find(e=>/(awb|airway|shipment|tracking).*(number|no|serial)|awb\s*(number|no)|airway\s*bill/.test(desc(e))&&!/prefix|airline\s*code/.test(desc(e)));
        if(!awbInput){
          const textInputs=inputs.filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
          awbInput=textInputs.find(e=>e!==prefixControl&&((e.maxLength||0)>=8||(e.getAttribute('inputmode')||'').toLowerCase()==='numeric'))||textInputs.find(e=>e!==prefixControl);
        }
        const setValue=(e,v)=>{
          if(!e)return false;
          if(e.tagName==='SELECT'){
            const opt=[...e.options].find(o=>String(o.value).trim()==='232'||txt(o)==='232'||txt(o).startsWith('232 '));
            if(!opt)return false;
            e.value=opt.value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;
          }
          if(e.tagName==='INPUT'||e.tagName==='TEXTAREA'){
            const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
            const d=Object.getOwnPropertyDescriptor(proto,'value');d?.set?.call(e,v);
            e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));return true;
          }
          return false;
        };
        let prefixSet=false,customPrefix=false;
        if(prefixControl){
          prefixSet=setValue(prefixControl,'232');
          if(!prefixSet){
            prefixControl.click();customPrefix=true;
            const options=[...document.querySelectorAll('[role="option"],option,li,button,div,span')].filter(visible);
            const opt=options.find(e=>/^232(?:\s|$)/.test(txt(e)));
            if(opt){opt.click();prefixSet=true;customPrefix=false}
          }
        }
        if(!awbInput)return{ok:false,stage:'AWB_INPUT_NOT_FOUND',prefixFound:Boolean(prefixControl),prefixSet,inputCount:inputs.length,controls:controls.map(desc).slice(0,20)};
        setValue(awbInput,serial);
        const buttons=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')].filter(visible);
        const submit=buttons.find(e=>/^shipment tracking$/i.test(txt(e)))
          ||buttons.find(e=>/track\s*(shipment|awb|cargo)|shipment\s*tracking|^track$|^search$/i.test(txt(e)));
        if(!submit)return{ok:false,stage:'SUBMIT_NOT_FOUND',prefixFound:Boolean(prefixControl),prefixSet,customPrefix,awbValue:awbInput.value||'',buttons:buttons.map(txt).filter(Boolean).slice(0,20)};
        submit.click();
        return{ok:true,prefixFound:Boolean(prefixControl),prefixSet,customPrefix,awbValue:awbInput.value||'',prefixValue:prefixControl?.value||txt(prefixControl)||'',clicked:txt(submit),controls:controls.map(desc).slice(0,12)};
      },{serial});
      if(result?.ok)return{...result,frameUrl:frame.url()};
    }catch{}}
    await sleep(500);
  }
  return null;
}
async function extractAll(page,network=[]){
  const texts=[],tables=[];
  for(const frame of page.frames()){try{
    const data=await frame.evaluate(()=>{
      const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
      const visible=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}catch{return false}};
      const semantic=[...document.querySelectorAll('[role="row"],.row,.table-row')].filter(visible).map(r=>({cells:[...r.querySelectorAll('[role="cell"],[role="columnheader"],th,td,.cell,.table-cell')].map(c=>norm(c.innerText||c.textContent)).filter(Boolean)})).filter(r=>r.cells.length>1);
      return{
        text:document.body?.innerText||'',
        tables:[
          ...[...document.querySelectorAll('table')].map(table=>({rows:[...table.querySelectorAll('tr')].map(tr=>({cells:[...tr.querySelectorAll('th,td')].map(td=>norm(td.innerText||td.textContent)).filter(Boolean)})).filter(r=>r.cells.length)})).filter(t=>t.rows.length),
          ...(semantic.length?[{rows:semantic}]:[])
        ]
      };
    });
    if(data.text)texts.push(data.text);tables.push(...data.tables);
  }catch{}}
  for(const n of network){
    if(!n?.body)continue;
    texts.push(n.body);
    texts.push(String(n.body).replace(/[{}\[\]",]/g,' ').replace(/\\[nrt]/g,' '));
  }
  return{text:texts.join('\n'),tables};
}
export async function trackMalaysia(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('232-'))return{ok:false,reason:'INVALID MALAYSIA AIRLINES MAWB',officialTracker:OFFICIAL};
  const digits=mawb.replace(/\D/g,'');const serial=digits.slice(-8);let browser,lastDebug={};
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
    const deepUrl=trackingUrl(serial);
    await page.goto(TRACKING_FORM,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(2600);await acceptCookies(page);await sleep(500);

    // The direct URL reliably opens the MASkargo Shipment Tracking component,
    // but the Vue app still requires the 232 prefix + AWB serial to be submitted
    // before it calls the live shipment API.
    const submitted=(await fillMalaysiaFormByTyping(page,serial))||await fillExactMalaysiaForm(page,serial);
    if(!submitted)return{ok:false,reason:'MASKARGO DIRECT PAGE OPENED BUT AWB SUBMISSION FAILED',officialTracker:deepUrl,debug:{stage:'DIRECT_FORM_NOT_SUBMITTED',deepUrl,frames:page.frames().map(f=>f.url())}};
    await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:12000}).catch(()=>{}),sleep(9000)]);
    await sleep(800);

    // MASkargo exposes the actual tracking result at a stable deep link.
    // If the result has a collapsed history, open it before extraction.
    let expandedHistory=false;
    for(const frame of page.frames()){try{
      expandedHistory=await frame.evaluate(()=>{
        const txt=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
        const all=[...document.querySelectorAll('button,a,[role="button"],div,span')];
        const el=all.find(e=>/view\s+full\s+history/i.test(txt(e)));
        if(!el)return false;
        (el.closest('button,a,[role="button"]')||el).click();
        return true;
      });
      if(expandedHistory)break;
    }catch{}}
    if(expandedHistory)await sleep(900);
    await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:6000}).catch(()=>{}),sleep(3500)]);
    for(let i=0;i<16;i++){
      const ready=await Promise.all(page.frames().map(async f=>{try{return await f.evaluate(({serial})=>{const t=(document.body?.innerText||'').replace(/\s+/g,' ');return t.includes(serial)&&/Shipment Details|Flight Details|Origin|Destination|Pieces|Weight/i.test(t)},{serial})}catch{return false}}));
      if(ready.some(Boolean))break;
      await sleep(500);
    }
    await sleep(700);
    const extracted=await extractAll(page,network);
    let shipment=parseShipment(extracted,mawb);
    const endpointCandidates=endpointCandidatesFromNetwork(network);
    lastDebug={stage:'MASKARGO_DIRECT_RESULT',deepUrl,submitted,endpointCandidates,resultUrl:page.url(),expandedHistory,network:network.map(x=>({url:x.url,status:x.status,sample:clean(x.body).slice(0,900)})).slice(-10),tables:extracted.tables.slice(0,8),textSample:clean(extracted.text).slice(0,8500)};
    if(!shipment)return{ok:false,reason:'MASKARGO RETURNED NO VERIFIED SHIPMENT DETAILS',officialTracker:deepUrl,debug:lastDebug};

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
