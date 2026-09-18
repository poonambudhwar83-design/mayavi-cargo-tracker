import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const CARGO_URL='https://www.kuwaitairways.com/en/cargo/tracking';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseDate(v=''){
  const s=String(v||'').trim().toUpperCase();
  let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(\d{1,2})[\s\-,]+(20\d{2})\b/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  m=s.match(/\b(\d{1,2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(\d{2})\b/);if(m)return`20${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  return'';
}
function cleanCode(v=''){return String(v||'').toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]||'';}
function cleanFlight(v=''){const m=String(v||'').toUpperCase().match(/\bKU\s*[- ]?(\d{2,4})\b/);return m?`KU${m[1]}`:'';}
function piecesFrom(v=''){return String(v||'').match(/\b(\d{1,6})\s+PIECES?\b/i)?.[1]||'';}
function weightFrom(v=''){return String(v||'').match(/\b([\d,.]+)\s*KGS?\b/i)?.[1]?.replace(/,/g,'')||'';}
function timeFrom(v=''){
  const s=String(v||'').toUpperCase();
  const twelve=[...s.matchAll(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/g)];
  if(twelve.length){
    const m=twelve.at(-1);let h=Number(m[1]);if(m[3]==='PM'&&h<12)h+=12;if(m[3]==='AM'&&h===12)h=0;
    return`${pad(h)}:${m[2]}`;
  }
  const matches=[...s.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];if(!matches.length)return'';const m=matches.at(-1);return`${pad(m[1])}:${m[2]}`;
}
function plusSevenHours(date='',time=''){
  const m=String(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/),t=String(time).match(/^(\d{2}):(\d{2})$/);if(!m||!t)return{date:'',time:'',iso:''};
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(t[1]),Number(t[2]),0));d.setUTCHours(d.getUTCHours()+7);
  const nextDate=`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,nextTime=`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return{date:nextDate,time:nextTime,iso:`${nextDate}T${nextTime}:00`};
}
function cargoStatus(rows=[]){
  const joined=rows.map(r=>`${r.code} ${r.details}`).join(' ').toUpperCase();
  if(/DELIVERED|\bDLV\b|ARRIVED|LANDED|RECEIVED FROM FLIGHT|\bRCF\b/.test(joined))return'ARRIVED';
  if(/DEPARTED|\bDEP\b|IN TRANSIT|AIRBORNE|IN FLIGHT|UPLIFTED/.test(joined))return'IN TRANSIT';
  if(/DELAY|LATE|OFFLOAD|SHORT SHIP/.test(joined))return'DELAYED';
  return'BOOKED';
}
function operationalRows(tables=[]){
  for(const table of tables){const rows=table.rows||[];if(!rows.length)continue;const header=(rows[0].cells||[]).map(x=>String(x).toLowerCase()).join(' | ');if(!(header.includes('operational status')&&header.includes('airport')&&header.includes('details')))continue;return rows.slice(1).map(r=>({code:String(r.cells?.[0]||'').trim().toUpperCase(),airport:cleanCode(r.cells?.[1]||''),dateText:String(r.cells?.[2]||'').trim(),details:String(r.cells?.[3]||'').trim()})).filter(r=>r.code||r.airport||r.details);}
  return[];
}
function flightFromFlightTable(tables=[]){
  for(const table of tables){
    const rows=table.rows||[];if(rows.length<2)continue;
    const headers=(rows[0].cells||[]).map(x=>String(x||'').trim().toLowerCase());
    const flightIndex=headers.findIndex(x=>x.includes('flight no'));
    const dateIndex=headers.findIndex(x=>x==='date'||x.includes('date'));
    const originIndex=headers.findIndex(x=>x==='origin'||x.includes('origin'));
    const destinationIndex=headers.findIndex(x=>x.includes('arrival city')||x.includes('destination'));
    const piecesIndex=headers.findIndex(x=>x.includes('pieces'));
    const weightIndex=headers.findIndex(x=>x.includes('weight'));
    const statusIndex=headers.findIndex(x=>x==='status'||x.includes('status'));
    if(flightIndex<0||dateIndex<0||originIndex<0||destinationIndex<0)continue;
    for(const row of rows.slice(1)){
      const cells=row.cells||[];
      const flightNo=cleanFlight(cells[flightIndex]||'');
      const flightDate=parseDate(cells[dateIndex]||'');
      const origin=cleanCode(cells[originIndex]||'');
      const destination=cleanCode(cells[destinationIndex]||'');
      const pieces=piecesIndex>=0?String(cells[piecesIndex]||'').match(/\d+/)?.[0]||'':'';
      const weight=weightIndex>=0?String(cells[weightIndex]||'').replace(/[^\d.]/g,''):'';
      const status=statusIndex>=0?String(cells[statusIndex]||'').trim():'';
      if(flightNo||origin||destination)return{flightNo,flightDate,origin,destination,pieces,weight,status};
    }
  }
  return{flightNo:'',flightDate:'',origin:'',destination:'',pieces:'',weight:'',status:''};
}
function routeFromFlightTable(tables=[]){
  const f=flightFromFlightTable(tables);
  return{origin:f.origin,destination:f.destination};
}

async function acceptCookies(page){
  for(const frame of page.frames()){try{await frame.evaluate(()=>{const text=e=>(e?.innerText||e?.value||e?.getAttribute?.('aria-label')||'').trim();const b=[...document.querySelectorAll('button,a,[role="button"]')].find(x=>/accept cookies|accept all|agree|allow all/i.test(text(x)));if(b)b.click();});}catch{}}
}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}

async function fillAndSubmit(page,prefix,serial){
  const attempts=[{prefix,awb:serial},{prefix:'',awb:`${prefix}${serial}`},{prefix:'',awb:`${prefix}-${serial}`}];
  for(const frame of page.frames()){
    for(const attempt of attempts){
      try{
        const fill=await frame.evaluate(({prefix,awb})=>{
          const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
          const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
          const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
          const set=(e,v)=>{if(!e)return;const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));};
          const p=inputs.find(e=>/prefix|airline\s*code/.test(desc(e)));
          let a=inputs.find(e=>/awb|waybill/.test(desc(e))&&!/prefix|airline\s*code/.test(desc(e)));
          if(!a)a=inputs.find(e=>e!==p)||inputs[0];
          if(prefix&&p)set(p,prefix);set(a,awb);
          return{prefixFound:Boolean(p),awbFound:Boolean(a),prefixValue:p?.value||'',awbValue:a?.value||'',inputCount:inputs.length};
        },attempt);
        if(!fill.awbFound)continue;
        const clicked=await frame.evaluate(()=>{const text=e=>(e?.innerText||e?.value||e?.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();const all=[...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')];const b=all.find(e=>/^(submit|track|search|track shipment|track cargo)$/i.test(text(e)))||all.find(e=>/submit|track|search/i.test(text(e)));if(b){b.click();return{text:text(b)};}return null;});
        if(clicked)return{fill,clicked,frameUrl:frame.url(),attempt};
      }catch{}
    }
  }
  return null;
}
async function extractAll(page){
  const texts=[],tables=[];
  for(const frame of page.frames()){
    try{const data=await frame.evaluate(()=>({text:(document.body?.innerText||'').replace(/\s+/g,' ').trim(),tables:[...document.querySelectorAll('table')].map(table=>({rows:[...table.querySelectorAll('tr')].map(tr=>({cells:[...tr.querySelectorAll('th,td')].map(td=>(td.innerText||td.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean)})).filter(r=>r.cells.length)})).filter(t=>t.rows.length)}));if(data.text)texts.push(data.text);tables.push(...data.tables);}catch{}
  }
  return{text:texts.join(' '),tables};
}
function buildShipment(extracted,mawb){
  const ops=operationalRows(extracted.tables);
  const flight=flightFromFlightTable(extracted.tables);
  const route={origin:flight.origin,destination:flight.destination};
  const rcs=ops.find(r=>r.code==='RCS')||{};
  const dep=ops.find(r=>r.code==='DEP')||{};
  const rcf=ops.find(r=>r.code==='RCF')||{};
  const dlv=ops.find(r=>r.code==='DLV')||{};

  const textRoute=extracted.text.match(/\b(KU\s*\d{2,4})\b\s+(\d{1,2}-[A-Z]{3}-\d{2})\s+([A-Z]{3})\s+([A-Z]{3})\s+(\d+)\s+([\d.]+)[\s\S]{0,60}?\b(Booked|Confirmed|Departed|Arrived|Delivered)?\b/i);
  const textFlightNo=cleanFlight(textRoute?.[1]||'');
  const textFlightDate=parseDate(textRoute?.[2]||'');
  const textOrigin=cleanCode(textRoute?.[3]||'');
  const textDestination=cleanCode(textRoute?.[4]||'');

  const origin=route.origin||rcs.airport||dep.airport||textOrigin||'';
  const destination=route.destination||textDestination||(ops.find(r=>/^(RCF|DLV)$/.test(r.code)&&r.airport&&r.airport!==origin)?.airport)||'';

  const flightEvent=ops.find(r=>/^(PRE|DEP)$/.test(r.code)&&cleanFlight(r.details))||ops.find(r=>cleanFlight(r.details))||dep||rcs||ops[0]||{};
  const detailSource=flightEvent.details||rcs.details||'';

  const pieces=piecesFrom(detailSource)||piecesFrom(dep.details)||piecesFrom(rcs.details)||flight.pieces||textRoute?.[5]||'';
  const weight=weightFrom(detailSource)||weightFrom(dep.details)||weightFrom(rcs.details)||flight.weight||textRoute?.[6]||'';
  const flightNo=flight.flightNo||cleanFlight(detailSource)||cleanFlight(dep.details)||cleanFlight(rcs.details)||textFlightNo||'';
  const flightDate=flight.flightDate||textFlightDate||'';
  const bookingDate=parseDate(rcs.dateText)||parseDate(rcs.details)||'';

  const depCombined=`${dep.dateText||''} ${dep.details||''}`.trim();
  const departureDate=parseDate(dep.dateText)||parseDate(dep.details)||parseDate(depCombined)||'';
  const departureTime=timeFrom(depCombined)||'';
  const calculatedArrival=departureDate&&departureTime?plusSevenHours(departureDate,departureTime):{date:'',time:'',iso:''};

  const rcfCombined=`${rcf.dateText||''} ${rcf.details||''}`.trim();
  const rcfDate=parseDate(rcf.dateText)||parseDate(rcf.details)||parseDate(rcfCombined)||'';
  const rcfTime=timeFrom(rcfCombined)||'';

  let status=cargoStatus(ops),arrivalDate='',arrivalTime='',eta=null,actualArrival=null,arrivalIsActual=false,arrivalTimeSource='';

  // RCF is the strongest Kuwait Cargo evidence that the shipment has physically
  // reached the destination. Prefer its actual timestamp whenever published.
  if(rcf.code==='RCF'&&rcfDate&&rcfTime){
    arrivalDate=rcfDate;arrivalTime=rcfTime;eta=`${rcfDate}T${rcfTime}:00`;actualArrival=eta;arrivalIsActual=true;status='ARRIVED';arrivalTimeSource='Kuwait Airways RCF card';
  }else if(dep.code==='DEP'&&calculatedArrival.date&&calculatedArrival.time){
    // Existing Mayavi Kuwait rule: actual DEP timestamp + 7 hours.
    arrivalDate=calculatedArrival.date;arrivalTime=calculatedArrival.time;eta=calculatedArrival.iso;arrivalTimeSource='Kuwait Airways DEP card + 7 hours';
    const calculatedMs=new Date(`${calculatedArrival.iso}+05:30`).getTime();
    if(Number.isFinite(calculatedMs)&&Date.now()>=calculatedMs){status='ARRIVED';actualArrival=calculatedArrival.iso;arrivalIsActual=true;}else status='IN TRANSIT';
  }else if(flightDate){
    // Before DEP the cargo cards genuinely show N/A. Keep the flight date
    // separately; a schedule source must confirm the actual arrival date/time.
    status=/BOOKED|CONFIRMED/i.test(flight.status||'')?'BOOKED':status;
  }

  if(dlv.code==='DLV')status='DELIVERED';

  const shipment={
    mawb,carrierCode:'KU',airlineName:'Kuwait Airways Cargo',officialTracker:CARGO_URL,
    origin,destination,pieces,bags:pieces,weight,flightNo,bookingDate,
    flightDate,departureDate,departureTime,arrivalDate,arrivalTime,eta,actualArrival,arrivalIsActual,
    arrivalTimeSource,status,
    source:rcfDate&&rcfTime?'Kuwait Airways RCF card':
      calculatedArrival.date?'Kuwait Airways cargo cards · DEP + 7 hours':
      'Kuwait Airways cargo cards + flight table'
  };
  return{shipment,ops,route,flight,calculatedArrival,useful:Boolean(origin||destination||pieces||weight||flightNo||bookingDate||departureDate||arrivalDate)};
}

async function kuwaitFlightStatsSchedule({flightNo='',flightDate='',origin='',destination=''}){
  const m=String(flightNo||'').toUpperCase().match(/^KU(\d{2,4})$/);
  const d=String(flightDate||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if(!m||!d||origin!=='KWI'||destination!=='DEL')return null;
  const url=`https://www.flightstats.com/v2/flight-tracker/KU/${Number(m[1])}?year=${d[1]}&month=${Number(d[2])}&date=${Number(d[3])}`;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(12000)});
      if(!r.ok){if(attempt<2){await sleep(450);continue;}return null;}
      const html=await r.text();
      const plain=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
      const arrivalBlock=(plain.match(/Flight Arrival Times[\s\S]{0,700}/i)||plain.match(/Arrival Times[\s\S]{0,700}/i)||plain.match(/Arrival[\s\S]{0,700}/i)||[])[0]||'';
      const arrivalDate=parseDate(arrivalBlock);
      const actual=timeFrom((arrivalBlock.match(/Actual[\s\S]{0,90}?((?:1[0-2]|0?\d):[0-5]\d\s*(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)/i)||[])[1]||'');
      const estimated=timeFrom((arrivalBlock.match(/Estimated[\s\S]{0,90}?((?:1[0-2]|0?\d):[0-5]\d\s*(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)/i)||[])[1]||'');
      const scheduled=timeFrom((arrivalBlock.match(/Scheduled[\s\S]{0,90}?((?:1[0-2]|0?\d):[0-5]\d\s*(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)/i)||[])[1]||'');
      const arrivalTime=actual||estimated||scheduled;
      if(!arrivalTime){if(attempt<2){await sleep(450);continue;}return null;}

      let resolvedDate=arrivalDate;
      if(!resolvedDate){
        // KWI→DEL evening services normally land after midnight. Infer only the
        // calendar rollover from the published arrival clock, never the time itself.
        const base=new Date(`${flightDate}T00:00:00Z`);
        if(arrivalTime<'12:00')base.setUTCDate(base.getUTCDate()+1);
        resolvedDate=`${base.getUTCFullYear()}-${pad(base.getUTCMonth()+1)}-${pad(base.getUTCDate())}`;
      }
      const arrivalIsActual=Boolean(actual);
      return{arrivalDate:resolvedDate,arrivalTime,arrivalIsActual,eta:`${resolvedDate}T${arrivalTime}:00`,actualArrival:arrivalIsActual?`${resolvedDate}T${arrivalTime}:00`:null,status:arrivalIsActual?'ARRIVED':'BOOKED',source:actual?'FlightStats actual arrival':estimated?'FlightStats estimated arrival':'FlightStats scheduled arrival',url};
    }catch{
      if(attempt<2){await sleep(450);continue;}
      return null;
    }
  }
  return null;
}

export async function trackKuwait(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('229-'))return{ok:false,reason:'INVALID KUWAIT MAWB'};
  const prefix='229',serial=mawb.slice(4);let browser,lastDebug={};
  try{
    browser=await launch();const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    for(let pass=1;pass<=3;pass++){
      try{await page.goto(CARGO_URL,{waitUntil:'domcontentloaded',timeout:30000});}catch(e){lastDebug={pass,stage:'GOTO',message:e?.message||String(e)};if(pass<3)continue;throw e;}
      await sleep(2200);await acceptCookies(page);await sleep(500);
      const submitted=await fillAndSubmit(page,prefix,serial);if(!submitted){lastDebug={pass,stage:'FORM_NOT_FOUND',frames:page.frames().map(f=>f.url())};if(pass<3){await sleep(1200);continue;}break;}
      await Promise.race([page.waitForNetworkIdle({idleTime:900,timeout:12000}).catch(()=>{}),sleep(10000)]);await sleep(1300);
      const extracted=await extractAll(page),built=buildShipment(extracted,mawb);lastDebug={pass,stage:'RESULT',submitted,ops:built.ops,route:built.route,calculatedArrival:built.calculatedArrival,textSample:extracted.text.slice(0,6000)};
      if(built.useful){
        let shipment=built.shipment;
        let scheduleFallback=null;
        if(!shipment.arrivalTime&&shipment.flightNo&&shipment.flightDate&&shipment.origin&&shipment.destination){
          scheduleFallback=await kuwaitFlightStatsSchedule({flightNo:shipment.flightNo,flightDate:shipment.flightDate,origin:shipment.origin,destination:shipment.destination});
          if(scheduleFallback){
            shipment={...shipment,
              arrivalDate:scheduleFallback.arrivalDate||shipment.arrivalDate||'',
              arrivalTime:scheduleFallback.arrivalTime||'',
              eta:scheduleFallback.eta||shipment.eta||null,
              actualArrival:scheduleFallback.actualArrival||shipment.actualArrival||null,
              arrivalIsActual:scheduleFallback.arrivalIsActual===true,
              arrivalTimeSource:scheduleFallback.source,
              status:scheduleFallback.arrivalIsActual?'ARRIVED':shipment.status,
              source:`${shipment.source} + ${scheduleFallback.source}`
            };
          }
        }
        const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
        return{ok:true,shipment,screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:true,debug:{stage:'KUWAIT_CARD_READER',...lastDebug,scheduleFallback}};
      }
      if(pass<3)await sleep(1500);
    }
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:68,fullPage:false,encoding:'base64'}).catch(()=>null);
    return{ok:false,reason:'KUWAIT TRACKER RETURNED NO VERIFIED FIELDS AFTER RETRY',officialTracker:CARGO_URL,screenshotBase64,debug:lastDebug};
  }catch(e){return{ok:false,reason:`KUWAIT TRACKING ERROR: ${e?.message||e}`,officialTracker:CARGO_URL,debug:{...lastDebug,stage:'ERROR'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
