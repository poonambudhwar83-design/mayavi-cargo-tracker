(()=>{
  const script=document.createElement('script');
  script.src=chrome.runtime.getURL('page-bridge.js');
  script.async=false;
  (document.documentElement||document.head).appendChild(script);
  script.remove();

  window.addEventListener('message',async event=>{
    if(event.source!==window)return;
    const data=event.data||{};
    if(data.source!=='MAYAVI_CARGO_PAGE'||data.type!=='TRACK_REQUEST')return;
    const carrier=String(data.carrier||'').toUpperCase();
    const type=carrier==='TURKISH'?'TRACK_TURKISH':'TRACK_SAUDIA';
    let payload;
    try{
      payload=await chrome.runtime.sendMessage({type,mawb:data.mawb});
    }catch(error){
      payload={
        ok:false,
        trackingError:`${carrier==='TURKISH'?'Turkish':'Saudia'} browser bridge error: ${error?.message||error}`,
        officialTracker:carrier==='TURKISH'
          ?'https://www.turkishcargo.com/en/cargo-tracking'
          :'https://saudiacargo.com/en/digital-services?tab=trackShipment'
      };
    }
    window.postMessage({source:'MAYAVI_CARGO_CONTENT',type:'TRACK_RESPONSE',requestId:data.requestId,payload},'*');
  });
})();
