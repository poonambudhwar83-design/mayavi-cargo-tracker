export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TRACKJET_URL = 'https://trackjet.world/';
const MONTHS = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function normalizeMawb(v=''){
  const d=String(v).replace(/\D/g,'');
  return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:'';
}
function esc(s=''){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function isTrackJetUrl(value=''){
  try{const h=new URL(value).hostname.toLowerCase();return h==='trackjet.world'||h.endsWith('.trackjet.world');}catch{return false;}
}
function isExternalHttp(value=''){return /^https?:\/\//i.test(value)&&!isTrackJetUrl(value);}
function isNavigationRace(error){
  return /execution context was destroyed|cannot find context with specified id|inspected target navigated or closed|most likely because of a navigation|frame was detached/i.test(String(error?.message||error||''));
}
function safeUrl(page){try{return page&&!page.isClosed()?page.url():'';}catch{return '';}}
async function safeBodyText(page,retries=4){
  for(let i=0;i<retries;i++){
    try{return clean(await page.evaluate(()=>document.body?.innerText||''));}
    catch(e){if(!isNavigationRace(e))throw e;await sleep(450);}
  }
  return '';
}
function localDate(m){
  if(!m)return{date:'',time:''};
  let y=String(m[3]);if(y.length===2)y=`20${y}`;
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
  const t=clean(raw),compact=mawb.replace(/\D/g,''),serial=compact.slice(3);
  const route=t.match(new RegExp(`${esc(mawb)}\\s*\\(\\s*([A-Z]{3})\\s*[-–—>→]+\\s*([A-Z]{3})\\s*\\)`,'i'))||t.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>)\s*([A-Z]{3})\b/);
  const pcs=t.match(/(\d{1,6})\s*(?:Piece\(s\)|Pieces?|Pcs)\b/i)||t.match(/(?:Piece\(s\)|Pieces?|Pcs)\s*[:#-]?\s*(\d{1,6})\b/i);
  const wt=t.match(/([\d,.]+)\s*(?:kg|kgs|kilograms?)\b/i)||t.match(/(?:weight|gross weight)\s*[:#-]?\s*([\d,.]+)/i);
  const code=String(iata||'').toUpperCase();
  const re=code?new RegExp(`\\b(${esc(code)})[-\\s]?(\\d{2,4})\\b`,'gi'):/\b([A-Z0-9]{2})[-\s]?(\d{2,4})\b/g;
  const flights=[...t.matchAll(re)].map(m=>`${m[1].toUpperCase()}${m[2]}`),flightNo=flights.at(-1)||'';
  const arrived=t.match(/Arrived\s*\(\s*([A-Z]{3})\s*\)\s*(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/i);
  let arrivalDate='',arrivalTime='',arrivalActual=false;
  if(arrived){const p=localDate([arrived[0],arrived[2],arrived[3],arrived[4],arrived[5],arrived[6]]);arrivalDate=p.date;arrivalTime=p.time;arrivalActual=true;}
  if(!arrivalDate){
    const a=[...t.matchAll(/(?:arriv(?:al|ed)|eta|estimated arrival)[^0-9]{0,60}(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/gi)].at(-1);
    if(a){const p=localDate(a);arrivalDate=p.date;arrivalTime=p.time;arrivalActual=/arrived/i.test(a[0]);}
  }
  if(!arrivalDate&&flightNo){
    const dashed=flightNo.replace(/([A-Z]+)(\d+)/,'$1-$2'),idx=Math.max(t.lastIndexOf(dashed),t.lastIndexOf(flightNo)),tail=idx>=0?t.slice(idx,idx+650):t;
    const ds=[...tail.matchAll(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/g)];
    if(ds.length){const p=localDate(ds.at(-1));arrivalDate=p.date;arrivalTime=p.time;}
  }
  const status=statusFromText(t),origin=route?.[1]?.toUpperCase()||'',destination=(arrived?.[1]||route?.[2]||'').toUpperCase();
  const mawbSeen=t.includes(mawb)||t.includes(compact)||t.includes(serial);
  const useful=Boolean(mawbSeen&&(origin||destination||pcs||wt||flightNo||arrivalDate||/notified consignee|received at destination|arrived|delivered|departed|tracking details/i.test(t)));
  return{useful,shipment:{mawb,carrierCode:code,origin,destination,bags:pcs?.[1]||'',pieces:pcs?.[1]||'',weight:(wt?.[1]||'').replace(/,/g,''),flightNo,arrivalDate,arrivalTime,eta:null,actualArrival:null,arrivalIsActual:arrivalActual,status,source:'TrackJet → official carrier result'}};
}

async function setInput(page,h,value){
  for(let i=0;i<3;i++){
    try{
      await page.evaluate((el,val)=>{const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(el,val);else el.value=val;el.focus();['input','change','blur'].forEach(n=>el.dispatchEvent(new Event(n,{bubbles:true})));},h,value);
      return true;
    }catch(e){if(!isNavigationRace(e))throw e;await sleep(350);}
  }
  return false;
}
async function visibleInputs(page){
  const out=[];let all=[];
  try{all=await page.$$('input,textarea');}catch(e){if(isNavigationRace(e))return out;throw e;}
  for(const h of all){
    try{const m=await h.evaluate(el=>{const r=el.getBoundingClientRect();return{visible:r.width>5&&r.height>5&&!el.disabled,type:(el.type||'text').toLowerCase(),label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''}`,max:el.maxLength||0,value:el.value||''};});if(m.visible&&!['hidden','checkbox','radio','file','password'].includes(m.type))out.push({h,m});}
    catch(e){if(!isNavigationRace(e))throw e;}
  }
  return out;
}
async function findTrackingInput(page,purpose='trackjet'){
  const inputs=await visibleInputs(page),good=inputs.find(x=>/mawb|awb|waybill|tracking|track|shipment|number|paste/i.test(x.m.label));
  if(good)return good;
  if(purpose==='trackjet')return inputs.find(x=>x.m.max===11||x.m.max===12||x.m.max===0)||null;
  return null;
}
async function getClickCandidates(page){
  for(let attempt=0;attempt<4;attempt++){
    try{
      return await page.evaluate(()=>{
        const els=[...document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"]')];let n=0;
        return els.map(el=>{
          const r=el.getBoundingClientRect();if(r.width<=4||r.height<=4||el.disabled)return null;
          const text=(el.innerText||el.value||el.getAttribute('aria-label')||el.title||'').trim(),href=el.href||el.getAttribute('href')||'',dataUrl=el.getAttribute('data-href')||el.getAttribute('data-url')||el.getAttribute('data-target-url')||el.getAttribute('formaction')||'',onclick=el.getAttribute('onclick')||'';
          const id=`mayavi-${n++}`;el.setAttribute('data-mayavi-click-id',id);
          let context='';
          for(let p=el.parentElement,depth=0;p&&depth<5;p=p.parentElement,depth++){
            const t=(p.innerText||'').replace(/\s+/g,' ').trim();
            if(t&&t.length<=900){context=t;break;}
          }
          return{id,text,href,dataUrl,onclick,context,tag:el.tagName||''};
        }).filter(Boolean);
      });
    }catch(e){if(!isNavigationRace(e))throw e;await sleep(450);}
  }
  return [];
}
function embeddedExternalUrl(c={}){
  for(const v of[c.href,c.dataUrl])if(isExternalHttp(v))return v;
  const urls=`${c.onclick||''} ${c.href||''} ${c.dataUrl||''}`.match(/https?:\/\/[^'"\s)]+/gi)||[];
  return urls.find(isExternalHttp)||'';
}
async function clickCandidate(page,c){
  try{
    const h=await page.$(`[data-mayavi-click-id="${c.id}"]`);if(!h)return false;
    try{await h.click({delay:90});return true;}
    catch(e){if(isNavigationRace(e))return true;return false;}
  }catch(e){if(isNavigationRace(e))return true;return false;}
}
async function waitForExternalPage(browser,trackJetPage,ms=16000){
  const end=Date.now()+ms;
  while(Date.now()<end){
    let pages=[];try{pages=await browser.pages();}catch{}
    for(const p of pages){const u=safeUrl(p);if(isExternalHttp(u))return p;}
    const main=safeUrl(trackJetPage);if(isExternalHttp(main))return trackJetPage;
    await sleep(350);
  }
  return null;
}
async function submitTrackJetForm(page,browser,mawb,debug){
  const input=await findTrackingInput(page,'trackjet');if(!input)return null;await setInput(page,input.h,mawb);
  const cs=await getClickCandidates(page),b=cs.find(c=>/^track$/i.test(c.text||'')||/track shipment|track cargo/i.test(c.text||'')),before=safeUrl(page);
  if(b){await clickCandidate(page,b);debug.directoryTrack={text:b.text};}else try{await page.evaluate(el=>el.form?.requestSubmit?.(),input.h);}catch(e){if(!isNavigationRace(e))throw e;}
  const ext=await waitForExternalPage(browser,page,14000);if(ext)return ext;
  const after=safeUrl(page);if(after&&after!==before&&isTrackJetUrl(after))return page;
  return null;
}

function safePrefixCandidate(c,prefix){
  const ctx=String(c.context||''),s=`${c.text||''} ${c.href||''} ${c.dataUrl||''}`;
  if(/other major carriers|other airlines|popular carriers|top airlines/i.test(ctx))return false;
  if(/privacy|terms|cookie|about|contact|login|sign in|facebook|instagram|linkedin|youtube/i.test(s))return false;
  const prefixRe=new RegExp(`(?:prefix\\s*)?\\b${esc(prefix)}\\b`,'i');
  return prefixRe.test(ctx)||prefixRe.test(s);
}

async function genericTrackJetHandoff(page,browser,mawb,debug){
  const prefix=mawb.replace(/\D/g,'').slice(0,3);
  for(let hop=0;hop<5;hop++){
    debug.stage=`TRACKJET_HANDOFF_${hop+1}`;
    await sleep(650);
    const current=safeUrl(page);if(isExternalHttp(current))return page;
    const bodyText=await safeBodyText(page);
    const iata=(bodyText.match(/\bIATA\s+([A-Z0-9]{2})\b/i)||[])[1]||'';if(iata)debug.iata=iata;

    if(/\/airline\//i.test(current)){
      const r=await submitTrackJetForm(page,browser,mawb,debug);
      if(r){const ru=safeUrl(r);if(isExternalHttp(ru)){debug.handoffMethod='AIRLINE_DIRECTORY_FORM';return r;}if(r===page&&isTrackJetUrl(safeUrl(page)))continue;}
    }

    const candidates=await getClickCandidates(page);
    debug[`handoffCandidates${hop+1}`]=candidates.slice(0,12).map(c=>({text:c.text,href:c.href,dataUrl:c.dataUrl,context:(c.context||'').slice(0,160)}));

    const explicit=candidates.find(c=>/^open\s+tracking\s+on\b/i.test(c.text||''));
    if(explicit){
      debug.handoff={text:explicit.text,href:explicit.href,dataUrl:explicit.dataUrl};
      const direct=embeddedExternalUrl(explicit);
      if(direct){
        debug.handoffMethod='EXPLICIT_TRACKJET_ACTION_DIRECT';
        try{await page.goto(direct,{waitUntil:'domcontentloaded',timeout:25000});return page;}
        catch(e){if(!isNavigationRace(e))debug.directNavigationError=e?.message||String(e);const ext=await waitForExternalPage(browser,page,8000);if(ext)return ext;}
      }
      const before=safeUrl(page);
      const clicked=await clickCandidate(page,explicit);
      if(clicked){
        debug.handoffMethod='EXPLICIT_TRACKJET_ACTION_CLICK';
        const ext=await waitForExternalPage(browser,page,17000);if(ext)return ext;
        const after=safeUrl(page);if(after&&after!==before&&isTrackJetUrl(after))continue;
      }
    }

    const matchedAction=candidates.find(c=>safePrefixCandidate(c,prefix)&&(/official\s+(?:tracking|carrier|airline)|track(?:ing)?\s+(?:on|with|at)|^visit\b/i.test(c.text||'')));
    if(matchedAction){
      debug.handoff={text:matchedAction.text,href:matchedAction.href,dataUrl:matchedAction.dataUrl};
      const direct=embeddedExternalUrl(matchedAction);
      if(direct){
        debug.handoffMethod='PREFIX_MATCHED_ACTION_DIRECT';
        try{await page.goto(direct,{waitUntil:'domcontentloaded',timeout:25000});return page;}
        catch(e){if(isNavigationRace(e)){const ext=await waitForExternalPage(browser,page,8000);if(ext)return ext;}}
      }
      const before=safeUrl(page);
      if(await clickCandidate(page,matchedAction)){
        debug.handoffMethod='PREFIX_MATCHED_ACTION_CLICK';
        const ext=await waitForExternalPage(browser,page,14000);if(ext)return ext;
        const after=safeUrl(page);if(after&&after!==before&&isTrackJetUrl(after))continue;
      }
    }

    const matchedDir=candidates.find(c=>/\/airline\//i.test(c.href||c.dataUrl||'')&&safePrefixCandidate(c,prefix));
    if(matchedDir){
      const url=matchedDir.href||matchedDir.dataUrl;debug.handoffMethod='PREFIX_MATCHED_AIRLINE_DIRECTORY';debug.handoff={text:matchedDir.text,href:url};
      try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});continue;}
      catch(e){if(isNavigationRace(e))continue;}
    }
    return null;
  }
  return null;
}

async function maybeSubmitCarrier(page,mawb){
  const compact=mawb.replace(/\D/g,''),prefix=compact.slice(0,3),serial=compact.slice(3),text=await safeBodyText(page);
  if((text.includes(mawb)||text.includes(compact)||text.includes(serial))&&/Piece\(s\)|Pieces?|Pcs|Arrived|Received|Notified consignee|Tracking Details|flight/i.test(text))return{attempted:false,reason:'result already visible'};
  const inputs=await visibleInputs(page),pre=inputs.find(x=>x.m.max===3||/prefix/i.test(x.m.label)),num=inputs.find(x=>x.m.max===8||/awb|mawb|waybill|shipment|tracking number/i.test(x.m.label)),one=inputs.find(x=>/awb|mawb|waybill|shipment|tracking|track/i.test(x.m.label));
  try{
    if(pre&&num&&pre.h!==num.h){await setInput(page,pre.h,prefix);await setInput(page,num.h,serial);}else if(one){await setInput(page,one.h,one.m.max===8?serial:compact);}else return{attempted:false,reason:'no carrier tracking input found'};
    const cs=(await getClickCandidates(page)).filter(c=>/track shipment|^track$|search|submit|find shipment|track cargo/i.test(c.text||''));
    if(cs.length){await clickCandidate(page,cs[0]);await sleep(5200);try{await page.waitForNetworkIdle({idleTime:700,timeout:8000});}catch{}return{attempted:true,clicked:cs[0].text};}
    const target=num?.h||one?.h;if(target){try{await page.evaluate(el=>el.form?.requestSubmit?.(),target);}catch(e){if(!isNavigationRace(e))throw e;}await sleep(4800);return{attempted:true,clicked:'form submit'};}
  }catch(e){if(isNavigationRace(e)){await sleep(2500);return{attempted:true,clicked:'navigation after submit'};}return{attempted:true,error:e?.message||String(e)};}
  return{attempted:true,clicked:''};
}

async function runTrackJet(mawb){
  let browser;const debug={stage:'START',mawb};
  try{
    const chromiumMod=await import('@sparticuz/chromium'),puppeteerMod=await import('puppeteer-core'),chromium=chromiumMod.default||chromiumMod,puppeteer=puppeteerMod.default||puppeteerMod;
    browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true,defaultViewport:{width:1440,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});

    debug.stage='TRACKJET_OPEN';
    await page.goto(TRACKJET_URL,{waitUntil:'domcontentloaded',timeout:25000});await sleep(900);
    const input=await findTrackingInput(page,'trackjet');
    if(!input)return{ok:false,error:'TrackJet tracking input was not found.',debug:{...debug,stage:'TRACKJET_INPUT'}};
    await setInput(page,input.h,mawb);
    const buttons=(await getClickCandidates(page)).filter(c=>/^track$/i.test(c.text||'')||/track shipment|track cargo/i.test(c.text||''));
    if(buttons.length)await clickCandidate(page,buttons[0]);
    else try{await page.evaluate(el=>el.form?.requestSubmit?.(),input.h);}catch(e){if(!isNavigationRace(e))throw e;}

    debug.stage='TRACKJET_RESULT';
    for(let i=0;i<24;i++){
      await sleep(350);
      const u=safeUrl(page);if(!u)continue;if(!isTrackJetUrl(u))break;
      const text=await safeBodyText(page,2);
      if(/We found your carrier|Open tracking on|IATA\s+[A-Z0-9]{2}|official|carrier|airline/i.test(text)||/\/track\//i.test(u))break;
    }
    const tj=await safeBodyText(page);
    debug.trackjetUrl=safeUrl(page);debug.trackjetHint=tj.slice(0,1000);debug.iata=(tj.match(/\bIATA\s+([A-Z0-9]{2})\b/i)||[])[1]||'';

    debug.stage='TRACKJET_HANDOFF';
    const carrierPage=await genericTrackJetHandoff(page,browser,mawb,debug);
    if(!carrierPage)return{ok:false,error:'TrackJet identified the carrier, but no usable official-carrier handoff opened. The explicit TrackJet carrier action was checked first, then only matching-prefix fallbacks.',debug:{...debug,stage:'TRACKJET_EXPLICIT_HANDOFF_UNAVAILABLE'}};

    debug.stage='CARRIER_OPEN';
    await sleep(1800);try{await carrierPage.waitForNetworkIdle({idleTime:800,timeout:9000});}catch{}
    debug.carrierUrl=safeUrl(carrierPage);
    if(!isExternalHttp(debug.carrierUrl))return{ok:false,error:`TrackJet click did not reach an official external carrier page (${debug.carrierUrl||'blank'}).`,debug:{...debug,stage:'TRACKJET_HANDOFF_NOT_EXTERNAL'}};

    let carrierText=await safeBodyText(carrierPage);
    if(/captcha|verify you are human|access denied|forbidden|robot check|one moment please|unusual traffic/i.test(carrierText))return{ok:false,error:'Official carrier page presented an access/CAPTCHA challenge. Mayavi will not bypass it.',debug:{...debug,stage:'CARRIER_CHALLENGE',carrierHint:carrierText.slice(0,700)}};

    debug.stage='CARRIER_SUBMIT';
    debug.carrierSubmit=await maybeSubmitCarrier(carrierPage,mawb);
    await sleep(900);
    carrierText=await safeBodyText(carrierPage);
    debug.carrierHint=carrierText.slice(0,1200);
    const parsed=parseCarrierText(carrierText,mawb,debug.iata||'');
    if(!parsed.useful)return{ok:false,error:'Official carrier page opened, but readable shipment details were not found yet.',debug:{...debug,stage:'PARSE_CARRIER'}};
    return{ok:true,shipment:parsed.shipment,debug:{...debug,stage:'SUCCESS'}};
  }catch(e){
    if(isNavigationRace(e))return{ok:false,error:'The browser navigated while Mayavi was reading the page. The handoff will be retried safely on the next request.',debug:{...debug,stage:'NAVIGATION_RACE_RECOVERABLE',message:e?.message||String(e)}};
    return{ok:false,error:e?.message||String(e),debug:{...debug,stage:'BROWSER_ERROR',message:e?.message||String(e)}};
  }finally{if(browser)try{await browser.close();}catch{}}
}

function waiting(mawb,stage=''){return{mawb,carrierCode:'',origin:'',destination:'',bags:'',weight:'',flightNo:'',arrivalDate:'',arrivalTime:'',eta:null,actualArrival:null,status:'WAITING FOR LIVE DATA',source:`TrackJet → official carrier${stage?` · ${stage}`:''}`};}
async function handleMawb(mawb){const r=await runTrackJet(mawb);return r.ok?Response.json({ok:true,configured:true,provider:'TrackJet → official carrier',source:'TrackJet → official carrier result',airlinePrimary:true,shipment:r.shipment,trackingDebug:r.debug}):Response.json({ok:true,configured:true,provider:'TrackJet → official carrier',source:'TrackJet navigation-safe handoff diagnostic',airlinePrimary:true,trackingError:r.error,trackingDebug:r.debug,shipment:waiting(mawb,r.debug?.stage||'')});}
export async function GET(request){const u=new URL(request.url),q=u.searchParams.get('mawb');if(!q)return Response.json({configured:true,provider:'TrackJet → official carrier',apiKeyRequired:false,mode:'navigation-safe explicit TrackJet carrier action first'});const m=normalizeMawb(q);if(!m)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handleMawb(m);}
export async function POST(request){let b={};try{b=await request.json();}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400});}const m=normalizeMawb(b?.mawb);if(!m)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});return handleMawb(m);}
