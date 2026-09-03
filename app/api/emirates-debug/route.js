import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const URL='https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const clip=(s,n=6000)=>clean(s).slice(0,n);

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});
}

export async function GET(request){
  const mawb=normalizeMawb(new URL(request.url).searchParams.get('mawb'));
  if(!mawb||!mawb.startsWith('176-'))return Response.json({ok:false,error:'Use a valid Emirates 176 MAWB.'},{status:400});
  const prefix='176',serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const netTasks=[];const net=[];
    page.on('response',res=>{
      const task=(async()=>{
        try{
          const req=res.request(),type=req.resourceType(),url=res.url(),ct=(res.headers()['content-type']||'').toLowerCase();
          if(!['xhr','fetch','document'].includes(type)&&!/(json|text|html|xml)/.test(ct))return;
          if(!/emirates|skychain/i.test(url))return;
          const text=await res.text();
          const flat=clean(text);if(!flat)return;
          const u=flat.toUpperCase();
          const relevant=flat.includes(serial)||flat.includes(digits)||/AIR WAYBILL|DOCUMENT NO|SHIPMENT|FLIGHT|PIECES|WEIGHT|ARRIV|RCF|DELIVER|STATUS/i.test(flat);
          if(!relevant)return;
          let i=Math.max(flat.indexOf(serial),flat.indexOf(digits));if(i<0){const m=u.search(/AIR WAYBILL|DOCUMENT NO|SHIPMENT|FLIGHT|PIECES|WEIGHT|ARRIV|RCF|DELIVER|STATUS/);i=m<0?0:m;}
          net.push({type,status:res.status(),url,contentType:ct,snippet:flat.slice(Math.max(0,i-900),Math.min(flat.length,i+5000))});
        }catch{}
      })();netTasks.push(task);
    });
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:18000});
    await new Promise(r=>setTimeout(r,1800));
    const fill=await page.evaluate(({prefix,serial})=>{
      const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>15&&r.height>8&&!e.disabled};
      const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes((e.type||'text').toLowerCase()));
      const desc=e=>`${e.name||''} ${e.id||''} ${e.placeholder||''} ${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''}`.toLowerCase();
      const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));};
      let p=inputs.find(e=>/prefix/.test(desc(e))||e.maxLength===3||e.value==='176');
      let n=inputs.find(e=>e!==p&&(/document|awb|airway|shipment|number|serial/.test(desc(e))||e.maxLength>=8));
      if(!p&&inputs.length>=2)p=inputs[0];if(!n&&inputs.length>=2)n=inputs[1];
      if(p)set(p,prefix);if(n)set(n,serial);
      return {count:inputs.length,prefix:p?{name:p.name,id:p.id,value:p.value,maxLength:p.maxLength}:null,number:n?{name:n.name,id:n.id,value:n.value,maxLength:n.maxLength}:null};
    },{prefix,serial});
    const clicked=await page.evaluate(()=>{
      const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')];
      const label=e=>((e.innerText||e.value||e.getAttribute('aria-label')||e.title||'')+'').replace(/\s+/g,' ').trim();
      const t=els.find(e=>/^track$/i.test(label(e))||/track shipment|track cargo|track awb/i.test(label(e)));
      if(t){t.click();return label(t);}return'';
    });
    if(!clicked)await page.keyboard.press('Enter').catch(()=>{});
    await page.waitForNetworkIdle({idleTime:700,timeout:9000}).catch(()=>{});
    await new Promise(r=>setTimeout(r,2500));
    await Promise.allSettled(netTasks);

    const frames=[];
    for(const [idx,f] of page.frames().entries()){
      try{
        const data=await f.evaluate(({serial,digits})=>{
          const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
          const body=clean(document.body?.innerText||'');
          const rows=[...document.querySelectorAll('tr')].map(x=>clean(x.innerText)).filter(Boolean);
          const relevantRows=rows.filter(x=>x.includes(serial)||x.includes(digits)||/ARRIV|RCF|DELIVER|FLIGHT|PIECES|WEIGHT|STATUS|ORIGIN|DESTINATION|DOCUMENT/i.test(x)).slice(0,80);
          const nodes=[...document.querySelectorAll('div,span,td,th,li,p')].map(x=>clean(x.innerText)).filter(x=>x&&x.length<1500).filter(x=>x.includes(serial)||x.includes(digits)||/ARRIV|RCF|DELIVER|FLIGHT|PIECES|WEIGHT|STATUS|ORIGIN|DESTINATION|DOCUMENT/i.test(x)).slice(0,120);
          return {title:document.title||'',body,relevantRows,nodes};
        },{serial,digits});
        frames.push({index:idx,url:f.url(),title:data.title,body:clip(data.body,12000),rows:data.relevantRows,nodes:data.nodes});
      }catch(e){frames.push({index:idx,url:f.url(),error:e?.message||String(e)});}
    }
    const screenshotBase64=await page.screenshot({type:'jpeg',quality:70,fullPage:false,encoding:'base64'}).catch(()=>null);
    return Response.json({ok:true,mawb,fill,clicked,frameCount:frames.length,frames,network:net.slice(-30),screenshotCaptured:Boolean(screenshotBase64)});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:503});}
  finally{try{if(browser)await browser.close()}catch{}}
}
