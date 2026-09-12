import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function frameText(frame){
  try{return clean(await frame.evaluate(()=>document.body?.innerText||''));}catch{return'';}
}
async function findInput(page){
  const frames=page.frames();
  for(const frame of frames){
    try{
      const candidates=await frame.$$('input:not([type="hidden"]),textarea,[contenteditable="true"]');
      for(const el of candidates){
        const m=await el.evaluate(n=>({tag:n.tagName,type:n.type||'',ph:n.placeholder||'',name:n.name||'',aria:n.getAttribute('aria-label')||'',id:n.id||'',role:n.getAttribute('role')||'',cls:n.className||''}));
        const label=`${m.ph} ${m.name} ${m.aria} ${m.id} ${m.role} ${m.cls}`;
        if(/awb|air\s*waybill|waybill|track|shipment|number/i.test(label))return{frame,el,meta:m};
      }
      if(candidates.length)return{frame,el:candidates[0],meta:{fallback:true}};
    }catch{}
  }
  return null;
}
async function clickTrack(frame,input){
  try{
    const buttons=await frame.$$('button,input[type="submit"],input[type="button"],[role="button"]');
    for(const b of buttons){
      const label=clean(await b.evaluate(n=>n.innerText||n.value||n.getAttribute('aria-label')||n.textContent||''));
      if(/^(track|search|go)$/i.test(label)||/track|search shipment|find/i.test(label)){
        await b.click();
        return label||'button';
      }
    }
  }catch{}
  try{await input.press('Enter');return'ENTER';}catch{return'';}
}

export async function GET(request){
  const u=new URL(request.url);
  const raw=String(u.searchParams.get('mawb')||'').replace(/\D/g,'');
  if(raw.length!==11||!raw.startsWith('607')) return Response.json({ok:false,error:'Enter valid 607 Etihad MAWB'},{status:400});
  const awb=`${raw.slice(0,3)}-${raw.slice(3)}`;
  let browser;
  try{
    browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:chromium.headless,defaultViewport:{width:1440,height:1200}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    const responses=[];
    page.on('response',async r=>{try{const url=r.url();if(/track|trace|awb|cargo|shipment/i.test(url)){let body='';const ct=r.headers()['content-type']||'';if(/json|text|javascript/i.test(ct))body=(await r.text()).slice(0,5000);responses.push({status:r.status(),url,body});}}catch{}});

    await page.goto('https://track.champ.aero/',{waitUntil:'networkidle2',timeout:60000}).catch(async()=>{await page.goto('https://track.champ.aero/',{waitUntil:'domcontentloaded',timeout:60000});});
    await sleep(5000);

    let found=await findInput(page);
    if(!found){
      await page.reload({waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
      await sleep(5000);
      found=await findInput(page);
    }
    if(!found){
      const frames=[];
      for(const f of page.frames())frames.push({url:f.url(),text:(await frameText(f)).slice(0,1200)});
      const body=clean(await page.evaluate(()=>document.body?.innerText||'')).slice(0,2500);
      return Response.json({ok:false,reason:'CHAMP TRACK INPUT NOT FOUND AFTER WAIT/FRAME SCAN',url:page.url(),body,frames,responses:responses.slice(-15)},{status:503});
    }

    const {frame,input,meta}=found;
    try{await input.click({clickCount:3});}catch{}
    try{await input.evaluate(n=>{if('value'in n)n.value='';else n.textContent='';});}catch{}
    await input.type(awb,{delay:40});
    const clicked=await clickTrack(frame,input);
    await sleep(8000);

    let allText='';
    for(const f of page.frames())allText+=` ${await frameText(f)}`;
    const body=clean(allText);
    const hasAwb=body.includes(awb)||body.includes(raw)||body.includes(raw.slice(3));
    const notFound=/awb number\(s\).*not found|not found|no result|invalid awb/i.test(body);
    const evidence=/\b(ARR|RCF|DEP|RCS|DLV|ARRIVED|DEPARTED|ORIGIN|DESTINATION|FLIGHT|WEIGHT|PIECES|ETA|ETD)\b/i.test(body);
    return Response.json({ok:hasAwb&&evidence&&!notFound,awb,clicked,inputMeta:meta,url:page.url(),hasAwb,evidence,notFound,body:body.slice(0,7000),responses:responses.slice(-25)},{status:hasAwb&&evidence&&!notFound?200:503});
  }catch(e){return Response.json({ok:false,reason:e?.message||String(e)},{status:500});}
  finally{if(browser)await browser.close().catch(()=>{});}
}
