const PAGE='https://chorus.thaicargo.com/skychain/app?service=page%2Fnwp%3ATrackshipmt';
const POST='https://chorus.thaicargo.com/skychain/app';
const OFFICIAL='https://www.thaicargo.com/en/tracking';
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const digits=v=>String(v||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');

function cleanHtml(s=''){
  return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim();
}
function cookieHeader(raw=''){
  const out=[];
  for(const m of String(raw||'').matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+)=([^;,]+)/g)){
    const name=m[1];if(/^(?:path|expires|max-age|domain|samesite|secure|httponly)$/i.test(name))continue;out.push(`${name}=${m[2]}`);
  }
  return out.join('; ');
}
function isoDate(raw=''){
  const s=String(raw||'').trim().toUpperCase().replace(/\s+/g,' ');
  let m=s.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\b/);
  if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=s.match(/\b(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})\b/);
  if(m)return`${m[3].length===2?'20'+m[3]:m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  return'';
}
function stamp(date='',time=''){
  const d=isoDate(date);return d?`${d}T${String(time||'00:00').padStart(5,'0')}`:'';
}
function parseShipment(text,mawb){
  const flat=String(text||'').replace(/\s+/g,' ').trim(),upper=flat.toUpperCase();
  if(!flat||/NO\s+(?:RECORD|SHIPMENT|AWB).*FOUND|NO DATA FOUND|INVALID AIRWAYBILL|INVALID AWB/i.test(flat))return null;
  const esc=mawb.replace('-','[- ]?');
  const summary=flat.match(new RegExp(`${esc}\\s+([A-Z]{3})\\s+([A-Z]{3})\\s+(\\d{1,6})\\s+([\\d,.]+)\\b`,'i'));
  if(!summary)return null;
  const origin=summary[1].toUpperCase(),destination=summary[2].toUpperCase(),pieces=summary[3],weight=summary[4].replace(/,/g,'');

  const legs=[];
  const legRx=/(?:Waitlisted|Confirmed|Booked)[^\.]{0,120}?flight\s+(TG\s*\d{2,4})\s*\/\s*(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+([A-Z]{3})-([A-Z]{3})[^\.]{0,120}?STD\s*(\d{1,2}:\d{2})[^\.]{0,80}?STA\s*-?\s*(\d{1,2}:\d{2})\s*(\d{1,2}\s+[A-Z]{3}\s+20\d{2})/gi;
  for(const m of flat.matchAll(legRx))legs.push({flightNo:m[1].replace(/\s+/g,'').toUpperCase(),flightDate:isoDate(m[2]),origin:m[3].toUpperCase(),destination:m[4].toUpperCase(),departureTime:m[5],arrivalTime:m[6],arrivalDate:isoDate(m[7])});
  const finalLeg=legs.findLast?legs.findLast(x=>x.destination===destination):(legs.filter(x=>x.destination===destination).slice(-1)[0]||legs[legs.length-1]);

  const bookingEvents=[];
  const bookingRx=/\b([A-Z]{3})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s+Booking\s+(?:Confirmed|Waitlisted|Booked)\b/gi;
  for(const m of flat.matchAll(bookingRx)){const iso=isoDate(m[2]);if(iso)bookingEvents.push({date:iso,time:m[3],stamp:`${iso}T${m[3]}`});}
  bookingEvents.sort((a,b)=>a.stamp.localeCompare(b.stamp));
  const booking=bookingEvents[0]||null;

  const departures=[];
  const departureRx=/\b([A-Z]{3})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s+((?:Flight\s+)?Departed|Airborne|Loaded|Manifested)\b/gi;
  for(const m of flat.matchAll(departureRx)){const iso=isoDate(m[2]);if(iso)departures.push({airport:m[1].toUpperCase(),date:iso,time:m[3],label:m[4].toUpperCase(),stamp:`${iso}T${m[3]}`});}
  departures.sort((a,b)=>a.stamp.localeCompare(b.stamp));
  const originActualDeparture=departures.filter(x=>x.airport===origin&&/DEPART|AIRBORNE/.test(x.label)).slice(-1)[0]||null;
  const originLeg=legs.find(x=>x.origin===origin)||legs[0]||null;

  const actuals=[];
  const actualRx=/\b([A-Z]{3})\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s+((?:Flight\s+)?Arrived|Received\s+from\s+Flight|Shipment\s+Arrived|Delivered)\b/gi;
  for(const m of flat.matchAll(actualRx)){const iso=isoDate(m[2]);if(iso)actuals.push({airport:m[1].toUpperCase(),date:iso,time:m[3],label:m[4].toUpperCase(),stamp:`${iso}T${m[3]}`});}
  actuals.sort((a,b)=>a.stamp.localeCompare(b.stamp));
  const finalActual=actuals.filter(x=>x.airport===destination).slice(-1)[0]||null;

  let status='TRACKING';
  if(finalActual?.label?.includes('DELIVER'))status='DELIVERED';
  else if(finalActual)status='ARRIVED';
  else if(/\b(?:Flight\s+Departed|Departed|Manifested|Loaded|Airborne)\b/i.test(flat))status='IN TRANSIT';
  else if(/\bBooking\s+(?:Confirmed|Waitlisted|Booked)\b/i.test(flat))status='BOOKED';
  else if(/\b(?:Delayed|Offloaded|Exception|Late)\b/i.test(flat))status='DELAYED';

  const arrivalDate=finalActual?.date||finalLeg?.arrivalDate||'';
  const arrivalTime=finalActual?.time||finalLeg?.arrivalTime||'';
  const arrivalIsActual=Boolean(finalActual);
  const useful=Boolean(origin&&destination&&(pieces||weight||finalLeg?.flightNo||booking?.date||arrivalDate||status!=='TRACKING'));
  if(!useful)return null;
  const departureDate=originActualDeparture?.date||originLeg?.flightDate||'';
  const departureTime=originActualDeparture?.time||originLeg?.departureTime||'';
  const departureIsActual=Boolean(originActualDeparture);
  return{
    mawb,carrierCode:'TG',airlineName:'THAI Cargo',origin,destination,pieces,bags:pieces,weight,
    flightNo:finalLeg?.flightNo||originLeg?.flightNo||'',flightDate:finalLeg?.flightDate||originLeg?.flightDate||'',
    bookingDate:booking?.date||'',bookingTime:booking?.time||'',
    departureDate,departureTime,departureIsActual,
    departureFlightNo:originLeg?.flightNo||'',
    departureOrigin:originLeg?.origin||origin,
    departureDestination:originLeg?.destination||'',
    departureTimeSource:departureIsActual?'THAI CHORUS origin Flight Departed event':'THAI CHORUS origin-leg STD',
    arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:OFFICIAL,
    source:'THAI Cargo CHORUS public tracking',provider:'THAI Cargo CHORUS'
  };
}

export async function trackThai(input){
  const full=digits(input);if(full.length!==11||!full.startsWith('217'))return{ok:false,reason:'INVALID THAI AIRWAYS MAWB',officialTracker:OFFICIAL};
  const mawb=`217-${full.slice(3)}`,serial=full.slice(3);
  try{
    const page=await fetch(PAGE,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
    if(!page.ok)return{ok:false,reason:`THAI CHORUS PAGE HTTP ${page.status}`,officialTracker:OFFICIAL};
    await page.text();const cookie=cookieHeader(page.headers.get('set-cookie')||'');
    const form=new URLSearchParams();
    const fields={service:'direct/1/nwp:Trackshipmt/trackForm',sp:'S1',Form1:'selectDoctype,txtPrefix,txtNumber,txtJrn,txtAWBPrefix,txtAWBNumber,txtAWBPrefix$0,txtAWBNumber$0,txtAWBPrefix$1,txtAWBNumber$1,txtAWBPrefix$2,txtAWBNumber$2,txtAWBPrefix$3,txtAWBNumber$3,txtAWBPrefix$4,txtAWBNumber$4,txtAWBPrefix$5,txtAWBNumber$5,txtAWBPrefix$6,txtAWBNumber$6,txtAWBPrefix$7,txtAWBNumber$7,$FormConditional,$JSubmit,$JSubmit$0,$JSubmit$1,$JSubmit$2,$FormConditional$0,$FormConditional$1,reload,pageSize,listSize,advSearch,trackViewHdn',trackForm_hdnLastPermissionCheck:'',trackForm_hdnLastPermissionCode:'',hdnFormID:'trackForm',hdnbpval2:'false','$FormConditional':'F','$FormConditional$0':'F','$FormConditional$1':'F',reload:'',pageSize:'10',listSize:'0',advSearch:'F',trackViewHdn:'tableRadio',selectDoctype:'AWB',txtPrefix:'217',txtNumber:serial,txtJrn:'',txtAWBPrefix:'217',txtAWBNumber:serial,'txtAWBPrefix$0':'217','txtAWBNumber$0':'','txtAWBPrefix$1':'217','txtAWBNumber$1':'','txtAWBPrefix$2':'217','txtAWBNumber$2':'','txtAWBPrefix$3':'217','txtAWBNumber$3':'','txtAWBPrefix$4':'217','txtAWBNumber$4':'','txtAWBPrefix$5':'217','txtAWBNumber$5':'','txtAWBPrefix$6':'217','txtAWBNumber$6':'','txtAWBPrefix$7':'217','txtAWBNumber$7':'','$JSubmit$0':'Track'};
    for(const [k,v] of Object.entries(fields))form.set(k,v);
    const r=await fetch(POST,{method:'POST',redirect:'follow',cache:'no-store',headers:{'content-type':'application/x-www-form-urlencoded','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36','referer':PAGE,'origin':'https://chorus.thaicargo.com',...(cookie?{cookie}:{})},body:form.toString(),signal:AbortSignal.timeout(30000)});
    const html=await r.text();if(!r.ok)return{ok:false,reason:`THAI CHORUS TRACK HTTP ${r.status}`,officialTracker:OFFICIAL};
    const text=cleanHtml(html),shipment=parseShipment(text,mawb);
    if(!shipment)return{ok:false,reason:'THAI CHORUS RETURNED NO VERIFIED SHIPMENT DATA',officialTracker:OFFICIAL,debug:{sample:text.slice(0,1800)}};
    console.log('thai_tracking_result',mawb,'flight',shipment.flightNo||'','departure',shipment.departureDate||'',shipment.departureTime||'','arrival',shipment.arrivalDate||'',shipment.arrivalTime||'','status',shipment.status||'');
    return{ok:true,shipment,debug:{stage:'THAI_CHORUS_SUCCESS',sample:text.slice(Math.max(0,text.indexOf(mawb)-300),Math.max(0,text.indexOf(mawb)-300)+2200)}};
  }catch(e){return{ok:false,reason:e?.message||'THAI CHORUS TRACKING FAILED',officialTracker:OFFICIAL};}
}
