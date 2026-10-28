// Export shipment charge is applied ONCE per master MAWB, never per part.
// New entries default to INR 2,600; Admin may override each MAWB and the
// override is preserved in the shared database across monthly sheets.
export const EXPORT_SHIPMENT_CHARGE=2600;
export function resolvedExportShipmentCharge(value){
  if(value===null||value===undefined||String(value).trim()==='')return EXPORT_SHIPMENT_CHARGE;
  const number=Number(value);
  return Number.isFinite(number)&&number>=0?Math.round((number+Number.EPSILON)*100)/100:EXPORT_SHIPMENT_CHARGE;
}
export function validateExportShipmentCharge(value){
  const str=String(value??'').trim();
  if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(str))return null;
  const number=Number(str);
  return Number.isFinite(number)&&number<=99999999.99?number:null;
}
