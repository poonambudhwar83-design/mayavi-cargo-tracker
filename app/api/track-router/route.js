const CX_PREFIX='160';
const ORIGINAL_FLAG='__mayavi_original';
const PLANE_FINDER='https://planefinder.net/data/flight';
const MONTH_NAME={'01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'};

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

function normalizeMawb(value=''){
  const digits=String(value||'').replace(/\D/g,'');
  return digits.length===11?`${digits.slice(0,3)}-${digits.slice(3)}`:'';
}

function htmlToText(html=''){
  return String(html||'')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&gt;/gi,'>')
    .replace(/&lt;/gi,'<')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&quot;/gi,'"')
    .replace(/\s+/g,' ')
    .trim();
}

function dateLabel(date=''){
  const m=String(date||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if(!m)return'';
  return`${Number(m[3])} ${MONTH_NAME[m[2]]||''} ${m[1]}`.trim();
}

function nextDate(date=''){
  const d=new Date(`${date}T00:00:00Z`);
  if(Number.isNaN(d.getTime()))return date;
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
}

function rowCandidates(html='',targetDate=''){
  const label=dateLabel(targetDate);
  if(!label)return[];
  const exact=new RegExp(`\\b${label.replace(/\s+/g,'\\s+')}\\b`,'i');
  const rows=[...String(html||'').matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map(m=>htmlToText(m[0]))
    .filter(row=>exact.test(row));
  if(rows.length)return rows;

  const text=htmlToText(html);
  const hits=[];
  const rx=/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2}\b/gi;
  const matches=[...text.matchAll(rx)];
  for(let i=0;i<matches.length;i++){
    if(!exact.test(matches[i][0]))continue;
    const start=matches[i].index||0;
    const end=i+1<matches.length?(matches[i+1].index||Math.min(text.length,start+700)):Math.min(text.length,start+700);
    hits.push(text.slice(start,end));
  }
  if(hits.length)return hits;

  const at=text.search(exact);
  return at>=0?[text.slice(at,Math.min(text.length,at+700))]:[];
}

function parseActualRow(row='',base={}){
  const origin=String(base.origin||'').toUpperCase();
  const destination=String(base.destination||'').toUpperCase();
  const upper=String(row||'').toUpperCase();
  if(origin&&!new RegExp(`\\b${origin}\\b`).test(upper))return null;
  if(destination&&!new RegExp(`\\b${destination}\\b`).test(upper))return null;

  const times=[...String(row||'').matchAll(/\b(\d{1,2}:\d{2})\b/g)].map(m=>({time:m[1],index:m.index||0}));
  if(times.length<2)return null;

  let departure=times[0];
  let arrival=null;
  if(destination){
    const dm=upper.match(new RegExp(`\\b${destination}\\b`));
    const destAt=dm?.index??-1;
    if(destAt>=0)arrival=times.find(t=>t.index>destAt)||null;
  }
  if(!arrival)arrival=times[1]||times.at(-1)||null;
  if(!departure||!arrival)return null;

  const clean=t=>{const [h,m]=String(t).split(':');return`${String(Number(h)).padStart(2,'0')}:${m}`};
  return{departureTime:clean(departure.time),arrivalTime:clean(arrival.time),rawRow:String(row).slice(0,700)};
}

async function fetchPlaneFinderActual(base={}){
  const flightNo=String(base.flightNo||'').replace(/\s+/g,'').toUpperCase();
  const departureDate=String(base.departureDate||base.arrivalDate||'');
  if(!/^CX\d{1,4}$/.test(flightNo)||!/^20\d{2}-\d{2}-\d{2}$/.test(departureDate))return null;

  try{
    const response=await fetch(`${PLANE_FINDER}/${flightNo}`,{
      headers:{
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        'accept':'text/html,application/xhtml+xml',
        'accept-language':'en-US,en;q=0.9'
      },
      redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)return null;
    const html=await response.text();
    const rows=rowCandidates(html,departureDate);
    for(const row of rows){
      const parsed=parseActualRow(row,base);
      if(!parsed)continue;
      let arrivalDate=String(base.arrivalDate||'');
      if(!arrivalDate){
        arrivalDate=departureDate;
        const depHour=Number(parsed.departureTime.slice(0,2));
        const arrHour=Number(parsed.arrivalTime.slice(0,2));
        if(arrHour<6&&depHour>=18)arrivalDate=nextDate(departureDate);
      }
      return{...parsed,arrivalDate,source:'Plane Finder past-flight actual arrival'};
    }
    return null;
  }catch{return null;}
}

async function originalResponse(request,bodyText=''){
  const url=new URL(request.url);
  url.pathname='/api/track';
  url.searchParams.set(ORIGINAL_FLAG,'1');
  const headers=new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('host');
  const init={method:request.method,headers,cache:'no-store'};
  if(request.method!=='GET'&&request.method!=='HEAD')init.body=bodyText;
  return fetch(url,init);
}

async function handle(request){
  let bodyText='';
  let mawb='';
  if(request.method==='GET'){
    mawb=normalizeMawb(new URL(request.url).searchParams.get('mawb')||'');
  }else{
    bodyText=await request.text();
    try{mawb=normalizeMawb(JSON.parse(bodyText||'{}')?.mawb||'')}catch{}
  }

  const original=await originalResponse(request,bodyText);
  const contentType=original.headers.get('content-type')||'';
  if(!mawb.startsWith(`${CX_PREFIX}-`)||!contentType.includes('application/json'))return original;

  let data=null;
  try{data=await original.json()}catch{return original;}
  const shipment=data?.shipment;
  if(!shipment)return Response.json(data,{status:original.status});

  const actual=await fetchPlaneFinderActual(shipment);
  if(!actual?.arrivalTime)return Response.json(data,{status:original.status});

  // CX-only correction: preserve Cathay's existing arrival date when it is already known.
  // Replace the time with the historical actual arrival time and mark it actual.
  const patched={
    ...shipment,
    arrivalDate:shipment.arrivalDate||actual.arrivalDate||'',
    arrivalTime:actual.arrivalTime,
    arrivalIsActual:true,
    status:String(shipment.status||'').toUpperCase()==='DELIVERED'?'DELIVERED':'ARRIVED',
    arrivalTimeSource:actual.source
  };

  return Response.json({
    ...data,
    version:`${data.version||'3.9'}-cx-time-fix-1`,
    shipment:patched,
    cxArrivalFix:{applied:true,flightNo:shipment.flightNo||'',departureDate:shipment.departureDate||'',departureTimeObserved:actual.departureTime,arrivalTimeObserved:actual.arrivalTime,source:actual.source}
  },{status:original.status});
}

export async function GET(request){return handle(request)}
export async function POST(request){return handle(request)}
