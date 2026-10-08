import { trackEmirates as trackEmiratesBase } from './emiratesFast.js';
import { readTrackingScreenshot } from './screenshotOcr.js';
import { localAirportTimeToIst } from './exportIst.js';

const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})/);if(m)return `${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}),?\s+(20\d{2})/);if(m)return `${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  m=t.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);if(m)return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return'';
}
function parseTime12(s=''){
  const t=String(s||'').trim().toUpperCase();
  const m=t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);if(!m)return /^\d{1,2}:\d{2}$/.test(t)?t.padStart(5,'0'):'';
  let h=Number(m[1]);if(h===12)h=0;if(m[3]==='PM')h+=12;return `${pad(h)}:${m[2]}`;
}
function headlineArrival(text='',destination=''){
  const dest=String(destination||'').toUpperCase()||'[A-Z]{3}';
  const actual=new RegExp(`Shipment\\s+(?:has\\s+)?arrived\\s+at\\s+${dest}\\s+on\\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+(\\d{1,2}\\s+[A-Za-z]{3}\\s+20\\d{2})\\s+(\\d{1,2}:\\d{2})`,'i').exec(text);
  if(actual){const date=parseDate(actual[1]);if(date)return{date,time:actual[2].padStart(5,'0'),actual:true,source:'arrival headline'};}
  const expected=new RegExp(`Expected\\s+to\\s+arrive\\s+at\\s+${dest}\\s+on\\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+(\\d{1,2}\\s+[A-Za-z]{3}\\s+20\\d{2})\\s+(\\d{1,2}:\\d{2})`,'i').exec(text);
  if(expected){const date=parseDate(expected[1]);if(date)return{date,time:expected[2].padStart(5,'0'),actual:false,source:'expected-arrival headline'};}
  return null;
}
function actualArrMilestone(tracking='',destination=''){
  const dest=String(destination||'').toUpperCase();if(!dest)return null;
  const rx=new RegExp(`\\bARR\\s+${dest},\\s*(\\d{1,2}:\\d{2}\\s*(?:AM|PM)),\\s*([A-Za-z]{3}\\s+\\d{1,2},\\s*20\\d{2})`,'i');
  const m=tracking.match(rx);if(!m)return null;
  const date=parseDate(m[2]),time=parseTime12(m[1]);
  return date&&time?{date,time,actual:true,source:'ARR milestone'}:null;
}
function finalLegMovement(tracking='',destination=''){
  const dest=String(destination||'').toUpperCase();if(!dest)return null;
  const dateToken='(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+[A-Za-z]{3}\\s+\\d{1,2},?\\s+20\\d{2}';
  const rx=new RegExp(`([A-Z]{3})\\s+${dest}\\s+(ATD|ETD)\\s+(\\d{1,2}:\\d{2}),\\s+(ATA|ETA)\\s+(\\d{1,2}:\\d{2}),\\s+(${dateToken})(?:\\s+(${dateToken}))?`,'ig');
  const matches=[...tracking.matchAll(rx)];if(!matches.length)return null;
  const m=matches[matches.length-1];
  const date=parseDate(m[7]||m[6]);if(!date)return null;
  return{
    date,
    time:m[5].padStart(5,'0'),
    actual:String(m[4]).toUpperCase()==='ATA',
    origin:String(m[1]).toUpperCase(),
    departType:String(m[2]).toUpperCase(),
    departTime:m[3].padStart(5,'0'),
    arrivalType:String(m[4]).toUpperCase(),
    source:String(m[4]).toUpperCase()==='ATA'?'final-leg ATA':'final-leg ETA'
  };
}
function finalDestinationArrivalEvidence(tracking='',destination=''){
  const dest=String(destination||'').toUpperCase();if(!dest)return false;
  return new RegExp(`(?:\\bARR\\s+${dest}\\b|\\bRCF\\s+${dest}\\b|Arrived\\s+at\\s+${dest}\\b|Received\\s+at\\s+${dest}\\b|Notified\\s+of\\s+arrival\\s+of\\s+Shipment\\s+at\\s+${dest}\\b)`,'i').test(tracking);
}
function finalFlightNumber(tracking='',destination=''){
  const dest=String(destination||'').toUpperCase();if(!dest)return'';
  const patterns=[
    new RegExp(`(?:Arrived\\s+at\\s+${dest}\\s+on\\s+Flight\\s+EK[- ]?(\\d{2,4}[A-Z]?)|Received\\s+at\\s+${dest}\\s+from\\s+Flight\\s+No\\.\\s*EK[- ]?(\\d{2,4}[A-Z]?))`,'i'),
    new RegExp(`Booked\\s+on\\s+Flight\\s+EK[- ]?(\\d{2,4}[A-Z]?).{0,100}?[A-Z]{3}-${dest}`,'i'),
    new RegExp(`Flight\\s+EK[- ]?(\\d{2,4}[A-Z]?).{0,100}?[A-Z]{3}-${dest}`,'i')
  ];
  for(const rx of patterns){const m=tracking.match(rx);if(m)return`EK${m[1]||m[2]}`;}
  return'';
}
function parseEmiratesMilestones(tracking=''){
  const text=String(tracking||'').replace(/\s+/g,' ').trim();
  const rx=/\b(RCF|ARR|DEP|MAN|RCS|BKD)\s+([A-Z]{3}),\s*(\d{1,2}:\d{2}\s*(?:AM|PM)),\s*([A-Za-z]{3}\s+\d{1,2},\s*20\d{2})([\s\S]*?)(?=\b(?:RCF|ARR|DEP|MAN|RCS|BKD)\s+[A-Z]{3},|$)/gi;
  const out=[],seen=new Set();
  for(const m of text.matchAll(rx)){
    const code=String(m[1]).toUpperCase(),airport=String(m[2]).toUpperCase();
    const date=parseDate(m[4]),time=parseTime12(m[3]),body=String(m[5]||'');
    const qty=[...body.matchAll(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/gi)][0];
    const pieces=qty?Number(qty[1]):0,weight=qty?Number(String(qty[2]).replace(/,/g,'')):0;
    const flightMatch=body.match(/Flight(?:\s+No\.)?\s*EK[- ]?(\d{2,4}[A-Z]?)/i)||body.match(/Flight\s+EK[- ]?(\d{2,4}[A-Z]?)/i);
    const flightNo=flightMatch?`EK${flightMatch[1]}`:'';
    const route=body.match(/\b([A-Z]{3})-([A-Z]{3})\b/);
    const key=[code,airport,date,time,pieces,weight,flightNo].join('|');
    if(seen.has(key))continue;seen.add(key);
    out.push({code,airport,date,time,pieces,weight,flightNo,origin:route?.[1]||'',destination:route?.[2]||''});
  }
  return out;
}
function applyEmiratesPartLoad(shipment={},tracking='',expectedArrival=null){
  const events=parseEmiratesMilestones(tracking);
  if(!events.length)return shipment;
  const masterEvent=[...events].reverse().find(e=>e.code==='RCS'&&e.pieces)||[...events].reverse().find(e=>e.code==='MAN'&&e.pieces)||[...events].reverse().find(e=>e.code==='BKD'&&e.pieces);
  const totalPieces=Number(masterEvent?.pieces||shipment.totalPieces||shipment.pieces||shipment.bags||0);
  const totalWeight=Number(masterEvent?.weight||shipment.totalWeight||shipment.weight||0);
  if(!totalPieces)return shipment;

  // Find a verified physical split: multiple smaller movement quantities at the
  // same station/milestone/date whose pieces add exactly to the master total.
  const groups=new Map();
  for(const e of events.filter(e=>['RCF','ARR','DEP','MAN'].includes(e.code)&&e.pieces>0&&e.pieces<totalPieces)){
    const key=[e.airport,e.code,e.date].join('|');
    if(!groups.has(key))groups.set(key,[]);
    const arr=groups.get(key);
    if(!arr.some(x=>x.time===e.time&&x.pieces===e.pieces&&Math.abs(Number(x.weight||0)-Number(e.weight||0))<.01&&x.flightNo===e.flightNo))arr.push(e);
  }
  const verifiedSplits=[...groups.values()]
    .filter(g=>g.length>=2&&g.reduce((n,e)=>n+Number(e.pieces||0),0)===totalPieces)
    .sort((a,b)=>{
      const at=Math.max(...a.map(e=>Date.parse(`${e.date}T${e.time}:00Z`)||0));
      const bt=Math.max(...b.map(e=>Date.parse(`${e.date}T${e.time}:00Z`)||0));
      return at-bt;
    });
  const split=verifiedSplits.at(-1);
  if(!split)return shipment;

  const finalDest=String(shipment.destination||'').toUpperCase();
  // Shipment-level ETA is not evidence that BOTH portions arrived. It must be
  // mapped to a pending physical part only when its final flight matches.
  const planned=expectedArrival||(shipment.arrivalIsActual!==true&&shipment.arrivalDate&&shipment.arrivalTime
    ?{date:shipment.arrivalDate,time:shipment.arrivalTime}:null);
  const finalFlight=String(shipment.flightNo||'').trim().toUpperCase();
  const partShipments=split.map((base,idx)=>{
    // Follow this exact physical quantity through later milestones. This lets
    // one part become ARRIVED at DEL while the other remains at DXB/in transit.
    const matches=events.filter(e=>{
      if(Number(e.pieces||0)!==Number(base.pieces||0))return false;
      if(base.weight&&e.weight&&Math.abs(Number(e.weight)-Number(base.weight))>.5)return false;
      return ['RCF','ARR','DEP','MAN'].includes(e.code);
    }).sort((a,b)=>`${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    const latest=matches.at(-1)||base;
    // A part is arrived if ANY verified RCF/ARR event for this physical
    // quantity reached the final destination. Do not let a later non-arrival
    // milestone for the same quantity blank its already verified arrival time.
    const finalArrival=[...matches].reverse().find(e=>e.airport===finalDest&&['RCF','ARR'].includes(e.code));
    const atFinal=Boolean(finalArrival);
    const operatingFlight=String(finalArrival?.flightNo||latest.flightNo||base.flightNo||'').trim().toUpperCase();
    const matchingFinalFlight=Boolean(planned?.date&&planned?.time&&
      (!operatingFlight||!finalFlight||operatingFlight===finalFlight));
    // Convert official destination-local timestamps into IST for this tracker.
    const actualIst=atFinal&&finalArrival?.date&&finalArrival?.time
      ?localAirportTimeToIst(finalArrival.date,finalArrival.time,finalDest):null;
    const pendingIst=!atFinal&&matchingFinalFlight
      ?localAirportTimeToIst(planned.date,planned.time,finalDest):null;
    const partArrivalDate=atFinal?(actualIst?.date||finalArrival.date||'')
      :matchingFinalFlight?(pendingIst?.date||planned.date||''):'';
    const partArrivalTime=atFinal?(actualIst?.time||finalArrival.time||'')
      :matchingFinalFlight?(pendingIst?.time||planned.time||''):'';
    return{
      partId:`EK|${base.pieces}|${base.weight}|${idx+1}`,
      partKey:`EK|${base.pieces}|${base.weight}|${idx+1}`,
      pieces:Number(base.pieces||0),
      weight:Number(base.weight||0),
      totalPieces,
      totalWeight,
      flightNo:(finalArrival?.flightNo||latest.flightNo||shipment.flightNo||''),
      flightDate:(finalArrival?.date||latest.date||''),
      arrivalDate:partArrivalDate,
      arrivalTime:partArrivalTime,
      arrivalIsActual:atFinal,
      arrivalEstimate:!atFinal&&Boolean(partArrivalDate&&partArrivalTime),
      arrivalTimeZone:'IST',
      arrivalTimeSource:atFinal?'Emirates part RCF/ARR at final destination'
        :partArrivalDate?'Emirates matching final-flight expected arrival':'',
      status:atFinal?'ARRIVED':latest.code==='DEP'?'DEPARTED':'IN TRANSIT',
      remarks:atFinal?'Part shipment arrived':(partArrivalDate?'Expected flight arrival (part not yet confirmed arrived)':(['RCF','ARR'].includes(latest.code)?`Part shipment received at ${latest.airport}`:'Part shipment in movement')),
      currentAirport:latest.airport||''
    };
  });

  const arrivedRows=partShipments.filter(p=>p.status==='ARRIVED');
  const arrivedPieces=arrivedRows.reduce((n,p)=>n+Number(p.pieces||0),0);
  const arrivedWeight=arrivedRows.reduce((n,p)=>n+Number(p.weight||0),0);
  const pendingPieces=Math.max(0,totalPieces-arrivedPieces);
  const pendingWeight=Math.max(0,totalWeight-arrivedWeight);
  const fullyArrived=arrivedPieces>=totalPieces&&totalPieces>0;
  const partlyArrived=arrivedPieces>0&&!fullyArrived;

  return {
    ...shipment,
    totalPieces,
    totalWeight,
    arrivedPieces,
    arrivedWeight,
    pendingPieces,
    pendingWeight,
    isPartLoad:true,
    partLoad:true,
    partShipments,
    status:fullyArrived?'ARRIVED':partlyArrived?'PART ARRIVED':'IN TRANSIT',
    loadStatus:fullyArrived?`Complete Load Arrived — ${arrivedPieces}/${totalPieces} pcs`:partlyArrived?`Part Arrived — ${arrivedPieces}/${totalPieces} pcs`:`Part Load in transit — ${totalPieces} pcs split into ${partShipments.length} parts`,
    discrepancy:partlyArrived?`Part Load: ${arrivedPieces}/${totalPieces} arrived | Balance ${pendingPieces}/${totalPieces} pcs`:'',
    pieces:partlyArrived?`${arrivedPieces}/${totalPieces}`:String(totalPieces),
    bags:partlyArrived?`${arrivedPieces}/${totalPieces}`:String(totalPieces),
    weight:partlyArrived&&totalWeight?`${arrivedWeight}/${totalWeight}`:(totalWeight||shipment.weight)
  };
}
function normalizeFromPanel(result){
  if(!result?.ok)return result;
  const text=String(result?.debug?.panelSample||result?.debug?.opened?.bodySample||'').replace(/\s+/g,' ').trim();
  const shipment={...(result.shipment||{})};
  if(text){
    const header=text.split(/Tracking Details/i)[0]||text;
    const codes=[...header.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]);if(codes.length>=2){shipment.origin=codes[0];shipment.destination=codes[codes.length-1];}
    const tracking=text.split(/Tracking Details/i)[1]||text;
    const finalDest=String(shipment.destination||'').toUpperCase();

    const pw=tracking.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)||text.match(/\b(\d{1,6})\s+Pieces?\s+([\d,.]+)\s*K(?:G|GS)?\b/i)||text.match(/(?:Pieces?|Pcs?)\s*[:\-]?\s*(\d{1,6})[\s\S]{0,80}?(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)/i);
    if(pw){shipment.pieces=pw[1];shipment.bags=pw[1];shipment.weight=pw[2].replace(/,/g,'');}

    const bookedEvents=[...tracking.matchAll(/\bBKD\s+[A-Z]{3},\s*(\d{1,2}:\d{2}\s*(?:AM|PM)),\s*([A-Za-z]{3}\s+\d{1,2},\s*20\d{2})/gi)]
      .map(m=>({date:parseDate(m[2]),time:parseTime12(m[1])})).filter(x=>x.date&&x.time)
      .sort((a,b)=>`${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    if(bookedEvents.length){shipment.bookingDate=bookedEvents[0].date;shipment.bookingTime=bookedEvents[0].time;shipment.bookingDateSource='Emirates BKD milestone timestamp';}

    const headline=headlineArrival(text,finalDest);
    const finalLeg=finalLegMovement(tracking,finalDest);
    const arrMilestone=actualArrMilestone(tracking,finalDest);
    const finalArrived=finalDestinationArrivalEvidence(tracking,finalDest);
    const actualArrival=headline?.actual?headline:(finalLeg?.actual?finalLeg:arrMilestone);
    const plannedArrival=!actualArrival?(headline&&!headline.actual?headline:(finalLeg&&!finalLeg.actual?finalLeg:null)):null;
    shipment._partExpectedArrival=plannedArrival?{date:plannedArrival.date,time:plannedArrival.time}:null;

    if(actualArrival){
      shipment.arrivalDate=actualArrival.date;
      shipment.arrivalTime=actualArrival.time;
      shipment.arrivalIsActual=true;
      shipment.status='ARRIVED';
      shipment.arrivalEvidence=`Emirates final destination ${finalDest} ${actualArrival.source}`;
    }else if(finalArrived){
      shipment.status='ARRIVED';
      shipment.arrivalIsActual=true;
      shipment.arrivalEvidence=`Emirates final destination ${finalDest} arrival confirmed`;
      if(plannedArrival){shipment.arrivalDate=plannedArrival.date;shipment.arrivalTime=plannedArrival.time;}
      else{delete shipment.arrivalDate;delete shipment.arrivalTime;}
    }else if(plannedArrival){
      shipment.arrivalDate=plannedArrival.date;
      shipment.arrivalTime=plannedArrival.time;
      shipment.arrivalIsActual=false;
      shipment.arrivalEvidence=`Emirates final destination ${finalDest} ${plannedArrival.source}`;
      shipment.status=(finalLeg&&finalLeg.departType==='ATD'&&finalLeg.origin&&finalDest)?'DEPARTED':(/\bDEP\b|Departed\s+to|Departed\s+from|Flight\s+departed/i.test(tracking)?'IN TRANSIT':'BOOKED');
    }else if(/\bDEP\b|Departed\s+to|Departed\s+from|Flight\s+departed/i.test(tracking)){
      shipment.status='IN TRANSIT';shipment.arrivalIsActual=false;delete shipment.arrivalDate;delete shipment.arrivalTime;
    }else if(/\bBKD\b|Booked\s+on\s+Flight/i.test(tracking)){
      shipment.status='BOOKED';shipment.arrivalIsActual=false;delete shipment.arrivalDate;delete shipment.arrivalTime;
    }else{
      delete shipment.arrivalDate;delete shipment.arrivalTime;delete shipment.arrivalIsActual;
    }

    const finalFlight=finalFlightNumber(tracking,finalDest);if(finalFlight)shipment.flightNo=finalFlight;
  }
  if(shipment.status==='ARRIVED'&&shipment.arrivalIsActual===false)shipment.status='IN TRANSIT';
  if(text){
    const tracking=text.split(/Tracking Details/i)[1]||text;
    Object.assign(shipment,applyEmiratesPartLoad(shipment,tracking,shipment._partExpectedArrival));
    delete shipment._partExpectedArrival;
  }
  shipment.source=text?'Emirates eSkyCargo Tracking Details screenshot + rendered text':shipment.source||'Emirates eSkyCargo official tracking';
  return {...result,shipment};
}
function hasConcreteDetails(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.bags||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||s.status==='ARRIVED'||s.status==='DELIVERED'||s.status==='DEPARTED'||s.status==='IN TRANSIT');}
export async function trackEmirates(mawb){
  let result=normalizeFromPanel(await trackEmiratesBase(mawb));
  if(!result?.ok||!result?.screenshotBase64||hasConcreteDetails(result.shipment))return result;
  const ocr=await readTrackingScreenshot({mawb,screenshotBase64:result.screenshotBase64,timeoutMs:25000});if(!ocr?.ok)return result;
  const base={...(result.shipment||{})},shot=ocr.shipment||{};
  for(const key of ['origin','destination','pieces','bags','weight','flightNo','bookingDate'])if(!base[key]&&shot[key])base[key]=shot[key];
  if((!base.status||base.status==='TRACKING')&&shot.status)base.status=shot.status;
  base.source='Emirates eSkyCargo Tracking Details screenshot OCR + rendered text';
  return {...result,shipment:base,screenshotOcrUsed:true,debug:{...(result.debug||{}),ocr:ocr.debug||null}};
}
