// 098 Air India: reconcile official Tracking View split rows with Activity View
// physical movements. Planned aircraft arrival is never cargo arrival proof.
import { localAirportTimeToIst } from './exportIst.js';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const num=v=>Number(String(v??'').replace(/,/g,''));
const norm=v=>String(v||'').replace(/\s+/g,' ').trim();
const pad=v=>String(v).padStart(2,'0');
const dt=v=>{const m=String(v||'').match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})/i);return m?m[3]+'-'+MONTH[m[2].slice(0,3).toUpperCase()]+'-'+pad(m[1]):''};
const tm=v=>/^\d{1,2}:\d{2}$/.test(String(v||''))?pad(v):'';
const toIst=(d,t,station)=>d&&t?(localAirportTimeToIst(d,t,station)||{date:d,time:t}):null;
const sum=(parts,key)=>parts.reduce((a,b)=>a+(Number(b[key])||0),0);
const flight=(carrier,number)=>number?String(carrier||'').toUpperCase()+number:'';
const flightRows=/\b(AI|IX)\s*-?\s*(\d{2,4})?\s+Departure:\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2}|--:--)\s*\(([SEA])\)\s+([A-Z]{3})\s*[–-]\s*([A-Z]{3})\s+Arrival:\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2}|--:--)\s*\(([SEA])\)\s*(\d{1,6})\s+pcs\b/gi;
const bookedRows=/\bBOOKED\s+Booked\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\s+at\s+([A-Z]{3})\s+for\s+(AI|IX)\s*-?\s*(\d{2,4})?\s*,?\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})/gi;
const movedRows=/\b(DEPARTURE\s+Departed|ARRIVAL\s+Arrived)\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg[\s\S]{0,95}?\bon\s+(AI|IX)\s*-?\s*(\d{2,4})\s*,\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(A\)\s+at\s+([A-Z]{3})\b/gi;
const offloadRows=/\bOFFLOADED\s+Offloaded\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\s+for\s+(AI|IX)\s*-?\s*(\d{2,4})\s*,\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+at\s+([A-Z]{3})\b/gi;
const manifestRows=/\bMANIFESTED\s+Manifested\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\s+for\s+(AI|IX)\s*-?\s*(\d{2,4})\s*,\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+at\s+([A-Z]{3})\b/gi;
function dedupe(rows){
  const seen=new Set();return rows.filter(r=>{const k=[r.type,r.pieces,r.weight,r.flightNo,r.flightDate,r.time,r.station].join('|');if(seen.has(k))return false;seen.add(k);return true});
}
function completeSplit(rows,total){
  const valid=rows.filter(p=>p.pieces>0&&p.pieces<total);
  return valid.length>=2&&sum(valid,'pieces')===total?valid:[];
}
export function reconcileAirIndiaPartLoads(shipment={},trackingText='',activityText=''){
  const awb=String(shipment.mawb||'').replace(/\D/g,'');
  if(!/^098\d{8}$/.test(awb))return null;
  const shown=String(trackingText||'').match(/\b098[- ]?\d{8}\b/);
  if(!shown||shown[0].replace(/\D/g,'')!==awb)return null;
  const index=String(activityText||'').search(/AWB\s+Activity\s+Timeline/i);
  if(index<0)return null;
  const timeline=String(activityText).slice(index);
  const tracking=String(trackingText).split(/AWB\s+Activity\s+Timeline/i)[0];
  const master=num(shipment.masterPieces||shipment.totalPieces||shipment.pieces||shipment.bags);
  const masterKg=num(shipment.masterWeight||shipment.totalWeight||shipment.weight);
  if(!Number.isInteger(master)||master<=1)return null;
  const origin=String(shipment.origin||'').toUpperCase(),dest=String(shipment.destination||'').toUpperCase();
  const legs=dedupe([...tracking.matchAll(flightRows)].map(m=>({
    type:'TRACKING',pieces:num(m[11]),weight:null,flightNo:flight(m[1],m[2]),flightDate:dt(m[3]),
    origin:m[6].toUpperCase(),dest:m[7].toUpperCase(),etaDate:dt(m[8]),etaTime:tm(m[9]),etaTag:m[10],evidence:norm(m[0])
  })).filter(p=>p.flightDate&&(!origin||p.origin===origin)&&(!dest||p.dest===dest)));
  const bookings=dedupe([...timeline.matchAll(bookedRows)].map(m=>({
    type:'BOOKED',pieces:num(m[1]),weight:num(m[2]),flightNo:flight(m[4],m[5]),flightDate:dt(m[6]),
    origin:m[3].toUpperCase(),evidence:norm(m[0])
  })).filter(p=>p.flightDate));
  // Require independently confirmed component quantities adding to the master.
  // Never create a residual part by subtraction from a full-master DEP event.
  const split=completeSplit(legs,master).length?completeSplit(legs,master):completeSplit(bookings,master);
  if(split.length<2)return null;
  const parts=split.map(p=>{
    const same=bookings.filter(b=>b.pieces===p.pieces);
    const booking=same.find(b=>p.flightNo&&p.flightNo===b.flightNo&&p.flightDate===b.flightDate)
      ||(same.length===1?same[0]:null);
    return {pieces:p.pieces,weight:booking?.weight>0?booking.weight:(p.weight>0?p.weight:null),
      flightNo:p.flightNo||booking?.flightNo||'',flightDate:p.flightDate||booking?.flightDate||'',
      etaDate:p.etaDate||'',etaTime:p.etaTime||'',etaTag:p.etaTag||'',
      status:'BOOKED',movement:null,bookingEvidence:booking?.evidence||p.evidence};
  });
  const moves=[
    ...[...timeline.matchAll(movedRows)].map(m=>({
      type:/^ARRIVAL/i.test(m[1])?'ARRIVED':'DEPARTED',pieces:num(m[2]),weight:num(m[3]),
      flightNo:flight(m[4],m[5]),flightDate:dt(m[6]),time:tm(m[7]),station:m[8].toUpperCase(),
      order:m.index,evidence:norm(m[0])
    })),
    ...[...timeline.matchAll(offloadRows)].map(m=>({
      type:'OFFLOADED',pieces:num(m[1]),weight:num(m[2]),flightNo:flight(m[3],m[4]),
      flightDate:dt(m[5]),station:m[6].toUpperCase(),order:m.index,evidence:norm(m[0])
    })),
    ...[...timeline.matchAll(manifestRows)].map(m=>({
      type:'MANIFESTED',pieces:num(m[1]),weight:num(m[2]),flightNo:flight(m[3],m[4]),
      flightDate:dt(m[5]),station:m[6].toUpperCase(),order:m.index,evidence:norm(m[0])
    }))
  ].filter(m=>m.type!=='ARRIVED'||!dest||m.station===dest);
  const distinct=dedupe(moves);
  for(const p of parts){
    const samePieces=parts.filter(x=>x.pieces===p.pieces);
    const applicable=distinct.filter(e=>e.pieces===p.pieces&&(
      samePieces.length===1||
      (e.weight>0&&p.weight>0&&Math.abs(e.weight-p.weight)<0.11)||
      (e.flightNo&&p.flightNo===e.flightNo&&p.flightDate===e.flightDate)
    )).sort((a,b)=>a.order-b.order);
    const latest=applicable[0];
    if(!latest)continue;
    p.movement=latest;p.status=latest.type;
    if((latest.type==='DEPARTED'||latest.type==='ARRIVED')&&latest.weight>0)p.weight=latest.weight;
    if((latest.type==='DEPARTED'||latest.type==='ARRIVED')&&latest.flightNo)p.flightNo=latest.flightNo;
    if(latest.type==='DEPARTED'||latest.type==='ARRIVED')p.flightDate=latest.flightDate;
  }
  // Stable order avoids shifting a per-part Mail/Customs click on refresh.
  parts.sort((a,b)=>a.pieces-b.pieces||String(a.weight||'').localeCompare(String(b.weight||'')));
  const physical=parts.map((p,i)=>{
    const arrived=p.status==='ARRIVED',departed=p.status==='DEPARTED',offloaded=p.status==='OFFLOADED';
    const actual=arrived?toIst(p.movement.flightDate,p.movement.time,p.movement.station):null;
    const dep=departed?toIst(p.movement.flightDate,p.movement.time,p.movement.station):null;
    const eta=!arrived&&!offloaded&&p.flightNo&&p.etaDate&&p.etaTime?toIst(p.etaDate,p.etaTime,dest||'DEL'):null;
    return {
      partId:'P'+(i+1),pieces:String(p.pieces),bags:String(p.pieces),weight:p.weight>0?String(p.weight):'',
      totalPieces:String(master),totalWeight:masterKg>0?String(masterKg):'',
      flightNo:p.flightNo,flightDate:p.flightDate,origin,destination:dest,status:p.status,
      departureIsActual:departed,departureDate:dep?.date||'',departureTime:dep?.time||'',departureTimeZone:dep?'IST':'',
      arrivalIsActual:arrived,arrivalDate:actual?.date||eta?.date||'',arrivalTime:actual?.time||eta?.time||'',
      arrivalEstimate:!arrived&&Boolean(eta),arrivalTimeZone:actual||eta?'IST':'',
      arrivalTimeSource:arrived?'Air India Activity View confirmed cargo arrival':
        eta?'Air India Tracking View aircraft ETA; cargo arrival unconfirmed':'',
      remarks:offloaded?'OFFLOADED: 0 kg in event is not an actual weight':
        departed?'DEPARTED: cargo movement verified':arrived?'ARRIVED: cargo arrival verified':
        'BOOKED/MANIFESTED: actual departure not verified',
      activityEvidence:p.movement?.evidence||'',bookingEvidence:p.bookingEvidence
    };
  });
  const arrived=physical.filter(p=>p.arrivalIsActual);
  const departed=physical.filter(p=>p.departureIsActual);
  const offloaded=physical.filter(p=>p.status==='OFFLOADED');
  const pending=physical.filter(p=>!p.arrivalIsActual&&!p.departureIsActual);
  const status=arrived.length?(arrived.length===physical.length?'ARRIVED':'PART ARRIVED'):
    departed.length?(departed.length===physical.length?'DEPARTED':'PART DEPARTED'):
    offloaded.length?(offloaded.length===physical.length?'OFFLOADED':'PART OFFLOADED'):
    physical.some(p=>p.status==='MANIFESTED')?'MANIFESTED':'BOOKED';
  const active=arrived.at(-1)||departed.at(-1)||physical.find(p=>p.status==='MANIFESTED')||physical.at(-1);
  const etaParts=physical.filter(p=>p.arrivalEstimate&&p.arrivalDate&&p.arrivalTime);
  const eta=etaParts.length===1?etaParts[0]:null;
  const displayArrival=arrived.at(-1)||eta;
  return {
    ...shipment,isPartLoad:true,partLoad:true,airIndiaPartReconciled:true,
    partShipments:physical,pieces:String(master),bags:String(master),
    weight:masterKg>0?String(masterKg):shipment.weight||'',masterPieces:String(master),
    masterWeight:masterKg>0?String(masterKg):shipment.masterWeight||'',
    totalPieces:String(master),totalWeight:masterKg>0?String(masterKg):'',
    arrivedPieces:String(sum(arrived,'pieces')),arrivedWeight:String(sum(arrived,'weight')),
    departedPieces:String(sum(departed,'pieces')),departedWeight:String(sum(departed,'weight')),
    pendingPieces:String(sum(pending,'pieces')),pendingWeight:String(sum(pending,'weight')),
    offloadedPieces:String(sum(offloaded,'pieces')),offloadedWeight:'',
    remainingPieces:String(master-sum(arrived,'pieces')),remainingWeight:'',
    status,flightNo:active?.flightNo||'',flightDate:active?.flightDate||'',
    departureIsActual:departed.length>0,departureDate:departed.at(-1)?.departureDate||'',
    departureTime:departed.at(-1)?.departureTime||'',departureTimeZone:departed.length?'IST':'',
    arrivalDate:displayArrival?.arrivalDate||'',arrivalTime:displayArrival?.arrivalTime||'',
    scheduledArrivalDate:eta?.arrivalDate||'',scheduledArrivalTime:eta?.arrivalTime||'',
    arrivalIsActual:arrived.length>0,arrivalEstimate:arrived.length===0&&Boolean(eta),
    arrivalVerifiedAbsent:!displayArrival,arrivalTimeZone:displayArrival?'IST':'',
    arrivalTimeSource:displayArrival?.arrivalTimeSource||'',
    remarks:status+': '+sum(arrived,'pieces')+'/'+master+' arrived, '+sum(departed,'pieces')+
      ' departed, '+sum(offloaded,'pieces')+' offloaded',
    partLoadEvidence:'Official Tracking View flight rows + Activity View booked weights and movements'
  };
}
