// Normal Chrome (not headless/server): ParcelsApp Gulf Air 072 tracking.
// This content script never performs human-verification actions.
(()=>{
  if(window.__mayaviGulfParcelsBridge)return;
  window.__mayaviGulfParcelsBridge=true;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const digits=s=>String(s||'').replace(/\D/g,'');
  const matchesAwb=(text,awb)=>new RegExp('(?:^|\\D)'+awb+'(?:\\D|$)').test(text);
  const visible=el=>{
    if(!el)return false;
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';
  };
  const getText=el=>(el?.innerText||el?.textContent||'').trim();
  const bestText=selectors=>{
    const samples=selectors.flatMap(sel=>[...document.querySelectorAll(sel)])
      .filter(visible).map(getText).filter(x=>x.length>25);
    return samples.sort((a,b)=>b.length-a.length)[0]||'';
  };
  async function submit(mawb){
    const tracking=digits(mawb);
    if(!/^072\d{8}$/.test(tracking))return{ok:false,reason:'Invalid Gulf Air AWB'};
    const input=['input[name="tracking_id"]','input[placeholder="Enter tracking number"]',
      'input[aria-label="Enter tracking number"]']
      .map(sel=>document.querySelector(sel)).find(visible);
    if(!input)return{ok:false,reason:'ParcelsApp tracking-number input missing'};
    input.focus();
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(setter)setter.call(input,'');else input.value='';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    if(setter)setter.call(input,tracking);else input.value=tracking;
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:tracking}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    if(String(input.value)!==tracking)return{ok:false,reason:'ParcelsApp requires exactly 11 digits (no hyphen)'};
    const buttons=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(visible);
    const button=buttons.find(el=>/track\s*package/i.test(getText(el)||el.value||''))||
      buttons.find(el=>/track\s*(?:cargo|package)|^track$/i.test(getText(el)||el.value||''));
    if(!button)return{ok:false,reason:'ParcelsApp Track Package button missing'};
    // Reply before the click navigates away and destroys this content-script frame.
    window.setTimeout(()=>button.click(),25);
    return{ok:true,submittedDigits:tracking,button:'TRACK PACKAGE'};
  }
  async function read(mawb){
    const tracking=digits(mawb);
    if(!/^072\d{8}$/.test(tracking))return{ok:false,reason:'Invalid Gulf Air AWB'};
    const seen=new Set(),allText=new Set();
    let stable=0,lastCount=-1;
    for(let step=0;step<25;step++){
      const body=getText(document.body);
      if(body&&body.includes(tracking))allText.add(body);
      const items=[...document.querySelectorAll(
        'li,tr,[class*="event"],[class*="Event"],[class*="history"] [class*="item"],[class*="timeline"] [class*="item"]'
      )].filter(visible).map(getText).filter(t=>t.length>25&&t.length<1200&&
        /20\d{2}/.test(t)&&/(?:GF\s*\d{2,4}|departed|booked|arrived|manifested|RCF|DEP)/i.test(t));
      for(const item of items)seen.add(item);
      const more=[...document.querySelectorAll('button,[role="button"]')]
        .find(el=>visible(el)&&/^(show more|load more|show older)( events| updates| history)?$/i.test(clean(getText(el))));
      if(more)more.click();
      const root=document.scrollingElement||document.documentElement;
      const size=Math.max(300,window.innerHeight||root.clientHeight);
      root.scrollTop=Math.min(root.scrollHeight,(step+1)*size);
      window.scrollTo(0,Math.min(root.scrollHeight,(step+1)*size));
      const scrollers=[...document.querySelectorAll('[class*="timeline"],[class*="history"],[class*="tracking"]')]
        .filter(el=>el.scrollHeight>el.clientHeight+60&&el.clientHeight>60);
      for(const el of scrollers)el.scrollTop=Math.min(el.scrollHeight,(step+1)*Math.max(200,el.clientHeight-50));
      const atEnd=root.scrollTop+size>=root.scrollHeight-20&&
        scrollers.every(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-20);
      if(atEnd&&!more&&lastCount===seen.size)stable++;else stable=0;
      if(stable>=3)break;
      lastCount=seen.size;
      await sleep(300);
    }
    const body=getText(document.body);
    allText.add(body);
    const flat=[...allText].join('\n');
    if(!matchesAwb(flat,tracking))return{ok:false,reason:'Requested AWB not verified on ParcelsApp result page'};
    if(/no information about your package/i.test(body)&&!seen.size)
      return{ok:false,reason:'ParcelsApp has no tracking data in this browser session'};
    const left=bestText(['[class*="timeline"]','[class*="history"]','[class*="events"]']);
    const right=bestText(['[class*="summary"]','[class*="shipment-details"]','[class*="package-info"]']);
    // Preserve an ordered full text as well as all separate flight cards.
    // A virtualized UI may unmount older cards after scrolling.
    const dom={resultText:flat.slice(0,110000),
      leftText:(left||flat).slice(0,110000),
      rightText:(right||flat).slice(0,110000),
      timelineRows:[...seen].slice(0,200)};
    if(!/(?:\b(?:DEP|BKD|MAN|ARR|RCF)\b|\b(?:booked|departed|arrived|manifested)\b)/i.test(flat))
      return{ok:false,reason:'No verified Gulf Air movement history visible'};
    return{ok:true,dom,awB:tracking,events:seen.size,url:location.href};
  }
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(msg?.type==='GULF_SUBMIT'){
      submit(msg.mawb).then(sendResponse).catch(e=>sendResponse({ok:false,reason:String(e?.message||e)}));
      return true;
    }
    if(msg?.type==='GULF_READ'){
      read(msg.mawb).then(sendResponse).catch(e=>sendResponse({ok:false,reason:String(e?.message||e)}));
      return true;
    }
  });
})();
