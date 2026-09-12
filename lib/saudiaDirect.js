import { trackSaudiaViaTrackingMorePublic } from './saudiaTrackingMorePublic.js';
import { trackSaudiaViaChina } from './saudiaChina.js';
import { trackSaudiaViaSal } from './saudiaSalPublic.js';
import { trackSaudiaViaConnect } from './saudiaConnect.js';
import { trackSaudiaDirect as trackSaudiaDirectV6 } from './saudiaDirectV6.js';

function mapSaudiaStatus(code='',fallback='TRACKING'){
  const s=String(code||'').trim().toUpperCase();
  if(s==='BKD') return 'BOOKED';
  if(s==='DLV'||s==='ARR') return 'ARRIVED';
  if(s==='MAN'||s==='FOW'||s==='DEP'||s==='XXX'||s==='RCF'||s==='FIW') return 'IN TRANSIT';
  return fallback||'TRACKING';
}

function normalizeResult(result){
  if(result?.ok&&result?.shipment){
    const shipment={...result.shipment};
    const current=String(shipment.status||'').trim().toUpperCase();
    const sourceStatus=String(shipment.sourceStatus||'').trim().toUpperCase();
    if(/^(MAN|FOW|DEP|XXX|RCF|FIW)$/.test(sourceStatus)) shipment.status='IN TRANSIT';
    else if(current==='IN TRANSIT') shipment.status='IN TRANSIT';
    else if(shipment.isPartLoad===true||current==='PART ARRIVED') shipment.status='PART ARRIVED';
    else shipment.status=mapSaudiaStatus(sourceStatus,shipment.status);
    return {...result,shipment};
  }
  return result;
}

function eventEpoch(shipment={}){
  const values=[shipment.latestEventDateTime,shipment.eventDateTime,shipment.flightDate,shipment.arrivalDate,shipment.bookingDate].filter(Boolean);
  for(const value of values){
    const t=Date.parse(String(value));
    if(Number.isFinite(t))return t;
  }
  return 0;
}

function isActiveMovement(shipment={}){
  const sourceStatus=String(shipment.sourceStatus||'').trim().toUpperCase();
  const status=String(shipment.status||'').trim().toUpperCase();
  return /^(MAN|FOW|DEP|XXX|RCF|FIW)$/.test(sourceStatus)||status==='IN TRANSIT';
}

function isTerminalMovement(shipment={}){
  const status=String(shipment.status||'').trim().toUpperCase();
  return status==='ARRIVED'||status==='PART ARRIVED'||status==='DELIVERED';
}

function chooseFreshest(results=[]){
  const good=results.filter(r=>r?.ok&&r?.shipment);
  if(!good.length)return null;

  const active=good.filter(r=>isActiveMovement(r.shipment));
  const terminal=good.filter(r=>isTerminalMovement(r.shipment));

  if(active.length){
    active.sort((a,b)=>eventEpoch(b.shipment)-eventEpoch(a.shipment));
    const newestActive=active[0];
    const activeTime=eventEpoch(newestActive.shipment);

    if(!terminal.length)return newestActive;
    terminal.sort((a,b)=>eventEpoch(b.shipment)-eventEpoch(a.shipment));
    const newestTerminal=terminal[0];
    const terminalTime=eventEpoch(newestTerminal.shipment);

    if(
      newestTerminal.shipment?.isPartLoad===true ||
      String(newestTerminal.shipment?.status||'').toUpperCase()==='PART ARRIVED' ||
      (activeTime>0&&terminalTime>0&&activeTime>=terminalTime) ||
      (activeTime>0&&terminalTime===0)
    ) return newestActive;
  }

  good.sort((a,b)=>{
    const bt=eventEpoch(b.shipment),at=eventEpoch(a.shipment);
    if(bt!==at)return bt-at;
    const rank=s=>{
      const st=String(s?.shipment?.status||'').toUpperCase();
      if(st==='ARRIVED'||st==='DELIVERED')return 5;
      if(st==='PART ARRIVED')return 4;
      if(st==='IN TRANSIT')return 3;
      if(st==='BOOKED')return 2;
      return 1;
    };
    return rank(b)-rank(a);
  });
  return good[0];
}

function enrichMissingArrival(chosen,results=[]){
  if(!chosen?.ok||!chosen?.shipment)return chosen;
  const shipment={...chosen.shipment};
  if(shipment.arrivalTime)return chosen;

  const flight=String(shipment.flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const date=String(shipment.arrivalDate||'');
  const candidates=results.filter(r=>r?.ok&&r?.shipment?.arrivalTime);

  const exact=candidates.find(r=>{
    const s=r.shipment;
    const f=String(s.flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const d=String(s.arrivalDate||'');
    return Boolean(flight&&f&&flight===f&&date&&d&&date===d);
  });

  const sameFlight=candidates.find(r=>{
    const f=String(r.shipment.flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    return Boolean(flight&&f&&flight===f&&(!date||!r.shipment.arrivalDate||String(r.shipment.arrivalDate)===date));
  });

  const donor=exact||sameFlight;
  if(!donor)return chosen;
  shipment.arrivalTime=donor.shipment.arrivalTime;
  if(!shipment.arrivalDate&&donor.shipment.arrivalDate)shipment.arrivalDate=donor.shipment.arrivalDate;
  if(donor.shipment.arrivalIsActual===true&&isTerminalMovement(shipment))shipment.arrivalIsActual=true;
  shipment.arrivalTimeSource=`Matched ${donor.shipment.source||'Saudia source'} by flight/date`;
  return {...chosen,shipment};
}

export async function trackSaudiaDirect(input){
  const settled=await Promise.allSettled([
    trackSaudiaViaSal(input),
    trackSaudiaViaTrackingMorePublic(input),
    trackSaudiaViaChina(input),
    trackSaudiaViaConnect(input),
    trackSaudiaDirectV6(input)
  ]);

  const [sal,tm,china,connect,direct]=settled.map(x=>normalizeResult(x.status==='fulfilled'?x.value:{ok:false,reason:x.reason?.message||'SOURCE FAILED'}));
  const all=[sal,tm,china,connect,direct];
  let chosen=chooseFreshest(all);
  chosen=enrichMissingArrival(chosen,all);

  if(chosen?.ok&&chosen?.shipment){
    return {
      ...chosen,
      debug:{
        ...(chosen.debug||{}),
        sourceSelection:'LATEST_OPERATIONAL_MOVEMENT',
        candidates:all.filter(r=>r?.ok&&r?.shipment).map(r=>({
          source:r.shipment.source||'',status:r.shipment.status||'',sourceStatus:r.shipment.sourceStatus||'',
          flightNo:r.shipment.flightNo||'',flightDate:r.shipment.flightDate||'',arrivalDate:r.shipment.arrivalDate||'',arrivalTime:r.shipment.arrivalTime||''
        }))
      }
    };
  }

  return {
    ...(direct||{}),
    debug:{
      ...(direct?.debug||{}),
      sal:{reason:sal?.reason||'',stage:sal?.debug?.stage||'',sample:sal?.debug?.sample||''},
      trackingMorePublic:{reason:tm?.reason||'',stage:tm?.debug?.stage||'',sample:tm?.debug?.sample||'',network:tm?.debug?.network||[]},
      china:{reason:china?.reason||'',stage:china?.debug?.stage||'',sample:china?.debug?.sample||'',network:china?.debug?.network||[]},
      connect:{reason:connect?.reason||'',stage:connect?.debug?.stage||'',auth:connect?.debug?.auth||'',sample:connect?.debug?.sample||''}
    },
    reason:direct?.reason||sal?.reason||tm?.reason||china?.reason||connect?.reason||'SAUDIA TRACKING FAILED'
  };
}
