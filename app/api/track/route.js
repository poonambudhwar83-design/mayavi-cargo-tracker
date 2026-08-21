export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TRACKJET_URL = 'https://trackjet.world/';
const MONTHS={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

function normalizeMawb(v=''){
  const d=String(v).replace(/\D/g,'');
  return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:'';
}
function esc(s=''){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function localDate(m){
  if(!m)return{date:'',time:''};
  let y=String(m[3]); if(y.length===2)y=`20${y}`;
  return{date:`${y}-${MONTHS[String(m[2]).toLowerCase()]||'01'}-${String(m[1]).padStart(2,'0')}`,time:`${String(m[4]).padStart(2,'0')}:${m[5]}`};
}
function statusFromText(t=''){
  if(/notified consignee/i.test(t))return'NOTIFIED CONSIGNEE';
  if(/received at destination/i.test(t))return'RECEIVED AT DESTINATION';
  if(/\bdelivered\b|\bdlv\b/i.test(t))return'DELIVERED';
  if(/\barrived\b|\brcf\b/i.test(t))return'ARRIVED';
  if(/\bdelay(?:ed)?\b|\blate\b/i.test(t))return'DELAYED';
  if(/\bdeparted\b|\bdep\b|\bin transit\b/i.test(t))return'IN_TRANSIT';
  if(/\breceived\b|\brcs\b|\bbooked\b/i.test(t))return'RECEIVED';
  return'TRACKING';
}
function parseCarrierText(raw,mawb,iata=''){
  const t=clean(raw);
  const route=t.match(new RegExp(`${esc(mawb)}\\s*\\(\\s*([A-Z]{3})\\s*[-–—>]\\s*([A-Z]{3})\\s*\\)`,'i'))||t.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const pcs=t.match(/(\d{1,6})\s*(?:Piece\(s\)|Pieces?|Pcs)\b/i);
  const wt=t.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i);
  const code=String(iata||'').toUpperCase();
  const re=code?new RegExp(`\\b(${esc(code)})[-\\s]?(\\d{2,4})\\b`,'gi'):/\b([A-Z0-9]{2})[-\s]?(\d{2,4})\b/g;
  const flights=[...t.matchAll(re)].map(m=>`${m[1].toUpperCase()}${m[2]}`);
  const flightNo=flights.at(-1)||'';
  const arrived=t.match(/Arrived\s*\(\s*([A-Z]{3})\s*\)\s*(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/i);
  let arrivalDate='',arrivalTime='',arrivalActual=false;
  if(arrived){const p=localDate([arrived[0],arrived[2],arrived[3],arrived[4],arrived[5],arrived[6]]);arrivalDate=p.date;arrivalTime=p.time;arrivalActual=true;}
  if(!arrivalDate&&flightNo){
    const dashed=flightNo.replace(/([A-Z]+)(\d+)/,'$1-$2');
    const idx=Math.max(t.lastIndexOf(dashed),t.lastIndexOf(flightNo));
    const tail=idx>=0?t.slice(idx,idx+450):t;
    const ds=[...tail.matchAll(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/g)];
    if(ds.length){const p=localDate(ds.at(-1));arrivalDate=p.date;arrivalTime=p.time;}
  }
  const status=statusFromText(t);
  const origin=route?.[1]?.toUpperCase()||'';
  const destination=(arrived?.[1]||route?.[2]||'').toUpperCase();
  const useful=Boolean(origin||destination||pcs||wt||flightNo||arrivalDate||/notified consignee|received at destination|arrived|delivered|departed/i.test(t));
  return{useful,shipment:{mawb,carrierCode:code,origin,destination,bags:pcs?.[1]||'',pieces:pcs?.[1]||'',weight:(wt?.[1]||'').replace(/,/g,''),flightNo,arrivalDate,arrivalTime,eta:null,actualArrival:null,arrivalIsActual:arrivalActual,status,source:'TrackJet handoff → carrier official result'}};
}

async function setInput(page,h,value){
  await page.evaluate((el,val)=>{const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(el,val);else el.value=val;el.focus();['input','change'].forEach(x=>el.dispatchEvent(new Event(x,{bubbles:true})));},h,value);
}
async function visibleInput(page,purpose='trackjet'){
  const all=await page.$$('input');
  for(const h of all){
    const m=await h.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>5&&r.height>5&&!el.disabled,type:(el.type||'').toLowerCase(),label:`${el.placeholder||''} ${el.name||''} ${el.id||''}`,max:el.maxLength||0,value:el.value||''};});
    if(!m.visible||!['text','search','tel','number',''].includes(m.type))continue;
    if(purpose==='trackjet'&&/track|number|mawb|awb|paste/i.test(m.label))return{h,m};
    if(purpose==='carrier'&&/track|number|mawb|awb|waybill|document/i.test(m.label))return{h,m};
  }
  return null;
}
async function clickByText(page,re,selectors='button,input[type="submit"],input[type="button"],a'){
  const hs=await page.$$(selectors);
  for(const h of hs){
    const m=await h.evaluate((el,o)=>{const re=new RegExp(o.src,o.flags);const r=el.getBoundingClientRect();const text=(el.innerText||el.value||el.getAttribute('aria-label')||'').trim();return{match:r.width>4&&r.height>4&&re.test(text),text,href:el.href||el.getAttribute('href')||'',dataHref:el.getAttribute('data-href')||el.getAttribute('data-url')||el.getAttribute('data-target-url')||''};},{src:re.source,flags:re.flags});
    if(!m.match)continue;
    try{await h.click({delay:80});return{clicked:true,...m};}catch(e){return{clicked:false,...m,error:e?.message||String(e)};}
  }
  return{clicked:false};
}
async function pageLinks(page){
  return page.evaluate(()=>[...document.querySelectorAll('a')].map(a=>({text:(a.innerText||a.getAttribute('aria-label')||'').trim(),href:a.href||a.getAttribute('href')||''})).filter(x=>x.href));
}
async function waitForExternalPage(browser,originPage,ms=14000){
  const end=Date.now()+ms;
  while(Date.now()<end){
    for(const p of await browser.pages()){
      if(p===originPage)continue;
      const u=p.url();
      if(!/^https?:\/\//i.test(u))continue;
      try{if(new URL(u).hostname!=='trackjet.world')return p;}catch{}
    }
    try{const u=originPage.url();if(/^https?:\/\//i.test(u)&&new URL(u).hostname!=='trackjet.world')return originPage;}catch{}
    await sleep(500);
  }
  return null;
}
async function maybeSubmitCarrier(page,mawb){
  const serial=mawb.replace(/\D/g,'').slice(3),prefix=mawb.slice(0,3);
  const text=clean(await page.evaluate(()=>document.body?.innerText||''));
  if(text.includes(mawb)&&/Piece\(s\)|Pieces?|Pcs|Arrived|Received|Notified consignee|Tracking Details/i.test(text))return{attempted:false};
  const all=await page.$$('input');let pre=null,num=null;
  for(let i=0;i<all.length;i++){
    const m=await all[i].evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>4&&r.height>4&&!el.disabled,max:el.maxLength||0,label:`${el.name||''} ${el.id||''} ${el.placeholder||''}`,value:el.value||''};});
    if(!m.visible)continue;
    if(!pre&&(m.max===3||/prefix/i.test(m.label)))pre={h:all[i],m};
    if(!num&&(m.max===8||/awb|mawb|waybill|number/i.test(m.label)))num={h:all[i],m};
  }
  try{
    if(pre&&num){if(!pre.m.value)await setInput(page,pre.h,prefix);if(!num.m.value)await setInput(page,num.h,serial);}else{const one=await visibleInput(page,'carrier');if(one&&!one.m.value)await setInput(page,one.h,mawb.replace(/\D/g,''));}
    const c=await clickByText(page,/track shipment|^track$|search|submit/i,'button,input[type="submit"],input[type="button"]');
    if(c.clicked){await sleep(5000);return{attempted:true,clicked:c.text};}
  }catch{}
  return{attempted:true,clicked:''};
}

async function trackJetHandoff(page,browser,mawb,debug){
  let handoff=await clickByText(page,/^Open tracking on /i,'a,button');
  if(!handoff.clicked)handoff=await clickByText(page,/Open tracking on|official tracking|track on/i,'a,button');
  if(handoff.clicked){
    debug.handoff=handoff;
    let ext=await waitForExternalPage(browser,page,14000);
    if(ext)return ext;
    const direct=handoff.href||handoff.dataHref||'';
    if(/^https?:\/\//i.test(direct)){try{if(new URL(direct).hostname!=='trackjet.world'){await page.goto(direct,{waitUntil:'domcontentloaded',timeout:25000});return page;}}catch{}}
  }

  // Some carriers (for example Saudia) expose no "Open tracking on ..." button on /track.
  // In that case use TrackJet's own airline directory page as the second routing step.
  const links=await pageLinks(page);
  const airlineLink=links.find(x=>/\/airline\//i.test(x.href));
  if(airlineLink){
    debug.handoffFallback='TRACKJET_AIRLINE_DIRECTORY';
    debug.airlineDirectory=airlineLink.href;
    await page.goto(airlineLink.href,{waitUntil:'domcontentloaded',timeout:25000});
    await sleep(1200);

    // First try the directory page's MAWB form; TrackJet says this reaches the carrier's official tracking.
    const input=await visibleInput(page,'trackjet');
    if(input){
      await setInput(page,input.h,mawb);
      const before=page.url();
      let c=await clickByText(page,/^track$/i,'button,input[type="submit"],input[type="button"]');
      if(!c.clicked)try{await page.evaluate(el=>el.form?.requestSubmit?.(),input.h);}catch{}
      debug.directoryTrack=c;
      const ext=await waitForExternalPage(browser,page,10000);
      if(ext)return ext;
      try{if(page.url()!==before&&new URL(page.url()).hostname!=='trackjet.world')return page;}catch{}
    }

    // If TrackJet only provides a carrier-site link, use that and let Mayavi submit the MAWB there.
    const dirLinks=await pageLinks(page);
    const external=dirLinks.find(x=>{try{return /^https?:\/\//i.test(x.href)&&new URL(x.href).hostname!=='trackjet.world'&&/visit|cargo|airline|official/i.test(x.text+' '+x.href);}catch{return false;}})
      ||dirLinks.find(x=>{try{return /^https?:\/\//i.test(x.href)&&new URL(x.href).hostname!=='trackjet.world';}catch{return false;}});
    if(external){
      debug.directoryExternal=external;
      await page.goto(external.href,{waitUntil:'domcontentloaded',timeout:25000});
      return page;
    }
  }
  return null;
}

async function runTrackJet(mawb){
  let browser;const debug={stage:'START',mawb};
  try{
    const chromiumMod=await import('@sparticuz/chromium'),puppeteerMod=await import('puppeteer-core');
    const chromium=chromiumMod.default||chromiumMod,puppeteer=puppeteerMod.default||puppeteerMod;
    browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true,defaultViewport:{width:1440,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});

    debug.stage='TRACKJET_OPEN';
    await page.goto(TRACKJET_URL,{waitUntil:'domcontentloaded',timeout:25000});await sleep(1000);
    const inp=await visibleInput(page,'trackjet');
    if(!inp)return{ok:false,error:'TrackJet tracking input was not found.',debug:{...debug,stage:'TRACKJET_INPUT'}};
    await setInput(page,inp.h,mawb);
    let submit=await clickByText(page,/^track$/i,'button,input[type="submit"],input[type="button"]');
    if(!submit.clicked)try{await page.evaluate(el=>el.form?.requestSubmit?.(),inp.h);}catch{}
    debug.stage='TRACKJET_RESULT';
    for(let i=0;i<16;i++){await sleep(500);const text=clean(await page.evaluate(()=>document.body?.innerText||''));if(/We found your carrier|Open tracking on|IATA\s+[A-Z0-9]{2}|\/airline\//i.test(text)||page.url().includes('/track/'))break;}
    const tjText=clean(await page.evaluate(()=>document.body?.innerText||''));
    debug.trackjetUrl=page.url();debug.trackjetHint=tjText.slice(0,700);
    const iata=(tjText.match(/\bIATA\s+([A-Z0-9]{2})\b/i)||[])[1]||'';
    debug.iata=iata;

    debug.stage='TRACKJET_HANDOFF';
    const carrierPage=await trackJetHandoff(page,browser,mawb,debug);
    if(!carrierPage)return{ok:false,error:'TrackJet identified the carrier, but no usable carrier handoff or airline-directory link was exposed.',debug:{...debug,stage:'TRACKJET_HANDOFF_UNAVAILABLE'}};

    debug.stage='CARRIER_OPEN';
    await sleep(2000);
    try{await carrierPage.waitForNetworkIdle({idleTime:900,timeout:10000});}catch{}
    debug.carrierUrl=carrierPage.url();
    if(!/^https?:\/\//i.test(debug.carrierUrl))return{ok:false,error:`Carrier window did not navigate to a real page (${debug.carrierUrl}).`,debug:{...debug,stage:'TRACKJET_HANDOFF_BLANK_POPUP'}};
    let text=clean(await carrierPage.evaluate(()=>document.body?.innerText||''));
    if(/captcha|verify you are human|access denied|forbidden|robot check|one moment please|unusual traffic/i.test(text))return{ok:false,error:'Carrier page presented an access/CAPTCHA challenge. Mayavi will not bypass it.',debug:{...debug,stage:'CARRIER_CHALLENGE',carrierHint:text.slice(0,700)}};

    debug.carrierSubmit=await maybeSubmitCarrier(carrierPage,mawb);
    text=clean(await carrierPage.evaluate(()=>document.body?.innerText||''));
    debug.carrierHint=text.slice(0,1000);
    const parsed=parseCarrierText(text,mawb,iata);
    if(!parsed.useful)return{ok:false,error:'TrackJet handoff reached the carrier, but readable shipment details were not found.',debug:{...debug,stage:'PARSE_CARRIER'}};
    return{ok:true,shipment:parsed.shipment,debug:{...debug,stage:'SUCCESS'}};
  }catch(e){return{ok:false,error:e?.message||String(e),debug:{...debug,stage:'BROWSER_ERROR',message:e?.message||String(e)}};}
  finally{if(browser)try{await browser.close();}catch{}}
}

function waiting(mawb,stage=''){return{mawb,carrierCode:'',origin:'',destination:'',bags:'',weight:'',flightNo:'',arrivalDate:'',arrivalTime:'',eta:null,actualArrival:null,status:'WAITING FOR LIVE DATA',source:`TrackJet → carrier${stage?` · ${stage}`:''}`};}
async function handleMawb(mawb){const r=await runTrackJet(mawb);return r.ok?Response.json({ok:true,configured:true,provider:'TrackJet → carrier',source:'TrackJet handoff → carrier official result',airlinePrimary:true,shipment:r.shipment,trackingDebug:r.debug}):Response.json({ok:true,configured:true,provider:'TrackJet → carrier',source:'TrackJet handoff diagnostic',airlinePrimary:true,trackingError:r.error,trackingDebug:r.debug,shipment:waiting(mawb,r.debug?.stage||'')});}
export async function GET(request){const u=new URL(request.url),q=u.searchParams.get('mawb');if(!q)return Response.json({configured:true,provider:'TrackJet → carrier',apiKeyRequired:false,mode:'public TrackJet routing + airline directory fallback'});const m=normalizeMawb(q);if(!m)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handleMawb(m);}
export async function POST(request){let b={};try{b=await request.json();}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400});}const m=normalizeMawb(b?.mawb);if(!m)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handleMawb(m);}
