import { trackSaudiaDirect as trackSaudiaDirectV5 } from './saudiaDirectV5.js';

function mapSaudiaStatus(code='',fallback='TRACKING'){
  const s=String(code||'').trim().toUpperCase();
  if(s==='BKD') return 'BOOKED';
  if(s==='DLV') return 'ARRIVED';
  if(s==='XXX') return 'IN TRANSIT';
  return fallback||'TRACKING';
}

export async function trackSaudiaDirect(input){
  const result=await trackSaudiaDirectV5(input);
  if(result?.ok&&result?.shipment){
    const shipment={...result.shipment};
    shipment.status=mapSaudiaStatus(shipment.sourceStatus,shipment.status);
    return {...result,shipment};
  }
  return result;
}
