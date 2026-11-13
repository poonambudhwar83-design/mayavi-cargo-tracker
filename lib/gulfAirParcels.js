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
  // Prefer the airline's explicit movement code to prose. ParcelsApp can say
  // 'Departed on flight (KK)' while KK is a booking confirmation, not DEP.
  const eventCode=t.match(/\((DLV|RCF|ARR|DEP|OFF|MAN|PRE|RCS|BKD|KK)\)/)?.[1];
  if(eventCode==='KK'||eventCode==='BKD')return 'BKD';
  if(eventCode==='PRE')return 'MAN';
  if(eventCode)return eventCode;
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
// ParcelsApp tracking IDs must be the full 11 digits, WITHOUT the Mayavi
// display separator (e.g. 07295019411, never 072-95019411).
export function parcelsTrackingDigits(mawbInput){
  const mawb=normalizeMawb(mawbInput);
  return mawb?.startsWith('072-')?mawb.replace(/\D/g,''):'';
}
const attr=(s,label)=>clean((s.attributes||[]).find(a=>clean(a.l||a.name||a.label).toLowerCase()===label.toLowerCase())?.val||'');

// A Gulf 072 MAWB can contain two different physical quantities on two flights.
// BKD, MAN, PRE and DEP for the SAME flight and quantity are progress events,
// never extra bags. Connecting full-load flights are also not a split load.
export function gulfPartsFromEvents(shipment,events=[],timeZone='LOCAL'){
  const totalPieces=Number(num(shipment.pieces)),totalWeight=Number(num(shipment.weight));
  if(!totalPieces||!totalWeight||!Array.isArray(events))return shipment;
  const priorities={DLV:8,ARR:7,RCF:6,DEP:5,OFF:4,MAN:3,BKD:2,RCS:1};
  const candidates=new Map(),histories=new Map();
  for(const e of events){
    const description=String(e.description||'');
    const pieces=Number(num(e.pieces||description.match(/\bpieces\s*:\s*([\d,.]+)/i)?.[1]));
    const weight=Number(num(e.weight||description.match(/\bweight\s*:\s*([\d,.]+)/i)?.[1]));
    const flightNo=e.flightNo||flight(description);
    if(!pieces||!weight||pieces>=totalPieces||weight>=totalWeight||!flightNo)continue;
    // The same 24-piece movement may be listed as BKD, PRE, MAN and DEP.
    // The stable flight+quantity+weight key deduplicates progress events without
    // accidentally merging equally sized physical parts on different flights.
    const key=flightNo+'|'+pieces+'|'+weight.toFixed(3);
    const prev=candidates.get(key);
    const rank=priorities[e.code]||0;
    const next={...e,pieces,weight,flightNo,rank};
    // Keep the full movement chronology for each physical load. Choosing ARR
    // as the latest status must not discard an earlier actual DEP timestamp.
    histories.set(key,[...(histories.get(key)||[]),next]);
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
      // An ARR station is the destination, never the flight's departure origin.
      const from=(to?airports.filter(v=>v!==to).at(-1):'')||
        (p.code==='DEP'?p.station:'')||shipment.origin||'';
      // A flight's departure is not a destination cargo ARR. Intermediate
      // RCF is only a transit receipt unless its station is the final airport.
      const history=histories.get(p.flightNo+'|'+p.pieces+'|'+p.weight.toFixed(3))||[p];
      const newest=events=>events.sort((a,b)=>
        (a.date+a.time).localeCompare(b.date+b.time)).at(-1);
      const actualDeparture=newest(history.filter(e=>e.code==='DEP'));
      const actualArrival=newest(history.filter(e=>
        ['ARR','RCF','DLV'].includes(e.code)&&
        Boolean(shipment.destination&&e.station===shipment.destination)));
      const arrived=Boolean(actualArrival);
      const dep=Boolean(actualDeparture);
      const status=arrived?'ARRIVED':dep?'DEPARTED':p.code==='OFF'?'OFFLOADED':
        p.code==='MAN'?'MANIFESTED':'BOOKED';
      // Preserve existing part IDs for unambiguous quantities; adding flight
      // only for equal-sized split flights avoids losing operator Mail/Customs.
      const sameQuantity=physical.filter(q=>q.pieces===p.pieces&&
        Math.abs(q.weight-p.weight)<0.001).length;
      const id=['GF',...(sameQuantity>1?[p.flightNo]:[]),p.pieces,p.weight.toFixed(3)].join('|');
      return{
        partKey:id,partId:id,pieces:p.pieces,weight:p.weight,
        totalPieces,totalWeight,flightNo:p.flightNo,
        flightDate:p.date||'',flightOrigin:from,flightDestination:to,
        departureOrigin:from,
        departureDate:dep?actualDeparture.date||'':'',departureTime:dep?actualDeparture.time||'':'',
        departureTimeZone:timeZone,departureIsActual:dep,
        arrivalDate:arrived?actualArrival.date||'':'',arrivalTime:arrived?actualArrival.time||'':'',
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
    // A single part arriving at DEL is not a full 55-piece master arrival.
    ...(arrivedPieces<totalPieces?{arrivalDate:'',arrivalTime:'',arrivalIsActual:false}:{}),
    status:arrivedPieces===totalPieces?'ARRIVED':arrivedPieces>0?'PART ARRIVED':
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
  // The AWB may appear only in the input field on an empty results page.
  // Never classify marketing/news text (which also contains dates and words
  // such as "delivered") as cargo movement without a real AWB summary.
  if(!origin||!destination||(!pieces&&!weight))
    return {ok:false,reason:'PARCELS RESULT HAS NO AWB-VERIFIED SHIPMENT SUMMARY'};
  const rawEvents=Array.isArray(dom?.timelineRows)&&dom.timelineRows.length?dom.timelineRows:
    left.split(/(?=\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b)/i).filter(t=>t.length>24);
  const events=rawEvents.map(r=>{
    const row=clean(r),d=stamp(row),state=statusCode(row);
    const explicit=row.match(/\b(?:AT|IN|AIRPORT|STATION)\s+([A-Z]{3})\b/i)?.[1]||
      row.match(/\b(?:AT|IN)\s+[^()]{1,70}\(([A-Z]{3})\)/i)?.[1];
    const flightDestination=code(row.match(/\bFlight\s+GF[\s-]?\d{2,4}\s+to\b[^\n]{0,115}?\(([A-Z]{3})\)/i)?.[1]);
    const airports=[...row.matchAll(/\(([A-Z]{3})\)/gi)].map(m=>code(m[1])).filter(Boolean);
    const flightOrigin=airports.filter(v=>v!==flightDestination).at(-1)||'';
    // ParcelsApp commonly prints airport names (DEL)/(BAH), not "at DEL".
    // ARR on a final-flight card is at its TO airport; DEP is at its FROM airport.
    const station=code(explicit)||( ['ARR','RCF','DLV'].includes(state)?flightDestination:
      state==='DEP'?flightOrigin:'');
    return {...d,code:state,station,flightNo:flight(row),description:row.slice(0,400)};
  })
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
    // ParcelsApp's licensed v4 contract is different from its public form:
    // the homepage wants all 11 digits without punctuation, while API v4
    // requires the carrier's 3+8 hyphenated AWB to select the right service.
    // See https://parcelsapp.com/api-docs/openapi.json
    const trackingNumber=mawb;
    let data=await request('https://parcelsapp.com/api/v4/trackings',{method:'POST',
      body:JSON.stringify({language:'en',shipments:[{tracking_number:trackingNumber,carrier_hint:'gulf-air-cargo'}]})});
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
  const digits=parcelsTrackingDigits(mawb);
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
  // Check the literal text, not just the stripped digits. A hyphen or any
  // other character in the actual HTML input is a failed Gulf submission.
  const actual=await page.evaluate(el=>String(el.value||''),input);
  if(actual!==digits)return {ok:false,reason:'PARCELS AWB MUST BE EXACTLY 11 DIGITS, NO HYPHEN'};
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

// ParcelsApp may render only the first few Gulf Air movement cards until the
// user scrolls. Walk the FULL document and any nested history scroller, retaining
// rows seen at every position (virtualized history rows can disappear on scroll).
// This is Gulf-only and never clicks another carrier's tracker.
export async function collectGulfAirParcelsHistory(page){
  const seen=new Set();
  let bottomPasses=0,previousLength=-1;
  for(let step=0;step<22;step++){
    const frame=await page.evaluate((step)=>{
      const visible=el=>{
        const style=getComputedStyle(el);
        return style.display!=='none'&&style.visibility!=='hidden'&&
          el.getClientRects().length>0;
      };
      const rows=[...document.querySelectorAll(
        'li,tr,[class*="event"],[class*="Event"],[class*="history"] [class*="item"],[class*="timeline"] [class*="item"]'
      )].filter(visible).map(el=>(el.innerText||'').trim())
        .filter(x=>x.length>24&&x.length<800&&
          /20\d{2}/.test(x)&&/\b(?:GF\s*[-]?\s*\d{2,4}|DEP|DEPARTED|BKD|BOOKED|MAN|ARR|RCF)\b/i.test(x));
      const controls=[...document.querySelectorAll('button,[role="button"]')]
        .filter(visible).filter(el=>/^(?:show more|show all|load more|view more|more tracking events|show older)(?:\s+(?:events|history|updates|tracking))?\s*$/i
          .test((el.innerText||el.textContent||'').trim()));
      if(controls.length)controls[0].click();
      const root=document.scrollingElement||document.documentElement;
      const before=root.scrollTop,viewport=Math.max(window.innerHeight||0,root.clientHeight||0,1);
      // Start at the top and advance one viewport per step to trigger lazy loads.
      root.scrollTop=Math.min(root.scrollHeight,step*viewport);
      window.scrollTo(0,Math.min(root.scrollHeight,step*viewport));
      const nested=[...document.querySelectorAll('[class*="timeline"],[class*="history"],[class*="tracking"],[class*="event"]')]
        .filter(el=>el.scrollHeight>el.clientHeight+80&&el.clientHeight>60);
      for(const el of nested)el.scrollTop=Math.min(el.scrollHeight,step*Math.max(200,el.clientHeight-80));
      const bottom=root.scrollTop+viewport>=root.scrollHeight-15&&
        nested.every(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-15);
      return {rows,bottom,scrollHeight:root.scrollHeight,scrollTop:root.scrollTop,
        nested:nested.length,expanded:controls.length,before};
    },step);
    for(const row of frame.rows)seen.add(row);
    if(frame.bottom&&frame.expanded===0&&seen.size===previousLength)bottomPasses++;
    else bottomPasses=0;
    if(bottomPasses>=2)break;
    previousLength=seen.size;
    await sleep(170);
  }
  return [...seen];
}

async function publicPageLookup(mawb,startUrl=GULF_PARCELS_URL){
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US'],
      executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:1366,height:1000}});
    const page=await browser.newPage();
    // Chromium Lambda locales may resolve to "en-US@posix", which breaks
    // ParcelsApp's Date.toLocaleDateString and can prevent the result UI
    // from ever rendering. Force a standards-compliant locale before scripts.
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.evaluateOnNewDocument(()=>{
      Object.defineProperty(navigator,'language',{get:()=> 'en-US'});
      Object.defineProperty(navigator,'languages',{get:()=> ['en-US','en']});
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    // Install network diagnostics BEFORE clicking; the Track button triggers
    // an asynchronous API request which was previously missed in error logs.
    const sourceErrors=[],apiResponses=[],submittedTracking=[],apiCalls=[];
    // Gulf-only request diagnostics: identify whether the browser actually
    // submitted the exact 11-digit number, without recording other payloads.
    page.on('request',request=>{
      const url=request.url();
      if(!/^https:\/\/(?:[^/]+\.)?parcelsapp\.com\/api\//i.test(url))return;
      const body=String(request.postData()||'');
      const digits=parcelsTrackingDigits(mawb);
      const parsedUrl=new URL(url);
      let payloadKeys=[];
      try{
        const parsed=JSON.parse(body);
        if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))
          payloadKeys=Object.keys(parsed).slice(0,12);
      }catch{}
      const record={
        path:parsedUrl.pathname,method:request.method(),queryKeys:[...parsedUrl.searchParams.keys()].slice(0,12),
        bodyLength:body.length,bodyType:body.startsWith('{')?'JSON':body?'OTHER':'EMPTY',
        payloadKeys,fullElevenDigits:body.includes(digits)||url.includes(digits),
        hyphenated:body.includes(mawb)||url.includes(mawb)
      };
      apiCalls.push(record);
      if(/\/api\/v\d+\/parcels(?:\?|$)/i.test(url))
        submittedTracking.push({fullElevenDigits:record.fullElevenDigits,hyphenated:record.hyphenated});
    });
    page.on('response',async response=>{
      if(!/parcelsapp\.com\/api\/v\d+\/parcels(?:\?|$)/i.test(response.url()))return;
      const status=response.status();
      try{
        const data=await response.json();
        if(data?.error)sourceErrors.push(String(data.error).slice(0,100));
        apiResponses.push({status,error:data?.error||'',hasEvents:Boolean(data?.results?.length)});
      }catch{apiResponses.push({status,error:'UNREADABLE_RESPONSE'});}
    });
    // A Parcels /tracking/{AWB} permalink is NOT a completed result: it
    // pre-fills the tracking number but still requires Track Package to submit.
    // Always click the actual Parcels button in the server-side Mayavi browser,
    // including when opening the direct details link; the user never has to
    // open another tab or send a screenshot.
    await page.goto(startUrl,{waitUntil:'domcontentloaded',timeout:29000});
    await page.waitForSelector('input[name="tracking_id"],input[placeholder="Enter tracking number"]',
      {visible:true,timeout:12000});
    const submitted=await submitGulfAirParcelsForm(page,mawb);
    // Let the destination page finish replacing the old document context.
    await page.waitForSelector('body',{timeout:10000}).catch(()=>{});
    if(!submitted.ok)return {ok:false,reason:submitted.reason,
      debug:{stage:'PARCELS_AWB_OR_BUTTON',url:page.url()}};
    let dom={},parsed={ok:false,reason:'NO PARCELS TRACKING RESULT'};
    let resultPage=page,readErrors=[];
    const awbDigits=parcelsTrackingDigits(mawb);
    for(let attempt=0;attempt<8;attempt++){
      // ParcelsApp can open a separate result tab. Always follow the tab
      // containing this exact AWB rather than reading the original entry form.
      const tabs=(await browser.pages()).filter(p=>!p.isClosed());
      const trackingTab=tabs.find(p=>p.url().includes('/tracking/'+awbDigits));
      const newTab=tabs.find(p=>p!==page&&/^https:\/\/parcelsapp\.com\//i.test(p.url()));
      resultPage=trackingTab||newTab||page;
      await sleep(attempt?1300:2200);
      // Do not read only the first visible flight card. Scroll the complete
      // tracking history before classifying the 24/55 and 31/55 physical loads.
      // This also captures older/lazy-rendered GF134 departure entries.
      let scrolledRows=[];
      try{scrolledRows=await collectGulfAirParcelsHistory(resultPage);}
      catch(e){
        if(/Target closed|detached Frame|Execution context was destroyed/i.test(String(e?.message||e))){
          readErrors.push(String(e?.message||e).slice(0,130));
          await sleep(400);
          continue;
        }
        throw e;
      }
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
      // Preserve all cards observed while scrolling, including virtualized
      // entries that no longer exist at the bottom of the page.
      dom.timelineRows=[...new Set([...(dom.timelineRows||[]),...scrolledRows])];
      if(/verify you are human|captcha|cloudflare challenge/i.test(dom.bodySample))
        return {ok:false,reason:'PARCELS HUMAN VERIFICATION REQUIRED',
          debug:{stage:'PARCELS_CHALLENGE',submitted}};
      parsed=parseGulfAirParcelsPage(dom,mawb);
      // The summary can load before the final timeline. Do not consider a
      // successful parse of summary-only text a complete movement read.
      if(parsed.ok&&parsed.events.length>0&&scrolledRows.length>0)break;
      // A NO_DATA XHR may arrive before the timeline/summary has settled.
      // Allow the client-side result to settle, then try the carrier-specific
      // page rather than repeatedly polling an already empty result.
      if(attempt>=2&&sourceErrors.includes('NO_DATA')&&
        /No information about your package/i.test(dom.resultText||''))break;
    }
    return parsed.ok?{...parsed,debug:{stage:'PARCELS_AWB_VERIFIED',url:resultPage.url(),startUrl,events:parsed.events.length,
        submitMethod:submitted.method,buttonLabel:submitted.buttonLabel}}:
      {ok:false,reason:sourceErrors.includes('NO_DATA')?'PARCELS PUBLIC TRACKER API RETURNED NO_DATA':parsed.reason,
        debug:{stage:'PARCELS_UNVERIFIED',url:resultPage.url(),submitted,
          tabs:(await browser.pages()).filter(p=>!p.isClosed()).map(p=>p.url()).slice(0,5),
          readErrors:readErrors.slice(-2),
          sourceErrors:[...new Set(sourceErrors)].slice(0,5),apiResponses:apiResponses.slice(-3),
          submittedTracking:submittedTracking.slice(-3),apiCalls:apiCalls.slice(-12),
          pageSample:dom.bodySample}};
  }catch(e){return {ok:false,reason:'PARCELS BROWSER ERROR '+clean(e.message)};}
  finally{try{await browser?.close()}catch{}}
}
export async function trackGulfAirParcels(input){
  const mawb=normalizeMawb(input);
  if(!parcelsTrackingDigits(mawb))return {ok:false,reason:'INVALID GULF AIR MAWB'};
  // Open the same AWB-specific Parcels details URL used by Mayavi's
  // PARCELS LIVE link, then read its full (possibly lazy-loaded) history.
  // This is a separate server-side browser: cross-origin browser tabs are
  // intentionally not accessible to JavaScript running inside Mayavi.
  const detailsUrl='https://parcelsapp.com/en/tracking/'+parcelsTrackingDigits(mawb);
  const directPage=await publicPageLookup(mawb,detailsUrl);
  if(directPage.ok)return directPage;
  // If Parcels did not expose a verified summary at the direct URL, use the
  // homepage's visible Track Package control and Gulf carrier fallback.
  const packagePage=await publicPageLookup(mawb,PARCELS_TRACK_PACKAGE_URL);
  if(packagePage.ok)return packagePage;
  // Licensed API, if configured, can recover an inaccessible web form but
  // does not replace the owner's required Track Package browser workflow.
  const api=await apiLookup(mawb);
  if(api.ok)return api;
  // The homepage's generic /api/v2/parcels lookup can return NO_DATA
  // even when the airline-specific page knows the 072 carrier. Always test
  // the Gulf Air carrier route after the Track Package result, without a
  // bridge or any cached/manual shipment data.
  const noData=/NO_DATA|No information about your package/i.test(packagePage.reason||'')||
    packagePage.debug?.sourceErrors?.includes('NO_DATA');
  const carrierPage=await publicPageLookup(mawb,GULF_PARCELS_URL);
  if(carrierPage.ok)return carrierPage;
  if(noData)return {ok:false,reason:'PARCELS PUBLIC TRACKER API RETURNED NO_DATA',
    officialTracker:PARCELS_TRACK_PACKAGE_URL,
    manualHint:'Neither ParcelsApp entry point returned AWB-verified 072 details. Existing Mayavi shipment data is preserved.',
    debug:{stage:'PARCELS_NO_DATA_BOTH_ROUTES',directPageReason:directPage.reason,
      directPageDebug:directPage.debug||{},api:api.reason,packagePageReason:packagePage.reason,
      packagePageDebug:packagePage.debug||{},carrierPageReason:carrierPage.reason,
      carrierPageDebug:carrierPage.debug||{}}};
  return {ok:false,reason:carrierPage.reason||packagePage.reason||api.reason,
    officialTracker:PARCELS_TRACK_PACKAGE_URL,
    manualHint:'ParcelsApp Track Package and the Gulf Air carrier page did not return AWB-verified details; prior saved data is unchanged.',
    debug:{stage:'PARCELS_NOT_VERIFIED',directPageReason:directPage.reason,
      directPageDebug:directPage.debug||{},api:api.reason,packagePageReason:packagePage.reason,
      packagePageDebug:packagePage.debug||{},carrierPageReason:carrierPage.reason,
      carrierPageDebug:carrierPage.debug||{}}};
}
