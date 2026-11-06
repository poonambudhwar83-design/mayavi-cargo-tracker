// No fixed Export per-MAWB charge. Only matched Audit X-ray + Shift + Loader + Co-loader
// applies when G&C, D, T and DT are ALL blank. Historical manual charges are ignored.
export const EXPORT_SHIPMENT_CHARGE=0;
export function resolvedExportShipmentCharge(value){
  if(value===null||value===undefined||String(value).trim()==='')return 0;
  const number=Number(value);
  return Number.isFinite(number)&&number>=0?Math.round((number+Number.EPSILON)*100)/100:0;
}
export function auditOnlyExportShipmentCharge(row={}){
  // Never accidentally deduct old ₹2,600/₹2,500 manual values.
  return row.auditAutoCharge===true?resolvedExportShipmentCharge(row.shipmentCharge):0;
}
export function validateExportShipmentCharge(value){
  const str=String(value??'').trim();
  if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(str))return null;
  const number=Number(str);
  return Number.isFinite(number)&&number<=99999999.99?number:null;
}
