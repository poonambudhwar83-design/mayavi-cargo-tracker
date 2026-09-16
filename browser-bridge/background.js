const SAUDIA_TRACK_URL='https://saudiacargo.com/en/digital-services?tab=trackShipment';
const CATHAY_TRACK_URL='https://www.cathaycargo.com/en-us/track-and-trace.html';
const CATHAY_TERMINAL='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function waitForComplete(tabId,timeout=35000){
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=err=>{if(done)return;done=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);err?reject(err):resolve();};
    const listener=(id,info)=>{if(id===tabId&&info.status==='complete')finish();};
    const timer=setTimeout(()=>finish(new Error('Official tracking page load timeout')),timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab=>{if(tab?.status==='complete')finish();}).catch(()=>{});
  });
}

function stripHtml(html=''){
  return String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
}
function parseDateTime(value=''){
  const m=String(value).toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return{date:'',time:''};
  return{date:`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`,time:m[4]?`${pad(m[4])}:${m[5]}`:''};
}
function parseCathayTerminal(html='',mawb=''){
  const text=stripHtml(html),digits=String(mawb).replace(/\D/g,''),serial=digits.slice(3);
  if((!text.includes(digits)&&!text.includes(serial))||/Reject Reason|is not found|no record/i.test(text))return null;
  const route=text.match(/AWB Type\s+(?:Import|Export)\s+([A-Z]{3})\s+([A-Z]{3})/i)||text.match(/Origin\s+Destination\s+([A-Z]{3})\s+([A-Z]{3})/i);
  const rcs=text.match(/Received from Shipper[\s\S]{0,1200}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2}\s+\d{1,2}:\d{2})\s+(\d{1,6})\s+([\d,.]+)/i);
  const dep=text.match(/Departure Flight[\s\S]{0,1800}?\b(CX\s*\d{2,4})\b\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(STD\)[\s\S]{0,240}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(ATD\)/i);
  const imp=text.match(/Received from Flight[\s\S]{0,1600}?\b(CX\s*\d{2,4})\b\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})[\s\S]{0,220}?(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+(\d{1,2}:\d{2})/i);
  const booking=rcs?parseDateTime(rcs[1]):{date:'',time:''};
  const atd=dep?parseDateTime(`${dep[4]} ${dep[5]}`):{date:'',time:''};
  const arrived=imp?parseDateTime(`${imp[3]} ${imp[4]}`):{date:'',time:''};
  const pieces=rcs?.[2]||'',weight=(rcs?.[3]||'').replace(/,/g,'');
  return{
    mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin:route?.[1]||'',destination:route?.[2]||'',
    bags:pieces,pieces,weight,bookingDate:booking.date,flightNo:(dep?.[1]||imp?.[1]||'').replace(/\s+/g,'').toUpperCase(),
    departureDate:atd.date,departureTime:atd.time,arrivalDate:arrived.date,arrivalTime:arrived.time,
    arrivalIsActual:Boolean(arrived.date&&arrived.time),status:arrived.date?'ARRIVED':dep?'IN TRANSIT':rcs?'BOOKED':'TRACKING',
    officialTracker:CATHAY_TRACK_URL,source:'Cathay Cargo Terminal fallback'
  };
}
async function cathayTerminalFallback(mawb){
  const suffix=String(mawb).replace(/\D/g,'').slice(3);
  const urls=[`${CATHAY_TERMINAL}/AWBPrefix/160/AWBSuffix/${suffix}`,`${CATHAY_TERMINAL}?AWBPrefix=160&AWBSuffix=${suffix}`];
  for(const url of urls){
    try{const r=await fetch(url,{cache:'no-store',redirect:'follow'});if(!r.ok)continue;const shipment=parseCathayTerminal(await r.text(),mawb);if(shipment)return shipment;}catch{}
  }
  return null;
}
function mergeShipment(base={},live={}){
  const out={...base};
  for(const [k,v] of Object.entries(live||{}))if(v!==''&&v!==null&&v!==undefined)out[k]=v;
  return out;
}

async function runSaudia(mawb){
  let tab;
  try{
    tab=await chrome.tabs.create({url:SAUDIA_TRACK_URL,active:false});
    await waitForComplete(tab.id,35000);await sleep(1800);
    let result=null;
    for(let attempt=0;attempt<3;attempt++){
      try{result=await chrome.tabs.sendMessage(tab.id,{type:'RUN_SAUDIA_TRACK',mawb,attempt});}catch{}
      if(result?.ok)return result;
      if(attempt<2)await sleep(1800);
    }
    return result||{ok:false,trackingError:'Saudia result could not be read in the normal browser session.',officialTracker:SAUDIA_TRACK_URL};
  }catch(error){
    return{ok:false,trackingError:`Saudia browser session failed: ${error?.message||error}`,officialTracker:SAUDIA_TRACK_URL};
  }finally{if(tab?.id)chrome.tabs.remove(tab.id).catch(()=>{});}
}

async function runCathay(mawb){
  let tab;const fallbackPromise=cathayTerminalFallback(mawb);
  try{
    tab=await chrome.tabs.create({url:CATHAY_TRACK_URL,active:false});
    await waitForComplete(tab.id,35000);await sleep(1800);
    let result=null;
    for(let attempt=0;attempt<3;attempt++){
      try{result=await chrome.tabs.sendMessage(tab.id,{type:'RUN_CATHAY_TRACK',mawb,attempt});}catch{}
      if(result?.ok)break;
      if(attempt<2)await sleep(1800);
    }
    const fallback=await fallbackPromise;
    if(result?.ok){
      result.shipment=mergeShipment(fallback||{},result.shipment||{});
      result.provider='Cathay Cargo official Track & Trace via local browser';
      return result;
    }
    if(fallback)return{ok:true,provider:'Cathay Cargo Terminal official tracking',shipment:fallback,bridgeFallback:true,trackingError:result?.trackingError||''};
    return result||{ok:false,trackingError:'Cathay result could not be read in the normal browser session.',officialTracker:CATHAY_TRACK_URL};
  }catch(error){
    const fallback=await fallbackPromise.catch(()=>null);
    if(fallback)return{ok:true,provider:'Cathay Cargo Terminal official tracking',shipment:fallback,bridgeFallback:true,trackingError:`Cathay browser session failed: ${error?.message||error}`};
    return{ok:false,trackingError:`Cathay browser session failed: ${error?.message||error}`,officialTracker:CATHAY_TRACK_URL};
  }finally{if(tab?.id)chrome.tabs.remove(tab.id).catch(()=>{});}
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==='TRACK_SAUDIA'){runSaudia(message.mawb).then(sendResponse);return true;}
  if(message?.type==='TRACK_CATHAY'){runCathay(message.mawb).then(sendResponse);return true;}
});
