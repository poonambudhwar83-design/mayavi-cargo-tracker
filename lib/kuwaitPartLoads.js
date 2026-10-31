import { localAirportTimeToIst } from './exportIst.js';

// Kuwait 229 part-load reconciliation from AWB-matched official operational cards.
// Keep the locked Kuwait official portal adapter unchanged. Its successful
// response already includes verified operational rows in debug.ops.
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const clean=v=>String(v??'').trim();
const digits=v=>Number(String(v??'').replace(/,/g,''));
const pad=v=>String(v).padStart(2,'0');

function dateOf(value=''){
  const m=clean(value).toUpperCase().match(/\b(\d{1,2})[-\s]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s]+(20\d{2}|\d{2})\b/);
  if(!m)return'';
  return (m[3].length===2?'20':'')+m[3]+'-'+MONTH[m[2]]+'-'+pad(m[1]);
}
function timeOf(value=''){
  const m=clean(value).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?pad(m[1])+':'+m[2]:'';
}
function parsedEvent(row={}){
  const details=clean(row.details),code=clean(row.code).toUpperCase();
  const qty=details.match(/\b(\d{1,6})\s+Pieces?\b/i);
  const mass=details.match(/\b([\d,.]+)\s+Kgs?\b/i);
  const flight=details.match(/\b(KU\s*[- ]?\d{2,4})\s*\/\s*(\d{1,2}[-\s]+[A-Z]{3}[-\s]+\d{2,4})\b/i);
  const flightNo=flight?flight[1].toUpperCase().replace(/[^A-Z0-9]/g,''):'';
  const flightDate=dateOf(flight?.[2]||'');
  const pcs=qty?digits(qty[1]):0,weight=mass?digits(mass[1]):0;
  return {code,airport:clean(row.airport).toUpperCase(),date:dateOf(row.dateText||details),
    time:timeOf(row.dateText||details),pieces:pcs,weight,flightNo,flightDate,
    evidence:details};
}
const statusByCode=(code,atDestination=false)=>code==='DLV'&&atDestination?'DELIVERED':
  code==='RCF'&&atDestination?'ARRIVED':code==='DEP'?'IN TRANSIT':
  code==='MAN'?'MANIFESTED':'PRE-MANIFESTED';
const rank=code=>({DLV:6,RCF:5,DEP:4,MAN:3,PRE:2})[code]||0;

// The Kuwait tracker publishes the KWI cargo DEP wall clock, not the DEL ETA.
// Mayavi's existing operational fallback is DEP + 7 hours (Kuwait local).
// Convert that estimated instant to IST before displaying the arrival columns.
// This is NOT cargo arrival: only destination RCF/DLV confirms that.
function estimatedIstFromKuwaitCargoDep(departureDate='',departureTime=''){
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(departureDate)||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime))return null;
  const [year,month,day]=departureDate.split('-').map(Number);
  const [hour,minute]=departureTime.split(':').map(Number);
  const expected=new Date(Date.UTC(year,month-1,day,hour+7,minute));
  const date=expected.toISOString().slice(0,10);
  const time=expected.toISOString().slice(11,16);
  return localAirportTimeToIst(date,time,'KWI');
}

/**
 * Produce genuine Kuwait physical parts only when independent movement-card
 * quantities reconstruct the exact AWB master pieces AND gross weight.
 * The old full-master PRE (87/2885) is history, NOT a third physical part.
 * Never promote MAN or PRE to DEP/ARRIVED based on KU381 flight schedule.
 */
export function kuwaitPartLoadFromActivity(ops=[],shipment={}){
  if(!Array.isArray(ops)||!ops.length)return null;
  const rows=ops.map(parsedEvent).filter(r=>r.pieces>0&&r.weight>0);
  if(!rows.length)return null;
  const master=rows.filter(r=>r.code==='RCS').sort((a,b)=>b.pieces-a.pieces||b.weight-a.weight)[0]
    ||[...rows].sort((a,b)=>b.pieces-a.pieces||b.weight-a.weight)[0];
  const masterPieces=master?.pieces||0,masterWeight=master?.weight||0;
  if(masterPieces<2||masterWeight<=0)return null;

  // Operational history is newest-first. All milestones for the same physical
  // quantity/flight form a single part; retain the strongest verified movement.
  const byPart=new Map();
  for(const r of rows){
    if(!['PRE','MAN','DEP','RCF','DLV'].includes(r.code)||
      !r.flightNo||!r.flightDate||
      r.pieces>=masterPieces||r.weight>=masterWeight)continue;
    const key=[r.flightNo,r.flightDate,r.pieces,r.weight].join('|');
    const prev=byPart.get(key);
    if(!prev||rank(r.code)>rank(prev.code)||rank(r.code)===rank(prev.code)&&
      (r.date+'T'+r.time)>(prev.date+'T'+prev.time))byPart.set(key,r);
  }
  const candidates=[...byPart.values()].sort((a,b)=>
    (b.date+'T'+b.time).localeCompare(a.date+'T'+a.time)||
    rank(b.code)-rank(a.code));
  if(candidates.length<2)return null;
  // Do not mix prior rebooking history with the latest actual load. Select
  // a non-overlapping set of current physical parts that equals the master.
  const chosen=[];let usedPieces=0,usedWeight=0;
  for(const r of candidates){
    if(usedPieces+r.pieces>masterPieces||usedWeight+r.weight>masterWeight+0.01)continue;
    chosen.push(r);usedPieces+=r.pieces;usedWeight+=r.weight;
    if(usedPieces===masterPieces&&Math.abs(usedWeight-masterWeight)<0.05)break;
  }
  if(chosen.length<2||usedPieces!==masterPieces||Math.abs(usedWeight-masterWeight)>=0.05)return null;
  const destination=clean(shipment.destination).toUpperCase();
  // Kuwait Cargo may issue a single full-master DEP card after separate
  // 55/87 and 32/87 MAN cards. If the actual cargo DEP confirms every piece,
  // the same kg, flight and date, upgrade BOTH existing physical parts.
  // Never infer DEP merely because a passenger aircraft has departed.
  const fullMasterDep=rows.filter(r=>r.code==='DEP'
    &&r.pieces===masterPieces&&Math.abs(r.weight-masterWeight)<0.05
    &&r.flightNo&&r.flightDate
    &&chosen.every(part=>part.flightNo===r.flightNo&&part.flightDate===r.flightDate))
    .sort((a,b)=>(b.date+'T'+b.time).localeCompare(a.date+'T'+a.time))[0]||null;
  const parts=chosen.map(r=>{
    const effective=fullMasterDep&&rank(r.code)<rank('DEP')
      ?{...r,code:'DEP',date:fullMasterDep.date,time:fullMasterDep.time,
        airport:fullMasterDep.airport, evidence:'Master '+masterPieces+'/'+masterWeight+
          ' DEP: '+fullMasterDep.evidence+' | Part manifest: '+r.evidence}
      :r;
    const arrived=Boolean(destination&&effective.airport===destination&&['RCF','DLV'].includes(effective.code));
    const departed=effective.code==='DEP'||arrived;
    const status=statusByCode(effective.code,arrived);
    const kuwaitEta=effective.code==='DEP'&&effective.airport==='KWI'
      ?estimatedIstFromKuwaitCargoDep(effective.date,effective.time):null;
    const id=['KU',r.flightNo,r.flightDate,r.pieces,r.weight].join('|');
    return {
      partId:id,partKey:id,pieces:String(r.pieces),totalPieces:String(masterPieces),
      weight:String(r.weight),totalWeight:String(masterWeight),
      flightNo:r.flightNo,flightDate:r.flightDate,departureIsActual:departed,
      departureDate:effective.code==='DEP'?effective.date:'',departureTime:effective.code==='DEP'?effective.time:'',
      arrivalIsActual:arrived,arrivalEstimate:!arrived&&Boolean(kuwaitEta),
      arrivalDate:arrived?effective.date:(kuwaitEta?.date||''),
      arrivalTime:arrived?effective.time:(kuwaitEta?.time||''),
      arrivalTimeZone:arrived?'LOCAL':(kuwaitEta?'IST':''),
      arrivalTimeSource:arrived?'Kuwait Cargo destination RCF/DLV':'Kuwait cargo DEP + 7h operational ETA, converted KWI to IST (not cargo ARR)',
      status,sourceStatus:effective.code,eventStation:effective.airport,
      mailSent:false,customsCleared:false,
      remarks:'Kuwait Cargo '+effective.code+' at '+effective.airport+' ('+r.pieces+'/'+masterPieces+' pcs)',
      activityEvidence:effective.evidence
    };
  }).sort((a,b)=>rank(b.sourceStatus)-rank(a.sourceStatus)||Number(b.pieces)-Number(a.pieces));

  const arrivedPieces=parts.filter(p=>p.arrivalIsActual).reduce((n,p)=>n+Number(p.pieces),0);
  const arrivedWeight=parts.filter(p=>p.arrivalIsActual).reduce((n,p)=>n+Number(p.weight),0);
  return {
    isPartLoad:true,partLoad:true,partShipments:parts,
    masterPieces:String(masterPieces),masterWeight:String(masterWeight),
    totalPieces:String(masterPieces),totalWeight:String(masterWeight),
    pieces:String(masterPieces),bags:String(masterPieces),weight:String(masterWeight),
    flightNo:parts[0].flightNo||shipment.flightNo||'',
    flightDate:parts[0].flightDate||shipment.flightDate||'',
    arrivedPieces:String(arrivedPieces),arrivedWeight:String(arrivedWeight),
    remainingPieces:String(masterPieces-arrivedPieces),
    status:parts.every(p=>p.arrivalIsActual)?'ARRIVED':
      parts.every(p=>p.departureIsActual===true)?'IN TRANSIT':'PART LOAD',
    departureIsActual:parts.every(p=>p.departureIsActual===true),
    kuwaitCargoDepartureConfirmed:parts.every(p=>p.departureIsActual===true),
    arrivalIsActual:parts.every(p=>p.arrivalIsActual),
    partLoadEvidence:'Kuwait Cargo operational cards: '+parts.map(p=>p.activityEvidence).join(' || '),
    remarks:'Kuwait cargo split: '+parts.map(p=>p.pieces+'/'+masterPieces+' '+p.status).join(' + ')
  };
}
