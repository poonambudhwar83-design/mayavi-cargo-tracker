import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export const preferredRegion='hkg1';

const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-US,en'],
    executablePath:await chromium.executablePath(),
    headless:'shell',
    defaultViewport:{width:1440,height:1100}
  });
}
async function setInput(page,selector,value){
  const el=await page.$(selector);if(!el)return false;
  await el.click({clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
  await el.type(value,{delay:50});return true;
}

export async function GET(request){
  const u=new URL(request.url),digits=String(u.searchParams.get('mawb')||'16015505453').replace(/\D/g,'');
  const serial=digits.slice(3);let browser;const hits=[];
  try{
    browser=await launch();const page=await browser.newPage();
    page.on('request',req=>{
      if(!/cargo-shipments\/v1\/tracking/i.test(req.url()))return;
      hits.push({kind:'request',url:req.url(),method:req.method(),postData:req.postData()||'',headers:req.headers()});
    });
    page.on('response',async res=>{
      if(!/cargo-shipments\/v1\/tracking/i.test(res.url()))return;
      let body='';try{body=await res.text();}catch{}
      hits.push({kind:'response',url:res.url(),status:res.status(),headers:res.headers(),body:body.slice(0,12000)});
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:25000});await sleep(1800);
    await page.evaluate(()=>{for(const e of document.querySelectorAll('button,[role="button"]')){const t=(e.innerText||e.textContent||'').trim();if(/accept all|accept cookies/i.test(t)){e.click();break;}}}).catch(()=>{});
    const prefix=await page.$('input[id*="airlineCodeField" i],input[name*="airlineCodeField" i],input[placeholder="160"]');
    if(prefix){await prefix.click({clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await prefix.type('160',{delay:60});await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.keyboard.press('Tab');}
    await sleep(1000);
    const awb=await page.$('input[id*="airWaybill" i],input[name*="airWaybill" i]');
    if(awb){await awb.click({clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await awb.type(serial,{delay:60});await page.keyboard.press('Enter');}
    await sleep(700);
    await page.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>10&&r.height>8&&!e.disabled;};const all=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);const b=all.find(e=>/^track\s*(now)?$/i.test((e.innerText||e.value||e.textContent||'').trim()));if(b)b.click();}).catch(()=>{});
    await sleep(9000);
    return Response.json({ok:true,region:process.env.VERCEL_REGION||'',prefixFound:Boolean(prefix),awbFound:Boolean(awb),hits});
  }catch(error){return Response.json({ok:false,region:process.env.VERCEL_REGION||'',error:error?.message||String(error),hits},{status:500});}
  finally{try{if(browser)await browser.close();}catch{}}
}
