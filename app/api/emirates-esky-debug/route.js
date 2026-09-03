import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1200,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}

export async function GET(request){
  const id=new URL(request.url).searchParams.get('id')||'66516695';
  if(!/^\d{5,12}$/.test(id)) return Response.json({ok:false,error:'Invalid shipment id.'},{status:400});
  const target=`https://eskycargo.emirates.com/app/offerandorder/#/shipments/list/${id}?openedTab=tracking-details`;
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const net=[];const tasks=[];const consoleErrors=[];
    page.on('console',m=>{if(['error','warning'].includes(m.type()))consoleErrors.push({type:m.type(),text:m.text().slice(0,1200)})});
    page.on('requestfailed',r=>net.push({kind:'failed',url:r.url(),method:r.method(),reason:r.failure()?.errorText||''}));
    page.on('response',res=>{
      const task=(async()=>{try{
        const req=res.request(),type=req.resourceType(),url=res.url(),status=res.status(),ct=(res.headers()['content-type']||'').toLowerCase();
        if(!['xhr','fetch','document'].includes(type)&&status<400)return;
        if(!/emirates|eskycargo|api|offerandorder|shipment/i.test(url))return;
        let snippet='';if(/json|text|html/.test(ct)){snippet=clean(await res.text()).slice(0,2500)}
        net.push({kind:'response',type,status,method:req.method(),url,contentType:ct,snippet});
      }catch{}})();tasks.push(task);
    });
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000});await new Promise(r=>setTimeout(r,2500));
    const cookieClick=await page.evaluate(()=>{const els=[...document.querySelectorAll('button,a,[role="button"]')];const label=e=>String(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();const t=els.find(e=>/^(accept|allow all)$/i.test(label(e))||/accept all cookies/i.test(label(e)));if(t){t.click();return label(t)}return''}).catch(()=> '');
    await new Promise(r=>setTimeout(r,6500));await Promise.allSettled(tasks);
    const body=await page.evaluate(()=>String(document.body?.innerText||'').replace(/\s+/g,' ').trim()).catch(()=> '');
    const shot=await page.screenshot({type:'jpeg',quality:72,fullPage:true,encoding:'base64'}).catch(()=>null);
    return Response.json({ok:true,id,target,cookieClick,screenshotCaptured:Boolean(shot),title:await page.title(),url:page.url(),body:body.slice(0,12000),network:net.slice(-80),consoleErrors:consoleErrors.slice(-40)});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e),target},{status:503})}finally{try{if(browser)await browser.close()}catch{}}
}
