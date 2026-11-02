// Gulf Air Cargo 072: ParcelsApp AWB-specific public result + optional licensed API.
// ParcelsApp is an independent aggregator, not Gulf Air's official tracking site.
// Never convert an intermediate arrival into final-destination arrival.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import {normalizeMawb} from './airlines.js';
import {normalizeShipmentTimesToIst} from './exportIst.js';

export const GULF_PARCELS_URL='https://parcelsapp.com/en/carriers/gulf-air-cargo';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const code=v=>/^[A-Z]{3}$/.test(clean(v).toUpperCase())?clean(v).toUpperCase():'';
const num=v=>clean(v).replace(/,/g,'').match(/^\d+(?:\.\d+)?/)?.[0]||'';
const date=s=>{
  const raw=String(s||'');
  let m=raw.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  m=raw.match(/\b(\d{1,2})[\s-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,-]+(20\d{2})\b/i);
  const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  return m?m[3]+'-'+months[m[2].toUpperCase()]+'-'+m[1].padStart(2,'0'):'';
};
const time=s=>{const m=String(s||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?m[1].padStart(2,'0')+':'+m[2]:'';};
const flight=s=>{const m=String(s||'').match(/\bGF[\s-]?(\d{2,4})\b/i);return m?'GF'+m[1]:'';};
function statusCode(s){
  const t=String(s||'').toUpperCase();
  if(/\bDLV\b|\bDELIVERED\b/.test(t))return 'DLV';
  if(/\bRCF\b|RECEIVED FROM FLIGHT/.test(t))return 'RCF';
  if(/\bARR\b|\bARRIVED\b|FLIGHT ARRIVAL/.test(t))return 'ARR';
  if(/\bDEP\b|\bDEPARTED\b|FLIGHT DEPARTURE/.test(t))return 'DEP';
  if(/\bOFF\b|\bOFFLOADED\b/.test(t))return 'OFF';
  if(/\bMAN\b|\bMANIFESTED\b/.test(t))return 'MAN';
  if(/\bRCS\b|RECEIVED FROM SHIPPER|\bCARGO ACCEPTED\b/.test(t))return 'RCS';
  if(/\bBKD\b|\bBOOKED\b|\bBOOKING CONFIRMED\b/.test(t))return 'BKD';
  return '';
}
function stamp(s){
  const raw=String(s||''),d=date(raw);
  if(!d)return {date:'',time:''};
  if(/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)){
    const dt=new Date(raw);
    if(Number.isFinite(dt.getTime())){
      const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(dt).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
      return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
    }
  }
  return {date:d,time:time(raw)};
}
const exactAwb=(v,mawb)=>normalizeMawb(v)===mawb;
const attr=(s,label)=>clean((s.attributes||[]).find(a=>clean(a.l||a.name||a.label).toLowerCase()===label.toLowerCase())?.val||'');
function resultShipment(mawb,{origin='',destination='',pieces='',weight='',flightNo='',events=[],leg={}},kind){
  events.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const accepted=[...events].reverse().find(e=>['RCS','BKD'].includes(e.code));
  const departed=[...events].reverse().find(e=>e.code==='DEP');
  const arrived=[...events].reverse().find(e=>destination&&e.station===destination&&['ARR','RCF','DLV'].includes(e.code));
  const actual=destination&&code(leg.destination)===destination?stamp(leg.actual_arrival):{date:'',time:''};
  const arrivalDate=arrived?.date||actual.date||'',arrivalTime=arrived?.time||actual.time||'';
  const latest=events.at(-1),delivered=arrived?.code==='DLV';
  const status=delivered?'DELIVERED':arrivalDate?'ARRIVED':latest?.code==='OFF'?'OFFLOADED':departed?'IN TRANSIT':
    events.some(e=>e.code==='MAN')?'MANIFESTED':accepted?'BOOKED':'TRACKING';
  if(!events.length&&!((origin||destination)&&(pieces||weight)))return {ok:false,reason:'NO AWB-VERIFIED SHIPMENT DETAILS'};
  return {ok:true,shipment:{
    mawb,carrierCode:'GF',airlineName:'Gulf Air Cargo',
    source:'ParcelsApp Gulf Air Cargo ('+kind+', third-party)',
    officialTracker:GULF_PARCELS_URL,
    origin,destination,pieces,bags:pieces,weight,masterWeight:weight,
    flightNo:flightNo||flight(leg.flight_number)||[...events].reverse().find(e=>e.flightNo)?.flightNo||'',
    bookingDate:accepted?.date||'',departureDate:departed?.date||'',departureTime:departed?.time||'',
    departureIsActual:Boolean(departed),departureTimeZone:'IST',
    arrivalDate,arrivalTime,arrivalIsActual:Boolean(arrivalDate),arrivalTimeZone:'IST',
    arrivalTimeSource:arrived?'ParcelsApp destination '+arrived.code:actual.date?'ParcelsApp actual flight leg arrival':'',
    status,shipmentEvents:events.slice(-30)
  },events};
}
export function parseGulfAirParcelsApi(input,mawbInput){
  const mawb=normalizeMawb(mawbInput);
  if(!mawb?.startsWith('072-'))return {ok:false,reason:'INVALID GULF AIR AWB'};
  const records=Array.isArray(input?.results)?input.results:[input];
  const record=records.find(r=>exactAwb(r?.tracking_number||r?.trackingNumber||r?.shipment?.trackingId,mawb));
  if(!record?.shipment)return {ok:false,reason:'PARCELS API AWB NOT VERIFIED'};
  const sh=record.shipment;if(sh.error)return {ok:false,reason:'PARCELS API ERROR '+clean(sh.error)};
  const origin=code(sh.fromAirport)||airportText(sh.from)||airportText(attr(sh,'from'))||code(attr(sh,'origin airport'));
  const destination=code(sh.toAirport)||airportText(sh.to)||airportText(attr(sh,'to'))||code(attr(sh,'destination airport'));
  const pieces=num(sh.pieces||sh.bags||sh.pieceCount||attr(sh,'pieces')||attr(sh,'bags'));
  const weight=num(sh.weight||sh.grossWeight||attr(sh,'gross weight')||attr(sh,'weight'));
  const legs=Array.isArray(sh.flight_legs)?sh.flight_legs:[];
  const leg=legs.find(l=>code(l.destination)===destination)||legs.at(-1)||{};
  const events=(Array.isArray(sh.states)?sh.states:[])
    .map(e=>({...stamp(e.date),code:statusCode(e.state||e.status),station:code(e.airport)||code(e.station)||code(e.location),
      flightNo:flight(e.flight_number||e.flight||e.state),description:clean(e.state||e.status)}))
    .filter(e=>e.code&&e.date);
  return resultShipment(mawb,{origin,destination,pieces,weight,events,leg},'licensed API');
}
function label(text,names){
  const rows=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for(let i=0;i<rows.length;i++){
    for(const name of names){
      const low=rows[i].toLowerCase(),key=name.toLowerCase();
      if(low===key||low===key+':')return rows[i+1]||'';
      if(low.startsWith(key+':'))return rows[i].slice(key.length+1).trim();
    }
  }
  return '';
}
function airportText(v){
  const t=clean(v).toUpperCase();
  if(code(t))return t;
  return t.match(/\(([A-Z]{3})\)/)?.[1]||t.match(/^([A-Z]{3})\b/)?.[1]||'';
}
export function parseGulfAirParcelsPage(dom,mawbInput){
  const mawb=normalizeMawb(mawbInput);
  if(!mawb?.startsWith('072-'))return {ok:false,reason:'INVALID GULF AIR AWB'};
  const left=String(dom?.leftText||dom?.resultText||'');
  const right=String(dom?.rightText||dom?.resultText||'');
  const all=left+'\n'+right+'\n'+String(dom?.resultText||'');
  const awbPattern=new RegExp('(?:^|\\D)072[\\s-]*'+mawb.slice(4)+'(?:\\D|$)');
  if(!awbPattern.test(all))return {ok:false,reason:'PARCELS RESULT AWB NOT VERIFIED'};
  // Do not use last transit event as destination; require an explicit booking field.
  const origin=airportText(label(right,['From','Origin Airport','Origin']));
  const destination=airportText(label(left,['Final Destination','Booked Destination','Booking Destination','Destination Airport','Destination']))||
    airportText(label(right,['To','Destination Airport','Destination']));
  const pieces=num(label(right,['No. of Bags','Number of Bags','Bags','No. of Pieces','Pieces']));
  const weight=num(label(right,['Gross Weight','Weight']));
  const rawEvents=Array.isArray(dom?.timelineRows)&&dom.timelineRows.length?dom.timelineRows:
    left.split(/(?=\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b)/i).filter(t=>t.length>24);
  const events=rawEvents.map(r=>{const row=clean(r),d=stamp(row),site=row.match(/\b(?:AT|IN|AIRPORT|STATION)\s+([A-Z]{3})\b/i);
    return {...d,code:statusCode(row),station:code(site?.[1]),flightNo:flight(row),description:row.slice(0,200)};})
    .filter(e=>e.code&&e.date);
  if(!events.length&&(!origin||!destination||(!weight&&!pieces)))return {ok:false,reason:'PARCELS RESULT NOT LOADED'};
  const result=resultShipment(mawb,{origin,destination,pieces,weight,events},'public page');
  if(result.ok){
    // Browser event text uses carrier-local clock; only convert if station is known.
    result.shipment.departureTimeZone='LOCAL';
    result.shipment.departureOrigin=events.find(e=>e.code==='DEP')?.station||origin;
    result.shipment.arrivalTimeZone='LOCAL';
    result.shipment=normalizeShipmentTimesToIst(result.shipment);
  }
  return result;
}
async function apiLookup(mawb){
  const key=process.env.PARCELSAPP_API_KEY;
  if(!key)return {ok:false,reason:'PARCELSAPP_API_KEY NOT CONFIGURED'};
  const request=async(url,opt={})=>{
    const resp=await fetch(url,{...opt,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(13000)});
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok)throw Error('Parcels API HTTP '+resp.status+' '+clean(data.error?.code));
    return data;};
  try{
    let data=await request('https://parcelsapp.com/api/v4/trackings',{method:'POST',
      body:JSON.stringify({language:'en',shipments:[{tracking_number:mawb,carrier_hint:'gulf-air-cargo'}]})});
    for(let attempt=0;attempt<5&&!data.done&&data.request_id;attempt++){
      await sleep(800);
      data=await request('https://parcelsapp.com/api/v4/trackings/'+encodeURIComponent(data.request_id));
    }
    return parseGulfAirParcelsApi(data,mawb);
  }catch(e){return {ok:false,reason:'PARCELS API ERROR: '+clean(e.message)};}
}
// Real user-like browser sequence: enter the AWB into the visible field first,
// then activate ParcelsApp's actual submit control. Setting a DOM value followed
// by button.click() alone can fail to trigger the site's reactive input state.
export async function submitGulfAirParcelsForm(page,mawbInput){
  const mawb=normalizeMawb(mawbInput);
  if(!mawb?.startsWith('072-'))return {ok:false,reason:'INVALID GULF AIR MAWB'};
  const digits=mawb.replace('-','');
  const candidates=['input[name="tracking_id"]','input[placeholder="Enter tracking number"]',
    'input[aria-label="Enter tracking number"]','input[name="awbNumber"]'];
  let input=null;
  for(const selector of candidates){
    input=await page.$(selector);
    if(input)break;
  }
  if(!input)return {ok:false,reason:'PARCELS VISIBLE AWB FIELD NOT FOUND'};
  await input.click({clickCount:3});
  // Triple-click selects the existing AWB. Puppeteer `press` accepts a key,
  // not the `Control+A` chord (which threw Unknown key and aborted GF tracking).
  await page.keyboard.press('Backspace');
  await page.keyboard.type(digits,{delay:35});
  const actual=await page.evaluate(el=>String(el.value||'').replace(/\D/g,''),input);
  if(actual!==digits)return {ok:false,reason:'PARCELS AWB WAS NOT ENTERED INTO FIELD'};
  const buttons=['button[data-tracking-submit="true"]','button[type="submit"]',
    'input[type="submit"]'];
  let button=null;
  for(const selector of buttons){
    button=await page.$(selector);
    if(button)break;
  }
  if(!button){
    // The label varies between "Track package" and "Track Cargo".
    const handle=await page.evaluateHandle(()=>{
      return [...document.querySelectorAll('button,[role="button"]')].find(el=>
        /track\s*(?:package|cargo)|^\s*track\s*$/i.test(el.innerText||el.textContent||''));
    });
    button=handle.asElement();
  }
  if(!button)return {ok:false,reason:'PARCELS TRACK BUTTON NOT FOUND'};
  const buttonLabel=await page.evaluate(el=>(el.innerText||el.value||el.textContent||'').trim(),button);
  await button.click({delay:100});  // real Puppeteer mouse-click sequence
  return {ok:true,method:'PHYSICAL_INPUT_AND_BUTTON_CLICK',buttonLabel,awbEntered:digits};
}
async function publicPageLookup(mawb){
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
      executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:1366,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    // Install network diagnostics BEFORE clicking; the Track button triggers
    // an asynchronous API request which was previously missed in error logs.
    const sourceErrors=[],apiResponses=[];
    page.on('response',async response=>{
      if(!/parcelsapp\.com\/api\/v\d+\/parcels(?:\?|$)/i.test(response.url()))return;
      const status=response.status();
      try{
        const data=await response.json();
        if(data?.error)sourceErrors.push(String(data.error).slice(0,100));
        apiResponses.push({status,error:data?.error||'',hasEvents:Boolean(data?.results?.length)});
      }catch{apiResponses.push({status,error:'UNREADABLE_RESPONSE'});}
    });
    // Start at the provided Gulf Air carrier page, NOT an already-filled
    // URL. Input -> Track Cargo/Track package -> results -> scroll.
    await page.goto(GULF_PARCELS_URL,{waitUntil:'domcontentloaded',timeout:29000});
    await page.waitForSelector('input[name="tracking_id"],input[placeholder="Enter tracking number"]',
      {visible:true,timeout:12000});
    const submitted=await submitGulfAirParcelsForm(page,mawb);
    if(!submitted.ok)return {ok:false,reason:submitted.reason,
      debug:{stage:'PARCELS_AWB_OR_BUTTON',url:page.url()}};
    let dom={},parsed={ok:false,reason:'NO PARCELS TRACKING RESULT'};
    for(let attempt=0;attempt<8;attempt++){
      await sleep(attempt?1300:2200);
      // Search results appear below the form. Scroll only AFTER Track is clicked.
      await page.evaluate(()=>window.scrollTo(0,Math.round(document.body.scrollHeight*.72))).catch(()=>{});
      await sleep(120);
      dom=await page.evaluate(()=>{
        const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
        const txt=e=>(e?.innerText||'').trim();
        const pick=patterns=>patterns.flatMap(p=>[...document.querySelectorAll(p)]).filter(visible).map(txt).filter(t=>t.length>25);
        const sections=pick(['[class*="tracking-result"]','[class*="trackingResult"]','[class*="shipment-result"]','[class*="result-details"]']);
        const body=txt(document.body),resultText=sections.join('\n')||body;
        const left=pick(['[class*="timeline"]','[class*="history"]','[class*="events"]']).sort((a,b)=>b.length-a.length)[0]||resultText;
        const right=pick(['[class*="summary"]','[class*="shipment-details"]','[class*="package-info"]']).sort((a,b)=>b.length-a.length)[0]||resultText;
        const timelineRows=[...document.querySelectorAll('li,tr,[class*="event"]')]
          .filter(visible).map(txt).filter(t=>t.length>12&&t.length<450&&/20\d{2}/.test(t)).slice(0,100);
        return {resultText,leftText:left,rightText:right,timelineRows,bodySample:body.slice(0,500)};
      });
      if(/verify you are human|captcha|cloudflare challenge/i.test(dom.bodySample))
        return {ok:false,reason:'PARCELS HUMAN VERIFICATION REQUIRED',
          debug:{stage:'PARCELS_CHALLENGE',submitted}};
      parsed=parseGulfAirParcelsPage(dom,mawb);
      if(parsed.ok)break;
      if(sourceErrors.includes('NO_DATA'))break;
    }
    return parsed.ok?{...parsed,debug:{stage:'PARCELS_AWB_VERIFIED',url:page.url(),events:parsed.events.length,
        submitMethod:submitted.method,buttonLabel:submitted.buttonLabel}}:
      {ok:false,reason:sourceErrors.includes('NO_DATA')?'PARCELS PUBLIC TRACKER API RETURNED NO_DATA':parsed.reason,
        debug:{stage:'PARCELS_UNVERIFIED',url:page.url(),submitted,
          sourceErrors:[...new Set(sourceErrors)].slice(0,5),apiResponses:apiResponses.slice(-3),
          pageSample:dom.bodySample}};
  }catch(e){return {ok:false,reason:'PARCELS BROWSER ERROR '+clean(e.message)};}
  finally{try{await browser?.close()}catch{}}
}
export async function trackGulfAirParcels(input){
  const mawb=normalizeMawb(input);
  if(!mawb?.startsWith('072-'))return {ok:false,reason:'INVALID GULF AIR MAWB'};
  const api=await apiLookup(mawb);
  if(api.ok)return api;
  const page=await publicPageLookup(mawb);
  if(page.ok)return page;
  return {ok:false,reason:page.reason||api.reason,officialTracker:GULF_PARCELS_URL,
    manualHint:'ParcelsApp did not return an AWB-verified record automatically. Open the page manually; saved tracking information is preserved.',
    debug:{stage:'PARCELS_NOT_VERIFIED',api:api.reason,page:page.reason,pageDebug:page.debug||{}}};
}
