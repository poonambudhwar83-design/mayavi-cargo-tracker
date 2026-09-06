import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from '../../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
const URL='https://china.saudiacargo.com/e-services/track-shipment';

export async function GET(request){
  const q=new URL(request.url).searchParams.get('mawb');
  const mawb=normalizeMawb(q||'');
  if(!mawb||!mawb.startsWith('065-')) return Response.json({ok:false,error:'Use a valid Saudia 065 MAWB.'},{status:400});

  let browser;
  const captures=[];
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1000},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});

    page.on('request',req=>{
      try{
        const u=req.url();
        if(!u.includes('/apis/api/eservices/track-shipment')) return;
        const h=req.headers();
        const safeHeaders={
          'content-type':h['content-type']||'',
          'accept':h['accept']||'',
          'origin':h['origin']||'',
          'referer':h['referer']||'',
          'x-requested-with':h['x-requested-with']||''
        };
        captures.push({method:req.method(),url:u,postData:req.postData()||'',headers:safeHeaders});
      }catch{}
    });
    page.on('response',async res=>{
      try{
        if(!res.url().includes('/apis/api/eservices/track-shipment')) return;
        const body=await res.text().catch(()=> '');
        const last=captures[captures.length-1];
        if(last){last.status=res.status();last.response=body.slice(0,5000);}
      }catch{}
    });

    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:22000});
    await new Promise(r=>setTimeout(r,1600));

    const found=await page.evaluate(()=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>18&&r.height>10&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const awb=inputs.find(e=>/awb|airway|shipment|065-000000/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
      if(!awb)return false;awb.setAttribute('data-mayavi-awb','1');return true;
    });
    if(!found)return Response.json({ok:false,error:'AWB input not found',captures});

    await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});
    await page.keyboard.press('Control+A').catch(()=>{});
    await page.keyboard.press('Backspace').catch(()=>{});
    await page.type('[data-mayavi-awb="1"]',mawb,{delay:30});

    const marked=await page.evaluate(()=>{
      const awb=document.querySelector('[data-mayavi-awb="1"]');if(!awb)return false;
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!e.disabled};
      const r=awb.getBoundingClientRect(),cy=r.top+r.height/2;
      const all=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"]')].filter(visible).map(e=>{const q=e.getBoundingClientRect(),t=(e.innerText||e.value||e.getAttribute('aria-label')||e.title||'').replace(/\s+/g,' ').trim();return{e,t,left:q.left,dy:Math.abs(q.top+q.height/2-cy)};});
      let x=all.find(v=>/^(track|search|go|→|›|>)$/i.test(v.t)||/track\s*shipment|追踪货物/i.test(v.t));
      if(!x)x=all.filter(v=>v.left>=r.right-20&&v.left<=r.right+220&&v.dy<100).sort((a,b)=>a.dy-b.dy||a.left-b.left)[0];
      if(!x)return false;x.e.setAttribute('data-mayavi-track','1');return true;
    });
    if(marked) await page.click('[data-mayavi-track="1"]'); else await page.keyboard.press('Enter');

    await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:8000}).catch(()=>{}),new Promise(r=>setTimeout(r,8000))]);
    await new Promise(r=>setTimeout(r,900));

    return Response.json({ok:true,mawb,captures});
  }catch(e){
    return Response.json({ok:false,error:String(e?.message||e),captures},{status:500});
  }finally{
    try{if(browser)await browser.close()}catch{}
  }
}
