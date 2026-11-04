// Standalone "Other Countries" Excel analysis. No tracker/profit-sheet writes.
export const COUNTRY_BUCKETS = Object.freeze([
  { key:'under30', label:'Below 30 kg/bag' },
  { key:'from30To35', label:'30–35 kg/bag' },
  { key:'over35', label:'Above 35 kg/bag' }
]);
const clean = value => String(value ?? '').trim();
export const headerKey = value => clean(value).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim();
const ALIASES={
  courier:['courier name','courier','courier company','courier service','agent name','agent','company name','company',
    'client name','client','courierconame','courier co name','courier co. name','courier company name','courierco','courier co','customer name','customer','forwarder','freight forwarder','service provider','airline','shipping agent','operator'],
  weight:['total weight kg','total weight','gross weight kg','gross weight','net weight','actual weight','total load kg',
    'total load','load kg','load weight','shipment weight','weight in kg','weight kgs','weight kg','weight','kgs','kg','load'],
  bags:['number of bags','no of bags','no bags','total bags','bags count','bag count','bag quantity','no of packages',
    'no of pieces','number of pieces','number of packages','pieces','packages','no of pcs','pcs','bags','bag','quantity','qty'],
  country:['destination country','origin country','country name','destination','origin','country','sector','region']
};
const keyMap=Object.fromEntries(Object.entries(ALIASES).map(([key,vals])=>[key,new Set(vals.map(headerKey))]));
function cellValue(cell){
  let value=cell?.value;
  if(value&&typeof value==='object'&&!(value instanceof Date)){
    if(Object.hasOwn(value,'result'))value=value.result;
    else if(Object.hasOwn(value,'text'))value=value.text;
    else if(Array.isArray(value.richText))value=value.richText.map(x=>x.text||'').join('');
  }
  return value??'';
}
export function positiveNumber(value){
  if(typeof value==='number')return Number.isFinite(value)&&value>0?value:null;
  const normalized=clean(value).replace(/,/g,'').replace(/\s*(kg|kgs|kilograms?|bags?|pieces?|pcs)\s*$/i,'');
  if(!/^\d+(?:\.\d+)?$/.test(normalized))return null;
  const number=Number(normalized);
  return Number.isFinite(number)&&number>0?number:null;
}
function findColumns(sheet,mapping={}){
  let best=null;
  for(let rowNumber=1;rowNumber<=Math.min(25,sheet.rowCount);rowNumber++){
    const row=sheet.getRow(rowNumber),names={};
    for(let column=1;column<=Math.min(row.cellCount||0,100);column++){
      const key=headerKey(cellValue(row.getCell(column)));
      if(key&&!Object.hasOwn(names,key))names[key]=column;
    }
    const fields={};
    for(const field of ['courier','weight','bags','country']){
      const preferred=headerKey(mapping[field]);
      const requested=preferred?names[preferred]:null;
      const matches=Object.entries(names).find(([name])=>keyMap[field].has(name));
      fields[field]=requested||matches?.[1]||null;
    }
    const score=['courier','weight','bags'].filter(field=>fields[field]).length;
    if(score===3)return {rowNumber,fields};
    if(!best||score>best.score)best={rowNumber,fields,score,headers:Object.keys(names)};
  }
  return {error:'Required headings not found (Courier Name, Weight, No. of Bags).',
    headers:best?.headers||[],found:best?.fields||{}};
}
export function parseCountryWorkbook(workbook,mapping={}){
  const parsed=[],sheetNames=[],problems=[];
  let skipped=0,ignoredSheets=0;
  for(const sheet of workbook.worksheets){
    if(sheet.state==='veryHidden'||sheet.rowCount<2)continue;
    const header=findColumns(sheet,mapping);
    if(header.error){ignoredSheets++;problems.push(sheet.name+': '+(header.headers||[]).slice(0,16).join(', '));continue;}
    const {courier,weight,bags,country}=header.fields;
    sheetNames.push(sheet.name);
    for(let rn=header.rowNumber+1;rn<=sheet.rowCount;rn++){
      const row=sheet.getRow(rn);
      if(!row.hasValues)continue;
      const courierName=clean(cellValue(row.getCell(courier)));
      const weightKg=positiveNumber(cellValue(row.getCell(weight)));
      const bagValue=positiveNumber(cellValue(row.getCell(bags)));
      const totalLabel=/^(?:grand\s*total|sub\s*total|total|sum|overall\s*total)$/i.test(courierName);
      if(!courierName||totalLabel||weightKg===null||bagValue===null||!Number.isInteger(bagValue)||bagValue>1000000){
        skipped++;continue;
      }
      const countryName=country?clean(cellValue(row.getCell(country))):'';
      parsed.push({courierName:courierName.slice(0,160),country:countryName.slice(0,120)||'Unspecified',
        weightKg:Math.round(weightKg*1000)/1000,bags:bagValue,
        avgBagKg:weightKg/bagValue,sheet:sheet.name,rowNumber:rn});
      if(parsed.length>40000)throw Error('Excel has more than 40,000 valid entries. Upload separate monthly files.');
    }
  }
  if(!parsed.length){
    throw Error('No valid rows found. Required columns: Courier Name, Weight (kg), No. of Bags. '+
      (problems.length?'Detected sheets: '+problems.slice(0,2).join(' | ').slice(0,260):''));
  }
  return {rows:parsed,skipped,ignoredSheets,sheetNames};
}
export function bucketFor(weight,bags){
  if(!(Number(weight)>0&&Number(bags)>0))return null;
  const avg=Number(weight)/Number(bags);
  return avg<30?'under30':avg<=35?'from30To35':'over35';
}
export function summarizeCountryRows(rows=[]){
  const byCourier=new Map();
  for(const row of rows){
    const courierName=clean(row.courierName||row.courier_name);
    const weight=Number(row.weightKg??row.weight_kg),bags=Number(row.bags);
    if(!courierName||!(weight>0&&bags>0))continue;
    const key=courierName.toLowerCase();
    let item=byCourier.get(key);
    if(!item){item={courierName,entries:0,totalWeight:0,totalBags:0,under30:0,from30To35:0,over35:0};byCourier.set(key,item);}
    item.entries++;item.totalWeight+=weight;item.totalBags+=bags;
    item[bucketFor(weight,bags)]+=weight;
  }
  return [...byCourier.values()].map(row=>({...row,avgBagKg:row.totalBags?row.totalWeight/row.totalBags:0}))
    .sort((a,b)=>b.totalWeight-a.totalWeight||a.courierName.localeCompare(b.courierName));
}
