import { trackSaudiaViaSal } from './saudiaSalPublic.js';
import { trackSaudiaDirect as trackSaudiaDirectV6 } from './saudiaDirectV6.js';

function mapSaudiaStatus(code='',fallback='TRACKING'){
  const s=String(code||'').trim().toUpperCase();
  if(s==='BKD') return 'BOOKED';
  if(s==='DLV') return 'ARRIVED';
  if(s==='XXX') return 'IN TRANSIT';
  return fallback||'TRACKING';
}

function normalizeResult(result){
  if(result?.ok&&result?.shipment){
    const shipment={...result.shipment};
    shipment.status=mapSaudiaStatus(shipment.sourceStatus,shipment.status);
    return {...result,shipment};
  }
  return result;
}

export async function trackSaudiaDirect(input){
  const sal=normalizeResult(await trackSaudiaViaSal(input));
  if(sal?.ok&&sal?.shipment)return sal;

  const direct=normalizeResult(await trackSaudiaDirectV6(input));
  if(direct?.ok&&direct?.shipment)return direct;

  return {
    ...direct,
    debug:{
      ...(direct?.debug||{}),
      sal:{reason:sal?.reason||'',stage:sal?.debug?.stage||'',sample:sal?.debug?.sample||''}
    },
    reason:direct?.reason||sal?.reason||'SAUDIA TRACKING FAILED'
  };
}
