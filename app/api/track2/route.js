import { GET as currentGET, POST as currentPOST } from '../track/route';

export const GET = currentGET;
export const runtime = 'nodejs';
export const maxDuration = 60;

const EMIRATES_FLIGHT_STATUS_URL = 'https://www.emirates.com/english/manage-booking/flight-status/';

function normalizeMawb(v='') {
  const d=String(v).replace(/\D/g,'');
  return d.length>=11 ? `${d.slice(0,3)}-${d.slice(3,11)}` : String(v).trim();
}

function isoDate(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function first(text, regs){
  for(const r of regs){ const m=String(text||'').match(r); if(m?.[1]) return m[1].trim(); }
  return '';
}

function parseTimeOnDate(raw,dateIso){
  const s=String(raw||'').trim();
  if(!s) return null;
  const direct=new Date(s);
  if(!Number.isNaN(direct.getTime()) && /\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(s)) return direct.toISOString();
  const m=s.match(/(\d{1,2})[:.](\d{2})(?:\s*(AM|PM))?/i);
  if(!m) return null;
  let h=Number(m[1]); const min=Number(m[2]); const ap=(m[3]||'').toUpperCase();
  if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0;
  const d=new Date(`${dateIso}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`);
  return Number.isNaN(d.getTime())?null:d.toISOString();
}

function parseFlightText(text,flightNo,dateIso){
  const t=String(text||'').replace(/\s+/g,' ').trim();
  const n=flightNo.replace(/\s+/g,'').toUpperCase();
  if(!t.toUpperCase().includes(n) && !t.toUpperCase().includes(n.replace(/^EK/,''))) return {useful:false};

  const origin=first(t,[
    /(?:Departure(?: airport)?|Departing from|From)\s*[:\-]?\s*([A-Z]{3})\b/i,
    /\(([A-Z]{3})\)\s*(?:Departure|Departing|From)/i
  ]).toUpperCase();

  const destination=first(t,[
    /(?:Arrival(?: airport)?|Arriving at|Going to|To)\s*[:\-]?\s*([A-Z]{3})\b/i,
    /\(([A-Z]{3})\)\s*(?:Arrival|Arriving|To)/i
  ]).toUpperCase();

  const actualRaw=first(t,[
    /(?:Actual arrival|Arrived at|Actual time)\s*[:\-]?\s*([^|]{4,30})/i
  ]);
  const estimatedRaw=first(t,[
    /(?:Estimated arrival|Expected arrival|Estimated time)\s*[:\-]?\s*([^|]{4,30})/i
  ]);
  const scheduledRaw=first(t,[
    /(?:Scheduled arrival|Scheduled time|Arrival time)\s*[:\-]?\s*([^|]{4,30})/i
  ]);

  const actualArrival=parseTimeOnDate(actualRaw,dateIso);
  const eta=actualArrival||parseTimeOnDate(estimatedRaw,dateIso)||parseTimeOnDate(scheduledRaw,dateIso);

  let status='';
  if(actualArrival||/\bARRIVED\b|\bLANDED\b/i.test(t)) status='ARRIVED';
  else if(/\bDELAYED\b|\bDELAY\b/i.test(t)) status='DELAYED';
  else if(/\bDEPARTED\b|\bIN FLIGHT\b|\bAIRBORNE\b/i.test(t)) status='IN_TRANSIT';
  else if(/\bON TIME\b|\bSCHEDULED\b/i.test(t)) status='ON_TIME';

  return {
    useful:Boolean(origin||destination||eta||actualArrival||status),
    origin,destination,eta,actualArrival,status,
    source:'Emirates official flight status',
    debug:t.slice(0,1400)
  };
}

async function setNativeValue(page,el,value){
  await page.evaluate((node,val)=>{
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
    if(setter) setter.call(node,val); else node.value=val;
    node.focus();
    node.dispatchEvent(new Event('input',{bubbles:true}));
    node.dispatchEvent(new Event('change',{bubbles:true}));
    node.dispatchEvent(new Event('blur',{bubbles:true}));
  },el,value);
}

async function tryEmiratesDate(page,flightNo,dateIso){
  await page.goto(EMIRATES_FLIGHT_STATUS_URL,{waitUntil:'networkidle2',timeout:30000});
  await new Promise(r=>setTimeout(r,1500));

  try{
    await page.evaluate(()=>{
      const buttons=[...document.querySelectorAll('button')];
      const b=buttons.find(x=>/accept all|accept cookies|agree/i.test((x.innerText||'').trim()));
      if(b)b.click();
    });
  }catch{}

  const inputs=await page.$$('input');
  const meta=[];
  for(let i=0;i<inputs.length;i++){
    const m=await inputs[i].evaluate(el=>{const r=el.getBoundingClientRect();return {index:0,type:(el.type||'').toLowerCase(),name:el.name||'',id:el.id||'',placeholder:el.placeholder||'',maxLength:el.maxLength||0,visible:r.width>3&&r.height>3&&!el.disabled};});
    m.index=i; if(m.visible)meta.push(m);
  }
  const attrs=x=>`${x.name} ${x.id} ${x.placeholder}`;
  const flight=meta.find(x=>/flight.*number|flight.*no|flight/i.test(attrs(x))&&['text','number','tel','search',''].includes(x.type))||meta.find(x=>x.maxLength>=3&&x.maxLength<=8&&['text','number','tel','search',''].includes(x.type));
  const date=meta.find(x=>x.type==='date'||/date|departure.*day|depart.*date/i.test(attrs(x)));
  if(!flight)return {useful:false,error:'Emirates flight-number input not found'};

  const numeric=flightNo.replace(/^EK/i,'').replace(/\D/g,'');
  await setNativeValue(page,inputs[flight.index],numeric||flightNo);
  if(date)await setNativeValue(page,inputs[date.index],dateIso);

  await new Promise(r=>setTimeout(r,400));
  await page.evaluate(()=>{
    const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"]')];
    const txt=el=>(el.innerText||el.value||'').trim();
    const b=els.find(el=>/check status|view details|search|submit/i.test(txt(el)));
    if(b)b.click();
  });

  try{await page.waitForNetworkIdle({idleTime:1000,timeout:12000});}catch{}
  await new Promise(r=>setTimeout(r,2500));
  const text=await page.evaluate(()=>document.body?.innerText||'');
  return parseFlightText(text,flightNo,dateIso);
}

async function emiratesFlightStatus(flightNo){
  if(!/^EK\s*\d{2,4}$/i.test(String(flightNo||'').trim()))return {useful:false};
  let browser;
  try{
    const chromiumMod=await import('@sparticuz/chromium');
    const puppeteerMod=await import('puppeteer-core');
    const chromium=chromiumMod.default||chromiumMod;
    const puppeteer=puppeteerMod.default||puppeteerMod;
    browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true,defaultViewport:{width:1440,height:1100}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    const today=new Date();
    const offsets=[0,-1,1,-2,2];
    for(const off of offsets){
      const d=new Date(today); d.setDate(d.getDate()+off);
      const result=await tryEmiratesDate(page,String(flightNo).replace(/\s+/g,'').toUpperCase(),isoDate(d));
      if(result.useful)return result;
    }
    return {useful:false,error:'Emirates flight status did not return machine-readable arrival data for the checked dates.'};
  }catch(e){
    return {useful:false,error:e?.message||'Emirates flight status browser failed'};
  }finally{ if(browser)try{await browser.close();}catch{} }
}

export async function POST(request){
  const body=await request.json();
  const innerReq=new Request(request.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const innerResp=await currentPOST(innerReq);
  let data={}; try{data=await innerResp.json();}catch{}

  const mawb=normalizeMawb(body?.mawb||data?.shipment?.mawb||'');
  const prefix=mawb.replace(/\D/g,'').slice(0,3);
  const shipment=data?.shipment||{};

  if(prefix==='176' && shipment.flightNo){
    const fs=await emiratesFlightStatus(shipment.flightNo);
    if(fs.useful){
      return Response.json({
        ...data,
        ok:true,
        source:'Emirates official flight status after MAWB flight identification',
        flightStage:true,
        shipment:{
          ...shipment,
          origin:fs.origin||shipment.origin||'',
          destination:fs.destination||shipment.destination||'',
          eta:fs.eta||shipment.eta||null,
          actualArrival:fs.actualArrival||shipment.actualArrival||null,
          status:fs.status||shipment.status||'FLIGHT FOUND',
          source:'Emirates official flight status'
        },
        flightDebug:fs.debug||null
      });
    }
    return Response.json({...data,flightStage:false,flightError:fs.error||null},{status:innerResp.status});
  }

  return Response.json(data,{status:innerResp.status});
}
