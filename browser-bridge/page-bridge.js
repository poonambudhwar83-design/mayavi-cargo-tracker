(()=>{
  if(window.__mayaviSaudiaBridgeInstalled)return;
  window.__mayaviSaudiaBridgeInstalled=true;
  const originalFetch=window.fetch.bind(window);
  const pending=new Map();
  const normalize=v=>{const d=String(v||'').replace(/\D/g,'');return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''};
  window.addEventListener('message',event=>{
    if(event.source!==window)return;
    const data=event.data||{};
    if(data.source!=='MAYAVI_SAUDIA_CONTENT'||data.type!=='TRACK_RESPONSE')return;
    const job=pending.get(data.requestId);if(!job)return;
    pending.delete(data.requestId);clearTimeout(job.timer);job.resolve(data.payload||{ok:false,error:'No Saudia result returned.'});
  });
  function requestSaudia(mawb){
    return new Promise(resolve=>{
      const requestId=`sv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer=setTimeout(()=>{pending.delete(requestId);resolve({ok:false,trackingError:'Saudia browser bridge timed out.',officialTracker:'https://saudiacargo.com/en/digital-services?tab=trackShipment'});},75000);
      pending.set(requestId,{resolve,timer});
      window.postMessage({source:'MAYAVI_SAUDIA_PAGE',type:'TRACK_REQUEST',requestId,mawb},'*');
    });
  }
  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:(input?.url||'');
    if(!/\/api\/track(?:\?|$)/.test(url))return originalFetch(input,init);
    let body='';
    try{body=init?.body||'';if(!body&&input instanceof Request)body=await input.clone().text();}catch{}
    let mawb='';
    try{if(body){const j=JSON.parse(String(body));mawb=normalize(j?.mawb||j?.awb||'');}else{const u=new URL(url,location.href);mawb=normalize(u.searchParams.get('mawb')||u.searchParams.get('awb')||'');}}catch{}
    if(!mawb.startsWith('065-'))return originalFetch(input,init);
    const payload=await requestSaudia(mawb);
    const ok=Boolean(payload?.ok);
    return new Response(JSON.stringify(payload),{status:ok?200:503,headers:{'content-type':'application/json'}});
  };
})();
