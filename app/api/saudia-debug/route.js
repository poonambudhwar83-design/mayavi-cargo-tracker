import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const URL='https://saudiacargo.com/en/digital-services?tab=trackShipment';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export async function GET(request){
  const {searchParams}=new URL(request.url);
  const mawb=(searchParams.get('mawb')||'06511493554').replace(/\D/g,'');
  let browser;
  const requests=[];
  const responses=[];
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    page.on('request',r=>{try{const u=r.url();if(/saudiacargo|api|track|shipment/i.test(u))requests.push({method:r.method(),url:u,postData:(r.postData()||'').slice(0,4000),type:r.resourceType()});}catch{}});
    page.on('response',async r=>{try{const u=r.url();if(!/saudiacargo|api|track|shipment/i.test(u))return;const ct=String(r.headers()['content-type']||'');let body='';if(/json|text/i.test(ct)){body=(await r.text()).slice(0,8000);}responses.push({status:r.status(),url:u,contentType:ct,body});}catch{}});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:35000});
    await sleep(2200);
    const input=await page.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>40&&r.height>18&&!e.disabled&&!e.readOnly};const xs=[...document.querySelectorAll('input')].filter(visible);const x=xs.find(e=>/awb|air\s*waybill|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('form,section,div')?.innerText||''}`))||xs[0];if(!x)return null;x.dataset.mayavi='awb';return {placeholder:x.placeholder||'',name:x.name||'',id:x.id||'',type:x.type||''};});
    if(!input)return Response.json({ok:false,stage:'NO_INPUT',requests,responses});
    await page.click('[data-mayavi="awb"]',{clickCount:3}).catch(()=>{});
    await page.keyboard.press('Control+A').catch(()=>{});
    await page.keyboard.press('Backspace').catch(()=>{});
    await page.type('[data-mayavi="awb"]',mawb,{delay:45});
    const button=await page.evaluate(()=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6&&!e.disabled};const text=e=>String(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();const xs=[...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')].filter(visible);const b=xs.find(e=>/^(submit|search|track shipment|track)$/i.test(text(e)))||xs.find(e=>/track|submit|search/i.test(text(e)));if(!b)return null;b.dataset.mayavi='submit';return text(b);});
    if(button)await page.click('[data-mayavi="submit"]').catch(()=>{});
    await sleep(7000);
    const body=(await page.evaluate(()=>document.body?.innerText||'')).slice(0,12000);
    return Response.json({ok:true,input,button,body,requests:requests.slice(-80),responses:responses.slice(-80)});
  }catch(error){return Response.json({ok:false,error:error?.message||String(error),requests,responses},{status:200});}
  finally{try{if(browser)await browser.close()}catch{}}
}
