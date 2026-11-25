// Saudia SAL physical-part reconciliation. SAL's event log, not the
// arithmetic difference of the master, authorizes a new physical part.
// In particular, a historic DEP of 49/99 must not duplicate ARR of 49/99,
// and JED RCF 50/99 must remain visible even without a later DEL flight.
const num=v=>{const x=Number(String(v??'').split('/')[0].replace(/,/g,''));return Number.isFinite(x)&&x>0?x:0;};
const upper=v=>String(v||'').trim().toUpperCase();
const isoDate=v=>{
  const s=String(v||''),m=s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  return m?m[3]+'-'+String(m[1]).padStart(2,'0')+'-'+String(m[2]).padStart(2,'0')
    :(s.match(/20\d{2}-\d{2}-\d{2}/)||[])[0]||'';
};
const physicalId=p=>String(p?.partKey||p?.partId||[
  p?.flightNo||'',p?.flightDate||'',p?.pieces||'',p?.weight||''].join('|')).trim();
const matched=(a,b)=>num(a?.pieces)===num(b?.pieces)&&
  num(a?.pieces)>0&&Math.abs(num(a?.weight)-num(b?.weight))<0.5;
const rank=p=>p?.arrivalIsActual===true?8:
  upper(p?.sourceStatus)==='RCF'?7:upper(p?.sourceStatus)==='DEP'?6:
  upper(p?.sourceStatus)==='FOW'?5:upper(p?.sourceStatus)==='MAN'?4:1;

export function reconcileSaudiaPhysicalParts(shipment={}){
  if(!String(shipment.mawb||'').replace(/\D/g,'').startsWith('065')||
    shipment.source!=='SAL complete shipment chronology')return shipment;
  const total=num(shipment.totalPieces),gross=num(shipment.totalWeight);
  const original=Array.isArray(shipment.partShipments)?shipment.partShipments.filter(Boolean):[];
  const milestones=Array.isArray(shipment.saudiaRcfMilestones)?shipment.saudiaRcfMilestones.filter(Boolean):[];
  if(!total||!gross||(!original.length&&!milestones.length))return shipment;
  const final=upper(shipment.destination);
  // Group the *same physical identity* and retain its strongest SAL event.
  // ARR supersedes the older DEP for SV760|2026-10-24|49|1147.
  const byId=new Map();
  for(const p of original){
    const id=physicalId(p);if(!id||!num(p.pieces)||!num(p.weight))continue;
    const previous=byId.get(id);
    if(!previous||rank(p)>rank(previous)){
      byId.set(id,{
        ...previous,...p,
        mailSent:p.mailSent===true||previous?.mailSent===true,
        mailUpdatedAt:p.mailUpdatedAt||previous?.mailUpdatedAt||'',
        customsCleared:p.customsCleared===true||previous?.customsCleared===true,
        customsClearedAt:p.customsClearedAt||previous?.customsClearedAt||'',
        customsClearedBy:p.customsClearedBy||previous?.customsClearedBy||'',
        partKey:id,partId:id
      });
    }
  }
  let parts=[...byId.values()];
  const arrived=parts.filter(p=>p.arrivalIsActual===true&&
    (!upper(p.flightDestination)||upper(p.flightDestination)===final));
  const verifiedArrived=arrived.reduce((n,p)=>n+num(p.pieces),0);
  // Protect against a full-master ARR incorrectly being paired with stale
  // historical movement cards.
  let physical=[...arrived],capacity=Math.max(0,total-verifiedArrived);
  // A current final-leg DEP and an exact partial DIS account for the entire
  // master received at the hub. Historical full-master RCF must not consume
  // the capacity before the newer physically departed part is considered.
  const currentFlight=upper(shipment.finalFlightNo||shipment.flightNo);
  const currentDate=isoDate(shipment.finalFlightDate||shipment.flightDate);
  const currentDest=upper(shipment.finalFlightDestination||shipment.flightDestination);
  const currentEvidence=upper(shipment.finalFlightSourceStatus||shipment.sourceStatus);
  const history=Array.isArray(shipment.partLoadHistory)?shipment.partLoadHistory:[];
  const h=history.find(h=>upper(h.flightNo)===currentFlight&&isoDate(h.flightDate)===currentDate);
  const dp=num(h?.departed?.pieces),dw=num(h?.departed?.weight);
  const bp=num(h?.dis?.pieces),bw=num(h?.dis?.weight);
  const dep=parts.find(p=>upper(p.sourceStatus)==='DEP'&&upper(p.flightDestination)===final&&
    upper(p.flightNo)===currentFlight&&isoDate(p.flightDate)===currentDate&&matched(p,h?.departed));
  const hub=milestones.filter(r=>upper(r.station)&&upper(r.station)!==final&&
    (!dep?.flightOrigin||upper(r.station)===upper(dep.flightOrigin))&&
    isoDate(r.date)&&isoDate(r.date)<=currentDate&&num(r.pieces)===total&&
    Math.abs(num(r.weight)-gross)<0.5).sort((a,b)=>(Number(b.epoch)||0)-(Number(a.epoch)||0))[0];
  const later=parts.some(p=>p.arrivalIsActual!==true&&['DEP','FOW','MAN'].includes(upper(p.sourceStatus))&&
    (isoDate(p.flightDate)>currentDate||
     (isoDate(p.flightDate)===currentDate&&upper(p.flightNo)!==currentFlight&&upper(p.flightDestination)===final)));
  if(final&&currentFlight&&currentDate&&currentDest===final&&currentEvidence==='DEP'&&
    !verifiedArrived&&!num(shipment.arrivedPieces)&&!later&&hub&&dp&&dw&&bp&&bw&&
    dp+bp===total&&Math.abs(dw+bw-gross)<0.5){
    const key=[currentFlight,currentDate,dp,dw].join('|');
    const existingDep=dep||parts.find(p=>physicalId(p)===key);
    const hubFlight=upper(hub.flightNo),hubDate=isoDate(hub.flightDate||hub.date);
    const hubKey=[hubFlight||'SAL-RCF',hubDate,bp,bw].join('|');
    const previous=parts.find(p=>physicalId(p)===hubKey);
    const hasEta=Boolean(existingDep?.arrivalEstimate&&existingDep.arrivalDate&&existingDep.arrivalTime);
    const masterEta=Boolean(shipment.arrivalEstimate&&shipment.arrivalDate&&shipment.arrivalTime&&
      shipment.arrivalIsActual!==true&&upper(shipment.saudiaArrivalStage)==='CONFIRMED_ETA');
    const etaDate=hasEta?existingDep.arrivalDate:masterEta?shipment.arrivalDate:'';
    const etaTime=hasEta?existingDep.arrivalTime:masterEta?shipment.arrivalTime:'';
    const etaSource=hasEta?existingDep.arrivalTimeSource:masterEta?shipment.arrivalTimeSource:'';
    const departed={...existingDep,partId:key,partKey:key,pieces:dp,weight:dw,
      totalPieces:total,totalWeight:gross,flightNo:currentFlight,flightDate:currentDate,
      flightOrigin:existingDep?.flightOrigin||upper(hub.station),flightDestination:final,
      sourceStatus:'DEP',status:'DEPARTED',departureIsActual:true,arrivalIsActual:false,
      arrivalDate:etaDate,arrivalTime:etaTime,arrivalEstimate:Boolean(etaDate&&etaTime),
      arrivalTimeZone:'IST',arrivalTimeSource:etaSource||'',saudiaArrivalStage:'CONFIRMED_ETA',
      transitAirport:'',transitArrivalDate:'',transitArrivalTime:'',
      activityEvidence:'SAL DEP',remarks:'SAL DEP: '+dp+' pcs departed to '+final+
        (etaTime?'; flight ETA '+etaTime+' IST':' ; flight ETA pending'),
      mailSent:existingDep?.mailSent===true,customsCleared:false};
    const balance={...previous,partId:hubKey,partKey:hubKey,pieces:bp,weight:bw,
      totalPieces:total,totalWeight:gross,flightNo:hubFlight,flightDate:hubDate,
      flightDestination:upper(hub.station),transitAirport:upper(hub.station),
      transitArrivalDate:isoDate(hub.date),transitArrivalTime:hub.time||'',
      arrivalDate:'',arrivalTime:'',arrivalIsActual:false,arrivalEstimate:false,
      departureIsActual:false,sourceStatus:'RCF',status:'IN TRANSIT',
      activityEvidence:'SAL RCF + partial DIS',remarks:'SAL DIS: '+bp+' pcs ('+bw+
        ' kg) offloaded at '+upper(hub.station)+'; onward departure pending',
      mailSent:previous?.mailSent===true,mailUpdatedAt:previous?.mailUpdatedAt||'',
      customsCleared:false,customsClearedAt:'',customsClearedBy:''};
    return {...shipment,partShipments:[departed,balance],partLoad:true,isPartLoad:true,
      masterPieces:total,masterWeight:gross,pendingPieces:total,pendingWeight:gross,
      status:'DEPARTED',sourceStatus:'DEP',arrivalIsActual:false,
      arrivalDate:etaDate,arrivalTime:etaTime,arrivalEstimate:Boolean(etaDate&&etaTime),
      arrivalVerifiedAbsent:!etaTime,arrivalTimeZone:'IST',arrivalTimeSource:etaSource||'',
      eta:etaDate&&etaTime?etaDate+'T'+etaTime+':00':null,
      discrepancy:bp+' pcs offloaded; '+dp+' pcs confirmed departed',
      saudiaVerifiedPendingBalance:false,saudiaUnassignedPieces:0,saudiaUnassignedWeight:0,
      saudiaPhysicalEventCoverage:total,saudiaPhysicalEventEvidence:'SAL DEP + partial DIS + RCF reconciled'};
  }
  const usedReceipts=new Set();
  const receipts=[...milestones].sort((a,b)=>(Number(b.epoch)||0)-(Number(a.epoch)||0));
  for(const receipt of receipts){
    const p=num(receipt.pieces),w=num(receipt.weight),station=upper(receipt.station);
    if(!p||!w||!station||p>capacity)continue;
    if(physical.some(a=>matched(a,receipt)))continue;
    const flight=upper(receipt.flightNo);
    const fd=isoDate(receipt.flightDate||receipt.date);
    const key=[flight||'SAL-RCF',fd||isoDate(receipt.date),p,w].join('|');
    if(usedReceipts.has(key))continue;
    usedReceipts.add(key);
    const matchingOld=parts.find(x=>x.arrivalIsActual!==true&&matched(x,receipt)
      &&(!flight||!x.flightNo||upper(x.flightNo)===flight)
      &&(!fd||!x.flightDate||isoDate(x.flightDate)===fd));
    // This new physical row is justified by actual JED RCF, not by 99-49.
    const receiptPart={
      ...matchingOld,
      partId:key,partKey:key,pieces:p,weight:w,totalPieces:total,totalWeight:gross,
      flightNo:flight||matchingOld?.flightNo||'',flightDate:fd,
      flightDestination:station,transitAirport:station,
      transitArrivalDate:isoDate(receipt.date),transitArrivalTime:receipt.time||'',
      arrivalDate:'',arrivalTime:'',arrivalIsActual:false,arrivalEstimate:false,
      sourceStatus:'RCF',status:'IN TRANSIT',mailTime:'',
      remarks:'SAL RCF '+p+'/'+total+' pieces ('+w+' kg) received from flight at '+station+
        '; final '+(final||'destination')+' cargo ARR still pending',
      activityEvidence:receipt.source||'SAL RCF event',
      mailSent:matchingOld?.mailSent===true,
      mailUpdatedAt:matchingOld?.mailUpdatedAt||'',
      customsCleared:matchingOld?.customsCleared===true,
      customsClearedAt:matchingOld?.customsClearedAt||'',
      customsClearedBy:matchingOld?.customsClearedBy||''
    };
    physical.push(receiptPart);capacity-=p;
  }
  // If no separate RCF has been published, keep a genuine current FOW/DEP
  // physical movement, never another event for an already arrived quantity.
  const moving=parts.filter(p=>p.arrivalIsActual!==true&&
    !physical.some(a=>matched(a,p))).sort((a,b)=>{
      const da=String(a.flightDate||a.transitArrivalDate||'');
      const db=String(b.flightDate||b.transitArrivalDate||'');
      return db.localeCompare(da)||rank(b)-rank(a);
    });
  for(const p of moving){
    const pcs=num(p.pieces),weight=num(p.weight);
    if(!pcs||pcs>capacity||!weight)continue;
    physical.push(p);capacity-=pcs;
  }
  const covered=physical.reduce((n,p)=>n+num(p.pieces),0);
  const coveredWeight=physical.reduce((n,p)=>n+num(p.weight),0);
  const unassigned=Math.max(0,total-covered);
  const unassignedKg=Math.max(0,Math.round((gross-coveredWeight)*100)/100);
  return{
    ...shipment,partShipments:physical,
    partLoad:physical.length>1||shipment.partLoad===true||unassigned>0,
    isPartLoad:shipment.isPartLoad===true||physical.length>1,
    masterPieces:total,masterWeight:gross,
    pendingPieces:Math.max(0,total-num(shipment.arrivedPieces)),
    pendingWeight:Math.max(0,gross-num(shipment.arrivedWeight)),
    // This is an accounting balance only, explicitly NOT a confirmed movement.
    saudiaVerifiedPendingBalance:unassigned>0&&physical.length>0,
    saudiaUnassignedPieces:unassigned,saudiaUnassignedWeight:unassignedKg,
    saudiaPhysicalEventCoverage:covered,
    saudiaPhysicalEventEvidence:milestones.length
      ?'SAL RCF physical event quantities reconciled':'SAL physical movement history'
  };
}
