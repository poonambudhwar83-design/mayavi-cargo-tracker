import { normalizeMawb } from './airlines.js';
import { fetchAirAsiaWithBrowser } from './airAsiaBrowser.js';
import { trackFlightScheduleFast } from './flightStatusSnapshot.js';
import { normalizeShipmentTimesToIst } from './exportIst.js';
const URL='https://airasia.smartkargo.com/FrmAWBTracking.aspx';
const clean=s=>String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,' | ').replace(/<\/(?:tr|td|th|div|p)>/gi,' | ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
const attribute=(s,key)=>{const m=String(s).match(new RegExp('\\b'+key+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));return m?.[1]??m?.[2]??m?.[3]??''};
const date=s=>{
 let m=String(s).match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);if(m)return [m[1],m[2].padStart(2,'0'),m[3].padStart(2,'0')].join('-');
 m=String(s).match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
 return m?[m[3],m[2].padStart(2,'0'),m[1].padStart(2,'0')].join('-'):'';
};
const time=s=>{const m=String(s||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?m[1].padStart(2,'0')+':'+m[2]:''};
export function parseAirAsiaResult(html,mawb){
 const full=normalizeMawb(mawb),awbPrefix=full.slice(0,3),serial=full.slice(4),text=clean(html).replace(/\s*\|\s*/g,' ');
 if(/AWB Details not available|No records found|Invalid AWB/i.test(text))return null;
 // The AWB-specific result card, not the submitted text field, proves identity.
 // Example: AWB : 807-12990261 ( DEL - AKL ) 50 P / 1200.00 Kgs.
 // SmartKargo's ASP.NET result card inserts HTML block separators between
 // AWB, route and totals. Match each field inside the same AWB-specific card,
 // not an unrelated form-input echo or another shipment.
 const header=text.match(/\bAWB\s*:\s*[|\s]*(807|900)[- ]?(\d{8})\b/i);
 if(!header||header[1]!==awbPrefix||header[2]!==serial)return null;
 const card=text.slice(header.index,header.index+650);
 const route=card.match(/\(\s*([A-Z]{3})\s*[-–—]\s*([A-Z]{3})\s*\)/i);
 const total=card.match(/\b(\d{1,6})\s*P\s*\/\s*([\d,.]+)\s*Kgs?\b/i);
 if(!route||!total)return null;
 const origin=route[1].toUpperCase(),destination=route[2].toUpperCase();
 const pieces=total[1],weight=total[2].replace(/,/g,'');
 const cellsOf=row=>[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));
 const rows=[...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
   .map(m=>cellsOf(m[1])).filter(cells=>cells.length);
 const flightPattern=/\b((?:AK|D7|FD|QZ|Z2|NZ)\s*\d{2,4})\s+(\d{1,2}[/-]\d{1,2}[/-]20\d{2})\b/i;
 const legRows=rows.filter(cells=>cells.length>=6&&/^[A-Z]{3}$/.test(cells[1]||'')&&
   /^[A-Z]{3}$/.test(cells[2]||'')&&cells.some(c=>flightPattern.test(c)));
 const legs=legRows.map(cells=>{
   const withFlight=cells.find(c=>flightPattern.test(c))||'';
   const m=withFlight.match(flightPattern);
   return{origin:cells[1],destination:cells[2],pieces:cells[3],
     weight:(cells[4]||'').match(/[\d,.]+/)?.[0]?.replace(/,/g,'')||'',
     flightNo:(m?.[1]||'').replace(/\s/g,'').toUpperCase(),date:date(m?.[2]||''),
     milestone:String(cells[0]||'').toUpperCase(),
     eventDate:date(cells.at(-1)||''),eventTime:time(cells.at(-1)||'')};
 }).filter(leg=>leg.flightNo&&leg.date);
 const finalLeg=legs.filter(leg=>leg.destination===destination).at(-1)||legs.at(-1)||null;
 const firstLeg=legs.find(leg=>leg.origin===origin)||legs[0]||null;
 const booking=legs.filter(leg=>/BOOKED|ACCEPTED/.test(leg.milestone)&&leg.eventDate)
   .sort((a,b)=>(a.eventDate+' '+a.eventTime).localeCompare(b.eventDate+' '+b.eventTime))[0]||null;
 // SmartKargo has TWO different table layouts. Booking rows are
 // "Status | Station | Dest | ..."; Status History rows are
 // "Station | Milestone | Pieces | Weight | Flight | Flight Date | ...".
 // Reading only the booking layout loses the DMK transit milestone.
 const eventRows=rows.filter(cells=>/^(Booked|Accepted|Departed|Arrived|Offloaded|Received from flight|Delivered|Unloaded)$/i.test(String(cells[0]||'')));
 const historyEvents=rows.filter(cells=>cells.length>=6&&/^[A-Z]{3}$/i.test(String(cells[0]||''))&&
   /^(Manifested|Departed|Arrived|Offloaded|Received from flight|Delivered|Unloaded)$/i.test(String(cells[1]||'')))
   .map(cells=>{
     const timestamp=cells.slice(5).find(cell=>date(cell)&&time(cell))||'';
     return {station:String(cells[0]).toUpperCase(),milestone:String(cells[1]).toUpperCase(),
       date:date(timestamp),time:time(timestamp)};
   });
 const legacyEvents=eventRows.map(cells=>({
   milestone:String(cells[0]||'').toUpperCase(),station:String(cells[1]||'').toUpperCase(),
   date:date(cells.at(-1)||''),time:time(cells.at(-1)||'')
 }));
 const allEvents=[...legacyEvents,...historyEvents];
 const activity=(text.match(/\bLast\s+Activity\s+(Booked|Accepted|Departed|Arrived|Offloaded|Received from flight|Delivered|Unloaded)\s+at\s+([A-Z]{3})\b/i)||[]);
 const recentHistory=historyEvents.at(-1);
 const label=String(activity[1]||recentHistory?.milestone||eventRows.at(-1)?.[0]||'TRACKING').toUpperCase();
 const station=String(activity[2]||recentHistory?.station||'').toUpperCase();
 const status=/OFFLOAD/.test(label)?'OFFLOADED':/DELIVER/.test(label)&&station===destination?'DELIVERED':
   /ARRIV|RECEIVED FROM FLIGHT|UNLOAD/.test(label)?station===destination?'ARRIVED':'IN TRANSIT':
   /DEPART/.test(label)?'DEPARTED':/BOOKED|ACCEPTED/.test(label)?'BOOKED':'TRACKING';
 const finalArrival=allEvents.filter(e=>/ARRIVED|RECEIVED FROM FLIGHT|UNLOADED|DELIVERED/.test(e.milestone)&&
   e.station===destination&&e.date&&e.time).at(-1);
 const finalDeparture=allEvents.filter(e=>e.milestone==='DEPARTED'&&e.station===origin&&e.date&&e.time).at(-1);
 const arrivalActual=Boolean(finalArrival);
 const via=[...new Set(legs.map(leg=>leg.destination).filter(code=>code&&code!==origin&&code!==destination))].join(' / ');
 const note=status==='BOOKED'?'AirAsia booking shown; actual departure / final arrival not confirmed':
   status==='OFFLOADED'?'AirAsia official status: OFFLOADED':'';
 return{mawb:full,carrierCode:awbPrefix==='900'?'FD':'AK',airlineName:awbPrefix==='900'?'Thai AirAsia Cargo / Teleport':'AirAsia Cargo / Teleport',
   origin,destination,via,pieces,bags:pieces,weight,masterWeight:weight,
   // Preserve BOTH legs; the Mayavi Export row selects first, Import selects final.
   flightNo:finalLeg?.flightNo||'',flightDate:finalLeg?.date||'',
   firstFlightNo:firstLeg?.flightNo||'',firstFlightDate:firstLeg?.date||'',
   firstFlightOrigin:firstLeg?.origin||'',firstFlightDestination:firstLeg?.destination||'',
   finalFlightNo:finalLeg?.flightNo||'',finalFlightDate:finalLeg?.date||'',
   finalFlightOrigin:finalLeg?.origin||'',finalFlightDestination:finalLeg?.destination||'',
   flightSchedule:legs,bookingDate:booking?.eventDate||'',bookingTime:booking?.eventTime||'',
   // Export Departure Date shows the scheduled first leg if the airline has
   // only a BOOKED event. Do not mistake a flight booking for actual cargo DEP.
   departureDate:finalDeparture?.date||firstLeg?.date||'',departureTime:finalDeparture?.time||'',
   scheduledDepartureDate:firstLeg?.date||'',departureFlightNo:firstLeg?.flightNo||'',
   departureOrigin:origin,departureDestination:firstLeg?.destination||'',
   departureIsActual:Boolean(finalDeparture),departureEstimate:!finalDeparture&&Boolean(firstLeg?.date),
   departureTimeSource:finalDeparture?'AirAsia origin Departed milestone':'AirAsia first-leg booking schedule; departure not confirmed',
   arrivalDate:finalArrival?.date||'',arrivalTime:finalArrival?.time||'',
   arrivalIsActual:arrivalActual,arrivalEstimate:false,
   // 900: explicit absence tells DB/UI refresh to DELETE a stale Delhi
   // arrival instead of retaining yesterday's optimistic ETA.
   ...(awbPrefix==='900'?{arrivalVerifiedAbsent:!arrivalActual,
     currentLocation:station||'',transitAirport:station&&station!==destination?station:''}:{}),
   status:arrivalActual?'ARRIVED':status==='ARRIVED'?'IN TRANSIT':status,
   sourceStatus:activity[1]?(activity[1]+' at '+station):label,
   remarks:note,officialTracker:URL,
   source:'AirAsia SmartKargo AWB-specific official shipment result',
   airasiaLiveVerifiedAt:new Date().toISOString()};
}
export async function trackAirAsia(input){
 const mawb=normalizeMawb(input);
 if(!/^(807|900)-\d{8}$/.test(mawb))return {ok:false,reason:'INVALID AIRASIA 807/900 MAWB',officialTracker:URL};
 try{
 const initial=await fetch(URL,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html'},cache:'no-store',signal:AbortSignal.timeout(18000)});
 if(!initial.ok)return {ok:false,reason:'AIRASIA FORM HTTP '+initial.status,officialTracker:URL};
 const html=await initial.text(),form=new URLSearchParams();
 for(const m of html.matchAll(/<input\b[^>]*>/gi)){
  const tag=m[0],name=attribute(tag,'name'),type=attribute(tag,'type').toLowerCase();
  if(name&&type==='hidden')form.set(name,attribute(tag,'value'));
 }
 const allFields=[
  ...[...html.matchAll(/<input\b[^>]*>/gi)].map(m=>({tag:m[0],type:attribute(m[0],'type').toLowerCase()})),
  ...[...html.matchAll(/<textarea\b[^>]*>/gi)].map(m=>({tag:m[0],type:'textarea'}))
 ];
 const getDesc=f=>[attribute(f.tag,'name'),attribute(f.tag,'id'),attribute(f.tag,'placeholder')].join(' ').toLowerCase();
 const prefix=allFields.find(f=>f.type!=='hidden'&&/prefix/.test(getDesc(f)));
 const number=allFields.find(f=>f.type!=='hidden'&&/(awb|airway)/.test(getDesc(f))&&!/prefix/.test(getDesc(f)));
 const submit=allFields.find(f=>/submit|button/.test(f.type)&&/track|go/i.test(getDesc(f)+' '+attribute(f.tag,'value')));
 if(!prefix||!number)return {ok:false,reason:'AIRASIA SMARTKARGO FORM FIELDS NOT FOUND',officialTracker:URL};
 form.set(attribute(prefix.tag,'name'),mawb.slice(0,3));
 form.set(attribute(number.tag,'name'),mawb.slice(4));
 if(submit)form.set(attribute(submit.tag,'name'),attribute(submit.tag,'value')||'Track');
 const cookie=initial.headers.get('set-cookie')?.split(';')[0]||'';
 const response=await fetch(URL,{method:'POST',headers:{'user-agent':'Mozilla/5.0','content-type':'application/x-www-form-urlencoded','accept':'text/html',origin:'https://airasia.smartkargo.com',referer:URL,...(cookie?{cookie}:{})},body:form.toString(),cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)return {ok:false,reason:'AIRASIA TRACKING HTTP '+response.status,officialTracker:URL};
 let shipment=parseAirAsiaResult((await response.text()).slice(0,850000),mawb);
 let source='AirAsia SmartKargo official POST';
 if(!shipment){
   // The official ASP.NET form can return an empty postback to server-side
   // clients even though interactive Track works. Use the exact human form
   // sequence: MAWB's own 807/900 Prefix, eight-digit suffix, click Track.
   const browser=await fetchAirAsiaWithBrowser(mawb.slice(4),mawb.slice(0,3));
   if(!browser.ok)return{ok:false,reason:browser.reason||'AIRASIA OFFICIAL AWB DATA NOT VERIFIED',
     officialTracker:URL,debug:{stage:'OFFICIAL_BROWSER_NOT_VERIFIED',browser:browser.debug||null}};
   shipment=parseAirAsiaResult(browser.html,mawb);
   if(!shipment)return{ok:false,reason:'AIRASIA TRACK OPENED BUT NO VERIFIED AWB MOVEMENT EXTRACTED',
     officialTracker:URL,debug:{stage:'BROWSER_PARSE_UNVERIFIED',browser:browser.debug||null}};
   source='AirAsia SmartKargo live browser Track';
 }
 shipment.source=source;
 // The AirAsia AWB form contains booked legs and dates, but no departure
 // CLOCK time. Resolve it by the exact first-leg FLIGHT+DATE+DEL->KUL from
 // a dated flight schedule. This never proves that cargo departed.
 const first=Array.isArray(shipment.flightSchedule)
   ?shipment.flightSchedule.find(leg=>leg.origin===shipment.origin):null;
 if(first?.flightNo&&first?.date&&first?.origin&&first?.destination&&
   shipment.departureIsActual!==true){
   const flight=await trackFlightScheduleFast({
     flightNo:first.flightNo,date:first.date,
     origin:first.origin,destination:first.destination
   }).catch(()=>null);
   const routeMatches=flight?.ok&&
     (!flight.departureOrigin||flight.departureOrigin.toUpperCase()===first.origin)&&
     (!flight.departureDestination||flight.departureDestination.toUpperCase()===first.destination);
   const dateMatches=!flight?.departureDate||flight.departureDate===first.date;
   const departTime=String(flight?.departureTime||'');
   if(routeMatches&&dateMatches&&/^([01]\\d|2[0-3]):[0-5]\\d$/.test(departTime)){
     shipment=normalizeShipmentTimesToIst({...shipment,
       departureDate:first.date,departureTime:departTime,
       departureTimeZone:flight.departureTimeZone||'LOCAL',
       departureOrigin:first.origin,departureDestination:first.destination,
       departureFlightNo:first.flightNo,
       departureIsActual:false,departureEstimate:true,
       departureTimeSource:'Dated '+first.flightNo+' DEL to '+first.destination+
         ' flight timetable ('+(flight.source||'schedule')+
         '); airline has not confirmed cargo departure'});
   }
 }
 return{ok:true,shipment,officialTracker:URL,adapter:source};
 }catch(e){return {ok:false,reason:'AIRASIA CONNECTION: '+String(e?.message||e),officialTracker:URL}}
}
