// Speed Post tracking is deliberately separate from airline/MAWB adapters.
// myspeedpost.com is an independent third-party site, NOT an official India Post website.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE='https://myspeedpost.com';
const textClean=value=>String(value||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function speedPostNumber(value=''){
  const cleaned=String(value||'').toUpperCase().replace(/[\s-]/g,'');
  return /^ED[0-9]{9}IN$/.test(cleaned)?cleaned:'';
}

export function parseSpeedPostText(raw='',number=''){
  const input=String(raw||'').replace(/\r/g,'').replace(/\u00a0/g,' ');
  const normalized=input.split('\n').map(textClean).filter(Boolean);
  const flat=normalized.join('\n');
  if(!number||!flat.toUpperCase().includes(number.toUpperCase()))return null;
  // No shipment data is inferred from page headings, an empty search form or generic examples.
  if(!/Consignment Details|Current Status|Booked On/i.test(flat))return null;
  const take=(label,limit=3)=>{
    const rx=new RegExp('^'+label+'(?:\\s*:\\s*|\\s+)?(.*)$','i');
    for(let i=0;i<normalized.length;i++){
      const m=normalized[i].match(rx);
      if(!m)continue;
      let value=textClean(m[1]);
      if(!value||/^[:\-]$/.test(value))value=textClean(normalized[i+1]||'');
      if(!value||value.length>limit*100)return'';
      if(/^(Consignment Details|Current Status|Booked On|Last Updated|Article Type|Tariff|Origin|Destination|Timeline|Map View|Out for Delivery|Delivered|Booked)$/i.test(value))return'';
      return value;
    }
    return'';
  };
  // The site's desktop layout shows each field's label above its value.
  let status=take('CURRENT\\s+STATUS');
  const matchStatus=flat.match(/\b(Out for Delivery|Delivered|In Transit|Reached Destination|Booked|Item Dispatched|Item Received|Accepted|Returned|Held)\b/i);
  if(!status&&matchStatus)status=matchStatus[1];
  if(status&&!/^(Out for Delivery|Delivered|In Transit|Reached Destination|Booked|Item Dispatched|Item Received|Accepted|Returned|Held|Failed Delivery|Undelivered)$/i.test(status)){
    const known=status.match(/Out for Delivery|Delivered|In Transit|Reached Destination|Booked|Item Dispatched|Item Received|Accepted|Returned|Held/i);
    status=known?known[0]:'';
  }
  let tariff=take('TARIFF').replace(/,/g,'');
  const tariffMatch=tariff.match(/(?:₹|INR\s*)?([0-9]+(?:\.[0-9]{1,2})?)\s*(?:INR)?/i);
  tariff=tariffMatch?tariffMatch[1]:'';
  const bookedOn=take('BOOKED\\s+ON');
  const lastUpdated=take('LAST\\s+UPDATED');
  const articleType=take('ARTICLE\\s+TYPE');
  let weight=take('(?:ARTICLE\\s+)?WEIGHT');
  const weightMatch=weight.match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|g|grams?|gm)\b/i);
  weight=weightMatch?(weightMatch[1]+' '+weightMatch[2]):'';
  const cleanPlace=(value)=>{
    const t=textClean(value||'');
    if(!t||t.length>210||/^(Origin|Destination|Show|Hide|See Details|View Details|Map View|Timeline)$/i.test(t))return'';
    return t;
  };
  const origin=accordionLocation(flat,'origin');
  const destination=accordionLocation(flat,'destination');
  const hasShipmentEvidence=Boolean(bookedOn||lastUpdated||articleType||tariff||(/Consignment Details/i.test(flat)&&status));
  if(!hasShipmentEvidence)return null;
  return{
    trackingNo:number,status:status||'',origin,destination,tariff,bookingDate:bookedOn,
    lastUpdated,articleType,weight,
    outForDelivery:/out\s+for\s+delivery/i.test(status),
    outForDeliveryAt:'',
    delivered:/^Delivered$/i.test(status),
    source:'MySpeedPost third-party tracker',
    officialSource:false,
    verifiedAt:new Date().toISOString(),
    trackingUrl:BASE+'/track-ems-speedpost?n='+encodeURIComponent(number)+'&sync=true'
  };
}

// Never store accordion field labels as places. The real country appears
// under COUNTRY only AFTER the Destination accordion is expanded.
const INVALID_PLACE=/^(ORIGIN|DESTINATION|COUNTRY|DESTINATION COUNTRY|BOOKING OFFICE|BOOKING OFFICE NAME|PINCODE|POSTAL CODE|POST OFFICE|CITY|STATE|DISTRICT|ADDRESS|VIEW DETAILS|SHOW DETAILS|HIDE DETAILS|TIMELINE|MAP VIEW|CURRENT STATUS|LAST UPDATED|BOOKED ON|ARTICLE TYPE|TARIFF|DELIVERY OFFICE|COUNTRY NAME|TRACKING DETAILS|TRACKING HISTORY|LOADING|N\/A|UNKNOWN|NOT AVAILABLE|NO DATA|[-–—])$/i;
function validLocation(value=''){
  const place=textClean(value).replace(/^[\s:–—-]+|[\s:–—-]+$/g,'');
  return place&&place.length<=160&&/[a-z]/i.test(place)&&!INVALID_PLACE.test(place)&&
    !/^(Consignment Details|Get live updates|Out for Delivery|In Transit|Reached Destination|Delivered|Booked|Estimated Delivery)/i.test(place)&&!/^https?:\/\//i.test(place)?place:'';
}
function accordionLocation(raw='',type=''){
  const lines=String(raw||'').replace(/\r/g,'').split('\n').map(textClean).filter(Boolean);
  const title=type==='destination'?'DESTINATION':'ORIGIN';
  const starts=lines.reduce((arr,line,i)=>{
    if(new RegExp('^'+title+'(?:\\s*[:\\-]\\s*)?
  return String(html||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/(?:div|section|span|p|li|h[1-6]|button|dd|dt|strong|label|summary|tr|td)>/gi,'\n')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'").replace(/&[a-z]+;/gi,' ')
    .replace(/[ \t]+/g,' ');
}

async function fromHtml(url,number){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),8500);
  try{
    const r=await fetch(url,{cache:'no-store',redirect:'follow',signal:ctrl.signal,headers:{
      'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'accept':'text/html,application/xhtml+xml','accept-language':'en-IN,en;q=0.9'
    }});
    if(!r.ok)return null;
    const html=await r.text();
    if(html.length>2000000)return null;
    return parseSpeedPostText(htmlToText(html),number);
  }catch{return null;}finally{clearTimeout(timer);}
}

async function expandedLocation(page,title){
  // Read each accordion IMMEDIATELY after opening it, in case opening the next
  // accordion automatically closes the previous one.
  const clicked=await page.evaluate(title=>{
    const norm=value=>String(value||'').replace(/[▼▾▸⌄›↗]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
    const elements=[...document.querySelectorAll('button,summary,[role="button"],[aria-expanded],h2,h3,h4')];
    const match=elements.find(el=>norm(el.innerText||el.textContent||'')===title.toLowerCase());
    if(!match)return false;
    const trigger=match.matches('button,summary,[role="button"],[aria-expanded]')?match:match.closest('button,summary,[role="button"],[aria-expanded]')||match;
    const expanded=trigger.getAttribute('aria-expanded')==='true'||trigger.getAttribute('data-state')==='open'||
      (trigger.tagName==='SUMMARY'&&trigger.closest('details')?.open);
    if(!expanded)trigger.click();
    return true;
  },title).catch(()=>false);
  if(!clicked)return'';
  await delay(700);
  const regions=await page.evaluate(title=>{
    const norm=value=>String(value||'').replace(/[▼▾▸⌄›↗]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
    const elements=[...document.querySelectorAll('button,summary,[role="button"],[aria-expanded],h2,h3,h4')];
    const match=elements.find(el=>norm(el.innerText||el.textContent||'')===title.toLowerCase());
    if(!match)return[];
    const trigger=match.matches('button,summary,[role="button"],[aria-expanded]')?match:match.closest('button,summary,[role="button"],[aria-expanded]')||match;
    const out=[];
    const add=el=>{const t=el?.innerText||el?.textContent||'';if(t.trim()&&t.length<2500&&!out.includes(t))out.push(t)};
    const controlled=trigger.getAttribute('aria-controls');
    if(controlled)add(document.getElementById(controlled));
    if(trigger.tagName==='SUMMARY')add(trigger.closest('details'));
    add(trigger.nextElementSibling);
    add(trigger.parentElement?.nextElementSibling);
    add(trigger.parentElement);
    add(trigger.parentElement?.parentElement);
    add(trigger.parentElement?.parentElement?.parentElement);
    return out;
  },title).catch(()=>[]);
  for(const region of regions){
    const country=accordionLocation(region,title.toLowerCase());
    if(country)return country;
  }
  const pageText=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
  return accordionLocation(pageText,title.toLowerCase());
}

async function fromBrowser(url,number){
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
    await delay(1200);
    let text=await page.evaluate(()=>document.body?.innerText||'');
    // Follow the user's described Search + Track Now flow when the direct URL has no result.
    if(!text.toUpperCase().includes(number)||!/Consignment Details/i.test(text)){
      await page.goto(BASE+'/track',{waitUntil:'domcontentloaded',timeout:15000});
      await page.evaluate(no=>{
        const input=[...document.querySelectorAll('input')]
          .find(el=>/tracking|consignment|article|EK123/i.test((el.placeholder||'')+' '+(el.name||'')+' '+(el.id||'')))||
          document.querySelector('input[type="text"]');
        if(input){
          const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
          setter?.call(input,no);
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
        }
      },number);
      await delay(200);
      await page.evaluate(()=>{
        const btn=[...document.querySelectorAll('button,[role="button"]')]
          .find(el=>/Track Now/i.test(el.innerText||el.textContent||''));
        btn?.click();
      });
      await delay(1500);
      await page.waitForFunction((no)=>document.body?.innerText?.includes(no)&&/Consignment Details/i.test(document.body?.innerText||''),{timeout:11000},number).catch(()=>{});
    }
    await page.evaluate(()=>window.scrollTo(0,Math.min(1000,document.body.scrollHeight))).catch(()=>{});
    const origin=await expandedLocation(page,'Origin');
    const destination=await expandedLocation(page,'Destination');
    text=await page.evaluate(()=>document.body?.innerText||'');
    const shipment=parseSpeedPostText(text,number);
    if(shipment){
      if(origin)shipment.origin=origin;
      if(destination)shipment.destination=destination;
    }
    return shipment;
  }catch{return null;}
  finally{try{await browser?.close()}catch{}}
}

export async function trackSpeedPost(value){
  const no=speedPostNumber(value);
  if(!no)return{ok:false,error:'Enter a valid ED + 9 digits + IN Speed Post number.'};
  const url=BASE+'/track-ems-speedpost?n='+encodeURIComponent(no)+'&sync=true';
  const html=await fromHtml(url,no);
  // Browser needed when the page is hydrated client-side or to expand Origin/Destination.
  const browser=await fromBrowser(url,no);
  const merged=browser?{...html,...browser,origin:validLocation(browser.origin)||validLocation(html?.origin)||'',destination:validLocation(browser.destination)||validLocation(html?.destination)||'',weight:browser.weight||html?.weight||'',tariff:browser.tariff||html?.tariff||''}:html;
  if(!merged)return{ok:false,error:'MySpeedPost did not provide verified consignment details. Old saved data has not been changed.',trackingUrl:url};
  return{ok:true,shipment:merged};
}
,'i').test(line))arr.push(i);
    return arr;
  },[]);
  // Match only expanded named accordion; never infer a destination from an unrelated label.
  for(const start of starts){
    const next=lines.findIndex((line,i)=>i>start&&/^(Origin|Destination|Timeline|Map View|Consignment Details|Last Updated|Live Tracking|Delivery Alerts|Notifications)$/i.test(line));
    const block=lines.slice(start+1,next>start?next:Math.min(lines.length,start+23));
    const tag=type==='destination'?/^(?:DESTINATION\s+)?(?:COUNTRY|COUNTRY NAME)(?:\s*[:\-]\s*(.+))?$/i:/^(?:BOOKING OFFICE|BOOKING OFFICE NAME|POST OFFICE|OFFICE)(?:\s*[:\-]\s*(.+))?$/i;
    for(let i=0;i<block.length;i++){
      const match=block[i].match(tag);
      if(!match)continue;
      const direct=validLocation(match[1]||'');
      if(direct)return direct;
      for(let j=i+1;j<Math.min(i+4,block.length);j++){
        const candidate=validLocation(block[j]);if(candidate)return candidate;
      }
    }
    if(block.length===1){const only=validLocation(block[0]);if(only)return only;}
  }
  return'';
}

function htmlToText(html=''){
  return String(html||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/(?:div|section|span|p|li|h[1-6]|button|dd|dt|strong|label|summary|tr|td)>/gi,'\n')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'").replace(/&[a-z]+;/gi,' ')
    .replace(/[ \t]+/g,' ');
}

async function fromHtml(url,number){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),8500);
  try{
    const r=await fetch(url,{cache:'no-store',redirect:'follow',signal:ctrl.signal,headers:{
      'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'accept':'text/html,application/xhtml+xml','accept-language':'en-IN,en;q=0.9'
    }});
    if(!r.ok)return null;
    const html=await r.text();
    if(html.length>2000000)return null;
    return parseSpeedPostText(htmlToText(html),number);
  }catch{return null;}finally{clearTimeout(timer);}
}

async function clickDisclosure(page,title){
  return page.evaluate(title=>{
    const matches=[...document.querySelectorAll('button,summary,[role="button"]')]
      .filter(el=>(el.innerText||el.textContent||'').trim().toLowerCase()===title.toLowerCase());
    const b=matches.find(el=>{
      const box=el.getBoundingClientRect();
      return box.width>0&&box.height>0;
    });
    if(b){b.click();return true;}
    const text=[...document.querySelectorAll('h2,h3,h4,span,div')]
      .filter(el=>(el.innerText||'').trim().toLowerCase()===title.toLowerCase()&&el.children.length===0);
    const hit=text.find(el=>el.closest('button,[role="button"],summary'));
    if(hit){hit.closest('button,[role="button"],summary').click();return true;}
    return false;
  },title).catch(()=>false);
}

async function fromBrowser(url,number){
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36');
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
    await delay(1200);
    let text=await page.evaluate(()=>document.body?.innerText||'');
    // Follow the user's described Search + Track Now flow when the direct URL has no result.
    if(!text.toUpperCase().includes(number)||!/Consignment Details/i.test(text)){
      await page.goto(BASE+'/track',{waitUntil:'domcontentloaded',timeout:15000});
      await page.evaluate(no=>{
        const input=[...document.querySelectorAll('input')]
          .find(el=>/tracking|consignment|article|EK123/i.test((el.placeholder||'')+' '+(el.name||'')+' '+(el.id||'')))||
          document.querySelector('input[type="text"]');
        if(input){
          const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
          setter?.call(input,no);
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
        }
      },number);
      await delay(200);
      await page.evaluate(()=>{
        const btn=[...document.querySelectorAll('button,[role="button"]')]
          .find(el=>/Track Now/i.test(el.innerText||el.textContent||''));
        btn?.click();
      });
      await delay(1500);
      await page.waitForFunction((no)=>document.body?.innerText?.includes(no)&&/Consignment Details/i.test(document.body?.innerText||''),{timeout:11000},number).catch(()=>{});
    }
    await page.evaluate(()=>window.scrollTo(0,Math.min(1000,document.body.scrollHeight))).catch(()=>{});
    await clickDisclosure(page,'Origin');
    await delay(200);
    await clickDisclosure(page,'Destination');
    await delay(300);
    text=await page.evaluate(()=>document.body?.innerText||'');
    let shipment=parseSpeedPostText(text,number);
    if(shipment){
      // Accordion labels are only considered after clicks; no inferred locations.
      const locations=await page.evaluate(()=>{
        const get=name=>{
          const candidates=[...document.querySelectorAll('button,summary,[role="button"]')]
            .filter(e=>(e.innerText||e.textContent||'').trim().toLowerCase()===name);
          for(const el of candidates){
            const parent=el.parentElement?.parentElement||el.parentElement;
            const s=(parent?.innerText||'').trim();
            const lines=s.split('\n').map(x=>x.trim()).filter(Boolean);
            const idx=lines.findIndex(x=>x.toLowerCase()===name);
            if(idx>=0&&lines[idx+1]&&lines[idx+1].length<180&&!/^(Origin|Destination|Map View|Timeline)$/i.test(lines[idx+1]))return lines[idx+1];
          }
          return'';
        };
        return {origin:get('origin'),destination:get('destination')};
      }).catch(()=>({}));
      if(locations.origin)shipment.origin=locations.origin;
      if(locations.destination)shipment.destination=locations.destination;
    }
    return shipment;
  }catch{return null;}
  finally{try{await browser?.close()}catch{}}
}

export async function trackSpeedPost(value){
  const no=speedPostNumber(value);
  if(!no)return{ok:false,error:'Enter a valid ED + 9 digits + IN Speed Post number.'};
  const url=BASE+'/track-ems-speedpost?n='+encodeURIComponent(no)+'&sync=true';
  const html=await fromHtml(url,no);
  // Browser needed when the page is hydrated client-side or to expand Origin/Destination.
  const browser=await fromBrowser(url,no);
  const merged=browser?{...html,...browser,origin:browser.origin||html?.origin||'',destination:browser.destination||html?.destination||'',weight:browser.weight||html?.weight||'',tariff:browser.tariff||html?.tariff||''}:html;
  if(!merged)return{ok:false,error:'MySpeedPost did not provide verified consignment details. Old saved data has not been changed.',trackingUrl:url};
  return{ok:true,shipment:merged};
}
