(()=>{
  if(window.__mayaviSaudiaContentInstalled)return;
  window.__mayaviSaudiaContentInstalled=true;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
  const digits=v=>String(v||'').replace(/\D/g,'');
  const normalize=v=>{const d=digits(v);return d.length===11?`${d.slice(0,3)}-${d.slice(3)}`:''};
  const first=(text,rx)=>clean((String(text||'').match(rx)||[])[1]||'');
  function mapStatus(code=''){
    const s=String(code||'').trim().toUpperCase();
    if(s==='DLV'||s==='ARR')return'ARRIVED';
    if(s==='XXX'||s==='DEP'||s==='RCF'||s==='MAN')return'IN TRANSIT';
    if(s==='BKD'||s==='RCS')return'BOOKED';
    if(s==='DLY')return'DELAYED';
    return s||'TRACKING';
  }
  function parse(text,mawb){
    const t=clean(text);if(!t)return null;
    const d=digits(mawb),serial=d.slice(3),flat=digits(t);
    if(d&&!flat.includes(d)&&serial&&!flat.includes(serial))return null;
    const destination=first(t,/\bDestination\b\s*[:\-]?\s*([A-Z]{3})\b/i).toUpperCase();
    const sourceStatus=first(t,/\bStatus\b\s*[:\-]?\s*(DLV|XXX|BKD|ARR|DEP|RCF|MAN|RCS|DLY)\b/i).toUpperCase();
    const pieces=first(t,/\b(?:Total\s*(?:Number\s*Of\s*)?Pieces|Pieces|PCS|Bags?)\b\s*[:\-]?\s*(\d{1,6})\b/i);
    const weight=first(t,/\b(?:Gross\s*)?Weight\b\s*[:\-]?\s*([\d,.]+)\s*(?:KG|KGS?)?/i).replace(/,/g,'');
    const f=first(t,/\bFlight\s*(?:No\.?|Number)\b\s*[:\-]?\s*(?:SV\s*[- ]?)?(\d{1,4})\b/i);
    const flightNo=f?`SV${f}`:'';
    const flightDate=first(t,/\bFlight\s*Date\b\s*[:\-]?\s*([0-3]?\d[A-Z]{3}\d{2,4}|20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/i).toUpperCase();
    const volume=first(t,/\bVolume\b\s*[:\-]?\s*([\d,.]+)/i).replace(/,/g,'');
    const segmentNo=first(t,/\bSegment\s*No\.?\b\s*[:\-]?\s*(\d+)\b/i);
    if(!sourceStatus&&!destination&&!pieces&&!weight&&!flightNo&&!flightDate)return null;
    const normalized=normalize(mawb);
    return{
      ok:true,
      mawb:normalized,
      provider:'Saudia Cargo normal browser',
      officialTracker:'https://saudiacargo.com/en/digital-services?tab=trackShipment',
      airline:{name:'Saudia Cargo',iata:'SV'},
      shipment:{
        mawb:normalized,
        carrierCode:'SV',
        airlineName:'Saudia Cargo',
        officialTracker:'https://saudiacargo.com/en/digital-services?tab=trackShipment',
        destination,
        pieces,
        bags:pieces,
        weight,
        flightNo,
        flightDate,
        volume,
        segmentNo,
        sourceStatus,
        status:mapStatus(sourceStatus),
        source:'Saudia Cargo official website via normal Chrome session'
      }
    };
  }
  function visible(el){
    if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return s.display!=='none'&&s.visibility!=='hidden'&&r.width>20&&r.height>15&&!el.disabled;
  }
  function findAwbInput(){
    const inputs=[...document.querySelectorAll('input')].filter(visible).filter(e=>!['hidden','checkbox','radio','submit','button','password','email'].includes(String(e.type||'text').toLowerCase()));
    return inputs.find(e=>/awb|air\s*waybill|shipment/i.test(`${e.placeholder||''} ${e.name||''} ${e.id||''} ${e.getAttribute('aria-label')||''} ${e.closest('form,section,div')?.innerText||''}`))||inputs[0]||null;
  }
  function setInput(input,value){
    input.focus();
    const proto=Object.getPrototypeOf(input);
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(setter)setter.call(input,'');else input.value='';
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    if(setter)setter.call(input,value);else input.value=value;
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();
  }
  function findAction(){
    const candidates=[...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a')].filter(visible);
    const txt=e=>clean(e.innerText||e.textContent||e.value||e.getAttribute('aria-label')||'');
    for(const name of ['Submit','Track Shipment','Track','Search']){
      const hit=candidates.find(e=>txt(e).toLowerCase()===name.toLowerCase());if(hit)return hit;
    }
    return null;
  }
  async function run(mawb){
    const normalized=normalize(mawb);
    if(!normalized.startsWith('065-'))return{ok:false,trackingError:'Invalid Saudia 065 MAWB.'};
    let input=null;
    for(let i=0;i<30&&!input;i++){input=findAwbInput();if(!input)await sleep(300);}
    if(!input)return{ok:false,trackingError:'Saudia AWB field not found.',officialTracker:location.href};
    input.scrollIntoView({block:'center'});setInput(input,digits(normalized));await sleep(500);
    let action=null;
    for(let i=0;i<20&&!action;i++){action=findAction();if(!action)await sleep(250);}
    if(!action)return{ok:false,trackingError:'Saudia Submit/Search button not found.',officialTracker:location.href};
    action.scrollIntoView({block:'center'});action.focus();action.click();
    const end=Date.now()+40000;let last='';
    while(Date.now()<end){
      last=clean(document.body?.innerText||'');
      const parsed=parse(last,normalized);if(parsed)return parsed;
      if(/Captcha verification is required/i.test(last))return{ok:false,trackingError:'Saudia required verification in this browser session.',officialTracker:location.href};
      if(/no shipment|not found|invalid awb|no result/i.test(last))return{ok:false,trackingError:'Saudia returned no shipment result.',officialTracker:location.href};
      await sleep(500);
    }
    return{ok:false,trackingError:'Saudia result card did not appear in time.',officialTracker:location.href,debugSample:last.slice(0,800)};
  }
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=='RUN_SAUDIA_TRACK')return;
    run(message.mawb).then(sendResponse).catch(error=>sendResponse({ok:false,trackingError:error?.message||String(error),officialTracker:location.href}));
    return true;
  });
})();
