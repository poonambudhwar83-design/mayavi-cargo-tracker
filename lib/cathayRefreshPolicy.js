// CX only: continue checking active shipments after their first successful
// ARRIVED status. New bookings and incomplete movement details retry on every
// scheduled 5-minute cycle. Resolved arrivals use a gentler cadence.
const ms=v=>{const n=Date.parse(v||'');return Number.isFinite(n)?n:0;};
export const CX_OPEN_RETRY_MS=4*60*1000;
export const CX_ACTIVE_ARRIVED_RETRY_MS=60*60*1000;
export const CX_RECENT_CLEARED_RETRY_MS=4*60*60*1000;
export function cathayRefreshDecision(data={},scope='SKIP',now=Date.now(),savedCheckedAt=''){
  const lastChecked=ms(data.lastChecked||savedCheckedAt||data.enteredAt);
  const missing=!data.flightNo||!data.arrivalDate||!data.arrivalTime;
  // A newly entered AWB with no flight/ETA should not be considered already
  // tracked merely because data.lastChecked was initialised on row creation.
  const noMovementYet=missing&&!data.flightNo&&!data.arrivalDate&&!data.arrivalTime;
  const status=String(data.status||'').toUpperCase();
  const unresolved=missing||data.arrivalIsActual!==true||
    !['ARRIVED','DELIVERED'].includes(status);
  const gap=unresolved?CX_OPEN_RETRY_MS:
    scope==='ACTIVE'?CX_ACTIVE_ARRIVED_RETRY_MS:CX_RECENT_CLEARED_RETRY_MS;
  return{missing,unresolved,checkedAt:lastChecked,due:scope!=='SKIP'&&(noMovementYet||now-lastChecked>=gap),gap};
}
