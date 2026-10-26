import {masterKg,partKg,confirmedPartArrival} from './arrivalWeights.js';
import {importArrivalMonth} from './monthlyArchive.js';

// Mirror Import Active / Customs Cleared's physical-part display without touching
// the airline adapters or the live dashboard. Each visible movement gets one
// stable row; separate rows of the SAME MAWB share the master financial inputs.
const digits=v=>String(v||'').replace(/\D/g,'');
const count=v=>{
  const text=String(v??'').split('/')[0].replace(/,/g,'').trim();
  if(/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*$/.test(text))
    return text.split('+').reduce((sum,x)=>sum+Number(x),0)||null;
  return null;
};
function masterBags(row={}){
  for(const key of ['totalPieces','masterPieces','totalBags','masterBags']){
    const n=count(row[key]);if(n!==null)return n;
  }
  const raw=String(row.bags||row.pieces||'');
  return count(raw.includes('/')?raw.split('/').at(-1):raw);
}
function partIdentity(part={}){
  return String(part.partKey||part.partId||'').trim()||[
    String(part.flightNo||'').trim().toUpperCase(),
    String(part.flightDate||part.departureDate||'').trim(),
    String(part.pieces||part.bags||'').trim(),
    String(part.weight||'').replace(/,/g,'').trim()
  ].join('|');
}
function uniqueParts(row={}){
  const parts=[],index=new Map();
  for(const p of Array.isArray(row.partShipments)?row.partShipments:[]){
    if(!p||p._saudiaPendingVirtual===true)continue;
    const key=partIdentity(p);
    if(!key||key==='|||')continue;
    if(index.has(key)){
      // The same Saudia movement can have a DEP card followed by ARR; ARR wins.
      const at=index.get(key),older=parts[at];
      if(confirmedPartArrival(p)&&!confirmedPartArrival(older))
        parts[at]={...p,customsCleared:p.customsCleared??older.customsCleared,
          mailSent:p.mailSent??older.mailSent};
      continue;
    }
    index.set(key,parts.length);
    parts.push(p);
  }
  return parts;
}
function isRealSplit(row={},prefix='',parts=[]){
  if(!['065','098','312','176'].includes(prefix))return false;
  const status=String(row.status||'').toUpperCase();
  const fractional=[row.bags,row.pieces,row.weight].some(v=>/^\s*[^/]+\/[^/]+\s*$/.test(String(v||'')));
  if(!(row.partLoad===true||row.isPartLoad===true||
     /PART ARRIVED|PART LOAD|PART SHIPMENT/.test(status)||fractional))return false;
  if(prefix==='065'&&status==='ARRIVED'&&parts.length>1){
    const total=count(row.totalPieces||row.masterPieces);
    const arrived=count(row.arrivedPieces);
    const allArrived=parts.every(p=>p.arrivalIsActual===true&&String(p.status||'').toUpperCase()==='ARRIVED');
    if(total&&arrived>=total&&allArrived&&
       new Set(parts.map(p=>String(p.arrivalDate||'')+' '+String(p.arrivalTime||''))).size===1)return false;
  }
  const masterWeight=masterKg(row),masterPieces=masterBags(row);
  const only=parts[0];
  const partialSingle=parts.length===1&&(
    (partKg(only?.weight)!==null&&masterWeight!==null&&partKg(only.weight)<masterWeight)||
    (count(only?.pieces||only?.bags)!==null&&masterPieces!==null&&count(only.pieces||only.bags)<masterPieces)
  );
  if(parts.length<2&&!partialSingle&&!(prefix==='065'&&parts.length===1))return false;
  if(prefix==='312'&&masterPieces){
    if(!parts.some(p=>count(p.pieces||p.bags)>0&&count(p.pieces||p.bags)<masterPieces))return false;
  }
  return parts.length>0;
}
function saudiaRemainder(row={},parts=[]){
  const total=masterBags(row);
  if(!total)return parts;
  const actual=parts.filter(p=>confirmedPartArrival(p));
  const arrived=Math.min(total,Math.max(Number(row.arrivedPieces)||0,
    actual.reduce((s,p)=>s+(count(p.pieces||p.bags)||0),0)));
  const arrivedKeys=new Set(actual.map(partIdentity));
  const working=parts.filter(p=>confirmedPartArrival(p)||!arrivedKeys.has(partIdentity(p)));
  let available=Math.max(0,total-arrived);
  for(const p of [...working]){
    if(confirmedPartArrival(p))continue;
    const bags=count(p.pieces||p.bags);
    if(bags&&bags<=available)available-=bags;
    else working.splice(working.indexOf(p),1);
  }
  if(arrived>0&&available>0){
    const arrivedKg=actual.reduce((s,p)=>s+(partKg(p.weight)||0),0);
    const pendingKg=working.filter(p=>!confirmedPartArrival(p))
      .reduce((s,p)=>s+(partKg(p.weight)||0),0);
    const masterWeight=masterKg(row);
    const remainder=Number(row.pendingWeight||row.remainingWeight)||(
      masterWeight===null?0:Math.max(0,masterWeight-arrivedKg));
    working.push({
      partKey:'SAL_PENDING_BALANCE|'+total+'|'+available,
      _saudiaPendingVirtual:true,pieces:available,totalPieces:total,
      weight:Math.max(0,remainder-pendingKg)||'',arrivalDate:'',
      status:'PENDING AT SAUDIA',customsCleared:false
    });
  }
  return working;
}
export function physicalImportProfitRows(data={},awb=''){
  const prefix=digits(awb).slice(0,3);
  let parts=uniqueParts(data);
  if(prefix==='065'&&(data.partLoad===true||data.isPartLoad===true||
    /PART ARRIVED|PART LOAD|PART SHIPMENT/i.test(String(data.status||''))))
    parts=saudiaRemainder(data,parts);
  const split=isRealSplit(data,prefix,parts);
  const masterWeight=masterKg(data);
  const masterPieces=masterBags(data);
  if(!split)return [{
    rowKey:digits(awb),partLabel:'',partIndex:0,partCount:1,
    isActiveMaster:data.customsCleared!==true,
    arrivalDate:String(data.arrivalDate||''),
    weight:masterWeight,bags:masterPieces,allocationRatio:1,
    confirmed:confirmedPartArrival(data)||data.customsCleared===true
  }];
  const measuredKg=parts.reduce((s,p)=>s+(partKg(p.weight)||0),0);
  const measuredBags=parts.reduce((s,p)=>s+(count(p.pieces||p.bags)||0),0);
  const denominatorKg=masterWeight&&masterWeight>=measuredKg?masterWeight:measuredKg;
  const denominatorBags=masterPieces&&masterPieces>=measuredBags?masterPieces:measuredBags;
  const usedKeys=new Set();
  return parts.map((part,index)=>{
    const kg=partKg(part.weight),bags=count(part.pieces||part.bags);
    const raw=partIdentity(part),identity=raw&&raw!=='|||'?raw:'PART'+index;
    let rowKey=digits(awb)+'::'+identity;
    if(usedKeys.has(rowKey))rowKey+='::'+index;
    usedKeys.add(rowKey);
    const ratio=kg!==null&&denominatorKg?kg/denominatorKg:
      bags!==null&&denominatorBags?bags/denominatorBags:1/parts.length;
    return {rowKey,partLabel:'Part '+(index+1)+'/'+parts.length,
      partIndex:index,partCount:parts.length,
      isActiveMaster:part.customsCleared!==true,
      arrivalDate:String(part.arrivalDate||''),weight:kg,bags,
      allocationRatio:Math.max(0,Math.min(1,ratio)),
      confirmed:confirmedPartArrival(part),_saudiaPendingVirtual:part._saudiaPendingVirtual===true
    };
  });
}
// Customs Cleared shows ONLY this month's arrivals, while Active shows all
// outstanding physical rows. Past profit months continue to use dated arrivals.
export function selectImportProfitRows(data={},awb='',month='',currentMonth=''){
  return physicalImportProfitRows(data,awb).filter(row=>{
    if(month===currentMonth){
      return row.isActiveMaster||importArrivalMonth(row.arrivalDate)===month;
    }
    return importArrivalMonth(row.arrivalDate)===month&&row.confirmed;
  });
}
