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
    await sleep(9000);
    const frames=[];
    for(const frame of page.frames()){
      const info=await frame.evaluate(()=>{
        const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
        const inputs=[...document.querySelectorAll('input,select,textarea')].filter(visible).map(e=>({tag:e.tagName,type:e.type||'',name:e.name||'',id:e.id||'',placeholder:e.placeholder||'',aria:e.getAttribute('aria-label')||'',title:e.title||'',value:e.value||'',html:e.outerHTML.slice(0,500)}));
        const buttons=[...document.querySelectorAll('button,a,[role="button"]')].filter(visible).map(e=>({text:String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,160),aria:e.getAttribute('aria-label')||'',title:e.title||'',href:e.getAttribute('href')||'',html:e.outerHTML.slice(0,400)})).filter(x=>/track|search|awb|cargo|submit/i.test(`${x.text} ${x.aria} ${x.title} ${x.href} ${x.html}`)).slice(0,50);
        return{title:document.title,body:String(document.body?.innerText||'').replace(/\s+/g,' ').trim().slice(0,4000),inputs:inputs.slice(0,60),buttons};
      }).catch(()=>null);
      frames.push({url:frame.url(),info});
    }
    return Response.json({ok:true,url:page.url(),frames});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500});}
  finally{try{if(browser)await browser.close()}catch{}}
}
