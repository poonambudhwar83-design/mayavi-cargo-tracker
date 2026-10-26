export const BRANCHES=['JIND','KARNAL'];
export const DESTINATIONS=['UK','USA','Canada','Australia','New Zealand','Germany','France','Italy','Spain','Netherlands','Belgium','Ireland','UAE','Saudi Arabia','Kuwait','Oman','Qatar','Bahrain','Singapore','Hong Kong','Malaysia','Japan','South Africa'];
export const SERVICES=['FedEx','Aramex','DHL','Self','TPL','KCC','UPS','Blue Dart','DTDC','India Post','Air Cargo','Express','Economy','Courier','Documents','Door to Door','Other'];
export const LOAD_STATUSES=['AT_JIND_OFFICE','AT_KARNAL_OFFICE','AT_JEPO_OFFICE','DISPATCHED','IN_TRANSIT','DELIVERED'];
export const statusLabel=status=>({
 AT_JIND_OFFICE:'At Jind Office',AT_KARNAL_OFFICE:'At Karnal Office',
 AT_JEPO_OFFICE:'At JEPO Office',DISPATCHED:'Dispatched',
 IN_TRANSIT:'In Transit',DELIVERED:'Delivered',PENDING:'Pending'
}[status]||String(status||'Pending').replace(/_/g,' '));
export const initialBranchStatus=branch=>String(branch||'').toUpperCase()==='KARNAL'?'AT_KARNAL_OFFICE':'AT_JIND_OFFICE';
export const EXTRA_COST_COMMODITIES=['Household and Medicine','Household and Ghee','Household and Electronics'];
export const COMMODITIES=['Clothes','Protein','Household Goods',...EXTRA_COST_COMMODITIES,'Dry Fruits','Food Items','Documents','Medicine','Electronics','Battery','Ghee','Other'];
export const requiresExtraCost=commodity=>EXTRA_COST_COMMODITIES.includes(String(commodity||'').trim());
export const allowedBranch=(value)=>BRANCHES.includes(String(value||'').trim().toUpperCase())?String(value).trim().toUpperCase():'';
export const dateValid=(value)=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function decimal(value,digits=2,required=false){
  if(value===null||value===undefined||String(value).trim()==='')return required?null:0;
  const text=String(value).trim();
  const rule=new RegExp('^\\d+(?:\\.\\d{1,'+digits+'})?$');
  if(!rule.test(text))return null;
  const n=Number(text);
  return Number.isFinite(n)&&n<=1_000_000_000?n:null;
}
// JEPO Rate is a separate ₹/kg charge; never accept a client-supplied JEPO total.
export function jepoAmount(weight,jepoRate){
  const w=decimal(weight,3,true),r=decimal(jepoRate,4,true);
  if(w===null||w<=0||r===null)return null;
  return Math.round((w*r+Number.EPSILON)*100)/100;
}
export function amounts(weight,rate,received=0){
  const w=decimal(weight,3,true),r=decimal(rate,4,true),receivedN=decimal(received,2);
  if(w===null||w<=0||r===null||receivedN===null)return null;
  const amount=Math.round((w*r+Number.EPSILON)*100)/100;
  return {amount,balance:Math.round((amount-receivedN+Number.EPSILON)*100)/100};
}
