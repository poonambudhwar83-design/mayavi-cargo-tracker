import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL='https://www.qrcargo.com/s/track-your-shipment';
const MAWB='157-12345675';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function browserConfig(){
  for(const executablePath of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(executablePath))return{executablePath,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');const chromium=mod.default||mod;
  return{executablePath:await chromium.executablePath(),args:chromium.args};
}
function safeJson(raw=''){let s=String(raw).trim().replace(/^while\s*\(\s*1\s*\)\s*;?\s*/i,'').replace(/^for\s*\(\s*;;\s*\)\s*;?\s*/i,'');try{return JSON.parse(s)}catch{return null}}
function flatten(v,path='$',out=[],depth=0){
  if(depth>14||v==null)return out;
  if(typeof v==='string'){out.push({path,value:v});const s=v.trim();if((s.startsWith('{')&&s.endsWith('}'))||(s.startsWith('[')&&s.endsWith(']'))){const n=safeJson(s);if(n)flatten(n,`${path}.json`,out,depth+1)}return out;}
  if(typeof v==='number'||typeof v==='boolean'){out.push({path,value:String(v)});return out;}
  if(Array.isArray(v)){v.forEach((x,i)=>flatten(x,`${path}[${i}]`,out,depth+1));return out;}
  Object.entries(v).forEach(([k,x])=>flatten(x,`${path}.${k}`,out,depth+1));return out;
}
async function deepEls(page,selector){
  const h=await page.evaluateHandle(sel=>{const out=[],seen=new Set();const walk=r=>{if(!r?.querySelectorAll)return;for(const e of r.querySelectorAll(sel))if(!seen.has(e)){seen.add(e);out.push(e)}for(const e of r.querySelectorAll('*'))if(e.shadowRoot)walk(e.shadowRoot)};walk(document);return out},selector);
  const props=await h.getProperties(),out=[];for(const p of props.values()){const e=p.asElement();if(e)out.push(e)}await h.dispose();return out;
}
async function type(page,el,value){await el.click({clickCount:3});await page.keyboard.press('Backspace');await el.type(value,{delay:40});}
async function submit(page){
  const inputs=await deepEls(page,'input[type="text"],input:not([type])');const visible=[];
  for(const el of inputs){try{const m=await el.evaluate(x=>{const r=x.getBoundingClientRect();return{v:r.width>3&&r.height>3&&!x.disabled&&!x.readOnly,max:Number(x.maxLength||-1),val:String(x.value||''),hint:`${x.placeholder||''} ${x.name||''} ${x.id||''} ${x.getAttribute('aria-label')||''}`}});if(m.v)visible.push({el,m})}catch{}}
  let p=visible.find(x=>x.m.max===3||x.m.val==='157'||/prefix/i.test(x.m.hint));
  let n=visible.find(x=>x!==p&&(x.m.max===8||/awb|waybill|shipment|number/i.test(x.m.hint)))||(p?visible.find(x=>x!==p):null);
  if(p&&p.m.val!=='157')await type(page,p.el,'157');
  if(!n&&visible.length===1){await type(page,visible[0].el,'157');await page.keyboard.press('Tab');await sleep(800);return submit(page)}
  if(!n)throw new Error('number input not found');await type(page,n.el,'12345675');
  for(const b of await deepEls(page,'button,input[type="submit"],[role="button"]')){try{const m=await b.evaluate(x=>{const r=x.getBoundingClientRect();return{v:r.width>3&&r.height>3&&!x.disabled,t:String(x.innerText||x.value||x.getAttribute('aria-label')||'').trim()}});if(m.v&&/track shipment|track|search/i.test(m.t)){await b.click();return m.t}}catch{}}
  await page.keyboard.press('Enter');return'ENTER';
}

const config=await browserConfig();const browser=await puppeteer.launch({...config,headless:true,defaultViewport:{width:1440,height:1050}});const page=await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
const bodies=[];let capture=false;
page.on('response',async r=>{if(!capture)return;try{const u=r.url(),ct=String(r.headers()['content-type']||'');if(!/(qrcargo|aura|apex|track|shipment|cargo|croamis|api)/i.test(u)&&!/json/i.test(ct))return;const body=await r.text();if(body&&body.length<300000)bodies.push(body)}catch{}});
await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});await sleep(3200);capture=true;const button=await submit(page);await sleep(8000);
const hints=[];
for(const body of bodies){const j=safeJson(body);if(!j)continue;for(const e of flatten(j)){if(/date|time|arriv|depart|eta|ata|schedule|flight|event|milestone/i.test(e.path)&&String(e.value).length<120)hints.push(e)}}
const unique=[];const seen=new Set();for(const h of hints){const k=`${h.path}=${h.value}`;if(!seen.has(k)){seen.add(k);unique.push(h)}}
console.log('QATAR_DATE_HINTS='+JSON.stringify({button,responses:bodies.length,hints:unique.slice(0,120)}));
await browser.close();
