// Gulf Air Cargo 072: ParcelsApp AWB-specific public result + optional licensed API.
// ParcelsApp is an independent aggregator, not Gulf Air's official tracking site.
// Never convert an intermediate arrival into final-destination arrival.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import {normalizeMawb} from './airlines.js';
import {normalizeShipmentTimesToIst} from './exportIst.js';

export const GULF_PARCELS_URL='https://parcelsapp.com/en/carriers/gulf-air-cargo';
export const PARCELS_TRACK_PACKAGE_URL='https://parcelsapp.com/';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const code=v=>/^[A-Z]{3}$/.test(clean(v).toUpperCase())?clean(v).toUpperCase():'';
const num=v=>clean(v).replace(/,/g,'').match(/^\d+(?:\.\d+)?/)?.[0]||'';
const date=s=>{
  const raw=String(s||'');
  let m=raw.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  m=raw.match(/\b(\d{1,2})[\s-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,-]+(20\d{2})\b/i);
  const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  return m?m[3]+'-'+months[m[2].toUpperCase()]+'-'+m[1].padStart(2,'0'):'';
};
const time=s=>{const m=String(s||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?m[1].padStart(2,'0')+':'+m[2]:'';};
const flight=s=>{const m=String(s||'').match(/\bGF[\s-]?(\d{2,4})\b/i);return m?'GF'+m[1]:'';};
function statusCode(s){
  const t=String(s||'').toUpperCase();
  if(/\bDLV\b|\bDELIVERED\b/.test(t))return 'DLV';
  if(/\bRCF\b|RECEIVED FROM FLIGHT/.test(t))return 'RCF';
  if(/\bARR\b|\bARRIVED\b|FLIGHT ARRIVAL/.test(t))return 'ARR';
  if(/\bDEP\b|\bDEPARTED\b|FLIGHT DEPARTURE/.test(t))return 'DEP';
  if(/\bOFF\b|\bOFFLOADED\b/.test(t))return 'OFF';
  if(/\bMAN\b|\bMANIFESTED\b/.test(t))return 'MAN';
  if(/\bRCS\b|RECEIVED FROM SHIPPER|\bCARGO ACCEPTED\b/.test(t))return 'RCS';
  if(/\bBKD\b|\bBOOKED\b|\bBOOKING CONFIRMED\b/.test(t))return 'BKD';
  return '';
}
function stamp(s){
  const raw=String(s||''),d=date(raw);
  if(!d)return {date:'',time:''};
  if(/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)){
    const dt=new Date(raw);
    if(Number.isFinite(dt.getTime())){
      const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(dt).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
      return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
    }
  }
  return {date:d,time:time(raw)};
}
const exactAwb=(v,mawb)=>normalizeMawb(v)===mawb;
const attr=(s,label)=>clean((s.attributes||[]).find(a=>clean(a.l||a.name||a.label).toLowerCase()===label.toLowerCase())?.val||'');

// A Gulf 072 MAWB can contain two different physical quantities on two flights.
// BKD, MAN, PRE and DEP for the SAME flight and quantity are progress events,
// never extra bags. Connecting full-load flights are also not a split load.
function gulfPartsFromEvents(shipment,events=[],timeZone='LOCAL'){
  const totalPieces=Number(num(shipment.pieces)),totalWeight=Number(num(shipment.weight));
  if(!totalPieces||!totalWeight||!Array.isArray(events))return shipment;
  const priorities={DLV:8,ARR:7,RCF:6,DEP:5,OFF:4,MAN:3,BKD:2,RCS:1};
  const candidates=new Map();
  for(const e of events){
    const description=String(e.description||'');
    const pieces=Number(num(e.pieces||description.match(/\bpieces\s*:\s*([\d,.]+)/i)?.[1]));
    const weight=Number(num(e.weight||description.match(/\bweight\s*:\s*([\d,.]+)/i)?.[1]));
    const flightNo=e.flightNo||flight(description);
    if(!pieces||!weight||pieces>=totalPieces||weight>=totalWeight||!flightNo)continue;
    // The same 24-piece movement may be listed as BKD, PRE, MAN and DEP.
    // The stable quantity+weight key prevents counting all those rows.
    const key=pieces+'|'+weight.toFixed(3);
    const prev=candidates.get(key);
    const rank=priorities[e.code]||0;
    const next={...e,pieces,weight,flightNo,rank};
    if(!prev||rank>prev.rank||(rank===prev.rank&&
      (String(e.date||'')+String(e.time||''))>(String(prev.date||'')+String(prev.time||''))))
      candidates.set(key,next);
  }
  const physical=[...candidates.values()];
  if(physical.length<2||physical.reduce((n,p)=>n+p.pieces,0)!==totalPieces||
    Math.abs(physical.reduce((n,p)=>n+p.weight,0)-totalWeight)>0.6)return shipment;
  const parts=physical.sort((a,b)=>b.rank-a.rank||a.flightNo.localeCompare(b.flightNo))
    .map(p=>{
      const desc=String(p.description||'');
      const to=code(desc.match(/\bFlight\s+GF[\s-]?\d{2,4}\s+to\b[^\n]{0,115}?\(([A-Z]{3})\)/i)?.[1]);
      const airports=[...desc.matchAll(/\(([A-Z]{3})\)/gi)].map(m=>code(m[1])).filter(Boolean);
      const from=p.station||airports.filter(v=>v!==to).at(-1)||shipment.origin||'';
      // A flight's departure is not a destination cargo ARR. Intermediate
      // RCF is only a transit receipt unless its station is the final airport.
      const arrived=(p.code==='ARR'||p.code==='RCF'||p.code==='DLV')&&
        Boolean(p.station&&p.station===shipment.destination);
      const dep=p.code==='DEP';
      const status=arrived?'ARRIVED':dep?'DEPARTED':p.code==='OFF'?'OFFLOADED':
        p.code==='MAN'?'MANIFESTED':'BOOKED';
      const id=['GF',p.pieces,p.weight.toFixed(3)].join('|');
      return{
        partKey:id,partId:id,pieces:p.pieces,weight:p.weight,
        totalPieces,totalWeight,flightNo:p.flightNo,
        flightDate:p.date||'',flightOrigin:from,flightDestination:to,
        departureOrigin:from,
        departureDate:dep?p.date||'':'',departureTime:dep?p.time||'':'',
        departureTimeZone:timeZone,departureIsActual:dep,
        arrivalDate:arrived?p.date||'':'',arrivalTime:arrived?p.time||'':'',
        arrivalTimeZone:timeZone,arrivalIsActual:arrived,
        sourceStatus:p.code,status,mailSent:false,customsCleared:false,
        remarks:'ParcelsApp Gulf Air '+p.code+' — '+p.pieces+' pcs / '+p.weight+' kg'
      };
    });
  const arrived=parts.filter(p=>p.arrivalIsActual===true);
  const arrivedPieces=arrived.reduce((n,p)=>n+p.pieces,0);
  const arrivedWeight=arrived.reduce((n,p)=>n+p.weight,0);
  return {...shipment,isPartLoad:true,partLoad:true,
    masterPieces:totalPieces,totalPieces,masterWeight:totalWeight,totalWeight,
    arrivedPieces,arrivedWeight,pendingPieces:Math.max(0,totalPieces-arrivedPieces),
    pendingWeight:Math.max(0,totalWeight-arrivedWeight),
    partShipments:parts,
    status:arrivedPieces===totalPieces?'ARRIVED':
      parts.some(p=>p.status==='DEPARTED'||p.status==='ARRIVED')?'IN TRANSIT':
      parts.some(p=>p.status==='MANIFESTED')?'MANIFESTED':'BOOKED'
  };
}

function resultShipment(mawb,{origin='',destination='',pieces='',weight='',flightNo='',events=[],leg={}},kind){
  events.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const accepted=[...events].reverse().find(e=>['RCS','BKD'].includes(e.code));
  const departed=[...events].reverse().find(e=>e.code==='DEP');
  const arrived=[...events].reverse().find(e=>destination&&e.station===destination&&['ARR','RCF','DLV'].includes(e.code));
  const actual=destination&&code(leg.destination)===destination?stamp(leg.actual_arrival):{date:'',time:''};
  const arrivalDate=arrived?.date||actual.date||'',arrivalTime=arrived?.time||actual.time||'';
  const latest=events.at(-1),delivered=arrived?.code==='DLV';
  const status=delivered?'DELIVERED':arrivalDate?'ARRIVED':latest?.code==='OFF'?'OFFLOADED':departed?'IN TRANSIT':
    events.some(e=>e.code==='MAN')?'MANIFESTED':accepted?'BOOKED':'TRACKING';
  if(!events.length&&!((origin||destination)&&(pieces||weight)))return {ok:false,reason:'NO AWB-VERIFIED SHIPMENT DETAILS'};
  const shipment={
    mawb,carrierCode:'GF',airlineName:'Gulf Air Cargo',
    source:'ParcelsApp Gulf Air Cargo ('+kind+', third-party)',
    officialTracker:GULF_PARCELS_URL,
    origin,destination,pieces,bags:pieces,weight,masterWeight:weight,
    flightNo:flightNo||flight(leg.flight_number)||[...events].reverse().find(e=>e.flightNo)?.flightNo||'',
    bookingDate:accepted?.date||'',departureDate:departed?.date||'',departureTime:departed?.time||'',
    departureIsActual:Boolean(departed),departureTimeZone:'IST',
    arrivalDate,arrivalTime,arrivalIsActual:Boolean(arrivalDate),arrivalTimeZone:'IST',
    arrivalTimeSource:arrived?'ParcelsApp destination '+arrived.code:actual.date?'ParcelsApp actual flight leg arrival':'',
    status,shipmentEvents:events.slice(-30)
  };
  return {ok:true,shipment:gulfPartsFromEvents(shipment,events,
    kind==='licensed API'?'IST':'LOCAL'),events};
}
export function parseGulfAirParcelsApi(input,mawbInput){
  const mawb=normalizeMawb(mawbInput);
  if(!mawb?.startsWith('072-'))return {ok:false,reason:'INVALID GULF AIR AWB'};
  const records=Array.isArray(input?.results)?input.results:[input];
  const record=records.find(r=>exactAwb(r?.tracking_number||r?.trackingNumber||r?.shipment?.trackingId,mawb));
  if(!record?.shipment)return {ok:false,reason:'PARCELS API AWB NOT VERIFIED'};
  const sh=record.shipment;if(sh.error)return {ok:false,reason:'PARCELS API ERROR '+clean(sh.error)};
  const origin=code(sh.fromAirport)||airportText(sh.from)||airportText(attr(sh,'from'))||code(attr(sh,'origin airport'));
  const destination=code(sh.toAirport)||airportText(sh.to)||airportText(attr(sh,'to'))||code(attr(sh,'destination airport'));
  const pieces=num(sh.pieces||sh.bags||sh.pieceCount||attr(sh,'pieces')||attr(sh,'bags'));
  const weight=num(sh.weight||sh.grossWeight||attr(sh,'gross weight')||attr(sh,'weight'));
  const legs=Array.isArray(sh.flight_legs)?sh.flight_legs:[];
  const leg=legs.find(l=>code(l.destination)===destination)||legs.at(-1)||{};
  const events=(Array.isArray(sh.states)?sh.states:[])
    .map(e=>({...stamp(e.date),code:statusCode(e.state||e.status),station:code(e.airport)||code(e.station)||code(e.location),
      flightNo:flight(e.flight_number||e.flight||e.state),pieces:e.pieces||e.piece_count||'',
      weight:e.weight||'',description:clean(e.state||e.status)}))
    .filter(e=>e.code&&e.date);
  return resultShipment(mawb,{origin,destination,pieces,weight,events,leg},'licensed API');
}
function label(text,names){
  const rows=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for(let i=0;i<rows.length;i++){
    for(const name of names){
      const low=rows[i].toLowerCase(),key=name.toLowerCase();
      if(low===key||low===key+':')return rows[i+1]||'';
      if(low.startsWith(key+':'))return rows[i].slice(key.length+1).trim();
    }
  }
  return '';
}
function airportText(v){
  const t=clean(v).toUpperCase();
  if(code(t))return t;
  return t.match(/\(([A-Z]{3})\)/)?.[1]||t.match(/^([A-Z]{3})\b/)?.[1]||'';
}

function bookingFlightLegs(events=[],origin='',destination=''){
  // ParcelsApp reports each booked leg multiple times as BKD and KK.
  // These are booking records, NOT an actual aircraft departure or arrival.
  const unique=new Map();
  for(const event of events){
    if(event.code!=='BKD'&&event.code!=='RCS')continue;
    const description=String(event.description||'');
    const number=event.flightNo||flight(description);
    if(!number)continue;
    const m=description.match(/\bFlight\s+GF[\s-]?\d{2,4}\s+to\s+[^|]{0,115}?\(([A-Z]{3})\)/i);
    const to=code(m?.[1]);
    const airports=[...description.matchAll(/\(([A-Z]{3})\)/g)].map(x=>code(x[1])).filter(Boolean);
    const from=airports.filter(x=>x!==to).at(-1)||'';
    const prior=unique.get(number);
    if(!prior){
      unique.set(number,{flightNo:number,origin:from,destination:to,status:'BOOKED',
        bookingDate:event.date||'',bookingTime:event.time||'',
        pieces:num((description.match(/\bpieces\s*:\s*(\d+)/i)||[])[1]||''),
        weight:num((description.match(/\bweight\s*:\s*([\d,.]+)/i)||[])[1]||'')});
    } else {
      if(!prior.origin&&from)prior.origin=from;
      if(!prior.destination&&to)prior.destination=to;
      if(event.date&&(!prior.bookingDate||(event.date+event.time)<(prior.bookingDate+prior.bookingTime))){
        prior.bookingDate=event.date;prior.bookingTime=event.time;
      }
    }
  }
  const pending=[...unique.values()];
  const ordered=[];let station=origin;
  while(pending.length){
    const index=pending.findIndex(e=>e.origin===station);
    const chosen=pending.splice(index<0?0:index,1)[0];
    ordered.push(chosen);
    station=chosen.destination;
  }
  return ordered;
}
export function parseGulfAirParcelsPage(dom,mawbInput){
  const mawb=normalizeMawb(mawbInput);
  if(!mawb?.startsWith('072-'))return {ok:false,reason:'INVALID GULF AIR AWB'};
  const left=String(dom?.leftText||dom?.resultText||'');
  const right=String(dom?.rightText||dom?.resultText||'');
  const all=left+'\n'+right+'\n'+String(dom?.resultText||'');
  const awbPattern=new RegExp('(?:^|\\D)072[\\s-]*'+mawb.slice(4)+'(?:\\D|$)');
  if(!awbPattern.test(all))return {ok:false,reason:'PARCELS RESULT AWB NOT VERIFIED'};
  // Do not use last transit event as destination; require an explicit booking field.
  const origin=airportText(label(right,['From','Origin Airport','Origin']));
  const destination=airportText(label(left,['Final Destination','Booked Destination','Booking Destination','Destination Airport','Destination']))||
    airportText(label(right,['To','Destination Airport','Destination']));
  const pieces=num(label(right,['No. of Bags','Number of Bags','Bags','No. of Pieces','Pieces']));
  const weight=num(label(right,['Gross Weight','Weight']));
  const rawEvents=Array.isArray(dom?.timelineRows)&&dom.timelineRows.length?dom.timelineRows:
    left.split(/(?=\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b)/i).filter(t=>t.length>24);
  const events=rawEvents.map(r=>{const row=clean(r),d=stamp(row),site=row.match(/\b(?:AT|IN|AIRPORT|STATION)\s+([A-Z]{3})\b/i);
    return {...d,code:statusCode(row),station:code(site?.[1]),flightNo:flight(row),description:row.slice(0,400)};})
    .filter(e=>e.code&&e.date);
  if(!events.length&&(!origin||!destination||(!weight&&!pieces)))return {ok:false,reason:'PARCELS RESULT NOT LOADED'};
  const result=resultShipment(mawb,{origin,destination,pieces,weight,events},'public page');
  if(result.ok){
    const legs=bookingFlightLegs(events,origin,destination);
    if(legs.length){
      result.shipment.flightLegs=legs;
      result.shipment.bookedFlights=legs.map(x=>x.flightNo);
      // Prefer the final flight to the booked destination when the
      // page includes multiple connected legs (e.g. GF131 DEL-BAH, GF500 BAH-DXB).
      const last=legs.find(x=>x.destination===destination)||legs.at(-1);
      result.shipment.flightNo=last?.flightNo||result.shipment.flightNo;
      result.shipment.via=legs.map(x=>x.destination)
        .find(x=>x&&x!==origin&&x!==destination)||'';
    }
  }
  if(result.ok){
    // Browser event text uses carrier-local clock; only convert if station is known.
    result.shipment.departureTimeZone='LOCAL';
    result.shipment.departureOrigin=events.find(e=>e.code==='DEP')?.station||origin;
    result.shipment.arrivalTimeZone='LOCAL';
    result.shipment=normalizeShipmentTimesToIst(result.shipment);
    if(Array.isArray(result.shipment.partShipments)){
      result.shipment.partShipments=result.shipment.partShipments.map(part=>
        normalizeShipmentTimesToIst(part));
    }
  }
  return result;
}
async function apiLookup(mawb){
  const key=process.env.PARCELSAPP_API_KEY;
  if(!key)return {ok:false,reason:'PARCELSAPP_API_KEY NOT CONFIGURED'};
  const request=async(url,opt={})=>{
    const resp=await fetch(url,{...opt,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(13000)});
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok)throw Error('Parcels API HTTP '+resp.status+' '+clean(data.error?.code));
    return data;};
  try{
    let data=await request('https://parcelsapp.com/api/v4/trackings',{method:'POST',
      body:JSON.stringify({language:'en',shipments:[{tracking_number:mawb,carrier_hint:'gulf-air-cargo'}]})});
    for(let attempt=0;attempt<5&&!data.done&&data.request_id;attempt++){
      await sleep(800);
      data=await request('https://parcelsapp.com/api/v4/trackings/'+encodeURIComponent(data.request_id));
    }
    return parseGulfAirParcelsApi(data,mawb);
  }catch(e){return {ok:false,reason:'PARCELS API ERROR: '+clean(e.message)};}
}
// Real user-like browser sequence: enter the AWB into the visible field first,
// then activate ParcelsApp's actual submit control. Setting a DOM value followed
// by button.click() alone can fail to trigger the site's reactive input state.
export async function submitGulfAirParcelsForm(page,mawbInput){
  const mawb=normalizeMawb(mawbInput);
  if(!mawb?.startsWith('072-'))return {ok:false,reason:'INVALID GULF AIR MAWB'};
  const digits=mawb.replace('-','');
  const candidates=['input[name="tracking_id"]','input[placeholder="Enter tracking number"]',
    'input[aria-label="Enter tracking number"]','input[name="awbNumber"]'];
  let input=null;
  for(const selector of candidates){
    input=await page.$(selector);
    if(input)break;
  }
  if(!input)return {ok:false,reason:'PARCELS VISIBLE AWB FIELD NOT FOUND'};
  await input.click({clickCount:3});
  // Triple-click selects the existing AWB; Backspace clears it with a real
  // keyboard event. 'Control+A' is not accepted by the Chromium keyboard backend
  // used in production and previously aborted every Gulf Air public lookup.
  await page.keyboard.press('Backspace');
  await page.keyboard.type(digits,{delay:35});
  const actual=await page.evaluate(el=>String(el.value||'').replace(/\D/g,''),input);
  if(actual!==digits)return {ok:false,reason:'PARCELS AWB WAS NOT ENTERED INTO FIELD'};
  // The main ParcelsApp page says "Track package", while the Gulf carrier
  // landing page can say "Track Cargo". Prefer the specifically requested
  // package button rather than clicking the first generic submit control.
  const buttons=['button[data-tracking-submit="true"]','button[type="submit"]',
    'input[type="submit"]'];
  let button=null;
  for(const selector of buttons){
    const candidates=await page.$$(selector);
    for(const candidate of candidates){
      const label=await page.evaluate(el=>(el.innerText||el.value||el.textContent||'').trim(),candidate);
      if(/track\s*package/i.test(label)){button=candidate;break;}
      if(!button&&/track\s*(?:cargo|package)|^\s*track\s*$/i.test(label))button=candidate;
    }
    if(button&&/track\s*package/i.test(await page.evaluate(el=>(el.innerText||el.value||el.textContent||'').trim(),button)))break;
  }
  if(!button){
    // The label varies between "Track package" and "Track Cargo".
    const handle=await page.evaluateHandle(()=>{
      return [...document.querySelectorAll('button,[role="button"]')].find(el=>
        /track\s*(?:package|cargo)|^\s*track\s*$/i.test(el.innerText||el.textContent||''));
    });
    button=handle.asElement();
  }
  if(!button)return {ok:false,reason:'PARCELS TRACK BUTTON NOT FOUND'};
  const buttonLabel=await page.evaluate(el=>(el.innerText||el.value||el.textContent||'').trim(),button);
  try {
    // Track Package normally navigates to /en/tracking/{AWB}. Puppeteer may
    // report a detached frame even though the click has already navigated.
    await button.click({delay:100});
  } catch (e) {
    const nav=/detached Frame|Execution context was destroyed|Navigating frame/i.test(String(e?.message||e));
    const onResult=page.url().includes('/tracking/'+digits);
    if(nav&&onResult)return {ok:true,method:'PHYSICAL_CLICK_NAVIGATED',buttonLabel,awbEntered:digits};
    throw e;
  }
  return {ok:true,method:'PHYSICAL_INPUT_AND_BUTTON_CLICK',buttonLabel,awbEntered:digits};
}
async function publicPageLookup(mawb,startUrl=GULF_PARCELS_URL){
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
      executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:1366,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    // Install network diagnostics BEFORE clicking; the Track button triggers
    // an asynchronous API request which was previously missed in error logs.
    const sourceErrors=[],apiResponses=[];
    page.on('response',async response=>{
      if(!/parcelsapp\.com\/api\/v\d+\/parcels(?:\?|$)/i.test(response.url()))return;
      const status=response.status();
      try{
        const data=await response.json();
        if(data?.error)sourceErrors.push(String(data.error).slice(0,100));
        apiResponses.push({status,error:data?.error||'',hasEvents:Boolean(data?.results?.length)});
      }catch{apiResponses.push({status,error:'UNREADABLE_RESPONSE'});}
    });
    // Enter the AWB on ParcelsApp first, click its real Track package/cargo
    // control, and ONLY THEN read the resulting page and its scrollable history.
    await page.goto(startUrl,{waitUntil:'domcontentloaded',timeout:29000});
    await page.waitForSelector('input[name="tracking_id"],input[placeholder="Enter tracking number"]',
      {visible:true,timeout:12000});
    const submitted=await submitGulfAirParcelsForm(page,mawb);
    // Let the destination page finish replacing the old document context.
    // Avoid reading the AWB entry form after Track Package caused navigation.
    await page.waitForSelector('body',{timeout:10000}).catch(()=>{});
    if(!submitted.ok)return {ok:false,reason:submitted.reason,
      debug:{stage:'PARCELS_AWB_OR_BUTTON',url:page.url()}};
    let dom={},parsed={ok:false,reason:'NO PARCELS TRACKING RESULT'};
    let resultPage=page,readErrors=[];
    const awbDigits=mawb.replace(/\D/g,'');
    for(let attempt=0;attempt<8;attempt++){
      // ParcelsApp can open a separate result tab. Always follow the tab
      // containing this exact AWB rather than reading the original entry form.
      const tabs=(await browser.pages()).filter(p=>!p.isClosed());
      const trackingTab=tabs.find(p=>p.url().includes('/tracking/'+awbDigits));
      const newTab=tabs.find(p=>p!==page&&/^https:\/\/parcelsapp\.com\//i.test(p.url()));
      resultPage=trackingTab||newTab||page;
      await sleep(attempt?1300:2200);
      // Search results appear below the form. Scroll only AFTER Track is clicked.
      await resultPage.evaluate(()=>window.scrollTo(0,Math.round(document.body.scrollHeight*.72))).catch(()=>{});
      await sleep(120);
      try { dom=await resultPage.evaluate(()=>{
        const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
        const txt=e=>(e?.innerText||'').trim();
        const pick=patterns=>patterns.flatMap(p=>[...document.querySelectorAll(p)]).filter(visible).map(txt).filter(t=>t.length>25);
        const sections=pick(['[class*="tracking-result"]','[class*="trackingResult"]','[class*="shipment-result"]','[class*="result-details"]']);
        const body=txt(document.body),resultText=sections.join('\n')||body;
        const left=pick(['[class*="timeline"]','[class*="history"]','[class*="events"]']).sort((a,b)=>b.length-a.length)[0]||resultText;
        const right=pick(['[class*="summary"]','[class*="shipment-details"]','[class*="package-info"]']).sort((a,b)=>b.length-a.length)[0]||resultText;
        const timelineRows=[...document.querySelectorAll('li,tr,[class*="event"]')]
          .filter(visible).map(txt).filter(t=>t.length>12&&t.length<450&&/20\d{2}/.test(t)).slice(0,100);
        return {resultText,leftText:left,rightText:right,timelineRows,bodySample:body.slice(0,500)};
      }); }
      catch(e){
        // The root page transitions into /tracking/<AWB> immediately after
        // pressing Track Package; retry on the new document, not the old frame.
        if(/detached Frame|Execution context was destroyed|Navigating frame/i.test(String(e?.message||e))){
          readErrors.push(String(e?.message||e).slice(0,130));
          await sleep(500);
          continue;
        }
        throw e;
      }
      if(/verify you are human|captcha|cloudflare challenge/i.test(dom.bodySample))
        return {ok:false,reason:'PARCELS HUMAN VERIFICATION REQUIRED',
          debug:{stage:'PARCELS_CHALLENGE',submitted}};
      parsed=parseGulfAirParcelsPage(dom,mawb);
      if(parsed.ok)break;
      // A NO_DATA XHR may arrive before the timeline/summary has settled.
      // Keep polling the rendered results instead of aborting immediately.
    }
    return parsed.ok?{...parsed,debug:{stage:'PARCELS_AWB_VERIFIED',url:resultPage.url(),startUrl,events:parsed.events.length,
        submitMethod:submitted.method,buttonLabel:submitted.buttonLabel}}:
      {ok:false,reason:sourceErrors.includes('NO_DATA')?'PARCELS PUBLIC TRACKER API RETURNED NO_DATA':parsed.reason,
        debug:{stage:'PARCELS_UNVERIFIED',url:resultPage.url(),submitted,
          tabs:(await browser.pages()).filter(p=>!p.isClosed()).map(p=>p.url()).slice(0,5),
          readErrors:readErrors.slice(-2),
          sourceErrors:[...new Set(sourceErrors)].slice(0,5),apiResponses:apiResponses.slice(-3),
          pageSample:dom.bodySample}};
  }catch(e){return {ok:false,reason:'PARCELS BROWSER ERROR '+clean(e.message)};}
  finally{try{await browser?.close()}catch{}}
}
export async function trackGulfAirParcels(input){
  const mawb=normalizeMawb(input);
  if(!mawb?.startsWith('072-'))return {ok:false,reason:'INVALID GULF AIR MAWB'};
  // User-verified ParcelsApp flow: open parcelsapp.com, type the 072 AWB in
  // "Enter tracking number", click the red "TRACK PACKAGE" button, and read
  // the AWB-matched result (including the summary and movement timeline).
  // The carrier landing page is only a fallback when the homepage UI fails.
  const packagePage=await publicPageLookup(mawb,PARCELS_TRACK_PACKAGE_URL);
  if(packagePage.ok)return packagePage;
  // Licensed API, if configured, can recover an inaccessible web form but
  // does not replace the owner's required Track Package browser workflow.
  const api=await apiLookup(mawb);
  if(api.ok)return api;
  // An explicit NO_DATA response means ParcelsApp itself has no result.
  // Do not mislabel an empty form as a live shipment or repeat that request
  // on another URL serving the same tracking backend.
  const noData=/NO_DATA|No information about your package/i.test(packagePage.reason||'')||
    packagePage.debug?.sourceErrors?.includes('NO_DATA');
  if(noData)return {ok:false,reason:'PARCELS PUBLIC TRACKER API RETURNED NO_DATA',
    officialTracker:PARCELS_TRACK_PACKAGE_URL,
    manualHint:'ParcelsApp Track Package currently has no AWB-verified 072 details. Existing Mayavi data is preserved.',
    debug:{stage:'PARCELS_NO_DATA',api:api.reason,packagePageReason:packagePage.reason,
      packagePageDebug:packagePage.debug||{}}};
  const carrierPage=await publicPageLookup(mawb,GULF_PARCELS_URL);
  if(carrierPage.ok)return carrierPage;
  return {ok:false,reason:carrierPage.reason||packagePage.reason||api.reason,
    officialTracker:PARCELS_TRACK_PACKAGE_URL,
    manualHint:'ParcelsApp Track Package and the Gulf Air carrier page did not return AWB-verified details; prior saved data is unchanged.',
    debug:{stage:'PARCELS_NOT_VERIFIED',api:api.reason,packagePageReason:packagePage.reason,
      packagePageDebug:packagePage.debug||{},carrierPageReason:carrierPage.reason,
      carrierPageDebug:carrierPage.debug||{}}};
}
