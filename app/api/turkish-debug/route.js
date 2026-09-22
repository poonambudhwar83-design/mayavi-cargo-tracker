import fs from 'node:fs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const TRACK_URL='https://www.turkishcargo.com/en/online-services/shipment-tracking';
const NEW_TRACK_URL='https://www.turkishcargo.com/en/cargo-tracking';
const HOME_URL='https://www.turkishcargo.com/en';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p))return{executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');const chromium=mod.default||mod;
  return{executablePath:await chromium.executablePath(),args:chromium.args};
}

async function clickText(frame,wanted){
  return await frame.evaluate(label=>{
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
    const target=norm(label),hits=[];
    for(const el of document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a,[onclick],li,[role="option"],[role="menuitem"],div,span')){
      const r=el.getBoundingClientRect();const t=norm(el.innerText||el.value||el.textContent||'');
      if(r.width>3&&r.height>3&&t===target)hits.push({el,area:r.width*r.height});
    }
    hits.sort((a,b)=>a.area-b.area);if(!hits.length)return false;hits[0].el.click();return true;
  },wanted).catch(()=>false);
}

async function snapshot(page){
  const frames=[];
  for(const frame of page.frames()){
    try{
      const x=await frame.evaluate(()=>{
        const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
        const inputs=[...document.querySelectorAll('input,textarea')].map(e=>({type:e.type,value:e.value,max:e.maxLength,placeholder:e.placeholder,name:e.name,id:e.id,disabled:e.disabled})).slice(0,30);
        const buttons=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].map(e=>norm(e.innerText||e.value||e.textContent)).filter(Boolean).slice(0,60);
        return{url:location.href,text:norm(document.body?.innerText||'').slice(0,12000),inputs,buttons,html:norm(document.body?.innerHTML||'').slice(0,16000)};
      });
      frames.push(x);
    }catch{}
  }
  return frames;
}

export async function GET(req){
  const u=new globalThis.URL(req.url);const raw=(u.searchParams.get('mawb')||'').replace(/\D/g,'');
  if(raw.length===11&&raw.startsWith('235')&&u.searchParams.get('direct')==='1'){
    const serial=raw.slice(3),prefix=raw.slice(0,3);
    try{
      const res=await fetch('https://www.turkishcargo.com/api/proxy/onlineServices/shipmentTracking',{
        method:'POST',
        headers:{
          'content-type':'application/json',
          'accept':'application/json, text/plain, */*',
          'origin':'https://www.turkishcargo.com',
          'referer':'https://www.turkishcargo.com/en/cargo-tracking',
          'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
        },
        body:JSON.stringify({trackingFilters:[{shipmentPrefix:prefix,masterDocumentNumber:serial}]}),
        cache:'no-store',
        signal:AbortSignal.timeout(20000)
      });
      const text=await res.text();
      let json=null;try{json=JSON.parse(text)}catch{}
      return Response.json({ok:res.ok,status:res.status,prefix,serial,json,text:text.slice(0,30000)});
    }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500})}
  }
  if(raw.length!==11||!raw.startsWith('235'))return Response.json({ok:false,reason:'Use mawb=235xxxxxxxx'},{status:400});
  const serial=raw.slice(3),prefix=raw.slice(0,3),requests=[],responses=[];let browser;
  try{
    const mod=await import('puppeteer-core');const puppeteer=mod.default||mod;const launch=await browserConfig();
    browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1440,height:1000}});const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('request',r=>{try{const method=r.method(),url=r.url(),post=r.postData()||'';if(method!=='GET'||/awb|cargo|track|shipment|search|api/i.test(url)){requests.push({method,url,post:post.slice(0,2000),type:r.resourceType()});if(requests.length>120)requests.shift();}}catch{}});
    page.on('response',async r=>{try{const url=r.url(),ct=r.headers()['content-type']||'';if(/json|text/i.test(ct)||/awb|cargo|track|shipment|search|api/i.test(url)){let body='';try{body=(await r.text()).slice(0,5000)}catch{}responses.push({status:r.status(),url,ct,body:clean(body)});if(responses.length>80)responses.shift();}}catch{}});
    const targetUrl=u.searchParams.get('home')==='1'?HOME_URL:(u.searchParams.get('new')==='1'?NEW_TRACK_URL:TRACK_URL);
    await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:30000});await sleep(1800);
    for(const f of page.frames())await clickText(f,'Accept all');
    const before=await snapshot(page);
    let formFrame=null,nf=null,pf=null;
    for(const f of page.frames()){
      const fields=[];
      for(const input of await f.$$('input:not([type="hidden"]),textarea')){
        try{const m=await input.evaluate(e=>{const r=e.getBoundingClientRect();return{visible:r.width>3&&r.height>3&&!e.disabled&&!e.readOnly,max:Number(e.maxLength||-1),label:`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.labels?.[0]?.innerText||''}`}});if(m.visible)fields.push({input,m});}catch{}
      }
      pf=fields.find(x=>x.m.max===3||/prefix|awb code|airline code/i.test(x.m.label));
      nf=fields.find(x=>x!==pf&&(x.m.max===8||/awb|air waybill/i.test(x.m.label)))||fields.find(x=>[11,12,14].includes(x.m.max));
      if(nf){formFrame=f;break;}
    }
    if(!formFrame)return Response.json({ok:false,stage:'NO_FORM',before,requests,responses},{status:500});
    if(pf){await pf.input.click({clickCount:3});await page.keyboard.press('Backspace');await pf.input.type(prefix,{delay:40});}
    await nf.input.click({clickCount:3});await page.keyboard.press('Backspace');await nf.input.type(nf.m.max===8?serial:(pf?serial:raw),{delay:40});await sleep(1200);
    const afterType=await snapshot(page);

    if(u.searchParams.get('home')==='1'){
      // Homepage has a simpler AWB widget: keep prefilled 235, enter 8-digit serial, click Track.
      if(pf){
        const currentPrefix=await pf.input.evaluate(e=>String(e.value||'').replace(/\D/g,''));
        if(currentPrefix!==prefix){
          await pf.input.evaluate((e,v)=>{
            const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
            if(setter)setter.call(e,v);else e.value=v;
            e.dispatchEvent(new Event('input',{bubbles:true}));
            e.dispatchEvent(new Event('change',{bubbles:true}));
            e.dispatchEvent(new Event('blur',{bubbles:true}));
          },prefix);
        }
      }
      await nf.input.click({clickCount:3});
      await page.keyboard.press('Backspace');
      await nf.input.type(serial,{delay:35});
      await sleep(700);
      const beforeTrack=await snapshot(page);
      const tracked=await clickText(formFrame,'Track');
      if(!tracked){
        for(const fr of page.frames()){
          if(await clickText(fr,'Track'))break;
        }
      }
      await sleep(4500);
      const afterTrack=await snapshot(page);
      for(const fr of page.frames())try{await fr.evaluate(()=>window.scrollBy(0,700))}catch{}
      await sleep(1200);
      const afterScroll=await snapshot(page);
      if(u.searchParams.get('compact')==='1'){
        const brief=arr=>(arr||[]).map(x=>({url:x.url,text:clean(x.text||'').slice(0,5200),inputs:x.inputs,buttons:x.buttons}));
        return Response.json({ok:true,mode:'HOME_TRACK',tracked,beforeTrack:brief(beforeTrack),afterTrack:brief(afterTrack),afterScroll:brief(afterScroll),requests:requests.slice(-40),responses:responses.slice(-40)});
      }
      return Response.json({ok:true,mode:'HOME_TRACK',tracked,beforeTrack,afterTrack,afterScroll,requests,responses});
    }

    let added=await clickText(formFrame,`Add: ${serial}`);let addMode='CLICK_ADD';
    if(!added){await nf.input.press('ArrowDown');await nf.input.press('Enter');addMode='ARROWDOWN_ENTER';}
    await sleep(1200);
    const afterAdd=await snapshot(page);
    const searched=await clickText(formFrame,'Search');await sleep(3500);
    const afterSearch=await snapshot(page);
    for(const f of page.frames())try{await f.evaluate(()=>window.scrollBy(0,650))}catch{}
    await sleep(1800);
    const afterScroll=await snapshot(page);
    if(u.searchParams.get('compact')==='1'){
      const brief=arr=>(arr||[]).map(x=>({url:x.url,text:clean(x.text||'').slice(0,4200),inputs:x.inputs,buttons:x.buttons}));
      return Response.json({
        ok:true,addMode,searched,
        afterAdd:brief(afterAdd),afterSearch:brief(afterSearch),afterScroll:brief(afterScroll),
        requests:requests.slice(-30),responses:responses.slice(-30)
      });
    }
    return Response.json({ok:true,addMode,searched,before,afterType,afterAdd,afterSearch,afterScroll,requests,responses});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e),requests,responses},{status:500})}
  finally{if(browser)try{await browser.close()}catch{}}
}
