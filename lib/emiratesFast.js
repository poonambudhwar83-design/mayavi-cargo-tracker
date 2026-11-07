import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const HOME='https://eskycargo.emirates.com/app/offerandorder/#/home/find-offer';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');

async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});}

async function optimizePage(page){
  // The tracking widget is text/HTML; fetching promotional images, fonts and
  // third-party telemetry adds pressure to Vercel's short-lived Chromium.
  await page.setRequestInterception(true);
  page.on('request',request=>{
    const kind=request.resourceType(),url=request.url();
    const unnecessary=['image','font','media'].includes(kind)||/(?:dynatrace|google-analytics|googletagmanager|doubleclick|ahrefs)/i.test(url);
    (unnecessary?request.abort('blockedbyclient'):request.continue()).catch(()=>{});
  });
}
async function openHome(page){
  try{return await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:30000});}
  catch(e){
    if(!/ERR_INSUFFICIENT_RESOURCES|ERR_CONNECTION_RESET|ERR_HTTP2_PROTOCOL_ERROR|ERR_FAILED|Navigation timeout/i.test(String(e?.message||e)))throw e;
    await page.goto('about:blank',{waitUntil:'domcontentloaded',timeout:8000}).catch(()=>{});
    await sleep(1200);
    return page.goto(HOME,{waitUntil:'domcontentloaded',timeout:30000});
  }
}
function matchesMawb(text='',digits=''){
  const normalized=String(text).replace(/\s+/g,'');
  return normalized.includes(digits)||normalized.includes(digits.slice(0,3)+'-'+digits.slice(3));
}
async function clickMatchingShipment(page,digits){
  for(const frame of page.frames()){
    const found=await rootsEval(frame,value=>{
      const roots=[document];
      for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);
      for(const root of roots){
        for(const el of root.querySelectorAll?.('a,[role="link"],td,span,[role="button"]')||[]){
          const label=String(el.innerText||el.textContent||'').trim();
          const labeledDigits=label.replace(/\D/g,'');
          if(label.length>90||(labeledDigits!==value&&labeledDigits!==value.slice(3)))continue;
          const rect=el.getBoundingClientRect();
          if(rect.width<3||rect.height<3)continue;
          const target=el.closest?.('a,[role="link"],[role="button"],tr')||el;
          target.click();return {clicked:true,label,tag:target.tagName};
        }
      }
      return null;
    },digits);
    if(found?.clicked)return{...found,frameUrl:frame.url()};
  }
  return null;
}

async function rootsEval(frame,fn,...args){return frame.evaluate(fn,...args).catch(()=>null);}
async function acceptCookies(page){for(const frame of page.frames())await rootsEval(frame,()=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);const text=e=>String(e.innerText||e.textContent||e.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();for(const root of roots){const b=[...(root.querySelectorAll?.('button,a,[role="button"]')||[])].find(e=>/accept all cookies|^accept$|^allow all$/i.test(text(e)));if(b){b.click();return true;}}return false;});}

async function findMawbInput(frame){const inputs=await frame.$$('input,textarea');let best=null;for(const input of inputs){try{const meta=await input.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);const text=`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''} ${el.getAttribute('formcontrolname')||''}`;let score=0;if(/doc\.?\s*no|document|awb|air\s*way|waybill/i.test(text))score+=120;if(/176\d|e\.g\.?\s*176/i.test(text))score+=80;if(/email|password|login|username/i.test(text))score-=200;return{visible:r.width>60&&r.height>18&&s.display!=='none'&&s.visibility!=='hidden'&&!el.disabled,score,text,maxLength:Number(el.maxLength||-1)};});if(meta.visible&&(!best||meta.score>best.meta.score))best={input,meta};}catch{}}return best&&best.meta.score>=20?best:null;}

async function fillMawb(page,digits,{preferSerial=false}={}){
  const serial=digits.slice(3);
  for(let attempt=0;attempt<10;attempt++){
    for(const frame of page.frames()){
      const found=await findMawbInput(frame);if(!found)continue;
      // eSkyCargo sometimes renders a separate "Doc. No." 8-character field
      // beside a fixed 176 prefix. Do not truncate the 11-digit AWB there.
      const shortField=found.meta.maxLength>0&&found.meta.maxLength<=8;
      const value=shortField||preferSerial?serial:digits;
      try{
        await found.input.click({clickCount:3});
        await page.keyboard.press('Backspace');
        await found.input.type(value,{delay:40});
        await sleep(200);
        // eSkyCargo uses ng2-tag-input: Enter commits the AWB as a chip and
        // clears the text box. An empty input AFTER Enter is expected, not a
        // failed entry. The Search button is a separate step.
        await found.input.press('Enter');
        await sleep(550);
        const state=await frame.evaluate(()=>({
          body:String(document.body?.innerText||''),
          values:[...document.querySelectorAll('input,textarea')].map(e=>String(e.value||''))
        }));
        const body=state.body.replace(/\s+/g,'');
        const tokenSeen=body.includes(digits)||body.includes('176-'+serial)||
          (value===serial&&body.includes(serial))||
          state.values.some(v=>v.replace(/\D/g,'')===value);
        if(tokenSeen)return{ok:true,value,meta:found.meta.text,frameUrl:frame.url(),tokenCommitted:!state.values.some(v=>v.replace(/\D/g,'')===value),shortField};
      }catch{}
    }
    await sleep(700);
  }
  return{ok:false};
}

async function clickSearchClosest(page){
  for(let attempt=0;attempt<8;attempt++){
    for(const frame of page.frames()){
      const r=await rootsEval(frame,()=>{
        const roots=[document];for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);
        const visible=e=>{try{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&e.getAttribute?.('aria-disabled')!=='true';}catch{return false;}};
        const text=e=>String(e.innerText||e.value||e.textContent||e.getAttribute?.('aria-label')||'').replace(/\s+/g,' ').trim();
        let input=null,bestScore=-999;
        for(const root of roots)for(const e of root.querySelectorAll?.('input,textarea')||[]){if(!visible(e))continue;const meta=`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute?.('aria-label')||''} ${e.getAttribute?.('formcontrolname')||''}`;let score=0;if(/doc\.?\s*no|document|awb|air\s*way|waybill/i.test(meta))score+=120;if(/176\d|e\.g\.?\s*176/i.test(meta))score+=80;if(score>bestScore){bestScore=score;input=e;}}
        if(!input)return null;const ir=input.getBoundingClientRect(),ix=ir.left+ir.width/2,iy=ir.top+ir.height/2;const candidates=[];
        for(const root of roots)for(const b of root.querySelectorAll?.('button,input[type="submit"],input[type="button"],a,[role="button"]')||[]){if(!visible(b)||!/^Search$/i.test(text(b)))continue;const br=b.getBoundingClientRect(),bx=br.left+br.width/2,by=br.top+br.height/2;candidates.push({b,distance:Math.hypot(bx-ix,by-iy),label:text(b)});}candidates.sort((a,b)=>a.distance-b.distance);const p=candidates[0];if(!p)return null;p.b.click();return{ok:true,label:p.label,distance:Math.round(p.distance)};
      });
      if(r?.ok)return{...r,frameUrl:frame.url()};
    }
    await sleep(650);
  }
  return null;
}

async function clickNativeText(page,rx){
  for(let attempt=0;attempt<10;attempt++){
    for(const frame of page.frames()){
      const handles=await frame.$$('button,a,[role="button"],[role="tab"],input[type="submit"],input[type="button"]');
      for(const handle of handles){
        try{
          const meta=await handle.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{visible:r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden',disabled:Boolean(el.disabled||el.getAttribute('aria-disabled')==='true'),text:String(el.innerText||el.value||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'').replace(/\s+/g,' ').trim()};});
          if(meta.visible&&!meta.disabled&&rx.test(meta.text)){
            await handle.click({delay:100});
            return{label:meta.text,frameUrl:frame.url(),native:true};
          }
        }catch{}
      }
    }
    await sleep(700);
  }
  return null;
}

async function clickDeepText(page,rx){for(let attempt=0;attempt<12;attempt++){for(const frame of page.frames()){const r=await rootsEval(frame,(source,flags)=>{const re=new RegExp(source,flags),roots=[document];for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll?.('*')||[])if(el.shadowRoot)roots.push(el.shadowRoot);const visible=e=>{try{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';}catch{return false;}};const text=e=>String(e.innerText||e.value||e.textContent||e.getAttribute?.('aria-label')||e.getAttribute?.('title')||'').replace(/\s+/g,' ').trim();for(const root of roots){const els=[...(root.querySelectorAll?.('button,a,[role="button"],[role="tab"],input[type="submit"],input[type="button"],span,div,p')||[])].filter(visible);const exact=els.find(e=>re.test(text(e)));if(!exact)continue;const clickable=exact.closest?.('button,a,[role="button"],[role="tab"],[tabindex]')||exact;if(clickable.disabled||clickable.getAttribute?.('aria-disabled')==='true')continue;clickable.click();return{text:text(exact)};}return null;},rx.source,rx.flags);if(r?.text)return{label:r.text,frameUrl:frame.url(),native:false};}await sleep(700);}return null;}
async function combinedText(page){const out=[];for(const frame of page.frames()){const t=await rootsEval(frame,()=>String(document.body?.innerText||''));if(t)out.push(t);}return clean(out.join(' '));}
function noMatchingRecord(text='',network=[],digits=''){const count=text.match(/Search\s+Results\s*\((\d+)\)/i);if(count&&Number(count[1])>0)return false;if(/Search\s+Results\s*\(0\)|No matching records? found/i.test(text))return true;const serial=digits.slice(3),relevant=network.filter(n=>n.body.includes(digits)||n.body.includes(serial));return relevant.some(n=>/BOOKING_NOT_FOUND|There is no matching result found|no matching result found for your shipment reference/i.test(n.body));}
function trackingDetailsVisible(text=''){return /Tracking\s+Details/i.test(text)&&/(Latest status at|Milestones|Planned Time|Actual Time|Pieces?|Weight|Arrived|Received|Departed|Flight\s+EK|\bBKD\b|\bDEP\b|\bARR\b|\bRCF\b)/i.test(text);}

export async function trackEmirates(mawb){
  const digits=digitsOnly(mawb);if(!/^176\d{8}$/.test(digits))return{ok:false,reason:'INVALID EMIRATES MAWB',officialTracker:HOME};let browser;
  try{
    browser=await launch();const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});await optimizePage(page);
    const network=[];page.on('response',res=>{(async()=>{try{const req=res.request(),url=res.url(),type=req.resourceType(),ct=(res.headers()['content-type']||'').toLowerCase();if(!['xhr','fetch'].includes(type)||!/eskycargo\.emirates\.com/i.test(url)||!/json|text|javascript/.test(ct))return;const body=clean(await res.text());if(body&&body.length<500000)network.push({url,body:body.slice(0,80000)});}catch{}})();});
    await openHome(page);await sleep(2200);await acceptCookies(page);await sleep(1200);
    let filled=await fillMawb(page,digits);if(!filled.ok)return{ok:false,reason:'EMIRATES DOC NUMBER FIELD NOT FOUND',officialTracker:HOME,debug:{stage:'fill-mawb',filled,url:page.url()}};
    let searched=await clickSearchClosest(page);if(!searched)searched=await clickDeepText(page,/^Search$/i);if(!searched)return{ok:false,reason:'EMIRATES SEARCH BUTTON NOT FOUND',officialTracker:HOME,debug:{stage:'search',filled,url:page.url(),bodySample:(await combinedText(page)).slice(0,2800)}};
    await sleep(4500);
    await page.waitForFunction(()=>/\/shipments\/list\/\d+(?:\?|$)/.test(location.hash),{timeout:9500,polling:500}).catch(()=>null);
    let panelText=await combinedText(page);
    // A zero-result response for the full AWB can be caused by a serial-only
    // Doc. No. input. Retry with the 8-digit serial before declaring not found.
    if(noMatchingRecord(panelText,network,digits)&&filled.value===digits){
      const retryFilled=await fillMawb(page,digits,{preferSerial:true});
      if(retryFilled.ok){
        filled=retryFilled;
        network.length=0; // discard errors from the initial full-number search
        const retrySearch=await clickSearchClosest(page)||await clickDeepText(page,/^Search$/i);
        if(retrySearch){
          searched=retrySearch;
          await sleep(4500);
          await page.waitForFunction(()=>/\/shipments\/list\/\d+(?:\?|$)/.test(location.hash),{timeout:5500,polling:500}).catch(()=>null);
          panelText=await combinedText(page);
        }
      }
    }
    if(noMatchingRecord(panelText,network,digits))return{ok:false,notFound:true,reason:'EMIRATES NO MATCHING RECORD',officialTracker:page.url(),debug:{stage:'no-record',filled,searched,url:page.url(),bodySample:panelText.slice(0,4000),networkUrls:[...new Set(network.map(n=>n.url))].slice(-16)}};

    const searchResultUrl=page.url();
    let resultClicked=null;
    if(!/#\/shipments\/list\/\d+/.test(page.url())){
      resultClicked=await clickMatchingShipment(page,digits);
      if(resultClicked)await sleep(2200);
    }
    // Some search results hide Tracking Details until Show Details expands the AWB.
    if(/\bShow\s+Details\b/i.test(panelText)&&matchesMawb(panelText,digits)){
      const expand=await clickNativeText(page,/^Show\s+Details$/i);
      if(expand)await sleep(1000);
    }
    let trackingClick=await clickNativeText(page,/^Tracking\s+Details$/i);
    if(!trackingClick)trackingClick=await clickDeepText(page,/^Tracking\s+Details$/i);
    if(!trackingClick){
      // Some result pages expose the shipment route before the tab control renders.
      // A deep link is safe only after the result has supplied a shipment id;
      // the returned panel must still independently match the requested AWB.
      const match=page.url().match(/#\/shipments\/list\/(\d+)/);
      if(match){
        await page.goto(HOME.split('#')[0]+'#/shipments/list/'+match[1]+'?openedTab=tracking-details',{waitUntil:'domcontentloaded',timeout:25000}).catch(()=>null);
        await sleep(2600);
        const directPanel=await combinedText(page);
        if(matchesMawb(directPanel,digits)&&trackingDetailsVisible(directPanel))
          trackingClick={label:'Tracking Details direct tab',frameUrl:page.url(),native:false};
      }
    }
    if(!trackingClick)return{ok:false,reason:'EMIRATES TRACKING DETAILS BUTTON NOT FOUND',officialTracker:page.url(),debug:{stage:'tracking-details-button',filled,searched,resultClicked,url:page.url(),bodySample:(await combinedText(page)).slice(0,5600),networkUrls:[...new Set(network.map(n=>n.url))].slice(-16)}};

    await page.waitForFunction(()=>location.hash.includes('openedTab=tracking-details'),{timeout:9000}).catch(()=>null);
    await sleep(1800);panelText=await combinedText(page);
    for(let attempt=0;attempt<9&&!trackingDetailsVisible(panelText);attempt++){
      await sleep(800);panelText=await combinedText(page);
    }
    const detailsUrl=page.url();
    const detailsOpened=trackingDetailsVisible(panelText);
    if(!detailsOpened)return{ok:false,reason:'EMIRATES TRACKING DETAILS DID NOT RENDER',officialTracker:detailsUrl,debug:{stage:'tracking-details-open',filled,searched,resultClicked,trackingClick,searchResultUrl,url:detailsUrl,bodySample:panelText.slice(0,7000),networkUrls:[...new Set(network.map(n=>n.url))].slice(-16)}};

    const awbMatched=matchesMawb(panelText,digits);
    if(!awbMatched)return{ok:false,reason:'EMIRATES TRACKING DETAILS AWB MISMATCH',officialTracker:detailsUrl,debug:{stage:'verify-awb',filled,searched,url:detailsUrl,bodySample:panelText.slice(0,3200)}};
    const screenshotBase64=await page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);if(!screenshotBase64)return{ok:false,reason:'EMIRATES TRACKING DETAILS SCREENSHOT FAILED',officialTracker:detailsUrl,debug:{stage:'screenshot',filled,searched,trackingClick,url:detailsUrl,panelSample:panelText.slice(0,5000)}};
    const shipment={mawb,carrierCode:'EK',airlineName:'Emirates SkyCargo',officialTracker:detailsUrl,source:'Emirates eSkyCargo Tracking Details screenshot + rendered text'};
    return{ok:true,shipment,screenshotBase64,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:false,debug:{stage:'done-search-tracking-details',filled,searched,trackingClick,searchResultUrl,url:detailsUrl,panelSample:panelText.slice(0,18000),awbMatched,networkUrls:[...new Set(network.map(n=>n.url))].slice(-16)}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:HOME,debug:{stage:'exception'}};}finally{try{if(browser)await browser.close();}catch{}}
}
