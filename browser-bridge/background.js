const TRACK_URL='https://saudiacargo.com/en/digital-services?tab=trackShipment';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function waitForComplete(tabId,timeout=30000){
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(err)=>{if(done)return;done=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);err?reject(err):resolve();};
    const listener=(id,info)=>{if(id===tabId&&info.status==='complete')finish();};
    const timer=setTimeout(()=>finish(new Error('Saudia page load timeout')),timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab=>{if(tab?.status==='complete')finish();}).catch(()=>{});
  });
}
async function runSaudia(mawb){
  let tab;
  try{
    tab=await chrome.tabs.create({url:TRACK_URL,active:false});
    await waitForComplete(tab.id,35000);
    await sleep(1800);
    let result=null;
    for(let attempt=0;attempt<3;attempt++){
      try{result=await chrome.tabs.sendMessage(tab.id,{type:'RUN_SAUDIA_TRACK',mawb,attempt});}catch{}
      if(result?.ok)return result;
      if(attempt<2)await sleep(1800);
    }
    return result||{ok:false,trackingError:'Saudia result could not be read in the normal browser session.',officialTracker:TRACK_URL};
  }catch(error){
    return{ok:false,trackingError:`Saudia browser session failed: ${error?.message||error}`,officialTracker:TRACK_URL};
  }finally{
    if(tab?.id)chrome.tabs.remove(tab.id).catch(()=>{});
  }
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type!=='TRACK_SAUDIA')return;
  runSaudia(message.mawb).then(sendResponse);
  return true;
});
