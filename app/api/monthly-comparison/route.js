import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../lib/mayaviAuth.js';
import {masterKg,partKg} from '../../../lib/arrivalWeights.js';
import {physicalImportProfitRows} from '../../../lib/importProfitPhysicalRows.js';
import {importArrivalMonth,istMonthKey} from '../../../lib/monthlyArchive.js';
import {confirmedExportHandoverMonth} from '../../../lib/exportHandoverAccounting.js';
import {currentProfitMonth,profitMonths,FIRST_PROFIT_MONTH} from '../../../lib/profitPeriod.js';
import {figures} from '../../../lib/importProfitFigures.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function sqlClient(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw new Error('Shared database is not configured.');
  return neon(url);
}
const digits=v=>String(v??'').replace(/\D/g,'');
const text=v=>String(v??'').trim().replace(/\s+/g,' ');
const upper=v=>text(v).toUpperCase();
const positive=v=>{
  const raw=String(v??'').replace(/,/g,'').trim();
  const value=raw.includes('/')?raw.split('/').at(-1):raw;
  if(!/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*$/.test(value))return null;
  const n=value.split('+').reduce((sum,x)=>sum+Number(x),0);
  return Number.isFinite(n)&&n>=0?n:null;
};
function totalBags(data={}){
  for(const field of ['totalPieces','masterPieces','totalBags','masterBags','bags','pieces']){
    const found=positive(data[field]);if(found!==null)return found;
  }
  const parts=Array.isArray(data.partShipments)?data.partShipments:[];
  const sum=parts.reduce((s,p)=>s+(positive(p?.pieces??p?.bags)||0),0);
  return sum||null;
}
function totalWeight(data={}){
  const master=masterKg(data);
  if(master!==null)return master;
  const seen=new Set();
  let weight=0;
  for(const p of Array.isArray(data.partShipments)?data.partShipments:[]){
    if(!p||p._saudiaPendingVirtual===true)continue;
    const key=String(p.partKey||p.partId||'').trim()||[p.flightNo,p.flightDate||p.departureDate,p.pieces||p.bags,p.weight].join('|');
    if(seen.has(key))continue;
    seen.add(key);weight+=partKg(p.weight)||0;
  }
  return weight>0?weight:null;
}
function inferGoods(value=''){
  const raw=upper(value);
  if(/\bPROTEIN\b|\bWHEY\b/.test(raw))return 'PROTEIN';
  if(/\bCLOTH(?:ES|ING)?\b|\bGARMENTS?\b|\bAPPAREL\b/.test(raw))return 'CLOTHES';
  if(/\bHH\b|\bHOUSE\s*HOLD\b|\bHOUSEHOLD\b/.test(raw))return 'HH';
  if(/\bBATTER(?:Y|IES)\b/.test(raw))return 'BATTERY';
  if(/\bSWITCH(?:ES)?\b/.test(raw))return 'SWITCH';
  return '';
}
function goodsCategory(saved={},data={}){
  if(saved.goods_category!==undefined&&saved.goods_category!==null){
    const category=upper(saved.goods_category);
    return ['HH','PROTEIN','CLOTHES','BATTERY','SWITCH'].includes(category)?category:'';
  }
  return inferGoods(data.goodsDescription||data.goods_description||'');
}
function numberText(value,empty=''){
  return value===undefined||value===null?empty:String(value);
}
function validMonth(month,current){
  return month>=FIRST_PROFIT_MONTH&&month<=current&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
}
async function maybeRows(sql,query){
  try{return await sql.query(query)}catch(error){
    if(error?.code==='42P01'||/does not exist/i.test(String(error?.message||'')))return [];
    throw error;
  }
}
// Live masters are authoritative. Saved monthly snapshots are used only when
// the original master is no longer in the tracker, never to count it twice.
function allMasters(live=[],archived=[],type='IMPORT'){
  const present=new Set(),records=[];
  for(const row of live){
    const awb=digits(row.awb);
    if(awb.length!==11||present.has(awb))continue;
    present.add(awb);
    records.push({awb,data:row.data||{}});
  }
  const archivedKeys=new Set();
  for(const row of archived){
    if(row.shipment_type!==type)continue;
    const awb=digits(row.awb),month=String(row.archive_month||'');
    const key=awb+'|'+month;
    if(awb.length!==11||present.has(awb)||archivedKeys.has(key))continue;
    archivedKeys.add(key);
    records.push({awb,data:row.data||{},archiveMonth:month});
  }
  return records;
}
function importEntries(masters,financials,partDuties,current){
  const finance=new Map(financials.map(r=>[digits(r.awb),r]));
  const partFinance=new Map(partDuties.map(r=>[digits(r.awb)+'|'+r.part_key,r]));
  const items=[],seen=new Set();
  for(const {awb,data} of masters){
    const saved=finance.get(awb)||{};
    const description=upper(data.goodsDescription||data.goods_description||'');
    const goods=goodsCategory(saved,data)||'OTHER';
    const client=upper(data.clientName||data.client)||'UNASSIGNED CLIENT';
    const origin=upper(data.origin)||'UNKNOWN ORIGIN';
    for(const physical of physicalImportProfitRows(data,awb)){
      const arrivalMonth=importArrivalMonth(physical.arrivalDate);
      const clearanceMonth=!arrivalMonth&&physical.customsClearedAt?istMonthKey(physical.customsClearedAt):'';
      // Only dated and verified arrivals/clearances enter comparisons.
      // Active pending movement is not silently assigned to the current month.
      const month=arrivalMonth&&physical.confirmed?arrivalMonth:clearanceMonth;
      if(!validMonth(month,current))continue;
      const rowKey=physical.rowKey||awb,key=month+'|'+rowKey;
      if(seen.has(key))continue;
      seen.add(key);
      const isPart=rowKey!==awb;
      const part=isPart?partFinance.get(awb+'|'+rowKey):null;
      const inputs={
        ...physical,weight:isPart?physical.weight:totalWeight(data),
        bags:isPart?physical.bags:totalBags(data),
        totalDuty:numberText(isPart?part?.total_duty:saved.total_duty),
        excessWeight:numberText(isPart?part?.excess_weight:saved.excess_weight),
        rate:numberText(saved.rate),goodsCategory:goods==='OTHER'?'':goods,
        origin,driverExpense:numberText(saved.driver_expense,'2600')
      };
      const calc=figures(inputs);
      items.push({
        month,awb,client,origin,goods,
        description:description||'UNSPECIFIED DESCRIPTION',
        weight:calc.kg,bags:calc.bags,profit:calc.profit
      });
    }
  }
  return items;
}
function exportEntries(masters,current){
  const items=[],seen=new Set();
  for(const {awb,data} of masters){
    const month=confirmedExportHandoverMonth(data);
    if(!validMonth(month,current)||seen.has(awb+'|'+month))continue;
    seen.add(awb+'|'+month);
    items.push({
      month,awb,client:upper(data.clientName||data.client)||'UNASSIGNED CLIENT',
      weight:totalWeight(data)
    });
  }
  return items;
}
export async function GET(request){
  if(readSession(request)?.role!=='admin')
    return Response.json({ok:false,error:'Admin authorization required.'},{status:403});
  const kind=new URL(request.url).searchParams.get('type');
  if(kind!=='import'&&kind!=='export')
    return Response.json({ok:false,error:'Select import or export comparison.'},{status:400});
  try{
    const sql=sqlClient();
    const isImport=kind==='import',type=isImport?'IMPORT':'EXPORT';
    const [live,archive]=await Promise.all([
      isImport?sql`SELECT awb,data FROM mayavi_shipments
          WHERE COALESCE(data->>'shipmentType','IMPORT')='IMPORT' ORDER BY updated_at DESC`:
        sql`SELECT awb,data FROM mayavi_shipments
          WHERE UPPER(COALESCE(data->>'shipmentType',''))='EXPORT' ORDER BY updated_at DESC`,
      maybeRows(sql,"SELECT archive_month,shipment_type,awb,data FROM mayavi_monthly_archive WHERE shipment_type='"+type+"' ORDER BY archive_month DESC")
    ]);
    const masters=allMasters(live,archive,type);
    const current=currentProfitMonth();
    let rows;
    if(isImport){
      const [financials,partDuties]=await Promise.all([
        maybeRows(sql,"SELECT awb,total_duty,rate,goods_category,driver_expense,excess_weight FROM mayavi_import_profit"),
        maybeRows(sql,"SELECT awb,part_key,total_duty,excess_weight FROM mayavi_import_profit_part_duty")
      ]);
      rows=importEntries(masters,financials,partDuties,current);
    }else rows=exportEntries(masters,current);
    return Response.json({ok:true,type:kind,months:profitMonths(),rows},
      {headers:{'Cache-Control':'no-store,private'}});
  }catch(error){
    console.error('monthly_comparison',String(error?.message||error).slice(0,200));
    return Response.json({ok:false,error:'Monthly comparison is unavailable. Please refresh.'},{status:503});
  }
}
