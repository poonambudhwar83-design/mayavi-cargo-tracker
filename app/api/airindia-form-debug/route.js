import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const URL='https://cargo.airindia.com/in/en/track-shipment.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export async function GET(){
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:25000});
    await sleep(8000);
    const input=await page.$('#shipmentValue');
    if(!input)return Response.json({ok:false,error:'shipmentValue input not found',url:page.url()},{status:500});
    await input.click({clickCount:3});
    await input.type('09800000000',{delay:20});
    await sleep(500);
    const enabled=await page.$eval('[data-testid="shipment-search-form-panel__submit-button"]',e=>!e.disabled).catch(()=>false);
    if(enabled)await page.click('[data-testid="shipment-search-form-panel__submit-button"]');
    await sleep(7000);
    const info=await page.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
      const inputs=[...document.querySelectorAll('input,select,textarea')].filter(visible).map(e=>({tag:e.tagName,type:e.type||'',name:e.name||'',id:e.id||'',placeholder:e.placeholder||'',value:e.value||'',html:e.outerHTML.slice(0,500)}));
      const buttons=[...document.querySelectorAll('button,a,[role="button"]')].filter(visible).map(e=>({text:String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,180),href:e.getAttribute('href')||'',disabled:Boolean(e.disabled),html:e.outerHTML.slice(0,500)})).slice(0,80);
      return{title:document.title,body:String(document.body?.innerText||'').replace(/\s+/g,' ').trim().slice(0,7000),inputs:inputs.slice(0,60),buttons};
    });
    return Response.json({ok:true,url:page.url(),submitted:enabled,info});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500});}
  finally{try{if(browser)await browser.close()}catch{}}
}
