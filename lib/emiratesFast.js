import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const HOME='https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');

async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});}
async function rootsEval(frame,fn,...args){return frame.evaluate(fn,...args).catch(()=>null);}
async function acceptCookies(page){for(const frame of page.frames())await rootsEval(frame,()=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);const text=e=>String(e.innerText||e.textContent||e.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();for(const root of roots){const b=[...(root.querySelectorAll?.('button,a,[role="button"]')||[])].find(e=>/accept all cookies|^accept$|^allow all$/i.test(text(e)));if(b){b.click();return true;}}return false;});}

async function findMawbInput(frame){
  const inputs=await frame.$$('input,textarea');let best=null;
  for(const input of inputs){try{const meta=await input.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);const text=`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''} ${el.getAttribute('formcontrolname')||''}`;let score=0;if(/doc\.?\s*no|document|awb|air\s*way|waybill/i.test(text))score+=120;if(/176\d|e\.g\.?\s*176/i.test(text))score+=80;if(/email|password|login|username/i.test(text))score-=200;return{visible:r.width>60&&r.height>18&&s.display!=='none'&&s.visibility!=='hidden'&&!el.disabled,score,text};});if(meta.visible&&(!best||meta.score>best.meta.score))best={input,meta};}catch{}}
  return best&&best.meta.score>=20?best:null;
}
async function fillMawb(page,digits){
  for(let attempt=0;attempt<10;attempt++){
    for(const frame of page.frames()){
      const found=await findMawbInput(frame);if(!found)continue;
      try{await found.input.click({clickCount:3});await page.keyboard.press('Backspace');await found.input.type(digits,{delay:45});await sleep(250);const value=await found.input.evaluate(el=>String(el.value||''));if(digitsOnly(value)===digits)return{ok:true,value,meta:found.meta.text,frameUrl:frame.url()};}catch{}
    }
    await sleep(700);
  }
  return{ok:false};
}

async function clickSearchClosest(page,digits){
  for(let attempt=0;attempt<8;attempt++){
    for(const frame of page.frames()){
      const r=await rootsEval(frame,value=>{
        const roots=[document];for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);
        const visible=e=>{try{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&e.getAttribute?.('aria-disabled')!=='true';}catch{return false;}};
        const text=e=>String(e.innerText||e.value||e.textContent||e.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();const ds=v=>String(v||'').replace(/\D/g,'');
        let input=null;for(const root of roots){input=[...(root.querySelectorAll?.('input,textarea')||[])].find(e=>visible(e)&&ds(e.value)===value);if(input)break;}if(!input)return null;
        const ir=input.getBoundingClientRect(),ix=ir.left+ir.width/2,iy=ir.top+ir.height/2;const candidates=[];
        for(const root of roots)for(const b of root.querySelectorAll?.('button,input[type="submit"],input[type="button"],a,[role="button"]')||[]){if(!visible(b)||!/^Search$/i.test(text(b)))continue;const br=b.getBoundingClientRect(),bx=br.left+br.width/2,by=br.top+br.height/2;candidates.push({b,distance:Math.hypot(bx-ix,by-iy),label:text(b)});}
        candidates.sort((a,b)=>a.distance-b.distance);const p=candidates[0];if(!p)return null;p.b.click();return{ok:true,label:p.label,distance:Math.round(p.distance)};
      },digits);
      if(r?.ok)return{...r,frameUrl:frame.url()};
    }
    await sleep(650);
  }
  return null;
}

async function clickDeepText(page,rx){for(let attempt=0;attempt<12;attempt++){for(const frame of page.frames()){const r=await rootsEval(frame,(source,flags)=>{const re=new RegExp(source,flags),roots=[document];for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);const visible=e=>{try{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';}catch{return false;}};const text=e=>String(e.innerText||e.value||e.textContent||e.getAttribute?.('aria-label')||e.getAttribute?.('title')||'').replace(/\s+/g,' ').trim();for(const root of roots){const els=[...(root.querySelectorAll?.('button,a,[role="button"],[role="tab"],input[type="submit"],input[type="button"],span,div,p')||[])].filter(visible);const exact=els.find(e=>re.test(text(e)));if(!exact)continue;const clickable=exact.closest?.('button,a,[role="button"],[role="tab"],[tabindex]')||exact;if(clickable.disabled||clickable.getAttribute?.('aria-disabled')==='true')continue;clickable.click();return{text:text(exact)};}return null;},rx.source,rx.flags);if(r?.text)return{label:r.text,frameUrl:frame.url()};}await sleep(700);}return null;}
async function combinedText(page){const out=[];for(const frame of page.frames()){const t=await rootsEval(frame,()=>String(document.body?.innerText||''));if(t)out.push(t);}return clean(out.join(' '));}
function noMatchingRecord(text='',network=[],digits=''){const count=text.match(/Search\s+Results\s*\((\d+)\)/i);if(count&&Number(count[1])>0)return false;if(/Search\s+Results\s*\(0\)|No matching records? found/i.test(text))return true;const serial=digits.slice(3),relevant=network.filter(n=>n.body.includes(digits)||n.body.includes(serial));return relevant.some(n=>/BOOKING_NOT_FOUND|There is no matching result found|no matching result found for your shipment reference/i.test(n.body));}
function trackingDetailsVisible(text=''){return /Tracking\s+Details/i.test(text)&&/(Shipment|Pieces?|Weight|Origin|Destination|Arrived|Received|Departed|Flight\s+EK|Doc\.?\s*No)/i.test(text);}

export async function trackEmirates(mawb){
  const digits=digitsOnly(mawb);if(!/^176\d{8}$/.test(digits))return{ok:false,reason:'INVALID EMIRATES MAWB',officialTracker:HOME};let browser;
  try{
    browser=await launch();const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    const network=[];page.on('response',res=>{(async()=>{try{const req=res.request(),url=res.url(),type=req.resourceType(),ct=(res.headers()['content-type']||'').toLowerCase();if(!['xhr','fetch'].includes(type)||!/eskycargo\.emirates\.com/i.test(url)||!/json|text|javascript/.test(ct))return;const body=clean(await res.text());if(body&&body.length<500000)network.push({url,body:body.slice(0,80000)});}catch{}})();});
    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:30000});await sleep(2200);await acceptCookies(page);await sleep(1200);
    const filled=await fillMawb(page,digits);if(!filled.ok)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME,debug:{stage:'fill-mawb',filled,url:page.url()}};
    let searched=await clickSearchClosest(page,digits);if(!searched)searched=await clickDeepText(page,/^Search$/i);if(!searched)return{ok:false,reason:'EMIRATES SEARCH BUTTON NOT FOUND',officialTracker:HOME,debug:{stage:'search',filled,url:page.url(),bodySample:(await combinedText(page)).slice(0,2600)}};
    await sleep(7500);let panelText=await combinedText(page);if(noMatchingRecord(panelText,network,digits))return{ok:false,notFound:true,reason:'EMIRATES NO MATCHING RECORD',officialTracker:page.url(),debug:{stage:'no-record',filled,searched,url:page.url(),bodySample:panelText.slice(0,3800),networkUrls:[...new Set(network.map(n=>n.url))].slice(-14)}};
    const trackingClick=await clickDeepText(page,/^Tracking\s+Details$/i);if(!trackingClick)return{ok:false,reason:'EMIRATES TRACKING DETAILS BUTTON NOT FOUND',officialTracker:page.url(),debug:{stage:'tracking-details-button',filled,searched,url:page.url(),bodySample:panelText.slice(0,5200),networkUrls:[...new Set(network.map(n=>n.url))].slice(-14)}};
    await sleep(3500);panelText=await combinedText(page);const serial=digits.slice(3),awbMatched=panelText.includes(digits)||panelText.includes(serial)||panelText.includes(`176-${serial}`);if(!awbMatched&&!trackingDetailsVisible(panelText))return{ok:false,reason:'EMIRATES TRACKING DETAILS DID NOT OPEN',officialTracker:page.url(),debug:{stage:'tracking-details-open',filled,searched,trackingClick,url:page.url(),bodySample:panelText.slice(0,6000)}};
    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);if(!screenshotBase64)return{ok:false,reason:'EMIRATES TRACKING DETAILS SCREENSHOT FAILED',officialTracker:page.url(),debug:{stage:'screenshot',filled,searched,trackingClick,url:page.url(),panelSample:panelText.slice(0,5000)}};
    const shipment={mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:page.url(),source:'Emirates eSkyCargo Tracking Details screenshot + rendered text'};return{ok:true,shipment,screenshotBase64,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:false,debug:{stage:'done-search-tracking-details',filled,searched,trackingClick,url:page.url(),panelSample:panelText.slice(0,18000),awbMatched,networkUrls:[...new Set(network.map(n=>n.url))].slice(-14)}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:HOME,debug:{stage:'exception'}};}finally{try{if(browser)await browser.close();}catch{}}
}
