// Import Profit landed-cost rules. Freight applies ONLY to Protein,
// based on original departure origin (never Via or destination).
// A Protein shipment receives at most one country/airport freight tariff.
export const IMPORT_FREIGHT_RATES=Object.freeze({DXB:173,CANADA:450,USA:410,GERMANY:322});
const DXB=/(^|[^A-Z0-9])(DXB|DUBAI)($|[^A-Z0-9])/;
const CANADA=/(^|[^A-Z0-9])(CANADA|CANADIAN|TORONTO|VANCOUVER|MONTREAL|MONTRÉAL|CALGARY|EDMONTON|OTTAWA|WINNIPEG|HALIFAX|QUEBEC|QUÉBEC|VICTORIA|SASKATOON|REGINA|YYZ|YVR|YUL|YYC|YEG|YOW|YWG|YHZ|YQB|YYJ|YXE|YQR|YKF|YHM|YXX|YQG|YQM|YYT|YXS|YQT)($|[^A-Z0-9])/;
const GERMANY=/(^|[^A-Z0-9])(GERMANY|DEUTSCHLAND|FRANKFURT|MUNICH|MUENCHEN|MÜNCHEN|BERLIN|DUSSELDORF|DÜSSELDORF|HAMBURG|STUTTGART|COLOGNE|KOELN|KÖLN|HANOVER|HANNOVER|NUREMBERG|NUERNBERG|NÜRNBERG|LEIPZIG|DRESDEN|BREMEN|FRA|MUC|BER|DUS|HAM|STR|CGN|HAJ|NUE|LEJ|DRS|BRE|FMO|FKB|HHN)($|[^A-Z0-9])/;
const USA=/(^|[^A-Z0-9])(USA|U[.]?S[.]?A[.]?|US|UNITED[ -]?STATES|AMERICA|AMERICAN|NEW[ -]?YORK|LOS[ -]?ANGELES|SAN[ -]?FRANCISCO|CHICAGO|NEWARK|MIAMI|ATLANTA|DALLAS|WASHINGTON|BOSTON|SEATTLE|HOUSTON|PHILADELPHIA|DENVER|DETROIT|MINNEAPOLIS|CHARLOTTE|ORLANDO|LAS[ -]?VEGAS|JFK|EWR|LAX|SFO|ORD|MIA|ATL|DFW|IAD|DCA|BOS|SEA|IAH|HOU|PHL|DEN|DTW|MSP|CLT|MCO|FLL|LAS|SLC|PDX|PHX|SAN|HNL|AUS|BWI|TPA|RDU|SJC|SMF|OAK|CVG|CLE|IND|MCI|PIT|STL|SAT|BNA|MKE|CMH|SNA|ONT)($|[^A-Z0-9])/;
export function importFreightRegion(origin='',goodsCategory=''){
  // Do not charge DXB/Canada/USA/Germany freight on Clothes, HH,
  // Battery or any other non-Protein commodity, regardless of origin.
  if(String(goodsCategory||'').trim().toUpperCase()!=='PROTEIN')return '';
  const departure=String(origin||'').trim().toUpperCase();
  if(DXB.test(departure))return 'DXB';
  if(CANADA.test(departure))return 'CANADA';
  if(GERMANY.test(departure))return 'GERMANY';
  if(USA.test(departure))return 'USA';
  return '';
}
export const importFreightRate=(origin,goodsCategory)=>IMPORT_FREIGHT_RATES[importFreightRegion(origin,goodsCategory)]||0;

// Protein goods-charge per physical bag. This is independent from the
// origin freight PER KG and the protein handling deduction PER KG.
// DXB ₹3,000; USA (including JFK), Canada and Germany ₹1,800;
// all other known origins ₹1,500. A missing origin needs correction.
export function importProteinGoodsChargePerBag(origin=''){
  const departure=String(origin||'').trim();
  if(!departure)return null;
  const region=importFreightRegion(departure,'PROTEIN');
  return region==='DXB'?3000:
    region==='USA'||region==='CANADA'||region==='GERMANY'?1800:1500;
}
// The previous 15% Goods Charge surcharge has been retired. Keep it OUT of
// Total Cost, even if a legacy caller still passes goodsCharge15Percent.
export function importTotalCost({duty,eici,goodsCharge,driverExpense,freightCharge,proteinDeduction,siibDeduction}){
  const costs=[duty,eici,driverExpense,goodsCharge,proteinDeduction,siibDeduction,freightCharge];
  if(costs.some(n=>typeof n!=='number'||!Number.isFinite(n)))return null;
  return Math.round((costs.reduce((sum,n)=>sum+n,0)+Number.EPSILON)*100)/100;
}
export function importNetProfit(rate,weight,totalCost){
  if([rate,weight,totalCost].some(n=>typeof n!=='number'||!Number.isFinite(n)))return null;
  return Math.round((rate*weight-totalCost+Number.EPSILON)*100)/100;
}

// Extra physical weight earns revenue with NO extra Duty, EICI, Goods,
// freight, Driver, Protein or Clothes expense.
export function importExcessProfit(rate,excessWeight){
  if(excessWeight===null||excessWeight===undefined||String(excessWeight).trim()==='')return null;
  const kg=Number(excessWeight),sellingRate=Number(rate);
  if(rate===null||rate===undefined||String(rate).trim()===''||
     !Number.isFinite(kg)||kg<0||!Number.isFinite(sellingRate)||sellingRate<0)return null;
  return Math.round((kg*sellingRate+Number.EPSILON)*100)/100;
}
export function importProfitIncludingExcess(baseProfit,excessProfit){
  if(typeof baseProfit!=='number'||!Number.isFinite(baseProfit))return null;
  return Math.round((baseProfit+(excessProfit??0)+Number.EPSILON)*100)/100;
}
