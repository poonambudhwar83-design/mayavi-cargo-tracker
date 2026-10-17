// Flydubai FZ/141 dedicated official Cargo -> Track Shipment -> Doc No -> Search -> Tracking Details reader.
// Only trust confirmed shipment detail results; never bypass an airline challenge.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { normalizeMawb } from './airlines.js';

export const FLYDUBAI_TRACKER='https://www.flydubai.com/en/information/cargo/';
const FLYDUBAI_PORTAL='https://prdonofz.accelya.io/app/offerandorder/#/home/find-offer';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digits=s=>String(s||'').replace(/\D/g,'');
const pad=n=>String(n).padStart(2,'0');
const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
function dateOf(v=''){
  let m=String(v).match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(m)return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
  m=String(v).match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if(m)return m[3]+'-'+pad(m[2])+'-'+pad(m[1]);
  m=String(v).toUpperCase().match(/\b(\d{1,2})[\s-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,-]+(20\d{2})\b/);
  return m?m[3]+'-'+MONTHS[m[2]]+'-'+pad(m[1]):'';
}
function timeOf(v=''){
  const s=String(v).toUpperCase();
  let m=s.match(/\b(\d{1,2}):([0-5]\d)\s*([AP]M)\b/);
  if(m){let h=Number(m[1])%12+(m[3]==='PM'?12:0);return pad(h)+':'+m[2];}
  m=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
  return m?pad(m[1])+':'+m[2]:'';
}
function value(s,re){return (String(s).match(re)||[])[1]||'';}
function airport(s){return /^[A-Z]{3}$/.test(String(s||''))?String(s):'';}
function movementRows(rows=[]){
  const movements=[];
  for(const row of rows){
    const r=clean(row),upper=r.toUpperCase();
    const label=value(upper,/\b(ARRIVED|ARR|RCF|RECEIVED FROM FLIGHT|DEPARTED|DEP|OFFLOADED|OFLD|BOOKED|RCS)\b/);
    if(!label)continue;
    const flight=value(upper,/\b(FZ\s*[- ]?\d{2,4}[A-Z]?)\b/).replace(/[\s-]/g,'');
    const airports=[...upper.matchAll(/\b([A-Z]{3})\b/g)].map(x=>x[1]).filter(x=>!['FOW','RCS','DEP','ARR','RCF','AWB','ETA','ETD','ATA','ATD','FZD','PCS','KGS','FRT','FZC','UTC','IST'].includes(x));
    const from=airport(value(upper,/\b(?:FROM|ORIGIN|DEP(?:ARTURE)?(?:\s+STATION)?)\s*[:| -]+\s*([A-Z]{3})\b/));
    const to=airport(value(upper,/\b(?:TO|DESTINATION|ARRIVAL(?:\s+STATION)?|AT)\s*[:| -]+\s*([A-Z]{3})\b/));
    const date=dateOf(r),time=timeOf(r);
    movements.push({label,flight,from,to,airports,date,time,raw:r});
  }
  return movements;
}
export function parseFlydubaiText(text='',rows=[],mawb=''){
  const normalized=normalizeMawb(mawb),all=digits(normalized),serial=all.slice(3);
  if(!normalized.startsWith('141-'))return null;
  const raw=String(text||''),flat=clean(raw),upper=flat.toUpperCase();
  // A pre-filled form or unrelated page must not count as a live response.
  const explicit=new RegExp('(?:^|\\D)141[-\\s]?'+serial+'(?:\\D|$)').test(flat)
    ||new RegExp('(?:AWB|AIR\\s*WAYBILL|SHIPMENT)[\\s:#-]{0,20}'+serial+'\\b','i').test(flat);
  if(!explicit||/\b(?:CAPTCHA|VERIFY YOU ARE HUMAN|ACCESS DENIED|CLOUDFLARE)\b/i.test(flat))return null;
  const origin=airport(value(upper,/\b(?:ORIGIN|FROM\s+STATION|DEPARTURE\s+STATION)\s*[:| -]+\s*([A-Z]{3})\b/))
    ||airport(value(upper,/\b([A-Z]{3})\s*(?:-|->|→)\s*[A-Z]{3}\b/));
  const destination=airport(value(upper,/\b(?:DESTINATION|TO\s+STATION|ARRIVAL\s+STATION)\s*[:| -]+\s*([A-Z]{3})\b/))
    ||airport(value(upper,/\b[A-Z]{3}\s*(?:-|->|→)\s*([A-Z]{3})\b/));
  const pieces=value(flat,/\b(?:TOTAL\s+PIECES|PIECES|PCS|BAGS|NO\.?\s*OF\s*PIECES)\s*[:|#-]?\s*(\d{1,6})\b/i)
    ||value(flat,/\b(\d{1,6})\s*(?:PCS|PIECES|BAGS)\b/i);
  const weight=value(flat,/\b(?:GROSS\s*WEIGHT|TOTAL\s*WEIGHT|WEIGHT)\s*[:|#-]?\s*([\d,]+(?:\.\d+)?)\s*(?:KG|KGS)?\b/i).replace(/,/g,'');
  const movements=movementRows(rows);
  const dated=movements.filter(x=>x.date&&x.time);
  const actualFinal=destination?dated.filter(x=>/^(ARR|ARRIVED|RCF|RECEIVED FROM FLIGHT)$/.test(x.label)&&
    (x.to===destination||new RegExp('(?:\\bAT\\s+|\\|\\s*)'+destination+'\\b').test(x.raw.toUpperCase()))).at(-1):null;
  const expectedRows=dated.filter(x=>x.flight&&/ETA|EXPECTED|SCHEDULED/i.test(x.raw));
  const matchingExpected=expectedRows.filter(x=>!destination||x.to===destination||new RegExp('\\b'+destination+'\\b').test(x.raw)).at(-1);
  // Do not use an intermediate DXB arrival as the destination arrival.
  const departureRows=dated.filter(x=>/^(DEP|DEPARTED)$/.test(x.label));
  const firstDeparture=departureRows.find(x=>!origin||x.from===origin||new RegExp('\\b'+origin+'\\b').test(x.raw))||null;
  const latest=movements.at(-1);
  const offloaded=movements.some(x=>/OFFLOAD|OFLD/.test(x.label));
  const hasMovement=movements.length>0;
  const hasDetails=Boolean((origin&&destination)||pieces||weight||(hasMovement&&movements.some(x=>x.flight)));
  if(!hasDetails)return null;
  const flightNo=actualFinal?.flight||matchingExpected?.flight||dated.filter(x=>x.flight).at(-1)?.flight
    ||value(upper,/\b(FZ\s*[- ]?\d{2,4}[A-Z]?)\b/).replace(/[\s-]/g,'');
  const bookingLabel=raw.match(/(?:BOOKED|BOOKING\s+DATE|RCS|ACCEPTED)[^\n]{0,100}/i)?.[0]||'';
  const status=actualFinal?'ARRIVED':offloaded?'DELAYED':departureRows.length?'IN TRANSIT':hasMovement?'BOOKED':'TRACKING';
  const candidate=actualFinal||matchingExpected;
  return {mawb:normalized,carrierCode:'FZ',airlineName:'flydubai Cargo',
    origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate:dateOf(bookingLabel),
    departureDate:firstDeparture?.date||'',departureTime:firstDeparture?.time||'',
    departureFlightNo:firstDeparture?.flight||'',departureOrigin:origin,
    departureDestination:firstDeparture?.to||'',departureIsActual:Boolean(firstDeparture),
    arrivalDate:candidate?.date||'',arrivalTime:candidate?.time||'',arrivalIsActual:Boolean(actualFinal),
    arrivalTimeZone:'LOCAL',departureTimeZone:'LOCAL',status,
    source:'flydubai official Accelya Tracking Details AWB-matched live result',
    officialTracker:FLYDUBAI_TRACKER,
    flydubaiLiveVerifiedAt:new Date().toISOString(),
    flydubaiEvidence:{matchedMawb:true,movementCount:movements.length,finalArrivalConfirmed:Boolean(actualFinal)}
  };
}
async function pageContents(page){
  const texts=[],rows=[];
  for(const frame of page.frames()){
    try{
      const v=await frame.evaluate(()=>({
        text:document.body?.innerText||'',
        rows:[...document.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(c=>c.innerText?.trim()||'').join(' | ')).filter(Boolean).slice(0,350)
      }));
      if(v.text)texts.push(v.text);
      if(v.rows)rows.push(...v.rows);
    }catch{}
  }
  return{text:texts.join('\n'),rows};
}

function pageHasChallenge(s=''){
  return /verify you are human|captcha|access denied|security challenge|cloudflare|bot protection/i.test(String(s));
}
async function clickText(page,expression){
  for(const frame of page.frames()){
    try{
      const done=await frame.evaluate(pattern=>{
        const rx=new RegExp(pattern,'i');
        const nodes=[...document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"],[role="tab"],[tabindex]')];
        const choice=nodes.find(e=>{
          const label=String(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
          return label.length<100&&rx.test(label)&&!e.disabled;
        });
        if(!choice)return false;
        choice.scrollIntoView({block:'center',inline:'nearest'});
        choice.click();
        return true;
      },expression.source);
      if(done)return true;
    }catch{}
  }
  return false;
}
async function cargoPortal(browser,page){
  // Start at the actual airline Cargo page, as seen by a Mayavi operator.
  await page.goto(FLYDUBAI_TRACKER,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(1100);
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)).catch(()=>{});
  const clicked=await clickText(page,/^track\s+(?:your\s+)?shipment$/i);
  await sleep(1600);
  const pages=await browser.pages();
  const portal=pages.find(p=>/accelya\.io|mercator\.com/.test(p.url()))||
    (pages.length>1?pages.at(-1):page);
  if(!/accelya\.io/.test(portal.url())){
    // When the carrier opens a blocked popup, navigate to its official new
    // Accelya portal (never to a third-party tracker).
    await portal.goto(FLYDUBAI_PORTAL,{waitUntil:'domcontentloaded',timeout:30000});
  }
  await sleep(1600);
  return{page:portal,homepageTrackClicked:clicked};
}
async function fillDocNumber(page,mawb){
  const awb=digits(mawb),serial=awb.slice(3);
  for(const frame of page.frames()){
    try{
      const fields=await frame.$$('input:not([type="hidden"]),textarea');
      const inputs=[];
      for(const el of fields){
        const info=await el.evaluate(e=>{
          const r=e.getBoundingClientRect(),label=String(
            e.labels?.[0]?.innerText||e.closest('label')?.innerText||'');
          return {visible:r.width>5&&r.height>5&&!e.disabled&&!e.readOnly,
            desc:[e.name,e.id,e.placeholder,e.getAttribute('aria-label'),
              e.getAttribute('formcontrolname'),label,
              e.parentElement?.parentElement?.innerText?.slice(0,110)].join(' ').toLowerCase(),
            max:e.maxLength,value:e.value||''};
        }).catch(()=>null);
        if(!info?.visible)continue;
        const score=/doc\s*\.?\s*no|document\s*(number|no)/i.test(info.desc)?30:
          /awb|air\s*waybill/i.test(info.desc)?25:/tracking\s*number|shipment\s*number/i.test(info.desc)?18:
          /document/i.test(info.desc)?12:info.max===11?5:info.max===8?3:0;
        if(score)inputs.push({el,...info,score});
      }
      inputs.sort((a,b)=>b.score-a.score);
      if(!inputs.length)continue;
      const target=inputs[0];
      const prefix=inputs.find(x=>x!==target&&(/prefix|airline code/i.test(x.desc)||x.max===3));
      const value=target.max===8?serial:awb;
      if(prefix){
        await prefix.el.click({clickCount:3});
        await prefix.el.press('Backspace');
        await prefix.el.type('141',{delay:25});
      }
      await target.el.click({clickCount:3});
      await target.el.press('Backspace');
      await target.el.type(value,{delay:25});
      await target.el.press('Tab');
      const entered=await target.el.evaluate(e=>String(e.value||'')).catch(()=>'');
      if(digits(entered)!==value)continue;
      return{ok:true,value,field:target.desc.slice(0,100)};
    }catch{}
  }
  return{ok:false,reason:'FLYDUBAI_DOC_NO_NOT_FOUND'};
}
export async function trackFlydubai(value){
  const mawb=normalizeMawb(value);
  if(!mawb.startsWith('141-'))
    return{ok:false,reason:'FLYDUBAI_PREFIX_MUST_BE_141',officialTracker:FLYDUBAI_TRACKER};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],
      executablePath:await chromium.executablePath(),headless:'shell',defaultViewport:{width:1440,height:1000}});
    const landing=await browser.newPage();
    await landing.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36');
    const {page,homepageTrackClicked}=await cargoPortal(browser,landing);
    if(pageHasChallenge((await pageContents(page)).text))
      return{ok:false,reason:'FLYDUBAI_SITE_REQUIRES_MANUAL_VERIFICATION',
        officialTracker:FLYDUBAI_TRACKER,debug:{stage:'CHALLENGE'}};
    await clickText(page,/^search\s*(?:&|and)\s*track$/i);
    await sleep(700);
    const doc=await fillDocNumber(page,mawb);
    if(!doc.ok)return{ok:false,reason:doc.reason,officialTracker:FLYDUBAI_TRACKER,
      debug:{stage:'DOC_NO_NOT_FOUND',homepageTrackClicked}};
    const searched=await clickText(page,/^search$/i);
    if(!searched){
      // Some versions of Search & Track submit the Doc No on Enter.
      for(const frame of page.frames()){
        const input=await frame.$('input');
        if(input){await input.press('Enter').catch(()=>{});break;}
      }
    }
    let detailsClicked=false;
    for(let i=0;i<10;i++){
      await sleep(i===0?1600:950);
      const snapshot=await pageContents(page);
      if(pageHasChallenge(snapshot.text))
        return{ok:false,reason:'FLYDUBAI_SITE_REQUIRES_MANUAL_VERIFICATION',
          officialTracker:FLYDUBAI_TRACKER,debug:{stage:'CHALLENGE'}};
      if(/no\s+(?:records?|shipments?|results?)|document\s+not\s+found|invalid\s+document/i.test(snapshot.text))
        return{ok:false,reason:'FLYDUBAI_AWB_NOT_FOUND',officialTracker:FLYDUBAI_TRACKER,
          debug:{stage:'SEARCH_NO_RESULTS'}};
      if(await clickText(page,/^tracking\s+details$/i)){detailsClicked=true;break;}
    }
    if(!detailsClicked)
      return{ok:false,reason:'FLYDUBAI_TRACKING_DETAILS_NOT_OPEN',
        officialTracker:FLYDUBAI_TRACKER,debug:{stage:'DETAILS_NOT_OPEN',homepageTrackClicked}};
    for(let i=0;i<10;i++){
      await sleep(i===0?1500:700);
      const result=await pageContents(page);
      if(pageHasChallenge(result.text))
        return{ok:false,reason:'FLYDUBAI_SITE_REQUIRES_MANUAL_VERIFICATION',
          officialTracker:FLYDUBAI_TRACKER,debug:{stage:'CHALLENGE'}};
      const shipment=parseFlydubaiText(result.text,result.rows,mawb);
      if(shipment){
        return{ok:true,shipment,officialTracker:FLYDUBAI_TRACKER,
          debug:{stage:'TRACKING_DETAILS_VERIFIED',homepageTrackClicked,
            docNoEntered:doc.value,movementCount:shipment.flydubaiEvidence.movementCount}};
      }
    }
    return{ok:false,reason:'FLYDUBAI_NO_VERIFIED_AWB_DETAILS',
      officialTracker:FLYDUBAI_TRACKER,debug:{stage:'NO_VERIFIED_DETAILS'}};
  }catch(err){
    return{ok:false,reason:'FLYDUBAI_TRACKING_FAILED: '+String(err?.message||err).slice(0,180),
      officialTracker:FLYDUBAI_TRACKER,debug:{stage:'OFFICIAL_UNAVAILABLE'}};
  }finally{if(browser)await browser.close().catch(()=>{});}
}
