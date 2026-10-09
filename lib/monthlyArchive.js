import { neon } from '@neondatabase/serverless';

function connectionString(){
  return process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
}
export function monthlyDb(){
  const url=connectionString();
  if(!url)throw new Error('DATABASE_URL is not configured in Vercel.');
  return neon(url);
}

function pad(v){return String(v).padStart(2,'0')}

export function istMonthKey(value=new Date()){
  const d=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(d.getTime()))return'';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(d);
  const year=parts.find(p=>p.type==='year')?.value||'';
  const month=parts.find(p=>p.type==='month')?.value||'';
  return year&&month?`${year}-${month}`:'';
}

function dateFromLoose(value=''){
  const s=String(value||'').trim();
  if(!s)return null;
  const iso=new Date(s);
  if(Number.isFinite(iso.getTime()))return iso;
  let m=s.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if(m)return new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),12,0,0));
  m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](20\d{2})/);
  if(m)return new Date(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]),12,0,0));
  return null;
}

function shipmentMonth(data={},updatedAt=''){
  const candidates=[
    data.enteredAt,
    data.entryDate,
    data.bookingDate,
    data.departureDate,
    data.arrivalDate,
    updatedAt
  ];
  for(const value of candidates){
    const d=dateFromLoose(value);
    if(d)return istMonthKey(d);
  }
  return'';
}

// Import month follows ARRIVAL date; never entry/booking date.
export function importArrivalMonth(value=''){
  const raw=String(value||'').trim();
  let m=raw.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:\D|$)/);
  let year,month,day;
  if(m){year=Number(m[1]);month=Number(m[2]);day=Number(m[3]);}
  else{
    m=raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](20\d{2})(?:\D|$)/);
    if(!m)return'';
    day=Number(m[1]);month=Number(m[2]);year=Number(m[3]);
  }
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()+1!==month||d.getUTCDate()!==day)return'';
  return year+'-'+pad(month);
}

function shipmentType(value=''){
  const t=String(value||'').trim().toUpperCase();
  return t==='EXPORT'?'EXPORT':t==='IMPORT'?'IMPORT':'';
}

export async function ensureMonthlyArchiveTable(sql){
  await sql`
    CREATE TABLE IF NOT EXISTS mayavi_monthly_archive (
      archive_month text NOT NULL,
      shipment_type text NOT NULL,
      awb text NOT NULL,
      data jsonb NOT NULL,
      archived_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (archive_month, shipment_type, awb)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_monthly_archive_month_idx ON mayavi_monthly_archive (archive_month DESC, shipment_type)`;
}

export async function snapshotClosedMonths(sql){
  await ensureMonthlyArchiveTable(sql);
  const currentMonth=istMonthKey(new Date());
  const sourceRows=await sql`SELECT awb,data,updated_at FROM mayavi_shipments ORDER BY updated_at ASC`;
  const candidates=[];
  for(const row of sourceRows){
    const data=row.data||{};
    const type=shipmentType(data.shipmentType);
    if(!type)continue;
    const awb=String(row.awb||'').replace(/\D/g,'');
    if(type==='IMPORT'){
      const parts=Array.isArray(data.partShipments)?data.partShipments.filter(Boolean):[];
      // A split MAWB can arrive in multiple months. Archive only the
      // physical parts arriving during that month; preserve the live master.
      const datedParts=parts.filter(p=>importArrivalMonth(p.arrivalDate));
      if(datedParts.length){
        const byMonth=new Map();
        for(const part of datedParts){
          const month=importArrivalMonth(part.arrivalDate);
          if(month>=currentMonth)continue;
          if(!byMonth.has(month))byMonth.set(month,[]);
          byMonth.get(month).push(part);
        }
        for(const [month,monthParts] of byMonth){
          candidates.push({
            archive_month:month,shipment_type:'IMPORT',awb,
            data:{...data,partShipments:monthParts,archiveMonth:month,
              archiveShipmentType:'IMPORT',archiveBy:'arrivalDate'}
          });
        }
        continue;
      }
      const month=importArrivalMonth(data.arrivalDate);
      if(!month||month>=currentMonth)continue;
      candidates.push({archive_month:month,shipment_type:'IMPORT',awb,
        data:{...data,archiveMonth:month,archiveShipmentType:'IMPORT',archiveBy:'arrivalDate'}});
      continue;
    }
    // Leave the existing Export archival policy unchanged.
    const month=shipmentMonth(data,row.updated_at);
    if(!month||!currentMonth||month>=currentMonth)continue;
    candidates.push({archive_month:month,shipment_type:type,awb,
      data:{...data,archiveMonth:month,archiveShipmentType:type}});
  }
  if(!candidates.length)return{currentMonth,candidates:0,inserted:0};
  const payload=JSON.stringify(candidates);
  const inserted=await sql`
    INSERT INTO mayavi_monthly_archive (archive_month,shipment_type,awb,data,archived_at)
    SELECT
      item->>'archive_month',
      item->>'shipment_type',
      item->>'awb',
      item->'data',
      now()
    FROM jsonb_array_elements(${payload}::jsonb) AS item
    ON CONFLICT (archive_month,shipment_type,awb) DO NOTHING
    RETURNING awb
  `;
  return{currentMonth,candidates:candidates.length,inserted:inserted.length};
}

export function monthLabel(key=''){
  const m=String(key).match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if(!m)return key;
  return new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(Date.UTC(Number(m[1]),Number(m[2])-1,1,12,0,0)));
}
