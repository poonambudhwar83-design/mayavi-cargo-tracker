(()=>{
  const script=document.createElement('script');
  script.src=chrome.runtime.getURL('page-bridge.js');
  script.async=false;
  (document.documentElement||document.head).appendChild(script);
  script.remove();

  window.addEventListener('message',async event=>{
    if(event.source!==window)return;
    const data=event.data||{};
    if(data.source!=='MAYAVI_SAUDIA_PAGE'||data.type!=='TRACK_REQUEST')return;
    let payload;
    try{
      payload=await chrome.runtime.sendMessage({type:'TRACK_SAUDIA',mawb:data.mawb});
    }catch(error){
      payload={ok:false,trackingError:`Saudia browser bridge error: ${error?.message||error}`,officialTracker:'https://saudiacargo.com/en/digital-services?tab=trackShipment'};
    }
    window.postMessage({source:'MAYAVI_SAUDIA_CONTENT',type:'TRACK_RESPONSE',requestId:data.requestId,payload},'*');
  });
})();
