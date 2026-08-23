export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

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

function normalizeMawb(v=''){const d=String(v).replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:'';}
function officialFor(mawb){return OFFICIAL[mawb.replace(/\D/g,'').slice(0,3)]||null;}
function monthNum(m){return({jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'})[String(m).slice(0,3).toLowerCase()]||'';}
function parseTextDate(raw=''){
 const s=clean(raw);let m=s.match(/\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,](\d{2,4})\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
 if(m){let h=Number(m[4]),ap=(m[6]||'').toUpperCase();if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;let y=String(m[3]);if(y.length===2)y=`20${y}`;const mo=monthNum(m[2]);if(mo)return{date:`${y}-${mo}-${String(m[1]).padStart(2,'0')}`,time:`${String(h).padStart(2,'0')}:${m[5]}`};}
 m=s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);if(m)return{date:`${m[1]}-${m[2]}-${m[3]}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
 return{date:'',time:''};
}
function statusFromText(t=''){
 if(/notified consignee/i.test(t))return'NOTIFIED CONSIGNEE';
 if(/received at destination/i.test(t))return'RECEIVED AT DESTINATION';
 if(/\bdelivered\b|\bdlv\b/i.test(t))return'DELIVERED';
 if(/\barrived\b|\blanded\b|\bRCF\b/i.test(t))return'ARRIVED';
 if(/\bdelayed\b|\blate\b|exception/i.test(t))return'DELAYED';
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
 const iata=airline?.iata||'',fRe=iata?new RegExp(`\\b${iata}[-\\s]?(\\d{2,4})\\b`,'ig'):/\b([A-Z0-9]{2})[-\s]?(\d{2,4})\b/g,f=[...t.matchAll(fRe)];
 const flightNo=f.length?(iata?`${iata}${f.at(-1)[1]}`:`${f.at(-1)[1]}${f.at(-1)[2]}`):'';
 const actualChunk=(t.match(/(?:actual arrival|arrived(?: at)?|landed(?: at)?)[^\n|]{0,140}/i)||[])[0]||'';
 const etaChunk=(t.match(/(?:estimated arrival|expected arrival|ETA|scheduled arrival|arrival date(?:\/time)?)[^\n|]{0,170}/i)||[])[0]||'';
 let arrival=parseTextDate(actualChunk),actual=Boolean(arrival.date&&arrival.time);if(!arrival.date)arrival=parseTextDate(etaChunk);
 if(!arrival.date){const all=[...t.matchAll(/(?:arriv|ETA)[\s\S]{0,100}?(\d{1,2}[-\s][A-Za-z]{3,9}[-\s,]\d{2,4}\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)/ig)];if(all.length)arrival=parseTextDate(all.at(-1)[1]);}
 const status=statusFromText(t),seen=t.includes(mawb)||t.includes(digits)||t.includes(serial),useful=Boolean(seen&&(origin||destination||pcs||weight||flightNo||arrival.date||status));
 return{useful,shipment:{mawb,carrierCode:iata,airlineName:airline.name,origin:origin.toUpperCase(),destination:destination.toUpperCase(),bags:pcs,pieces:pcs,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:actual,status:status||(arrival.date?'IN TRANSIT':'TRACKING'),officialTracker:airline.url,source:`${airline.name} official website`}};
}
function technicalBlock(text=''){
 if(/captcha|verify (?:you are|that you are) human|i am not a robot|robot check|access denied|forbidden|unusual traffic|cloudflare|security check|one moment please/i.test(text))return'CAPTCHA / ANTI-BOT';
 if(/sign in|log in|login required|register to track|please register|account required/i.test(text))return'LOGIN WALL';
 return'';
}
async function safeBodyText(page,retries=6){
 for(let i=0;i<retries;i++){try{return clean(await page.evaluate(()=>document.body?.innerText||''));}catch(e){if(!/Execution context was destroyed|Cannot find context|detached/i.test(String(e?.message||e)))throw e;await sleep(500);}}
 return'';
}
async function visibleInputs(page){
 const hs=await page.$$('input,textarea'),out=[];for(const h of hs){try{const m=await h.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>4&&r.height>4&&!el.disabled,type:(el.type||'text').toLowerCase(),label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''}`,max:el.maxLength||0};});if(m.visible&&!['hidden','checkbox','radio','file','password','email'].includes(m.type))out.push({h,m});}catch{}}return out;
}
async function setValue(page,h,value){await page.evaluate((el,val)=>{const p=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,s=Object.getOwnPropertyDescriptor(p,'value')?.set;if(s)s.call(el,val);else el.value=val;el.focus();['input','change'].forEach(n=>el.dispatchEvent(new Event(n,{bubbles:true})));},h,value);}
async function clickTrack(page){
 const buttons=await page.$$('button,input[type="submit"],input[type="button"],[role="button"]');for(const b of buttons){try{const m=await b.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>4&&r.height>4&&!el.disabled,text:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim()};});if(m.visible&&/track|search|find|submit|enquir|inquir|go$/i.test(m.text)){await Promise.allSettled([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:12000}),b.click({delay:80})]);return m.text;}}catch{}}return'';
}
async function submitOfficial(page,mawb){
 const prefix=mawb.slice(0,3),serial=mawb.replace(/\D/g,'').slice(3),digits=mawb.replace(/\D/g,''),inputs=await visibleInputs(page),label=x=>String(x.m.label||'');
 const prefixInput=inputs.find(x=>x.m.max===3||/prefix|airline code/i.test(label(x))),serialInput=inputs.find(x=>x!==prefixInput&&(x.m.max===8||/(awb|air waybill|waybill).*(number|no)|shipment.*number/i.test(label(x))));
 let target=null;
 if(prefixInput&&serialInput){await setValue(page,prefixInput.h,prefix);await setValue(page,serialInput.h,serial);target=serialInput.h;}
 else{const one=inputs.find(x=>/awb|air waybill|waybill|shipment.*(?:track|number)|tracking.*number/i.test(label(x)))||inputs.find(x=>x.m.max===11||x.m.max===12||x.m.max===14);if(!one)return{ok:false,reason:'TRACKING FORM NOT ACCESSIBLE'};await setValue(page,one.h,one.m.max===8?serial:(one.m.max===11?digits:mawb));target=one.h;}
 const clicked=await clickTrack(page);if(!clicked&&target){try{await Promise.allSettled([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:12000}),page.evaluate(el=>el.form?.requestSubmit?.(),target)]);}catch{}}
 return{ok:true,clicked};
}
async function runOfficial(mawb){
 const airline=officialFor(mawb);if(!airline)return{ok:false,technical:true,reason:'NO OFFICIAL TRACKER MAPPED FOR THIS PREFIX',airline:null,debug:{stage:'NO_OFFICIAL_TRACKER'}};
 let browser;const debug={stage:'OFFICIAL_OPEN',airline:airline.name,officialUrl:airline.url};
 try{
  const chromiumMod=await import('@sparticuz/chromium'),puppeteerMod=await import('puppeteer-core'),chromium=chromiumMod.default||chromiumMod,puppeteer=puppeteerMod.default||puppeteerMod;
  browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true,defaultViewport:{width:1440,height:1050}});
  const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
  await page.goto(airline.url,{waitUntil:'domcontentloaded',timeout:28000});await sleep(1400);
  try{await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||'').trim()));if(b)b.click();});}catch{}
  let text=await safeBodyText(page);const blocked=technicalBlock(text);if(blocked)return{ok:false,technical:true,reason:blocked,airline,debug:{...debug,stage:'OFFICIAL_BLOCKED'}};
  debug.stage='OFFICIAL_SUBMIT';const submitted=await submitOfficial(page,mawb);debug.submit=submitted;if(!submitted.ok)return{ok:false,technical:true,reason:submitted.reason,airline,debug:{...debug,stage:'OFFICIAL_FORM_BLOCKED'}};
  await sleep(3500);try{await page.waitForNetworkIdle({idleTime:700,timeout:9000});}catch{}text=await safeBodyText(page);
  const blockedAfter=technicalBlock(text);if(blockedAfter)return{ok:false,technical:true,reason:blockedAfter,airline,debug:{...debug,stage:'OFFICIAL_BLOCKED_AFTER_SUBMIT'}};
  const parsed=parseOfficialText(text,mawb,airline);if(parsed.notFound)return{ok:false,notFound:true,technical:false,reason:'Official airline website returned no shipment record.',airline,debug:{...debug,stage:'OFFICIAL_NO_RECORD'}};
  if(!parsed.useful)return{ok:false,technical:true,reason:'Official tracking page opened, but the live result is not machine-readable from the server. Use the Official tracker link for this MAWB.',airline,debug:{...debug,stage:'OFFICIAL_RESULT_UNREADABLE'}};
  return{ok:true,airline,shipment:parsed.shipment,debug:{...debug,stage:'OFFICIAL_SUCCESS'}};
 }catch(e){return{ok:false,technical:true,reason:e?.message||'Official airline browser failed.',airline,debug:{...debug,stage:'OFFICIAL_BROWSER_ERROR'}};}finally{if(browser)try{await browser.close();}catch{}}
}
function waiting(mawb,airline,reason=''){return{mawb,carrierCode:airline?.iata||'',airlineName:airline?.name||'',origin:'',destination:'',bags:'',pieces:'',weight:'',flightNo:'',arrivalDate:'',arrivalTime:'',eta:null,actualArrival:null,status:'CHECKING',officialTracker:airline?.url||'',source:`${airline?.name||'Official airline'} official tracker`,message:reason};}
async function handle(mawb){
 const r=await runOfficial(mawb);
 if(r.ok)return Response.json({ok:true,configured:true,provider:`${r.airline.name} official website`,source:`${r.airline.name} official website`,airlinePrimary:true,noPaidApi:true,shipment:r.shipment,trackingDebug:r.debug});
 return Response.json({ok:true,configured:true,provider:'Official airline websites',source:'Official airline tracker',airlinePrimary:true,noPaidApi:true,trackingError:r.reason,trackingDebug:r.debug,officialTracker:r.airline?.url||'',shipment:waiting(mawb,r.airline,r.reason)});
}
export async function GET(request){const u=new URL(request.url),q=u.searchParams.get('mawb');if(!q)return Response.json({configured:true,provider:'Official airline websites',apiKeyRequired:false,noPaidApi:true,mode:'MAWB prefix → official airline tracker → fill MAWB → read result when permitted'});const mawb=normalizeMawb(q);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handle(mawb);}
export async function POST(request){let b={};try{b=await request.json();}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400});}const mawb=normalizeMawb(b?.mawb);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handle(mawb);}
