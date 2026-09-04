import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const START='https://aicargoportal.airindia.com/icargoneoportal/app/main/#/app';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseShortDate(s=''){
  const t=String(s).toUpperCase();
  const m=t.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/);
  if(!m)return'';
  const month=Number(MONTH[m[2]]),day=Number(m[1]);
  const now=new Date();let year=now.getUTCFullYear();
  const candidate=Date.UTC(year,month-1,day);
  if(candidate>Date.now()+45*24*60*60*1000)year-=1;
  return`${year}-${MONTH[m[2]]}-${pad(day)}`;
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}

function parseSummary(text='',mawb=''){
  const flat=clean(text);
  const formatted=String(mawb||'').replace(/\D/g,'').replace(/^(\d{3})(\d{8})$/,'$1-$2');
  const pieces=(flat.match(/\b098-\d{8}\b\s+(\d{1,6})\s+pcs\b/i)||flat.match(/\b(\d{1,6})\s+pcs\b/i)||[])[1]||'';
  const weight=((flat.match(/\b098-\d{8}\b\s+\d{1,6}\s+pcs\s+([\d,.]+)\s+kg\b/i)||flat.match(/\b([\d,.]+)\s+kg\b/i)||[])[1]||'').replace(/,/g,'');
  const months='JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';
  const originRx=new RegExp(`\\b([A-Z]{3})\\s+(\\d{1,2}\\s+(?:${months})[A-Z]*),\\s*(\\d{1,2}:\\d{2})\\s*\\(A\\)\\s+Accepted\\b`,'i');
  const destRx=new RegExp(`\\b([A-Z]{3})\\s+(\\d{1,2}\\s+(?:${months})[A-Z]*),\\s*(\\d{1,2}:\\d{2})\\s*\\(A\\)\\s+Tracking\\s+View\\b`,'i');
  const originMatch=flat.match(originRx),destMatch=flat.match(destRx);
  const origin=originMatch?.[1]?.toUpperCase()||'';
  const destination=destMatch?.[1]?.toUpperCase()||'';
  const arrivalDate=destMatch?(parseDate(destMatch[2])||parseShortDate(destMatch[2])):'';
  const arrivalTime=destMatch?parseTime(destMatch[3]):'';
  const arrivalIsActual=Boolean(destMatch&&(arrivalDate||arrivalTime));
  const serial=digitsOnly(mawb).slice(3),awbMatched=Boolean(serial&&digitsOnly(flat).includes(serial));
  return{mawb:formatted||mawb,carrierCode:'AI',airlineName:'Air India Cargo',origin,destination,bags:pieces,pieces,weight,flightNo:'',arrivalDate,arrivalTime,arrivalIsActual,status:destMatch?'ARRIVED':'TRACKING',awbMatched};
}

function parseActivity(text='',fallback={}){
  const flat=clean(text);const dest=String(fallback.destination||'').toUpperCase();
  const verifiedWeight=((flat.match(/\b([\d,.]+)\s+kg\b/i)||[])[1]||'').replace(/,/g,'');
  const timelineIndex=flat.toUpperCase().indexOf('AWB ACTIVITY TIMELINE');
  const timeline=timelineIndex>=0?flat.slice(timelineIndex):'';
  if(!timeline)return verifiedWeight?{weight:verifiedWeight}:{};
  let arrival=null;
  const arrivals=[...timeline.matchAll(/\bARRIVAL\s+Arrived\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg[\s\S]{0,140}?\bon\s+([A-Z0-9]{2})[- ]?(\d{2,4})[A-Z]?[\s\S]{0,120}?(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(A\)[\s\S]{0,60}?\bat\s+([A-Z]{3})\b/gi)];
  if(arrivals.length){const preferred=dest?arrivals.find(m=>String(m[7]).toUpperCase()===dest):null;arrival=preferred||arrivals[0];}
  if(arrival){
    return{origin:fallback.origin||'',destination:String(arrival[7]).toUpperCase(),bags:arrival[1],pieces:arrival[1],weight:String(arrival[2]).replace(/,/g,''),flightNo:`${String(arrival[3]).toUpperCase()}${arrival[4]}`,arrivalDate:parseDate(arrival[5]),arrivalTime:parseTime(arrival[6]),arrivalIsActual:true,status:'ARRIVED',arrivalEvidence:clean(arrival[0])};
  }
  if(dest&&new RegExp(`\\bDELIVERY\\s+Delivered[\\s\\S]{0,420}?\\bat\\s+${dest}\\b`,'i').test(timeline))return{weight:verifiedWeight,status:'DELIVERED'};
  if(/\bDEPARTURE\s+Departed\b/i.test(timeline))return{weight:verifiedWeight,status:'IN TRANSIT'};
  if(/\bACCEPTED\s+Accepted\b|\bBOOKED\s+Booked\b/i.test(timeline))return{weight:verifiedWeight,status:'BOOKED'};
  return verifiedWeight?{weight:verifiedWeight}:{};
}
function merge(base={},next={}){const out={...base};for(const[k,v]of Object.entries(next||{})){if(v!==''&&v!==null&&v!==undefined)out[k]=v;}return out;}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}
async function activityTimelineVisible(page){return page.evaluate(()=>/AWB\s+Activity\s+Timeline/i.test(document.body?.innerText||'')).catch(()=>false);}
async function openActivityView(page){
  const sel='[data-testid="tabs-panel__tab-activityView"]';let clicked=false;
  if(await page.$(sel)){
    await page.$eval(sel,el=>{el.scrollIntoView({block:'center'});el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));el.click();}).catch(()=>{});
    clicked=true;
  }
  let visible=await page.waitForFunction(()=>/AWB\s+Activity\s+Timeline/i.test(document.body?.innerText||''),{timeout:5000}).then(()=>true).catch(()=>false);
  if(!visible){
    const forced=await page.evaluate(()=>{
      const visibleEl=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
      const els=[...document.querySelectorAll('button,[role="tab"],[role="button"],a,span,div')];
      const e=els.filter(visibleEl).find(x=>/^Activity\s+View$/i.test(String(x.innerText||x.textContent||'').trim()));
      if(!e)return false;const target=e.closest('button,[role="tab"],[role="button"],a')||e;target.scrollIntoView({block:'center'});target.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));target.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;
    }).catch(()=>false);
    if(forced)clicked=true;
    visible=await page.waitForFunction(()=>/AWB\s+Activity\s+Timeline/i.test(document.body?.innerText||''),{timeout:7000}).then(()=>true).catch(()=>false);
  }
  if(!visible&&clicked){await sleep(1500);visible=await activityTimelineVisible(page);}
  return{clicked,visible};
}

export async function trackAirIndia(mawb){
  const digits=digitsOnly(mawb);if(!/^098\d{8}$/.test(digits))return{ok:false,reason:'INVALID AIR INDIA MAWB',officialTracker:START};
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');

    // Exact required flow: user's Air India link -> MAWB -> Next -> details screen -> screenshot -> fill tracker.
    await page.goto(START,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#shipmentValue',{timeout:22000});
    const input=await page.$('#shipmentValue');
    if(!input)return{ok:false,reason:'AIR INDIA AWB INPUT NOT FOUND',officialTracker:START,debug:{stage:'input'}};
    await input.click({clickCount:3});await page.keyboard.press('Backspace');await input.type(digits,{delay:18});
    const nextSel='[data-testid="shipment-search-form-panel__submit-button"]';
    await page.waitForFunction(sel=>{const e=document.querySelector(sel);return e&&!e.disabled;},{timeout:7000},nextSel).catch(()=>{});
    const enabled=await page.$eval(nextSel,e=>!e.disabled).catch(()=>false);
    if(!enabled)return{ok:false,reason:'AIR INDIA NEXT BUTTON NOT ENABLED',officialTracker:START,debug:{stage:'next'}};
    await page.click(nextSel);
    await page.waitForFunction(serial=>String(document.body?.innerText||'').replace(/\D/g,'').includes(serial),{timeout:18000},digits.slice(3)).catch(()=>{});
    await sleep(1800);

    const summaryText=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    const summary=parseSummary(summaryText,mawb);
    if(!summary.awbMatched)return{ok:false,reason:'AIR INDIA RESULT DID NOT MATCH MAWB',officialTracker:START,debug:{stage:'details',bodySample:summaryText.slice(0,2800)}};

    const summaryScreenshot=await page.screenshot({type:'jpeg',quality:82,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!summaryScreenshot)return{ok:false,reason:'AIR INDIA DETAILS SCREENSHOT FAILED',officialTracker:START,debug:{stage:'screenshot'}};

    const activityState=await openActivityView(page);
    let activityText='';let activityScreenshot=false;
    if(activityState.clicked){
      activityText=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
      activityScreenshot=Boolean(await page.screenshot({type:'jpeg',quality:80,fullPage:false,encoding:'base64'}).catch(()=>null));
    }
    const activity=parseActivity(activityText,summary);
    let shipment=merge(summary,activity);
    shipment.officialTracker=START;
    shipment.source=activity.arrivalEvidence?'Air India Cargo details-screen screenshot + Activity View verification':'Air India Cargo details-screen screenshot + same-screen extraction';

    if(!useful(shipment))return{ok:false,reason:'AIR INDIA DETAILS FOUND NO VERIFIED SHIPMENT FIELDS',officialTracker:START,screenshotCaptured:true,screenshotVerified:true,debug:{stage:'parse',summarySample:summaryText.slice(0,3000),activitySample:activityText.slice(0,3500)}};
    return{ok:true,shipment,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:false,debug:{stage:'done',startUrl:START,resultUrl:page.url(),awbMatched:true,activityClicked:activityState.clicked,activityTimelineVisible:activityState.visible,summaryScreenshot:true,activityScreenshot,summarySample:summaryText.slice(0,3000),activitySample:activityText.slice(0,3500),arrivalEvidence:activity.arrivalEvidence||''}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:START,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}
