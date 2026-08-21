export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TRACKJET_URL = 'https://trackjet.world/';
const MONTHS = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function normalizeMawb(value=''){
  const d=String(value).replace(/\D/g,'');
  return d.length===11 ? `${d.slice(0,3)}-${d.slice(3)}` : '';
}
function esc(s=''){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function cleanText(s=''){ return String(s||'').replace(/\s+/g,' ').trim(); }
function localDate(parts){
  if(!parts)return {date:'',time:''};
  let [,dd,mon,yy,hh,mm]=parts;
  let y=String(yy); if(y.length===2)y=`20${y}`;
  return {date:`${y}-${MONTHS[String(mon).toLowerCase()]||'01'}-${String(dd).padStart(2,'0')}`,time:`${String(hh).padStart(2,'0')}:${mm}`};
}
function statusFromText(t=''){
  if(/notified consignee/i.test(t)) return 'NOTIFIED CONSIGNEE';
  if(/received at destination/i.test(t)) return 'RECEIVED AT DESTINATION';
  if(/\bdelivered\b|\bdlv\b/i.test(t)) return 'DELIVERED';
  if(/\barrived\b|\brcf\b/i.test(t)) return 'ARRIVED';
  if(/\bdelay(?:ed)?\b|\blate\b/i.test(t)) return 'DELAYED';
  if(/\bdeparted\b|\bdep\b|\bin transit\b/i.test(t)) return 'IN_TRANSIT';
  if(/\breceived\b|\brcs\b|\bbooked\b/i.test(t)) return 'RECEIVED';
  return 'TRACKING';
}

function parseCarrierText(raw, mawb, iata=''){
  const t=cleanText(raw);
  const route=t.match(new RegExp(`${esc(mawb)}\\s*\\(\\s*([A-Z]{3})\\s*[-–—>]\\s*([A-Z]{3})\\s*\\)`,'i')) ||
              t.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const pcs=t.match(/(\d{1,6})\s*(?:Piece\(s\)|Pieces?|Pcs)\b/i);
  const wt=t.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i);
  const code=(iata||'').toUpperCase();
  const flightRe=code ? new RegExp(`\\b(${esc(code)})[-\\s]?(\\d{2,4})\\b`,'gi') : /\b([A-Z0-9]{2})[-\s]?(\d{2,4})\b/g;
  const flights=[...t.matchAll(flightRe)].map(m=>`${m[1].toUpperCase()}${m[2]}`);
  const flightNo=flights.length?flights[flights.length-1]:'';

  const arrived=t.match(/Arrived\s*\(\s*([A-Z]{3})\s*\)\s*(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/i);
  let arrivalDate='',arrivalTime='',arrivalActual=false;
  if(arrived){
    const p=localDate([arrived[0],arrived[2],arrived[3],arrived[4],arrived[5],arrived[6]]);
    arrivalDate=p.date; arrivalTime=p.time; arrivalActual=true;
  }
  if(!arrivalDate && flightNo){
    const dashed=flightNo.replace(/([A-Z]+)(\d+)/,'$1-$2');
    const idx=t.lastIndexOf(dashed)>=0 ? t.lastIndexOf(dashed) : t.lastIndexOf(flightNo);
    const tail=idx>=0?t.slice(idx,idx+350):t;
    const dts=[...tail.matchAll(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/g)];
    if(dts.length){ const p=localDate(dts[dts.length-1]); arrivalDate=p.date; arrivalTime=p.time; }
  }

  const status=statusFromText(t);
  const origin=route?.[1]?.toUpperCase()||'';
  const destination=(arrived?.[1]||route?.[2]||'').toUpperCase();
  const useful=Boolean(origin||destination||pcs||wt||flightNo||arrivalDate||/notified consignee|received at destination|arrived|delivered|departed/i.test(t));
  return {
    useful,
    shipment:{
      mawb, carrierCode:code, origin, destination,
      bags:pcs?.[1]||'', pieces:pcs?.[1]||'', weight:(wt?.[1]||'').replace(/,/g,''),
      flightNo, arrivalDate, arrivalTime,
      eta:null, actualArrival:null, arrivalIsActual:arrivalActual,
      status, source:'TrackJet handoff → carrier official result'
    }
  };
}

async function setInput(page, handle, value){
  await page.evaluate((el,val)=>{
    const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    if(setter)setter.call(el,val); else el.value=val;
    el.focus();
    ['input','change'].forEach(e=>el.dispatchEvent(new Event(e,{bubbles:true})));
  },handle,value);
}

async function visibleInput(page, purpose='trackjet'){
  const inputs=await page.$$('input');
  for(const h of inputs){
    const m=await h.evaluate(el=>{const r=el.getBoundingClientRect();return {visible:r.width>5&&r.height>5&&!el.disabled,type:(el.type||'').toLowerCase(),ph:el.placeholder||'',name:el.name||'',id:el.id||'',max:el.maxLength||0,value:el.value||''};});
    if(!m.visible||!['text','search','tel','number',''].includes(m.type))continue;
    const label=`${m.ph} ${m.name} ${m.id}`;
    if(purpose==='trackjet' && /track|number|mawb|awb|paste/i.test(label)) return {h,m};
    if(purpose==='carrier' && /track|number|mawb|awb|waybill|document/i.test(label)) return {h,m};
  }
  for(const h of inputs){
    const m=await h.evaluate(el=>{const r=el.getBoundingClientRect();return {visible:r.width>5&&r.height>5&&!el.disabled,type:(el.type||'').toLowerCase(),ph:el.placeholder||'',name:el.name||'',id:el.id||'',max:el.maxLength||0,value:el.value||''};});
    if(m.visible&&['text','search','tel','number',''].includes(m.type))return {h,m};
  }
  return null;
}

// Use a real Puppeteer click, not DOM el.click(). TrackJet opens some carrier links
// from a user gesture; synthetic DOM clicks can be ignored or popup-blocked.
async function clickByText(page, re, selectors='button,input[type="submit"],input[type="button"],a'){
  const handles=await page.$$(selectors);
  for(const h of handles){
    const meta=await h.evaluate((el,{src,flags})=>{
      const re=new RegExp(src,flags);
      const r=el.getBoundingClientRect();
      const text=(el.innerText||el.value||el.getAttribute('aria-label')||'').trim();
      return {
        match:r.width>4&&r.height>4&&re.test(text),
        text,
        href:el.href||el.getAttribute('href')||'',
        target:el.target||'',
        dataHref:el.getAttribute('data-href')||el.getAttribute('data-url')||el.getAttribute('data-target-url')||'',
        tag:el.tagName||''
      };
    },{src:re.source,flags:re.flags});
    if(!meta.match)continue;
    try{
      await h.click({delay:80});
      return {clicked:true,...meta};
    }catch(e){
      return {clicked:false,...meta,error:e?.message||String(e)};
    }
  }
  return {clicked:false};
}

async function maybeSubmitCarrier(page, mawb){
  const serial=mawb.replace(/\D/g,'').slice(3); const prefix=mawb.slice(0,3);
  let txt=cleanText(await page.evaluate(()=>document.body?.innerText||''));
  if(txt.includes(mawb) && /Piece\(s\)|Pieces?|Pcs|Arrived|Received|Notified consignee|Tracking Details/i.test(txt)) return {attempted:false};

  const all=await page.$$('input'); let pre=null,num=null;
  for(let i=0;i<all.length;i++){
    const m=await all[i].evaluate(el=>{const r=el.getBoundingClientRect();return {i:0,visible:r.width>4&&r.height>4&&!el.disabled,max:el.maxLength||0,label:`${el.name||''} ${el.id||''} ${el.placeholder||''}`,value:el.value||''};}); m.i=i;
    if(!m.visible)continue;
    if(!pre && (m.max===3||/prefix/i.test(m.label)))pre={h:all[i],m};
    if(!num && (m.max===8||/awb|mawb|waybill|number/i.test(m.label)))num={h:all[i],m};
  }
  try{
    if(pre&&num){ if(!pre.m.value)await setInput(page,pre.h,prefix); if(!num.m.value)await setInput(page,num.h,serial); }
    else {
      const one=await visibleInput(page,'carrier'); if(one&&!one.m.value)await setInput(page,one.h,mawb.replace(/\D/g,''));
    }
    const c=await clickByText(page,/track shipment|^track$|search|submit/i,'button,input[type="submit"],input[type="button"]');
    if(c.clicked){ await sleep(4500); return {attempted:true,clicked:c.text}; }
  }catch{}
  return {attempted:true,clicked:''};
}

async function runTrackJet(mawb){
  let browser; const debug={stage:'START',mawb};
  try{
    const chromiumMod=await import('@sparticuz/chromium');
    const puppeteerMod=await import('puppeteer-core');
    const chromium=chromiumMod.default||chromiumMod; const puppeteer=puppeteerMod.default||puppeteerMod;
    const executablePath=await chromium.executablePath();
    debug.chromiumPath=executablePath?String(executablePath).split('/').slice(-2).join('/'):'missing';
    browser=await puppeteer.launch({args:chromium.args,executablePath,headless:true,defaultViewport:{width:1440,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});

    debug.stage='TRACKJET_OPEN';
    await page.goto(TRACKJET_URL,{waitUntil:'domcontentloaded',timeout:25000});
    await sleep(1200);
    const inp=await visibleInput(page,'trackjet');
    if(!inp)return {ok:false,error:'TrackJet tracking input was not found.',debug:{...debug,stage:'TRACKJET_INPUT'}};
    await setInput(page,inp.h,mawb);
    let submit=await clickByText(page,/^track$/i,'button,input[type="submit"],input[type="button"]');
    if(!submit.clicked)submit=await clickByText(page,/track/i,'button,input[type="submit"],input[type="button"]');
    if(!submit.clicked){
      try{await page.evaluate(el=>el.form?.requestSubmit?.(),inp.h);}catch{}
    }

    debug.stage='TRACKJET_RESULT';
    for(let i=0;i<16;i++){
      await sleep(500);
      const host=new URL(page.url()).hostname;
      const text=cleanText(await page.evaluate(()=>document.body?.innerText||''));
      if(host!=='trackjet.world' || /We found your carrier|Open tracking on/i.test(text))break;
    }
    const trackjetText=cleanText(await page.evaluate(()=>document.body?.innerText||''));
    debug.trackjetUrl=page.url();
    debug.trackjetHint=trackjetText.slice(0,500);
    const iata=(trackjetText.match(/\bIATA\s+([A-Z0-9]{2})\b/i)||[])[1]||'';
    debug.iata=iata;

    let carrierPage=page;
    if(new URL(page.url()).hostname==='trackjet.world'){
      debug.stage='TRACKJET_HANDOFF';
      const before=await browser.pages();
      let handoff=await clickByText(page,/^Open tracking on /i,'a,button');
      if(!handoff.clicked){
        await sleep(1200);
        handoff=await clickByText(page,/Open tracking on/i,'a,button');
      }
      debug.handoff=handoff;
      if(!handoff.clicked)return {ok:false,error:'TrackJet found the carrier, but no carrier handoff button was exposed.',debug};

      // Give a trusted click time to create a popup or same-tab navigation.
      for(let i=0;i<14;i++){
        await sleep(500);
        const after=await browser.pages();
        const external=after.find(p=>p!==page && (()=>{try{return new URL(p.url()).hostname!=='trackjet.world';}catch{return false;}})());
        if(external){ carrierPage=external; break; }
        try{
          if(new URL(page.url()).hostname!=='trackjet.world'){ carrierPage=page; break; }
        }catch{}
      }

      // If TrackJet exposed a direct carrier URL but its popup was blocked, navigate to that URL ourselves.
      if(carrierPage===page && new URL(page.url()).hostname==='trackjet.world'){
        const direct=handoff.href||handoff.dataHref||'';
        if(/^https?:\/\//i.test(direct)){
          try{
            const host=new URL(direct).hostname;
            if(host!=='trackjet.world'){
              debug.handoffFallback='DIRECT_URL';
              await page.goto(direct,{waitUntil:'domcontentloaded',timeout:25000});
              carrierPage=page;
            }
          }catch{}
        }
      }

      const after=await browser.pages();
      debug.pageUrls=after.map(p=>p.url()).slice(-6);
      if(carrierPage===page && new URL(page.url()).hostname==='trackjet.world'){
        return {ok:false,error:'TrackJet handoff button was clicked, but the browser remained on TrackJet. The carrier window/link did not open.',debug:{...debug,stage:'TRACKJET_HANDOFF_NOT_OPENED'}};
      }
    }

    debug.stage='CARRIER_OPEN';
    try{await carrierPage.waitForNetworkIdle({idleTime:900,timeout:12000});}catch{}
    await sleep(2500);
    debug.carrierUrl=carrierPage.url();
    let carrierText=cleanText(await carrierPage.evaluate(()=>document.body?.innerText||''));
    const challenge=/captcha|verify you are human|access denied|forbidden|robot check|one moment please|unusual traffic/i.test(carrierText);
    if(challenge)return {ok:false,error:'Carrier page presented an access/CAPTCHA challenge. Mayavi will not bypass it.',debug:{...debug,stage:'CARRIER_CHALLENGE',carrierHint:carrierText.slice(0,600)}};

    const carrierSubmit=await maybeSubmitCarrier(carrierPage,mawb);
    debug.carrierSubmit=carrierSubmit;
    carrierText=cleanText(await carrierPage.evaluate(()=>document.body?.innerText||''));
    debug.carrierHint=carrierText.slice(0,800);

    const parsed=parseCarrierText(carrierText,mawb,iata);
    if(!parsed.useful)return {ok:false,error:'TrackJet handoff reached the carrier, but readable shipment details were not found.',debug:{...debug,stage:'PARSE_CARRIER'}};
    return {ok:true,shipment:parsed.shipment,debug:{...debug,stage:'SUCCESS'}};
  }catch(e){
    return {ok:false,error:e?.message||String(e),debug:{...debug,stage:'BROWSER_ERROR',message:e?.message||String(e)}};
  }finally{ if(browser)try{await browser.close();}catch{} }
}

function waiting(mawb, message=''){
  return {mawb,carrierCode:'',origin:'',destination:'',bags:'',weight:'',flightNo:'',arrivalDate:'',arrivalTime:'',eta:null,actualArrival:null,status:'WAITING FOR LIVE DATA',source:`TrackJet → carrier${message?` · ${message}`:''}`};
}

async function handleMawb(mawb){
  const result=await runTrackJet(mawb);
  if(result.ok){
    return Response.json({ok:true,configured:true,provider:'TrackJet → carrier',source:'TrackJet handoff → carrier official result',airlinePrimary:true,shipment:result.shipment,trackingDebug:result.debug});
  }
  return Response.json({ok:true,configured:true,provider:'TrackJet → carrier',source:'TrackJet handoff diagnostic',airlinePrimary:true,trackingError:result.error,trackingDebug:result.debug,shipment:waiting(mawb,result.debug?.stage||'')});
}

export async function GET(request){
  const url=new URL(request.url); const q=url.searchParams.get('mawb');
  if(!q)return Response.json({configured:true,provider:'TrackJet → carrier',apiKeyRequired:false,mode:'public TrackJet handoff then carrier result'});
  const mawb=normalizeMawb(q); if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handleMawb(mawb);
}

export async function POST(request){
  let body={}; try{body=await request.json();}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400});}
  const mawb=normalizeMawb(body?.mawb); if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handleMawb(mawb);
}
