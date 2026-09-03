import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    defaultViewport:{width:1440,height:1200,deviceScaleFactor:1},
    executablePath:await chromium.executablePath(),
    headless:'shell'
  });
}

export async function GET(request){
  const id=new URL(request.url).searchParams.get('id')||'66516695';
  if(!/^\d{5,12}$/.test(id)) return Response.json({ok:false,error:'Invalid shipment id.'},{status:400});
  const target=`https://eskycargo.emirates.com/app/offerandorder/#/shipments/list/${id}?openedTab=tracking-details`;
  let browser;
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000});
    await new Promise(r=>setTimeout(r,7000));
    const data=await page.evaluate(()=>{
      const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
      const body=clean(document.body?.innerText||'');
      const rows=[...document.querySelectorAll('tr')].map(x=>clean(x.innerText)).filter(Boolean);
      const cards=[...document.querySelectorAll('div,section,article,li')].map(x=>clean(x.innerText)).filter(x=>x&&x.length<2000);
      const relevant=[...new Set([...rows,...cards].filter(x=>/AWB|AIR WAYBILL|TRACKING DETAILS|FLIGHT|ARRIV|DEPART|ORIGIN|DESTINATION|PIECES|WEIGHT|STATUS|DELIVER|RCF|RCS|DEP|ATA|ETA|DXB|DEL|BOM|HYD|MAA|BLR|COK|DWC/i.test(x)))].slice(0,180);
      const links=[...document.querySelectorAll('a,button,[role="button"]')].map(e=>({text:clean(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||''),href:e.href||''})).filter(x=>x.text).slice(0,200);
      return {title:document.title,url:location.href,body:body.slice(0,30000),relevant,links};
    });
    const shot=await page.screenshot({type:'jpeg',quality:72,fullPage:true,encoding:'base64'}).catch(()=>null);
    return Response.json({ok:true,id,target,screenshotCaptured:Boolean(shot),...data});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e),target},{status:503});}
  finally{try{if(browser)await browser.close()}catch{}}
}
