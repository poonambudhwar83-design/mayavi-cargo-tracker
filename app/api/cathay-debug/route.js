import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function acceptCookiesDeep(page){
  let clicked=false;
  for(let round=0;round<5;round++){
    for(const frame of page.frames()){
      try{
        const c=await frame.evaluate(()=>{
          const roots=[document];
          for(const e of document.querySelectorAll('*')) if(e.shadowRoot) roots.push(e.shadowRoot);
          for(const root of roots){
            const els=[...root.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]')];
            const b=els.find(x=>/accept all|accept cookies|allow all|agree/i.test((x.innerText||x.value||x.textContent||x.getAttribute('aria-label')||'').trim()));
            if(b){b.click();return true;}
          }
          return false;
        });
        clicked=clicked||c;
      }catch{}
    }
    if(clicked){await sleep(700);break;}
    await sleep(500);
  }
  return clicked;
}

async function setValue(page,handle,value){
  await handle.click({clickCount:3});
  await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
  await handle.type(String(value),{delay:60});await sleep(200);
  return handle.evaluate(e=>String(e.value||e.textContent||''));
}

async function enterAwb(page,serial){
  const airline=await page.$('input[aria-label*="Airline" i],input[id*="airlinecodefield" i],input[placeholder="160"]');
  if(!airline)return{ok:false,mode:'no-airline-input'};
  const airlineValue=await setValue(page,airline,'160');
  let awb=await page.$('input[name$="_airWaybill" i],input[id*="airWaybill" i],input[placeholder*="12345678"],textarea[name$="_airWaybill" i],[contenteditable="true"][aria-label*="waybill" i],[role="textbox"][aria-label*="waybill" i]');
  let beforeCommit='',mode='direct-awb-input';
  if(awb){
    beforeCommit=await setValue(page,awb,serial);
    await awb.press('Enter').catch(()=>{});
  } else {
    mode='retype-160-tab-awb-enter';
    await airline.click();await page.keyboard.press('Tab');await sleep(250);
    await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
    await page.keyboard.type(serial,{delay:65});await sleep(300);
    beforeCommit=await page.evaluate(()=>String(document.activeElement?.value||document.activeElement?.textContent||''));
    await page.keyboard.press('Enter');
  }
  await sleep(650);
  const body=(await page.evaluate(()=>document.body?.innerText||'')).replace(/\s/g,'');
  return{ok:body.includes(serial),mode,beforeCommit,airlineValue};
}

async function clickTrackNow(page){
  return page.evaluate(()=>{
    const visible=n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>16&&r.height>10&&!n.disabled;};
    const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);
    const btn=els.find(n=>/^track\s*now$/i.test((n.innerText||n.value||n.textContent||n.getAttribute('aria-label')||'').trim()));
    if(!btn)return'';
    const t=(btn.innerText||btn.value||btn.textContent||'').trim();btn.click();return t||'Track now';
  }).catch(()=> '');
}

export async function GET(request){
  const q=new URL(request.url).searchParams.get('mawb')||'16015505453';
  const digits=String(q).replace(/\D/g,'');
  const serial=digits.slice(-8);
  let browser;
  const trackingRequests=[];
  const trackingResponses=[];
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-US,en'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    page.on('request',req=>{
      try{
        if(!/cargo-shipments\/v1\/tracking/i.test(req.url()))return;
        const h=req.headers();
        const selected={};
        for(const k of ['content-type','accept','origin','referer','x-api-key','authorization','x-requested-with','ocp-apim-subscription-key','client-id','x-client-id']) if(h[k]) selected[k]=h[k];
        trackingRequests.push({url:req.url(),method:req.method(),headers:selected,postData:req.postData()||''});
      }catch{}
    });
    page.on('response',async res=>{
      try{
        if(!/cargo-shipments\/v1\/tracking/i.test(res.url()))return;
        const text=await res.text().catch(()=> '');
        trackingResponses.push({url:res.url(),status:res.status(),headers:res.headers(),body:text.slice(0,5000)});
      }catch{}
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:22000});
    await sleep(1800);
    const cookies=await acceptCookiesDeep(page);
    await sleep(800);
    const entry=await enterAwb(page,serial);
    const clicked=await clickTrackNow(page);
    await Promise.race([page.waitForNetworkIdle({idleTime:800,timeout:10000}).catch(()=>{}),sleep(10000)]);
    await sleep(1000);
    const pageText=(await page.evaluate(()=>document.body?.innerText||'')).slice(0,6000);
    return Response.json({ok:true,cookies,entry,clicked,trackingRequests,trackingResponses,pageText});
  }catch(e){return Response.json({ok:false,error:String(e?.message||e),trackingRequests,trackingResponses},{status:500});}
  finally{try{if(browser)await browser.close();}catch{}}
}
