import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';
import { readTrackingScreenshot } from './screenshotOcr.js';

const OFFICIAL='https://cargo.omanair.com/track-shipment';
const AIRLINE={name:'Oman Air Cargo',iata:'WY',url:OFFICIAL};
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    defaultViewport:{width:1600,height:1200,deviceScaleFactor:1},
    executablePath:await chromium.executablePath(),
    headless:'shell'
  });
}

async function screenshotResult(page){
  try{
    await page.evaluate(()=>{
      const candidates=[...document.querySelectorAll('table,[role="table"],.table,.tracking-result,.track-result,.shipment,.shipment-details,.result,.results')];
      const visible=candidates.find(el=>{
        const r=el.getBoundingClientRect();
        const s=getComputedStyle(el);
        return r.width>200&&r.height>80&&s.display!=='none'&&s.visibility!=='hidden';
      });
      if(visible)visible.scrollIntoView({block:'center',inline:'nearest'});
    });
  }catch{}
  await new Promise(r=>setTimeout(r,350));
  return page.screenshot({type:'png',fullPage:false,encoding:'base64'}).catch(()=>null);
}

export async function trackOman(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('910-')){
    return{ok:false,reason:'INVALID OMAN AIR CARGO MAWB',airline:AIRLINE,officialTracker:OFFICIAL};
  }

  const full=mawb.replace(/\D/g,'');
  const serial=mawb.slice(4);
  let browser;
  const captured=[];

  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');

    page.on('response',async res=>{
      try{
        const type=res.request().resourceType();
        if(!['xhr','fetch','document'].includes(type))return;
        const ct=String(res.headers()['content-type']||'');
        if(!/json|text|javascript|html/i.test(ct))return;
        const body=await res.text();
        if(body&&body.length<1200000&&(body.includes(serial)||body.replace(/\D/g,'').includes(full)||/shipment|airway|awb|flight|arrival|pieces|weight/i.test(body))){
          captured.push(body);
        }
      }catch{}
    });

    await page.goto(OFFICIAL,{waitUntil:'domcontentloaded',timeout:15000});
    await new Promise(r=>setTimeout(r,900));

    const before=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    if(/captcha|verify you are human|security check|cloudflare|turnstile|access denied/i.test(before)){
      return{
        ok:false,
        reason:'OMAN AIR SECURITY CHECK REQUIRES MANUAL CHECK',
        airline:AIRLINE,
        officialTracker:OFFICIAL,
        debug:{stage:'CAPTCHA'}
      };
    }

    const setup=await page.evaluate(({full,serial})=>{
      const visible=e=>{
        const s=getComputedStyle(e),r=e.getBoundingClientRect();
        return s.display!=='none'&&s.visibility!=='hidden'&&r.width>3&&r.height>3&&!e.disabled;
      };
      const inputs=[...document.querySelectorAll('input')]
        .filter(visible)
        .filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
      const target=inputs.find(e=>/airway|awb|shipment|track/.test(desc(e)))||inputs[0];
      if(!target)return{filled:false,inputCount:inputs.length};

      target.focus();
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      setter?.call(target,full);
      target.dispatchEvent(new Event('input',{bubbles:true}));
      target.dispatchEvent(new Event('change',{bubbles:true}));
      target.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Tab'}));
      target.dispatchEvent(new Event('blur',{bubbles:true}));

      return{
        filled:true,
        value:target.value,
        inputCount:inputs.length,
        serial,
        form:Boolean(target.form||target.closest('form'))
      };
    },{full,serial}).catch(()=>({filled:false}));

    if(!setup.filled){
      return{
        ok:false,
        reason:'OMAN AIR AWB INPUT NOT FOUND',
        airline:AIRLINE,
        officialTracker:OFFICIAL,
        debug:{stage:'NO_INPUT',setup}
      };
    }

    const submit=await page.evaluate(()=>{
      const visible=e=>{
        const s=getComputedStyle(e),r=e.getBoundingClientRect();
        return s.display!=='none'&&s.visibility!=='hidden'&&r.width>3&&r.height>3&&!e.disabled;
      };
      const inputs=[...document.querySelectorAll('input')]
        .filter(visible)
        .filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''}`.toLowerCase();
      const field=inputs.find(e=>/airway|awb|shipment|track/.test(desc(e)))||inputs[0];
      if(!field)return{submitted:false,method:'NO_FIELD'};

      const form=field.form||field.closest('form');
      const label=e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();

      if(form){
        const controls=[...form.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);
        const btn=controls.find(e=>/track shipment|track|search|submit|go/i.test(label(e)));
        if(btn){
          btn.click();
          return{submitted:true,method:'FORM_BUTTON',button:label(btn)};
        }
        if(typeof form.requestSubmit==='function'){
          form.requestSubmit();
          return{submitted:true,method:'FORM_REQUEST_SUBMIT'};
        }
        form.submit();
        return{submitted:true,method:'FORM_SUBMIT'};
      }

      const controls=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);
      const btn=controls.find(e=>/track shipment|track|search|submit|go/i.test(label(e)));
      if(btn){
        btn.click();
        return{submitted:true,method:'PAGE_BUTTON',button:label(btn)};
      }

      field.focus();
      return{submitted:false,method:'NO_SUBMIT_CONTROL'};
    }).catch(()=>({submitted:false,method:'ERROR'}));

    if(!submit.submitted){
      await page.keyboard.press('Enter').catch(()=>{});
      submit.method='ENTER_FALLBACK';
    }

    try{await page.waitForNetworkIdle({idleTime:800,timeout:10000});}catch{}
    await new Promise(r=>setTimeout(r,1800));

    // Required Oman workflow:
    // official tracker -> fill AWB -> Track -> screenshot -> OCR screenshot -> Mayavi fields
    const screenshotBase64=await screenshotResult(page);
    if(!screenshotBase64){
      return{
        ok:false,
        reason:'OMAN AIR RESULT SCREENSHOT COULD NOT BE CAPTURED',
        airline:AIRLINE,
        officialTracker:OFFICIAL,
        debug:{stage:'SCREENSHOT_FAILED',setup,submit,captured:captured.length}
      };
    }

    const ocr=await readTrackingScreenshot({
      mawb,
      screenshotBase64,
      timeoutMs:35000
    });

    if(!ocr?.ok){
      return{
        ok:false,
        reason:`OMAN AIR SCREENSHOT OCR FAILED: ${ocr?.reason||'NO VERIFIED FIELDS'}`,
        airline:AIRLINE,
        officialTracker:OFFICIAL,
        screenshotBase64,
        screenshotCaptured:true,
        screenshotVerified:false,
        screenshotOcrUsed:true,
        debug:{
          stage:'SCREENSHOT_OCR_FAILED',
          setup,
          submit,
          captured:captured.length,
          ocr:ocr?.debug||null
        }
      };
    }

    const shipment={
      ...ocr.shipment,
      mawb,
      carrierCode:'WY',
      airlineName:AIRLINE.name,
      officialTracker:OFFICIAL,
      source:'Oman Air Cargo official result screenshot OCR'
    };

    return{
      ok:true,
      airline:AIRLINE,
      shipment,
      screenshotBase64,
      screenshotCaptured:true,
      screenshotVerified:true,
      screenshotOcrUsed:true,
      debug:{
        stage:'SCREENSHOT_OCR_SUCCESS',
        setup,
        submit,
        captured:captured.length,
        ocr:ocr.debug||null
      }
    };
  }catch(e){
    return{
      ok:false,
      reason:`OMAN AIR TRACKING ERROR: ${e?.message||e}`,
      airline:AIRLINE,
      officialTracker:OFFICIAL,
      debug:{stage:'ERROR'}
    };
  }finally{
    try{if(browser)await browser.close()}catch{}
  }
}
