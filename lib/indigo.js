import fs from 'node:fs';
import { normalizeMawb } from './airlines.js';

const URL='https://6ecargo.goindigo.in/FrmAWBTracking.aspx';
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function decode(s=''){
  return String(s).replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}
function clean(html=''){
  return decode(String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:td|th|tr|div|p|li|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
}
function attr(tag,name){const m=String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i'));return decode(m?.[1]??m?.[2]??m?.[3]??'');}
function inputs(html=''){
  const list=[...String(html).matchAll(/<input\b[^>]*>/gi)].map(m=>{const tag=m[0];return{name:attr(tag,'name'),id:attr(tag,'id'),type:(attr(tag,'type')||'text').toLowerCase(),value:attr(tag,'value'),placeholder:attr(tag,'placeholder')};});
  for(const m of String(html).matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)){const tag=`<textarea ${m[1]}>`;list.push({name:attr(tag,'name'),id:attr(tag,'id'),type:'textarea',value:decode(m[2]||''),placeholder:attr(tag,'placeholder')});}
  return list;
}
function rows(html=''){return[...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>clean(m[1]).replace(/\n+/g,' | ')).filter(Boolean);}
function dmyPairs(s=''){
  const out=[];for(const m of String(s).matchAll(/(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})[\s,T]+([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?/g))out.push({date:`${m[3]}-${pad(m[2])}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`,stamp:`${m[3]}${pad(m[2])}${pad(m[1])}${pad(m[4])}${m[5]}${m[6]||'00'}`});return out;
}
function parseIndigoTracking(html='',mawb=''){
  const text=clean(html),upper=text.toUpperCase(),serial=String(mawb).replace(/\D/g,'').slice(3),tableRows=rows(html);
  const route=upper.match(new RegExp(`AWB\\s*:?\\s*312[- ]?${serial}\\s*\\(\\s*([A-Z]{3})\\s*[-–—>]\\s*([A-Z]{3})\\s*\\)`))||upper.match(/AWB\s*:?\s*312[- ]?\d{8}[\s\S]{0,120}?\b([A-Z]{3})\s*[-–—>]\s*([A-Z]{3})\b/);
  let origin=route?.[1]||'',destination=route?.[2]||'';
  if(!origin||!destination){const od=upper.match(/\bORIGIN\b[\s:|-]*([A-Z]{3})[\s\S]{0,120}?\bDEST(?:INATION)?\b[\s:|-]*([A-Z]{3})/);if(od){origin=origin||od[1];destination=destination||od[2];}}
  const awbAt=upper.search(new RegExp(`AWB\\s*:?\\s*312[- ]?${serial}`)),summary=awbAt>=0?text.slice(awbAt,awbAt+1000):text.slice(0,2200);
  const total=summary.match(/\b(\d{1,5})\s*(?:P|PCS|PIECES?)\s*\/\s*([\d,.]+)\s*(?:KG|KGS)\b/i)||summary.match(/\b(\d{1,5})\s*(?:P|PCS|PIECES?)\b[\s\S]{0,60}?\b([\d,.]+)\s*(?:KG|KGS)\b/i);
  const pieces=total?.[1]||'',weight=(total?.[2]||'').replace(/,/g,'');
  const fm=upper.match(/\b(6E\s*0*\d{1,4})\b/),flightNo=fm?fm[1].replace(/\s+/g,''):'';
  const dest=destination.toUpperCase();
  const arrivalRows=tableRows.filter(r=>/\bARRIVED\b|RECEIVED FROM.*FLIGHT/i.test(r)).filter(r=>!dest||new RegExp(`\\b${dest}\\b`,'i').test(r));
  let best=null,bestRow='';for(const row of arrivalRows){for(const p of dmyPairs(row)){if(!best||p.stamp>best.stamp){best=p;bestRow=row;}}}
  if(!best&&dest){const at=upper.lastIndexOf(`ARRIVED AT ${dest}`);if(at>=0){const w=text.slice(Math.max(0,at-500),at+600);for(const p of dmyPairs(w)){if(!best||p.stamp>best.stamp)best=p;}bestRow=w;}}
  const lastActivityArrived=dest?new RegExp(`(?:LAST\\s+ACTIVITY[\\s\\S]{0,220}?)?ARRIVED\\s+AT\\s+${dest}\\b`,'i').test(text):false;
  const arrivalDate=best?.date||'',arrivalTime=best?.time||'',arrivalIsActual=Boolean(best&&(arrivalRows.length||lastActivityArrived));
  let status='TRACKING';if(arrivalIsActual||lastActivityArrived&&arrivalRows.length)status='ARRIVED';else if(/\bDEPARTED\b|\bIN TRANSIT\b/i.test(text))status='IN TRANSIT';else if(/\bBOOKED\b|\bACCEPTED\b|\bMANIFESTED\b/i.test(text))status='BOOKED';
  return{mawb,carrierCode:'6E',airlineName:'IndiGo CarGo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate,arrivalTime,arrivalIsActual,status,officialTracker:URL,source:'IndiGo CarGo official SmartKargo form',arrivalTimeSource:arrivalIsActual?'IndiGo final-destination Arrived event':'',_debug:{textSample:text.slice(0,6000),arrivalRows:arrivalRows.slice(-8),arrivalEvidence:bestRow.slice(0,1200)}};
}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
function cookieHeader(response){try{const xs=response.headers.getSetCookie?.();if(xs?.length)return xs.map(x=>x.split(';')[0]).join('; ');}catch{}return(response.headers.get('set-cookie')||'').split(/,(?=[^;,]+=)/).map(x=>x.split(';')[0]).filter(Boolean).join('; ');}
function headers(extra={}){return{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36','accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8','accept-language':'en-US,en;q=0.9','cache-control':'no-cache','pragma':'no-cache',...extra};}

async function browserConfig(){
  for(const p of [process.env.CHROME_EXECUTABLE_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean)){
    if(fs.existsSync(p))return{executablePath:p,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']};
  }
  const mod=await import('@sparticuz/chromium');const chromium=mod.default||mod;return{executablePath:await chromium.executablePath(),args:chromium.args};
}

async function browserFallback(mawb){
  let browser;
  const serial=mawb.slice(4);
  try{
    const mod=await import('puppeteer-core');const puppeteer=mod.default||mod;const launch=await browserConfig();
    browser=await puppeteer.launch({...launch,headless:true,defaultViewport:{width:1365,height:1000}});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#txtPrefix, input[name="txtPrefix"]',{timeout:10000});
    await page.waitForSelector('#TextBoxAWBno, input[name="TextBoxAWBno"]',{timeout:10000});
    const setInput=async(selector,value)=>{
      await page.$eval(selector,(el,v)=>{const p=Object.getPrototypeOf(el);const setter=Object.getOwnPropertyDescriptor(p,'value')?.set||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(el,'');else el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
      await page.type(selector,String(value),{delay:50});
    };
    const prefixSel=await page.$('#txtPrefix')?'#txtPrefix':'input[name="txtPrefix"]';
    const awbSel=await page.$('#TextBoxAWBno')?'#TextBoxAWBno':'input[name="TextBoxAWBno"]';
    await setInput(prefixSel,'312');
    await setInput(awbSel,serial);
    const clickTrack=async()=>{
      const btn=await page.$('#ButtonGO')||await page.$('input[name="ButtonGO"]');
      if(btn){await Promise.allSettled([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:12000}),btn.click({delay:100})]);return true;}
      return page.evaluate(()=>{const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a')];const b=els.find(el=>/track|go/i.test(String(el.innerText||el.value||'')));if(!b)return false;b.click();return true;});
    };
    const clicked=await clickTrack();if(!clicked)return{ok:false,reason:'INDIGO BROWSER TRACK BUTTON NOT FOUND'};
    let lastHtml='';
    for(let i=0;i<12;i++){
      await sleep(i===0?1200:700);
      lastHtml=await page.content();
      const shipment=parseIndigoTracking(lastHtml,mawb),debug=shipment._debug;delete shipment._debug;
      if(useful(shipment))return{ok:true,shipment,adapter:'IndiGo real browser prefix + 8-digit AWB + Track',debug:{stage:'SUCCESS_BROWSER_FLOW',...debug}};
      const text=clean(lastHtml);
      if(/AWB\s+Details\s+not\s+available/i.test(text)&&i<3)continue;
    }
    const text=clean(lastHtml);
    return{ok:false,reason:/AWB\s+Details\s+not\s+available/i.test(text)?'INDIGO BROWSER FLOW SAYS AWB DETAILS NOT AVAILABLE':'INDIGO BROWSER FLOW RETURNED NO VERIFIED SHIPMENT FIELDS',debug:{stage:'BROWSER_NO_FIELDS',preview:text.slice(0,2500)}};
  }catch(e){return{ok:false,reason:`INDIGO BROWSER FALLBACK ERROR: ${e?.message||e}`,debug:{stage:'BROWSER_ERROR'}};}
  finally{if(browser)try{await browser.close();}catch{}}
}

export async function trackIndigo(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('312-'))return{ok:false,reason:'INVALID INDIGO MAWB',officialTracker:URL};
  const serial=mawb.slice(4),prefix='312';
  let directFailure=null;
  try{
    const get=await fetch(URL,{headers:headers(),redirect:'follow',cache:'no-store'}),getHtml=await get.text();
    if(!get.ok||/Access Denied|permission to access/i.test(getHtml))directFailure={ok:false,reason:`INDIGO OFFICIAL GET BLOCKED (${get.status})`,officialTracker:URL,debug:{stage:'GET_BLOCKED',status:get.status,preview:clean(getHtml).slice(0,1800)}};
    else{
      const list=inputs(getHtml),form=new URLSearchParams();for(const i of list){if(i.name&&i.type==='hidden')form.set(i.name,i.value||'');}
      const desc=i=>`${i.name} ${i.id} ${i.placeholder}`.toLowerCase();
      const prefixInput=list.find(i=>i.name&&i.type!=='hidden'&&/prefix/.test(desc(i)));
      const awbInput=list.find(i=>i.name&&i.type!=='hidden'&&/(awb|airway)/.test(desc(i))&&!/prefix/.test(desc(i)));
      const trackInput=list.find(i=>i.name&&['submit','button'].includes(i.type)&&/track|go/i.test(`${i.value} ${i.name} ${i.id}`));
      if(!prefixInput||!awbInput)directFailure={ok:false,reason:'INDIGO FORM FIELDS NOT FOUND',officialTracker:URL,debug:{stage:'FORM_FIELDS',inputs:list.filter(i=>i.type!=='hidden').slice(0,30)}};
      else{
        form.set(prefixInput.name,prefix);form.set(awbInput.name,serial);if(trackInput?.name)form.set(trackInput.name,trackInput.value||'Track');
        const cookie=cookieHeader(get),post=await fetch(URL,{method:'POST',headers:headers({'content-type':'application/x-www-form-urlencoded','referer':URL,'origin':'https://6ecargo.goindigo.in',...(cookie?{'cookie':cookie}:{})}),body:form.toString(),redirect:'follow',cache:'no-store'}),html=await post.text();
        if(!post.ok||/Access Denied|permission to access/i.test(html))directFailure={ok:false,reason:`INDIGO OFFICIAL POST BLOCKED (${post.status})`,officialTracker:URL,debug:{stage:'POST_BLOCKED',status:post.status,preview:clean(html).slice(0,1800)}};
        else{
          const shipment=parseIndigoTracking(html,mawb),debug=shipment._debug;delete shipment._debug;
          if(useful(shipment))return{ok:true,shipment,officialTracker:URL,adapter:'IndiGo CarGo direct SmartKargo form',debug:{stage:'SUCCESS_DIRECT_FORM',status:post.status,...debug}};
          directFailure={ok:false,reason:'INDIGO OFFICIAL FORM RETURNED NO VERIFIED SHIPMENT FIELDS',officialTracker:URL,debug:{stage:'NO_FIELDS',status:post.status,...debug}};
        }
      }
    }
  }catch(e){directFailure={ok:false,reason:`INDIGO DIRECT TRACKING ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR'}};}

  const browser=await browserFallback(mawb);
  if(browser.ok)return{...browser,officialTracker:URL};
  return{ok:false,reason:browser.reason||directFailure?.reason||'INDIGO TRACKING FAILED',officialTracker:URL,debug:{direct:directFailure?.debug||null,browser:browser.debug||null}};
}
