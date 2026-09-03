import { normalizeMawb } from './airlines.js';

const BASE='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:'https://www.cathaycargo.com/en-us/track-and-trace.html'};
const MONTH='(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)';
const DATE=`\\d{1,2}\\s+${MONTH}\\s+20\\d{2}`;
const TIME='\\d{1,2}:\\d{2}';
const cleanHtml=s=>String(s||'')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;/gi,"'")
  .replace(/\s+/g,' ')
  .trim();
const pick=(s,rx)=>(s.match(rx)||[])[1]||'';
const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const monthNames={JAN:'Jan',FEB:'Feb',MAR:'Mar',APR:'Apr',MAY:'May',JUN:'Jun',JUL:'Jul',AUG:'Aug',SEP:'Sep',OCT:'Oct',NOV:'Nov',DEC:'Dec'};
function dateTime(v=''){
  const s=String(v).toUpperCase();
  const m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};
  return{date:`${m[3]}-${months[m[2]]}-${String(m[1]).padStart(2,'0')}`,time:m[4]?`${String(m[4]).padStart(2,'0')}:${m[5]}`:''};
}
function section(text,start,next){
  const i=text.search(start);if(i<0)return'';const rest=text.slice(i);const n=next?rest.slice(1).search(next):-1;return n>=0?rest.slice(0,n+1):rest.slice(0,1400);
}
function latestStatus(text=''){
  if(/Cargo Delivered\s*\(DLV\)|\bDLV\b/i.test(text))return'DELIVERED';
  if(/Received from Flight\s*\(RCF\)|\bRCF\b/i.test(text))return'ARRIVED';
  if(/Departure Flight\s*\(DEP\)|\bDEP\b/i.test(text))return'IN TRANSIT';
  if(/Received from Shipper\s*\(RCS\)|\bRCS\b/i.test(text))return'BOOKED';
  return'TRACKING';
}
function parseMilestones(plain){
  const out={pieces:'',weight:'',flightNo:'',flightDate:'',departureActual:'',arrival:{date:'',time:''},arrivalIsActual:false};
  const rcs=section(plain,/Received from Shipper\s*\(RCS\)/i,/Departure Flight|Received from Flight|Cargo Delivered/i);
  const dep=section(plain,/Departure Flight\s*\(DEP\)/i,/Received from Flight|Cargo Delivered/i);
  const rcf=section(plain,/Received from Flight\s*\(RCF\)/i,/Cargo Delivered/i);
  const dlv=section(plain,/Cargo Delivered\s*\(DLV\)/i,null);

  if(rcs){
    const m=rcs.match(new RegExp(`Received On\\s+Pieces\\s+Received Wt\\s+(${DATE}\\s+${TIME})\\s+(\\d{1,6})\\s+([\\d,.]+)`,'i'));
    if(m){out.pieces=m[2];out.weight=m[3].replace(/,/g,'');}
  }
  if(dep){
    const flights=[...dep.matchAll(new RegExp(`\\b(CX\\d{2,4})\\s+(${DATE})\\s+(${TIME})\\s*\\(STD\\)\\s+(\\d{1,6})\\s+([\\d,.]+)`,'gi'))];
    if(flights.length){
      const m=flights[flights.length-1];
      out.flightNo=m[1].toUpperCase();out.flightDate=dateTime(m[2]).date;out.pieces=m[4];out.weight=m[5].replace(/,/g,'');
      const after=dep.slice(m.index+m[0].length, m.index+m[0].length+180);
      const atd=after.match(new RegExp(`(${DATE})?\\s*(${TIME})\\s*\\(ATD\\)`,'i'));
      if(atd)out.departureActual=`${atd[1]||m[2]} ${atd[2]}`.trim();
    }
  }
  if(rcf){
    const flights=[...rcf.matchAll(new RegExp(`\\b(CX\\d{2,4})\\s+(${DATE})(?:\\s+${TIME})?\\s+(\\d{1,6})\\s+([\\d,.]+)\\s+(${DATE}\\s+${TIME})`,'gi'))];
    if(flights.length){const m=flights[flights.length-1];out.flightNo=m[1].toUpperCase();out.flightDate=dateTime(m[2]).date;out.pieces=m[3];out.weight=m[4].replace(/,/g,'');out.arrival=dateTime(m[5]);out.arrivalIsActual=true;}
  }
  if(dlv){
    const delivered=[...dlv.matchAll(new RegExp(`(${DATE}\\s+${TIME})\\s+(\\d{1,6})\\s+([\\d,.]+)`,'gi'))];
    if(delivered.length){const m=delivered[delivered.length-1];out.pieces=m[2];out.weight=m[3].replace(/,/g,'');}
  }
  return out;
}
function ymdToDisplay(ymd=''){
  const m=String(ymd).match(/^(20\d{2})-(\d{2})-(\d{2})$/);if(!m)return'';
  const key=Object.keys(months).find(k=>months[k]===m[2]);
  return key?`${monthNames[key]} ${Number(m[3])}, ${m[1]}`:'';
}
function timeToMinutes(v=''){const m=String(v).match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null;}
async function flightStatusFallback(shipment,flightDate){
  if(!shipment?.flightNo||!shipment?.origin||!shipment?.destination||!flightDate)return null;
  const url=`https://www.flightinformation.com/${shipment.flightNo}-${shipment.origin}-${shipment.destination}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null;
    const html=await r.text(),plain=cleanHtml(html),d=ymdToDisplay(flightDate);
    if(!d)return null;
    const escaped=d.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const arrivalBlock=section(plain,/Arrival delays/i,/Flight schedule|Other flights|Departure delays/i)||plain;
    const row=arrivalBlock.match(new RegExp(`${escaped}\\s+(\\d{1,2}:\\d{2})\\s+(\\d{1,2}:\\d{2}|--)\\s+([^A-Za-z]{0,8}[+-]?\\d+\\s*minutes?|On time|[^ ]+)`,'i'))
      ||arrivalBlock.match(new RegExp(`${escaped}\\s+(\\d{1,2}:\\d{2})\\s+(\\d{1,2}:\\d{2}|--)`,'i'));
    if(!row)return null;
    const scheduled=row[1],actualOrEst=row[2];
    const now=new Date();const flightDay=new Date(`${flightDate}T23:59:59Z`);const definitelyPast=now.getTime()>flightDay.getTime();
    const actualMinutes=timeToMinutes(actualOrEst),schedMinutes=timeToMinutes(scheduled);
    const statusText=(plain.match(new RegExp(`${shipment.flightNo}[^]{0,300}?(LANDED|ARRIVED|AIRBORNE|SCHEDULED)`,'i'))||[])[1]||'';
    const landed=/LANDED|ARRIVED/i.test(statusText)||definitelyPast;
    return {
      status:landed?'ARRIVED':'IN TRANSIT',
      arrivalDate:flightDate,
      arrivalTime:actualOrEst&&actualOrEst!=='--'?actualOrEst:scheduled,
      arrivalIsActual:landed&&actualOrEst!=='--',
      scheduledArrival:scheduled,
      timing:schedMinutes!=null&&actualMinutes!=null?(actualMinutes<schedMinutes?'EARLY':actualMinutes>schedMinutes?'DELAYED':'ON TIME'):'',
      source:'FlightInformation destination flight status',url
    };
  }catch{return null;}
}
function parse(text,mawb){
  const plain=cleanHtml(text); const digits=mawb.replace(/\D/g,''),suffix=digits.slice(3);
  if(!plain.includes(mawb)&&!plain.includes(digits)&&!plain.includes(suffix)){
    if(/Please Enter Air Waybill Number/i.test(plain))return{notFound:true};
    return null;
  }
  const od=plain.match(/Origin\s+Destination[\s\S]{0,100}?\b([A-Z]{3})\b\s+([A-Z]{3})\b/i);
  const origin=(od?.[1]||pick(plain,/Origin\s*[:\-]?\s*([A-Z]{3})\b/i)).toUpperCase();
  const destination=(od?.[2]||pick(plain,/Destination\s*[:\-]?\s*([A-Z]{3})\b/i)).toUpperCase();
  const ms=parseMilestones(plain);
  const status=latestStatus(plain);
  const shipment={mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:ms.pieces,pieces:ms.pieces,weight:ms.weight,flightNo:ms.flightNo,arrivalDate:ms.arrival.date,arrivalTime:ms.arrival.time,arrivalIsActual:ms.arrivalIsActual,status,officialTracker:AIRLINE.url,source:'Cathay Cargo Terminal official tracking'};
  const useful=Boolean((origin&&destination)||shipment.pieces||shipment.weight||shipment.flightNo||shipment.arrivalDate||status!=='TRACKING');
  return useful?{useful:true,shipment,flightDate:ms.flightDate}:null;
}

export async function trackCathay(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};
  const suffix=mawb.replace(/\D/g,'').slice(3);
  const urls=[`${BASE}/AWBPrefix/160/AWBSuffix/${suffix}`,`${BASE}?AWBPrefix=160&AWBSuffix=${suffix}`];
  let last='';
  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(12000)});
      last=`HTTP ${r.status}`;if(!r.ok)continue;
      const html=await r.text();const p=parse(html,mawb);
      if(p?.notFound)continue;
      if(p?.useful){
        const shipment={...p.shipment};
        if(shipment.status==='IN TRANSIT'&&shipment.flightNo&&p.flightDate){
          const f=await flightStatusFallback(shipment,p.flightDate);
          if(f){shipment.status=f.status;shipment.arrivalDate=f.arrivalDate;shipment.arrivalTime=f.arrivalTime;shipment.arrivalIsActual=f.arrivalIsActual;shipment.timing=f.timing;shipment.source=`${shipment.source} + ${f.source}`;}
        }
        return{ok:true,airline:AIRLINE,shipment,debug:{stage:'SUCCESS',source:'cathay-terminal',url,flightDate:p.flightDate}};
      }
    }catch(e){last=e?.message||String(e);}
  }
  return{ok:false,reason:'CATHAY TERMINAL RETURNED NO VERIFIED SHIPMENT DATA',airline:AIRLINE,debug:{stage:'NO_DATA',last}};
}
