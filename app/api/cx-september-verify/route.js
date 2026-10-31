import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=120;
const CATHAY='https://www.cathaycargo.com/en-us/track-and-trace.html';
const mawb='160-18860310',serial='18860310';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fillByLabel(page,kind,value){
 const frames=page.frames();
 for(const frame of frames){
  const found=await frame.evaluate(({kind})=>{
   const inputs=[...document.querySelectorAll('input,textarea,[role="textbox"]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>6&&r.height>6&&!e.disabled;});
   const label=e=>[e.labels?.[0]?.innerText,e.getAttribute('aria-label'),e.placeholder,e.name,e.id].filter(Boolean).join(' ').toLowerCase();
   const el=inputs.find(e=>kind==='prefix'?/airline code|prefix/.test(label(e)):/air waybill number|awb number|airwaybill|waybill/.test(label(e))&&!/airline code|prefix/.test(label(e)));
   return el?{label:label(el),tag:el.tagName,type:el.type}:null;
  },{kind}).catch(()=>null);
  if(found){
   const did=await frame.evaluate(({kind,value})=>{
    const inputs=[...document.querySelectorAll('input,textarea,[role="textbox"]')];const label=e=>[e.labels?.[0]?.innerText,e.getAttribute('aria-label'),e.placeholder,e.name,e.id].filter(Boolean).join(' ').toLowerCase();
    const el=inputs.find(e=>kind==='prefix'?/airline code|prefix/.test(label(e)):/air waybill number|awb number|airwaybill|waybill/.test(label(e))&&!/airline code|prefix/.test(label(e)));
    if(!el)return false;
    el.focus();el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;
   },{kind,value});
   // September 2026 used real user-keyboard input, rather than JS-only field changes.
   const ele=await frame.$('input,textarea,[role="textbox"]');
   for(const el of ele){
     const met=await el.evaluate(e=>({label:[e.labels?.[0]?.innerText,e.getAttribute('aria-label'),e.placeholder,e.name,e.id].filter(Boolean).join(' ').toLowerCase(),rect:e.getBoundingClientRect().width})).catch(()=>null);
     if(!met||met.rect<6)continue;
     if(kind==='prefix'?!/airline code|prefix/.test(met.label):!/air waybill number|awb number|airwaybill|waybill/.test(met.label)||/airline code|prefix/.test(met.label))continue;
     await el.click({clickCount:3});await page.keyboard.press('Backspace');await el.type(value,{delay:65});return{ok:true,...found};
   }
   return{ok:false,found,did};
  }
 }
 return{ok:false,reason:'NO_MATCHING_INPUT'};
}
export async function GET(){
 const debug={steps:[],net:[]};let browser;
 try{
  chromium.setGraphicsMode=false;browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en'],executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:1440,height:1100}});
  const page=await browser.newPage();await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36');await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
  page.on('response',r=>{const u=r.url();if(u.includes('/cargo-shipments/')||/tracking/i.test(u)&&/api/.test(u)){debug.net.push({url:u.split('?')[0].slice(-120),status:r.status()});}});
  await page.goto(CATHAY,{waitUntil:'domcontentloaded',timeout:25000});await pause(1800);
  debug.steps.push({step:'inputs',inputs:await page.$$eval('input',a=>a.map(e=>({name:e.name,placeholder:e.placeholder,label:e.labels?.[0]?.innerText,aria:e.getAttribute('aria-label')})).slice(0,12))});
  debug.steps.push({step:'prefix',result:await fillByLabel(page,'prefix','160')});await pause(450);
  debug.steps.push({step:'awb',result:await fillByLabel(page,'awb',serial)});await pause(450);
  debug.steps.push({step:'buttons',buttons:await page.$$eval('button,[role="button"],input[type="submit"]',a=>a.map(e=>({text:(e.innerText||e.value||e.getAttribute('aria-label')||'').trim(),hidden:e.getBoundingClientRect().width<5})).filter(x=>x.text).slice(0,40))});
  let clicked=false;
  for(const frame of page.frames()){
   const buttons=await frame.$$('button,[role="button"],input[type="submit"]');
   for(const b of buttons){
    const label=await b.evaluate(e=>(e.innerText||e.value||e.getAttribute('aria-label')||'').trim()).catch(()=>'');
    if(/^Track now$/i.test(label)){await b.click();clicked=true;break;}
   }
   if(clicked)break;
  }
  debug.steps.push({step:'september_Track_now',clicked});await pause(8000);
  const text=await page.evaluate(()=>document.body?.innerText||'');
  const result={awbPresent:text.includes('160-18860310')||text.includes('16018860310'),booking:/Booking Status|Shipment History/i.test(text),flight:(text.match(/\\bCX\\s*\\d{2,4}\\b/)||[])[0]||'',preview:text.slice(0,1100)};
  return Response.json({debug,result},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e?.message||String(e),debug},{status:500});}finally{if(browser)try{await browser.close()}catch{}}
}