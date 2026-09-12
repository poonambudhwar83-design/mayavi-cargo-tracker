import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

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
    page.on('response',async r=>{try{const url=r.url(); if(/track|trace|awb|cargo|shipment/i.test(url)){let body=''; const ct=r.headers()['content-type']||''; if(/json|text|javascript/i.test(ct)) body=(await r.text()).slice(0,4000); responses.push({status:r.status(),url,body});}}catch{}});
    await page.goto('https://track.champ.aero/',{waitUntil:'domcontentloaded',timeout:60000});
    await sleep(1200);
    const inputs=await page.$$('input,textarea');
    let input=null;
    for(const el of inputs){const m=await el.evaluate(n=>({type:n.type||'',ph:n.placeholder||'',name:n.name||'',aria:n.getAttribute('aria-label')||'',id:n.id||''})); if(m.type!=='hidden'&&/awb|waybill|track|number/i.test(`${m.ph} ${m.name} ${m.aria} ${m.id}`)){input=el;break;}}
    if(!input) input=inputs.find(Boolean)||null;
    if(!input) return Response.json({ok:false,reason:'CHAMP TRACK INPUT NOT FOUND'} ,{status:503});
    await input.click({clickCount:3});
    await input.type(awb,{delay:35});
    const buttons=await page.$$('button,input[type="submit"]');
    let clicked='';
    for(const b of buttons){const label=clean(await b.evaluate(n=>n.innerText||n.value||n.getAttribute('aria-label')||'')); if(/track|search/i.test(label)){clicked=label; await b.click(); break;}}
    if(!clicked) await input.press('Enter');
    await sleep(6500);
    const body=clean(await page.evaluate(()=>document.body?.innerText||''));
    const hasAwb=body.includes(awb)||body.includes(raw)||body.includes(raw.slice(3));
    const notFound=/not found|no result|invalid/i.test(body);
    const evidence=/\b(ARR|RCF|DEP|RCS|DLV|ARRIVED|DEPARTED|ORIGIN|DESTINATION|FLIGHT|WEIGHT|PIECES|ETA|ETD)\b/i.test(body);
    return Response.json({ok:hasAwb&&evidence&&!notFound,awb,clicked,url:page.url(),hasAwb,evidence,notFound,body:body.slice(0,5000),responses:responses.slice(-20)},{status:hasAwb&&evidence&&!notFound?200:503});
  }catch(e){return Response.json({ok:false,reason:e?.message||String(e)},{status:500});}
  finally{if(browser)await browser.close().catch(()=>{});}
}
