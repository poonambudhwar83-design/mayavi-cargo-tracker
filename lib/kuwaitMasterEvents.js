// Generic Kuwait Airways cargo evidence reconciler for EVERY 229 MAWB.
// This supplements the locked Kuwait web reader without replacing its parser.
// Only AWB-matched cargo operational RCF/DEP establishes physical milestones.
const asNumber=v=>{
  const n=Number(String(v??'').replace(/,/g,'').trim());return Number.isFinite(n)?n:0;
};
const text=v=>String(v??'').trim();
const dateOf=v=>{
  const m=text(v).toUpperCase().match(/\b(\d{1,2})[-\s]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s]+(20\d{2}|\d{2})\b/);
  if(!m)return'';
  const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  return (m[3].length===2?'20':'')+m[3]+'-'+months[m[2]]+'-'+m[1].padStart(2,'0');
};
const clockOf=v=>{const m=text(v).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?m[1].padStart(2,'0')+':'+m[2]:'';};
const eventOf=e=>{
  const detail=text(e.details),dateText=text(e.dateText);
  return {code:text(e.code).toUpperCase(),airport:text(e.airport).toUpperCase(),
    date:dateOf(dateText)||dateOf(detail),time:clockOf(dateText)||clockOf(detail),
    pieces:asNumber(detail.match(/\b(\d{1,6})\s+Pieces?\b/i)?.[1]),
    weight:asNumber(detail.match(/\b([\d,.]+)\s+Kgs?\b/i)?.[1]),
    flightNo:text(detail.match(/\b(KU\s*[- ]?\d{2,4})\s*\//i)?.[1]).replace(/[^a-z0-9]/gi,'').toUpperCase(),
    details:detail};
};
const digits=v=>text(v).replace(/\D/g,'');
/**
 * Must never infer physical arrival from elapsed estimated arrival time,
 * from aircraft movements, or from unrelated cargo pieces/flights.
 */
export function reconcileKuwaitMasterEvents(shipment={},ops=[]){
  const master={...shipment};
  if(!digits(master.mawb).startsWith('229')||!Array.isArray(ops)||!ops.length)return master;
  const events=ops.map(eventOf);
  const totalPieces=asNumber(master.totalPieces||master.masterPieces||master.pieces||master.bags);
  const totalWeight=asNumber(master.totalWeight||master.masterWeight||master.weight);
  if(totalPieces<=0||totalWeight<=0)return master;
  const match=e=>e.pieces===totalPieces&&Math.abs(e.weight-totalWeight)<0.05;
  const destination=text(master.destination).toUpperCase();
  const origin=text(master.origin).toUpperCase();
  const flightNo=text(master.flightNo).toUpperCase();
  const confirmedRcf=events.filter(e=>['RCF','DLV'].includes(e.code)
      &&e.airport===destination&&match(e)&&e.date&&e.time)
    .sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))[0];
  if(confirmedRcf){
    // Do not override the verified physical-part timeline when only part of
    // the load has arrived. This branch is a full-master destination receipt.
    return {...master,status:confirmedRcf.code==='DLV'?'DELIVERED':'ARRIVED',
      arrivalDate:confirmedRcf.date,arrivalTime:confirmedRcf.time,
      arrivalIsActual:true,arrivalEstimate:false,arrivalVerifiedAbsent:false,
      arrivalTimeSource:'Kuwait Cargo full-master destination '+confirmedRcf.code,
      kuwaitCargoArrivalConfirmed:true};
  }
  const dep=events.filter(e=>e.code==='DEP'&&e.airport===origin&&match(e)
      &&e.date&&e.time&&(!flightNo||e.flightNo===flightNo))
    .sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))[0];
  if(!dep)return master;
  const sameDirect=origin==='KWI'&&destination==='DEL'
      &&!text(master.via||master.transitAirport||master.connectionAirport);
  return {...master,flightNo:dep.flightNo||master.flightNo,
    status:sameDirect?'DEPARTED':'IN TRANSIT',
    departureIsActual:true,kuwaitCargoDepartureConfirmed:true,
    departureDate:dep.date,departureTime:dep.time,
    arrivalDate:'',arrivalTime:'',arrivalEstimate:false,
    arrivalIsActual:false,arrivalVerifiedAbsent:true,
    actualArrival:null,actualArrivalDate:'',actualArrivalTime:'',
    arrivalTimeSource:'Kuwait Cargo DEP confirmed; dated flight ETA pending; DEL cargo RCF pending'};
}
