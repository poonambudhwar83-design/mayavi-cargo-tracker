import { trackSaudiaViaTrackingMorePublic } from './saudiaTrackingMorePublic.js';
import { trackSaudiaViaChina } from './saudiaChina.js';
import { trackSaudiaViaSal } from './saudiaSalPublic.js';
import { trackSaudiaViaConnect } from './saudiaConnect.js';
import { trackSaudiaDirect as trackSaudiaDirectV6 } from './saudiaDirectV6.js';

function mapSaudiaStatus(code='',fallback='TRACKING'){
  const s=String(code||'').trim().toUpperCase();
  if(s==='BKD') return 'BOOKED';
  if(s==='DLV') return 'ARRIVED';
  if(s==='MAN'||s==='FOW'||s==='DEP'||s==='XXX') return 'IN TRANSIT';
  return fallback||'TRACKING';
}

function normalizeResult(result){
  if(result?.ok&&result?.shipment){
    const shipment={...result.shipment};
    const current=String(shipment.status||'').trim().toUpperCase();
    if(current==='IN TRANSIT') shipment.status='IN TRANSIT';
    else if(shipment.isPartLoad===true||current==='PART ARRIVED') shipment.status='PART ARRIVED';
    else shipment.status=mapSaudiaStatus(shipment.sourceStatus,shipment.status);
    return {...result,shipment};
  }
  return result;
}

export async function trackSaudiaDirect(input){
  // SAL is the fastest working public Saudia source and returns structured JSON.
  // Try it first; only use slower browser fallbacks when SAL has no shipment data.
  const sal=normalizeResult(await trackSaudiaViaSal(input));
  if(sal?.ok&&sal?.shipment)return sal;

  const tm=normalizeResult(await trackSaudiaViaTrackingMorePublic(input));
  if(tm?.ok&&tm?.shipment)return tm;

  const china=normalizeResult(await trackSaudiaViaChina(input));
  if(china?.ok&&china?.shipment)return china;

  const connect=normalizeResult(await trackSaudiaViaConnect(input));
  if(connect?.ok&&connect?.shipment)return connect;

  const direct=normalizeResult(await trackSaudiaDirectV6(input));
  if(direct?.ok&&direct?.shipment)return direct;

  return {
    ...direct,
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
