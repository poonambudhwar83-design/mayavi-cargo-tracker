(()=>{
  if(window.__mayaviCargoBridgeInstalled)return;
  window.__mayaviCargoBridgeInstalled=true;
  const originalFetch=window.fetch.bind(window);
  const pending=new Map();
  const normalize=v=>{const d=String(v||'').replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''};

  window.addEventListener('message',event=>{
    if(event.source!==window)return;
    const data=event.data||{};
    if(data.source!=='MAYAVI_CARGO_CONTENT'||data.type!=='TRACK_RESPONSE')return;
    const job=pending.get(data.requestId);if(!job)return;
    pending.delete(data.requestId);clearTimeout(job.timer);
    job.resolve(data.payload||{ok:false,error:'No browser-bridge tracking result returned.'});
  });

  function requestBrowserTrack(mawb,carrier){
    return new Promise(resolve=>{
      const requestId=`${carrier.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout=carrier==='TURKISH'?190000:75000;
      const timer=setTimeout(()=>{
        pending.delete(requestId);
        resolve({
          ok:false,
          trackingError:carrier==='TURKISH'
            ? 'Turkish browser verification timed out. Complete Press & Hold in the Turkish Cargo tab and refresh again.'
            : 'Saudia browser bridge timed out.',
          officialTracker:carrier==='TURKISH'
            ? 'https://www.turkishcargo.com/en/cargo-tracking'
            : 'https://saudiacargo.com/en/digital-services?tab=trackShipment'
        });
      },timeout);
      pending.set(requestId,{resolve,timer});
      window.postMessage({source:'MAYAVI_CARGO_PAGE',type:'TRACK_REQUEST',requestId,mawb,carrier},'*');
    });
  }

  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:(input?.url||'');
    if(!/\/api\/track(?:\?|$)/.test(url))return originalFetch(input,init);
    let body='';
    try{body=init?.body||'';if(!body&&input instanceof Request)body=await input.clone().text();}catch{}
    let mawb='';
    try{
      if(body){
        const j=JSON.parse(String(body));mawb=normalize(j?.mawb||j?.awb||'');
      }else{
        const u=new URL(url,location.href);mawb=normalize(u.searchParams.get('mawb')||u.searchParams.get('awb')||'');
      }
    }catch{}

    let carrier='';
    if(mawb.startsWith('065-'))carrier='SAUDIA';
    else if(mawb.startsWith('235-'))carrier='TURKISH';
    else return originalFetch(input,init);

    const payload=await requestBrowserTrack(mawb,carrier);
    const ok=Boolean(payload?.ok);
    return new Response(JSON.stringify(payload),{status:ok?200:503,headers:{'content-type':'application/json'}});
  };
})();
