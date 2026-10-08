import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { trackFlightScheduleFast } from './flightStatusSnapshot.js';
import { normalizeShipmentTimesToIst } from './exportIst.js';

// Dedicated PUBLIC Air France-KLM Martinair Track & Trace form.
// Only prefix 074 is routed here. Never infer an arrival from the home page.
const URL='https://www.afklcargo.com/mycargo/shipment/detail/';
// AWB-specific deep link; accept both KLM's printed 074-12345678
// and the digit-only format without ever going to the generic homepage.
const detailUrl=mawb=>URL+normalizeMawb(mawb);
const alternateDetailUrl=mawb=>URL+mawb.replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
function dateOf(v=''){
  const s=String(v||'').toUpperCase();
  let m=s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(m)return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
  m=s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if(m)return m[3]+'-'+pad(m[2])+'-'+pad(m[1]);
  m=s.match(/\b(\d{1,2})[-\s]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s,]+(20\d{2})\b/);
  if(m)return m[3]+'-'+MONTH[m[2]]+'-'+pad(m[1]);
  return'';
}
function timeOf(v=''){
  const m=String(v||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?pad(m[1])+':'+m[2]:'';
}
function code(v=''){return String(v||'').trim().toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]||'';}
function matchesAwb(text,serial,digits){
  const t=String(text||'').replace(/[^0-9]/g,'');
  return t.includes(digits)||t.includes(serial);
}
function parseShipment(text,mawb,network=[],tables=[]){
  const serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  const carrierBlocks=network.filter(item=>matchesAwb(item.body,serial,digits));
  const visible=String(text||'');
  // A home page with a filled search field is NOT a tracking response.
  const hasAwb=carrierBlocks.length>0||matchesAwb(visible,serial,digits);
  const hasEvidence=/\b(?:shipment\s+(?:information|details|history|status|tracking)|air\s*waybill\s+(?:details|information)|tracking\s+details|(?:received|departed|arrived|delivered)\s+(?:from|at|to|on)|\b(?:BKD|RCS|DEP|ARR|RCF|DLV)\b)\b/i.test(visible)
    ||carrierBlocks.some(item=>/"(?:awb|airwayBill|origin|destination|movement|milestone|status|flight|pieces|weight)"\s*:/i.test(item.body));
  if(!hasAwb||!hasEvidence)return null;

  const sourceText=visible+'\n'+carrierBlocks.map(x=>x.body).join('\n');
  const flat=clean(sourceText),lines=sourceText.split(/\n/).map(clean).filter(Boolean);
  const get=rx=>(flat.match(rx)||[])[1]||'';
  let origin=code(get(/\bOrigin\s*(?:Airport|Station|Code)?\s*[:\-]?\s*([A-Z]{3})\b/i));
  let destination=code(get(/\bDestination\s*(?:Airport|Station|Code)?\s*[:\-]?\s*([A-Z]{3})\b/i));
  const route=flat.match(/\b([A-Z]{3})\s*(?:→|->|–|—|to)\s*([A-Z]{3})\b/i);
  if(route){origin=origin||route[1].toUpperCase();destination=destination||route[2].toUpperCase();}
  let pieces=get(/\b(?:total\s*)?(?:pieces|pcs|piece\s*count)\s*[:\-]?\s*(\d{1,6})\b/i);
  let weight=get(/\b(?:gross|chargeable|total)?\s*weight\s*[:\-]?\s*([\d,.]+)\b/i).replace(/,/g,'');
  let flightNo=(flat.match(/\b(?:KL|AF|MP)\s*0*(\d{2,4})\b/i)||[])[0]||'';
  flightNo=flightNo.replace(/\s+/g,'').toUpperCase();
  let bookingDate='',departureDate='',departureTime='',arrivalDate='',arrivalTime='',arrivalIsActual=false,status='TRACKING',arrivalSource='';
  const events=[];
  for(const line of lines){
    if(line.length>550||!/\b(BKD|RCS|DEP|ARR|RCF|DLV|BOOKED|ACCEPTED|DEPARTED|ARRIVED|DELIVERED|RECEIVED FROM FLIGHT|ETA|ETD)\b/i.test(line))continue;
    const date=dateOf(line),time=timeOf(line),st=String(line.match(/\b(?:at|station|airport)\s*[:\-]?\s*([A-Z]{3})\b/i)?.[1]||'').toUpperCase();
    const upper=line.toUpperCase();
    const type=/\bDLV\b|DELIVERED/.test(upper)?'DELIVERED':
      /\bRCF\b|\bARR\b|ARRIVED|RECEIVED FROM FLIGHT/.test(upper)?'ARRIVED':
      /\bDEP\b|DEPARTED/.test(upper)?'DEPARTED':
      /\bBKD\b|BOOKED/.test(upper)?'BOOKED':
      /\bRCS\b|ACCEPTED/.test(upper)?'ACCEPTED':'OTHER';
    if(type==='OTHER'||(!date&&!time))continue;
    events.push({type,date,time,station:st,line:line.slice(0,240)});
  }
  // Only a final-destination ARR / RCF / delivery event is ACTUAL arrival.
  const final=events.filter(e=>e.type==='ARRIVED'||e.type==='DELIVERED')
    .filter(e=>destination&&e.station===destination&&e.date&&e.time)
    .sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time)).at(-1);
  const dep=events.filter(e=>e.type==='DEPARTED'&&e.date&&e.time)
    .sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time)).at(-1);
  const booked=events.filter(e=>e.type==='BOOKED'||e.type==='ACCEPTED')
    .sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time))[0];
  if(booked)bookingDate=booked.date;
  if(dep){departureDate=dep.date;departureTime=dep.time;status='DEPARTED';}
  if(final){arrivalDate=final.date;arrivalTime=final.time;arrivalIsActual=true;status=final.type==='DELIVERED'?'DELIVERED':'ARRIVED';arrivalSource='AFKLM final destination '+final.type+' event';}
  // Field-level status is accepted only from a matched shipment detail panel,
  // not arbitrary delayed-news headlines on a generic home page.
  if(status==='TRACKING'){
    const key=clean(get(/\b(?:latest\s*status|shipment\s*status|current\s*status)\s*[:\-]?\s*(BOOKED|ACCEPTED|DEPARTED|IN TRANSIT|ARRIVED|DELIVERED|DELAYED)\b/i)).toUpperCase();
    if(key)status=key;
  }
  const tableContent=tables.flatMap(t=>t.rows||[]).map(r=>(r.cells||[]).join(' ')).join(' ');
  if(!pieces)pieces=get(/\b(\d{1,6})\s*(?:PCS|PIECES)\b/i);
  if(!weight)weight=get(/\b([\d,.]+)\s*KGS?\b/i).replace(/,/g,'');
  if(!origin||!destination){
    const tr=tableContent.match(/\b([A-Z]{3})\s*(?:→|->|TO|-)\s*([A-Z]{3})\b/i);
    if(tr){origin=origin||tr[1];destination=destination||tr[2];}
  }
  // Must have a verifiable shipment field, not merely the entered AWB.
  if(!origin&&!destination&&!pieces&&!weight&&!flightNo&&!events.length)return null;
  return{mawb,carrierCode:'KL',airlineName:'KLM Cargo',origin,destination,pieces,bags:pieces,weight,flightNo,
    bookingDate,departureDate,departureTime,departureOrigin:origin,
    departureIsActual:Boolean(dep),departureTimeSource:dep?'AFKLM official departure milestone':'',
    arrivalDate,arrivalTime,arrivalIsActual,arrivalEstimate:false,
    arrivalTimeSource:arrivalSource,arrivalTimeZone:arrivalIsActual?'':'',
    status,officialTracker:URL,source:'Air France KLM Martinair public Track & Trace',
    _parsedEvents:events.slice(-20)};
}

async function fetchPublicShipment(mawb){
  // Official myCargo bundle: baseUrl "api/" and
  // publicShipmentDetailUrl "tnt-api/shipments".
  const url='https://www.afklcargo.com/mycargo/api/tnt-api/shipments/'+mawb.replace(/\D/g,'');
  try{
    const res=await fetch(url,{
      headers:{accept:'application/json, text/plain, */*',referer:detailUrl(mawb),
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36'},
      cache:'no-store',signal:AbortSignal.timeout(13000)
    });
    const raw=await res.text();
    let data=null;try{data=JSON.parse(raw)}catch{}
    return{ok:res.ok&&Array.isArray(data)&&data.length>0,status:res.status,url,data,
      debug:{status:res.status,url,contentType:res.headers.get('content-type')||'',
        items:Array.isArray(data)?data.length:0,
        keys:Array.isArray(data)?Object.keys(data[0]||{}):Object.keys(data||{}),
        sample:raw.slice(0,14000)}};
  }catch(e){return{ok:false,status:0,url,data:null,debug:{url,error:String(e?.message||e)}}}
}
async function launch(){
  chromium.setGraphicsMode=false;
  const config={args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    executablePath:await chromium.executablePath(),headless:'shell',
    defaultViewport:{width:1400,height:1000}};
  let last;
  for(let i=0;i<3;i++)try{return await puppeteer.launch(config)}catch(e){
    last=e;if(!/ETXTBSY|EBUSY/i.test(String(e?.message||e)))throw e;await sleep(450*(i+1));
  }
  throw last;
}

async function inspectPublicApiConfig(){
  const assets=['chunk-TL2AWHWZ.js','chunk-TJHRN325.js'];
  const hints=[];
  for(const file of assets){
    try{
      const res=await fetch('https://www.afklcargo.com/mycargo/'+file,
        {cache:'no-store',headers:{accept:'application/javascript,text/javascript,*/*'},signal:AbortSignal.timeout(8500)});
      const body=res.ok?await res.text():'';
      const tokens=[...body.matchAll(/baseUrl|publicShipmentDetailUrl|shipmentsAwbUrl|tnt-api|shipmentsUrl|shipmentDetailUrl|https:\/\/[\w.-]+/g)].slice(0,22);
      hints.push({file,http:res.status,size:body.length,
        excerpts:tokens.map(m=>body.slice(Math.max(0,m.index-160),Math.min(body.length,m.index+350))).slice(0,14)});
    }catch(e){hints.push({file,error:String(e?.message||e)})}
  }
  return hints;
}
async function snapshot(page){
  let text='',tables=[];
  for(const frame of page.frames())try{
    const v=await frame.evaluate(()=>({
      text:(document.body?.innerText||'').slice(0,55000),
      tables:[...document.querySelectorAll('table')].slice(0,12).map(t=>({
        rows:[...t.querySelectorAll('tr')].slice(0,80).map(r=>({cells:[...r.querySelectorAll('td,th')].map(c=>(c.innerText||'').trim())}))
      }))
    }));
    text+='\n'+v.text;tables.push(...v.tables);
  }catch{}
  return{text,tables};
}

function dateWithYear(day,month,year=String(new Date().getUTCFullYear())){
  const mm=MONTH[String(month||'').toUpperCase().slice(0,3)]||'';
  return mm?String(year)+'-'+mm+'-'+pad(day):'';
}
function parseFlightSchedule(text=''){
  // Flight Schedule, as rendered in the official KLM shipment detail panel:
  // FRA - AMS KL8360 09 OCT 17:00 - 10 OCT 00:59 64 pieces CONFIRMED
  // AMS - DEL KL0871 10 OCT 14:25 - 11 OCT 01:55 64 pieces CONFIRMED
  const segment=String(text||'').split(/Flight\s+schedule/i)[1]?.split(/(?:Estimated\s+Pick\s*up\s+time|Progress\s+details|Shipment\s+milestones)/i)[0]||'';
  const schedule=clean(segment);
  const legs=[];
  for(const m of schedule.matchAll(/\b([A-Z]{3})\s*[-–—]\s*([A-Z]{3})\s+(?:[^\w]{0,12}\s*)?\b((?:KL|AF|MP)\s*0*\d{2,4})\b\s+(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}:\d{2})\s+(\d{1,6})\s+pieces?\s*(CONFIRMED|PENDING|BOOKED|CANCELLED)?/ig)){
    legs.push({origin:m[1].toUpperCase(),destination:m[2].toUpperCase(),
      flightNo:m[3].replace(/\s+/g,'').toUpperCase(),
      departureDate:dateWithYear(m[4],m[5]),departureTime:m[6],
      arrivalDate:dateWithYear(m[7],m[8]),arrivalTime:m[9],
      pieces:m[10],flightStatus:String(m[11]||'').toUpperCase()});
  }
  return legs;
}
function parseProgressBooking(text=''){
  const section=String(text||'').split(/Progress\s+details/i)[1]||'';
  const m=section.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}:\d{2})\s+([A-Z]{3})\s+(?:BKG|BKD)\b/i)
    ||section.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2}:\d{2})\s+([A-Z]{3})\s+\d+\s+pieces?\s+booked\b/i);
  return m?{bookingDate:dateWithYear(m[1],m[2]),bookingTime:m[3],origin:m[4]}:null;
}
function mergeFlightPanel(shipment,text='',mawb=''){
  const legs=parseFlightSchedule(text);
  if(!legs.length)return shipment;
  const last=legs.at(-1),first=legs[0],booked=parseProgressBooking(text);
  const current={...(shipment||{}),mawb,carrierCode:'KL',airlineName:'KLM Cargo',
    origin:shipment?.origin||first.origin,destination:last.destination,
    via:legs.length>1?legs.slice(0,-1).map(x=>x.destination).join(' / '):'',
    bags:last.pieces,pieces:last.pieces,masterPieces:last.pieces,
    flightNo:last.flightNo,flightDate:last.departureDate,
    finalFlightNo:last.flightNo,finalFlightDate:last.departureDate,
    scheduledArrivalDate:last.arrivalDate,scheduledArrivalTime:last.arrivalTime,
    scheduledArrivalTimeZone:last.destination==='DEL'?'IST':'',
    bookingDate:shipment?.bookingDate||booked?.bookingDate||'',
    bookingTime:shipment?.bookingTime||booked?.bookingTime||'',
    flightSchedule:legs,officialTracker:detailUrl(mawb)};
  if(current.arrivalIsActual!==true){
    // Confirmed flight schedule is not proof of cargo arrival.
    current.arrivalDate=last.arrivalDate;
    current.arrivalTime=last.arrivalTime;
    current.arrivalIsActual=false;
    current.arrivalEstimate=true;
    current.arrivalTimeZone=last.destination==='DEL'?'IST':'';
    current.arrivalTimeSource='KLM shipment-detail confirmed flight schedule (expected, not actual)';
    if(!current.status||current.status==='TRACKING')current.status='BOOKED';
  }
  if(!current.departureIsActual&&last.departureDate){
    current.departureDate=last.departureDate;
    current.departureTime=last.departureTime;
    current.departureOrigin=last.origin;
    current.departureTimeZone=last.origin==='DEL'?'IST':'';
    current.departureTimeSource='KLM scheduled flight, not actual departure';
    current.departureIsActual=false;
  }
  current.source='KLM official AWB-specific shipment detail flight schedule';
  return current;
}
// Enrich only an AWB-matched official KLM shipment with its matching final flight.
// The exact AWB detail's schedule is always retained as fallback when flight
// tracking is unavailable. A flight landing is NOT proof of cargo ARR/RCF.
async function enrichKlmEtaFromFlight(shipment){
  const last=Array.isArray(shipment?.flightSchedule)?shipment.flightSchedule.at(-1):null;
  if(!last||!last.flightNo||!last.departureDate||!last.arrivalDate||!last.arrivalTime||
     !last.origin||!last.destination||last.flightStatus==='CANCELLED'||
     shipment.arrivalIsActual===true)return shipment;
  let live;
  try{
    live=await trackFlightScheduleFast({
      flightNo:last.flightNo,date:last.departureDate,
      origin:last.origin,destination:last.destination
    });
  }catch{return shipment;}
  if(!live?.ok)return shipment;

  // Only accept a dated, destination-matching flight, never an unrelated
  // flight-number occurrence or a generic airline tracking page.
  const seenOrigin=String(live.departureOrigin||'').toUpperCase();
  const seenDestination=String(live.departureDestination||'').toUpperCase();
  if((seenOrigin&&seenOrigin!==last.origin)||(seenDestination&&seenDestination!==last.destination))
    return shipment;
  const actual=live.arrivalIsActual===true;
  const candidateDate=String(live.arrivalDate||live.scheduledArrivalDate||'');
  const candidateTime=String(live.arrivalTime||live.scheduledArrivalTime||'');
  const zone=String(live.arrivalTimeZone||live.scheduledArrivalTimeZone||'');
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(candidateDate)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(candidateTime))
    return shipment;
  const checked=normalizeShipmentTimesToIst({
    destination:last.destination,arrivalDate:candidateDate,arrivalTime:candidateTime,
    arrivalTimeZone:zone,arrivalTimeSource:live.arrivalTimeSource||live.source||'Dated flight ETA'
  });
  const official=normalizeShipmentTimesToIst({
    destination:last.destination,arrivalDate:last.arrivalDate,arrivalTime:last.arrivalTime,
    arrivalTimeZone:last.destination==='DEL'?'IST':'LOCAL',
    arrivalTimeSource:'KLM official final flight schedule'
  });
  if(checked.arrivalTimeZone!=='IST'||official.arrivalTimeZone!=='IST')return shipment;
  const liveMs=Date.parse(checked.arrivalDate+'T'+checked.arrivalTime+':00+05:30');
  const officialMs=Date.parse(official.arrivalDate+'T'+official.arrivalTime+':00+05:30');
  // If a third-party flight site returns a different day's flight, keep the
  // airline's verified scheduled ETA instead of overwriting with false data.
  if(!Number.isFinite(liveMs)||!Number.isFinite(officialMs)||Math.abs(liveMs-officialMs)>48*3600000)
    return shipment;

  if(actual){
    // Distinguish aircraft landing from cargo arrival. Cargo status is owned
    // by the official AWB-specific ARR / RCF / delivery milestone.
    return{...shipment,flightActualArrivalDate:checked.arrivalDate,
      flightActualArrivalTime:checked.arrivalTime,flightActualArrivalTimeZone:'IST',
      flightActualArrivalSource:live.arrivalTimeSource||live.source||'Final flight landed'};
  }
  return{...shipment,arrivalDate:checked.arrivalDate,arrivalTime:checked.arrivalTime,
    arrivalIsActual:false,arrivalEstimate:true,arrivalTimeZone:'IST',
    arrivalTimeSource:'Dated final-flight ETA ('+(live.arrivalTimeSource||live.source||'flight tracking')+'); cargo arrival not yet confirmed',
    liveEtaDate:checked.arrivalDate,liveEtaTime:checked.arrivalTime,liveEtaTimeZone:'IST'};
}

export async function trackKlm(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('074-'))return{ok:false,reason:'INVALID KLM 074 MAWB',officialTracker:detailUrl('074-00000000')};
  const url=detailUrl(mawb);
  const publicResponse=await fetchPublicShipment(mawb);
  let browser;
  const network=[];
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36');
    page.on('response',async res=>{
      try{
        const api=res.url(),type=String(res.headers()['content-type']||'').toLowerCase();
        if(!/afklcargo\.com/i.test(api)||!/json|text|xml/.test(type))return;
        const data=await res.text();
        if(data.length>250000||data.length<10)return;
        if(/awb|airwaybill|shipment|track|milestone|flight/i.test(api+' '+data.slice(0,1500)))
          network.push({url:api,status:res.status(),body:data.slice(0,120000)});
      }catch{}
    });
    // NEVER open a generic homepage or search form. Only exact AWB detail.
    let firstPage=await page.goto(url,{waitUntil:'domcontentloaded',timeout:26000});
    await page.waitForFunction(()=>/Flight\s+schedule|Progress\s+details|Flight\s+details/i.test(document.body?.innerText||''),{timeout:12000}).catch(()=>{});
    await sleep(750);
    for(let pass=0;pass<4;pass++){
      await page.evaluate(()=>{
        const el=[...document.querySelectorAll('h1,h2,h3,h4,div,section')].find(x=>/^\s*(Flight\s+schedule|Flight\s+details|Progress\s+details)\s*$/i.test(x.textContent||''));
        if(el)el.scrollIntoView({block:'center'});else window.scrollBy(0,800);
      }).catch(()=>{});
      await sleep(550);
      const probe=await snapshot(page);
      if(/Flight\s+schedule/i.test(probe.text)&&/\b(?:KL|AF|MP)\s*0*\d{2,4}\b/i.test(probe.text))break;
    }
    let after=await snapshot(page);
    let detailReady=/Flight\s+schedule|Progress\s+details|Flight\s+details/i.test(after.text);
    let matched=matchesAwb(after.text,mawb.slice(4),mawb.replace(/\D/g,''))
      ||network.some(x=>matchesAwb(x.body,mawb.slice(4),mawb.replace(/\D/g,'')));
    // One direct deep-link fallback. Never open or scrape a generic homepage.
    if(!(detailReady&&matched)){
      const alternate=alternateDetailUrl(mawb);
      if(alternate!==url){
        try{
          const response=await page.goto(alternate,{waitUntil:'domcontentloaded',timeout:18000});
          await page.waitForFunction(()=>/Flight\s+schedule|Progress\s+details|Flight\s+details/i.test(document.body?.innerText||''),{timeout:5000}).catch(()=>{});
          await sleep(350);
          const other=await snapshot(page);
          const otherReady=/Flight\s+schedule|Progress\s+details|Flight\s+details/i.test(other.text);
          const otherMatch=matchesAwb(other.text,mawb.slice(4),mawb.replace(/\D/g,''))
            ||network.some(x=>matchesAwb(x.body,mawb.slice(4),mawb.replace(/\D/g,'')));
          if(otherReady&&otherMatch){after=other;detailReady=true;matched=true;firstPage=response}
        }catch{}
      }
    }
    let shipment=detailReady&&matched?parseShipment(after.text,mawb,network,after.tables):null;
    if(detailReady&&matched)shipment=mergeFlightPanel(shipment,after.text,mawb);
    if(shipment?.flightSchedule?.length&&shipment.arrivalIsActual!==true)
      shipment=await enrichKlmEtaFromFlight(shipment);
    const debug={stage:shipment?'KLM_DIRECT_DETAIL_PARSED':'KLM_DIRECT_DETAIL_NOT_AVAILABLE', publicApi:publicResponse.debug,
      expectedDetailUrl:url,pageUrl:page.url(),initialHttpStatus:firstPage?.status()||0,
      detailReady,matched,frameUrls:page.frames().map(f=>f.url()),
      pageText:after.text.slice(0,13000),
      network:network.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1800)})),
      parsedEvents:shipment?shipment._parsedEvents||[]:[],flightSchedule:shipment?.flightSchedule||[]};
    if(!shipment){debug.publicApiConfig=await inspectPublicApiConfig();return{ok:false,reason:'KLM exact shipment detail did not load or did not contain this AWB; no generic page used',officialTracker:url,debug};}
    delete shipment._parsedEvents;
    return{ok:true,shipment,officialTracker:url,adapter:'KLM AWB-specific shipment detail',debug};
  }catch(e){return{ok:false,reason:'KLM direct shipment detail error: '+String(e?.message||e),officialTracker:url,debug:{stage:'ERROR'}};}
  finally{try{await browser?.close()}catch{}}
}
