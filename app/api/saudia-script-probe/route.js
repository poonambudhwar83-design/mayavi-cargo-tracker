import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const PAGE='https://china.saudiacargo.com/e-services/track-shipment?awbNumber=06511479705';
const clean=s=>String(s||'').replace(/\s+/g,' ');

export async function GET(){
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({
      args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en'],
      executablePath:await chromium.executablePath(),
      headless:'shell',
      defaultViewport:{width:1280,height:900}
    });
    const page=await browser.newPage();
    await page.goto(PAGE,{waitUntil:'domcontentloaded',timeout:30000});
    await new Promise(r=>setTimeout(r,1800));
    const out=await page.evaluate(async()=>{
      const srcs=[...document.scripts].map(s=>s.src).filter(Boolean).filter(u=>/track-shipment\.js|e-services|track.*shipment/i.test(u));
      const files=[];
      for(const src of srcs){
        try{
          const text=await fetch(src,{credentials:'omit'}).then(r=>r.text());
          const hits=[];
          const patterns=[/\/apis?\/[A-Za-z0-9_?&=./{}:\-]+/gi,/https?:\/\/[^"'`\s)]+/gi,/track[-_/]?shipment/gi,/recaptcha/gi,/grecaptcha/gi,/axios/gi,/fetch\s*\(/gi];
          const positions=[];
          for(const rx of patterns){for(const m of text.matchAll(rx))positions.push(m.index||0)}
          positions.sort((a,b)=>a-b);
          for(const p of positions.slice(0,80)){
            const a=Math.max(0,p-220),b=Math.min(text.length,p+420);
            const snippet=text.slice(a,b).replace(/\s+/g,' ');
            if(!hits.includes(snippet))hits.push(snippet);
          }
          files.push({src,length:text.length,hits:hits.slice(0,40)});
        }catch(e){files.push({src,error:String(e?.message||e)});}
      }
      return {href:location.href,srcs,files};
    });
    return Response.json({ok:true,...out});
  }catch(e){
    return Response.json({ok:false,error:clean(e?.message||e)},{status:500});
  }finally{try{if(browser)await browser.close()}catch{}}
}
