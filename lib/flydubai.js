// Flydubai FZ/141 dedicated official Cargo -> Track Shipment -> Doc No -> Search -> Tracking Details reader.
// Only trust confirmed shipment detail results; never bypass an airline challenge.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

export const FLYDUBAI_TRACKER='https://www.flydubai.com/en/information/cargo/';
const FLYDUBAI_PORTAL='https://prdonofz.accelya.io/app/offerandorder/#/home/find-offer';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digits=s=>String(s||'').replace(/\D/g,'');
const pad=n=>String(n).padStart(2,'0');
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
function dateOf(v=''){
  let m=String(v).match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(m)return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
  m=String(v).match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if(m)return m[3]+'-'+pad(m[2])+'-'+pad(m[1]);
  m=String(v).toUpperCase().match(/\b(\d{1,2})[\s-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,-]+(20\d{2})\b/);
  return m?m[3]+'-'+MONTHS[m[2]]+'-'+pad(m[1]):'';
}
function timeOf(v=''){
  const s=String(v).toUpperCase();
  let m=s.match(/\b(\d{1,2}):([0-5]\d)\s*([AP]M)\b/);
  if(m){let h=Number(m[1])%12+(m[3]==='PM'?12:0);return pad(h)+':'+m[2];}
  m=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
  return m?pad(m[1])+':'+m[2]:'';
}
function value(s,re){return (String(s).match(re)||[])[1]||'';}
function airport(s){return /^[A-Z]{3}$/.test(String(s||''))?String(s):'';}
function movementRows(rows=[]){
  const movements=[];
  for(const row of rows){
    const r=clean(row),upper=r.toUpperCase();
    const label=value(upper,/\b(ARRIVED|ARR|RCF|RECEIVED FROM FLIGHT|DEPARTED|DEP|OFFLOADED|OFLD|BOOKED|RCS)\b/);
    if(!label)continue;
    const flight=value(upper,/\b(FZ\s*[- ]?\d{2,4}[A-Z]?)\b/).replace(/[\s-]/g,'');
    const airports=[...upper.matchAll(/\b([A-Z]{3})\b/g)].map(x=>x[1]).filter(x=>!['FOW','RCS','DEP','ARR','RCF','AWB','ETA','ETD','ATA','ATD','FZD','PCS','KGS','FRT','FZC','UTC','IST'].includes(x));
    const from=airport(value(upper,/\b(?:FROM|ORIGIN|DEP(?:ARTURE)?(?:\s+STATION)?)\s*[:| -]+\s*([A-Z]{3})\b/));
    const to=airport(value(upper,/\b(?:TO|DESTINATION|ARRIVAL(?:\s+STATION)?|AT)\s*[:| -]+\s*([A-Z]{3})\b/));
    const date=dateOf(r),time=timeOf(r);
    movements.push({label,flight,from,to,airports,date,time,raw:r});
  }
  return movements;
}

/**
 * Accelya's official Tracking Details is a React/div timeline, not an HTML
 * table. Each movement is rendered as multiple text lines. Parse the AWB-
 * matched document, hub/final legs and destination ETA without borrowing
 * flight/quantity numbers from unrelated search or marketing content.
 */

/** Extract AWB-matched Show Details gross kg and deduplicated RCF part weights.
 * RCF at a transit hub is NOT proof of final arrival. */
function readFlydubaiDetailedQuantities(raw='',masterPieces=0){
  const lines=String(raw).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const whole=lines.join('\n');
  const masterMatch=whole.match(/\b(?:Total\s+(?:Pieces|Pcs|Bags)|Master\s+(?:Pieces|Bags)|No\.?\s*of\s+Bags)\s*[:|=\-]?\s*(\d{1,6})\b/i);
  const masterFromDetails=Number(masterMatch?.[1]||0);
  const grossPatterns=[
    /\b(?:Total\s+Gross\s+Weight|Gross\s+Weight|Shipment\s+Weight|Total\s+Weight)\s*(?:\(\s*(?:KG|KGS)\s*\))?\s*[:|=\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:KG|KGS)\b/i,
    /\b(?:Total\s+Gross\s+Weight|Gross\s+Weight|Shipment\s+Weight|Total\s+Weight)\s*\(\s*(?:KG|KGS)\s*\)\s*[:|=\-]?\s*([\d,]+(?:\.\d+)?)\b/i,
    /\b(?:Total\s+Gross\s+Weight|Gross\s+Weight|Shipment\s+Weight|Total\s+Weight)\s*[:|=\-]?\s*([\d,]+(?:\.\d+)?)\b/i
  ];
  let gross='';
  for(const pattern of grossPatterns){
    const found=whole.match(pattern);
    if(found&&Number(found[1].replace(/,/g,''))>0){gross=found[1].replace(/,/g,'');break;}
  }
  // Some versions of Show Details label the field just "Weight".
  // Treat it as master kg only when adjacent to a labelled master bag count.
  if(!gross&&masterMatch&&masterFromDetails>0){
    const start=Math.max(0,masterMatch.index-180);
    const around=whole.slice(start,masterMatch.index+masterMatch[0].length+220);
    const labelled=around.match(/\bWeight\s*(?:\(\s*(?:KG|KGS)\s*\))?\s*[:|=\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:KG|KGS)\b/i)
      ||around.match(/\bWeight\s*\(\s*(?:KG|KGS)\s*\)\s*[:|=\-]?\s*([\d,]+(?:\.\d+)?)\b/i);
    if(labelled&&Number(labelled[1].replace(/,/g,''))>0)gross=labelled[1].replace(/,/g,'');
  }
  const parts=[],seen=new Set();
  const isRcf=s=>/\bRCF\b|Received\s+at\s+[A-Z]{3}\s+from\s+Flight/i.test(s);
  const isEvent=s=>/\bRCF\b|Received\s+at\s+[A-Z]{3}\s+from\s+Flight|Departed\s+to|Booked\s+on\s+Flight|Manifested\s+on\s+Flight|Ready\s+for\s+Carriage|Expected\s+to\s+arrive/i.test(s);
  for(let i=0;i<lines.length;i++){
    if(!isRcf(lines[i]))continue;
    let j=i+1;
    while(j<lines.length&&j<i+9&&!isEvent(lines[j]))j++;
    const section=lines.slice(i,j).join(' ');
    const piecesMatch=section.match(/\b(\d{1,6})\s*(?:Pieces|Pcs|Bags)\b/i)
      ||section.match(/\b(?:Pieces|Pcs|Bags)\s*[:|=\-]?\s*(\d{1,6})\b/i);
    const weightMatch=section.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:KG|KGS)\b/i)
      ||section.match(/\b(?:Gross\s+)?Weight\s*[:|=\-]?\s*(\d[\d,]*(?:\.\d+)?)\b/i);
    if(!piecesMatch||!weightMatch)continue;
    const pieces=Number(piecesMatch[1]),kg=Number(weightMatch[1].replace(/,/g,''));
    if(!Number.isInteger(pieces)||pieces<=0||!Number.isFinite(kg)||kg<=0)continue;
    const station=(section.match(/\bReceived\s+at\s+([A-Z]{3})\b/i)||[])[1]||'';
    const flight=(section.match(/\b(FZ[-\s]?\d{2,4}[A-Z]?)\b/i)||[])[1]?.replace(/[\s-]/g,'').toUpperCase()||'';
    const date=dateOf(section);
    const key=[station,flight,date,pieces,kg].join('|');
    if(seen.has(key))continue;
    seen.add(key);
    parts.push({event:'RCF',station,flightNo:flight,date,pieces:String(pieces),weight:String(kg),source:'Flydubai AWB-matched RCF'});
  }
  const receivedPieces=parts.reduce((s,p)=>s+Number(p.pieces),0);
  const receivedWeight=parts.reduce((s,p)=>s+Number(p.weight),0);
  const expected=masterFromDetails||Number(masterPieces)||0;
  const complete=Boolean(expected>0&&receivedPieces===expected&&parts.length>0);
  const weight=gross||(complete?String(Number(receivedWeight.toFixed(3))):'');
  const bookingLabel=whole.match(/\b(?:Original\s+Booking\s+Date|Shipment\s+Booking\s+Date|AWB\s+Booking\s+Date|Booking\s+Date|Date\s+of\s+Booking)\s*[:|=\-]?\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}|20\d{2}-\d{1,2}-\d{1,2})/i);
  return{
    weight,weightSource:gross?'Flydubai official Show Details gross weight':complete?'Flydubai RCF complete master parts sum':'',
    masterPieces:expected,rcfParts:parts,rcfReceivedPieces:receivedPieces?String(receivedPieces):'',
    rcfReceivedWeight:receivedPieces?String(Number(receivedWeight.toFixed(3))):'',rcfMasterComplete:complete,
    bookingDate:dateOf(bookingLabel?.[1]||'')
  };
}

function parseAccelyaTimeline(text='',mawb=''){
  const raw=String(text||''),normalized=normalizeMawb(mawb);
  const doc=raw.match(/\bDoc\.?\s*No\.?\s*:\s*(141[-\s]?\d{8})\b/i);
  if(!doc||digits(doc[1])!==digits(normalized)||!/Tracking\s+Details/i.test(raw))
    return null;
  if(!/\bMilestones\b|\bLatest status\b/i.test(raw))return null;

  const routeAirports=[...raw.matchAll(/\(([A-Z]{3})\)/g)].map(m=>m[1]);
  const origin=airport(routeAirports[0]);
  const destination=airport(routeAirports[1]);
  if(!origin||!destination||origin===destination)return null;

  // Master pieces are repeatedly reported as '78 Pieces' in the tracking
  // timeline, whereas arrived partial events can show '16 Pieces'/'62 Pieces'.
  const pieceEvents=[...raw.matchAll(/\b(\d{1,6})\s+(?:Pieces|Pcs)\b/gi)].map(m=>Number(m[1]))
    .filter(n=>Number.isInteger(n)&&n>0);
  const totalPieces=pieceEvents.length?Math.max(...pieceEvents):0;

  const completeLegs=[...raw.matchAll(/\b(FZ[-\s]?\d{2,4}[A-Z]?)\b[^\n]{0,100}?\b([A-Z]{3})\s*[-–]\s*([A-Z]{3})\b/gi)]
    .map(m=>({flight:m[1].toUpperCase().replace(/[\s-]/g,''),from:m[2].toUpperCase(),
      to:m[3].toUpperCase(),context:clean(m[0])}));
  const lastLeg=completeLegs.find(l=>l.to===destination)
    ||completeLegs.find(l=>l.from!==origin)||null;
  const firstLeg=completeLegs.find(l=>l.from===origin)||null;
  const flightNo=lastLeg?.flight||'';
  const movementCount=(raw.match(/\b(?:Received at|Departed to|Booked on Flight|Ready for Carriage|Manifested on Flight)\b/gi)||[]).length;

  // Destination ETA is explicitly labelled 'Expected' and is never an
  // actual arrival event. Use the destination station's local clock.
  const expected=raw.match(/\bExpected\s+to\s+arrive\s+at\s+([A-Z]{3})\s+on\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*,?\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})\s+(\d{1,2}:\d{2})(?:\s*([AP]M))?/i);
  const matchingExpected=expected&&expected[1].toUpperCase()===destination?expected:null;

  // A final-destination RCF/ARR event proves actual cargo arrival; landing
  // at an intermediate hub does NOT. Do not mark DEL arrived from DWC RCF.
  const finalReceivedRx=new RegExp('\\b(?:Received|Arrived)\\s+at\\s+'+destination+'\\b','i');
  const actualAtFinal=finalReceivedRx.test(raw);
  const receivedAtHub=completeLegs.some(l=>l.to!==destination&&new RegExp(
    'Received at\\s+'+l.to+'\\s+from Flight\\s+No\\.?\\s*'+l.flight.replace(/^FZ/,'FZ[-\\s]?'),'i').test(raw));

  if(!movementCount||!totalPieces||!flightNo){
    // A URL alone, empty Accelya shell, or AWB-prefilled Search form is
    // never enough to claim a live shipment update.
    return null;
  }
  const detailed=readFlydubaiDetailedQuantities(raw,totalPieces);
  const weight=detailed.weight;
  const firstDeparture=firstLeg?raw.match(new RegExp(
    '\\bDeparted\\s+to\\s+'+firstLeg.to+'\\s+on\\s+Flight\\s+'+
    firstLeg.flight.replace(/^FZ/,'FZ[-\\s]?')+'\\s*,?\\s*(\\d{1,2}\\s+[A-Za-z]{3,9}\\s+20\\d{2})','i')):null;
  const actualDate=actualAtFinal?'':''; // no actual timestamp without a matched dated final event
  const arrivalDate=matchingExpected?dateOf(matchingExpected[2]):actualDate;
  const arrivalTime=matchingExpected?timeOf(matchingExpected[3]+' '+(matchingExpected[4]||'')):'';
  const status=actualAtFinal?'ARRIVED':receivedAtHub?'IN TRANSIT':'BOOKED';

  return {mawb:normalized,carrierCode:'FZ',airlineName:'flydubai Cargo',
    origin,destination,bags:String(totalPieces),pieces:String(totalPieces),
    masterPieces:String(detailed.masterPieces||totalPieces),weight,masterWeight:weight,
    weightSource:detailed.weightSource,bookingDate:detailed.bookingDate,
    rcfParts:detailed.rcfParts,rcfReceivedPieces:detailed.rcfReceivedPieces,
    rcfReceivedWeight:detailed.rcfReceivedWeight,rcfMasterComplete:detailed.rcfMasterComplete,
    flightNo,departureFlightNo:firstLeg?.flight||'',departureOrigin:origin,
    departureDestination:firstLeg?.to||'',departureIsActual:Boolean(firstDeparture),
    departureDate:firstDeparture?dateOf(firstDeparture[1]):'',
    arrivalDate,arrivalTime,arrivalIsActual:false,
    arrivalTimeZone:'LOCAL',departureTimeZone:'LOCAL',
    status:actualAtFinal&&actualDate?'ARRIVED':status==='ARRIVED'?'IN TRANSIT':status,
    lastKnownHub:receivedAtHub?completeLegs.find(l=>l.to!==destination)?.to||'':'',
    source:'flydubai Cargo Accelya official AWB-matched Tracking Details timeline',
    officialTracker:FLYDUBAI_TRACKER,
    flydubaiLiveVerifiedAt:new Date().toISOString(),
    flydubaiEvidence:{matchedMawb:true,movementCount,finalArrivalConfirmed:false,
      timelineRead:true,expectedDestination:matchingExpected?.[1]||'',
      routeLegs:completeLegs.length}
  };
}

export function parseFlydubaiText(text='',rows=[],mawb=''){
  const normalized=normalizeMawb(mawb),all=digits(normalized),serial=all.slice(3);
  const accelya=parseAccelyaTimeline(text,mawb);
  if(accelya)return accelya;
  // Never fall through to broad page-text parsing on an Accelya details page;
  // a matching document input plus unrelated metrics could fabricate results.
  if(/\bDoc\.?\s*No\.?\s*:/i.test(String(text))&&/Tracking\s+Details/i.test(String(text)))return null;
  if(!normalized.startsWith('141-'))return null;
  const raw=String(text||''),flat=clean(raw),upper=flat.toUpperCase();
  // A pre-filled form or unrelated page must not count as a live response.
  const explicit=new RegExp('(?:^|\\D)141[-\\s]?'+serial+'(?:\\D|$)').test(flat)
    ||new RegExp('(?:AWB|AIR\\s*WAYBILL|SHIPMENT)[\\s:#-]{0,20}'+serial+'\\b','i').test(flat);
  if(!explicit||/\b(?:CAPTCHA|VERIFY YOU ARE HUMAN|ACCESS DENIED|CLOUDFLARE)\b/i.test(flat))return null;
  const origin=airport(value(upper,/\b(?:ORIGIN|FROM\s+STATION|DEPARTURE\s+STATION)\s*[:| -]+\s*([A-Z]{3})\b/))
    ||airport(value(upper,/\b([A-Z]{3})\s*(?:-|->|→)\s*[A-Z]{3}\b/));
  const destination=airport(value(upper,/\b(?:DESTINATION|TO\s+STATION|ARRIVAL\s+STATION)\s*[:| -]+\s*([A-Z]{3})\b/))
    ||airport(value(upper,/\b[A-Z]{3}\s*(?:-|->|→)\s*([A-Z]{3})\b/));
  const pieces=value(flat,/\b(?:TOTAL\s+PIECES|PIECES|PCS|BAGS|NO\.?\s*OF\s*PIECES)\s*[:|#-]?\s*(\d{1,6})\b/i)
    ||value(flat,/\b(\d{1,6})\s*(?:PCS|PIECES|BAGS)\b/i);
  const weight=value(flat,/\b(?:GROSS\s*WEIGHT|TOTAL\s*WEIGHT|WEIGHT)\s*[:|#-]?\s*([\d,]+(?:\.\d+)?)\s*(?:KG|KGS)?\b/i).replace(/,/g,'');
  const movements=movementRows(rows);
  const dated=movements.filter(x=>x.date&&x.time);
  const actualFinal=destination?dated.filter(x=>/^(ARR|ARRIVED|RCF|RECEIVED FROM FLIGHT)$/.test(x.label)&&
    (x.to===destination||new RegExp('(?:\\bAT\\s+|\\|\\s*)'+destination+'\\b').test(x.raw.toUpperCase()))).at(-1):null;
  const expectedRows=dated.filter(x=>x.flight&&/ETA|EXPECTED|SCHEDULED/i.test(x.raw));
  const matchingExpected=expectedRows.filter(x=>!destination||x.to===destination||new RegExp('\\b'+destination+'\\b').test(x.raw)).at(-1);
  // Do not use an intermediate DXB arrival as the destination arrival.
  const departureRows=dated.filter(x=>/^(DEP|DEPARTED)$/.test(x.label));
  const firstDeparture=departureRows.find(x=>!origin||x.from===origin||new RegExp('\\b'+origin+'\\b').test(x.raw))||null;
  const latest=movements.at(-1);
  const offloaded=movements.some(x=>/OFFLOAD|OFLD/.test(x.label));
  const hasMovement=movements.length>0;
  // A Search & Track form may echo the entered MAWB alongside unrelated
  // marketing/cargo statistics. A matching document number is not proof that
  // a live shipment record has been opened. In particular, do not populate
  // bags/flight from general page text when gross weight is not verified.
  const verifiedHeader=Boolean(origin&&destination&&pieces&&weight);
  const verifiedMovement=Boolean(hasMovement&&movements.some(x=>x.flight&&x.date&&x.time)
    &&(origin||destination)&&(pieces||weight));
  if(!verifiedHeader&&!verifiedMovement)return null;
  const flightNo=actualFinal?.flight||matchingExpected?.flight||dated.filter(x=>x.flight).at(-1)?.flight
    ||value(upper,/\b(FZ\s*[- ]?\d{2,4}[A-Z]?)\b/).replace(/[\s-]/g,'');
  const bookingLabel=raw.match(/(?:BOOKED|BOOKING\s+DATE|RCS|ACCEPTED)[^\n]{0,100}/i)?.[0]||'';
  const status=actualFinal?'ARRIVED':offloaded?'DELAYED':departureRows.length?'IN TRANSIT':hasMovement?'BOOKED':'TRACKING';
  const candidate=actualFinal||matchingExpected;
  return {mawb:normalized,carrierCode:'FZ',airlineName:'flydubai Cargo',
    origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate:dateOf(bookingLabel),
    departureDate:firstDeparture?.date||'',departureTime:firstDeparture?.time||'',
    departureFlightNo:firstDeparture?.flight||'',departureOrigin:origin,
    departureDestination:firstDeparture?.to||'',departureIsActual:Boolean(firstDeparture),
    arrivalDate:candidate?.date||'',arrivalTime:candidate?.time||'',arrivalIsActual:Boolean(actualFinal),
    arrivalTimeZone:'LOCAL',departureTimeZone:'LOCAL',status,
    source:'flydubai official Accelya Tracking Details AWB-matched live result',
    officialTracker:FLYDUBAI_TRACKER,
    flydubaiLiveVerifiedAt:new Date().toISOString(),
    flydubaiEvidence:{matchedMawb:true,movementCount:movements.length,finalArrivalConfirmed:Boolean(actualFinal)}
  };
}
async function pageContents(page){
  const texts=[],rows=[];
  for(const frame of page.frames()){
    try{
      const v=await frame.evaluate(()=>({
        text:document.body?.innerText||'',
        rows:[...document.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(c=>c.innerText?.trim()||'').join(' | ')).filter(Boolean).slice(0,350)
      }));
      if(v.text)texts.push(v.text);
      if(v.rows)rows.push(...v.rows);
    }catch{}
  }
  return{text:texts.join('\n'),rows};
}

function pageHasChallenge(s=''){
  return /verify you are human|captcha|access denied|security challenge|cloudflare|bot protection/i.test(String(s));
}
async function clickText(page,expression){
  for(const frame of page.frames()){
    try{
      const done=await frame.evaluate(pattern=>{
        const rx=new RegExp(pattern,'i');
        const nodes=[...document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"],[role="tab"],[tabindex]')];
        const choice=nodes.find(e=>{
          const label=String(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
          return label.length<100&&rx.test(label)&&!e.disabled;
        });
        if(!choice)return false;
        choice.scrollIntoView({block:'center',inline:'nearest'});
        choice.click();
        return true;
      },expression.source);
      if(done)return true;
    }catch{}
  }
  return false;
}

async function expandAccelyaDetails(page){
  // The official portal may have one AWB-level Show Details and multiple
  // individual RCF disclosures. Expand each visible collapsed panel.
  let count=0;
  for(const frame of page.frames()){
    const seen=new Set();
    for(let tries=0;tries<12;tries++){
      try{
        const candidates=await frame.$$('button,a,summary,[role="button"],span,div,p');
        let next=null,key='';
        for(const el of candidates){
          const meta=await el.evaluate(e=>{
            const label=String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
            const rect=e.getBoundingClientRect(),style=getComputedStyle(e);
            return {label,visible:rect.width>4&&rect.height>4&&style.display!=='none'&&style.visibility!=='hidden',
              position:Math.round(rect.top)+'|'+Math.round(rect.left)};
          }).catch(()=>null);
          if(!meta?.visible||!/^(?:show|view)\s+(?:shipment\s+)?details$/i.test(meta.label))continue;
          const candidateKey=meta.position+'|'+meta.label;
          if(seen.has(candidateKey))continue;
          key=candidateKey;next=el;break;
        }
        if(!next)break;
        seen.add(key);
        await next.click({delay:30});
        count++;
        await sleep(350);
      }catch{break;}
    }
  }
  return count>0;
}
async function inspectShowDetailsControls(page){
  // Diagnostic: labels and element types only, no customer values.
  const frames=[];
  for(const frame of page.frames()){
    try{
      const detail=await frame.evaluate(()=>{
        const matches=[...document.querySelectorAll('a,button,[role="button"],summary,span,div,p,[aria-label],[title]')]
          .map(e=>({e,label:String(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim()}))
          .filter(x=>x.label.length<75 && /(?:show|view|hide|expand|more|shipment)\s*(?:all\s*)?details|details\s*(?:show|more)/i.test(x.label));
        const controls=matches.slice(0,15).map(({e,label})=>{
          const rect=e.getBoundingClientRect(),style=getComputedStyle(e);
          return{label,tag:e.tagName,role:e.getAttribute('role')||'',
            aria:e.getAttribute('aria-expanded')||'',
            display:style.display,visibility:style.visibility,
            width:Math.round(rect.width),height:Math.round(rect.height),
            textOnly:e.childElementCount===0};
        });
        const snippets=String(document.body?.innerText||'').split(/\n/).filter(x=>/show|details|weight|pieces/i.test(x)).slice(0,15)
          .map(x=>x.replace(/\d{3}[-\s]?\d{8}/g,'[AWB]').slice(0,105));
        return{matches:controls,snippets};
      });
      frames.push({frameUrl:frame.url().split('?')[0].slice(0,85),...detail});
    }catch{}
  }
  return frames.slice(0,5);
}

async function cargoPortal(browser,page,mawb){
  // Official Accelya deep link from the airline's Search & Track application
  // and operator screenshot. Its query supplies the complete 141 MAWB.
  const docUrl='https://prdonofz.accelya.io/app/offerandorder/#/shipments/list?type=D&values='
    +encodeURIComponent(digits(mawb));
  try{
    await page.goto(docUrl,{waitUntil:'domcontentloaded',timeout:27000});
    await sleep(2400);
    return{page,homepageTrackClicked:false,entryPoint:'ACCELYA_DOCUMENT_ROUTE'};
  }catch(err){
    // Airline's public Cargo page remains a fallback when the direct route
    // is temporarily unavailable or its link has changed.
    await page.goto(FLYDUBAI_TRACKER,{waitUntil:'domcontentloaded',timeout:28000});
    await sleep(1200);
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)).catch(()=>{});
    const clicked=await clickText(page,/^track\s+(?:your\s+)?shipment$/i);
    await sleep(1700);
    const pages=await browser.pages();
    const portal=pages.find(p=>/accelya\.io|mercator\.com/.test(p.url()))||
      (pages.length>1?pages.at(-1):page);
    if(!/accelya\.io/.test(portal.url())){
      await portal.goto(FLYDUBAI_PORTAL,{waitUntil:'domcontentloaded',timeout:28000});
    }
    await sleep(1400);
    return{page:portal,homepageTrackClicked:clicked,entryPoint:'FLYDUBAI_CARGO_FALLBACK'};
  }
}
async function publicFormDiagnostics(page){
  // Only UI field metadata; never collect customer input or credentials.
  const frames=[];
  for(const frame of page.frames()){
    try{
      const m=await frame.evaluate(()=>({
        inputs:[...document.querySelectorAll('input,textarea,[role="textbox"]')].slice(0,24).map(e=>({
          name:String(e.name||''),id:String(e.id||''),placeholder:String(e.getAttribute('placeholder')||''),
          label:String(e.getAttribute('aria-label')||''),type:String(e.type||e.getAttribute('role')||''),
          visible:e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0
        })),
        actions:[...document.querySelectorAll('a,button,[role="button"],[role="tab"]')]
          .map(e=>String(e.innerText||e.getAttribute('aria-label')||'').trim())
          .filter(v=>v&&v.length<100).slice(0,40),
        headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText).slice(0,9)
      }));
      frames.push({...m,url:frame.url().split('?')[0].slice(0,170)});
    }catch{}
  }
  return{portalUrl:page.url().replace(/values=[^&]+/g,'values=REDACTED').slice(0,260),frames:frames.slice(0,5)};
}
async function goToTrackingSearch(page,mawb){
  const actions=[];
  for(const pattern of [
    /^search\s*(?:&|and)\s*track$/i,
    /^track(?:\s+your)?\s+shipment$/i,
    /^shipment(?:s)?\s+tracking$/i,
    /^tracking$/i
  ]){
    if(await clickText(page,pattern)){actions.push(pattern.source);await sleep(1000);break;}
  }
  return actions;
}
async function fillDocNumber(page,mawb){
  const awb=digits(mawb),serial=awb.slice(3);
  for(const frame of page.frames()){
    try{
      const fields=await frame.$$('input:not([type="hidden"]),textarea');
      const inputs=[];
      for(const el of fields){
        const info=await el.evaluate(e=>{
          const r=e.getBoundingClientRect(),label=String(
            e.labels?.[0]?.innerText||e.closest('label')?.innerText||'');
          return {visible:r.width>5&&r.height>5&&!e.disabled&&!e.readOnly,
            desc:[e.name,e.id,e.placeholder,e.getAttribute('aria-label'),
              e.getAttribute('formcontrolname'),label,
              e.parentElement?.parentElement?.innerText?.slice(0,110)].join(' ').toLowerCase(),
            max:e.maxLength,value:e.value||''};
        }).catch(()=>null);
        if(!info?.visible)continue;
        const score=/doc\s*\.?\s*no|document\s*(number|no)/i.test(info.desc)?30:
          /awb|air\s*waybill/i.test(info.desc)?25:/tracking\s*number|shipment\s*number/i.test(info.desc)?18:
          /document/i.test(info.desc)?12:info.max===11?5:info.max===8?3:0;
        if(score)inputs.push({el,...info,score});
      }
      inputs.sort((a,b)=>b.score-a.score);
      if(!inputs.length)continue;
      const target=inputs[0];
      const prefix=inputs.find(x=>x!==target&&(/prefix|airline code/i.test(x.desc)||x.max===3));
      const value=target.max===8?serial:awb;
      if(prefix){
        await prefix.el.click({clickCount:3});
        await prefix.el.press('Backspace');
        await prefix.el.type('141',{delay:25});
      }
      await target.el.click({clickCount:3});
      await target.el.press('Backspace');
      await target.el.type(value,{delay:25});
      await target.el.press('Tab');
      const entered=await target.el.evaluate(e=>String(e.value||'')).catch(()=>'');
      if(digits(entered)!==value)continue;
      return{ok:true,value,field:target.desc.slice(0,100)};
    }catch{}
  }
  return{ok:false,reason:'FLYDUBAI_DOC_NO_NOT_FOUND'};
}
export async function trackFlydubai(value){
  const mawb=normalizeMawb(value);
  if(!mawb.startsWith('141-'))
    return{ok:false,reason:'FLYDUBAI_PREFIX_MUST_BE_141',officialTracker:FLYDUBAI_TRACKER};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
      executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:1440,height:1000}});
    const landing=await browser.newPage();
    await landing.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36');
    const {page,homepageTrackClicked,entryPoint}=await cargoPortal(browser,landing,mawb);
    if(pageHasChallenge((await pageContents(page)).text))
      return{ok:false,reason:'FLYDUBAI_SITE_REQUIRES_MANUAL_VERIFICATION',
        officialTracker:FLYDUBAI_TRACKER,debug:{stage:'CHALLENGE'}};
    const navigation=await goToTrackingSearch(page,mawb);
    let doc=await fillDocNumber(page,mawb);
    for(let retry=0;retry<3&&!doc.ok;retry++){
      await sleep(1100);
      doc=await fillDocNumber(page,mawb);
    }
    if(!doc.ok){
      // Official Accelya document route; alternative navigation to the same
      // public Search & Track screen, not an independent tracking provider.
      const route='https://prdonofz.accelya.io/app/offerandorder/#/shipments/list?type=D&values='+encodeURIComponent(digits(mawb));
      try{await page.goto(route,{waitUntil:'domcontentloaded',timeout:22000});
        await sleep(1800);navigation.push('DOCUMENT_ROUTE');}catch(e){navigation.push('DOCUMENT_ROUTE_FAILED:'+String(e?.message||e).slice(0,90));}
      doc=await fillDocNumber(page,mawb);
    }
    if(!doc.ok){
      const diag=await publicFormDiagnostics(page);
      const action=diag.frames.some(f=>f.actions?.some(v=>/tracking\s+details/i.test(v)));
      if(!action)return{ok:false,reason:doc.reason,officialTracker:FLYDUBAI_TRACKER,
        debug:{stage:'DOC_NO_NOT_FOUND',homepageTrackClicked,entryPoint,navigation,...diag}};
    }
    const searched=doc.ok?await clickText(page,/^search$/i):false;
    if(doc.ok&&!searched){
      for(const frame of page.frames()){
        const input=await frame.$('input');
        if(input){await input.press('Enter').catch(()=>{});break;}
      }
    }
    let detailsClicked=false;
    for(let i=0;i<10;i++){
      await sleep(i===0?1600:950);
      const snapshot=await pageContents(page);
      if(pageHasChallenge(snapshot.text))
        return{ok:false,reason:'FLYDUBAI_SITE_REQUIRES_MANUAL_VERIFICATION',
          officialTracker:FLYDUBAI_TRACKER,debug:{stage:'CHALLENGE'}};
      if(/no\s+(?:records?|shipments?|results?)|document\s+not\s+found|invalid\s+document/i.test(snapshot.text))
        return{ok:false,reason:'FLYDUBAI_AWB_NOT_FOUND',officialTracker:FLYDUBAI_TRACKER,
          debug:{stage:'SEARCH_NO_RESULTS'}};
      if(await clickText(page,/\btracking\s+details\b/i)){detailsClicked=true;break;}
    }
    if(!detailsClicked)
      return{ok:false,reason:'FLYDUBAI_TRACKING_DETAILS_NOT_OPEN',
        officialTracker:FLYDUBAI_TRACKER,debug:{stage:'DETAILS_NOT_OPEN',homepageTrackClicked,navigation,...await publicFormDiagnostics(page)}};
    // The Accelya tracking tab has a separate "Show Details" disclosure that
    // can reveal weights and shipment quantities. Expand it before extraction.
    const extraDetailsClicked=await expandAccelyaDetails(page);
    if(extraDetailsClicked)await sleep(650);
    for(let i=0;i<10;i++){
      await sleep(i===0?1500:700);
      const result=await pageContents(page);
      if(pageHasChallenge(result.text))
        return{ok:false,reason:'FLYDUBAI_SITE_REQUIRES_MANUAL_VERIFICATION',
          officialTracker:FLYDUBAI_TRACKER,debug:{stage:'CHALLENGE'}};
      const shipment=parseFlydubaiText(result.text,result.rows,mawb);
      if(shipment){
        return{ok:true,shipment,officialTracker:FLYDUBAI_TRACKER,
          debug:{stage:'TRACKING_DETAILS_VERIFIED',homepageTrackClicked,entryPoint,
            docNoEntered:doc.value||'',extraDetailsClicked,movementCount:shipment.flydubaiEvidence.movementCount,
          showDetailsProbe:await inspectShowDetailsControls(page)}};
      }
    }
    return{ok:false,reason:'FLYDUBAI_NO_VERIFIED_AWB_DETAILS',
      officialTracker:FLYDUBAI_TRACKER,
      debug:{stage:'NO_VERIFIED_DETAILS',entryPoint,navigation,
        ...await publicFormDiagnostics(page)}};
  }catch(err){
    return{ok:false,reason:'FLYDUBAI_TRACKING_FAILED: '+String(err?.message||err).slice(0,180),
      officialTracker:FLYDUBAI_TRACKER,debug:{stage:'OFFICIAL_UNAVAILABLE'}};
  }finally{if(browser)await browser.close().catch(()=>{});}
}
