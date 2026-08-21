import { GET as fallbackGET, POST as fallbackPOST } from '../../../route';

export const GET = fallbackGET;
export const runtime = 'nodejs';
export const maxDuration = 60;

const AIRLINES = {
  '160': {
    name: 'Cathay Cargo',
    code: 'CX',
    url: 'https://www.cathaycargo.com/usrapps/eservices/track/track.aspx'
  },
  '176': {
    name: 'Emirates SkyCargo',
    code: 'EK',
    url: 'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt'
  }
};

function normMawb(v='') {
  const d=String(v).replace(/\D/g,'');
  return d.length>=11 ? `${d.slice(0,3)}-${d.slice(3,11)}` : String(v).trim();
}

function parseDateTime(raw='') {
  const s=String(raw).replace(/\s+/g,' ').trim();
  if(!s) return null;
  const direct=new Date(s);
  if(!Number.isNaN(direct.getTime())) return direct.toISOString();
  const patterns=[
    /(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})[^\d]{0,5}(\d{1,2})[:.](\d{2})(?:\s*(AM|PM))?/i,
    /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[^\d]{0,5}(\d{1,2})[:.](\d{2})/i
  ];
  let m=s.match(patterns[0]);
  if(m){
    let [,dd,mm,yy,hh,min,ap]=m; let y=+yy; if(y<100)y+=2000; let h=+hh;
    if(ap){ap=ap.toUpperCase(); if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0;}
    const d=new Date(Date.UTC(y,+mm-1,+dd,h,+min)); return Number.isNaN(d.getTime())?null:d.toISOString();
  }
  m=s.match(patterns[1]);
  if(m){ const [,yy,mm,dd,hh,min]=m; const d=new Date(Date.UTC(+yy,+mm-1,+dd,+hh,+min)); return Number.isNaN(d.getTime())?null:d.toISOString(); }
  return null;
}

function first(text, regs){
  for(const r of regs){ const m=String(text).match(r); if(m?.[1]) return m[1].trim(); }
  return '';
}

function parseOfficialText(text, mawb, prefix){
  const t=String(text||'').replace(/\s+/g,' ').trim();
  const cfg=AIRLINES[prefix];
  const digits=mawb.replace(/\D/g,''); const serial=digits.slice(3);
  const hasAwb=t.replace(/\D/g,'').includes(digits)||t.includes(serial);
  if(!hasAwb) return { useful:false, error:`${cfg.name} result page did not contain this AWB.` };

  const flightPrefix=cfg.code;
  const flightNo=first(t,[
    new RegExp(`\\b(${flightPrefix}\\s*[- ]?\\d{2,4})\\b`,'i'),
    /(?:Flight(?:\s*No\.?|\s*Number)?|FLT)\s*[:#-]?\s*([A-Z0-9]{2,3}\s*[- ]?\d{2,4})/i
  ]).replace(/\s+/g,'').toUpperCase();

  const origin=first(t,[
    /(?:AWB\s*Origin|Origin|From|Departure\s*Station|Originating\s*Station)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b([A-Z]{3})\s*(?:-|→|TO)\s*[A-Z]{3}\b/i
  ]).toUpperCase();

  const destination=first(t,[
    /(?:AWB\s*Destination|Destination|To|Arrival\s*Station|Destination\s*Station)\s*[:#-]?\s*([A-Z]{3})\b/i,
    /\b[A-Z]{3}\s*(?:-|→|TO)\s*([A-Z]{3})\b/i
  ]).toUpperCase();

  const bags=first(t,[
    /(?:Pieces|Piece|Pcs|Pkgs|Packages)\s*[:#-]?\s*(\d{1,6})/i,
    /(\d{1,6})\s*(?:PCS|Pieces)\b/i
  ]);
  const weight=first(t,[
    /(?:Gross\s*Weight|Weight)\s*[:#-]?\s*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)?/i,
    /([\d,.]+)\s*(?:KG|KGS)\b/i
  ]).replace(/,/g,'');

  const actualRaw=first(t,[
    /(?:Actual\s*Arrival(?:\s*Time)?|Arrived(?:\s*At|\s*On)?|Arrival\s*Actual)\s*[:#-]?\s*([^|]{6,45})/i,
    /(?:ARR|RCF)[^\d]{0,20}([0-3]?\d[-\/.][0-1]?\d[-\/.]\d{2,4}[^\d]{0,5}[0-2]?\d[:.]\d{2})/i
  ]);
  const etaRaw=first(t,[
    /(?:Estimated\s*Arrival(?:\s*Time)?|Expected\s*Arrival(?:\s*Time)?|ETA)\s*[:#-]?\s*([^|]{6,45})/i,
    /(?:Scheduled\s*Arrival(?:\s*Time)?|STA)\s*[:#-]?\s*([^|]{6,45})/i
  ]);
  const actualArrival=parseDateTime(actualRaw);
  const eta=actualArrival||parseDateTime(etaRaw);

  let status='';
  if(actualArrival||/\bARRIVED\b|\bRCF\b/i.test(t)) status='ARRIVED';
  else if(/\bDEPARTED\b|\bIN\s*TRANSIT\b|\bDEP\b/i.test(t)) status='IN_TRANSIT';
  else if(/\bBOOKED\b|\bRCS\b|\bRECEIVED\b/i.test(t)) status='RECEIVED';

  const useful=Boolean(origin||destination||flightNo||bags||weight||eta||actualArrival||status);
  return {
    useful,
    shipment:{ mawb, carrierCode:cfg.code, origin, destination, flightNo, bags, weight, eta, actualArrival, status:status||`${cfg.name.toUpperCase()} SHIPMENT FOUND`, source:`${cfg.name} official tracker` },
    debug:{ textHint:t.slice(0,1200) }
  };
}

async function setValue(page,el,value){
  await page.evaluate((node,val)=>{
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
    if(setter) setter.call(node,val); else node.value=val;
    node.focus();
    node.dispatchEvent(new Event('input',{bubbles:true}));
    node.dispatchEvent(new Event('change',{bubbles:true}));
    node.dispatchEvent(new Event('blur',{bubbles:true}));
  },el,value);
}

async function fillAndSubmit(page,prefix,serial,digits){
  const inputs=await page.$$('input');
  const list=[];
  for(let i=0;i<inputs.length;i++){
    const m=await inputs[i].evaluate(el=>{const r=el.getBoundingClientRect();return {index:0,type:(el.type||'').toLowerCase(),name:el.name||'',id:el.id||'',placeholder:el.placeholder||'',maxLength:el.maxLength||0,visible:r.width>3&&r.height>3&&!el.disabled};});
    m.index=i; if(m.visible&&['text','number','tel','search',''].includes(m.type)) list.push(m);
  }
  const attrs=x=>`${x.name} ${x.id} ${x.placeholder}`;
  let pre=list.find(x=>/airline.*code|prefix|awb.*pre/i.test(attrs(x)))||list.find(x=>x.maxLength===3);
  let num=list.find(x=>x.index!==pre?.index&&/air.*waybill|awb|waybill|document.*no|awb.*no/i.test(attrs(x))&&(x.maxLength===8||x.maxLength===0||x.maxLength>3))||list.find(x=>x.index!==pre?.index&&x.maxLength===8);

  if(pre&&num){ await setValue(page,inputs[pre.index],prefix); await setValue(page,inputs[num.index],serial); }
  else {
    num=list.find(x=>/air.*waybill|awb|waybill|document/i.test(attrs(x)))||list[0];
    if(!num) return {filled:false,inputs:list};
    await setValue(page,inputs[num.index],digits);
  }

  await new Promise(r=>setTimeout(r,500));
  const clicked=await page.evaluate(()=>{
    const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a')].filter(el=>{const r=el.getBoundingClientRect();return r.width>3&&r.height>3;});
    const txt=el=>(el.innerText||el.value||el.getAttribute('aria-label')||'').trim();
    const b=els.find(el=>/^track$/i.test(txt(el)))||els.find(el=>/track shipment|track|search/i.test(txt(el)));
    if(b){b.click();return true;} return false;
  });
  if(!clicked&&num){
    await page.evaluate(el=>{ if(el.form?.requestSubmit) el.form.requestSubmit(); },inputs[num.index]);
  }
  return {filled:true,clicked,inputs:list};
}

async function officialBrowser(mawb,prefix){
  const cfg=AIRLINES[prefix]; if(!cfg) return {useful:false};
  const digits=mawb.replace(/\D/g,''); const serial=digits.slice(3,11); let browser;
  try{
    const chromiumMod=await import('@sparticuz/chromium');
    const puppeteerMod=await import('puppeteer-core');
    const chromium=chromiumMod.default||chromiumMod; const puppeteer=puppeteerMod.default||puppeteerMod;
    browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true,defaultViewport:{width:1440,height:1100}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(cfg.url,{waitUntil:'networkidle2',timeout:30000});
    await new Promise(r=>setTimeout(r,1800));
    const form=await fillAndSubmit(page,prefix,serial,digits);
    if(!form.filled) return {useful:false,error:`${cfg.name} tracking inputs not found.`,debug:{inputs:form.inputs}};
    try{await page.waitForNetworkIdle({idleTime:1200,timeout:12000});}catch{}
    await new Promise(r=>setTimeout(r,3000));
    const text=await page.evaluate(()=>document.body?.innerText||'');
    const parsed=parseOfficialText(text,mawb,prefix);
    return {...parsed,debug:{...(parsed.debug||{}),clicked:form.clicked}};
  }catch(e){return {useful:false,error:e?.message||`${cfg.name} browser tracking failed`};}
  finally{if(browser)try{await browser.close();}catch{}}
}

function sanitizedFallback(track,mawb,prefix){
  const cfg=AIRLINES[prefix];
  return {
    mawb,
    carrierCode:track?.carrierCode||cfg?.code||'',
    bags:track?.bags||'',
    weight:track?.weight||'',
    flightNo:track?.flightNo||'',
    origin:'', destination:'', eta:null, actualArrival:null,
    status:`WAITING FOR ${cfg?.name?.toUpperCase()||'AIRLINE'} LIVE DATA`,
    source:'Track123 fallback — official origin/ETA/status unavailable'
  };
}

export async function POST(request){
  const body=await request.json();
  const mawb=normMawb(body?.mawb||'');
  const prefix=mawb.replace(/\D/g,'').slice(0,3);
  const cfg=AIRLINES[prefix];
  let official={useful:false};
  if(cfg) official=await officialBrowser(mawb,prefix);

  const fallbackReq=new Request(request.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const fbResp=await fallbackPOST(fallbackReq);
  let fb={}; try{fb=await fbResp.json();}catch{}
  const track=fb?.shipment||{};

  if(cfg&&official.useful){
    const o=official.shipment||{};
    return Response.json({ok:true,source:`${cfg.name} official browser tracker`,airlinePrimary:true,shipment:{
      mawb:o.mawb||mawb,carrierCode:cfg.code,origin:o.origin||'',destination:o.destination||'',eta:o.eta||null,actualArrival:o.actualArrival||null,
      status:o.status||`${cfg.name.toUpperCase()} SHIPMENT FOUND`,flightNo:o.flightNo||track.flightNo||'',bags:o.bags||track.bags||'',weight:o.weight||track.weight||'',source:`${cfg.name} official tracker`
    },airlineDebug:official.debug||null});
  }

  if(cfg){
    return Response.json({ok:true,source:`${cfg.name} official tracker unavailable; sanitized Track123 fallback`,airlinePrimary:false,airlineError:official.error||null,airlineDebug:official.debug||null,shipment:sanitizedFallback(track,mawb,prefix)});
  }

  return Response.json(fb,{status:fbResp.status});
}
