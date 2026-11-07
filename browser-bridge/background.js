const SAUDIA_TRACK_URL='https://saudiacargo.com/en/digital-services?tab=trackShipment';
const TURKISH_TRACK_URL='https://www.turkishcargo.com/en/cargo-tracking';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function waitForComplete(tabId,timeout=30000){
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(err)=>{if(done)return;done=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);err?reject(err):resolve();};
    const listener=(id,info)=>{if(id===tabId&&info.status==='complete')finish();};
    const timer=setTimeout(()=>finish(new Error('Cargo page load timeout')),timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab=>{if(tab?.status==='complete')finish();}).catch(()=>{});
  });
}

async function runSaudia(mawb){
  let tab;
  try{
    tab=await chrome.tabs.create({url:SAUDIA_TRACK_URL,active:false});
    await waitForComplete(tab.id,35000);
    await sleep(1800);
    let result=null;
    for(let attempt=0;attempt<3;attempt++){
      try{result=await chrome.tabs.sendMessage(tab.id,{type:'RUN_SAUDIA_TRACK',mawb,attempt});}catch{}
      if(result?.ok)return result;
      if(attempt<2)await sleep(1800);
    }
    return result||{ok:false,trackingError:'Saudia result could not be read in the normal browser session.',officialTracker:SAUDIA_TRACK_URL};
  }catch(error){
    return{ok:false,trackingError:`Saudia browser session failed: ${error?.message||error}`,officialTracker:SAUDIA_TRACK_URL};
  }finally{
    if(tab?.id)chrome.tabs.remove(tab.id).catch(()=>{});
  }
}

async function runTurkish(mawb,returnTabId){
  const digits=String(mawb||'').replace(/\D/g,'');
  if(digits.length!==11||!digits.startsWith('235'))return{ok:false,trackingError:'Invalid Turkish Cargo 235 MAWB.',officialTracker:TURKISH_TRACK_URL};
  const serial=digits.slice(3);
  const url=`${TURKISH_TRACK_URL}?awbPrefix=235&awbNumber=${encodeURIComponent(serial)}`;
  let tab;
  let completed=false;
  try{
    // Turkish may require a human Press & Hold check. Open an ACTIVE normal Chrome tab
    // so the user can complete that check personally; the extension never clicks it.
    tab=await chrome.tabs.create({url,active:true});
    await waitForComplete(tab.id,35000);
    await sleep(1200);
    let result=null;
    for(let attempt=0;attempt<3;attempt++){
      try{
        result=await chrome.tabs.sendMessage(tab.id,{type:'RUN_TURKISH_TRACK',mawb,attempt});
      }catch(error){
        result={ok:false,trackingError:error?.message||String(error),officialTracker:url};
      }
      if(result?.ok){completed=true;return result;}
      if(result?.humanVerificationRequired){
        // Content script stays in the tab and waits for the user to finish verification.
        return result;
      }
      if(attempt<2)await sleep(1500);
    }
    return result||{ok:false,trackingError:'Turkish Cargo result could not be read in the normal browser session.',officialTracker:url};
  }catch(error){
    return{ok:false,trackingError:`Turkish browser session failed: ${error?.message||error}`,officialTracker:url};
  }finally{
    if(tab?.id&&completed){
      try{
        if(returnTabId)await chrome.tabs.update(returnTabId,{active:true});
        await chrome.tabs.remove(tab.id);
      }catch{}
    }
  }
}

// Gulf Air 072: use normal Chrome's ParcelsApp session, not a Vercel headless
// datacenter browser. Do not manipulate CAPTCHA/human-verification controls.
async function runGulf(mawb,returnTabId){
  const tracking=String(mawb||'').replace(/\\D/g,'');
  if(!/^072\\d{8}$/.test(tracking))
    return{ok:false,trackingError:'Invalid Gulf Air 072 MAWB.'};
  let tab,created=false;
  const resultUrl='https://parcelsapp.com/en/tracking/'+tracking;
  try{
    const existing=await chrome.tabs.query({url:['https://parcelsapp.com/en/tracking/*',
      'https://www.parcelsapp.com/en/tracking/*']});
    tab=existing.find(t=>t.url?.includes('/tracking/'+tracking));
    if(!tab){
      tab=await chrome.tabs.create({url:'https://parcelsapp.com/',active:false});
      created=true;
      await waitForComplete(tab.id,35000);
      await sleep(1100);
      const submission=await chrome.tabs.sendMessage(tab.id,{type:'GULF_SUBMIT',mawb:tracking});
      if(!submission?.ok)
        return{ok:false,trackingError:submission?.reason||'ParcelsApp form submission failed',officialTracker:resultUrl};
      // Full 11-digit submission navigates to /en/tracking/<AWB>.
      await sleep(1200);
      await waitForComplete(tab.id,35000).catch(()=>{});
    }
    await sleep(1400);
    let dom=null,reason='';
    for(let attempt=0;attempt<4;attempt++){
      const current=await chrome.tabs.query({url:['https://parcelsapp.com/en/tracking/*',
        'https://www.parcelsapp.com/en/tracking/*']});
      const target=current.find(t=>t.url?.includes('/tracking/'+tracking));
      if(target)tab=target;
      try{
        const response=await chrome.tabs.sendMessage(tab.id,{type:'GULF_READ',mawb:tracking});
        if(response?.ok){dom=response.dom;break;}
        reason=response?.reason||'No AWB-verified history in Chrome';
      }catch(error){reason=String(error?.message||error);}
      await sleep(1700);
    }
    if(!dom)return{ok:false,trackingError:reason||'ParcelsApp result did not load',officialTracker:resultUrl};
    const response=await fetch('https://tracker.mayavicargo.com/api/gulf-parse',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({mawb:tracking,dom}),
      signal:AbortSignal.timeout(35000)
    });
    const parsed=await response.json().catch(()=>({ok:false,trackingError:'Gulf browser result parse failed'}));
    if(!parsed?.ok)return{ok:false,trackingError:parsed.trackingError||parsed.error||
      'ParcelsApp Gulf Air results could not be verified',officialTracker:resultUrl};
    return parsed;
  }catch(error){
    return{ok:false,trackingError:'Gulf Air Chrome session: '+String(error?.message||error),
      officialTracker:resultUrl};
  }finally{
    if(created&&tab?.id)chrome.tabs.remove(tab.id).catch(()=>{});
    if(returnTabId)chrome.tabs.update(returnTabId,{active:true}).catch(()=>{});
  }
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==='TRACK_SAUDIA'){
    runSaudia(message.mawb).then(sendResponse);
    return true;
  }
  if(message?.type==='TRACK_TURKISH'){
    runTurkish(message.mawb,sender?.tab?.id).then(sendResponse);
    return true;
  }
  if(message?.type==='TRACK_GULF'){
    runGulf(message.mawb,sender?.tab?.id).then(sendResponse);
    return true;
  }
});
