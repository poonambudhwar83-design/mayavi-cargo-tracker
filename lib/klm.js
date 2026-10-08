import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

// Dedicated PUBLIC Air France-KLM Martinair Track & Trace form.
// Only prefix 074 is routed here. Never infer an arrival from the home page.
const URL='https://www.afklcargo.com/';
const pad=v=>String(v).padStart(2,'0');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
function dateOf(v=''){
  const s=String(v||'').toUpperCase();
  let m=s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(m)return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
  m=s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if(m)return m[3]+'-'+pad(m[2])+'-'+pad(m[1]);
  m=s.match(/\b(\d{1,2})[-\s]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s,]+(20\d{2})\b/);
  if(m)return m[3]+'-'+MONTH[m[2]]+'-'+pad(m[1]);
  return'';
}
function timeOf(v=''){
  const m=String(v||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?pad(m[1])+':'+m[2]:'';
}
function code(v=''){return String(v||'').trim().toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]||'';}
function matchesAwb(text,serial,digits){
  const t=String(text||'').replace(/[^0-9]/g,'');
  return t.includes(digits)||t.includes(serial);
}
function parseShipment(text,mawb,network=[],tables=[]){
  const serial=mawb.slice(4),digits=mawb.replace(/\D/g,'');
  const carrierBlocks=network.filter(item=>matchesAwb(item.body,serial,digits));
  const visible=String(text||'');
  // A home page with a filled search field is NOT a tracking response.
  const hasAwb=carrierBlocks.length>0||matchesAwb(visible,serial,digits);
  const hasEvidence=/\b(?:shipment\s+(?:information|details|history|status|tracking)|air\s*waybill\s+(?:details|information)|tracking\s+details|(?:received|departed|arrived|delivered)\s+(?:from|at|to|on)|\b(?:BKD|RCS|DEP|ARR|RCF|DLV)\b)\b/i.test(visible)
    ||carrierBlocks.some(item=>/"(?:awb|airwayBill|origin|destination|movement|milestone|status|flight|pieces|weight)"\s*:/i.test(item.body));
  if(!hasAwb||!hasEvidence)return null;

  const sourceText=visible+'\n'+carrierBlocks.map(x=>x.body).join('\n');
  const flat=clean(sourceText),lines=sourceText.split(/\n/).map(clean).filter(Boolean);
  const get=rx=>(flat.match(rx)||[])[1]||'';
  let origin=code(get(/\bOrigin\s*(?:Airport|Station|Code)?\s*[:\-]?\s*([A-Z]{3})\b/i));
  let destination=code(get(/\bDestination\s*(?:Airport|Station|Code)?\s*[:\-]?\s*([A-Z]{3})\b/i));
  const route=flat.match(/\b([A-Z]{3})\s*(?:→|->|–|—|to)\s*([A-Z]{3})\b/i);
  if(route){origin=origin||route[1].toUpperCase();destination=destination||route[2].toUpperCase();}
  let pieces=get(/\b(?:total\s*)?(?:pieces|pcs|piece\s*count)\s*[:\-]?\s*(\d{1,6})\b/i);
  let weight=get(/\b(?:gross|chargeable|total)?\s*weight\s*[:\-]?\s*([\d,.]+)\b/i).replace(/,/g,'');
  let flightNo=(flat.match(/\b(?:KL|AF|MP)\s*0*(\d{2,4})\b/i)||[])[0]||'';
  flightNo=flightNo.replace(/\s+/g,'').toUpperCase();
  let bookingDate='',departureDate='',departureTime='',arrivalDate='',arrivalTime='',arrivalIsActual=false,status='TRACKING',arrivalSource='';
  const events=[];
  for(const line of lines){
    if(line.length>550||!/\b(BKD|RCS|DEP|ARR|RCF|DLV|BOOKED|ACCEPTED|DEPARTED|ARRIVED|DELIVERED|RECEIVED FROM FLIGHT|ETA|ETD)\b/i.test(line))continue;
    const date=dateOf(line),time=timeOf(line),st=String(line.match(/\b(?:at|station|airport)\s*[:\-]?\s*([A-Z]{3})\b/i)?.[1]||'').toUpperCase();
    const upper=line.toUpperCase();
    const type=/\bDLV\b|DELIVERED/.test(upper)?'DELIVERED':
      /\bRCF\b|\bARR\b|ARRIVED|RECEIVED FROM FLIGHT/.test(upper)?'ARRIVED':
      /\bDEP\b|DEPARTED/.test(upper)?'DEPARTED':
      /\bBKD\b|BOOKED/.test(upper)?'BOOKED':
      /\bRCS\b|ACCEPTED/.test(upper)?'ACCEPTED':'OTHER';
    if(type==='OTHER'||(!date&&!time))continue;
    events.push({type,date,time,station:st,line:line.slice(0,240)});
  }
  // Only a final-destination ARR / RCF / delivery event is ACTUAL arrival.
  const final=events.filter(e=>e.type==='ARRIVED'||e.type==='DELIVERED')
    .filter(e=>destination&&e.station===destination&&e.date&&e.time)
    .sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time)).at(-1);
  const dep=events.filter(e=>e.type==='DEPARTED'&&e.date&&e.time)
    .sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time)).at(-1);
  const booked=events.filter(e=>e.type==='BOOKED'||e.type==='ACCEPTED')
    .sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time))[0];
  if(booked)bookingDate=booked.date;
  if(dep){departureDate=dep.date;departureTime=dep.time;status='DEPARTED';}
  if(final){arrivalDate=final.date;arrivalTime=final.time;arrivalIsActual=true;status=final.type==='DELIVERED'?'DELIVERED':'ARRIVED';arrivalSource='AFKLM final destination '+final.type+' event';}
  // Field-level status is accepted only from a matched shipment detail panel,
  // not arbitrary delayed-news headlines on a generic home page.
  if(status==='TRACKING'){
    const key=clean(get(/\b(?:latest\s*status|shipment\s*status|current\s*status)\s*[:\-]?\s*(BOOKED|ACCEPTED|DEPARTED|IN TRANSIT|ARRIVED|DELIVERED|DELAYED)\b/i)).toUpperCase();
    if(key)status=key;
  }
  const tableContent=tables.flatMap(t=>t.rows||[]).map(r=>(r.cells||[]).join(' ')).join(' ');
  if(!pieces)pieces=get(/\b(\d{1,6})\s*(?:PCS|PIECES)\b/i);
  if(!weight)weight=get(/\b([\d,.]+)\s*KGS?\b/i).replace(/,/g,'');
  if(!origin||!destination){
    const tr=tableContent.match(/\b([A-Z]{3})\s*(?:→|->|TO|-)\s*([A-Z]{3})\b/i);
    if(tr){origin=origin||tr[1];destination=destination||tr[2];}
  }
  // Must have a verifiable shipment field, not merely the entered AWB.
  if(!origin&&!destination&&!pieces&&!weight&&!flightNo&&!events.length)return null;
  return{mawb,carrierCode:'KL',airlineName:'KLM Cargo',origin,destination,pieces,bags:pieces,weight,flightNo,
    bookingDate,departureDate,departureTime,departureOrigin:origin,
    departureIsActual:Boolean(dep),departureTimeSource:dep?'AFKLM official departure milestone':'',
    arrivalDate,arrivalTime,arrivalIsActual,arrivalEstimate:false,
    arrivalTimeSource:arrivalSource,arrivalTimeZone:arrivalIsActual?'':'',
    status,officialTracker:URL,source:'Air France KLM Martinair public Track & Trace',
    _parsedEvents:events.slice(-20)};
}
async function launch(){
  chromium.setGraphicsMode=false;
  const config={args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
    executablePath:await chromium.executablePath(),headless:'shell',
    defaultViewport:{width:1400,height:1000}};
  let last;
  for(let i=0;i<3;i++)try{return await puppeteer.launch(config)}catch(e){
    last=e;if(!/ETXTBSY|EBUSY/i.test(String(e?.message||e)))throw e;await sleep(450*(i+1));
  }
  throw last;
}
async function snapshot(page){
  let text='',tables=[];
  for(const frame of page.frames())try{
    const v=await frame.evaluate(()=>({
      text:(document.body?.innerText||'').slice(0,55000),
      tables:[...document.querySelectorAll('table')].slice(0,12).map(t=>({
        rows:[...t.querySelectorAll('tr')].slice(0,80).map(r=>({cells:[...r.querySelectorAll('td,th')].map(c=>(c.innerText||'').trim())}))
      }))
    }));
    text+='\n'+v.text;tables.push(...v.tables);
  }catch{}
  return{text,tables};
}
async function formMetadata(page){
  return page.evaluate(()=>({
    inputs:[...document.querySelectorAll('input,[role="textbox"]')].slice(0,30).map(e=>({
      tag:e.tagName,type:e.type||'',id:e.id||'',name:e.name||'',placeholder:e.getAttribute('placeholder')||'',
      aria:e.getAttribute('aria-label')||'',html:e.outerHTML.slice(0,400),value:e.value||'',
      visible:e.getBoundingClientRect().width>10&&e.getBoundingClientRect().height>10
    })),
    controls:[...document.querySelectorAll('button,[role="button"],input[type="submit"]')].slice(0,35).map(e=>({
      text:(e.innerText||e.value||e.getAttribute('aria-label')||'').trim().slice(0,80),
      html:e.outerHTML.slice(0,340),visible:e.getBoundingClientRect().width>10
    }))
  })).catch(()=>({inputs:[],controls:[]}));
}
async function interact(page,awb){
  const serial=awb.slice(4);
  const metas=await formMetadata(page);
  const candidates=await page.$$('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),[role=textbox]');
  let chosen=null,best=-999;
  for(const h of candidates){
    const d=await h.evaluate(e=>({
      name:[e.id,e.name,e.placeholder,e.getAttribute('aria-label'),e.closest('label')?.innerText].join(' ').toLowerCase(),
      visible:e.getBoundingClientRect().width>40&&e.getBoundingClientRect().height>12&&!e.disabled
    })).catch(()=>null);
    if(!d?.visible)continue;
    const score=(/awb|air\s*waybill|airway|shipment|tracking|057|074/.test(d.name)?12:0)+(/number|num|search|enter/.test(d.name)?4:0)-(/flight|date|login|email|password/.test(d.name)?30:0);
    if(score>best){chosen=h;best=score;}
  }
  if(!chosen||best<1)return{filled:false,reason:'AFKLM AWB input not found',metas};
  for(const value of [awb,awb.replace('-',''),serial]){
    await chosen.click({clickCount:3}).catch(()=>{});
    await page.keyboard.press('ControlOrMeta+A').catch(()=>{});
    await page.keyboard.type(value,{delay:48}).catch(()=>{});
    await sleep(320);
    const current=await chosen.evaluate(e=>String(e.value||e.textContent||'')).catch(()=> '');
    if(!current.replace(/\D/g,'').endsWith(serial))continue;
    const buttonText=await page.evaluate(()=>{
      const visible=e=>e.getBoundingClientRect().width>20&&e.getBoundingClientRect().height>12&&!e.disabled;
      const b=[...document.querySelectorAll('button,[role="button"],input[type="submit"]')].find(e=>
        visible(e)&&/^(check status|track|track & trace|search|track shipment|check)$/i.test((e.innerText||e.value||e.getAttribute('aria-label')||'').trim()));
      if(!b)return'';
      const t=(b.innerText||b.value||'').trim();b.click();return t;
    }).catch(()=> '');
    if(!buttonText)await chosen.press('Enter').catch(()=>{});
    await Promise.race([page.waitForNetworkIdle({idleTime:750,timeout:7000}).catch(()=>{}),sleep(7000)]);
    await sleep(850);
    const body=(await snapshot(page)).text;
    if(body.replace(/\D/g,'').includes(serial)&&/shipment\s+(?:details|information|status)|received from flight|booking\s+details|tracking\s+history|\b(?:RCS|RCF|DEP|ARR)\b/i.test(body))
      return{filled:true,value:current,clicked:buttonText,metas};
    if(/captcha|prove you are human|security challenge|verify you are human/i.test(body))
      return{filled:true,blocked:true,reason:'Human verification required',metas};
    // The site can load a details section on the same page without AWB
    // appearing in visible text until the flight-panel lazy load completes.
    break;
  }
  return{filled:true,metas};
}
export async function trackKlm(input){
  const mawb=normalizeMawb(input);
  if(!mawb||!mawb.startsWith('074-'))return{ok:false,reason:'INVALID KLM 074 MAWB',officialTracker:URL};
  let browser;
  const network=[];
  try{
    browser=await launch();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36');
    page.on('response',async res=>{
      try{
        const url=res.url(),type=String(res.headers()['content-type']||'').toLowerCase();
        if(!/afklcargo\.com/i.test(url)||!/json|text|xml/.test(type))return;
        const data=await res.text();
        if(data.length>250000||data.length<10)return;
        if(/awb|airwaybill|shipment|track|milestone|flight/i.test(url+' '+data.slice(0,1500)))
          network.push({url,status:res.status(),body:data.slice(0,120000)});
      }catch{}
    });
    const firstPage=await page.goto(URL,{waitUntil:'domcontentloaded',timeout:26000});
    await page.waitForFunction(()=>/air\s*waybill\s*number|check\s*status|track\s*&\s*trace/i.test(document.body?.innerText||''),{timeout:16000}).catch(()=>{});
    await sleep(1600);
    // The site uses necessary cookies, not an anti-bot bypass.
    await page.evaluate(()=>{
      const b=[...document.querySelectorAll('button')].find(e=>/accept all|accept cookies/i.test(e.innerText||''));
      b?.click();
    }).catch(()=>{});
    const operation=await interact(page,mawb);
    // The actual KLM shipment details open BELOW the Check status form. Read
    // the Flight Details section, not only the search pane above the fold.
    if(operation.filled&&!operation.blocked){
      for(let pass=0;pass<5;pass++){
        await page.evaluate(()=>{
          const x=[...document.querySelectorAll('h1,h2,h3,h4,div,section')]
            .find(el=>/^\s*Flight\s+Details\s*$/i.test(el.textContent||''));
          if(x)x.scrollIntoView({block:'center'});else window.scrollBy(0,850);
        }).catch(()=>{});
        await sleep(750);
        const probe=await snapshot(page);
        if(/Flight\s+Details/i.test(probe.text)&&(/\b(?:KL|AF|MP)\s*\d{2,4}\b/i.test(probe.text)||pass>=3))break;
      }
    }
    const after=await snapshot(page);
    const shipment=parseShipment(after.text,mawb,network,after.tables);
    const debug={stage:shipment?'KLM_TRACKING_PARSED':'KLM_NO_VERIFIED_SHIPMENT',
      pageUrl:page.url(),initialHttpStatus:firstPage?.status()||0,frameUrls:page.frames().map(f=>f.url()),
      operation:{filled:operation.filled,value:operation.value,clicked:operation.clicked,blocked:operation.blocked,reason:operation.reason},
      form:operation.metas,pageText:after.text.slice(0,14000),
      network:network.slice(-14).map(x=>({url:x.url,status:x.status,sample:x.body.slice(0,1600)})),
      parsedEvents:shipment?shipment._parsedEvents:[]};
    if(operation.blocked)return{ok:false,reason:'KLM requires manual human verification',officialTracker:URL,debug};
    if(!shipment)return{ok:false,reason:'KLM official tracking did not return verifiable details for this AWB',officialTracker:URL,debug};
    delete shipment._parsedEvents;
    return{ok:true,shipment,officialTracker:URL,adapter:'KLM public Track & Trace',debug};
  }catch(e){return{ok:false,reason:'KLM official tracking error: '+String(e?.message||e),officialTracker:URL,debug:{stage:'ERROR'}};}
  finally{try{await browser?.close()}catch{}}
}
