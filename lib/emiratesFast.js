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

async function clickNative(page,rx){
  for(let attempt=0;attempt<8;attempt++){
    for(const frame of page.frames()){
      const handles=await frame.$$('button,a,[role="button"],[role="tab"],input[type="submit"],input[type="button"]');
      for(const handle of handles){
        try{
          const meta=await handle.evaluate(el=>{
            const r=el.getBoundingClientRect(),s=getComputedStyle(el);
            return{visible:r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden',disabled:Boolean(el.disabled||el.getAttribute('aria-disabled')==='true'),text:String(el.innerText||el.value||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'').replace(/\s+/g,' ').trim()};
          });
          if(meta.visible&&!meta.disabled&&rx.test(meta.text)){
            await handle.click({delay:80});
            return{label:meta.text,frameUrl:frame.url()};
          }
        }catch{}
      }
    }
    await sleep(650);
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

function noMatchingRecord(text='',network=[]){
  const joined=`${text} ${network.map(n=>n.body).join(' ')}`;
  return /BOOKING_NOT_FOUND|No matching records? found|There is no matching result found|no matching result found for your shipment reference/i.test(joined);
}

function validShipmentResult(text='',digits=''){
  const serial=digits.slice(3);
  const awbSeen=text.includes(digits)||text.includes(serial)||text.includes(`176-${serial}`);
  const searchCount=Number(text.match(/Search\s+Results\s*\((\d+)\)/i)?.[1]||0);
  const explicitShipment=/Doc\.\s*No\.\s*:\s*176[-\s]?\d{8}|Shipment\s+has\s+arrived|Notified\s+of\s+arrival\s+of\s+Shipment|Received\s+at\s+[A-Z]{3}\s+from\s+Flight|Arrived\s+at\s+[A-Z]{3}|Tracking\s+Details/i.test(text);
  const route=/\b[A-Z]{3,20}\s*\(([A-Z]{3})\)\s+[A-Z]{3,20}\s*\(([A-Z]{3})\)/i.test(text);
  return Boolean(awbSeen&&((searchCount>0&&explicitShipment)||(explicitShipment&&route)||/Shipment\s+has\s+arrived|Notified\s+of\s+arrival\s+of\s+Shipment|Received\s+at\s+[A-Z]{3}\s+from\s+Flight/i.test(text)));
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

    const network=[];
    page.on('response',res=>{(async()=>{try{
      const req=res.request(),url=res.url(),type=req.resourceType(),ct=(res.headers()['content-type']||'').toLowerCase();
      if(!['xhr','fetch'].includes(type)||!/eskycargo\.emirates\.com/i.test(url)||!/json|text|javascript/.test(ct))return;
      const body=clean(await res.text());
      if(body&&body.length<500000)network.push({url,body:body.slice(0,80000)});
    }catch{}})();});

    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(2200);
    await acceptCookies(page);
    await sleep(1200);

    const filled=await fillMawb(page,digits);
    if(!filled.ok)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME,debug:{stage:'fill-mawb',filled,url:page.url()}};

    const searched=await clickNative(page,/^Search$/i);
    if(!searched)return{ok:false,reason:'EMIRATES SEARCH BUTTON NOT FOUND',officialTracker:HOME,debug:{stage:'search',filled,url:page.url(),bodySample:(await combinedText(page)).slice(0,2400)}};
    await sleep(6000);

    let panelText=await combinedText(page);
    if(noMatchingRecord(panelText,network)){
      return{ok:false,notFound:true,reason:'EMIRATES NO MATCHING RECORD',officialTracker:page.url(),debug:{stage:'no-record',filled,searched,url:page.url(),bodySample:panelText.slice(0,3200),networkUrls:[...new Set(network.map(n=>n.url))].slice(-12)}};
    }

    let resultVerified=validShipmentResult(panelText,digits);
    const trackingClick=await clickNative(page,/^Tracking\s+Details$/i);
    if(trackingClick){
      await sleep(2600);
      const updated=await combinedText(page);
      if(updated)panelText=updated;
      resultVerified=resultVerified||validShipmentResult(panelText,digits);
    }

    if(!resultVerified){
      return{ok:false,reason:'EMIRATES SHIPMENT RESULT NOT FOUND',officialTracker:page.url(),debug:{stage:'verify-result',filled,searched,trackingClick,url:page.url(),bodySample:panelText.slice(0,3600),networkUrls:[...new Set(network.map(n=>n.url))].slice(-12)}};
    }

    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!screenshotBase64)return{ok:false,reason:'EMIRATES TRACKING DETAILS SCREENSHOT FAILED',officialTracker:page.url(),debug:{stage:'screenshot',filled,searched,trackingClick,url:page.url(),panelSample:panelText.slice(0,5000)}};

    const shipment={mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:page.url(),source:'Emirates eSkyCargo Tracking Details screenshot + rendered text'};
    return{ok:true,shipment,screenshotBase64,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:false,debug:{stage:'done-search-tracking-details',filled,searched,trackingClick,url:page.url(),panelSample:panelText.slice(0,18000),awbMatched:true,networkUrls:[...new Set(network.map(n=>n.url))].slice(-12)}};
  }catch(e){
    return{ok:false,reason:e?.message||String(e),officialTracker:HOME,debug:{stage:'exception'}};
  }finally{
    try{if(browser)await browser.close();}catch{}
  }
}
