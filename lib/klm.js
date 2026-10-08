import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { trackFlightScheduleFast } from './flightStatusSnapshot.js';
import { normalizeShipmentTimesToIst } from './exportIst.js';
import { trackKlmFromOfficialLiveApi, parseKlmLiveJson } from './klmLive.js';

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
// Weight may be printed in the shipment summary, in a labelled table cell,
// or in a JSON shipment record. Never infer kg from flight/piece counts.
function kgWeightNumber(value,unit=''){
  let u=String(unit||'').trim().toUpperCase();
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    u=String(value.unit||value.uom||value.weightUnit||value.unitOfMeasurement||u).toUpperCase();
    value=value.value??value.amount??value.quantity??value.weight??value.grossWeight??null;
  }
  if(value==null)return'';
  let raw=String(value).trim();
  const m=raw.match(/^([0-9][0-9., ]{0,18})(?:\s*(KGS?|KGM|KILOGRAMS?|LBS?|POUNDS?))?$/i);
  if(!m)return'';
  u=String(m[2]||u).toUpperCase();
  if(u&& !/^(KG|KGS|KGM|KILOGRAM|KILOGRAMS|LB|LBS|POUND|POUNDS)$/.test(u))return'';
  let n=m[1].replace(/\s/g,'');
  // Support 1,234.50 / 1.234,50 as well as integer/grouped weights.
  if(n.includes('.')&&n.includes(',')){
    n=n.lastIndexOf(',')>n.lastIndexOf('.')?n.replace(/\./g,'').replace(',','.'):n.replace(/,/g,'');
  }else if(n.includes(',')){
    n=/,\d{1,2}$/.test(n)?n.replace(',','.'):n.replace(/,/g,'');
  }else if(/^\d{1,3}(?:\.\d{3})+$/.test(n)){
    n=n.replace(/\./g,'');
  }
  let kg=Number(n);
  if(!Number.isFinite(kg)||kg<=0||kg>1000000)return'';
  if(/^(LB|LBS|POUND|POUNDS)$/.test(u))kg*=0.45359237;
  return String(Number(kg.toFixed(3)));
}
function parseWeightFromText(text='',tables=[]){
  const flat=clean(text);
  // Prefer the shipment's gross/total weight, not chargeable or leg weight.
  const labels=[
    /\b(?:TOTAL\s+GROSS\s+WEIGHT|GROSS\s+WEIGHT|GROSS\s+WT|TOTAL\s+WEIGHT|SHIPMENT\s+WEIGHT)\s*(?:\((?:KG|KGS|KGM)\))?\s*[:\s–-]{0,20}([\d][\d., ]{0,16})\s*(KGS?|KGM|KILOGRAMS?|LBS?)?\b/ig,
    /\b(?:WEIGHT)\s*(?:\((?:KG|KGS|KGM)\))?\s*[:\s–-]{0,12}([\d][\d., ]{0,16})\s*(KGS?|KGM|KILOGRAMS?|LBS?)?\b/ig,
    /\b([\d][\d., ]{0,14})\s*(KGS?|KGM|KILOGRAMS?)\s*(?:GROSS\s+WEIGHT|TOTAL\s+WEIGHT)\b/ig
  ];
  for(const rx of labels){
    for(const m of flat.matchAll(rx)){
      const value=kgWeightNumber(m[1].trim(),m[2]||'');
      if(value)return value;
    }
  }
  for(const table of tables||[]){
    for(const row of table.rows||[]){
      const cells=row.cells||[];
      for(let i=0;i<cells.length;i++){
        const label=clean(cells[i]).toUpperCase();
        if(!/^(?:GROSS|TOTAL|SHIPMENT)?\s*(?:GROSS\s*)?(?:WEIGHT|WT)\b/.test(label))continue;
        for(const c of cells.slice(i+1,i+3)){
          const m=String(c||'').match(/([\d][\d., ]{0,16})\s*(KGS?|KGM|KILOGRAMS?|LBS?)?/i);
          if(m){const w=kgWeightNumber(m[1].trim(),m[2]||'');if(w)return w;}
        }
      }
    }
  }
  return'';
}
// Read the RIGHT-HAND "Shipment details" card, where AFKLM shows
// cargo gross weight. A labelled value is required: never calculate a
// shipment weight from pieces, individual flight legs or another AWB.
function weightFromRightShipmentDetails(panels=[]){
  const labels=[
    /(?:^|[\n:])\s*(?:total\s+gross\s+weight|gross\s+(?:shipment\s+)?weight|gross\s+wt)\s*(?:\(\s*(kg|kgs|kgm|lb|lbs)\s*\))?\s*[:\s]*([\d][\d., ]{0,16})\s*(kg|kgs|kgm|kilograms?|lb|lbs|pounds?)?(?=\s|$)/im,
    /(?:^|[\n:])\s*(?:total\s+weight|shipment\s+weight|weight)\s*(?:\(\s*(kg|kgs|kgm|lb|lbs)\s*\))?\s*[:\s]*([\d][\d., ]{0,16})\s*(kg|kgs|kgm|kilograms?|lb|lbs|pounds?)?(?=\s|$)/im
  ];
  // Narrowest visible card first, then the rightmost, to avoid accidentally
  // selecting a different shipment's table or flight leg weight.
  const ordered=[...(panels||[])].filter(p=>p&&typeof p.text==='string')
    .sort((a,b)=>(Number(a.length)||a.text.length)-(Number(b.length)||b.text.length)||
      (Number(b.x)||0)-(Number(a.x)||0));
  for(const panel of ordered){
    const lines=String(panel.text||'').slice(0,9000)
      .replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
    for(const rx of labels){
      for(let i=0;i<lines.length;i++){
        if(/chargeable|dimensional|volumetric|volume\s+weight|flight\s+weight|piece\s+weight/i.test(lines[i]))continue;
        // KLM card can render heading, field label, numeric value and unit
        // as separate adjacent flexbox children / text lines.
        const context=lines.slice(i,i+3).join(' ');
        const match=context.match(new RegExp(rx.source.replace('(?:^|[\\n:])\\s*','^\\s*'), 'i'));
        if(!match)continue;
        const weight=kgWeightNumber(match[2].trim(),match[3]||match[1]||'');
        if(weight)return{weight,weightSource:'KLM live right-side Shipment Details card'};
      }
    }
  }
  return{weight:'',weightSource:''};
}
function parseWeightFromApi(payload,mawb){
  if(!payload||typeof payload!=='object')return'';
  let json='';try{json=JSON.stringify(payload)}catch{return''}
  const serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  // Do not take unrelated AWB or catalogue weights.
  if(!matchesAwb(json,serial,digits))return'';
  const candidates=[];
  const queue=[{v:payload,path:'',depth:0}];
  let visited=0;
  while(queue.length&&visited++<180){
    const {v,path,depth}=queue.shift();
    if(!v||typeof v!=='object'||depth>8)continue;
    if(Array.isArray(v)){for(const child of v.slice(0,50))queue.push({v:child,path,depth:depth+1});continue}
    for(const [key,value] of Object.entries(v)){
      const name=key.toLowerCase().replace(/[^a-z]/g,'');
      const nextPath=path+'.'+name;
      if(/(?:leg|flight|movement|event|milestone|route|segment|partshipment|partload|package|pieces|chargeable|volume|dimensional)/.test(nextPath))continue;
      if(/^(grossweight|grosswt|grosswgt|totalgrossweight|totalweight|shipmentweight|grossweightkg|grossweightinkg|weightkg|weightinkg|weightkgs|weightkgm|weight)$/.test(name)){
        const nearbyUnit=String(v.weightUnit||v.weightUom||v.unitOfWeight||v.unit||v.uom||'');
        const converted=kgWeightNumber(value,nearbyUnit);
        if(converted)candidates.push({value:converted,priority:/grossweight|grosswt|grosswgt/.test(name)?0:/totalweight|shipmentweight/.test(name)?1:2,depth});
      }
      if(value&&typeof value==='object')queue.push({v:value,path:nextPath,depth:depth+1});
    }
  }
  candidates.sort((a,b)=>a.priority-b.priority||a.depth-b.depth);
  return candidates[0]?.value||'';
}
function klmOfficialWeight(mawb,visible='',tables=[],apiResponses=[],network=[]){
  const textWeight=parseWeightFromText(visible,tables);
  if(textWeight)return{weight:textWeight,weightSource:'KLM official AWB shipment summary/table'};
  for(const payload of apiResponses){
    const weight=parseWeightFromApi(payload,mawb);
    if(weight)return{weight,weightSource:'KLM official AWB-specific shipment JSON'};
  }
  for(const result of network){
    if(!matchesAwb(result?.body||'',mawb.slice(4),mawb.replace(/\D/g,'')))continue;
    let data=null;try{data=JSON.parse(result.body)}catch{}
    const weight=parseWeightFromApi(data,mawb);
    if(weight)return{weight,weightSource:'KLM official shipment network response'};
  }
  return{weight:'',weightSource:''};
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
  weight=klmOfficialWeight(mawb,visible,tables,[],network).weight||kgWeightNumber(weight)||'';
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
  let text='',tables=[],rightShipmentPanels=[];
  for(const frame of page.frames())try{
    const v=await frame.evaluate(()=>{
      const candidates=[];
      // Locate the SHIPMENT DETAILS heading in the live AWB page, rather
      // than scanning flight schedule or a global unrelated weight label.
      const nodes=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,p,strong,label,section')];
      const headings=nodes.filter(e=>{
        const own=(e.innerText||e.textContent||'').trim().replace(/\s+/g,' ');
        return own.length<75&&/^shipment\s+details?\s*:?$/i.test(own)&&
          ![...e.children].some(c=>/^shipment\s+details?\s*:?$/i.test((c.textContent||'').trim()));
      }).slice(0,20);
      for(const heading of headings){
        let root=heading;
        for(let depth=0;root&&depth<6;depth++,root=root.parentElement){
          const text=(root.innerText||'').trim();
          if(text.length<12||text.length>9000||
             !/\b(?:gross\s*weight|total\s*weight|shipment\s*weight|weight)\b/i.test(text))continue;
          const rect=root.getBoundingClientRect();
          if(rect.width<=0||rect.height<=0)continue;
          candidates.push({text:text.slice(0,9000),length:text.length,x:rect.left,
            rightSide:rect.left>=window.innerWidth*.42});
          break;
        }
      }
      // Repeated label/value components in the card may use an accessible
      // grid, not a <table>; preserve their visual order via innerText above.
      return{
        text:(document.body?.innerText||'').slice(0,55000),
        tables:[...document.querySelectorAll('table')].slice(0,12).map(t=>({
          rows:[...t.querySelectorAll('tr')].slice(0,80).map(r=>({
            cells:[...r.querySelectorAll('td,th')].map(c=>(c.innerText||'').trim())
          }))
        })),
        rightShipmentPanels:candidates
      };
    });
    text+='\n'+v.text;tables.push(...v.tables);
    rightShipmentPanels.push(...v.rightShipmentPanels.filter(p=>p.rightSide));
  }catch{}
  return{text,tables,rightShipmentPanels};
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
  // Every successful KLM result must be traceable to a fresh official AWB
  // response. Operator screenshots and cached rows are NOT tracking providers.
  const liveApi=await trackKlmFromOfficialLiveApi(mawb);
  if(liveApi.ok){
    let shipment=normalizeShipmentTimesToIst(liveApi.shipment);
    if(shipment.flightSchedule?.length&&!shipment.arrivalIsActual)
      shipment=await enrichKlmEtaFromFlight(shipment);
    return{ok:true,shipment,officialTracker:url,adapter:'KLM official live API',
      debug:{stage:'KLM_LIVE_API_VERIFIED',...liveApi.debug}};
  }
  const publicResponse={data:null,debug:liveApi.debug||{reason:liveApi.reason}};
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
    // A generic-landing redirect is not a valid AWB tracking result.
    // Fail clearly rather than wasting time scraping its unrelated homepage.
    if(/^https:\/\/www\.afklcargo\.com\/mycargo\/?(?:[?#].*)?$/i.test(page.url())){
      return{ok:false,reason:'KLM official portal redirected to a generic page; no verified live AWB data. Approved Cargo API access is required if public API remains inaccessible.',officialTracker:url,
        debug:{stage:'KLM_PUBLIC_PORTAL_REDIRECT_NO_LIVE_DATA',publicApi:publicResponse.debug,pageUrl:page.url()}};
    }
    await page.waitForFunction(()=>/Flight\s+schedule|Progress\s+details|Flight\s+details/i.test(document.body?.innerText||''),{timeout:6500}).catch(()=>{});
    await sleep(750);
    const browserApi=await page.evaluate(async awb=>{
      const url='/mycargo/api/tnt-api/shipments/'+awb;
      try{
        const response=await fetch(url,{
          method:'GET',credentials:'same-origin',cache:'no-store',
          headers:{accept:'application/json, text/plain, */*'},
          signal:AbortSignal.timeout(11000)
        });
        const body=await response.text();
        let data=null;try{data=JSON.parse(body)}catch{}
        return{url,status:response.status,ok:response.ok&&Array.isArray(data)&&data.length>0,
          data,debug:{url,status:response.status,contentType:response.headers.get('content-type'),
          length:body.length,sample:body.slice(0,15500),
          items:Array.isArray(data)?data.length:0,keys:Array.isArray(data)?Object.keys(data[0]||{}):[]}};
      }catch(e){return{ok:false,url,debug:{url,error:String(e?.message||e)}}}
    },mawb).catch(e=>({ok:false,debug:{error:String(e?.message||e)}}));
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
    // Public JSON is authoritative only when the response itself identifies
    // this exact AWB and contains real shipment fields.
    let shipment=parseKlmLiveJson(browserApi.data,mawb,'AFKLM browser live AWB API');
    if(!shipment){
      for(const response of network){
        if(!/\/tnt-api\/shipments(?:\/|$)/i.test(response.url)||response.status!==200)continue;
        let json;try{json=JSON.parse(response.body)}catch{continue}
        shipment=parseKlmLiveJson(json,mawb,'AFKLM live shipment network API');
        if(shipment)break;
      }
    }
    if(!shipment&&detailReady&&matched){
      shipment=parseShipment(after.text,mawb,network,after.tables);
      if(shipment)shipment=mergeFlightPanel(shipment,after.text,mawb);
      if(shipment){shipment.klmLiveVerifiedAt=new Date().toISOString();}
    }
    const verifiedWeight=(detailReady&&matched?weightFromRightShipmentDetails(after.rightShipmentPanels):null)
      ||{weight:'',weightSource:''};
    const liveWeight=verifiedWeight.weight?verifiedWeight:klmOfficialWeight(
      mawb,detailReady&&matched?after.text:'',detailReady&&matched?after.tables:[],
      [browserApi.data],network);
    if(shipment&&liveWeight.weight){
      shipment.weight=liveWeight.weight;
      shipment.masterWeight=liveWeight.weight;
      shipment.weightSource=liveWeight.weightSource;
    }
    if(shipment?.flightSchedule?.length&&shipment.arrivalIsActual!==true)
      shipment=await enrichKlmEtaFromFlight(shipment);
    const debug={stage:shipment?'KLM_DIRECT_DETAIL_PARSED':'KLM_DIRECT_DETAIL_NOT_AVAILABLE', publicApi:publicResponse.debug,browserPublicApi:browserApi.debug,
      expectedDetailUrl:url,pageUrl:page.url(),initialHttpStatus:firstPage?.status()||0,
      detailReady,matched,frameUrls:page.frames().map(f=>f.url()),
      pageText:after.text.slice(0,13000),
      network:network.slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1800)})),
      rightPanelCount:after.rightShipmentPanels?.length||0,
      weightFound:Boolean(liveWeight.weight),weightSource:liveWeight.weightSource,
      parsedEvents:shipment?shipment._parsedEvents||[]:[],flightSchedule:shipment?.flightSchedule||[]};
    if(!shipment){
      // Endpoint was already identified from the official myCargo JS; do not
      // re-download large bundles on every failed AWB refresh.
      return{ok:false,reason:'KLM exact shipment detail did not load or did not contain this AWB; no generic page used',officialTracker:url,debug};
    }
    delete shipment._parsedEvents;
    shipment=normalizeShipmentTimesToIst(shipment);
    return{ok:true,shipment,officialTracker:url,adapter:'KLM live AWB-specific shipment detail',debug};
  }catch(e){
    return{ok:false,reason:'KLM direct shipment detail error: '+String(e?.message||e),officialTracker:url,debug:{stage:'ERROR',publicApi:publicResponse.debug}};
  }
  finally{try{await browser?.close()}catch{}}
}
