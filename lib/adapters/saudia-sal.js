import fs from 'node:fs';
import { normalizeMawb, airlineForMawb } from '../airlines.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
const num=v=>{const m=String(v||'').replace(/,/g,'').match(/\d+(?:\.\d+)?/);return m?Number(m[0]):0};
const codeOf=s=>{const m=String(s||'').toUpperCase().match(/(?:^|\W)(RCS|MAN|FOW|DIS|DEP|ARR|FIW|RCF)(?:$|\W)/);return m?m[1]:''};
const stationOf=s=>{const a=[...String(s||'').toUpperCase().matchAll(/\b([A-Z]{3})\b/g)].map(x=>x[1]).filter(x=>!['RCS','MAN','FOW','DIS','DEP','ARR','FIW','RCF','AWB','SAL','SV'].includes(x));return a.at(-1)||''};
const flightOf=s=>{const m=String(s||'').toUpperCase().match(/\bSV\s*[- ]?(\d{2,4})\b/);return m?`SV${m[1]}`:''};
const dateOf=s=>{const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};let m=String(s||'').toUpperCase().match(/\b(\d{1,2})\s*([A-Z]{3})\s*(\d{2,4})\b/);if(m){let y=m[3];if(y.length===2)y=`20${y}`;return `${y}-${months[m[2]]||'01'}-${String(m[1]).padStart(2,'0')}`;}m=String(s||'').match(/\b(\d{4})-(\d{2})-(\d{2})\b/);return m?`${m[1]}-${m[2]}-${m[3]}`:''};
const timeOf=s=>{const m=String(s||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${String(m[1]).padStart(2,'0')}:${m[2]}`:''};

async function browserConfig(){for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean))if(fs.existsSync(p))return{executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};const mod=await import('@sparticuz/chromium');const c=mod.default||mod;return{executablePath:await c.executablePath(),args:c.args};}

function flatten(v,out=[],depth=0){if(depth>12||v==null)return out;if(Array.isArray(v)){v.forEach(x=>flatten(x,out,depth+1));return out;}if(typeof v==='object'){const keys=Object.keys(v);const joined=keys.map(k=>`${k}:${typeof v[k]==='object'?'':v[k]}`).join(' ');if(codeOf(joined))out.push(v);Object.values(v).forEach(x=>flatten(x,out,depth+1));}return out;}
function field(o,rx){for(const [k,v] of Object.entries(o||{}))if(rx.test(k)&&v!=null&&typeof v!=='object')return String(v);return'';}
function fromJson(raw){let j;try{j=JSON.parse(raw)}catch{return[]}return flatten(j).map((o,i)=>{const all=Object.entries(o).filter(([,v])=>typeof v!=='object').map(([k,v])=>`${k} ${v}`).join(' ');const code=codeOf(field(o,/eventCode|milestoneCode|statusCode|code/i)||all);if(!code)return null;return{code,station:stationOf(field(o,/station|airport|location|origin|destination/i)||all),pieces:num(field(o,/pieces|pieceCount|pcs|quantity/i)),weight:num(field(o,/weight|grossWeight/i)),flightNo:flightOf(field(o,/flight/i)||all),flightDate:dateOf(field(o,/flightDate|date/i)||all),date:dateOf(field(o,/eventDate|date|timestamp/i)||all),time:timeOf(field(o,/eventTime|time|timestamp/i)||all),text:clean(all),sequence:i};}).filter(Boolean)}

function fromText(text){const lines=String(text||'').split(/\n+/).map(clean).filter(Boolean);const events=[];for(let i=0;i<lines.length;i++){const c=codeOf(lines[i]);if(!c)continue;const chunk=lines.slice(Math.max(0,i-4),Math.min(lines.length,i+12)).join(' | ');const pcs=(chunk.match(/(?:No\.? of Pieces|Pieces|Pcs)\s*[:|-]?\s*(\d+)/i)||chunk.match(/\b(\d+)\s*(?:pcs|pieces)\b/i)||[])[1];const wt=(chunk.match(/(?:Weight|Total Weight)\s*[:|-]?\s*([\d,.]+)/i)||chunk.match(/([\d,.]+)\s*kg\b/i)||[])[1];events.push({code:c,station:stationOf(chunk),pieces:num(pcs),weight:num(wt),flightNo:flightOf(chunk),flightDate:dateOf((chunk.match(/Flight Date[^|]*/i)||[])[0]||chunk),date:dateOf(chunk),time:timeOf(chunk),text:chunk,sequence:events.length});}return events;}
function dedupe(events){const seen=new Set();return events.filter(e=>{const k=[e.code,e.station,e.pieces,e.weight,e.flightNo,e.flightDate,e.date,e.time].join('|');if(seen.has(k))return false;seen.add(k);return true;});}
function sig(e){return `${e.pieces||0}/${Math.round((e.weight||0)*100)/100}`}
function total(list){return list.reduce((a,e)=>({pieces:a.pieces+(e.pieces||0),weight:a.weight+(e.weight||0)}),{pieces:0,weight:0})}
function samePortion(a,b){if(a.pieces&&b.pieces&&a.pieces!==b.pieces)return false;if(a.weight&&b.weight&&Math.abs(a.weight-b.weight)>.5)return false;return Boolean(a.pieces||a.weight)}

function plannedSaudiaArrival(flightNo,flightDate,origin,destination){
  const f=String(flightNo||'').replace(/\s+/g,'').toUpperCase();
  const o=String(origin||'').toUpperCase(),d=String(destination||'').toUpperCase();
  // SV760 is the regular Riyadh → Delhi service. SAL/FOW supplies the
  // operating flight date; use its published same-day DEL schedule as ETA
  // until SAL publishes ARR/RCF. This is never marked as an actual arrival.
  if(f==='SV760'&&(!o||o==='RUH')&&d==='DEL'&&flightDate)return{date:flightDate,time:'17:00',source:'SV760 next-flight scheduled RUH-DEL arrival (expected only)'};
  return{date:'',time:'',source:''};
}

function analyse(events,meta={}){
  const ordered=[...events].sort((a,b)=>`${a.date||a.flightDate||''} ${a.time||''} ${String(a.sequence).padStart(5,'0')}`.localeCompare(`${b.date||b.flightDate||''} ${b.time||''} ${String(b.sequence).padStart(5,'0')}`));
  const rcs=ordered.find(e=>e.code==='RCS'&&e.pieces)||{};const master={pieces:rcs.pieces||num(meta.totalPieces),weight:rcs.weight||num(meta.totalWeight)};
  const destination=String(meta.destination||'').toUpperCase();
  // Destination ARR or RCF is the only evidence Mayavi may treat as actual arrival.
  // MAN/FOW/DEP and schedule/header dates remain planned/in-transit evidence only.
  const destArr=ordered.filter(e=>['ARR','RCF'].includes(e.code)&&(!destination||e.station===destination));
  const arrivedRaw=total(destArr);
  const latestConfirmedArrival=destArr.at(-1);
  // Some SAL RCF rows omit pieces/weight. RCF still confirms destination receipt;
  // use master totals only when the confirmation itself has no quantity fields.
  const arrived=(latestConfirmedArrival?.code==='RCF'&&!arrivedRaw.pieces&&!arrivedRaw.weight&&master.pieces)
    ? {pieces:master.pieces,weight:master.weight}
    : arrivedRaw;
  const remaining={pieces:Math.max(0,master.pieces-arrived.pieces),weight:Math.max(0,master.weight-arrived.weight)};
  const attempts=new Map();
  for(const e of ordered.filter(x=>['MAN','FOW','DIS','DEP','ARR'].includes(x.code))){const k=`${e.flightNo||'SV'}|${e.flightDate||e.date||''}`;if(!attempts.has(k))attempts.set(k,{key:k,flightNo:e.flightNo,flightDate:e.flightDate||e.date,events:[]});attempts.get(k).events.push(e)}
  let active=null;const history=[];
  for(const a of attempts.values()){
    const fows=a.events.filter(e=>e.code==='FOW');const dis=a.events.filter(e=>e.code==='DIS');const deps=a.events.filter(e=>e.code==='DEP');const arrs=a.events.filter(e=>e.code==='ARR'&&(!destination||e.station===destination));
    const valid=fows.filter(f=>!dis.some(d=>samePortion(f,d)));
    const vt=total(valid),dt=total(deps),at=total(arrs);
    const cancelled=fows.length&&valid.length<fows.length;
    history.push({flightNo:a.flightNo,flightDate:a.flightDate,fow:total(fows),validFow:vt,departed:dt,arrived:at,cancelled});
    if(valid.length||deps.length)active={...a,validFow:vt,departed:dt,cancelled};
  }
  const complete=master.pieces>0&&arrived.pieces>=master.pieces&&(master.weight<=0||arrived.weight>=master.weight-.5);
  let status='TRACKING',loadStatus='',discrepancy='';
  if(complete){status='ARRIVED';loadStatus=`Complete Load Arrived — ${arrived.pieces}/${master.pieces} pcs`;discrepancy='Complete Load / No discrepancy';}
  else if(active){const moving=active.departed.pieces?active.departed:active.validFow;const coversBalance=remaining.pieces>0&&moving.pieces>=remaining.pieces&&(remaining.weight<=0||moving.weight>=remaining.weight-.5);const prior=arrived.pieces>0;status=active.departed.pieces?'IN TRANSIT':prior?'PART ARRIVED':'IN TRANSIT';loadStatus=`${coversBalance?(prior?'Complete Balance':'Complete Load'):'Part Load'} ${active.departed.pieces?'Confirmed':'Expected'} — ${moving.pieces}${master.pieces?`/${remaining.pieces}`:''} pcs${active.flightNo?` — ${active.flightNo}`:''}`;if(prior)discrepancy=`Part Load: ${arrived.pieces}/${master.pieces||'?'} arrived | Balance ${remaining.pieces}${master.pieces?`/${master.pieces}`:''}`;if(active.cancelled)discrepancy=`${discrepancy?`${discrepancy} · `:''}FOW cancelled by DIS; latest valid movement recalculated`;}
  else if(arrived.pieces){status='PART ARRIVED';loadStatus=`Part Arrived — ${arrived.pieces}/${master.pieces||'?'} pcs`;discrepancy=`Part Load: ${arrived.pieces}/${master.pieces||'?'} arrived | Balance ${remaining.pieces}${master.pieces?`/${master.pieces}`:''}`;}
  else {const latest=ordered.at(-1);status=latest?.code==='DIS'?'PENDING / REBOOKING':latest?.code==='MAN'?'PLANNED':'TRACKING';loadStatus=latest?.code==='MAN'?'Planned — awaiting FOW':'';if(latest?.code==='DIS')discrepancy='Latest planned/FOW movement cancelled by DIS — awaiting rebooking';}
  const latestArr=destArr.at(-1);const latestMove=active?.events?.filter(e=>['FOW','DEP'].includes(e.code)).at(-1);const latestRcs=[...ordered].reverse().find(e=>e.code==='RCS'&&e.flightNo)||{};const flightNo=active?.flightNo||latestArr?.flightNo||latestRcs.flightNo||'';const flightDate=active?.flightDate||latestArr?.flightDate||latestRcs.flightDate||latestRcs.date||'';
  // Preserve the established FOW path exactly: never synthesize a FOW event.
  // This RCS/header fallback is only a next-flight ETA assessment and can never
  // make shipment status ARRIVED. Actual arrival still requires destination ARR/RCF.
  const rcsFallbackDate=(!active&&!latestArr?.date&&latestRcs.flightNo)?String(meta.salHeaderDate||''):'';
  const planned=latestArr?.date?{date:'',time:'',source:''}:plannedSaudiaArrival(flightNo,rcsFallbackDate||flightDate,meta.origin,meta.destination);return{master,arrived,remaining,status,loadStatus,discrepancy,flightNo,flightDate,arrivalDate:latestArr?.date||planned.date||'',arrivalTime:latestArr?.time||planned.time||'',arrivalPlanned:Boolean(!latestArr?.date&&planned.date),arrivalPlanSource:rcsFallbackDate?`${planned.source} · SAL header date fallback`:planned.source,actualArrival:latestArr?.date?`${latestArr.date}T${latestArr.time||'00:00'}:00`:null,latestMove,history};
}

export async function trackSaudiaSal(inputMawb){const mawb=normalizeMawb(inputMawb),airline=airlineForMawb(mawb);if(!mawb||!mawb.replace(/\D/g,'').startsWith('065'))return{ok:false,reason:'NOT SAUDIA',airline};let browser;const debug={stage:'SAL_OPEN',scrolls:0,endMarker:false};try{const mod=await import('puppeteer-core');const puppeteer=mod.default||mod;browser=await puppeteer.launch({...await browserConfig(),headless:true,defaultViewport:{width:1440,height:1050}});const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');const network=[];page.on('response',async r=>{try{const ct=String(r.headers()['content-type']||'');if(!/json/i.test(ct)&&!/track|shipment|awb/i.test(r.url()))return;const body=await r.text();if(body&&body.length<500000&&/(RCS|MAN|FOW|DIS|DEP|ARR|FIW|RCF|shipment|awb)/i.test(body))network.push(body)}catch{}});await page.goto('https://sal.sa/trackshipment',{waitUntil:'domcontentloaded',timeout:30000});await sleep(1800);const digits=mawb.replace(/\D/g,'');let submitted=false;for(const frame of page.frames()){const inputs=await frame.$$('input:not([type="hidden"])');for(const input of inputs){try{const m=await input.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>3&&r.height>3&&!el.disabled,text:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''}`}});if(!m.visible||!/awb|air waybill|shipment|track/i.test(m.text))continue;await input.click({clickCount:3});await page.keyboard.press('Backspace');await input.type(digits,{delay:30});await page.keyboard.press('Enter');submitted=true;break}catch{}}if(submitted)break}if(!submitted)return{ok:false,technical:true,reason:'SAL AWB input was not accessible.',airline,debug:{...debug,stage:'SAL_FORM_NOT_FOUND'}};await sleep(2200);
  const textChunks=[];let stable=0,lastHeight=0;for(let i=0;i<45;i++){const snap=await page.evaluate(()=>({text:document.body?.innerText||'',height:document.documentElement.scrollHeight,end:/Ready to take your supply chain to the next level/i.test(document.body?.innerText||'')}));textChunks.push(snap.text);debug.scrolls=i+1;if(snap.end){debug.endMarker=true;break}stable=snap.height===lastHeight?stable+1:0;lastHeight=snap.height;await page.evaluate(()=>window.scrollBy(0,Math.max(500,Math.floor(window.innerHeight*.72))));await sleep(350);if(stable>=5&&i>8)break}
  const full=textChunks.join('\n');if(/no shipment|not found|invalid awb/i.test(full))return{ok:false,notFound:true,technical:false,reason:'SAL returned no shipment record.',airline,debug:{...debug,stage:'SAL_NO_RECORD'}};let events=[];network.forEach(x=>events.push(...fromJson(x)));events.push(...fromText(full));events=dedupe(events);if(!events.length)return{ok:false,technical:true,reason:'SAL opened the shipment but no timeline events were machine-readable.',airline,debug:{...debug,stage:'SAL_TIMELINE_UNREADABLE',networkResponses:network.length}};
  // SAL exposes useful shipment metadata in more than one place: header cards,
  // FOW/detail cards and JSON responses. Read all of them before deciding a
  // field is blank so a markup change in one card does not wipe Mayavi data.
  const combined=[full,...network].join('\n');
  const route=(combined.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>|\bTO\b)\s*([A-Z]{3})\b/i)||[]);
  const destination=(((combined.match(/\bDESTINATION\b\s*[:|\-]?\s*(?:\n\s*)?([A-Z]{3})\b/i)||[])[1])||route[2]||'').toUpperCase();
  const origin=(((combined.match(/\bORIGIN\b\s*[:|\-]?\s*(?:\n\s*)?([A-Z]{3})\b/i)||[])[1])||route[1]||'').toUpperCase();
  const totalPieces=((combined.match(/\b(?:TOTAL\s+PIECES|NO\.?\s*OF\s*PIECES|PIECES|BAGS)\b\s*[:|\-]?\s*(?:\n\s*)?(\d{1,6})\b/i)||[])[1])||'';
  const totalWeight=((combined.match(/\b(?:TOTAL\s+WEIGHT|GROSS\s+WEIGHT|WEIGHT)\b\s*[:|\-]?\s*(?:\n\s*)?([\d,.]+)\s*(?:KG|KGS)?\b/i)||[])[1])||'';
  const bookingChunk=(combined.match(/\b(?:BOOKING\s*DATE|BOOKED\s*ON|BOOKING)\b[\s\S]{0,80}/i)||[])[0]||'';
  const bookingDate=dateOf(bookingChunk);
  // Standalone SAL Date card is not booking date; use only for RCS-only arrival fallback.
  const headerDateChunk=(full.match(/(?:^|\n)\s*Date\s*(?:\n|:|-)+\s*\d{1,2}\s*[A-Z]{3}\s*\d{2,4}/i)||[])[0]||'';
  const salHeaderDate=dateOf(headerDateChunk);
  const a=analyse(events,{origin,destination,totalPieces,totalWeight,salHeaderDate});
  const shipment={mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin,destination,bookingDate,bags:String(a.master.pieces||totalPieces||''),pieces:String(a.master.pieces||totalPieces||''),weight:String(a.master.weight||totalWeight||''),flightNo:a.flightNo||flightOf(combined),arrivalDate:a.arrivalDate,arrivalTime:a.arrivalTime,arrivalIsActual:Boolean(a.actualArrival),arrivalIsPlanned:Boolean(a.arrivalPlanned),eta:a.actualArrival||(a.arrivalDate&&a.arrivalTime?`${a.arrivalDate}T${a.arrivalTime}:00`:null),status:a.status,loadStatus:a.loadStatus,discrepancy:a.discrepancy,masterPieces:a.master.pieces,masterWeight:a.master.weight,arrivedPieces:a.arrived.pieces,arrivedWeight:a.arrived.weight,remainingPieces:a.remaining.pieces,remainingWeight:a.remaining.weight,actualArrival:a.actualArrival,officialTracker:'https://sal.sa/trackshipment',source:'SAL official full timeline',salTimelineComplete:debug.endMarker,salEvents:events,partLoadHistory:a.history};return{ok:true,airline,shipment,debug:{...debug,stage:'SAL_SUCCESS',events:events.length,networkResponses:network.length,metadata:{origin,destination,totalPieces,totalWeight,bookingDate,salHeaderDate}}};
}catch(e){return{ok:false,technical:true,reason:e?.message||'SAL tracker failed.',airline,debug:{...debug,stage:'SAL_BROWSER_ERROR'}}}finally{if(browser)try{await browser.close()}catch{}}}
