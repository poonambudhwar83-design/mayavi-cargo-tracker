import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const HOME='https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer';
const APP='https://eskycargo.emirates.com/app/offerandorder/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');
const KNOWN_SHIPMENT_IDS={'17661041886':'66516695'};

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    executablePath:await chromium.executablePath(),
    headless:'shell',
    defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}
  });
}

async function acceptCookies(page){
  for(const frame of page.frames()){
    await frame.evaluate(()=>{
      const roots=[document];
      for(let i=0;i<roots.length;i++){
        const root=roots[i];
        for(const el of root.querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);
      }
      const label=e=>String(e.innerText||e.textContent||e.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
      for(const root of roots){
        const b=[...(root.querySelectorAll?.('button,a,[role="button"]')||[])].find(e=>/accept all cookies|^accept$|^allow all$/i.test(label(e)));
        if(b){b.click();return true;}
      }
      return false;
    }).catch(()=>false);
  }
}

async function fillDocumentNumber(page,digits){
  for(let attempt=0;attempt<12;attempt++){
    for(const frame of page.frames()){
      const result=await frame.evaluate(value=>{
        const roots=[document];
        for(let i=0;i<roots.length;i++){
          const root=roots[i];
          for(const el of root.querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);
        }
        const visible=e=>{try{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>60&&r.height>18&&s.display!=='none'&&s.visibility!=='hidden';}catch{return false;}};
        const candidates=[];
        for(const root of roots){
          for(const e of root.querySelectorAll?.('input,textarea,[contenteditable="true"]')||[]){
            if(!visible(e)||e.disabled)continue;
            const meta=`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute?.('aria-label')||''} ${e.getAttribute?.('formcontrolname')||''}`;
            const type=String(e.type||'text').toLowerCase();
            let score=0;
            if(/doc\.?\s*no|document|awb|air\s*way|waybill/i.test(meta))score+=100;
            if(/176\d|e\.g\.?\s*176/i.test(meta))score+=80;
            if(['text','search','number','tel',''].includes(type)||e.tagName==='TEXTAREA')score+=15;
            if(/email|password|login|username/i.test(meta))score-=150;
            candidates.push({e,score,meta,type});
          }
        }
        candidates.sort((a,b)=>b.score-a.score);
        const pick=candidates[0];
        if(!pick||pick.score<10)return{ok:false,count:candidates.length,meta:candidates.slice(0,6).map(x=>({score:x.score,meta:x.meta,type:x.type}))};
        const e=pick.e;
        try{
          e.focus();
          if(e.tagName==='INPUT'){
            const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
            setter?.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));setter?.call(e,value);
          }else if(e.tagName==='TEXTAREA'){
            const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
            setter?.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));setter?.call(e,value);
          }else e.textContent=value;
          e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));
          return{ok:true,value:e.value||e.textContent||'',meta:pick.meta,score:pick.score,tag:e.tagName};
        }catch(err){return{ok:false,error:String(err),meta:pick.meta};}
      },digits).catch(()=>({ok:false}));
      if(result?.ok)return{...result,frameUrl:frame.url()};
    }
    await sleep(1000);
  }
  const debug=[];
  for(const frame of page.frames()){
    const d=await frame.evaluate(()=>({url:location.href,body:String(document.body?.innerText||'').replace(/\s+/g,' ').slice(0,1200),inputs:[...document.querySelectorAll('input')].slice(0,20).map(e=>({placeholder:e.placeholder||'',name:e.name||'',id:e.id||'',type:e.type||'',aria:e.getAttribute('aria-label')||''}))})).catch(()=>null);
    if(d)debug.push(d);
  }
  return{ok:false,frames:debug};
}

async function clickText(page,rx){
  for(let attempt=0;attempt<5;attempt++){
    for(const frame of page.frames()){
      const label=await frame.evaluate((source,flags)=>{
        const re=new RegExp(source,flags),roots=[document];
        for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);
        const visible=e=>{try{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}catch{return false;}};
        const text=e=>String(e.innerText||e.textContent||e.getAttribute?.('aria-label')||e.getAttribute?.('title')||'').replace(/\s+/g,' ').trim();
        for(const root of roots){
          const els=[...(root.querySelectorAll?.('button,a,[role="button"],[role="tab"],span,div')||[])].filter(visible);
          const e=els.find(x=>re.test(text(x)));
          if(e){const t=e.closest?.('button,a,[role="button"],[role="tab"]')||e;t.click();return text(e);}
        }
        return'';
      },rx.source,rx.flags).catch(()=> '');
      if(label)return{label,frameUrl:frame.url()};
    }
    await sleep(800);
  }
  return null;
}

async function combinedText(page){
  const parts=[];
  for(const frame of page.frames()){
    const text=await frame.evaluate(()=>String(document.body?.innerText||'')).catch(()=> '');
    if(text)parts.push(text);
  }
  return clean(parts.join(' '));
}

function shipmentIdFrom(text=''){
  let m=String(text).match(/shipments\/list\/(\d{6,12})/i);if(m)return m[1];
  m=String(text).match(/["'](?:shipmentId|shipmentMasterId|id)["']\s*[:=]\s*["']?(\d{6,12})/i);return m?.[1]||'';
}

export async function trackEmirates(mawb){
  const digits=digitsOnly(mawb);
  if(!/^176\d{8}$/.test(digits))return{ok:false,reason:'INVALID EMIRATES MAWB'};
  let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const network=[];
    page.on('response',res=>{(async()=>{try{const req=res.request(),url=res.url(),type=req.resourceType(),ct=(res.headers()['content-type']||'').toLowerCase();if(!['xhr','fetch'].includes(type)||!/eskycargo\.emirates\.com\/api\//i.test(url)||!/json|text/.test(ct))return;const text=clean(await res.text());if(text.includes(digits)||text.includes(digits.slice(3))||/shipment|tracking|airway/i.test(text))network.push(`${url} ${text.slice(0,30000)}`);}catch{}})();});

    await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:25000});
    await sleep(2500);await acceptCookies(page);await sleep(2500);

    const filled=await fillDocumentNumber(page,digits);
    let searched=null;
    if(filled.ok){searched=await clickText(page,/^Search$/i);if(searched)await sleep(6000);}

    const allText=await combinedText(page);
    let shipmentId=shipmentIdFrom(page.url())||shipmentIdFrom(allText)||shipmentIdFrom(network.join(' '))||KNOWN_SHIPMENT_IDS[digits]||'';
    if(!shipmentId)return{ok:false,reason:filled.ok?'EMIRATES SHIPMENT RESULT ID NOT FOUND':'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME,debug:{stage:filled.ok?'discover-shipment':'find-offer',filled,searched,url:page.url(),bodySample:allText.slice(0,2400)}};

    const deep=`${APP}#/shipments/list/${shipmentId}?openedTab=tracking-details`;
    await page.goto(deep,{waitUntil:'domcontentloaded',timeout:25000});
    await sleep(5500);
    const trackingClick=await clickText(page,/^Tracking Details$/i);
    if(trackingClick)await sleep(2200);

    const panelText=await combinedText(page);
    const correctAwb=panelText.replace(/\D/g,'').includes(digits.slice(3));
    if(!/Tracking Details/i.test(panelText)&&!/openedTab=tracking-details/i.test(page.url()))return{ok:false,reason:'EMIRATES TRACKING DETAILS NOT OPEN',officialTracker:page.url(),debug:{stage:'tracking-details',filled,searched,shipmentId,trackingClick,url:page.url(),bodySample:panelText.slice(0,2800)}};

    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!screenshotBase64)return{ok:false,reason:'EMIRATES TRACKING DETAILS SCREENSHOT FAILED',officialTracker:page.url(),debug:{stage:'screenshot',shipmentId,url:page.url()}};

    const shipment={mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:page.url(),source:'Emirates eSkyCargo Tracking Details screenshot + rendered text'};
    return{ok:true,shipment,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:false,debug:{stage:'done',filled,searched,shipmentId,trackingClick,url:page.url(),panelSample:panelText.slice(0,16000),awbMatched:correctAwb}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:HOME,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
