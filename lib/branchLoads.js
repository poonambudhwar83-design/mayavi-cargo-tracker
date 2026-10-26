export const BRANCHES=['JIND','KARNAL'];
export const DESTINATIONS=['UK','USA','Canada','Australia','New Zealand','Germany','France','Italy','Spain','Netherlands','Belgium','Ireland','UAE','Saudi Arabia','Kuwait','Oman','Qatar','Bahrain','Singapore','Hong Kong','Malaysia','Japan','South Africa'];
export const SERVICES=['FedEx','Aramex','DHL','Self','UPS','Blue Dart','DTDC','India Post','Air Cargo','Express','Economy','Courier','Documents','Door to Door','Other'];
export const LOAD_STATUSES=['PENDING','IN_TRANSIT','DISPATCHED','DELIVERED'];
export const COMMODITIES=['Clothes','Protein','Household Goods','Dry Fruits','Food Items','Documents','Medicine','Electronics','Battery','Ghee','Other'];
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
export function amounts(weight,rate,received=0){
  const w=decimal(weight,3,true),r=decimal(rate,4,true),receivedN=decimal(received,2);
  if(w===null||w<=0||r===null||receivedN===null)return null;
  const amount=Math.round((w*r+Number.EPSILON)*100)/100;
  return {amount,balance:Math.round((amount-receivedN+Number.EPSILON)*100)/100};
}
