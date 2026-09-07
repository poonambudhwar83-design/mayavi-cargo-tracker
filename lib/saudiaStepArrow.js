import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://china.saudiacargo.com/e-services/track-shipment';
const REPS=[
  [/货物追踪|追踪货物/g,'Track Shipment'],[/运单号|空运单号|航空运单号/g,'AWB'],[/目的地/g,'Destination'],
  [/始发地|起点|出发地/g,'Origin'],[/总件数|件数/g,'Total number of pieces'],[/总重量|毛重|重量/g,'Weight'],
  [/航段/g,'Segment'],[/航班/g,'Flight'],[/更多信息/g,'More information'],[/状态/g,'State'],[/日期/g,'Date'],[/时间/g,'Time'],[/当地时间/g,'local time']
];

async function englishFirst(page){
  // Prefer a real page English control when present.
  const clicked=await page.evaluate(()=>{
    const vis=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>6&&r.height>6}catch{return false}};
    const nodes=[...document.querySelectorAll('button,a,[role="button"],li,span,div')].filter(vis);
    const el=nodes.find(e=>/^english(?:\s*\(.*\))?$/i.test((e.innerText||e.textContent||'').trim()));
    if(!el)return false;
    const target=el.closest('button,a,[role="button"]')||el;target.setAttribute('data-mayavi-english','1');return true;
  }).catch(()=>false);
  if(clicked){
    await page.click('[data-mayavi-english="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-english="1"]')?.click()).catch(()=>{}));
    await new Promise(r=>setTimeout(r,700));
  }
  // Ensure visible page text is English even when the site has no native English control.
  const pairs=REPS.map(([rx,r])=>[rx.source,rx.flags,r]);
  await page.evaluate(p=>{
    const reps=p.map(([src,flags,r])=>[new RegExp(src,flags),r]);
    const apply=v=>{let s=String(v||'');for(const [rx,r] of reps)s=s.replace(rx,r);return s};
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode()))n.nodeValue=apply(n.nodeValue||'');
    for(const e of document.querySelectorAll('[placeholder],[aria-label],[title]'))for(const a of ['placeholder','aria-label','title']){const v=e.getAttribute(a);if(v)e.setAttribute(a,apply(v))}
    document.documentElement.lang='en';
  },pairs).catch(()=>{});
  return clicked;
}

async function markAwb(page){
  return page.evaluate(()=>{
    const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
    const inputs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));
    const a=inputs.find(e=>/awb|airway|shipment|065-000000/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
    if(!a)return false;a.dataset.mayaviAwb='1';return true;
  }).catch(()=>false);
}

async function clickArrow(page){
  const ok=await page.evaluate(()=>{
    const a=document.querySelector('[data-mayavi-awb="1"]');if(!a)return false;
    const r=a.getBoundingClientRect(),cy=r.top+r.height/2;
    const vis=e=>{try{const s=getComputedStyle(e),q=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&q.width>8&&q.height>8&&!e.disabled}catch{return false}};
    const els=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"],svg')].filter(vis).map(e=>{const x=e.closest('button,[role="button"],a,input[type="submit"]')||e,q=x.getBoundingClientRect(),t=(x.innerText||x.value||x.getAttribute('aria-label')||x.title||'').replace(/\s+/g,' ').trim();return{x,q,t}});
    let p=els.find(v=>/^(→|›|>|track|search|go)$/i.test(v.t)||/track\s*shipment/i.test(v.t));
    if(!p)p=els.filter(v=>v.q.left>=r.right-35&&v.q.left<=r.right+240&&Math.abs(v.q.top+v.q.height/2-cy)<100).sort((x,y)=>Math.abs(x.q.top+x.q.height/2-cy)-Math.abs(y.q.top+y.q.height/2-cy))[0];
    if(!p)return false;p.x.dataset.mayaviArrow='1';return true;
  }).catch(()=>false);
  if(!ok)return false;
  await page.click('[data-mayavi-arrow="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-arrow="1"]')?.click()).catch(()=>{}));
  return true;
}

export async function saudiaStepArrow(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB'};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1440,1100'],defaultViewport:{width:1440,height:1100},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:28000});
    await new Promise(r=>setTimeout(r,1700));
    const englishClicked=await englishFirst(page);
    if(!await markAwb(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND',stage:'INPUT'};
    const digits=mawb.replace(/\D/g,'');
    await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});
    await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
    await page.type('[data-mayavi-awb="1"]',digits,{delay:25});
    const filled=await page.$eval('[data-mayavi-awb="1"]',e=>e.value).catch(()=> '');
    const arrowClicked=await clickArrow(page);
    if(arrowClicked)await new Promise(r=>setTimeout(r,1200));
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
    return{ok:Boolean(arrowClicked),stage:arrowClicked?'ARROW_CLICKED':'ARROW_NOT_FOUND',mawb,filled,englishClicked,arrowClicked,pageText:text.slice(0,1800)};
  }catch(e){return{ok:false,reason:e?.message||String(e),stage:'ERROR'}}
  finally{try{if(browser)await browser.close()}catch{}}
}
