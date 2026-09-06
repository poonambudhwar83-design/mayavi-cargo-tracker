import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

const URL='https://china.saudiacargo.com/e-services/track-shipment';
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const pad=v=>String(v).padStart(2,'0');

const ENGLISH_REPLACEMENTS=[
  [/货物追踪|追踪货物/g,'Track Shipment'],
  [/运单号|空运单号|航空运单号/g,'AWB Number'],
  [/目的地/g,'Destination'],
  [/始发地|起点|出发地/g,'Origin'],
  [/总件数|件数/g,'No. of Pieces'],
  [/总重量|重量/g,'Weight'],
  [/航段/g,'Segment'],
  [/航班/g,'Flight'],
  [/实际到达|已到达|到达|抵达|到港/g,'Arrived'],
  [/已从航班接收|从航班接收/g,'Received from Flight'],
  [/已交付|交付完成|已送达/g,'Delivered'],
  [/出发|离港|起飞|已起飞/g,'Departed'],
  [/已接收托运人货物|从托运人处接收/g,'Received from Shipper'],
  [/已接受|接受/g,'Accepted'],
  [/预订|已预订/g,'Booked'],
  [/计划航班/g,'Planned For Flight'],
  [/已配载/g,'Manifested on Flight'],
  [/异常/g,'Discrepancy'],
  [/日期/g,'Date'],
  [/时间/g,'Time'],
  [/当地时间/g,'local time'],
  [/货物详情|货运详情/g,'Shipment Details'],
  [/状态/g,'Status']
];

function translateText(value=''){
  let s=String(value||'');
  for(const [rx,repl] of ENGLISH_REPLACEMENTS)s=s.replace(rx,repl);
  return s.replace(/\s+/g,' ').trim();
}

async function translatePageToEnglish(page){
  let count=0;
  for(const frame of page.frames()){
    const changed=await frame.evaluate((pairs)=>{
      const replacements=pairs.map(([source,flags,repl])=>[new RegExp(source,flags),repl]);
      const apply=v=>{let s=String(v||'');for(const [rx,repl] of replacements)s=s.replace(rx,repl);return s};
      let n=0;
      const walk=root=>{
        try{
          const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
          let node;while((node=walker.nextNode())){const old=node.nodeValue||'',next=apply(old);if(next!==old){node.nodeValue=next;n++}}
          for(const el of root.querySelectorAll?.('[placeholder],[aria-label],[title],input[type="submit"],button')||[]){
            for(const attr of ['placeholder','aria-label','title']){const old=el.getAttribute?.(attr);if(old){const next=apply(old);if(next!==old){el.setAttribute(attr,next);n++}}}
            if(el.tagName==='INPUT'&&String(el.type).toLowerCase()==='submit'){const old=el.value||'',next=apply(old);if(next!==old){el.value=next;n++}}
          }
          for(const el of root.querySelectorAll?.('*')||[])if(el.shadowRoot)walk(el.shadowRoot);
        }catch{}
      };
      walk(document.body);
      document.documentElement.lang='en';
      return n;
    },ENGLISH_REPLACEMENTS.map(([rx,repl])=>[rx.source,rx.flags,repl])).catch(()=>0);
    count+=changed||0;
  }
  return count;
}

function isoDate(day,mon,year){
  const m=MONTHS[String(mon).slice(0,3).toUpperCase()];if(!m)return'';
  const y=String(year).length===2?`20${year}`:String(year);
  return`${y}-${m}-${pad(day)}`;
}
function eventTime(e={}){const t=Date.parse(`${e.date||''}T${e.time||'00:00'}:00Z`);return Number.isFinite(t)?t:0}

function eventsFromText(raw=''){
  const text=translateText(raw);
  const marks=[];
  for(const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\s*[-–—]\s*([0-3]?\d)\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})\s+local\s+time\b/gi)){
    marks.push({index:m.index||0,date:isoDate(m[3],m[4],m[5]),time:`${pad(m[1])}:${m[2]}`});
  }
  for(const m of text.matchAll(/\b([0-3]?\d)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(20\d{2})\s+([01]?\d|2[0-3]):([0-5]\d)\b/gi)){
    marks.push({index:m.index||0,date:isoDate(m[1],m[2],m[3]),time:`${pad(m[4])}:${m[5]}`});
  }
  marks.sort((a,b)=>a.index-b.index);
  const unique=[];for(const x of marks)if(!unique.some(y=>Math.abs(y.index-x.index)<8))unique.push(x);
  return unique.map((x,i)=>({date:x.date,time:x.time,text:text.slice(x.index,i+1<unique.length?unique[i+1].index:Math.min(text.length,x.index+1100)).trim()}));
}

function segmentBlocks(raw=''){
  const text=translateText(raw);
  const hits=[...text.matchAll(/\bSegment\s*(\d+)\b/gi)];
  if(!hits.length)return[];
  return hits.map((m,i)=>({
    no:Number(m[1]),
    text:text.slice(m.index||0,i+1<hits.length?hits[i+1].index:text.length).trim()
  })).sort((a,b)=>a.no-b.no);
}

function fields(text=''){
  const s=translateText(text),u=s.toUpperCase();
  const flight=(u.match(/\bSV[-\s]?(\d{2,4})\b/)||[])[1]||'';
  const destination=(u.match(/\bDESTINATION\s*[:\-]?\s*([A-Z]{3})\b/)||[])[1]
    ||(u.match(/\bTO\b[\s\S]{0,180}?\(([A-Z]{3})\)/)||[])[1]
    ||'';
  const pieces=(s.match(/(?:No\.?\s*of\s*Pieces|Total\s+Number\s+of\s+Pieces|Pieces?|Pcs?)\s*[:=\-]?\s*(\d{1,6})/i)||[])[1]||'';
  const weight=((s.match(/(?:Gross\s+Weight|Weight)\s*[:=\-]?\s*([\d,.]+)/i)||[])[1]||'').replace(/,/g,'');
  return{flightNo:flight?`SV${flight}`:'',destination,pieces,weight};
}

const isDelivered=t=>/\bDELIVERED\b|\bDLV\b/i.test(translateText(t));
const isArrived=t=>/\bARRIVED\b|\bRCF\b|RECEIVED\s+FROM\s+FLIGHT|ACTUAL\s+ARRIVAL|LANDED/i.test(translateText(t));
const isDeparted=t=>/\bDEPARTED\b|\bDEP\b|IN\s+TRANSIT|AIRBORNE/i.test(translateText(t));
const isBooked=t=>/\bBOOKED\b|\bRCS\b|RECEIVED\s+FROM\s+SHIPPER|\bACCEPTED\b/i.test(translateText(t));
const isDelayed=t=>/DELAY|LATE|OFFLOAD|DISCREPANCY|EXCEPTION/i.test(translateText(t));

function parseSaudia(raw,mawb){
  const text=translateText(raw);
  const segments=segmentBlocks(raw);
  const allEvents=eventsFromText(raw).sort((a,b)=>eventTime(a)-eventTime(b));

  // User-defined rule: Segment 1 carries booking date.
  const seg1=segments.find(s=>s.no===1)||segments[0]||null;
  const seg1Events=seg1?eventsFromText(seg1.text).sort((a,b)=>eventTime(a)-eventTime(b)):[];
  const seg1Booking=seg1Events.find(e=>isBooked(e.text))||seg1Events[0]||allEvents.find(e=>isBooked(e.text))||allEvents[0]||null;
  const bookingDate=seg1Booking?.date||'';

  // User-defined rule: last segment/latest line decides final status and arrival.
  const lastSegment=segments.length?segments[segments.length-1]:null;
  const lastEvents=(lastSegment?eventsFromText(lastSegment.text):allEvents).sort((a,b)=>eventTime(a)-eventTime(b));
  const latestEvent=lastEvents[lastEvents.length-1]||allEvents[allEvents.length-1]||null;
  const latestArrival=[...lastEvents].reverse().find(e=>isDelivered(e.text)||isArrived(e.text))
    ||[...allEvents].reverse().find(e=>isDelivered(e.text)||isArrived(e.text))
    ||null;

  const header=fields(text),lastFields=fields(lastSegment?.text||''),latestFields=fields(latestEvent?.text||'');
  const pieces=header.pieces||lastFields.pieces||latestFields.pieces||'';
  const weight=header.weight||lastFields.weight||latestFields.weight||'';
  const destination=latestFields.destination||lastFields.destination||header.destination
    ||(/INDIRA\s+GANDHI[\s\S]{0,80}?\(DEL\)/i.test(text)?'DEL':'');
  const origin=(text.toUpperCase().match(/\bORIGIN\s*[:\-]?\s*([A-Z]{3})\b/)||[])[1]
    ||(/KING\s+KHALED[\s\S]{0,80}?\(RUH\)/i.test(text)?'RUH':'');
  const flightNo=latestFields.flightNo||lastFields.flightNo||header.flightNo||'';

  let status='TRACKING';
  if(latestEvent){
    if(isDelivered(latestEvent.text))status='DELIVERED';
    else if(isArrived(latestEvent.text))status='ARRIVED';
    else if(isDeparted(latestEvent.text))status='IN TRANSIT';
    else if(isDelayed(latestEvent.text))status='DELAYED';
    else if(isBooked(latestEvent.text))status='BOOKED';
  }

  const arrivalDate=latestArrival?.date||'';
  const arrivalTime=latestArrival?.time||'';
  const shipment={
    mawb,carrierCode:'SV',airlineName:'Saudia Cargo',origin,destination,
    bags:pieces,pieces,weight,flightNo,bookingDate,arrivalDate,arrivalTime,
    arrivalIsActual:Boolean(arrivalDate&&arrivalTime),status,
    finalMilestone:status,officialTracker:URL,
    source:'Saudia Cargo translated + expanded segment timeline'
  };
  const verified=Boolean(segments.length||allEvents.length||pieces||flightNo||arrivalDate||arrivalTime);
  return verified?{shipment,segments,allEvents,seg1,latestEvent,latestArrival}:null;
}

async function pageText(page){
  const out=[];
  for(const frame of page.frames()){
    const t=await frame.evaluate(()=>{
      const parts=[];const walk=root=>{try{if(root?.innerText)parts.push(root.innerText);for(const e of root?.querySelectorAll?.('*')||[])if(e.shadowRoot)walk(e.shadowRoot)}catch{}};walk(document.body);return parts.join('\n');
    }).catch(()=> '');
    if(t)out.push(t);
  }
  return out.join('\n');
}

async function findAwbInput(page){
  return page.evaluate(()=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>10&&!e.disabled};
    const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button'].includes(String(e.type||'text').toLowerCase()));
    const awb=inputs.find(e=>/awb|airway|shipment|065-000000/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''}`))||inputs[0];
    if(!awb)return false;awb.setAttribute('data-mayavi-awb','1');return true;
  }).catch(()=>false);
}

async function clickArrow(page){
  const info=await page.evaluate(()=>{
    const awb=document.querySelector('[data-mayavi-awb="1"]');if(!awb)return{ok:false};
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8&&!e.disabled};
    const r=awb.getBoundingClientRect(),cy=r.top+r.height/2;
    const candidates=[...document.querySelectorAll('button,[role="button"],a,input[type="submit"],svg')].filter(visible).map(e=>{
      const c=e.closest('button,[role="button"],a,input[type="submit"]')||e,q=c.getBoundingClientRect();
      const t=(c.innerText||c.value||c.getAttribute('aria-label')||c.title||'').replace(/\s+/g,' ').trim();
      return{e:c,t,q};
    });
    let x=candidates.find(v=>/^(track|search|go|→|›|>)$/i.test(v.t)||/track\s*shipment/i.test(v.t));
    if(!x)x=candidates.filter(v=>v.q.left>=r.right-25&&v.q.left<=r.right+220&&Math.abs(v.q.top+v.q.height/2-cy)<95).sort((a,b)=>Math.abs(a.q.top+a.q.height/2-cy)-Math.abs(b.q.top+b.q.height/2-cy))[0];
    if(!x)return{ok:false};x.e.setAttribute('data-mayavi-arrow','1');return{ok:true,label:x.t||'arrow'};
  }).catch(()=>({ok:false}));
  if(!info.ok)return info;
  await page.click('[data-mayavi-arrow="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-arrow="1"]')?.click()).catch(()=>{}));
  return info;
}

async function clickPlus(page,mawb){
  const digits=mawb.replace(/\D/g,''),serial=digits.slice(3);
  const info=await page.evaluate(({digits,serial})=>{
    const visible=e=>{try{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>8&&r.height>8}catch{return false}};
    const txt=e=>(e.innerText||e.textContent||e.getAttribute?.('aria-label')||e.getAttribute?.('title')||'').replace(/\s+/g,' ').trim();
    const nodes=[...document.querySelectorAll('body *')];
    let card=nodes.find(e=>visible(e)&&((txt(e).replace(/\D/g,'').includes(digits))||(serial&&txt(e).replace(/\D/g,'').includes(serial))));
    if(card){for(let i=0;i<7&&card?.parentElement;i++){const r=card.getBoundingClientRect();if(r.width>280&&r.height>50&&r.height<600)break;card=card.parentElement}}
    const cr=card?.getBoundingClientRect?.();
    const clickable=[...document.querySelectorAll('button,[role="button"],a,[tabindex],svg')].filter(visible).map(e=>{const c=e.closest('button,[role="button"],a,[tabindex]')||e;return{e:c,t:txt(c),r:c.getBoundingClientRect()}});
    let x=clickable.find(v=>/^\+$/.test(v.t)||/plus|expand|details|show more|open/i.test(`${v.t} ${v.e.getAttribute?.('aria-label')||''} ${v.e.getAttribute?.('title')||''}`));
    if(!x&&cr)x=clickable.filter(v=>v.r.width<=90&&v.r.height<=90&&v.r.right>=cr.right-100&&v.r.top>=cr.top-60&&v.r.bottom<=cr.bottom+80).sort((a,b)=>Math.abs(a.r.right-cr.right)-Math.abs(b.r.right-cr.right))[0];
    if(!x)return{ok:false,cardFound:Boolean(cr)};x.e.setAttribute('data-mayavi-plus','1');return{ok:true,label:x.t||'plus',cardFound:Boolean(cr)};
  },{digits,serial}).catch(()=>({ok:false}));
  if(!info.ok)return info;
  await page.click('[data-mayavi-plus="1"]').catch(()=>page.evaluate(()=>document.querySelector('[data-mayavi-plus="1"]')?.click()).catch(()=>{}));
  await new Promise(r=>setTimeout(r,900));return info;
}

async function scrollAllSegments(page){
  for(let i=0;i<20;i++){
    await page.evaluate(()=>{
      window.scrollBy(0,Math.max(500,window.innerHeight*.75));
      for(const e of document.querySelectorAll('*'))if(e.scrollHeight>e.clientHeight+180)e.scrollTop=Math.min(e.scrollHeight,e.scrollTop+Math.max(400,e.clientHeight*.8));
    }).catch(()=>{});
    await new Promise(r=>setTimeout(r,220));
  }
  await page.evaluate(()=>window.scrollTo(0,document.body?.scrollHeight||0)).catch(()=>{});
  await new Promise(r=>setTimeout(r,500));
}

async function makePage(browser){
  const page=await browser.newPage();
  const version=await browser.version().catch(()=> 'HeadlessChrome/140.0.0.0');
  const chrome=(version.match(/(?:Chrome|Chromium)\/([\d.]+)/)||[])[1]||'140.0.0.0';
  await page.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`);
  await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
  return page;
}

export async function trackSaudiaDirect(input){
  const mawb=normalizeMawb(input);if(!mawb||!mawb.startsWith('065-'))return{ok:false,reason:'INVALID SAUDIA MAWB',officialTracker:URL};
  const values=[mawb.replace(/\D/g,''),mawb,mawb.replace(/\D/g,'').slice(3)];
  let browser;const responses=[];
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-US,en','--window-size=1365,900'],defaultViewport:{width:1365,height:900},executablePath:await chromium.executablePath(),headless:'shell'});
    const page=await makePage(browser);
    page.on('response',async res=>{try{if(!/\/apis\/api\/eservices\/track-shipment/i.test(res.url()))return;responses.push({status:res.status(),body:(await res.text().catch(()=>'' )).slice(0,8000)})}catch{}});

    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:24000});
    await new Promise(r=>setTimeout(r,2200));

    // STEP 1 — mandatory: translate Chinese page to English before doing anything else.
    const initialTranslationCount=await translatePageToEnglish(page);
    await new Promise(r=>setTimeout(r,250));

    if(!await findAwbInput(page))return{ok:false,reason:'SAUDIA AWB INPUT NOT FOUND AFTER ENGLISH TRANSLATION',officialTracker:URL,debug:{stage:'NO_INPUT',initialTranslationCount}};

    const attempts=[];
    for(const value of values){
      responses.length=0;
      await page.click('[data-mayavi-awb="1"]',{clickCount:3}).catch(()=>{});
      await page.keyboard.press('Control+A').catch(()=>{});await page.keyboard.press('Backspace').catch(()=>{});
      await page.type('[data-mayavi-awb="1"]',value,{delay:35}).catch(()=>{});
      const arrow=await clickArrow(page);if(!arrow.ok)await page.keyboard.press('Enter').catch(()=>{});
      await Promise.race([page.waitForNetworkIdle({idleTime:700,timeout:9000}).catch(()=>{}),new Promise(r=>setTimeout(r,9000))]);
      await new Promise(r=>setTimeout(r,900));

      const captchaBlocked=responses.some(x=>x.status===400&&/invalidCaptcha|captcha/i.test(x.body));
      const resultTranslationCount=await translatePageToEnglish(page);
      const plus=captchaBlocked?{ok:false,reason:'captcha-required'}:await clickPlus(page,mawb);
      if(plus.ok){await translatePageToEnglish(page);await scrollAllSegments(page);await translatePageToEnglish(page)}

      const visible=await pageText(page);
      const network=responses.map(x=>x.body).join('\n');
      const parsed=parseSaudia(`${visible}\n${network}`,mawb);
      attempts.push({value,arrow:arrow.label||'',plusClicked:Boolean(plus.ok),captchaBlocked,initialTranslationCount,resultTranslationCount,segments:parsed?.segments?.length||0,events:parsed?.allEvents?.length||0});

      if(parsed?.shipment){
        const shot=await page.screenshot({type:'jpeg',quality:70,fullPage:false,encoding:'base64'}).catch(()=>null);
        return{ok:true,shipment:parsed.shipment,screenshotBase64:shot,debug:{stage:'SUCCESS',attempts,segment1:parsed.seg1?.text?.slice(0,800)||'',lastSegment:parsed.segments?.at(-1)?.text?.slice(0,1000)||'',latestEvent:parsed.latestEvent?.text?.slice(0,700)||''}};
      }
      if(captchaBlocked)break;
    }

    const shot=await page.screenshot({type:'jpeg',quality:70,fullPage:false,encoding:'base64'}).catch(()=>null);
    const captchaBlocked=attempts.some(a=>a.captchaBlocked);
    return{ok:false,reason:captchaBlocked?'SAUDIA CAPTCHA VALIDATION REQUIRED — USER-SIDE VALIDATION NEEDED':'SAUDIA SEGMENTS COULD NOT BE VERIFIED',officialTracker:URL,screenshotBase64:shot,debug:{stage:captchaBlocked?'CAPTCHA_REQUIRED':'NO_SEGMENTS',attempts}};
  }catch(e){return{ok:false,reason:`SAUDIA V2 ERROR: ${e?.message||e}`,officialTracker:URL,debug:{stage:'ERROR'}}}
  finally{try{if(browser)await browser.close()}catch{}}
}
