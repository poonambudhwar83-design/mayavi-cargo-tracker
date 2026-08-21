import { GET as fallbackGET, POST as fallbackPOST } from '../../../route';

export const GET = fallbackGET;
export const runtime = 'nodejs';
export const maxDuration = 60;

const AIRLINES = {
  '157': { name:'Qatar Airways Cargo', code:'QR', url:'https://www.qrcargo.com/s/track-your-shipment' },
  '160': { name:'Cathay Cargo', code:'CX', url:'https://www.cathaycargo.com/usrapps/eservices/track/track.aspx' },
  '176': { name:'Emirates SkyCargo', code:'EK', url:'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt' }
};

function normMawb(v=''){
  const d=String(v).replace(/\D/g,'');
  return d.length>=11 ? `${d.slice(0,3)}-${d.slice(3,11)}` : String(v).trim();
}
function first(text, regs){
  for(const r of regs){ const m=String(text||'').match(r); if(m?.[1]) return m[1].trim(); }
  return '';
}
function parseDateTime(raw=''){
  const s=String(raw||'').replace(/\s+/g,' ').trim();
  if(!s) return null;
  const d=new Date(s);
  if(!Number.isNaN(d.getTime())) return d.toISOString();
  let m=s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})[^\d]{0,8}(\d{1,2})[:.](\d{2})(?:\s*(AM|PM))?/i);
  if(m){
    let [,dd,mm,yy,hh,min,ap]=m; let y=+yy; if(y<100)y+=2000; let h=+hh;
    if(ap){ ap=ap.toUpperCase(); if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0; }
    const x=new Date(Date.UTC(y,+mm-1,+dd,h,+min)); return Number.isNaN(x.getTime())?null:x.toISOString();
  }
  m=s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[^\d]{0,8}(\d{1,2})[:.](\d{2})/i);
  if(m){ const [,yy,mm,dd,hh,min]=m; const x=new Date(Date.UTC(+yy,+mm-1,+dd,+hh,+min)); return Number.isNaN(x.getTime())?null:x.toISOString(); }
  return null;
}

function parseOfficialText(text,mawb,prefix){
  const cfg=AIRLINES[prefix];
  const t=String(text||'').replace(/\\u003c/gi,'<').replace(/\\u003e/gi,'>').replace(/\s+/g,' ').trim();
  const digits=mawb.replace(/\D/g,''); const serial=digits.slice(3);
  const hasAwb=t.replace(/\D/g,'').includes(digits)||t.includes(serial);
  if(!hasAwb) return {useful:false,error:`${cfg.name} response did not contain this AWB.`};

  const flightNo=first(t,[
    new RegExp(`\\b(${cfg.code}\\s*[- ]?\\d{2,4})\\b`,'i'),
    /(?:flight(?:\s*no\.?|\s*number)?|flt|flightNumber|flightNo)["'\s:=_-]*([A-Z0-9]{2,3}\s*[- ]?\d{2,4})/i
  ]).replace(/\s+/g,'').toUpperCase();
  const origin=first(t,[
    /(?:awb\s*origin|originAirport|originCode|departureAirport|origin|from|departure\s*station)["'\s:=_-]*([A-Z]{3})\b/i,
    /\b([A-Z]{3})\s*(?:-|→|TO)\s*[A-Z]{3}\b/i
  ]).toUpperCase();
  const destination=first(t,[
    /(?:awb\s*destination|destinationAirport|destinationCode|arrivalAirport|destination|to|arrival\s*station)["'\s:=_-]*([A-Z]{3})\b/i,
    /\b[A-Z]{3}\s*(?:-|→|TO)\s*([A-Z]{3})\b/i
  ]).toUpperCase();
  const bags=first(t,[
    /(?:pieces|pieceCount|piecesCount|pcs|pkgs|packages)["'\s:=_-]*(\d{1,6})/i,
    /(\d{1,6})\s*(?:PCS|Pieces)\b/i
  ]);
  const weight=first(t,[
    /(?:grossWeight|totalWeight|weight)["'\s:=_-]*([\d,.]+)\s*(?:KG|KGS|KILOGRAMS?)?/i,
    /([\d,.]+)\s*(?:KG|KGS)\b/i
  ]).replace(/,/g,'');

  const actualRaw=first(t,[
    /(?:actualArrivalTime|actualArrival|arrivedAt|actual\s*arrival|arrival\s*actual)["'\s:=_-]*([^|,}\]]{6,45})/i,
    /(?:ARR|RCF)[^\d]{0,25}([0-3]?\d[-\/.][0-1]?\d[-\/.]\d{2,4}[^\d]{0,8}[0-2]?\d[:.]\d{2})/i
  ]);
  const etaRaw=first(t,[
    /(?:estimatedArrivalTime|estimatedArrival|etaDateTime|eta|expected\s*arrival|estimated\s*arrival)["'\s:=_-]*([^|,}\]]{6,45})/i,
    /(?:scheduledArrivalTime|scheduledArrival|STA|scheduled\s*arrival)["'\s:=_-]*([^|,}\]]{6,45})/i
  ]);
  const actualArrival=parseDateTime(actualRaw);
  const eta=actualArrival||parseDateTime(etaRaw);

  let status='';
  if(actualArrival||/\bARRIVED\b|\bRCF\b/i.test(t)) status='ARRIVED';
  else if(/\bDELAY(?:ED)?\b|\bLATE\b/i.test(t)) status='DELAYED';
  else if(/\bDEPARTED\b|\bIN\s*TRANSIT\b|\bDEP\b/i.test(t)) status='IN_TRANSIT';
  else if(/\bBOOKED\b|\bRCS\b|\bRECEIVED\b/i.test(t)) status='RECEIVED';

  const useful=Boolean(origin||destination||flightNo||bags||weight||eta||actualArrival||status);
  return {useful,shipment:{mawb,carrierCode:cfg.code,origin,destination,flightNo,bags,weight,eta,actualArrival,status:status||`${cfg.name.toUpperCase()} SHIPMENT FOUND`,source:`${cfg.name} official website`}};
}

async function setValue(page,el,value){
  await page.evaluate((node,val)=>{
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
    if(setter) setter.call(node,val); else node.value=val;
    node.focus();
    for(const ev of ['input','change','keyup','blur']) {
      if(ev==='keyup') node.dispatchEvent(new KeyboardEvent(ev,{bubbles:true,key:'Tab'}));
      else node.dispatchEvent(new Event(ev,{bubbles:true}));
    }
  },el,value);
}

async function fillAndSubmit(page,prefix,serial,digits){
  const inputs=await page.$$('input'); const list=[];
  for(let i=0;i<inputs.length;i++){
    const m=await inputs[i].evaluate(el=>{
      const r=el.getBoundingClientRect();
      return {index:0,type:(el.type||'').toLowerCase(),name:el.name||'',id:el.id||'',placeholder:el.placeholder||'',maxLength:el.maxLength||0,visible:r.width>3&&r.height>3&&!el.disabled,value:el.value||''};
    });
    m.index=i; if(m.visible&&['text','number','tel','search',''].includes(m.type)) list.push(m);
  }
  const a=x=>`${x.name} ${x.id} ${x.placeholder}`;
  let pre=list.find(x=>/prefix|awb.*pre|airline.*code|document.*pre/i.test(a(x)))||list.find(x=>x.maxLength===3);
  let num=list.find(x=>x.index!==pre?.index&&/awb|waybill|document|tracking/i.test(a(x))&&(x.maxLength===8||x.maxLength===0||x.maxLength>3))||list.find(x=>x.index!==pre?.index&&x.maxLength===8);
  if(pre&&num){ await setValue(page,inputs[pre.index],prefix); await setValue(page,inputs[num.index],serial); }
  else {
    num=list.find(x=>/awb|waybill|document|tracking/i.test(a(x)))||list[0];
    if(!num) return {filled:false,reason:'NO_VISIBLE_AWB_INPUT',inputs:list};
    await setValue(page,inputs[num.index],digits);
  }
  await new Promise(r=>setTimeout(r,500));

  // IMPORTANT: submit from the AWB input's own form. The old code could click a top navigation "Track" link.
  const submitResult=await page.evaluate(({numIndex})=>{
    const allInputs=[...document.querySelectorAll('input')];
    const field=allInputs[numIndex];
    if(!field) return {submitted:false,method:'NO_FIELD'};
    const form=field.form||field.closest('form');
    const text=el=>(el.innerText||el.value||el.getAttribute('aria-label')||'').trim();
    if(form){
      const controls=[...form.querySelectorAll('button,input[type="submit"],input[type="button"]')];
      const btn=controls.find(el=>/track shipment|^track$|search|submit|go/i.test(text(el)));
      if(btn){btn.click();return {submitted:true,method:'FORM_BUTTON',buttonText:text(btn)};}
      if(typeof form.requestSubmit==='function'){form.requestSubmit();return {submitted:true,method:'FORM_REQUEST_SUBMIT'};}
      form.submit(); return {submitted:true,method:'FORM_SUBMIT'};
    }
    const buttons=[...document.querySelectorAll('button,input[type="submit"],input[type="button"]')].filter(el=>{const r=el.getBoundingClientRect();return r.width>3&&r.height>3;});
    const btn=buttons.find(el=>/track shipment|^track$|search|submit|go/i.test(text(el)));
    if(btn){btn.click();return {submitted:true,method:'PAGE_BUTTON',buttonText:text(btn)};}
    return {submitted:false,method:'NO_SUBMIT_CONTROL'};
  },{numIndex:num.index});

  return {filled:true,submitted:submitResult.submitted,submitMethod:submitResult.method,buttonText:submitResult.buttonText||'',inputs:list,prefixInput:pre||null,awbInput:num||null};
}

async function officialBrowser(mawb,prefix){
  const cfg=AIRLINES[prefix]; if(!cfg)return {useful:false};
  const digits=mawb.replace(/\D/g,''); const serial=digits.slice(3,11); let browser;
  const captured=[]; const responseMeta=[];
  try{
    const chromiumMod=await import('@sparticuz/chromium'); const puppeteerMod=await import('puppeteer-core');
    const chromium=chromiumMod.default||chromiumMod; const puppeteer=puppeteerMod.default||puppeteerMod;
    browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true,defaultViewport:{width:1440,height:1100}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});

    page.on('response',async res=>{
      try{
        const type=res.request().resourceType();
        if(!['xhr','fetch','document'].includes(type))return;
        const ct=String(res.headers()['content-type']||'');
        const url=res.url();
        responseMeta.push({status:res.status(),type,url:url.slice(0,220),contentType:ct.slice(0,80)});
        if(!/json|text|javascript|html/i.test(ct))return;
        const body=await res.text();
        if(body&&body.length<1500000&&(body.includes(serial)||body.replace(/\D/g,'').includes(digits)||/arrival|flight|shipment|waybill|awb/i.test(body))) captured.push(body);
      }catch{}
    });

    await page.goto(cfg.url,{waitUntil:'networkidle2',timeout:30000});
    await new Promise(r=>setTimeout(r,1800));
    const initialUrl=page.url();
    const form=await fillAndSubmit(page,prefix,serial,digits);
    if(!form.filled)return {useful:false,error:`${cfg.name}: no visible AWB input was found.`,debug:{stage:'FIND_AWB_INPUT',reason:form.reason,inputs:form.inputs||[],initialUrl}};
    if(!form.submitted)return {useful:false,error:`${cfg.name}: AWB fields were filled, but no shipment submit control was found.`,debug:{stage:'SUBMIT_AWB',submitMethod:form.submitMethod,inputs:form.inputs||[],prefixInput:form.prefixInput,awbInput:form.awbInput,initialUrl}};

    try{await page.waitForNetworkIdle({idleTime:1200,timeout:15000});}catch{}
    await new Promise(r=>setTimeout(r,3500));

    const bodyText=await page.evaluate(()=>document.body?.innerText||'');
    const finalUrl=page.url();
    const combined=[bodyText,...captured].join(' ');
    const parsed=parseOfficialText(combined,mawb,prefix);
    const challenge=/captcha|access denied|forbidden|robot|verify you are human|sorry to interrupt|one moment please|transaction is not allowed/i.test(bodyText);
    const debug={
      stage:parsed.useful?'PARSE_SUCCESS':'PARSE_RESULT',
      initialUrl,finalUrl,
      submitMethod:form.submitMethod,
      buttonText:form.buttonText,
      prefixInput:form.prefixInput,
      awbInput:form.awbInput,
      capturedResponses:captured.length,
      recentResponses:responseMeta.slice(-12),
      bodyHasAwb:bodyText.includes(serial)||bodyText.replace(/\D/g,'').includes(digits),
      challengeDetected:challenge,
      bodyHint:bodyText.replace(/\s+/g,' ').slice(0,900)
    };
    return {...parsed,error:parsed.useful?'':`${cfg.name}: form submitted, but the returned page/network data did not expose readable shipment details.`,debug};
  }catch(e){return {useful:false,error:e?.message||`${cfg.name} official tracking failed`,debug:{stage:'BROWSER_ERROR',message:e?.message||String(e)}};}
  finally{if(browser)try{await browser.close();}catch{}}
}

function waitingShipment(mawb,prefix){
  const cfg=AIRLINES[prefix];
  return {mawb,carrierCode:cfg?.code||'',bags:'',weight:'',flightNo:'',origin:'',destination:'',eta:null,actualArrival:null,status:`WAITING FOR ${cfg?.name?.toUpperCase()||'AIRLINE'} OFFICIAL DATA`,source:`${cfg?.name||'Airline'} official website only`};
}

export async function POST(request){
  const body=await request.json(); const mawb=normMawb(body?.mawb||'');
  const prefix=mawb.replace(/\D/g,'').slice(0,3); const cfg=AIRLINES[prefix];

  if(cfg){
    const official=await officialBrowser(mawb,prefix);
    if(official.useful){
      return Response.json({ok:true,source:`${cfg.name} official website`,airlinePrimary:true,shipment:official.shipment,airlineDebug:official.debug||null});
    }
    return Response.json({ok:true,source:`${cfg.name} official website — diagnostic failure`,airlinePrimary:true,airlineError:official.error||null,airlineDebug:official.debug||null,shipment:waitingShipment(mawb,prefix)});
  }

  const fallbackReq=new Request(request.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return fallbackPOST(fallbackReq);
}
