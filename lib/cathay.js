import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const AIRLINE={name:'Cathay Cargo',iata:'CX',url:CATHAY};
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseDateTime(value='',fallbackYear=''){
  const s=String(value).toUpperCase(),m=s.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+(20\d{2}))?(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};const mon=m[2]==='SEPT'?'SEP':m[2],year=m[3]||fallbackYear||String(new Date().getUTCFullYear());return{date:`${year}-${MONTH[mon]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
}

function parseTimeline(text='',mawb=''){
  const flat=String(text||'').replace(/\\u003c/gi,'<').replace(/\\n/g,' ').replace(/\s+/g,' ').trim();
  if(!/\bAccepted\b|\bDeparted\b|\bArrived\b|Current\s+status/i.test(flat))return null;
  const accepted=[...flat.matchAll(/\b([A-Z]{3})\s+Accepted\b/gi)].map(m=>m[1].toUpperCase()),departed=[...flat.matchAll(/\b([A-Z]{3})\s+Departed\b/gi)].map(m=>m[1].toUpperCase()),arrived=[...flat.matchAll(/\b([A-Z]{3})\s+Arrived\b/gi)].map(m=>m[1].toUpperCase());
  const origin=departed[0]||accepted[0]||'',destination=arrived.at(-1)||'',year=(flat.match(/\b(20\d{2})\b/)||[])[1]||String(new Date().getUTCFullYear());
  const cards=[...flat.matchAll(/\b(CX\s*\d{2,4})\b[\s\S]{0,320}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*)\s+(\d{1,2}:\d{2})[\s\S]{0,260}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*)\s+(\d{1,2}:\d{2})/gi)],card=cards.at(-1);
  const flightNo=(card?.[1]||flat.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase(),departure=card?parseDateTime(`${card[2]} ${card[3]}`,year):{date:'',time:''},arrival=card?parseDateTime(`${card[4]} ${card[5]}`,year):{date:'',time:''};
  const summary=flat.match(/\b(\d{1,5})\s*pc\(s\)\s*[|｜]\s*([\d,.]+)\s*kg\b/i)||flat.match(/\b(\d{1,5})\s*(?:pcs?|pieces?)\b[\s\S]{0,45}?\b([\d,.]+)\s*kg\b/i),pieces=summary?.[1]||'',weight=(summary?.[2]||'').replace(/,/g,'');
  const atDestination=Boolean(destination&&new RegExp(`\\b${destination}\\s+Arrived\\b`,'i').test(flat)),delivered=/Current\s+status\s*:\s*Delivered/i.test(flat)||/\bDelivered\b[\s\S]{0,35}?\b([1-9]\d*)\s*\/\s*\1\b/i.test(flat),status=delivered?'DELIVERED':atDestination?'ARRIVED':departed.length?'IN TRANSIT':accepted.length?'BOOKED':'TRACKING';
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:Boolean(atDestination&&arrival.date&&arrival.time),status,officialTracker:CATHAY,source:'Cathay Cargo Track & Trace timeline',arrivalTimeSource:'Cathay flight card right-side arrival time',departureDate:departure.date,departureTime:departure.time};
}

function stripHtml(html=''){return String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();}
function terminalParse(html='',mawb=''){
  const text=stripHtml(html),digits=mawb.replace(/\D/g,''),serial=digits.slice(3);if((!text.includes(digits)&&!text.includes(serial))||/Reject Reason|is not found|no record/i.test(text))return null;
  const route=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/(?:Routing|Route)\s+([A-Z]{3})\s+(?:to|[-–>])?\s*([A-Z]{3})/i),rcs=text.match(/Received from Shipper[\s\S]{0,1600}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i),flight=(text.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
  const actual=[...text.matchAll(/(?:Actual Arrival|Arrived|ATA)[\s\S]{0,420}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20\d{2}\s+\d{1,2}:\d{2})/gi)].map(m=>parseDateTime(m[1])).filter(x=>x.date&&x.time).at(-1)||{date:'',time:''},booking=rcs?parseDateTime(rcs[1]):{date:'',time:''},pieces=rcs?.[2]||'',weight=(rcs?.[3]||'').replace(/,/g,'');
  return{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:route?.[1]||'',destination:route?.[2]||'',bags:pieces,pieces,weight,bookingDate:booking.date,flightNo:flight,arrivalDate:actual.date,arrivalTime:actual.time,arrivalIsActual:Boolean(actual.date&&actual.time),status:actual.date?'ARRIVED':flight?'IN TRANSIT':rcs?'BOOKED':'TRACKING',officialTracker:CATHAY,source:'Cathay Cargo Terminal fallback'};
}
async function fetchHtml(url){try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml'},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(9000)});return r.ok?await r.text():null;}catch{return null;}}
async function terminalFallback(mawb){const suffix=mawb.replace(/\D/g,'').slice(3);for(const url of [`${TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`]){const html=await fetchHtml(url);if(!html)continue;const shipment=terminalParse(html,mawb);if(shipment)return{shipment,url};}return null;}

async function launchBrowser(){chromium.setGraphicsMode=false;const executablePath=await chromium.executablePath();return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-US,en'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath,headless:'shell'});}
async function deepText(page){let merged='';for(const frame of page.frames()){try{merged+='\n'+await frame.evaluate(()=>{const out=[document.body?.innerText||''];for(const el of document.querySelectorAll('*'))if(el.shadowRoot){const t=el.shadowRoot.innerText||el.shadowRoot.textContent||'';if(t)out.push(t);}return out.join('\n');});}catch{}}return merged;}
async function acceptCookiesDeep(page){
  let clicked=false;for(let round=0;round<5;round++){for(const frame of page.frames()){try{const c=await frame.evaluate(()=>{const roots=[document];for(const e of document.querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);for(const root of roots){const els=[...root.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]')];const b=els.find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.value||x.textContent||x.getAttribute('aria-label')||'').trim()));if(b){b.click();return true;}}return false;});clicked=clicked||c;}catch{}}if(clicked){await sleep(700);break;}await sleep(500);}return clicked;
}
async function clickTrackNow(page){return page.evaluate(()=>{const visible=n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>16&&r.height>10&&!n.disabled;};const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible),btn=els.find(n=>/^track\s*now$/i.test((n.innerText||n.value||n.textContent||n.getAttribute('aria-label')||'').trim()));if(!btn)return'';const t=(btn.innerText||btn.value||btn.textContent||'').trim();btn.click();return t||'Track now';}).catch(()=> '');}
async function expandAndScroll(page){await sleep(1600);await page.evaluate(()=>{const visible=n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>15&&r.height>10&&!n.disabled;};const els=[...document.querySelectorAll('button,[role="button"],a')].filter(visible),b=els.find(n=>/show all details|show details|view details|expand/i.test((n.innerText||n.textContent||n.getAttribute('aria-label')||n.getAttribute('title')||'').trim()));if(b)b.click();}).catch(()=>{});let latest='';for(let i=0;i<12;i++){await page.evaluate(y=>window.scrollTo(0,y),i*520).catch(()=>{});await sleep(450);latest=await deepText(page);if(/Current\s+status|\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b|\bCX\s*\d{2,4}\b[\s\S]{0,700}\bArrived\b/i.test(latest))break;}return latest||deepText(page);}

async function setValue(page,handle,value){await handle.click({clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await handle.type(String(value),{delay:60});await sleep(200);return handle.evaluate(e=>String(e.value||e.textContent||''));}
async function enterAwb(page,serial){
  const airline=await page.$('input[aria-label*="Airline" i],input[id*="airlinecodefield" i],input[placeholder="160"]');if(!airline)return{ok:false,mode:'no-airline-input'};
  const airlineValue=await setValue(page,airline,'160');
  let awb=await page.$('input[name$="_airWaybill" i],input[id*="airWaybill" i],input[placeholder*="12345678"],textarea[name$="_airWaybill" i],[contenteditable="true"][aria-label*="waybill" i],[role="textbox"][aria-label*="waybill" i]');
  let beforeCommit='',mode='direct-awb-input';
  if(awb){beforeCommit=await setValue(page,awb,serial);await awb.press('Enter').catch(()=>{});}
  else{mode='retype-160-tab-awb-enter';await airline.click();await page.keyboard.press('Tab');await sleep(250);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.keyboard.type(serial,{delay:65});await sleep(300);beforeCommit=await page.evaluate(()=>String(document.activeElement?.value||document.activeElement?.textContent||''));await page.keyboard.press('Enter');}
  await sleep(650);const body=(await deepText(page)).replace(/\s/g,'');return{ok:body.includes(serial),mode,beforeCommit,airlineValue};
}

async function mainTimeline(mawb){
  const serial=mawb.replace(/\D/g,'').slice(3);let browser;const network=[];
  try{
    browser=await launchBrowser();const page=await browser.newPage();page.on('response',async response=>{try{const u=response.url(),ct=(response.headers()['content-type']||'').toLowerCase();if(!/(json|text|xml)/.test(ct)&&!/track|trace|shipment|awb|cargo/i.test(u))return;const body=await response.text();if(!body||body.length>300000)return;if(body.includes(serial)||/CX\s*\d{2,4}|shipment|awb|arrival|depart/i.test(body))network.push({url:u,status:response.status(),body:body.slice(0,180000)});}catch{}});
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:22000});await sleep(1800);const cookies=await acceptCookiesDeep(page);await sleep(900);
    const entry=await enterAwb(page,serial),clicked=await clickTrackNow(page);await Promise.race([page.waitForNetworkIdle({idleTime:800,timeout:9000}).catch(()=>{}),sleep(9000)]);const pageText=await expandAndScroll(page),networkText=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot/i.test(x.url)).map(x=>x.body).join('\n'),combined=`${pageText}\n${networkText}`,shipment=parseTimeline(combined,mawb);
    const networkDebug=network.filter(x=>!/static\/js|clientlibs|qualtrics|chatbot/i.test(x.url)).slice(-12).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1800)}));
    return shipment?{ok:true,shipment,debug:{stage:'TIMELINE',cookies,entry,clicked,pageText:pageText.slice(0,9000),network:networkDebug}}:{ok:false,reason:'CATHAY MAIN TIMELINE NOT PARSED',debug:{stage:'NO_TIMELINE',cookies,entry,clicked,pageText:pageText.slice(0,9000),network:networkDebug}};
  }catch(e){return{ok:false,reason:e?.message||'Cathay main page failed',debug:{stage:'ERROR',message:e?.message||''}};}finally{try{if(browser)await browser.close();}catch{}}
}
function mergeMain(main={},fallback={}){const out={...fallback};for(const [k,v] of Object.entries(main||{}))if(v!==''&&v!==null&&v!==undefined)out[k]=v;if(main.origin)out.origin=main.origin;if(main.destination)out.destination=main.destination;if(main.arrivalDate)out.arrivalDate=main.arrivalDate;if(main.arrivalTime)out.arrivalTime=main.arrivalTime;if(main.flightNo)out.flightNo=main.flightNo;if(main.status)out.status=main.status;if(main.arrivalDate&&main.arrivalTime)out.arrivalIsActual=main.arrivalIsActual===true;return out;}
export async function trackCathay(input){const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('160-'))return{ok:false,reason:'INVALID CATHAY MAWB',airline:AIRLINE};const [mainResult,terminalResult]=await Promise.all([Promise.race([mainTimeline(mawb),new Promise(r=>setTimeout(()=>r({ok:false,reason:'CATHAY MAIN PAGE TIMEOUT',debug:{stage:'TIMEOUT'}}),42000))]),terminalFallback(mawb)]),fallback=terminalResult?.shipment||{};if(mainResult?.ok){const shipment=mergeMain(mainResult.shipment,fallback);shipment.source='Cathay Cargo Track & Trace timeline';return{ok:true,airline:AIRLINE,shipment,debug:{source:'cathay-main-timeline',main:mainResult.debug,terminalUrl:terminalResult?.url||''}};}if(terminalResult?.shipment)return{ok:true,airline:AIRLINE,shipment:terminalResult.shipment,debug:{source:'cathay-terminal-fallback',mainError:mainResult?.reason||'',main:mainResult?.debug||null,terminalUrl:terminalResult.url}};return{ok:false,airline:AIRLINE,reason:mainResult?.reason||'CATHAY DATA NOT EXTRACTED',debug:{main:mainResult?.debug||null}};}
