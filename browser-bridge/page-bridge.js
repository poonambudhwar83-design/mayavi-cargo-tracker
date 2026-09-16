(()=>{
  if(window.__mayaviCargoBridgeInstalled)return;
  window.__mayaviCargoBridgeInstalled=true;
  const originalFetch=window.fetch.bind(window);
  const pending=new Map();
  const normalize=v=>{const d=String(v||'').replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''};

  window.addEventListener('message',event=>{
    if(event.source!==window)return;
    const data=event.data||{};
    if(!['MAYAVI_CARGO_CONTENT','MAYAVI_SAUDIA_CONTENT'].includes(data.source)||data.type!=='TRACK_RESPONSE')return;
    const job=pending.get(data.requestId);if(!job)return;
    pending.delete(data.requestId);clearTimeout(job.timer);job.resolve(data.payload||{ok:false,error:'No browser bridge result returned.'});
  });

  function requestLocal(mawb){
    return new Promise(resolve=>{
      const prefix=mawb.slice(0,3),requestId=`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const name=prefix==='160'?'Cathay':'Saudia';
      const tracker=prefix==='160'?'https://www.cathaycargo.com/en-us/track-and-trace.html':'https://saudiacargo.com/en/digital-services?tab=trackShipment';
      const timer=setTimeout(()=>{pending.delete(requestId);resolve({ok:false,trackingError:`${name} browser bridge timed out.`,officialTracker:tracker});},85000);
      pending.set(requestId,{resolve,timer});
      window.postMessage({source:'MAYAVI_CARGO_PAGE',type:'TRACK_REQUEST',requestId,mawb,carrier:prefix==='160'?'CX':'SV'},'*');
    });
  }

  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:(input?.url||'');
    if(!/\/api\/track(?:\?|$)/.test(url))return originalFetch(input,init);
    let body='';
    try{body=init?.body||'';if(!body&&input instanceof Request)body=await input.clone().text();}catch{}
    let mawb='';
    try{
      if(body){const j=JSON.parse(String(body));mawb=normalize(j?.mawb||j?.awb||'');}
      else{const u=new URL(url,location.href);mawb=normalize(u.searchParams.get('mawb')||u.searchParams.get('awb')||'');}
    }catch{}
    const prefix=mawb.slice(0,3);
    if(!['065','160'].includes(prefix))return originalFetch(input,init);

    const payload=await requestLocal(mawb);
    if(payload?.ok)return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
    if(prefix==='160')return originalFetch(input,init);
    return new Response(JSON.stringify(payload),{status:503,headers:{'content-type':'application/json'}});
  };
})();
