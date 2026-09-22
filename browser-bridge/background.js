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
  let completed=false;
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

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==='TRACK_SAUDIA'){
    runSaudia(message.mawb).then(sendResponse);
    return true;
  }
  if(message?.type==='TRACK_TURKISH'){
    runTurkish(message.mawb,sender?.tab?.id).then(sendResponse);
    return true;
  }
});
