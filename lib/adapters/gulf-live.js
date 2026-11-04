import fs from 'node:fs';
import { normalizeMawb } from '../airlines.js';

// Gulf Air's 072 AWBs are handled by the carrier's CHAMP webtracking form.
// This is a browser/form adapter; no paid cargo API or screenshot data is used.
const OFFICIAL_URL = 'https://ebooking.champ.aero/webtracking/gf/tracking.asp';
const AIRLINE = { name: 'Gulf Air Cargo', iata: 'GF', url: OFFICIAL_URL };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const tidy = v => String(v ?? '').replace(/\s+/g, ' ').trim();

async function browserConfig() {
  for (const executablePath of [
    process.env.CHROME_EXECUTABLE_PATH, '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/usr/bin/google-chrome'
  ].filter(Boolean)) {
    if (fs.existsSync(executablePath)) {
      return { executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] };
    }
  }
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default || mod;
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

function dateTime(raw) {
  const s = tidy(raw);
  let m = s.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})[ T,]*(\d{1,2}):(\d{2})/);
  if (m) return { date: [m[1],m[2].padStart(2,'0'),m[3].padStart(2,'0')].join('-'), time:m[4].padStart(2,'0')+':'+m[5] };
  m = s.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|\d{2})[ ,T]*(\d{1,2}):(\d{2})/);
  if (m) return { date: (m[3].length===2?'20'+m[3]:m[3])+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'), time:m[4].padStart(2,'0')+':'+m[5] };
  m = s.match(/\b(\d{1,2})[\s/-]+([A-Za-z]{3,9})[\s/,-]+(20\d{2}|\d{2})[ ,T-]*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return { date:'',time:'' };
  const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const month=months[m[2].slice(0,3).toLowerCase()];
  if (!month) return { date:'',time:'' };
  let hour=Number(m[4]);const ap=String(m[6]||'').toUpperCase();
  if(ap==='PM'&&hour<12)hour+=12;if(ap==='AM'&&hour===12)hour=0;
  return {date:(m[3].length===2?'20'+m[3]:m[3])+'-'+month+'-'+m[1].padStart(2,'0'),time:String(hour).padStart(2,'0')+':'+m[5]};
}

function eventCode(row) {
  const s=tidy(row).toUpperCase();
  const m=s.match(/\b(RCF|RCS|DEP|ARR|DLV|NFD|MAN|BKD|FOH|OFF|TRM|AWD)\b/);
  if(m)return m[1];
  if(/\bRECEIVED FROM FLIGHT\b/.test(s))return 'RCF';
  if(/\bFLIGHT ARRIVED\b|\bARRIVED\b/.test(s))return 'ARR';
  if(/\bFLIGHT DEPARTED\b|\bDEPARTED\b/.test(s))return 'DEP';
  if(/\bDELIVERED\b/.test(s))return 'DLV';
  if(/\bMANIFESTED\b/.test(s))return 'MAN';
  if(/\bBOOKED\b|\bACCEPTED\b/.test(s))return 'RCS';
  return '';
}

function statusFor(code, station, destination) {
  if(code==='DLV')return 'DELIVERED';
  if(code==='RCF'||code==='ARR')return station&&destination&&station!==destination?'ARRIVED AT TRANSIT':'ARRIVED';
  if(code==='DEP'||code==='TRM')return 'IN TRANSIT';
  if(code==='OFF')return 'OFFLOADED';
  if(code==='NFD')return 'NOTIFIED CONSIGNEE';
  if(['MAN','FOH'].includes(code))return 'MANIFESTED';
  if(['RCS','BKD'].includes(code))return 'BOOKED';
  return 'TRACKING';
}

function parseLiveResult(raw,mawb) {
  const lines=String(raw||'').replace(/\r/g,'').split(/\n+/).map(tidy).filter(Boolean);
  const text=lines.join(' | ');
  const digits=mawb.replace(/\D/g,'');
  const serial=digits.slice(3);
  if(!text.includes(digits)&&!text.includes(mawb)&&!text.includes(serial))return null;
  if(/no (?:shipment|record|result)|awb not found|not found|invalid (?:awb|air waybill)/i.test(text))return {notFound:true};

  const route=text.match(/\b([A-Z]{3})\s*(?:-|–|—|→|TO)\s*([A-Z]{3})\b/i);
  const field=label=>{
    const l=lines.findIndex(v=>label.test(v));
    if(l<0)return '';
    const same=lines[l].replace(label,'').replace(/^[\s:=-]+/,'').trim();
    return same||lines[l+1]||'';
  };
  const airport=v=>(String(v).toUpperCase().match(/\b[A-Z]{3}\b/)||[])[0]||'';
  const origin=airport(field(/^(?:origin|from|departure station|origin airport)\b\s*[:=-]?/i))||route?.[1]||'';
  const destination=airport(field(/^(?:destination|to|arrival station|destination airport)\b\s*[:=-]?/i))||route?.[2]||'';
  const numberFrom=(pattern)=> {
    const m=text.match(pattern);return m?m[1].replace(/,/g,''):'';
  };
  const pieces=numberFrom(/(?:total\s*)?(?:pieces|pcs|number of pieces|no\.? of pieces|bags)\s*[:=-]?\s*(\d{1,6})\b/i)
    ||numberFrom(/\b(\d{1,6})\s*(?:pcs|pieces|bags)\b/i);
  const weight=numberFrom(/(?:total\s*)?(?:gross\s*)?weight\s*(?:\(kg\))?\s*[:=-]?\s*([\d,.]+)\s*(?:kg|kgs)?\b/i)
    ||numberFrom(/\b([\d,.]+)\s*(?:kg|kgs)\b/i);
  const flights=[...text.matchAll(/\bGF[\s-]*(\d{2,4})\b/gi)];
  const flightNo=flights.length?'GF'+flights.at(-1)[1]:'';

  const events=[];
  for(let i=0;i<lines.length;i++){
    const row=lines[i];
    const code=eventCode(row);
    if(!code)continue;
    // Captured milestones require a real time stamp; never treat static tracking
    // instructions or generic page labels as physical cargo movement.
    const local=dateTime(row);
    const nearby=local.date?local:dateTime(lines.slice(Math.max(0,i-1),Math.min(lines.length,i+3)).join(' '));
    if(!nearby.date)continue;
    const match=row.match(/\b(?:AT|IN|FROM|TO)\s+([A-Z]{3})\b/i)
      ||row.match(/\b([A-Z]{3})\s+(?:GF\s*-?\d|RCS|RCF|ARR|DEP|DLV)\b/i);
    const station=(match?.[1]||'').toUpperCase();
    const f=(row.match(/\bGF[\s-]*(\d{2,4})\b/i)||[])[1]||'';
    const quantity=(row.match(/\b(\d{1,5})\s*(?:PCS|PIECES|BAGS)\b/i)||[])[1]||'';
    const stamp=Date.parse(nearby.date+'T'+(nearby.time||'00:00')+':00Z');
    events.push({code,station,date:nearby.date,time:nearby.time,flightNo:f?'GF'+f:'',pieces:quantity,stamp:Number.isFinite(stamp)?stamp:0,sourceIndex:i});
  }
  events.sort((a,b)=>a.stamp-b.stamp||a.sourceIndex-b.sourceIndex);
  const latest=events.at(-1);
  const status=latest?statusFor(latest.code,latest.station,destination):'TRACKING';
  const arrivalEvents=events.filter(e=>['ARR','RCF'].includes(e.code)&&(!destination||!e.station||e.station===destination));
  const arrival=arrivalEvents.at(-1)||null;
  const explicitEta=text.match(/(?:expected|estimated|scheduled)\s*(?:date\s*(?:and|\/)\s*time\s*of\s*)?arrival[^|]{0,100}/i);
  const estimated=explicitEta?dateTime(explicitEta[0]):{date:'',time:''};
  const arrived=Boolean(arrival && (status==='ARRIVED'||status==='DELIVERED'||status==='NOTIFIED CONSIGNEE'));
  const resultArrival=arrived?{date:arrival.date,time:arrival.time}:estimated;

  // The 072 number is also echoed into the empty CHAMP form after submission.
  // Reject the empty form, even when it contains the entered AWB.
  const useful=Boolean(origin||destination||pieces||weight||flightNo||events.length||estimated.date);
  if(!useful)return null;
  return {shipment:{
    mawb,carrierCode:'GF',airlineName:AIRLINE.name,origin,destination,
    bags:pieces,pieces,weight,flightNo:latest?.flightNo||flightNo,
    status,arrivalDate:resultArrival.date,arrivalTime:resultArrival.time,
    arrivalIsActual:arrived,arrivalEstimate:!arrived&&Boolean(estimated.date),
    eta:!arrived&&estimated.date?estimated.date+'T'+(estimated.time||'00:00')+':00':null,
    actualArrival:arrived?arrival.date+'T'+(arrival.time||'00:00')+':00':null,
    events:events.map(e=>({status:statusFor(e.code,e.station,destination),code:e.code,station:e.station,date:e.date,time:e.time,flightNo:e.flightNo,pieces:e.pieces})),
    officialTracker:OFFICIAL_URL,source:'Gulf Air official CHAMP tracking',timeZone:'Carrier-published local time'
  }};
}

async function pageText(browser) {
  const output=[];
  for(const page of await browser.pages()){
    if(page.isClosed())continue;
    for(const frame of page.frames()){
      try { const value=await frame.evaluate(()=>document.body?.innerText||'');if(value)output.push(value); }catch{}
    }
  }
  return output.join('\n');
}

async function submit(page,mawb) {
  const digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  for(const frame of page.frames()){
    const fields=await frame.$$('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]),textarea');
    const visible=[];
    for(const el of fields){
      try{
        const meta=await el.evaluate(n=>{const r=n.getBoundingClientRect();return{
          visible:r.width>3&&r.height>3&&!n.disabled&&!n.readOnly,
          max:n.maxLength, label:[n.name,n.id,n.placeholder,n.getAttribute('aria-label')].join(' ').toLowerCase(),
          value:n.value||''
        }});
        if(meta.visible)visible.push({el,meta});
      }catch{}
    }
    if(!visible.length)continue;
    const number=visible.find(x=>x.meta.max===8&&/awb|waybill|number/i.test(x.meta.label))
      ||visible.find(x=>x.meta.max===8)
      ||visible.find(x=>/awb|waybill/i.test(x.meta.label)&&!/prefix/i.test(x.meta.label))
      ||visible.at(-1);
    const prefix=visible.find(x=>x!==number&&(/prefix|airline/i.test(x.meta.label)||x.meta.max===3));
    if(prefix){await prefix.el.click({clickCount:3});await prefix.el.type('072');}
    await number.el.click({clickCount:3});await number.el.type(number.meta.max===8?serial:digits);
    const buttons=await frame.$$('button,input[type="submit"],input[type="button"],input[type="image"],a');
    for(const button of buttons){
      try{
        const meta=await button.evaluate(n=>{const r=n.getBoundingClientRect();return{visible:r.width>3&&r.height>3&&!n.disabled,label:[n.innerText,n.value,n.alt,n.title].join(' ').trim()}});
        if(meta.visible&&/^(go|track|track your cargo|track cargo|search|submit|trace)\b/i.test(meta.label)){
          await button.click({delay:40});return true;
        }
      }catch{}
    }
    try{await number.el.press('Enter');return true;}catch{}
  }
  return false;
}

export async function trackGulfLive(inputMawb) {
  const mawb=normalizeMawb(inputMawb);
  if(!mawb||!mawb.startsWith('072-'))return {ok:false,reason:'Not a Gulf Air 072 MAWB',airline:AIRLINE};
  let browser;const debug={stage:'GULF_OPEN',url:OFFICIAL_URL};
  try{
    const mod=await import('puppeteer-core'),puppeteer=mod.default||mod;
    browser=await puppeteer.launch({...await browserConfig(),headless:true,defaultViewport:{width:1440,height:950}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(OFFICIAL_URL,{waitUntil:'domcontentloaded',timeout:25000});
    await pause(800);
    debug.submitted=await submit(page,mawb);
    if(!debug.submitted)return {ok:false,reason:'Gulf Air CHAMP form could not be submitted',airline:AIRLINE,debug:{...debug,stage:'GULF_FORM_UNAVAILABLE'}};
    for(let attempt=0;attempt<15;attempt++){
      await pause(attempt===0?1000:650);
      const text=await pageText(browser);
      const parsed=parseLiveResult(text,mawb);
      if(parsed?.notFound)return {ok:false,reason:'Gulf Air returned no record for this MAWB',notFound:true,airline:AIRLINE,debug:{...debug,stage:'GULF_NO_RECORD'}};
      if(parsed?.shipment)return {ok:true,airline:AIRLINE,shipment:parsed.shipment,debug:{...debug,stage:'GULF_LIVE_OK',eventCount:parsed.shipment.events.length}};
    }
    return {ok:false,reason:'Gulf Air form submitted but no verified shipment details were readable',airline:AIRLINE,debug:{...debug,stage:'GULF_EMPTY_RESULT'}};
  }catch(error){
    return {ok:false,reason:error?.message||'Gulf Air tracker not accessible',airline:AIRLINE,debug:{...debug,stage:'GULF_BROWSER_ERROR'}};
  }finally{if(browser)try{await browser.close();}catch{}}
}
