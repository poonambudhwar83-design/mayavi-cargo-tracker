import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const BASE='https://airarabia-g9.ibsplc.aero/icargoneoportal/app/main/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    defaultViewport:{width:1365,height:900},
    executablePath:await chromium.executablePath(),
    headless:'shell'
  });
}
async function getAwb(page){
  return page.evaluate(()=>{
    const all=[...document.querySelectorAll('input')];
    const el=all.find(e=>/awb|waybill/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''}`))||all[0];
    return el?{value:el.value||'',placeholder:el.placeholder||'',name:el.name||'',id:el.id||''}:null;
  }).catch(()=>null);
}

export async function GET(request){
  const n=new URL(request.url).searchParams.get('mawb')?.replace(/\D/g,'')||'51411911723';
  if(!/^514\d{8}$/.test(n))return Response.json({ok:false,error:'Use valid Air Arabia MAWB.'},{status:400});
  let browser;
  try{
    browser=await launch();
    const opener=await browser.newPage();
    await opener.goto('https://mayavi-cargo-shared-tracker.vercel.app/',{waitUntil:'domcontentloaded',timeout:30000});
    const popupPromise=new Promise(resolve=>browser.once('targetcreated',async t=>{try{if(t.type()==='page')resolve(await t.page())}catch{}}));
    await opener.evaluate((url)=>{window.__p=window.open(url,'airarabia_test');},`${BASE}#/app`);
    const popup=await Promise.race([popupPromise,sleep(10000).then(()=>null)]);
    if(!popup)return Response.json({ok:true,mawb:n,popupOpened:false});
    await popup.waitForNavigation({waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
    await sleep(3500);
    const before=await getAwb(popup);
    let injectionError='';
    try{
      await opener.evaluate((value)=>{
        try{
          window.__p.location = `javascript:(()=>{const e=document.querySelector('#shipmentValue,input[name=shipmentValue]');if(e){e.value='${value}';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}})()`;
        }catch(e){window.__injectErr=String(e)}
      },n);
      await sleep(1800);
      injectionError=await opener.evaluate(()=>window.__injectErr||'');
    }catch(e){injectionError=e?.message||String(e)}
    const after=await getAwb(popup);
    return Response.json({ok:true,mawb:n,popupOpened:true,before,after,injectionError,prefilled:Boolean(after&&String(after.value).replace(/\D/g,'')===n)});
  }catch(e){
    return Response.json({ok:false,error:e?.message||String(e)},{status:500});
  }finally{try{await browser?.close()}catch{}}
}
