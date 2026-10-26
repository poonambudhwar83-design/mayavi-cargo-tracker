// Map verified SAL TrackingApi RCF receipts to individual physical cargo parts.
// RCF means "Received from Flight", not verified customs inspection or clearance.
// Events are scoped to MAWB. An ambiguous receipt is never assigned to an
// arbitrary split part or used to mark Customs Cleared.
const code=value=>String(value||'').trim().toUpperCase();
const number=value=>{const x=Number(value);return Number.isFinite(x)&&x>0?x:0;};
const close=(a,b)=>Math.abs(a-b)<1;
const partPieces=p=>number(String(p?.pieces??p?.bags??'').split('/')[0]);
const partWeight=p=>number(String(p?.weight??'').split('/')[0]);
function cargoCompatible(a={},b={}){
  const aPieces=partPieces(a),bPieces=partPieces(b);
  const aWeight=partWeight(a),bWeight=partWeight(b);
  if(aPieces&&bPieces&&aPieces!==bPieces)return false;
  if(aWeight&&bWeight&&!close(aWeight,bWeight))return false;
  return Boolean((aPieces&&bPieces)||(aWeight&&bWeight));
}
function evidenceMatch(a={},b={}){
  if(!cargoCompatible(a,b))return false;
  const aPart=Number.isInteger(a.salPartIndex)?a.salPartIndex:null;
  const bPart=Number.isInteger(b.salPartIndex)?b.salPartIndex:null;
  if(aPart!==null&&bPart!==null&&aPart!==bPart)return false;
  return true;
}
export function activeSalRcfMilestones(events=[]){
  const chronological=[...events].sort((a,b)=>(Number(a.epoch)||0)-(Number(b.epoch)||0)||(Number(a.sequence)||0)-(Number(b.sequence)||0));
  const terminal=/^(MAN|FOW|DEP|ARR|NFD|DLV|CCD|TGC)$/;
  return chronological.filter(x=>code(x.code)==='RCF'&&code(x.airport))
    .filter(receipt=>!chronological.some(event=>
      (Number(event.epoch)||0)>(Number(receipt.epoch)||0)&&terminal.test(code(event.code))&&
      evidenceMatch(receipt,event)))
    .map((e,i)=>({
      id:[code(e.airport),e.date||'',e.time||'',partPieces(e),partWeight(e),i].join('|'),
      station:code(e.airport),date:e.date||'',time:e.time||'',
      pieces:partPieces(e),weight:partWeight(e),flightNo:code(e.flightNo),
      flightDate:e.flightDate||'',salPartIndex:Number.isInteger(e.salPartIndex)?e.salPartIndex:null,
      epoch:Number(e.epoch)||0,source:'SAL RCF'
    }));
}
function legacyMilestones(master={}){
  if(master.saudiaRcfFollowUp!==true)return[];
  return [{id:'SAL_RCF_LEGACY',station:master.saudiaRcfStation||'',
    pieces:number(master.saudiaRcfPieces),weight:0,
    date:master.saudiaRcfDate||'',flightNo:'',salPartIndex:null,source:'SAL RCF'}];
}
export function matchSaudiaRcfParts(master={},parts=[]){
  if(!Array.isArray(parts)||!parts.length)return[];
  if(!String(master.mawb||'').replace(/\D/g,'').startsWith('065'))return parts.map(()=>null);
  const events=Array.isArray(master.saudiaRcfMilestones)
    ?master.saudiaRcfMilestones:legacyMilestones(master);
  const flags=parts.map(()=>null);
  const total=number(master.totalPieces||master.masterPieces);
  for(const event of events){
    let candidates=parts.map((p,i)=>({p,i}))
      .filter(({p})=>cargoCompatible(event,p));
    // Explicit SAL confirmation of the entire master applies to all its
    // physical parts, provided all part quantities add up to the same master.
    const fullLoad=total&&number(event.pieces)===total&&
      parts.reduce((sum,p)=>sum+partPieces(p),0)===total;
    if(fullLoad){for(let i=0;i<parts.length;i++)flags[i]=event;continue;}
    if(candidates.length>1){
      const exactWeight=candidates.filter(({p})=>number(event.weight)&&partWeight(p)&&close(number(event.weight),partWeight(p)));
      if(exactWeight.length===1)candidates=exactWeight;
    }
    if(candidates.length>1&&event.flightNo){
      const sameFlight=candidates.filter(({p})=>code(p.flightNo)===code(event.flightNo));
      if(sameFlight.length===1)candidates=sameFlight;
    }
    if(candidates.length>1&&Number.isInteger(event.salPartIndex)){
      const samePart=candidates.filter(({p})=>Number.isInteger(p.salPartIndex)&&p.salPartIndex===event.salPartIndex);
      if(samePart.length===1)candidates=samePart;
    }
    if(candidates.length>1&&code(event.station)){
      const sameStation=candidates.filter(({p})=>
        code(p.transitAirport||p.airport||(p.arrivalIsActual===true?master.destination:''))===code(event.station));
      if(sameStation.length===1)candidates=sameStation;
    }
    // If SAL's receipt has only an MAWB total or cannot distinguish two
    // identical split loads, avoid assigning it to the wrong physical row.
    if(candidates.length!==1)continue;
    flags[candidates[0].i]=event;
  }
  return flags;
}
