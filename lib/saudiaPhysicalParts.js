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
  // A later final-leg DEP is stronger than the earlier full-master hub RCF.
  // In an exact partial DIS/DEP split, retain the physically departed portion
  // and only the evidenced offloaded balance at the hub, not the full RCF again.
  const finalDep=parts.find(p=>upper(p.sourceStatus)==='DEP'&&
    upper(p.flightDestination)===final&&upper(p.flightNo)===upper(shipment.finalFlightNo||shipment.flightNo)&&
    isoDate(p.flightDate)===isoDate(shipment.finalFlightDate||shipment.flightDate));
  if(finalDep&&verifiedArrived===0&&num(finalDep.pieces)<total){
    const h=(shipment.partLoadHistory||[]).find(h=>upper(h.flightNo)===upper(finalDep.flightNo)&&
      isoDate(h.flightDate)===isoDate(finalDep.flightDate)&&matched(h.departed,finalDep));
    const balance=h?.dis, bp=num(balance?.pieces),bw=num(balance?.weight);
    const hub=milestones.filter(r=>upper(r.station)!==final&&
      (!finalDep.flightOrigin||upper(r.station)===upper(finalDep.flightOrigin))&&
      isoDate(r.date)<=isoDate(finalDep.flightDate)&&num(r.pieces)===total&&
      Math.abs(num(r.weight)-gross)<0.5).sort((a,b)=>(Number(b.epoch)||0)-(Number(a.epoch)||0))[0];
    if(hub&&bp&&bw&&num(finalDep.pieces)+bp===total&&
      Math.abs(num(finalDep.weight)+bw-gross)<0.5){
      const hubFlight=upper(hub.flightNo),hubDate=isoDate(hub.flightDate||hub.date);
      const hubKey=[hubFlight||'SAL-RCF',hubDate,bp,bw].join('|');
      const previous=parts.find(p=>physicalId(p)===hubKey);
      const remaining={...previous,partId:hubKey,partKey:hubKey,pieces:bp,weight:bw,
        totalPieces:total,totalWeight:gross,flightNo:hubFlight,flightDate:hubDate,
        flightDestination:upper(hub.station),transitAirport:upper(hub.station),
        transitArrivalDate:isoDate(hub.date),transitArrivalTime:hub.time||'',
        arrivalDate:'',arrivalTime:'',arrivalIsActual:false,arrivalEstimate:false,
        departureIsActual:false,sourceStatus:'RCF',status:'IN TRANSIT',
        activityEvidence:'SAL RCF + partial DIS',remarks:'SAL DIS: '+bp+' pcs ('+bw+
          ' kg) offloaded at '+upper(hub.station)+'; onward departure pending',
        mailSent:previous?.mailSent===true,mailUpdatedAt:previous?.mailUpdatedAt||'',
        customsCleared:false,customsClearedAt:'',customsClearedBy:''};
      const departed={...finalDep,totalPieces:total,totalWeight:gross,status:'DEPARTED',
        departureIsActual:true,arrivalIsActual:false};
      const hasEta=Boolean(departed.arrivalDate&&departed.arrivalTime&&departed.arrivalEstimate);
      return {...shipment,partShipments:[departed,remaining],partLoad:true,isPartLoad:true,
        masterPieces:total,masterWeight:gross,pendingPieces:total,pendingWeight:gross,
        status:'DEPARTED',sourceStatus:'DEP',
        remarks:num(departed.pieces)+' pcs departed; '+bp+' pcs offloaded at '+upper(hub.station),
        discrepancy:bp+' pcs offloaded; '+num(departed.pieces)+' pcs confirmed departed',
        ...(hasEta?{arrivalDate:departed.arrivalDate,arrivalTime:departed.arrivalTime,
          scheduledArrivalDate:departed.arrivalDate,scheduledArrivalTime:departed.arrivalTime,
          arrivalEstimate:true,arrivalIsActual:false,arrivalVerifiedAbsent:false,
          arrivalTimeZone:departed.arrivalTimeZone||'IST',arrivalTimeSource:departed.arrivalTimeSource,
          eta:departed.arrivalDate+'T'+departed.arrivalTime+':00'}:{}),
        saudiaVerifiedPendingBalance:false,saudiaUnassignedPieces:0,saudiaUnassignedWeight:0,
        saudiaPhysicalEventCoverage:total,saudiaPhysicalEventEvidence:'SAL DEP + partial DIS + RCF reconciled'};
    }
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
