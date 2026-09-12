import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function launch(){
  const executablePath=await chromium.executablePath();
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],
    defaultViewport:{width:1440,height:1000},
    executablePath,
    headless:true,
  });
}

function interesting(url,ct){
  return /shipment|track|cargo|awb|waybill|event|milestone|status|api|graphql|booking/i.test(url)||/json/i.test(ct||'');
}

export async function GET(request){
  const u=new URL(request.url);
  const raw=String(u.searchParams.get('mawb')||'60754691954').replace(/\D/g,'');
  const serial=raw.slice(-8);
  let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'accept-language':'en-US,en;q=0.9'});
    await page.evaluateOnNewDocument(()=>{
      Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
      Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});
      Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
      window.chrome=window.chrome||{runtime:{}};
    });

    const records=[];
    page.on('request',req=>{
      try{
        const h=req.headers();
        if(interesting(req.url(),h.accept||'')) records.push({kind:'request',method:req.method(),url:req.url(),postData:(req.postData()||'').slice(0,4000)});
      }catch{}
    });
    page.on('response',async res=>{
      try{
        const ct=res.headers()['content-type']||'';
        if(!interesting(res.url(),ct)) return;
        let body='';
        if(/json|text|javascript|xml/i.test(ct)) body=(await res.text()).slice(0,12000);
        records.push({kind:'response',status:res.status(),url:res.url(),contentType:ct,body});
      }catch{}
    });

    await page.goto('https://www.etihadcargo.com/en/e-services/shipment-tracking',{waitUntil:'networkidle2',timeout:90000});
    await sleep(2500);

    const prefixBefore=await page.$eval('input',el=>el.value).catch(()=>null);
    const inputs=await page.$$('input');
    let target=null;
    for(const el of inputs){
      const meta=await el.evaluate(n=>({value:n.value||'',ph:n.placeholder||'',type:n.type||'',name:n.name||'',aria:n.getAttribute('aria-label')||''}));
      if(meta.type==='hidden') continue;
      const key=`${meta.ph} ${meta.name} ${meta.aria}`;
      if(/airway|awb|waybill/i.test(key) && meta.value!=='607'){target=el;break;}
      if(!target && meta.value!=='607') target=el;
    }
    if(!target) return Response.json({ok:false,stage:'NO_INPUT',url:page.url()},{status:503});

    await target.click({clickCount:3});
    await target.type(serial,{delay:120});
    await sleep(1200);

    let clicked='';
    const buttons=await page.$$('button,[role="button"],input[type="submit"]');
    for(const b of buttons){
      const label=clean(await b.evaluate(n=>n.innerText||n.value||n.textContent||''));
      if(/^track$/i.test(label)){await b.click();clicked=label;break;}
    }
    if(!clicked){await target.press('Enter').catch(()=>{});clicked='ENTER';}

    await sleep(12000);
    const body=clean(await page.evaluate(()=>document.body?.innerText||''));
    const cookies=await page.cookies();
    const useful=records.filter(r=>!/google|adobe|tiktok|bing|cookielaw|snap|analytics|doubleclick|facebook|fonts|polyfill/i.test(r.url));
    return Response.json({
      ok:/shipment has been delivered|shipment arrived|received from flight|\b46\/46\b|\b1260\/1260\b/i.test(body),
      stage:'AFTER_TRACK',
      prefixBefore,
      serial,
      clicked,
      url:page.url(),
      body:body.slice(0,12000),
      cookies:cookies.map(c=>({name:c.name,domain:c.domain})),
      network:useful.slice(-80)
    },{status:200});
  }catch(e){
    return Response.json({ok:false,stage:'ERROR',reason:e?.message||String(e)},{status:500});
  }finally{
    if(browser) await browser.close().catch(()=>{});
  }
}
