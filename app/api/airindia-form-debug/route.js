import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const URL='https://cargo.airindia.com/in/en/track-shipment.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const text=async page=>page.evaluate(()=>String(document.body?.innerText||'').replace(/\s+/g,' ').trim()).catch(()=> '');

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
    await input.click({clickCount:3});await input.type('09800000000',{delay:20});await sleep(500);
    const submit='[data-testid="shipment-search-form-panel__submit-button"]';
    const enabled=await page.$eval(submit,e=>!e.disabled).catch(()=>false);
    if(enabled)await page.click(submit);
    await sleep(6500);
    const trackingBody=(await text(page)).slice(0,9000);
    let activityClicked=false,expandClicked=false;
    const activity='[data-testid="tabs-panel__tab-activityView"]';
    if(await page.$(activity)){await page.click(activity);activityClicked=true;await sleep(2500);}
    const expand=await page.$x?.('//div[@role="button" and contains(.,"Expand All")]').catch(()=>[]) || [];
    if(expand[0]){await expand[0].click();expandClicked=true;await sleep(2000);}else{
      expandClicked=await page.evaluate(()=>{const e=[...document.querySelectorAll('[role="button"]')].find(x=>/Expand All/i.test(String(x.innerText||x.textContent||'')));if(!e)return false;e.click();return true;}).catch(()=>false);if(expandClicked)await sleep(2000);
    }
    const activityBody=(await text(page)).slice(0,14000);
    return Response.json({ok:true,url:page.url(),submitted:enabled,activityClicked,expandClicked,trackingBody,activityBody});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500});}
  finally{try{if(browser)await browser.close()}catch{}}
}
