import fs from 'node:fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = v => String(v || '').replace(/\s+/g, ' ').trim();

async function browserConfig() {
  for (const executablePath of [process.env.CHROME_EXECUTABLE_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean)) {
    if (fs.existsSync(executablePath)) return { executablePath, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote'] };
  }
  const mod = await import('@sparticuz/chromium'); const chromium = mod.default || mod;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

function parseDateTime(text='') {
  const s=clean(text);
  let m=s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if(m) return {date:`${m[1]}-${m[2]}-${m[3]}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
  m=s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})[ ,T]+(\d{1,2}):(\d{2})/);
  if(m){let y=String(m[3]);if(y.length===2)y=`20${y}`;return{date:`${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};}
  m=s.match(/\b(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,](\d{2,4})\s+(\d{1,2}):(\d{2})/i);
  if(!m)return{date:'',time:''};
  const months={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const mon=months[m[2].slice(0,3).toLowerCase()];if(!mon)return{date:'',time:''};let y=String(m[3]);if(y.length===2)y=`20${y}`;
  return{date:`${y}-${mon}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
}

function parsePayload(raw, mawb) {
  const text=clean(raw); const digits=mawb.replace(/\D/g,''); const serial=digits.slice(3);
  if(!text || (!text.includes(digits) && !text.includes(serial))) return null;
  const status=/\bRCF\b|received from flight|\bARR\b|arrived|landed/i.test(text)?'ARRIVED':/\bDEP\b|departed|in transit|airborne/i.test(text)?'IN TRANSIT':/\bRCS\b|booked|manifest/i.test(text)?'BOOKED':'TRACKING';
  const origin=((text.match(/(?:origin|from|departure(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||'').toUpperCase();
  const destination=((text.match(/(?:destination|to|arrival(?: airport| station)?)\s*[:\-]?\s*([A-Z]{3})\b/i)||[])[1]||'').toUpperCase();
  const pieces=(text.match(/(?:pieces?|pcs?|bags?)\s*[:#-]?\s*(\d{1,6})\b/i)||[])[1]||'';
  const weight=((text.match(/(?:gross\s*weight|weight)\s*[:#-]?\s*([\d,.]+)\s*(?:kg|kgs)?/i)||[])[1]||'').replace(/,/g,'');
  const flights=[...text.matchAll(/\bEY[-\s]?(\d{2,4})\b/ig)]; const flightNo=flights.length?`EY${flights.at(-1)[1]}`:'';
  let dt={date:'',time:''}, actual=false;
  const actualChunk=(text.match(/(?:actual arrival|arrived(?: at)?|received from flight|\bRCF\b|\bARR\b)[\s\S]{0,240}/i)||[])[0]||'';
  dt=parseDateTime(actualChunk); actual=Boolean(dt.date);
  if(!dt.date){const etaChunk=(text.match(/(?:estimated arrival|expected arrival|scheduled arrival|\bETA\b)[\s\S]{0,240}/i)||[])[0]||'';dt=parseDateTime(etaChunk);}
  if(!(origin||destination||pieces||weight||flightNo||dt.date||status!=='TRACKING')) return null;
  return {mawb,carrierCode:'EY',airlineName:'Etihad Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:dt.date,arrivalTime:dt.time,arrivalIsActual:actual,eta:dt.date?`${dt.date}T${dt.time}:00`:null,actualArrival:actual&&dt.date?`${dt.date}T${dt.time}:00`:null,status,officialTracker:'https://www.etihadcargo.com/en/e-services/shipment-tracking',source:'Etihad Cargo official shipment tracking'};
}

export async function trackEtihadLive(mawb) {
  const digits=String(mawb).replace(/\D/g,'');
  const airline={name:'Etihad Cargo',iata:'EY',url:'https://www.etihadcargo.com/en/e-services/shipment-tracking'};
  if(!digits.startsWith('607')||digits.length!==11) return {ok:false,airline,reason:'NOT AN ETIHAD AWB',debug:{stage:'validate'}};
  let browser;
  try {
    const puppeteer=(await import('puppeteer-core')).default; const cfg=await browserConfig(); browser=await puppeteer.launch({headless:true,...cfg});
    const page=await browser.newPage(); await page.setUserAgent('Mozilla/5.0'); await page.setViewport({width:1440,height:1000});
    const network=[];
    page.on('response',async r=>{try{const u=r.url();if(/track|shipment|awb|cargo|status|api/i.test(u)){const ct=r.headers()['content-type']||'';if(/json|text|javascript/.test(ct)){const body=await r.text();if(body)network.push({url:u,body:body.slice(0,200000)});}}}catch{}});
    await page.goto(airline.url,{waitUntil:'domcontentloaded',timeout:45000}); await sleep(4000);
    const loginText=clean(await page.evaluate(()=>document.body?.innerText||''));
    if(/log in|sign in|user id|password/i.test(loginText) && !/shipment tracking/i.test(loginText)) return {ok:false,airline,reason:'LOGIN WALL',debug:{stage:'open',url:page.url()}};
    const inputs=await page.$$('input'); let filled=false;
    for(const input of inputs){try{const meta=await input.evaluate(el=>({type:(el.type||'text').toLowerCase(),ph:el.placeholder||'',name:el.name||'',id:el.id||'',max:el.maxLength||0,visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)}));if(!meta.visible||['hidden','password','email','checkbox','radio'].includes(meta.type))continue;const label=`${meta.ph} ${meta.name} ${meta.id}`;if(/awb|air waybill|shipment|tracking/i.test(label)||[8,11,12].includes(meta.max)){const value=meta.max===8?digits.slice(3):digits;await input.click({clickCount:3});await input.type(value,{delay:20});filled=true;break;}}catch{}}
    if(!filled) return {ok:false,airline,reason:'TRACKING FORM NOT ACCESSIBLE',debug:{stage:'form',url:page.url()}};
    const buttons=await page.$$('button,input[type="submit"],input[type="button"],[role="button"]');
    for(const b of buttons){try{const t=await b.evaluate(el=>clean(el.innerText||el.value||el.getAttribute('aria-label')||''));if(/track|search|submit|find|go/i.test(t)){await b.click();break;}}catch{}}
    await sleep(7000);
    for(let i=network.length-1;i>=0;i--){const parsed=parsePayload(network[i].body,mawb);if(parsed)return{ok:true,airline,shipment:parsed,debug:{stage:'network',url:network[i].url}};}
    const body=clean(await page.evaluate(()=>document.body?.innerText||''));
    const parsed=parsePayload(body,mawb); if(parsed)return{ok:true,airline,shipment:parsed,debug:{stage:'page',url:page.url()}};
    if(/log in|sign in|user id|password/i.test(body)) return {ok:false,airline,reason:'LOGIN WALL',debug:{stage:'result',url:page.url()}};
    return {ok:false,airline,reason:'NO MACHINE-READABLE ETIHAD RESULT',debug:{stage:'result',url:page.url(),networkCount:network.length}};
  } catch(e) { return {ok:false,airline,reason:e?.message||'ETIHAD TRACKING FAILED',debug:{stage:'exception'}}; }
  finally { if(browser) try{await browser.close();}catch{} }
}
