import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=90;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'],
    executablePath:await chromium.executablePath(),
    headless:'shell',
    defaultViewport:{width:1440,height:1200}
  });
}

export async function GET(request){
  const u=new URL(request.url);
  const digits=String(u.searchParams.get('mawb')||'23218849773').replace(/\D/g,'');
  const mawb=digits.length>=11?digits.slice(0,3)+'-'+digits.slice(3,11):digits;
  let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    const captures=[];
    page.on('response',async response=>{try{
      const url=response.url(),ct=String(response.headers()['content-type']||'').toLowerCase();
      if(!/json|text|javascript/.test(ct) && !/track|air|cargo|awb|shipment|api/i.test(url))return;
      const body=await response.text();
      if(!body)return;
      if(body.includes(digits)||/awb|shipment|cargo|flight|origin|destination|status|tracking/i.test(body)){
        captures.push({url,status:response.status(),ct,body:clean(body).slice(0,16000)});
        if(captures.length>60)captures.shift();
      }
    }catch{}});
    await page.goto('https://trackcargo.co/track/air/malaysia-airlines',{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(3500);
    const before=await page.evaluate(()=>({
      url:location.href,
      text:(document.body?.innerText||'').slice(0,10000),
      inputs:[...document.querySelectorAll('input')].map((e,i)=>({i,type:e.type,name:e.name,id:e.id,placeholder:e.placeholder,aria:e.getAttribute('aria-label'),value:e.value})).slice(0,50),
      buttons:[...document.querySelectorAll('button,[role="button"],input[type="submit"],a')].map((e,i)=>({i,text:(e.innerText||e.value||e.textContent||'').replace(/\s+/g,' ').trim(),href:e.href||''})).filter(x=>x.text).slice(0,120)
    }));
    const fill=await page.evaluate(({mawb})=>{
      const visible=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>10&&r.height>10&&!e.disabled}catch{return false}};
      const inputs=[...document.querySelectorAll('input')].filter(visible);
      const score=e=>/awb|airway|waybill|tracking/i.test([e.placeholder,e.name,e.id,e.getAttribute('aria-label')].join(' '))?20:0;
      const input=[...inputs].sort((a,b)=>score(b)-score(a))[0];
      if(!input)return{ok:false,reason:'no input'};
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      setter?.call(input,mawb); if(!setter)input.value=mawb;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      const els=[...document.querySelectorAll('button,[role="button"],input[type="submit"],a')].filter(visible);
      const txt=e=>(e.innerText||e.value||e.textContent||'').replace(/\s+/g,' ').trim();
      const btn=els.find(e=>/^track shipment$/i.test(txt(e)))||els.find(e=>/track.*shipment|track.*air|^track$/i.test(txt(e)));
      if(!btn)return{ok:false,reason:'no track button',value:input.value,buttons:els.map(txt).filter(Boolean).slice(0,50)};
      btn.click();return{ok:true,value:input.value,button:txt(btn)};
    },{mawb});
    await Promise.race([page.waitForNetworkIdle({idleTime:1000,timeout:20000}).catch(()=>{}),sleep(12000)]);
    await sleep(2000);
    const after=await page.evaluate(()=>({url:location.href,text:(document.body?.innerText||'').slice(0,18000)}));
    return Response.json({ok:true,mawb,fill,before,after,captures});
  }catch(e){return Response.json({ok:false,error:String(e?.message||e)},{status:500})}
  finally{try{if(browser)await browser.close()}catch{}}
}
