import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const BASE='https://airarabia-g9.ibsplc.aero/icargoneoportal/app/main/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1365,height:900},executablePath:await chromium.executablePath(),headless:'shell'});}
async function inspectPrefill(page,n){const candidates=[`${BASE}?shipmentValue=${n}#/app`,`${BASE}#/app?shipmentValue=${n}`,`${BASE}?shipmentvalue=${n}#/app`,`${BASE}?awbNo=${n}#/app`,`${BASE}?awbno=${n}#/app`,`${BASE}?awbNumber=${n}#/app`,`${BASE}?awbNumbers=${n}#/app`,`${BASE}?shipment=${n}#/app`,`${BASE}?track=${n}#/app`,`${BASE}?tracking=${n}#/app`];const out=[];for(const url of candidates){await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await sleep(3200);const r=await page.evaluate(()=>{const el=document.querySelector('#shipmentValue')||[...document.querySelectorAll('input')].find(e=>/awb|waybill/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''}`));return{href:location.href,value:el?.value||'',id:el?.id||'',name:el?.name||'',placeholder:el?.placeholder||''};}).catch(()=>({href:page.url(),value:'',id:'',name:'',placeholder:''}));out.push({url,...r,prefilled:String(r.value).replace(/\D/g,'')===n});}return out;}
async function inspectSource(page){
  await page.goto(`${BASE}#/app`,{waitUntil:'domcontentloaded',timeout:30000});await sleep(3500);
  const mapUrls=[new URL('config/importmap.json',BASE).href,new URL('config/importmap-remote.json',BASE).href];
  const maps=[];const moduleUrls=[];
  for(const url of mapUrls){try{const r=await fetch(url);const text=await r.text();let json={};try{json=JSON.parse(text)}catch{}maps.push({url,status:r.status,json});for(const v of Object.values(json.imports||{})){try{moduleUrls.push(new URL(v,BASE).href)}catch{}}}catch(e){maps.push({url,error:e?.message||String(e)})}}
  const needles=['shipmentValue','shipmentvalue','queryParams','queryParamMap','ActivatedRoute','localStorage','sessionStorage','postMessage','awbNumber','awbNo'];
  const matches=[];const inspected=[];
  for(const src of [...new Set(moduleUrls)].slice(0,40)){
    try{const res=await fetch(src);if(!res.ok)continue;const txt=await res.text();inspected.push({src,len:txt.length});for(const needle of needles){let from=0,count=0;while(count<5){const i=txt.indexOf(needle,from);if(i<0)break;matches.push({src,needle,snippet:txt.slice(Math.max(0,i-600),Math.min(txt.length,i+1200))});from=i+needle.length;count++;}}}catch{}
  }
  return {maps,moduleUrls:[...new Set(moduleUrls)],inspected,matches};
}
export async function GET(request){const u=new URL(request.url);const n=u.searchParams.get('mawb')?.replace(/\D/g,'')||'51411911723';const mode=u.searchParams.get('mode')||'prefill';if(!/^514\d{8}$/.test(n))return Response.json({ok:false,error:'Use valid Air Arabia MAWB.'},{status:400});let browser;try{browser=await launch();const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');if(mode==='source')return Response.json({ok:true,mode,source:await inspectSource(page)});return Response.json({ok:true,mawb:n,results:await inspectPrefill(page,n)});}catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500});}finally{try{await browser?.close()}catch{}}}
