import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { trackFlightScheduleFast } from './flightStatusSnapshot.js';
import { normalizeShipmentTimesToIst } from './exportIst.js';
import { trackKlmFromOfficialLiveApi, parseKlmLiveJson } from './klmLive.js';
import { applyKlmProgressDetails } from './klmProgress.js';
import { parseKlmShipmentPageText } from './klmShipmentPage.js';

// Dedicated PUBLIC Air France-KLM Martinair Track & Trace form.
// Only prefix 074 is routed here. Never infer an arrival from the home page.
// Use the official deep link shown by myCargo. Only the incoming MAWB's
// final 074-XXXXXXXX path component changes on each live refresh.
const URL='https://afklcargo.com/mycargo/shipment/detail/';
// AWB-specific deep link; accept both KLM's printed 074-12345678
// and the digit-only format without ever going to the generic homepage.
const detailUrl=mawb=>URL+normalizeMawb(mawb).replace(/\D/g,'');
const alternateDetailUrl=mawb=>'https://www.afklcargo.com/mycargo/shipment/detail/'+normalizeMawb(mawb).replace(/\D/g,'');
const detailUrls=mawb=>[detailUrl(mawb),alternateDetailUrl(mawb),
  URL+normalizeMawb(mawb),'https://www.afklcargo.com/mycargo/shipment/detail/'+normalizeMawb(mawb)];
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
    // myCargo Shipment details often uses a bullet (not a Weight label):
    // "64 pcs, 1,900 kg, 13,23 m³". Read only within the matched AWB card.
    for(const line of lines){
      const m=line.match(/\b\d{1,6}\s*(?:pcs?|pieces?)\s*[,;]\s*(\d[\d., ]{0,16})\s*(kg|kgs|kgm)\b/i);
      if(m){
        const kg=kgWeightNumber(m[1].trim(),m[2]);
        if(kg)return{weight:kg,weightSource:'KLM live Shipment details: pieces / gross kg'};
      }
    }
    for(const rx of labels){
      for(let i=0;i<lines.length;i++){
        if(/chargeable|dimensional|volumetric|volume\s+weight|flight\s+weight|piece\s+weight/i.test(lines[i]))continue;
        // KLM card can render heading, field label, numeric value and unit
        // as separate adjacent flexbox children / text lines.
        const context=lines.slice(i,i+3).join(' ');
        const match=context.match(new RegExp(rx.source.replace('(?:^|[\\n:])\\s*','^\\s*'), 'i'));
        if(!match)continue;
        // If there is no unit and the captured number is followed by a
        // different field on the same line (e.g. "64 Pieces"), reject it.
        const remaining=context.slice(match[0].length).trim();
        if(!match[1]&&!match[3]&&/^(?:pieces?|pcs?|bags?|flight|chargeable|volume|dimensions?)\b/i.test(remaining))
          continue;
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
  // The official myCargo site has used two public, AWB-specific forms over
  // time: tnt-api/shipments and api/shipment/detail. Probe only those public
  // resources and only accept a response that independently verifies THIS AWB.
  // All variants are fetched concurrently so inaccessible URLs do not add
  // serial timeout delays. Never use an unrelated AWB or homepage response.
  const base='https://www.afklcargo.com/mycargo/api/';
  const digits=mawb.replace(/\D/g,'');
  const urls=[
    base+'tnt-api/shipments/'+digits,
    base+'tnt-api/shipments/'+mawb,
    base+'shipment/detail/'+mawb
  ];
  const attempts=await Promise.all(urls.map(async url=>{
    try{
      const res=await fetch(url,{
        headers:{accept:'application/json, text/plain, */*',referer:detailUrl(mawb),
          'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36'},
        cache:'no-store',signal:AbortSignal.timeout(9000)
      });
      const contentType=res.headers.get('content-type')||'';
      if(!res.ok)return{ok:false,status:res.status,url,debug:{url,http:res.status,contentType}};
      const raw=await res.text();
      let data=null;
      try{data=JSON.parse(raw)}catch{}
      // A JSON document is NOT verification. The importer must see an AWB
      // identifier in the actual record, and must reject a different master.
      const verified=parseKlmLiveJson(data,mawb,'AFKLM public live AWB details');
      return{ok:Boolean(verified),status:res.status,url,data:verified?data:null,
        debug:{url,http:res.status,contentType,awbVerified:Boolean(verified),
          type:Array.isArray(data)?'array':typeof data}};
    }catch(e){
      return{ok:false,status:0,url,data:null,
        debug:{url,error:String(e?.message||e).slice(0,180)}};
    }
  }));
  const success=attempts.find(x=>x.ok);
  if(success)return success;
  return{ok:false,status:attempts.find(x=>x.status)?.status||0,
    url:urls[0],data:null,
    debug:{awbVerified:false,attempts:attempts.map(x=>x.debug)}};
}
async function launch({http1=false}={}){
  chromium.setGraphicsMode=false;
  // The default KLM homepage works via normal Chromium, but some live AWB
  // popup loads abort at HTTP/2. Use a separate HTTP/1.1-only Chromium process
  // as a last retry of the exact official AWB URL; don't downgrade all sites.
  // KLM's public homepage fails with ERR_HTTP2_PROTOCOL_ERROR on the
  // Frankfurt browser worker. Negotiate HTTP/1.1 for this KLM-only browser,
  // including its initial Check Status page, rather than waiting for a
  // second popup to fail before disabling HTTP/2.
  const flags=['--disable-http2','--disable-quic'];
  const config={args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox',...flags],
    executablePath:await chromium.executablePath(),headless:'shell',
    defaultViewport:{width:1400,height:1000}};
  let last;
  // Fresh Lambda instances can briefly be writing the extracted Chromium
  // executable while a concurrent launch starts. ETXTBSY is retryable;
  // do not mistake this local startup race for a KLM tracking failure.
  for(let i=0;i<8;i++)try{return await puppeteer.launch(config)}catch(e){
    last=e;
    if(!/ETXTBSY|EBUSY/i.test(String(e?.message||e)))throw e;
    await sleep(Math.min(850*(i+1),5500));
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
        for(let depth=0;root&&depth<8;depth++,root=root.parentElement){
          const text=(root.innerText||'').trim();
          if(text.length<12||text.length>9000||
             !(/\b(?:gross\s*weight|total\s*weight|shipment\s*weight|weight)\b/i.test(text)||
              /\b\d{1,6}\s*(?:pcs?|pieces?)\s*[,;]\s*\d[\d,. ]{0,16}\s*kg\b/i.test(text)))continue;
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
    // The shipment details card is AWB-specific, but responsive/centered
    // layouts need not place it beyond 42% of the viewport. Keep panels
    // found under that exact heading on the verified AWB detail page.
    rightShipmentPanels.push(...v.rightShipmentPanels);
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
  const segment=String(text||'').split(/Flight\s+(?:schedule|details)/i)[1]?.split(/(?:Estimated\s+Pick\s*up\s+time|Progress\s+details|Shipment\s+milestones|Shipment\s+details)/i)[0]||'';
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
async function captureKlmProgressViews(page){
  const result={station:'',list:'',stages:[]};
  for(const [which,label] of [['station','Station view'],['list','List view']]){
    try{
      const found=await page.evaluate(label=>{
        const visible=e=>{
          const rect=e.getBoundingClientRect(),style=getComputedStyle(e);
          return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';
        };
        const candidates=[...document.querySelectorAll('button,a,[role=tab],div,span')].filter(el=>{
          const txt=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
          if(txt.toLowerCase()!==label.toLowerCase()||!visible(el))return false;
          return ![...el.children].some(c=>String(c.textContent||'').replace(/\s+/g,' ').trim().toLowerCase()===label.toLowerCase());
        });
        if(!candidates.length)return false;
        document.querySelectorAll('[data-mayavi-progress]').forEach(e=>e.removeAttribute('data-mayavi-progress'));
        candidates[0].setAttribute('data-mayavi-progress','1');
        return true;
      },label);
      if(!found){result.stages.push(which+':TAB_ABSENT');continue;}
      await page.click('[data-mayavi-progress="1"]');
      await sleep(450);
      const data=await snapshot(page);
      result[which]=data.text||'';
      result.stages.push(which+':CAPTURED');
    }catch(e){result.stages.push(which+':'+String(e?.name||'ERROR'));}
  }
  return result;
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


// Navigate the PUBLIC AFKLM Track & Trace interface like the operator:
// type the exact AWB, click "Check status", then read the AWB-specific result.
// Landing/homepage content is a form ONLY and is never accepted as shipment data.
async function openKlmShipmentByForm(page,mawb){
  const attempts=[];
  // Prefer the existing AWB-specific Mayavi official link. Do not re-enter
  // the MAWB or press Check Status when its shipment detail is already loaded.
  for(const exact of detailUrls(mawb).slice(0,2)){
    try{
      await page.goto(exact,{waitUntil:'domcontentloaded',timeout:8500});
      await page.waitForFunction(awb=>{
        const body=document.body?.innerText||'';
        return body.replace(/\\D/g,'').includes(awb.replace(/\\D/g,''))&&
          /Flight\\s+(?:schedule|details)|Shipment\\s+details|Progress\\s+details/i.test(body);
      },{timeout:3500},mawb).catch(()=>{});
      const scan=await snapshot(page);
      if(matchesAwb(scan.text||'',mawb.slice(4),mawb.replace(/\\D/g,''))&&
        /Flight\\s+(?:schedule|details)|Shipment\\s+details|Progress\\s+details/i.test(scan.text||'')){
        attempts.push({stage:'KLM_DIRECT_AWB_DETAIL_VERIFIED',page:page.url()});
        return{ok:true,attempts,pageUrl:page.url(),page};
      }
      attempts.push({stage:'KLM_DIRECT_AWB_DETAIL_NOT_READY',page:page.url()});
    }catch(error){attempts.push({stage:'KLM_DIRECT_AWB_DETAIL_ERROR',url:exact,
      error:String(error?.message||error).slice(0,200)});}
  }
  // Only fall back to the homepage form if neither direct detail URL worked.

  // Match the WW/en Track & trace page visible in the operator's browser.
// Preserve the GB page only as a fallback: never assume the regional homepage
// itself supplies AWB data without Check Status returning shipment details.
  const urls=[
    'https://afklcargo.com/WW/en/homepage/homepage',
    'https://www.afklcargo.com/WW/en/homepage/homepage',
    'https://www.afklcargo.com/GB/en/homepage/homepage'
  ];
  const describe=async(activePage=page)=>activePage.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();
      return s.visibility!=='hidden'&&s.display!=='none'&&r.width>0&&r.height>0;};
    return{
      title:document.title||'',
      inputs:[...document.querySelectorAll('input')].filter(visible).slice(0,20)
        .map(x=>({placeholder:x.getAttribute('placeholder')||'',name:x.name||'',id:x.id||'',
          aria:x.getAttribute('aria-label')||'',type:x.type||'',outer:x.outerHTML.slice(0,220)})),
      buttons:[...document.querySelectorAll('button,a,[role=button],input[type=submit]')]
        .filter(visible).slice(0,45).map(x=>({text:(x.innerText||x.getAttribute('aria-label')||x.value||'').trim().slice(0,90),
          href:x.getAttribute('href')||''})),
      body:(document.body?.innerText||'').slice(0,1100)
    };
  }).catch(e=>({error:String(e?.message||e)}));
  for(const candidate of urls.slice(0,1)){
    try{
      let loaded=false,transportError='';
      for(let attempt=0;attempt<1;attempt++){
        try{await page.goto(candidate,{waitUntil:'domcontentloaded',timeout:8000})}
        catch(e){
          transportError=String(e?.message||e);
          if(/ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i.test(transportError))break;
        }
        // The Angular AWB field often appears well after the HTML document.
        await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(x=>
          /(?:awb|air.?way.?bill|057|074)/i.test(
            [x.id,x.name,x.getAttribute('formcontrolname'),x.getAttribute('placeholder'),x.getAttribute('aria-label')].filter(Boolean).join(' ')
          )),{timeout:3500}).catch(()=>{});
        // Do not require a particular Angular input ID: the public Track &
        // Trace widget may label its visible field via aria-label/placeholder.
        loaded=await page.evaluate(()=>[...document.querySelectorAll('input,[role="textbox"]')]
          .some(el=>{
            const style=getComputedStyle(el),rect=el.getBoundingClientRect();
            if(style.display==='none'||style.visibility==='hidden'||rect.width<=0||rect.height<=0)return false;
            const labels=[el.id,el.name,el.getAttribute('formcontrolname'),
              el.getAttribute('placeholder'),el.getAttribute('aria-label'),
              el.closest('label')?.innerText].filter(Boolean).join(' ');
            return /(?:awb|air.?way.?bill|057|074)/i.test(labels);
          })).catch(()=>false);
        if(loaded)break;
      }
      if(!loaded){attempts.push({page:page.url(),stage:'KLM_HOMEPAGE_INPUT_NOT_RENDERED',
        transportError,dom:await describe()});continue}
      const ready=await page.evaluate(()=>{
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();
          return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&
          !e.disabled&&e.type!=='hidden';};
        const list=[...document.querySelectorAll('input:not([type=hidden]),[role=textbox]')].filter(visible);
        const ranked=list.map((el,index)=>{
          const attr=[el.getAttribute('placeholder'),el.getAttribute('aria-label'),el.name,el.id,
            el.getAttribute('formcontrolname'),el.closest('label')?.innerText,
            el.parentElement?.innerText?.slice(0,130)].filter(Boolean).join(' ').toLowerCase();
          const score=(/057|074/.test(attr)?10:0)+(/air.?way.?bill|awb/.test(attr)?8:0)+
            (/track|trace/.test(attr)?4:0)+(el.tagName==='INPUT'&&/text|search|tel/.test(el.type||'')?2:0)-
            (/search\s+station|email|password|newsletter|flight\s+number/.test(attr)?25:0);
          return{el,index,score,attr:attr.slice(0,170)};
        }).sort((a,b)=>b.score-a.score);
        if(!ranked.length||ranked[0].score<5)return{ok:false,candidates:ranked.slice(0,8).map(({score,attr})=>({score,attr}))};
        ranked[0].el.setAttribute('data-mayavi-klm-awb-input','1');
        return{ok:true,candidates:ranked.slice(0,5).map(({score,attr})=>({score,attr}))};
      });
      if(!ready.ok){attempts.push({page:page.url(),stage:'AWB_INPUT_NOT_FOUND',...ready,dom:await describe()});continue}
      const input=await page.$('[data-mayavi-klm-awb-input="1"]');
      if(!input){attempts.push({page:page.url(),stage:'INPUT_DISAPPEARED'});continue}
      // The operator's WW Track & trace form shows the 11-digit AWB
      // (07406152790), without a hyphen. Type with actual keyboard events
      // so Angular form validation and the Check status button update.
      const awbDigits=mawb.replace(/\D/g,'');
      let observed='';
      for(const candidateValue of [awbDigits,mawb]){
        await input.click({clickCount:3});
        await page.keyboard.press('ControlOrMeta+A').catch(()=>{});
        await page.keyboard.type(candidateValue,{delay:22});
        await page.evaluate(()=>{
          const x=document.querySelector('[data-mayavi-klm-awb-input="1"]');
          if(x){
            x.dispatchEvent(new Event('input',{bubbles:true}));
            x.dispatchEvent(new Event('change',{bubbles:true}));
            x.dispatchEvent(new Event('blur',{bubbles:true}));
          }
        });
        observed=await page.evaluate(()=>document.querySelector('[data-mayavi-klm-awb-input="1"]')?.value||'');
        if(observed.replace(/\D/g,'')===awbDigits)break;
      }
      if(observed.replace(/\D/g,'')!==awbDigits){
        attempts.push({page:page.url(),stage:'AWB_INPUT_VALUE_NOT_ACCEPTED',visibleValue:observed});continue;
      }
      // Log the actual URL requested by the public Check Status button.
      // The original browser navigation is preserved (no fake response).
      await page.evaluate(()=>{
        if(window.__mayaviKlmOpenWrapped)return;
        window.__mayaviKlmOpenWrapped=true;
        const open=window.open;
        window.open=function(url,...args){
          window.__mayaviKlmLastOpenedUrl=typeof url==='string'?url:String(url||'');
          return open.call(this,url,...args);
        };
      }).catch(()=>{});
      // Check Status sometimes opens a separate myCargo tab.
      const beforeTabs=await page.browser().pages();
      const clicked=await page.evaluate(()=>{
        const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();
          return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&!e.disabled;};
        const controls=[...document.querySelectorAll('button,a,[role=button],input[type=submit]')]
          .filter(visible).map(el=>({el,t:(el.innerText||el.getAttribute('aria-label')||
            el.getAttribute('title')||el.value||'').replace(/\s+/g,' ').trim()}));
        let target=controls.find(x=>/^check\s+status$/i.test(x.t));
        if(!target)target=controls.find(x=>/\bcheck\s+status\b/i.test(x.t)&&!/flight/i.test(x.t));
        if(!target)return{ok:false,buttons:controls.slice(0,35).map(x=>x.t)};
        const result={ok:true,label:target.t,tag:target.el.tagName,
          href:target.el.getAttribute('href')||'',target:target.el.getAttribute('target')||''};
        target.el.setAttribute('data-mayavi-klm-check-status','1');
        return result;
      });
      if(!clicked.ok){attempts.push({page:page.url(),stage:'CHECK_STATUS_BUTTON_NOT_FOUND',...clicked,dom:await describe()});continue}
      // CDP-trusted pointer click is required when Check Status opens a new
      // window. element.click() from page.evaluate can be popup-blocked.
      try{await page.click('[data-mayavi-klm-check-status="1"]')}
      catch(e){attempts.push({page:page.url(),stage:'CHECK_STATUS_CLICK_FAILED',
        error:String(e?.message||e)});continue}
      await sleep(1750);
      const tabs=await page.browser().pages();
      let targetPage=tabs.find(p=>!beforeTabs.includes(p)&&/afklcargo\.com/i.test(p.url()))||
        tabs.find(p=>!beforeTabs.includes(p))||page;
      await targetPage.waitForFunction(awb=>{
        const text=document.body?.innerText||'';
        const details=/Flight\s+(?:schedule|details)|Shipment\s+details|Progress\s+details|Shipment\s+history/i.test(text);
        const serial=awb.slice(4),full=awb.replace(/\D/g,'');
        const inBody=text.replace(/\D/g,'').includes(full)||text.replace(/\D/g,'').includes(serial);
        return details&&inBody;
      },{timeout:5000},mawb).catch(()=>{});
      await sleep(500);
      const latestTabs=await page.browser().pages();
      const popup=latestTabs.find(p=>!beforeTabs.includes(p)&&/afklcargo\.com/i.test(p.url()));
      if(popup&&popup!==targetPage)targetPage=popup;
      const openedUrl=await page.evaluate(()=>window.__mayaviKlmLastOpenedUrl||'').catch(()=>'');
      const exactOfficialUrl=detailUrl(mawb);
      // Accept the exact user-shown numeric AWB details path regardless of
      // www/non-www origin. No other AWB, route or generic page qualifies.
      const isOpenedExactAwb=()=>{
        try{
          const u=new URL(openedUrl,page.url());
          return /(^|\.)afklcargo\.com$/i.test(u.hostname)&&
            /\/mycargo\/shipment\/detail\//i.test(u.pathname)&&
            u.pathname.replace(/\D/g,'')===mawb.replace(/\D/g,'');
        }catch{return false}
      };
      const popupErrors=[];
      const isVerified=async candidatePage=>{
        // myCargo may open in a separate tab and render detail panels inside
        // an embedded frame. Read every accessible frame, not just its shell.
        const scan=await snapshot(candidatePage);
        const t=scan.text||'';
        const exact=matchesAwb(t,mawb.slice(4),mawb.replace(/\D/g,''));
        const details=/Flight\s+(?:schedule|details)|Shipment\s+details|Progress\s+details/i.test(t);
        return{ok:exact&&details,text:t};
      };
      let result=await isVerified(targetPage);
      // The KLM site uses window.open. If the newly opened Chrome target
      // fails at its HTTP/2 navigation, recreate that exact public AWB page
      // in a fresh tab (and, once, a clean isolated browser context). This
      // does not bypass a login, CAPTCHA, or any access restriction.
      if(!result.ok&&isOpenedExactAwb()){
        for(let attempt=0;attempt<1&&!result.ok;attempt++){
          let candidate=null;
          try{
            if(attempt===0)candidate=await page.browser().newPage();
            else{
              const context=await page.browser().createBrowserContext();
              candidate=await context.newPage();
            }
            await candidate.goto(exactOfficialUrl,{waitUntil:'domcontentloaded',timeout:15000});
            await candidate.waitForFunction(awb=>{
              const t=document.body?.innerText||'';
              return /Flight\s+(?:schedule|details)|Shipment\s+details|Progress\s+details/i.test(t)&&
                t.replace(/\D/g,'').includes(awb.replace(/\D/g,''));
            },{timeout:7500},mawb).catch(()=>{});
            result=await isVerified(candidate);
            if(result.ok){targetPage=candidate;break}
            popupErrors.push({attempt:attempt+1,page:candidate.url(),reason:'No AWB-matched shipment details'});
          }catch(e){
            popupErrors.push({attempt:attempt+1,page:candidate?.url()||'',
              reason:String(e?.message||e).slice(0,200)});
          }
          if(candidate&&candidate!==targetPage)try{await candidate.close()}catch{}
        }
      }
      let http1Browser=null;
      if(!result.ok&&isOpenedExactAwb()&&
         (targetPage.url().startsWith('chrome-error:')||
           popupErrors.some(x=>/ERR_HTTP2_PROTOCOL_ERROR|Target closed/i.test(x.reason)))){
        try{
          http1Browser=await launch({http1:true});
          const http1Page=await http1Browser.newPage();
          await http1Page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36');
          await http1Page.goto(exactOfficialUrl,{waitUntil:'domcontentloaded',timeout:17000});
          await http1Page.waitForFunction(awb=>{
            const t=document.body?.innerText||'';
            return /Flight\s+(?:schedule|details)|Shipment\s+details|Progress\s+details/i.test(t)&&
              t.replace(/\D/g,'').includes(awb.replace(/\D/g,''));
          },{timeout:6500},mawb).catch(()=>{});
          const verified=await isVerified(http1Page);
          if(verified.ok){targetPage=http1Page;result=verified}
          else popupErrors.push({attempt:'HTTP1',page:http1Page.url(),reason:'No verified KLM shipment details'});
        }catch(e){popupErrors.push({attempt:'HTTP1',reason:String(e?.message||e).slice(0,200)})}
        if(!result.ok){try{await http1Browser?.close()}catch{}http1Browser=null}
      }
      const body=result.text||'';
      const inputState=await page.evaluate(()=>{
        const input=document.querySelector('#awb,[data-mayavi-klm-awb-input="1"]');
        return{value:input?.value||'',invalid:input?.getAttribute('aria-invalid')||'',
          classes:input?.className||''};
      }).catch(()=>({}));
      const screen=await describe(targetPage);
      attempts.push({page:targetPage.url(),stage:'CHECK_STATUS_CLICKED',button:clicked.label,
        buttonTag:clicked.tag,buttonHref:clicked.href,buttonTarget:clicked.target,
        popupOpened:targetPage!==page,openedUrl:openedUrl.slice(0,260),
        popupErrors:popupErrors.slice(0,2),resultTabUrl:targetPage.url(),
        allTabUrls:latestTabs.map(p=>p.url()).slice(-5),inputState,
        hasDetails:/Flight\s+(?:schedule|details)|Shipment\s+details|Progress\s+details/i.test(body),
        bodyPreview:body.slice(0,1700),dom:{inputs:screen.inputs,buttons:screen.buttons}});
      // The shipment must be opened on this AWB's detail screen. A generic
      // homepage, even if it keeps the entered AWB in the field, is not proof.
      if(result.ok)return{ok:true,attempts,pageUrl:targetPage.url(),page:targetPage,http1Browser};
    }catch(e){attempts.push({stage:'FORM_FLOW_ERROR',page:candidate,error:String(e?.message||e).slice(0,250)})}
  }
  // Do not start additional Chromium processes for repeated AWB URL retries;
  // they previously kept the Vercel function busy until its 300s timeout.
  return{ok:false,attempts,pageUrl:page.url()};
}
export async function trackKlm(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('074-'))return{ok:false,reason:'INVALID KLM 074 MAWB'};
  const url=detailUrl(mawb);
  // Use approved AFKL's AWB-specific Cargo Tracking endpoint whenever the
  // operator has configured authorized credentials. This stays KLM-only and
  // does not depend on the Akamai-protected public website. Without approved
  // credentials, continue with public Check Status; never guess an AWB record.
  const sanctionedAvailable=Boolean(
    process.env.AFKLM_CARGO_API_TOKEN||process.env.AFKLM_CARGO_API_KEY||
    (process.env.AFKLM_CARGO_CLIENT_ID&&process.env.AFKLM_CARGO_CLIENT_SECRET)
  );
  if(sanctionedAvailable){
    const direct=await trackKlmFromOfficialLiveApi(mawb).catch(()=>null);
    if(direct?.ok&&direct.shipment?.klmLiveVerifiedAt){
      let shipment=normalizeShipmentTimesToIst({...direct.shipment,mawb,officialTracker:url});
      if(shipment.flightSchedule?.length&&shipment.arrivalIsActual!==true)
        shipment=await enrichKlmEtaFromFlight(shipment);
      return{ok:true,shipment,officialTracker:url,
        adapter:'Authorized AFKL Cargo Tracking, AWB-specific response',
        debug:{stage:'KLM_SANCTIONED_AWB_VERIFIED',
          accessMode:'approved official cargo tracking',browserSkipped:true}};
    }
  }
  // Fetch the same AWB's current PUBLIC myCargo shipment record first. This
  // is the first-party result behind Check Status, not the generic landing
  // page or an older saved Mayavi record. Reject unmatched/empty payloads.
  let publicAwbShipment=null,publicAwbStatus=0;
  let publicNetworkBlocked=false,publicOriginAttempts=[];
  try{
    const publicAwb=await fetchPublicShipment(mawb);
    publicAwbStatus=publicAwb.status||0;
    publicOriginAttempts=Array.isArray(publicAwb.debug?.attempts)
      ?publicAwb.debug.attempts:[];
    // The official myCargo origin currently resets HTTP/2 and times out on
    // HTTP/1.1 from Vercel. When ALL independently addressed KLM endpoints
    // fail at the transport level (no HTTP response at all), trying 4 more
    // Chromium pages has only produced multi-minute hangs. Report this
    // condition promptly, without claiming verified live cargo data.
    // A later refresh retries the public endpoints automatically.
    publicNetworkBlocked=publicOriginAttempts.length>=3&&
      publicOriginAttempts.every(x=>Boolean(x.error)&&!x.http);
    if(publicAwb.ok){
      const matched=parseKlmLiveJson(publicAwb.data,mawb,
        'AFKLM public AWB-specific live shipment response');
      if(matched)publicAwbShipment=normalizeShipmentTimesToIst(matched);
    }
  }catch{}
  // Direct Node fetch and Chromium use different network stacks. A transport
  // failure on the public JSON probes must not prevent trying the AWB-specific
  // browser detail page. Browser failures are handled below and never reported
  // as successful tracking.
  let browser,http1Browser;
  const network=[];
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36');
    page.on('response',async response=>{
      try{
        const url=response.url(),type=String(response.headers()['content-type']||'').toLowerCase();
        if(!/afklcargo\.com/i.test(url)||!/json/i.test(type)||!/(?:shipment|tnt-api|tracking)/i.test(url))return;
        const body=await response.text();
        if(body.length>180000||body.length<15)return;
        network.push({url,status:response.status(),body:body.slice(0,160000)});
      }catch{}
    });
    const form=await openKlmShipmentByForm(page,mawb);
    if(!form.ok){
      // Chromium may fail with ERR_HTTP2_PROTOCOL_ERROR while Node's HTTP/1.1
      // request successfully fetched this live, AWB-matched shipment. Keep
      // only evidence actually present in that current official JSON.
      if(publicAwbShipment){
        let shipment={...publicAwbShipment,mawb,officialTracker:url,
          klmLiveVerifiedAt:new Date().toISOString()};
        if(shipment.flightSchedule?.length&&!shipment.arrivalIsActual)
          shipment=await enrichKlmEtaFromFlight(shipment);
        return{ok:true,shipment,officialTracker:url,
          adapter:'KLM first-party live AWB-specific shipment endpoint',
          debug:{stage:'KLM_LIVE_PUBLIC_AWB_VERIFIED',publicAwbStatus,
            formStages:form.attempts.map(a=>a.stage)}};
      }
      return{ok:false,reason:'KLM official Check Status form did not open verifiable live AWB details; no saved or screenshot fallback used',
        officialTracker:url,debug:{stage:'KLM_CHECK_STATUS_FORM_NOT_VERIFIED',form,
          publicAwbStatus,publicAwbVerified:false}};
    }
    const detailPage=form.page||page;
    http1Browser=form.http1Browser||null;
    if(detailPage!==page)detailPage.on('response',async response=>{
      try{
        const url=response.url(),type=String(response.headers()['content-type']||'').toLowerCase();
        if(!/afklcargo\.com/i.test(url)||!/json/i.test(type)||!/(?:shipment|tnt-api|tracking)/i.test(url))return;
        const body=await response.text();
        if(body.length>14&&body.length<180000)network.push({url,status:response.status(),body:body.slice(0,160000)});
      }catch{}
    });
    // Scroll the result down so Flight Details and right-side Shipment Details
    // render. Both panels may be lazy-loaded.
    let after=await snapshot(detailPage);
    for(let pass=0;pass<6;pass++){
      await detailPage.evaluate(()=>{
        const items=[...document.querySelectorAll('h1,h2,h3,h4,h5,div,span')];
        const heading=items.find(el=>{
          const t=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
          return t.length<65&&/^(?:Shipment\s+details?|Flight\s+(?:schedule|details)|Progress\s+details)$/i.test(t);
        });
        if(heading)heading.scrollIntoView({block:'center'});
        else window.scrollBy(0,750);
      }).catch(()=>{});
      await sleep(550);
      const probe=await snapshot(detailPage);
      if(probe.text.length>after.text.length||probe.rightShipmentPanels?.length)after=probe;
      if(probe.rightShipmentPanels?.length&&/Flight\s+(?:schedule|details)|Progress\s+details/i.test(probe.text))break;
    }
    const visible=after.text||'';
    const matched=matchesAwb(visible,mawb.slice(4),mawb.replace(/\D/g,''))
      ||network.some(res=>res.status===200&&matchesAwb(res.body,mawb.slice(4),mawb.replace(/\D/g,'')));
    const detailReady=/Flight\s+(?:schedule|details)|Progress\s+details|Shipment\s+details/i.test(visible);
    const rightPanel=(after.rightShipmentPanels||[]).filter(p=>/shipment\s+details/i.test(p.text||''));
    if(!matched||!detailReady||!form.ok){
      return{ok:false,reason:'KLM official Check Status did not return AWB-matched Shipment Details',
        officialTracker:url,debug:{stage:'KLM_FORM_RETURN_NOT_AWB_MATCHED',form,matched,detailReady,
          panelCount:rightPanel.length,pageUrl:detailPage.url(),pagePreview:visible.slice(0,1800)}};
    }
    let shipment=null;
    for(const res of network){
      if(res.status!==200)continue;
      let payload;try{payload=JSON.parse(res.body)}catch{continue}
      shipment=parseKlmLiveJson(payload,mawb,'AFKLM live Track & Trace response');
      if(shipment)break;
    }
    // Read Shipment details (64 pcs / 1,900 kg) and both flight legs from
    // this AWB's current official myCargo detail page. Never reuse a user
    // screenshot, another master or a saved row as live data.
    const verifiedPage=parseKlmShipmentPageText(visible,mawb);
    if(!shipment)shipment=verifiedPage||parseShipment(visible,mawb,network,after.tables||[]);
    if(!shipment&&publicAwbShipment)shipment=publicAwbShipment;
    if(shipment)shipment=mergeFlightPanel(shipment,visible,mawb);
    const progress=await captureKlmProgressViews(detailPage);
    if(shipment)shipment=applyKlmProgressDetails(shipment,progress.list||visible,progress.station||visible);
    if(shipment&&publicAwbShipment){
      // Missing fields may be supplemented only from a separately verified,
      // same-AWB live official response; browser values win on conflict.
      for(const key of ['origin','destination','bookingDate','bookingTime','pieces',
        'bags','flightNo','flightDate','finalFlightNo','finalFlightDate','flightSchedule',
        'scheduledArrivalDate','scheduledArrivalTime','scheduledArrivalTimeZone',
        'arrivalDate','arrivalTime','arrivalTimeZone','arrivalTimeSource']){
        if(!shipment[key]&&publicAwbShipment[key])shipment[key]=publicAwbShipment[key];
      }
    }
    const verifiedWeight=weightFromRightShipmentDetails(rightPanel);
    const jsonWeight=klmOfficialWeight(mawb,'',[],[],
      network.filter(res=>res.status===200));
    // Only use the current official AWB JSON for a missing right-card weight.
    // Never reuse an older Mayavi value or infer mass from piece counts.
    const publicWeight=publicAwbShipment?.weight
      ?{weight:publicAwbShipment.weight,
        weightSource:publicAwbShipment.weightSource||'KLM current official AWB shipment JSON'}
      :{weight:'',weightSource:''};
    // On the operator's myCargo layout, kg may be shown as
    // "64 pcs, 1,900 kg" with no separate "Gross weight" label.
    const pageWeight=verifiedPage?.weight?{weight:verifiedPage.weight,
      weightSource:verifiedPage.weightSource||'KLM current Shipment details card'}:{weight:'',weightSource:''};
    const liveWeight=verifiedWeight.weight?verifiedWeight:
      jsonWeight.weight?jsonWeight:pageWeight.weight?pageWeight:publicWeight;
    if(!shipment&&liveWeight.weight){
      shipment={mawb,carrierCode:'KL',airlineName:'KLM Cargo',
        status:'TRACKING',source:'KLM public live AWB Shipment Details panel',
        officialTracker:url,arrivalIsActual:false,arrivalEstimate:false};
    }
    if(!shipment)return{ok:false,
      reason:'KLM Check Status opened but did not yield verifiable shipment fields',
      officialTracker:url,debug:{stage:'KLM_NO_VERIFIABLE_FIELDS',form,matched,detailReady,
        panelCount:rightPanel.length,pageUrl:detailPage.url(),preview:visible.slice(0,1800)}};
    // Do not carry values from saved rows or other shipments into live fields.
    shipment.weight=liveWeight.weight||'';
    shipment.masterWeight=liveWeight.weight||'';
    shipment.weightSource=liveWeight.weightSource||'';
    shipment.klmLiveVerifiedAt=new Date().toISOString();
    shipment.officialTracker=url;
    shipment.source='KLM public Track & Trace live Check Status shipment detail';
    delete shipment._parsedEvents;
    shipment=normalizeShipmentTimesToIst(shipment);
    if(shipment.flightSchedule?.length&&!shipment.arrivalIsActual)
      shipment=await enrichKlmEtaFromFlight(shipment);
    return{ok:true,shipment,officialTracker:url,adapter:'KLM live Check Status browser extraction',
      debug:{stage:'KLM_LIVE_FORM_VERIFIED',pageUrl:detailPage.url(),formStages:form.attempts.map(a=>a.stage),
        matched,detailReady,rightPanelCount:rightPanel.length,weightFound:Boolean(liveWeight.weight),
        weightSource:liveWeight.weightSource,
        flightScheduleCount:shipment.flightSchedule?.length||0,
        networkApiCount:network.length,
        progressStages:progress.stages,
        listActualMilestones:shipment.klmListEvents?.length||0,
        stationMilestones:shipment.klmStationEvents?.length||0}};
  }catch(e){
    return{ok:false,reason:'KLM official Check Status browser error: '+String(e?.message||e),
      officialTracker:url,debug:{stage:'KLM_BROWSER_ERROR'}};
  }finally{try{await browser?.close()}catch{}try{await http1Browser?.close()}catch{}}
}
