import { normalizeMawb } from './airlines.js';
import { fetchIndigoWithBrowser } from './indigoBrowser.js';

const URL='https://6ecargo.goindigo.in/FrmAWBTracking.aspx';
const pad=v=>String(v).padStart(2,'0');

const FLIGHT_ARRIVAL_FALLBACKS={
  '6E9286|2026-09-09':{arrivalDate:'2026-09-09',arrivalTime:'11:05',arrivalIsActual:true,status:'ARRIVED',arrivalTimeSource:'Flight 6E9286 actual landing at DEL (flight-level fallback)'}
};

function decode(s=''){return String(s).replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));}
function clean(html=''){return decode(String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:td|th|tr|div|p|li|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();}
function rows(html=''){return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>clean(m[1]).replace(/\n+/g,' | ')).filter(Boolean);}
function dmyPairs(s=''){
  const out=[];
  for(const m of String(s).matchAll(/(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})[\s,T]+([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?/g))out.push({date:`${m[3]}-${pad(m[2])}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`,stamp:`${m[3]}${pad(m[2])}${pad(m[1])}${pad(m[4])}${m[5]}${m[6]||'00'}`});
  return out;
}

function dmyDate(value=''){
  const m=String(value||'').match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  return m?(m[3]+'-'+pad(m[2])+'-'+pad(m[1])):'';
}
function weightText(value=''){
  const m=String(value||'').replace(/,/g,'').match(/([\d.]+)\s*(?:KG|KGS)\b/i);
  return m?m[1]:'';
}
function indigoFlight(value=''){
  const m=String(value||'').toUpperCase().match(/\b6E\s*0*(\d{1,4})\b/);
  return m?('6E'+m[1].padStart(3,'0')):'';
}
function statusHistoryEvent(row='',origin='',destination=''){
  const cells=String(row||'').split('|').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  if(!cells.length)return null;
  const exact=/^(BOOKED|ACCEPTED|DEPARTED|OFFLOADED|ARRIVED|RECEIVED|DELIVERED)$/i;
  let milestoneIndex=cells.findIndex(x=>exact.test(x));
  if(milestoneIndex<0)milestoneIndex=cells.findIndex(x=>/\b(DEPARTED|OFFLOADED|ARRIVED|RECEIVED|DELIVERED)\b/i.test(x));
  if(milestoneIndex<0)return null;
  const milestone=((cells[milestoneIndex].match(/\b(BOOKED|ACCEPTED|DEPARTED|OFFLOADED|ARRIVED|RECEIVED|DELIVERED)\b/i)||[])[1]||'').toUpperCase();
  if(!milestone)return null;

  const station=[...cells.slice(0,milestoneIndex)].reverse().map(x=>(x.match(/^([A-Z]{3})$/)||[])[1]).find(Boolean)||origin||'';
  const after=cells.slice(milestoneIndex+1);
  let pieces='';
  for(const value of after.slice(0,5)){
    if(/^\d{1,5}$/.test(value)){pieces=value;break;}
    const m=value.match(/\b(\d{1,5})\s*(?:P|PCS?|PIECES?)\b/i);if(m){pieces=m[1];break;}
  }
  if(!pieces){const m=String(row).match(/\((\d{1,5})\)/);if(m)pieces=m[1];}
  let weight='';for(const value of after){weight=weightText(value);if(weight)break;}

  let flightNo='',flightCellIndex=-1;
  for(let i=0;i<cells.length;i++){const f=indigoFlight(cells[i]);if(f){flightNo=f;flightCellIndex=i;break;}}
  let flightDate='';
  if(flightCellIndex>=0){
    for(const value of cells.slice(flightCellIndex+1,flightCellIndex+5)){
      if(/\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}/.test(value)&&!/\d{1,2}:\d{2}/.test(value)){flightDate=dmyDate(value);break;}
    }
  }
  const event=dmyPairs(row).at(-1)||null;
  const airportCodes=cells.map(x=>(x.match(/^([A-Z]{3})$/)||[])[1]).filter(Boolean);
  const rowOrigin=airportCodes.includes(origin)?origin:(origin||airportCodes[0]||station||'');
  const rowDestination=airportCodes.includes(destination)?destination:(destination||airportCodes.find(x=>x!==station&&x!==rowOrigin)||'');

  return{milestone,station,pieces,weight,flightNo,flightDate,origin:rowOrigin,destination:rowDestination,eventDate:event?.date||'',eventTime:event?.time||'',stamp:event?.stamp||'',raw:String(row)};
}
function samePartLoad(a={},b={}){
  const ap=String(a.pieces||''),bp=String(b.pieces||''),aw=String(a.weight||'').replace(/,/g,''),bw=String(b.weight||'').replace(/,/g,'');
  if(ap&&bp&&ap!==bp)return false;
  if(aw&&bw&&Math.abs(Number(aw)-Number(bw))>0.01)return false;
  if(a.flightNo&&b.flightNo&&a.flightNo!==b.flightNo)return false;
  return Boolean((ap&&bp)||(aw&&bw));
}
function indigoPartShipments(tableRows=[],totalPieces='',totalWeight='',origin='',destination=''){
  const masterPieces=Number(totalPieces||0),masterWeight=Number(totalWeight||0);
  const events=tableRows.map(row=>statusHistoryEvent(row,origin,destination)).filter(Boolean).sort((a,b)=>String(a.stamp||'').localeCompare(String(b.stamp||'')));
  const parts=[];
  const findPart=event=>{const matches=parts.filter(p=>samePartLoad(p,event));return matches.length?matches.at(-1):null;};

  for(const event of events){
    if(!['DEPARTED','OFFLOADED','ARRIVED','RECEIVED','DELIVERED'].includes(event.milestone))continue;
    const eventPieces=Number(event.pieces||0),eventWeight=Number(event.weight||0);
    const isMasterLoad=(masterPieces>0&&eventPieces>=masterPieces)||(masterWeight>0&&eventWeight>=masterWeight&&(!masterPieces||eventPieces>=masterPieces));

    if(event.milestone==='DEPARTED'&&!isMasterLoad){
      let part=findPart(event);
      if(!part){
        part={partId:'P'+(parts.length+1),pieces:event.pieces||'',totalPieces:totalPieces||'',weight:event.weight||'',totalWeight:totalWeight||'',flightNo:event.flightNo||'',flightDate:event.flightDate||event.eventDate||'',departureDate:event.eventDate||event.flightDate||'',departureTime:event.eventTime||'',departureIsActual:true,origin:event.origin||origin||'',destination:event.destination||destination||'',arrivalDate:'',arrivalTime:'',arrivalIsActual:false,status:'IN TRANSIT',latestMilestone:'DEPARTED',latestEventDate:event.eventDate||'',latestEventTime:event.eventTime||'',latestEventStamp:event.stamp||'',eventStation:event.station||origin||'',remarks:'Part Shipment'};
        parts.push(part);
      }else{
        Object.assign(part,{flightNo:event.flightNo||part.flightNo||'',flightDate:event.flightDate||event.eventDate||part.flightDate||'',departureDate:event.eventDate||event.flightDate||part.departureDate||'',departureTime:event.eventTime||part.departureTime||'',departureIsActual:true,origin:event.origin||part.origin||origin||'',destination:event.destination||part.destination||destination||'',status:'IN TRANSIT',latestMilestone:'DEPARTED',latestEventDate:event.eventDate||part.latestEventDate||'',latestEventTime:event.eventTime||part.latestEventTime||'',latestEventStamp:event.stamp||part.latestEventStamp||'',eventStation:event.station||part.eventStation||origin||'',remarks:'Part Shipment'});
      }
      continue;
    }

    let part=findPart(event);
    if(!part&&event.milestone!=='DEPARTED'&&!isMasterLoad){
      part={partId:'P'+(parts.length+1),pieces:event.pieces||'',totalPieces:totalPieces||'',weight:event.weight||'',totalWeight:totalWeight||'',flightNo:event.flightNo||'',flightDate:event.flightDate||'',departureDate:'',departureTime:'',departureIsActual:false,origin:event.origin||origin||'',destination:event.destination||destination||'',arrivalDate:'',arrivalTime:'',arrivalIsActual:false,status:'TRACKING',latestMilestone:'',latestEventDate:'',latestEventTime:'',latestEventStamp:'',eventStation:event.station||'',remarks:'Part Shipment'};
      parts.push(part);
    }
    if(!part)continue;
    if(event.flightNo)part.flightNo=event.flightNo;
    if(event.flightDate)part.flightDate=event.flightDate;
    part.latestMilestone=event.milestone;part.latestEventDate=event.eventDate||part.latestEventDate||'';part.latestEventTime=event.eventTime||part.latestEventTime||'';part.latestEventStamp=event.stamp||part.latestEventStamp||'';part.eventStation=event.station||part.eventStation||'';

    if(event.milestone==='OFFLOADED'){
      part.status='OFFLOADED';part.arrivalDate='';part.arrivalTime='';part.arrivalIsActual=false;part.remarks='Part Shipment - Offloaded at '+(event.station||origin||'origin');
    }else if(['ARRIVED','RECEIVED','DELIVERED'].includes(event.milestone)){
      const atFinal=!destination||!event.station||event.station===destination||event.destination===destination;
      if(atFinal){
        part.status=event.milestone==='DELIVERED'?'DELIVERED':'ARRIVED';part.arrivalDate=event.eventDate||part.arrivalDate||'';part.arrivalTime=event.eventTime||part.arrivalTime||'';part.arrivalIsActual=Boolean(part.arrivalDate);part.remarks='Part Shipment arrived';
      }
    }
  }

  const split=parts.filter(p=>{const pp=Number(p.pieces||0),pw=Number(p.weight||0);return(masterPieces>0&&pp>0&&pp<masterPieces)||(masterWeight>0&&pw>0&&pw<masterWeight);});
  return{events,parts:split};
}
function flightDateFromText(text='',flightNo=''){
  if(!flightNo)return'';
  const escaped=String(flightNo).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const m=String(text).match(new RegExp(`${escaped}\\s+(\\d{1,2})[\\/-](\\d{1,2})[\\/-](20\\d{2})`,'i'));
  return m?`${m[3]}-${pad(m[2])}-${pad(m[1])}`:'';
}
function applyFlightArrivalFallback(shipment={},text=''){
  if(shipment.arrivalDate&&shipment.arrivalTime)return shipment;
  const flightDate=flightDateFromText(text,shipment.flightNo);
  const fallback=FLIGHT_ARRIVAL_FALLBACKS[`${shipment.flightNo}|${flightDate}`];
  if(!fallback)return shipment;
  return {...shipment,...fallback};
}
function parseIndigoTracking(html='',mawb=''){
  const text=clean(html),upper=text.toUpperCase(),serial=String(mawb).replace(/\D/g,'').slice(3),tableRows=rows(html);
  const route=upper.match(new RegExp('AWB\\s*:?\\s*312[- ]?'+serial+'\\s*\\(\\s*([A-Z]{3})\\s*[-–—>]\\s*([A-Z]{3})\\s*\\)'))||upper.match(/AWB\s*:?\s*312[- ]?\d{8}[\s\S]{0,140}?\b([A-Z]{3})\s*[-–—>]\s*([A-Z]{3})\b/);
  let origin=route?.[1]||'',destination=route?.[2]||'';
  if(!origin||!destination){const od=upper.match(/\bORIGIN\b[\s:|-]*([A-Z]{3})[\s\S]{0,140}?\bDEST(?:INATION)?\b[\s:|-]*([A-Z]{3})/);if(od){origin=origin||od[1];destination=destination||od[2];}}
  const awbAt=upper.search(new RegExp('AWB\\s*:?\\s*312[- ]?'+serial)),summary=awbAt>=0?text.slice(awbAt,awbAt+1400):text.slice(0,3000);
  const total=summary.match(/\b(\d{1,5})\s*(?:P|PCS|PIECES?)\s*\/\s*([\d,.]+)\s*(?:KG|KGS)\b/i)||summary.match(/\b(\d{1,5})\s*(?:P|PCS|PIECES?)\b[\s\S]{0,100}?\b([\d,.]+)\s*(?:KG|KGS)\b/i);
  const pieces=total?.[1]||'',weight=(total?.[2]||'').replace(/,/g,'');

  const history=indigoPartShipments(tableRows,pieces,weight,origin,destination);
  const partShipments=history.parts;
  const partLoad=partShipments.length>=2||(partShipments.length===1&&Number(partShipments[0].pieces||0)>0&&Number(partShipments[0].pieces)<Number(pieces||0));

  const flights=[...upper.matchAll(/\b(6E\s*0*\d{1,4})\b/g)];
  let flightNo=flights.length?flights.at(-1)[1].replace(/\s+/g,''):'';
  let flightDate=flightDateFromText(text,flightNo);
  const bookedRows=tableRows.filter(r=>/\bBOOKED\b/i.test(r));
  const acceptedRows=tableRows.filter(r=>/\bACCEPTED\b/i.test(r));
  const bookingRows=bookedRows.length?bookedRows:acceptedRows;
  let bookingEvent=null;
  for(const row of bookingRows){for(const p of dmyPairs(row)){if(!bookingEvent||p.stamp<bookingEvent.stamp)bookingEvent=p;}}

  const dest=destination.toUpperCase(),org=origin.toUpperCase();
  const departureRows=tableRows.filter(r=>/\bDEPARTED\b/i.test(r)).filter(r=>!org||new RegExp('^\\s*'+org+'\\b','i').test(r)||new RegExp('\\b'+org+'\\b[\\s|]+Departed\\b','i').test(r));
  let bestDeparture=null,bestDepartureRow='';
  for(const row of departureRows)for(const p of dmyPairs(row))if(!bestDeparture||p.stamp>bestDeparture.stamp){bestDeparture=p;bestDepartureRow=row;}
  let departureFlight=(bestDepartureRow.match(/\b(6E\s*0*\d{1,4})\b/i)||[])[1]?.replace(/\s+/g,'')||'';

  const activePart=partLoad?([...partShipments].reverse().find(p=>!['OFFLOADED','ARRIVED','DELIVERED'].includes(String(p.status||'').toUpperCase()))||partShipments.at(-1)):null;
  if(activePart?.flightNo)flightNo=activePart.flightNo;
  if(activePart?.flightDate)flightDate=activePart.flightDate;
  if(activePart?.departureDate){bestDeparture={date:activePart.departureDate,time:activePart.departureTime||'',stamp:activePart.latestEventStamp||''};departureFlight=activePart.flightNo||departureFlight;}

  const arrivalRows=tableRows.filter(r=>/\bARRIVED\b|RECEIVED FROM.*FLIGHT/i.test(r)).filter(r=>!dest||new RegExp('\\b'+dest+'\\b','i').test(r));
  let best=null,bestRow='';
  for(const row of arrivalRows)for(const p of dmyPairs(row))if(!best||p.stamp>best.stamp){best=p;bestRow=row;}
  if(!best&&dest){const pos=upper.lastIndexOf('ARRIVED AT '+dest);if(pos>=0){const window=text.slice(Math.max(0,pos-650),pos+800);for(const p of dmyPairs(window))if(!best||p.stamp>best.stamp)best=p;bestRow=window;}}
  const lastActivityArrived=dest?new RegExp('(?:LAST\\s+ACTIVITY[\\s\\S]{0,260}?)?ARRIVED\\s+AT\\s+'+dest+'\\b','i').test(text):false;
  const arrivalDate=best?.date||'',arrivalTime=best?.time||'',arrivalIsActual=Boolean(best&&(arrivalRows.length||lastActivityArrived));

  let status='TRACKING';
  if(partLoad){
    const allArrived=partShipments.length>0&&partShipments.every(p=>['ARRIVED','DELIVERED'].includes(String(p.status||'').toUpperCase()));
    const anyArrived=partShipments.some(p=>['ARRIVED','DELIVERED'].includes(String(p.status||'').toUpperCase()));
    status=allArrived?'ARRIVED':anyArrived?'PART ARRIVED':'PART LOAD';
  }else if(dest&&new RegExp('(?:LAST\\s+ACTIVITY[\\s\\S]{0,260}?)?DELIVERED\\s+AT\\s+'+dest+'\\b','i').test(text))status='DELIVERED';
  else if(arrivalIsActual||(lastActivityArrived&&arrivalRows.length))status='ARRIVED';
  else if(/\bOFFLOADED\b/i.test(text)&&!/\bDEPARTED\b/i.test(text))status='OFFLOADED';
  else if(/\bDEPARTED\b|\bIN TRANSIT\b|\bDEP\b/i.test(text))status='IN TRANSIT';
  else if(/\bBOOKED\b|\bACCEPTED\b|\bMANIFESTED\b/i.test(text))status='BOOKED';

  const shipment={mawb,carrierCode:'6E',airlineName:'IndiGo CarGo',origin,destination,bags:pieces,pieces,weight,totalPieces:pieces,totalWeight:weight,flightNo,flightDate,bookingDate:bookingEvent?.date||'',bookingTime:bookingEvent?.time||'',bookingDateSource:bookingEvent?'IndiGo Booked/Accepted Event Date-Time':'',departureDate:bestDeparture?.date||'',departureTime:bestDeparture?.time||'',departureFlightNo:departureFlight||flightNo,departureOrigin:origin,departureDestination:destination,departureIsActual:Boolean(bestDeparture),departureTimeSource:bestDeparture?'IndiGo SmartKargo origin Departed event':'',arrivalDate,arrivalTime,arrivalIsActual,status,isPartLoad:partLoad,partShipments:partLoad?partShipments:undefined,officialTracker:URL,source:'IndiGo CarGo official SmartKargo tracker',arrivalTimeSource:arrivalIsActual?'IndiGo final-destination Arrived event':'',_debug:{textSample:text.slice(0,7000),departureRows:departureRows.slice(-10),departureEvidence:bestDepartureRow.slice(0,1400),arrivalRows:arrivalRows.slice(-10),arrivalEvidence:bestRow.slice(0,1400),partEvents:history.events.slice(-20),partShipments}};
  return partLoad?shipment:applyFlightArrivalFallback(shipment,text);
}

function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
function headers(extra={}){return{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36','accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8','accept-language':'en-IN,en;q=0.9','cache-control':'no-cache','pragma':'no-cache',...extra};}
function attr(tag,name){const m=String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i'));return decode(m?.[1]??m?.[2]??m?.[3]??'');}
function inputs(html=''){
  const list=[...String(html).matchAll(/<input\b[^>]*>/gi)].map(m=>{const t=m[0];return{name:attr(t,'name'),id:attr(t,'id'),type:(attr(t,'type')||'text').toLowerCase(),value:attr(t,'value'),placeholder:attr(t,'placeholder')};});
  for(const m of String(html).matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)){const t=`<textarea ${m[1]}>`;list.push({name:attr(t,'name'),id:attr(t,'id'),type:'textarea',value:decode(m[2]||''),placeholder:attr(t,'placeholder')});}
  return list;
}
function cookieHeader(response){try{const xs=response.headers.getSetCookie?.();if(xs?.length)return xs.map(x=>x.split(';')[0]).join('; ');}catch{}return(response.headers.get('set-cookie')||'').split(/,(?=[^;,]+=)/).map(x=>x.split(';')[0]).filter(Boolean).join('; ');}

async function postFormTracking(mawb,serial){
  try{
    const get=await fetch(URL,{headers:headers(),redirect:'follow',cache:'no-store'}),getHtml=await get.text(),getText=clean(getHtml);
    if(!get.ok||/Access Denied|permission to access/i.test(getText))return{ok:false,reason:`INDIGO OFFICIAL GET BLOCKED (${get.status})`,debug:{stage:'GET_BLOCKED',status:get.status,preview:getText.slice(0,1800)}};
    const list=inputs(getHtml),form=new URLSearchParams();
    for(const i of list)if(i.name&&i.type==='hidden')form.set(i.name,i.value||'');
    const desc=i=>`${i.name} ${i.id} ${i.placeholder}`.toLowerCase();
    const prefixInput=list.find(i=>i.name&&i.type!=='hidden'&&/prefix/.test(desc(i)));
    const awbInput=list.find(i=>i.name&&i.type!=='hidden'&&/(awb|airway)/.test(desc(i))&&!/prefix/.test(desc(i)));
    const trackInput=list.find(i=>i.name&&['submit','button'].includes(i.type)&&/track|go/i.test(`${i.value} ${i.name} ${i.id}`));
    if(!prefixInput||!awbInput)return{ok:false,reason:'INDIGO FORM FIELDS NOT FOUND',debug:{stage:'FORM_FIELDS',inputs:list.filter(i=>i.type!=='hidden').slice(0,30)}};
    form.set(prefixInput.name,'312-');form.set(awbInput.name,serial);if(trackInput?.name)form.set(trackInput.name,trackInput.value||'Track');
    const cookie=cookieHeader(get),post=await fetch(URL,{method:'POST',headers:headers({'content-type':'application/x-www-form-urlencoded','referer':URL,'origin':'https://6ecargo.goindigo.in',...(cookie?{cookie}:{})}),body:form.toString(),redirect:'follow',cache:'no-store'}),html=await post.text(),text=clean(html);
    if(!post.ok||/Access Denied|permission to access/i.test(text))return{ok:false,reason:`INDIGO OFFICIAL POST BLOCKED (${post.status})`,debug:{stage:'POST_BLOCKED',status:post.status,preview:text.slice(0,1800)}};
    const shipment=parseIndigoTracking(html,mawb),debug=shipment._debug;delete shipment._debug;
    if(useful(shipment))return{ok:true,shipment,officialTracker:URL,adapter:'IndiGo SmartKargo direct form',debug:{stage:'SUCCESS_DIRECT_FORM',status:post.status,...debug}};
    return{ok:false,reason:/AWB\s+Details\s+not\s+available/i.test(text)?'INDIGO OFFICIAL FORM SAYS AWB DETAILS NOT AVAILABLE':'INDIGO OFFICIAL FORM RETURNED NO VERIFIED SHIPMENT FIELDS',debug:{stage:'NO_FIELDS',status:post.status,preview:text.slice(0,2600)}};
  }catch(e){return{ok:false,reason:`INDIGO DIRECT TRACKING ERROR: ${e?.message||e}`,debug:{stage:'ERROR'}};}
}

export async function trackIndigo(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('312-'))return{ok:false,reason:'INVALID INDIGO MAWB',officialTracker:URL};
  const serial=mawb.slice(4);
  const direct=await postFormTracking(mawb,serial);
  if(direct.ok)return direct;

  const browser=await fetchIndigoWithBrowser(serial);
  if(browser.html){
    const shipment=parseIndigoTracking(browser.html,mawb),debug=shipment._debug;delete shipment._debug;
    if(useful(shipment))return{ok:true,shipment,officialTracker:URL,adapter:'IndiGo real browser prefix + AWB + Track',debug:{stage:'SUCCESS_BROWSER_FLOW',browser:browser.debug||null,...debug}};
  }
  return{ok:false,reason:browser.reason||direct.reason||'INDIGO TRACKING FAILED',officialTracker:URL,debug:{direct:direct.debug||null,browser:browser.debug||null}};
}