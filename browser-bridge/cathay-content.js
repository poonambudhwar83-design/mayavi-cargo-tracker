(()=>{
  const OFFICIAL='https://www.cathaycargo.com/en-us/track-and-trace.html';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const pad=v=>String(v).padStart(2,'0');
  const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',SEPT:'09',OCT:'10',NOV:'11',DEC:'12'};

  function deepText(){
    const out=[document.body?.innerText||''];
    for(const el of document.querySelectorAll('*')){
      try{if(el.shadowRoot){const t=el.shadowRoot.innerText||el.shadowRoot.textContent||'';if(t)out.push(t);}}catch{}
    }
    return out.join('\n');
  }
  function visible(el){
    if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return s.display!=='none'&&s.visibility!=='hidden'&&r.width>12&&r.height>8&&!el.disabled;
  }
  async function waitFor(fn,timeout=25000,step=250){
    const end=Date.now()+timeout;
    while(Date.now()<end){try{const v=fn();if(v)return v;}catch{}await sleep(step);}return null;
  }
  function clickByText(rx){
    const roots=[document];for(const el of document.querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
    for(const root of roots){
      const els=[...root.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]')];
      const b=els.find(el=>visible(el)&&rx.test((el.innerText||el.value||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'').trim()));
      if(b){b.click();return true;}
    }
    return false;
  }
  async function acceptCookies(){
    for(let i=0;i<5;i++){
      if(clickByText(/^(accept all|accept cookies|allow all|agree)$/i)){await sleep(700);return true;}
      await sleep(350);
    }
    return false;
  }
  function allInputs(){
    const list=[...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]')];
    return list.filter(visible);
  }
  function getAirlineInput(){
    return document.querySelector('input[id*="airlinecodefield" i],input[name*="airlinecodefield" i],input[aria-label*="airline code" i],input[placeholder="160"]')||
      allInputs().find(el=>/airline\s*code|carrier\s*code|awb\s*prefix|prefix/i.test(`${el.id||''} ${el.name||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''}`));
  }
  function getAwbInput(){
    return document.querySelector('input[id*="airwaybill" i]:not([id*="airlinecodefield" i]),input[name*="airwaybill" i],input[placeholder*="12345678"],textarea[id*="airwaybill" i],textarea[name*="airwaybill" i],[contenteditable="true"][aria-label*="waybill" i],[role="textbox"][aria-label*="waybill" i]')||
      allInputs().find(el=>/air\s*waybill|airway\s*bill|airwaybill|\bawb\b/i.test(`${el.id||''} ${el.name||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''}`)&&!/airline/i.test(`${el.id||''} ${el.name||''}`));
  }
  function setNativeValue(el,value){
    if(!el)return false;
    try{
      el.focus();
      const ce=el.getAttribute('contenteditable')==='true'||el.getAttribute('role')==='textbox';
      if(ce){el.textContent=String(value);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;}
      const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter)setter.call(el,String(value));else el.value=String(value);
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    }catch{return false;}
  }
  function pressEnter(el){
    try{
      el.focus();
      for(const type of ['keydown','keypress','keyup'])el.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      return true;
    }catch{return false;}
  }
  async function enterAwb(serial){
    clickByText(/^reset$/i);await sleep(350);
    const airline=await waitFor(getAirlineInput,10000);if(!airline)return{ok:false,stage:'AIRLINE_INPUT_NOT_FOUND'};
    setNativeValue(airline,'160');airline.blur();await sleep(250);
    const awb=await waitFor(getAwbInput,8000);if(!awb)return{ok:false,stage:'AWB_INPUT_NOT_FOUND'};
    setNativeValue(awb,serial);await sleep(180);pressEnter(awb);await sleep(700);
    let text=deepText().replace(/\s/g,'');
    if(!text.includes(serial)){
      setNativeValue(awb,serial);await sleep(200);pressEnter(awb);await sleep(700);text=deepText().replace(/\s/g,'');
    }
    return{ok:text.includes(serial),stage:text.includes(serial)?'AWB_COMMITTED':'AWB_NOT_COMMITTED'};
  }
  async function submit(){
    const btn=await waitFor(()=>{
      const els=[...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(visible);
      return els.find(el=>/^track\s*now$/i.test((el.innerText||el.value||el.textContent||el.getAttribute('aria-label')||'').trim()));
    },10000);
    if(!btn)return false;btn.click();return true;
  }
  async function expandAndRead(){
    await waitFor(()=>/Current\s+status\s*:/i.test(deepText()),30000,350);
    clickByText(/^show all details$/i);await sleep(650);
    let text='';
    for(let i=0;i<14;i++){
      window.scrollTo(0,i*520);await sleep(220);text=deepText();
      if(/Current\s+status\s*:/i.test(text)&&/\b[A-Z]{3}\s+(?:Accepted|Departed|Arrived)\b/.test(text)&&/\bCX\s*\d{2,4}\b/.test(text))break;
    }
    return text||deepText();
  }
  function parseDateTime(value='',year=''){
    const m=String(value).toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*(?:\s+(20\d{2}))?\s+(\d{1,2}):(\d{2})/);
    if(!m)return{date:'',time:''};const y=m[3]||year||String(new Date().getFullYear());return{date:`${y}-${MONTH[m[2]]}-${pad(m[1])}`,time:`${pad(m[4])}:${m[5]}`};
  }
  function parseShipment(text='',mawb=''){
    const raw=String(text||''),flat=raw.replace(/\s+/g,' ').trim();
    if(!/Current\s+status\s*:/i.test(flat))return null;
    const year=(flat.match(/Latest\s+update:[\s\S]{0,80}\b(20\d{2})\b/i)||flat.match(/\b(20\d{2})\b/)||[])[1]||String(new Date().getFullYear());
    const milestones=[...flat.matchAll(/\b([A-Z]{3})\s+(Accepted|Departed|Arrived)\b/g)].map(m=>({airport:m[1],event:m[2]}));
    const origin=(milestones.find(x=>x.event==='Departed')||milestones.find(x=>x.event==='Accepted'))?.airport||'';
    const destination=[...milestones].reverse().find(x=>x.event==='Arrived')?.airport||'';
    const summary=flat.match(/\b(\d{1,5})\s*pc\(s\)\s*[|｜]\s*([\d,.]+)\s*kg\b/i)||flat.match(/\b(\d{1,5})\s*(?:pcs?|pieces?)\b[\s\S]{0,30}?\b([\d,.]+)\s*kg\b/i);
    const pieces=summary?.[1]||'',weight=(summary?.[2]||'').replace(/,/g,'');
    const cardRx=/\b(CX\s*\d{2,4})\b[\s\S]{0,180}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+\d{1,2}:\d{2})[\s\S]{0,120}?(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+\d{1,2}:\d{2})/gi;
    const cards=[...flat.matchAll(cardRx)],card=cards.at(-1);
    const departure=card?parseDateTime(card[2],year):{date:'',time:''},arrival=card?parseDateTime(card[3],year):{date:'',time:''};
    const flightNo=(card?.[1]||flat.match(/\bCX\s*\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
    const arrivedAtDestination=Boolean(destination&&milestones.some(x=>x.airport===destination&&x.event==='Arrived'));
    const deliveredCount=flat.match(/\b(\d+)\s*\/\s*(\d+)\s+Delivered\b/i);
    const delivered=Boolean(/Current\s+status\s*:\s*Delivered/i.test(flat)||(deliveredCount&&Number(deliveredCount[2])>0&&Number(deliveredCount[1])>=Number(deliveredCount[2])));
    const status=delivered?'DELIVERED':arrivedAtDestination?'ARRIVED':milestones.some(x=>x.event==='Departed')?'IN TRANSIT':milestones.some(x=>x.event==='Accepted')?'BOOKED':'TRACKING';
    return{
      mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,
      departureDate:departure.date,departureTime:departure.time,arrivalDate:arrival.date,arrivalTime:arrival.time,
      arrivalIsActual:Boolean(arrivedAtDestination&&arrival.date&&arrival.time),status,officialTracker:OFFICIAL,
      source:'Cathay Cargo official Track & Trace via local Chrome',arrivalTimeSource:'Cathay flight card right-side arrival time'
    };
  }
  async function run(mawb){
    const digits=String(mawb||'').replace(/\D/g,''),serial=digits.slice(3);
    if(digits.length!==11||!digits.startsWith('160'))return{ok:false,trackingError:'Invalid Cathay MAWB.',officialTracker:OFFICIAL};
    try{
      await acceptCookies();
      const entry=await enterAwb(serial);if(!entry.ok)return{ok:false,trackingError:`Cathay AWB entry failed (${entry.stage}).`,officialTracker:OFFICIAL,debug:{entry}};
      const clicked=await submit();if(!clicked)return{ok:false,trackingError:'Cathay Track now button was not available.',officialTracker:OFFICIAL,debug:{entry}};
      const text=await expandAndRead();
      if(/Air waybill number\(s\) is missing/i.test(text)&&!/Current\s+status\s*:/i.test(text))return{ok:false,trackingError:'Cathay did not accept the AWB entry.',officialTracker:OFFICIAL,debug:{entry}};
      const shipment=parseShipment(text,`${digits.slice(0,3)}-${serial}`);
      if(!shipment)return{ok:false,trackingError:'Cathay result opened but the shipment timeline could not be read.',officialTracker:OFFICIAL,debug:{entry,sample:text.slice(0,2200)}};
      return{ok:true,version:'bridge-1.1.0',provider:'Cathay Cargo official Track & Trace via local browser',shipment,debug:{entry,sample:text.slice(0,2200)}};
    }catch(error){return{ok:false,trackingError:`Cathay browser reader failed: ${error?.message||error}`,officialTracker:OFFICIAL};}
  }

  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=='RUN_CATHAY_TRACK')return;
    run(message.mawb).then(sendResponse);return true;
  });
})();
