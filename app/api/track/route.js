export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TRACK123_QUERY='https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/query';
const TRACK123_REGISTER='https://api.track123.com/gateway/open-api/tk/v2.1/aviation/track/import';
const TRACK123_CARRIERS='https://api.track123.com/gateway/open-api/tk/v2.1/aviation/carrier/list';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

const OFFICIAL={
  '001':{name:'American Airlines Cargo',iata:'AA',url:'https://www.aacargo.com/AACargo/tracking'},
  '006':{name:'Delta Cargo',iata:'DL',url:'https://www.deltacargo.com/Cargo/catalog/products/track-shipment'},
  '014':{name:'Air Canada Cargo',iata:'AC',url:'https://www.aircanada.com/cargo/en/tools-forms/track-and-trace/'},
  '016':{name:'United Cargo',iata:'UA',url:'https://www.unitedcargo.com/en/us/track'},
  '020':{name:'Lufthansa Cargo',iata:'LH',url:'https://www.lufthansa-cargo.com/en/eservices/etracking'},
  '023':{name:'FedEx Express',iata:'FX',url:'https://www.fedex.com/en-us/tracking.html'},
  '057':{name:'Air France KLM Martinair Cargo',iata:'AF',url:'https://www.afklcargo.com/'},
  '065':{name:'Saudia Cargo',iata:'SV',url:'https://www.saudiacargo.com/e-services'},
  '071':{name:'Ethiopian Cargo',iata:'ET',url:'https://cargo.ethiopianairlines.com/my-cargo/track-your-shipment'},
  '074':{name:'KLM Cargo',iata:'KL',url:'https://www.afklcargo.com/'},
  '075':{name:'Iberia Cargo',iata:'IB',url:'https://www.iagcargo.com/en/track/'},
  '081':{name:'Qantas Freight',iata:'QF',url:'https://freight.qantas.com/'},
  '098':{name:'Air India Cargo',iata:'AI',url:'https://cargo.airindia.com/in/en/track-shipment.html'},
  '105':{name:'Finnair Cargo',iata:'AY',url:'https://cargo.finnair.com/'},
  '125':{name:'British Airways / IAG Cargo',iata:'BA',url:'https://www.iagcargo.com/en/track/'},
  '131':{name:'Japan Airlines Cargo',iata:'JL',url:'https://www.jal.co.jp/jalcargo/inter/track/'},
  '157':{name:'Qatar Airways Cargo',iata:'QR',url:'https://www.qrcargo.com/s/track-your-shipment'},
  '160':{name:'Cathay Cargo',iata:'CX',url:'https://www.cathaycargo.com/en-us/track-and-trace.html'},
  '176':{name:'Emirates SkyCargo',iata:'EK',url:'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt'},
  '180':{name:'Korean Air Cargo',iata:'KE',url:'https://cargo.koreanair.com/en/tracking'},
  '205':{name:'ANA Cargo',iata:'NH',url:'https://www.anacargo.jp/en/int/airwaybill/'},
  '217':{name:'Thai Airways Cargo',iata:'TG',url:'https://www.thaicargo.com/en/track-shipment'},
  '232':{name:'Malaysia Airlines Cargo',iata:'MH',url:'https://www.maskargo.com/'},
  '235':{name:'Turkish Cargo',iata:'TK',url:'https://www.turkishcargo.com.tr/en/online-services/shipment-tracking'},
  '297':{name:'China Airlines Cargo',iata:'CI',url:'https://cargo.china-airlines.com/ccnetv2/content/manage/ShipmentTracking.aspx'},
  '312':{name:'IndiGo CarGo',iata:'6E',url:'https://6ecargo.goindigo.in/FrmAWBTracking.aspx'},
  '406':{name:'UPS Airlines',iata:'5X',url:'https://www.ups.com/track'},
  '607':{name:'Etihad Cargo',iata:'EY',url:'https://www.etihadcargo.com/'},
  '618':{name:'Singapore Airlines Cargo',iata:'SQ',url:'https://www.siacargo.com/e-services/track-shipment'},
  '724':{name:'SWISS WorldCargo',iata:'LX',url:'https://www.swissworldcargo.com/'},
  '988':{name:'Asiana Cargo',iata:'OZ',url:'https://www.asiana-cargo.com/tracking/viewTraceAirWaybill.do'},
  '999':{name:'Air China Cargo',iata:'CA',url:'https://www.airchinacargo.com/en/trackShipment'}
};

function normalizeMawb(v=''){
  const d=String(v).replace(/\D/g,'');
  return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:'';
}
function officialFor(mawb){return OFFICIAL[mawb.replace(/\D/g,'').slice(0,3)]||null;}
function walk(v,out=[]){
  if(!v||typeof v!=='object')return out;
  out.push(v);
  if(Array.isArray(v))v.forEach(x=>walk(x,out));else Object.values(v).forEach(x=>walk(x,out));
  return out;
}
function pick(o,keys){for(const k of keys)if(o&&o[k]!==undefined&&o[k]!==null&&o[k]!=='')return o[k];return null;}
function anywhere(raw,keys){for(const n of walk(raw))for(const k of keys)if(n&&n[k]!==undefined&&n[k]!==null&&n[k]!=='')return n[k];return null;}
function asDate(v){
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='number'){const d=new Date(v<1e12?v*1000:v);return Number.isNaN(d.getTime())?null:d;}
  const s=String(v).trim();
  if(/^\d{10,13}$/.test(s)){const d=new Date(Number(s.length===10?`${s}000`:s));if(!Number.isNaN(d.getTime()))return d;}
  const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
}
function isoParts(v){const d=asDate(v);if(!d)return{date:'',time:''};return{date:d.toISOString().slice(0,10),time:d.toISOString().slice(11,16)};}
function monthNum(m){return({jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'})[String(m).slice(0,3).toLowerCase()]||'';}
function parseTextDate(raw=''){
  const s=clean(raw);
  let m=s.match(/\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,](\d{2,4})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if(m){let h=Number(m[4]);const ap=(m[6]||'').toUpperCase();if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;let y=String(m[3]);if(y.length===2)y=`20${y}`;const mo=monthNum(m[2]);if(mo)return{date:`${y}-${mo}-${String(m[1]).padStart(2,'0')}`,time:`${String(h).padStart(2,'0')}:${m[5]}`};}
  m=s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})[ ,T]+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if(m){let h=Number(m[4]);const ap=(m[6]||'').toUpperCase();if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;return{date:`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`,time:`${String(h).padStart(2,'0')}:${m[5]}`};}
  return{date:'',time:''};
}
function statusFromText(t=''){
  if(/\bearly\b/i.test(t)&&/arriv/i.test(t))return'EARLY ARRIVAL';
  if(/\bdelayed\b|\blate\b|exception/i.test(t))return'DELAYED';
  if(/\barrived\b|\blanded\b|\bRCF\b|received at destination/i.test(t))return'ARRIVED';
  if(/\bdeparted\b|\bDEP\b|in[ -]?transit|airborne|in flight/i.test(t))return'IN TRANSIT';
  if(/\bbooked\b|\bRCS\b|received from shipper|manifested/i.test(t))return'BOOKED';
  return'';
}
function parseOfficialText(raw,mawb,airline){
  const t=clean(raw),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  if(/no shipment|no record|not found|invalid (?:awb|air waybill)|unable to find|no data found|awb does not exist/i.test(t))return{notFound:true};
  const route=t.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const origin=(t.match(/(?:origin|from|departure(?: airport)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||route?.[1]||'';
  const destination=(t.match(/(?:destination|to|arrival(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||route?.[2]||'';
  const pcs=(t.match(/(?:pieces?|pcs?|bags?)\s*[:#-]?\s*(\d{1,6})\b/i)||t.match(/\b(\d{1,6})\s*(?:pieces?|pcs?|bags?)\b/i)||[])[1]||'';
  const weight=(t.match(/(?:gross\s+weight|weight)\s*[:#-]?\s*([\d,.]+)\s*(?:kg|kgs|kilograms?)?/i)||t.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i)||[])[1]?.replace(/,/g,'')||'';
  const iata=airline?.iata||'';
  const fRe=iata?new RegExp(`\\b${iata}[-\\s]?(\\d{2,4})\\b`,'ig'):/\b([A-Z0-9]{2})[-\s]?(\d{2,4})\b/g;
  const f=[...t.matchAll(fRe)];
  const flightNo=f.length?(iata?`${iata}${f.at(-1)[1]}`:`${f.at(-1)[1]}${f.at(-1)[2]}`):'';
  const actualChunk=(t.match(/(?:actual arrival|arrived(?: at)?|landed(?: at)?)[^\n|]{0,120}/i)||[])[0]||'';
  const etaChunk=(t.match(/(?:estimated arrival|expected arrival|ETA|scheduled arrival|arrival date(?:\/time)?)[^\n|]{0,150}/i)||[])[0]||'';
  let arrival=parseTextDate(actualChunk);
  let actual=Boolean(arrival.date&&arrival.time);
  if(!arrival.date)arrival=parseTextDate(etaChunk);
  if(!arrival.date){
    const around=[...t.matchAll(/(?:arriv|ETA)[\s\S]{0,100}?(\d{1,2}[-\s][A-Za-z]{3,9}[-\s,]\d{2,4}\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)/ig)].at(-1);
    if(around?.[1])arrival=parseTextDate(around[1]);
  }
  const status=statusFromText(t);
  const seen=t.includes(mawb)||t.includes(digits)||t.includes(serial);
  const useful=Boolean((seen||status)&&(origin||destination||pcs||weight||flightNo||arrival.date||status));
  return{useful,shipment:{mawb,carrierCode:iata,origin:origin.toUpperCase(),destination:destination.toUpperCase(),bags:pcs,pieces:pcs,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:actual,status:status||(arrival.date?'IN TRANSIT':'TRACKING'),source:`${airline.name} official website`}};
}
function technicalBlock(text=''){
  const t=String(text);
  if(/captcha|verify (?:you are|that you are) human|i am not a robot|robot check|access denied|forbidden|unusual traffic|cloudflare|security check|one moment please/i.test(t))return'CAPTCHA / ANTI-BOT';
  if(/sign in|log in|login required|register to track|please register|account required/i.test(t))return'LOGIN WALL';
  return'';
}
async function visibleInputs(page){
  const hs=await page.$$('input,textarea');const out=[];
  for(const h of hs){
    try{const m=await h.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>4&&r.height>4&&!el.disabled,type:(el.type||'text').toLowerCase(),label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''}`,max:el.maxLength||0};});if(m.visible&&!['hidden','checkbox','radio','file','password','email'].includes(m.type))out.push({h,m});}catch{}
  }
  return out;
}
async function setValue(page,h,value){
  await page.evaluate((el,val)=>{const p=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;const s=Object.getOwnPropertyDescriptor(p,'value')?.set;if(s)s.call(el,val);else el.value=val;el.focus();['input','change','blur'].forEach(n=>el.dispatchEvent(new Event(n,{bubbles:true})));},h,value);
}
async function submitOfficial(page,mawb){
  const prefix=mawb.slice(0,3),serial=mawb.replace(/\D/g,'').slice(3),digits=mawb.replace(/\D/g,'');
  const inputs=await visibleInputs(page);
  const label=x=>String(x.m.label||'');
  const prefixInput=inputs.find(x=>x.m.max===3||/prefix|airline code/i.test(label(x)));
  const serialInput=inputs.find(x=>x!==prefixInput&&(x.m.max===8||/(awb|air waybill|waybill).*(number|no)|shipment.*number/i.test(label(x))));
  let filled=false,target=null;
  if(prefixInput&&serialInput){await setValue(page,prefixInput.h,prefix);await setValue(page,serialInput.h,serial);target=serialInput.h;filled=true;}
  if(!filled){
    const one=inputs.find(x=>/awb|air waybill|waybill|shipment.*(?:track|number)|tracking.*number/i.test(label(x)))||inputs.find(x=>x.m.max===11||x.m.max===12||x.m.max===14);
    if(one){const value=one.m.max===8?serial:(one.m.max===11?digits:mawb);await setValue(page,one.h,value);target=one.h;filled=true;}
  }
  if(!filled)return{ok:false,technical:true,reason:'TRACKING FORM NOT ACCESSIBLE'};
  const buttons=await page.$$('button,input[type="submit"],input[type="button"],[role="button"]');
  let clicked=false;
  for(const b of buttons){
    try{const m=await b.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>4&&r.height>4&&!el.disabled,text:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim()};});if(m.visible&&/track|search|find|submit|enquir|inquir|go$/i.test(m.text)){await b.click({delay:80});clicked=true;break;}}catch{}
  }
  if(!clicked&&target){try{await page.evaluate(el=>el.form?.requestSubmit?.(),target);}catch{} }
  if(!clicked&&target){try{await target.press('Enter');}catch{} }
  return{ok:true};
}
async function runOfficial(mawb){
  const airline=officialFor(mawb);
  if(!airline)return{ok:false,technical:true,reason:'NO OFFICIAL ADAPTER',airline:null};
  let browser;
  const debug={stage:'OFFICIAL_OPEN',airline:airline.name,officialUrl:airline.url};
  try{
    const chromiumMod=await import('@sparticuz/chromium'),puppeteerMod=await import('puppeteer-core');
    const chromium=chromiumMod.default||chromiumMod,puppeteer=puppeteerMod.default||puppeteerMod;
    browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true,defaultViewport:{width:1440,height:1050}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(airline.url,{waitUntil:'domcontentloaded',timeout:28000});await sleep(1200);
    try{await page.evaluate(()=>{const els=[...document.querySelectorAll('button')];const b=els.find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||'').trim()));if(b)b.click();});}catch{}
    let text=clean(await page.evaluate(()=>document.body?.innerText||''));
    const blocked=technicalBlock(text);if(blocked)return{ok:false,technical:true,reason:blocked,airline,debug:{...debug,stage:'OFFICIAL_BLOCKED'}};
    debug.stage='OFFICIAL_SUBMIT';
    const submit=await submitOfficial(page,mawb);if(!submit.ok)return{ok:false,technical:true,reason:submit.reason,airline,debug:{...debug,stage:'OFFICIAL_FORM_BLOCKED'}};
    try{await page.waitForNetworkIdle({idleTime:800,timeout:12000});}catch{}await sleep(2600);
    text=clean(await page.evaluate(()=>document.body?.innerText||''));
    const blockedAfter=technicalBlock(text);if(blockedAfter)return{ok:false,technical:true,reason:blockedAfter,airline,debug:{...debug,stage:'OFFICIAL_BLOCKED_AFTER_SUBMIT'}};
    const parsed=parseOfficialText(text,mawb,airline);
    if(parsed.notFound)return{ok:false,technical:false,notFound:true,reason:'Official airline website returned no shipment record.',airline,debug:{...debug,stage:'OFFICIAL_NO_RECORD'}};
    if(!parsed.useful)return{ok:false,technical:true,reason:'Official tracking page opened but its live result is not machine-readable.',airline,debug:{...debug,stage:'OFFICIAL_RESULT_UNREADABLE'}};
    return{ok:true,airline,shipment:parsed.shipment,debug:{...debug,stage:'OFFICIAL_SUCCESS'}};
  }catch(e){return{ok:false,technical:true,reason:e?.message||'Official airline browser failed.',airline,debug:{...debug,stage:'OFFICIAL_BROWSER_ERROR'}};}
  finally{if(browser)try{await browser.close();}catch{}}
}

async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{};}catch{return{raw:t};}}
async function track123Call(url,key,body){const r=await fetch(url,{method:'POST',headers:{'Track123-Api-Secret':key,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),cache:'no-store'});return{ok:r.ok,status:r.status,data:await readJson(r)};}
async function detectTrack123Carrier(key,mawb){
  const prefix=mawb.slice(0,3);
  try{const r=await fetch(TRACK123_CARRIERS,{headers:{'Track123-Api-Secret':key,Accept:'application/json'},cache:'no-store'});if(!r.ok)return'';const data=await readJson(r);const hit=walk(data).find(n=>{const p=pick(n,['prefix','awbPrefix','airWaybillPrefix','mawbPrefix','iataPrefix','awbCode']);return p&&String(p).replace(/\D/g,'').padStart(3,'0')===prefix;});return String(pick(hit,['carrierCode','code','courierCode','slug','carrier'])||'');}catch{return'';}
}
function track123Shipment(raw,mawb,carrier=''){
  const nodes=walk(raw),digits=mawb.replace(/\D/g,'');
  const best=nodes.find(n=>{const v=pick(n,['trackingNo','trackNo','mawb','awbNo','waybillNo','trackingNumber']);return v&&String(v).replace(/\D/g,'')===digits;})||nodes.find(n=>pick(n,['status','aviationStatus','origin','events','flightInfo']))||raw;
  const origin=String(anywhere(best,['origin','originAirport','departureAirport','from','originCode','departureCode'])||'');
  const destination=String(anywhere(best,['destination','destinationAirport','arrivalAirport','to','destinationCode','arrivalCode'])||'');
  const status=String(anywhere(best,['aviationStatus','statusName','status','latestStatus','trackingStatus','state'])||'');
  const flightNo=String(anywhere(best,['flightNo','flightNumber','flight','flightCode'])||'');
  const bags=anywhere(best,['pieces','pieceCount','piecesCount','pcs','bags','bagCount'])||'';
  const weight=anywhere(best,['weight','grossWeight','totalWeight','chargeableWeight'])||'';
  let eta=anywhere(best,['actualArrivalTime','actualArrival','arrivedAt','estimatedArrivalTime','estimatedArrival','eta','etaDateTime','estimatedArrivalDateTime','scheduledArrivalTime','scheduledArrival','scheduledArrivalDateTime','flightEstimatedArrivalTime'])||null;
  if(!asDate(eta))eta=null;
  const parts=isoParts(eta);
  const useful=Boolean(origin||destination||status||flightNo||bags||weight||eta);
  return{useful,shipment:{mawb,carrierCode:carrier,origin,destination,bags,pieces:bags,weight,flightNo,arrivalDate:parts.date,arrivalTime:parts.time,arrivalIsActual:/arriv|rcf|delivered/i.test(status),status:statusFromText(status)||status||'TRACKING',source:'Track123 fallback — official airline technically blocked'}};
}
async function runTrack123Fallback(mawb){
  const key=process.env.TRACK123_API_KEY;if(!key)return{ok:false,reason:'TRACK123_API_KEY is not configured.'};
  const carrier=await detectTrack123Carrier(key,mawb);const item={trackingNo:mawb,...(carrier?{carrierCode:carrier}:{})};
  let q=await track123Call(TRACK123_QUERY,key,[item]);if(!q.ok)q=await track123Call(TRACK123_QUERY,key,{trackNoInfos:[item]});
  let parsed=q.ok?track123Shipment(q.data,mawb,carrier):{useful:false};
  if(!parsed.useful){
    let reg=await track123Call(TRACK123_REGISTER,key,[item]);if(!reg.ok)reg=await track123Call(TRACK123_REGISTER,key,{trackNoInfos:[item]});
    if(reg.ok){await sleep(900);q=await track123Call(TRACK123_QUERY,key,[item]);if(!q.ok)q=await track123Call(TRACK123_QUERY,key,{trackNoInfos:[item]});parsed=q.ok?track123Shipment(q.data,mawb,carrier):{useful:false};}
  }
  return parsed.useful?{ok:true,shipment:parsed.shipment}:{ok:false,reason:`Track123 fallback returned no usable shipment data${q?.status?` (HTTP ${q.status})`:''}.`};
}

function waiting(mawb,airline,reason=''){return{mawb,carrierCode:airline?.iata||'',origin:'',destination:'',bags:'',weight:'',flightNo:'',arrivalDate:'',arrivalTime:'',eta:null,actualArrival:null,status:'WAITING FOR LIVE DATA',source:`${airline?.name||'Official airline'}${reason?` · ${reason}`:''}`};}

async function handle(mawb){
  const primary=await runOfficial(mawb);
  if(primary.ok)return Response.json({ok:true,configured:true,provider:`${primary.airline.name} official website`,source:`${primary.airline.name} official website`,airlinePrimary:true,fallbackUsed:false,shipment:primary.shipment,trackingDebug:primary.debug});
  if(primary.notFound)return Response.json({ok:true,configured:true,provider:`${primary.airline?.name||'Official airline'} official website`,source:'Official airline — no record',airlinePrimary:true,fallbackUsed:false,trackingError:primary.reason,trackingDebug:primary.debug,shipment:waiting(mawb,primary.airline,'NO SHIPMENT RECORD')});
  if(primary.technical){
    const fallback=await runTrack123Fallback(mawb);
    if(fallback.ok)return Response.json({ok:true,configured:true,provider:'Official airline → Track123 fallback',source:'Track123 fallback — official airline technically blocked',airlinePrimary:false,fallbackUsed:true,officialError:primary.reason,trackingDebug:primary.debug,shipment:fallback.shipment});
    return Response.json({ok:true,configured:true,provider:'Official airline first',source:'Official airline technical block',airlinePrimary:true,fallbackUsed:false,officialError:primary.reason,trackingError:fallback.reason,trackingDebug:primary.debug,shipment:waiting(mawb,primary.airline,primary.reason)});
  }
  return Response.json({ok:true,configured:true,provider:'Official airline first',source:'Official airline',airlinePrimary:true,fallbackUsed:false,trackingError:primary.reason,trackingDebug:primary.debug,shipment:waiting(mawb,primary.airline,primary.reason)});
}

export async function GET(request){
  const u=new URL(request.url),q=u.searchParams.get('mawb');
  if(!q)return Response.json({configured:true,provider:'Official airline first',fallback:'Track123 only when official airline is technically blocked',fallbackConfigured:Boolean(process.env.TRACK123_API_KEY),apiKeyRequiredForPrimary:false});
  const mawb=normalizeMawb(q);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handle(mawb);
}
export async function POST(request){
  let b={};try{b=await request.json();}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400});}
  const mawb=normalizeMawb(b?.mawb);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handle(mawb);
}
