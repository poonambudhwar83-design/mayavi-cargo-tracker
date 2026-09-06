import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const BASE='https://airarabia-g9.ibsplc.aero/icargoneoportal/app/main/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function launch(){
  chromium.setGraphicsMode=false;
  return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1365,height:900},executablePath:await chromium.executablePath(),headless:'shell'});
}
async function inspect(page,url){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(3500);
  return page.evaluate(()=>{
    const el=document.querySelector('#shipmentValue')||[...document.querySelectorAll('input')].find(e=>/awb|waybill/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''}`));
    return {href:location.href,value:el?.value||'',id:el?.id||'',name:el?.name||'',placeholder:el?.placeholder||''};
  }).catch(()=>({href:page.url(),value:'',id:'',name:'',placeholder:''}));
}
export async function GET(request){
  const n=new URL(request.url).searchParams.get('mawb')?.replace(/\D/g,'')||'51411911723';
  if(!/^514\d{8}$/.test(n))return Response.json({ok:false,error:'Use valid Air Arabia MAWB.'},{status:400});
  const candidates=[
    `${BASE}?shipmentValue=${n}#/app`,
    `${BASE}#/app?shipmentValue=${n}`,
    `${BASE}?shipmentvalue=${n}#/app`,
    `${BASE}?awbNo=${n}#/app`,
    `${BASE}?awbno=${n}#/app`,
    `${BASE}?awbNumber=${n}#/app`,
    `${BASE}?awbNumbers=${n}#/app`,
    `${BASE}?shipment=${n}#/app`,
    `${BASE}?track=${n}#/app`,
    `${BASE}?tracking=${n}#/app`
  ];
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    const results=[];
    for(const url of candidates){const r=await inspect(page,url);results.push({url,...r,prefilled:String(r.value).replace(/\D/g,'')===n});}
    return Response.json({ok:true,mawb:n,results});
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500});}
  finally{try{await browser?.close()}catch{}}
}
