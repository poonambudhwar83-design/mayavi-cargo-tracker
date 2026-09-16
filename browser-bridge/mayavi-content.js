(()=>{
  const script=document.createElement('script');
  script.src=chrome.runtime.getURL('page-bridge.js');
  script.async=false;
  (document.documentElement||document.head).appendChild(script);
  script.remove();

  const normalize=v=>{const d=String(v||'').replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''};
  window.addEventListener('message',async event=>{
    if(event.source!==window)return;
    const data=event.data||{};
    if(!['MAYAVI_CARGO_PAGE','MAYAVI_SAUDIA_PAGE'].includes(data.source)||data.type!=='TRACK_REQUEST')return;
    const mawb=normalize(data.mawb),prefix=mawb.slice(0,3);
    if(!['065','160'].includes(prefix))return;
    const isCathay=prefix==='160';
    let payload;
    try{
      payload=await chrome.runtime.sendMessage({type:isCathay?'TRACK_CATHAY':'TRACK_SAUDIA',mawb});
    }catch(error){
      payload={ok:false,trackingError:`${isCathay?'Cathay':'Saudia'} browser bridge error: ${error?.message||error}`,officialTracker:isCathay?'https://www.cathaycargo.com/en-us/track-and-trace.html':'https://saudiacargo.com/en/digital-services?tab=trackShipment'};
    }
    const response={type:'TRACK_RESPONSE',requestId:data.requestId,payload};
    window.postMessage({source:'MAYAVI_CARGO_CONTENT',...response},'*');
    if(!isCathay)window.postMessage({source:'MAYAVI_SAUDIA_CONTENT',...response},'*');
  });
})();
