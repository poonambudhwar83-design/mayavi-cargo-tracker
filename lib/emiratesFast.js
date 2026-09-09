import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const HOME='https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    executablePath:await chromium.executablePath(),
    headless:'shell',
    defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}
  });
}

async function rootsEval(frame,fn,...args){
  return frame.evaluate(fn,...args).catch(()=>null);
}

async function acceptCookies(page){
  for(const frame of page.frames()){
    await rootsEval(frame,()=>{
      const roots=[document];
      for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);
      const text=e=>String(e.innerText||e.textContent||e.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
      for(const root of roots){
        const b=[...(root.querySelectorAll?.('button,a,[role="button"]')||[])].find(e=>/accept all cookies|^accept$|^allow all$/i.test(text(e)));
        if(b){b.click();return true;}
      }
      return false;
    });
  }
}

async function fillMawb(page,digits){
  for(let attempt=0;attempt<10;attempt++){
    for(const frame of page.frames()){
      const result=await rootsEval(frame,value=>{
        const roots=[document];
        for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);
        const visible=e=>{try{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>60&&r.height>18&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled;}catch{return false;}};
        const candidates=[];
        for(const root of roots)for(const e of root.querySelectorAll?.('input,textarea')||[]){
          if(!visible(e))continue;
          const meta=`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute?.('aria-label')||''} ${e.getAttribute?.('formcontrolname')||''}`;
          let score=0;
          if(/doc\.?\s*no|document|awb|air\s*way|waybill/i.test(meta))score+=120;
          if(/176\d|e\.g\.?\s*176/i.test(meta))score+=80;
          if(/email|password|login|username/i.test(meta))score-=200;
          candidates.push({e,meta,score});
        }
        candidates.sort((a,b)=>b.score-a.score);
        const p=candidates[0];
        if(!p||p.score<20)return{ok:false,count:candidates.length};
        const e=p.e;
        e.focus();
        const setter=e.tagName==='TEXTAREA'?Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set:Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        setter?.call(e,'');
        e.dispatchEvent(new Event('input',{bubbles:true}));
        setter?.call(e,value);
        e.dispatchEvent(new Event('input',{bubbles:true}));
        e.dispatchEvent(new Event('change',{bubbles:true}));
        e.dispatchEvent(new Event('blur',{bubbles:true}));
        return{ok:true,value:e.value||'',meta:p.meta};
      },digits);
      if(result?.ok)return{...result,frameUrl:frame.url()};
    }
    await sleep(700);
  }
  return{ok:false};
}

async function clickExact(page,rx){
  for(let attempt=0;attempt<10;attempt++){
    for(const frame of page.frames()){
      const result=await rootsEval(frame,(source,flags)=>{
        const re=new RegExp(source,flags);
        const roots=[document];
        for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);
        const visible=e=>{try{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}catch{return false;}};
        const text=e=>String(e.innerText||e.value||e.textContent||e.getAttribute?.('aria-label')||e.getAttribute?.('title')||'').replace(/\s+/g,' ').trim();
        for(const root of roots){
          const els=[...(root.querySelectorAll?.('button,a,[role="button"],[role="tab"],input[type="submit"],input[type="button"],span,div')||[])].filter(visible);
          const e=els.find(x=>re.test(text(x)));
          if(e){
            const target=e.closest?.('button,a,[role="button"],[role="tab"]')||e;
            if(target.disabled||target.getAttribute?.('aria-disabled')==='true')continue;
            target.click();
            return text(e);
          }
        }
        return'';
      },rx.source,rx.flags);
      if(result)return{label:result,frameUrl:frame.url()};
    }
    await sleep(700);
  }
  return null;
}

async function combinedText(page){
  const out=[];
  for(const frame of page.frames()){
    const t=await rootsEval(frame,()=>String(document.body?.innerText||''));
    if(t)out.push(t);
  }
  return clean(out.join(' '));
}

export async function trackEmirates(mawb){
  const digits=digitsOnly(mawb);
  if(!/^176\d{8}$/.test(digits))return{ok:false,reason:'INVALID EMIRATES MAWB',officialTracker:HOME};
  let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});

    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(2200);
    await acceptCookies(page);
    await sleep(1200);

    const filled=await fillMawb(page,digits);
    if(!filled.ok)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME,debug:{stage:'fill-mawb',filled,url:page.url()}};

    const searched=await clickExact(page,/^Search$/i);
    if(!searched)return{ok:false,reason:'EMIRATES SEARCH BUTTON NOT FOUND',officialTracker:HOME,debug:{stage:'search',filled,url:page.url(),bodySample:(await combinedText(page)).slice(0,2400)}};
    await sleep(5500);

    // Correct Mayavi flow: Search -> Tracking Details. Do NOT click Show Details.
    const trackingClick=await clickExact(page,/^Tracking\s+Details$/i);
    if(trackingClick)await sleep(2600);

    const panelText=await combinedText(page);
    const awbMatched=panelText.replace(/\D/g,'').includes(digits.slice(3));
    const hasTrackingContent=/Tracking\s+Details|Shipment\s+has\s+arrived|Received\s+at\s+[A-Z]{3}\s+from\s+Flight|Arrived\s+at\s+[A-Z]{3}|\bPieces?\b|\bWeight\b|\bFlight\s+EK\d+/i.test(panelText);
    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);

    if(!trackingClick&&!hasTrackingContent){
      return{ok:false,reason:'EMIRATES TRACKING DETAILS BUTTON NOT FOUND',officialTracker:page.url(),screenshotBase64,screenshotCaptured:Boolean(screenshotBase64),screenshotVerified:false,debug:{stage:'tracking-details',filled,searched,trackingClick,url:page.url(),bodySample:panelText.slice(0,3200),awbMatched}};
    }
    if(!screenshotBase64)return{ok:false,reason:'EMIRATES TRACKING DETAILS SCREENSHOT FAILED',officialTracker:page.url(),debug:{stage:'screenshot',filled,searched,trackingClick,url:page.url(),panelSample:panelText.slice(0,5000),awbMatched}};

    const shipment={mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:page.url(),source:'Emirates eSkyCargo Tracking Details screenshot + rendered text'};
    return{ok:true,shipment,screenshotBase64,screenshotCaptured:true,screenshotVerified:Boolean(awbMatched||hasTrackingContent),screenshotOcrUsed:false,debug:{stage:'done-search-tracking-details',filled,searched,trackingClick,url:page.url(),panelSample:panelText.slice(0,18000),awbMatched}};
  }catch(e){
    return{ok:false,reason:e?.message||String(e),officialTracker:HOME,debug:{stage:'exception'}};
  }finally{
    try{if(browser)await browser.close();}catch{}
  }
}
