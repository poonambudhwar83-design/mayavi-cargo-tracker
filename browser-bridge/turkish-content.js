(()=>{
  if(window.__mayaviTurkishContentInstalled)return;
  window.__mayaviTurkishContentInstalled=true;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
  const digits=v=>String(v||'').replace(/\D/g,'');
  const normalize=v=>{const d=digits(v);return d.length===11&&d.startsWith('235')?`235-${d.slice(3)}`:''};
  const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

  function dateISO(value=''){
    const s=clean(value);
    let m=s.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})\b/);
    if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    m=s.match(/\b(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})\b/);
    if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    m=s.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d{2})\b/i);
    if(m)return `${m[3]}-${MONTH[m[2].slice(0,3).toUpperCase()]}-${String(m[1]).padStart(2,'0')}`;
    return '';
  }

  function combine(date='',time=''){return date?`${date}T${time||'00:00'}:00`:'';}

  function reservationRows(text=''){
    const rows=[];
    const normalized=String(text||'').replace(/\u00a0/g,' ').replace(/[–—]/g,'-');
    const exact=/\b(TK\s*0*\d{2,4})\b\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})\s+([A-Z]{3})\s*-\s*([A-Z]{3})\b/ig;
    for(const m of normalized.matchAll(exact)){
      rows.push({
        flightNo:`TK${String(m[1]).replace(/\D/g,'').padStart(4,'0')}`,
        flightDate:dateISO(m[2]),etaDate:dateISO(m[3]),etaTime:m[4],
        etdDate:dateISO(m[5]),etdTime:m[6],
        origin:m[7].toUpperCase(),destination:m[8].toUpperCase()
      });
    }
    if(!rows.length){
      const flexible=/\b(TK\s*0*\d{2,4})\b[^\n]{0,80}?([A-Z]{3})\s*(?:-|TO|>)\s*([A-Z]{3})[^\n]{0,160}?(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})[^\n]{0,100}?(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})/ig;
      for(const m of normalized.matchAll(flexible)){
        rows.push({
          flightNo:`TK${String(m[1]).replace(/\D/g,'').padStart(4,'0')}`,
          flightDate:'',origin:m[2].toUpperCase(),destination:m[3].toUpperCase(),
          etaDate:dateISO(m[4]),etaTime:m[5],etdDate:dateISO(m[6]),etdTime:m[7]
        });
      }
    }
    if(!rows.length){
      const flight=normalized.match(/\bTK\s*0*(\d{2,4})\b/i);
      const route=normalized.match(/\b([A-Z]{3})\s*(?:-|TO|>)\s*([A-Z]{3})\b/i);
      const times=[...normalized.matchAll(/(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})/g)];
      if(flight&&route&&times.length){
        const eta=times.at(-1),etd=times.length>1?times[0]:null;
        rows.push({
          flightNo:`TK${flight[1].padStart(4,'0')}`,flightDate:'',
          origin:route[1].toUpperCase(),destination:route[2].toUpperCase(),
          etaDate:dateISO(eta[1]),etaTime:eta[2],
          etdDate:etd?dateISO(etd[1]):'',etdTime:etd?etd[2]:''
        });
      }
    }
    return rows;
  }

  function actualEvent(text='',code='ARR'){
    const rx=new RegExp(`\\b${code}\\b\\s+Shipment\\s+(?:Arrived|Received From Flight|Delivered)[^]*?\\b([A-Z]{3})\\b(?:\\s+TK\\s*0*\\d{2,4})?[^]*?(\\d{1,2}[.\\/-]\\d{1,2}[.\\/-]\\d{4})\\s+(\\d{1,2}:\\d{2})`,'i');
    const m=String(text||'').match(rx);
    return m?{station:m[1].toUpperCase(),date:dateISO(m[2]),time:m[3]}:null;
  }

  function parse(text,mawb){
    const t=clean(text);
    const normalized=normalize(mawb);
    if(!t||!normalized)return null;
    const d=digits(normalized),serial=d.slice(3),flat=digits(t);
    const looksLikeResult=/Cargo\s+Tracking\s+Information/i.test(t)&&/(TK\s*SMART|piece|kg|\bFrom\b|\bTo\b|Booked|Arrived|Received From Flight|Delivered)/i.test(t);
    if(!flat.includes(d)&&!flat.includes(serial)&&!looksLikeResult)return null;
    if(/no (?:shipment|record|result)|not found|invalid (?:awb|air waybill)/i.test(t))return{notFound:true};

    let origin=(t.match(/\bFrom\s+([A-Z]{3})\b/i)||[])[1]||'';
    let destination=(t.match(/\bTo\s+([A-Z]{3})\b/i)||[])[1]||'';
    origin=origin.toUpperCase();destination=destination.toUpperCase();

    const pieces=(t.match(/\b(\d{1,6})\s*piece\s*\(?s?\)?/i)||t.match(/\b(\d{1,6})\s*(?:pieces|pcs|bags)\b/i)||[])[1]||'';
    const weight=((t.match(/\b([\d,.]+)\s*(?:kg|kgs)\b/i)||[])[1]||'').replace(/,/g,'');
    const volume=((t.match(/\b([\d,.]+)\s*(?:m3|m³|cbm)\b/i)||[])[1]||'').replace(/,/g,'');

    const rows=reservationRows(t);
    const first=rows[0]||null,final=rows.at(-1)||null;
    if(first)origin=origin||first.origin;
    if(final)destination=destination||final.destination;
    const originLeg=rows.find(r=>r.origin===origin)||first;

    const arr=actualEvent(t,'ARR');
    const rcf=actualEvent(t,'RCF');
    const actualArrival=arr||(rcf&&(!destination||rcf.station===destination)?rcf:null);

    let bookingDate='';
    for(const rx of [
      /\bBKD\b\s+Shipment\s+Booked[^]*?(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+\d{1,2}:\d{2}/i,
      /\bBooking\s*Date\b\s*[:\-]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2})/i
    ]){
      const m=t.match(rx);if(m){bookingDate=dateISO(m[1]);if(bookingDate)break;}
    }

    const delivered=t.match(/Delivered\s*(?:-|–|—)?\s*([A-Z]{3})?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})\s+(\d{1,2}:\d{2})/i);
    const deliveryStation=(delivered?.[1]||'').toUpperCase();
    const deliveryDate=delivered?dateISO(delivered[2]):'';
    const deliveryTime=delivered?.[3]||'';

    const upper=t.toUpperCase();
    let status='BOOKED';
    if(/\bDLV\b|DELIVERED|\bARR\b\s+SHIPMENT\s+ARRIVED|RECEIVED FROM FLIGHT/.test(upper))status='ARRIVED';
    else if(/DELAY|LATE|EXCEPTION/.test(upper))status='DELAYED';
    else if(/\bDEP\b|DEPARTED|AIRBORNE|IN FLIGHT|IN TRANSIT/.test(upper))status='IN TRANSIT';

    const arrivalDate=actualArrival?.date||final?.etaDate||'';
    const arrivalTime=actualArrival?.time||final?.etaTime||'';
    const departureDate=originLeg?.etdDate||originLeg?.flightDate||'';
    const departureTime=originLeg?.etdTime||'';
    const departureFlightNo=originLeg?.flightNo||'';
    const flightNo=final?.flightNo||departureFlightNo||'';

    const useful=Boolean((origin&&destination)||pieces||weight||flightNo||arrivalDate||departureDate||deliveryDate);
    if(!useful)return null;

    return{
      ok:true,
      provider:'Turkish Cargo normal Chrome session',
      officialTracker:'https://www.turkishcargo.com/en/cargo-tracking',
      shipment:{
        mawb:normalized,
        carrierCode:'TK',
        airlineName:'Turkish Cargo',
        officialTracker:'https://www.turkishcargo.com/en/cargo-tracking',
        origin,destination,
        pieces,bags:pieces,weight,volume,
        flightNo,
        flightDate:final?.flightDate||originLeg?.flightDate||'',
        departureFlightNo,
        departureOrigin:originLeg?.origin||origin||'',
        departureDestination:originLeg?.destination||'',
        departureDate,departureTime,
        scheduledDeparture:combine(departureDate,departureTime),
        bookingDate,
        scheduledArrivalDate:final?.etaDate||'',
        scheduledArrivalTime:final?.etaTime||'',
        arrivalDate,arrivalTime,
        arrivalIsActual:Boolean(actualArrival?.date),
        actualArrivalDate:actualArrival?.date||'',
        actualArrivalTime:actualArrival?.time||'',
        actualArrival:actualArrival?.date?combine(actualArrival.date,actualArrival.time):'',
        deliveryStation,deliveryDate,deliveryTime,
        deliveredAt:deliveryDate?combine(deliveryDate,deliveryTime):'',
        status,
        source:'Turkish Cargo official website via user-verified normal Chrome session'
      }
    };
  }

  function visible(el){
    if(!el)return false;
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return r.width>3&&r.height>3&&s.display!=='none'&&s.visibility!=='hidden'&&!el.disabled;
  }

  function setValue(el,value){
    if(!el)return false;
    try{
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      if(setter)setter.call(el,value);else el.value=value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      return digits(el.value)===digits(value);
    }catch{return false;}
  }

  function findTrackFields(){
    const fields=[...document.querySelectorAll('input:not([type="hidden"]),textarea')].filter(visible);
    const meta=el=>({
      max:Number(el.maxLength||-1),
      value:String(el.value||''),
      label:`${el.placeholder||''} ${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''}`
    });
    const prefix=fields.find(el=>{const m=meta(el);return m.max===3||/prefix|awb code|airline code/i.test(m.label)||digits(m.value)==='235';})||null;
    const number=fields.find(el=>el!==prefix&&(()=>{const m=meta(el);return m.max===8||/awb|air waybill|waybill|shipment|master document|document number|tracking number/i.test(m.label);})())
      ||fields.find(el=>el!==prefix&&[11,12,14].includes(meta(el).max))
      ||null;
    return{prefix,number};
  }

  async function clickAdd(serial){
    const end=Date.now()+10000;
    while(Date.now()<end){
      const nodes=[...document.querySelectorAll('button,a,[role="button"],mat-option,.mat-mdc-option,.mat-option,[role="option"],li,div,span,p')];
      const hits=[];
      for(const el of nodes){
        if(!visible(el))continue;
        const text=clean(el.innerText||el.textContent||el.value||'');
        if(!(/^Add$/i.test(text)||(/^Add\s*:/i.test(text)&&digits(text).includes(serial))))continue;
        const target=el.closest('button,a,[role="button"],mat-option,.mat-mdc-option,.mat-option,[role="option"],li')||el;
        if(visible(target))hits.push({target,text,score:/^Add\s*:/i.test(text)?0:1});
      }
      hits.sort((a,b)=>a.score-b.score);
      if(hits[0]){
        hits[0].target.scrollIntoView({block:'center',behavior:'auto'});
        hits[0].target.click();
        await sleep(700);
        return{ok:true,text:hits[0].text};
      }
      await sleep(250);
    }
    return{ok:false};
  }

  async function clickSearch(){
    const end=Date.now()+9000;
    while(Date.now()<end){
      const nodes=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],div,span')];
      const hit=nodes.find(el=>visible(el)&&/^Search$/i.test(clean(el.innerText||el.textContent||el.value||'')));
      if(hit){
        const target=hit.closest('button,a,[role="button"]')||hit;
        target.scrollIntoView({block:'center',behavior:'auto'});
        target.click();
        await sleep(900);
        return true;
      }
      await sleep(250);
    }
    return false;
  }

  async function prepareTracking(mawb){
    const d=digits(mawb),serial=d.slice(3);
    const end=Date.now()+15000;
    while(Date.now()<end){
      const {prefix,number}=findTrackFields();
      if(number){
        if(prefix&&digits(prefix.value)!=='235')setValue(prefix,'235');
        const wanted=prefix?serial:(Number(number.maxLength||-1)===8?serial:d);
        if(digits(number.value)!==digits(wanted))setValue(number,wanted);
        await sleep(600);
        const add=await clickAdd(serial);
        if(!add.ok){
          number.focus();
          number.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true}));
          number.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
          await sleep(600);
        }
        const searched=await clickSearch();
        return{ok:searched,add:add.ok};
      }
      await sleep(350);
    }
    return{ok:false,reason:'FORM_NOT_FOUND'};
  }

  function challengeVisible(){
    const text=clean(document.body?.innerText||'');
    return /Press\s*&\s*Hold|confirm\s+you\s+are\s+a\s+human|Human Challenge requires verification/i.test(text);
  }

  async function run(mawb){
    const normalized=normalize(mawb);
    if(!normalized)return{ok:false,trackingError:'Invalid Turkish Cargo 235 MAWB.',officialTracker:location.href};

    // Use the normal Turkish Cargo UI exactly as a person would up to the
    // anti-bot checkpoint: fill AWB -> Add -> Search. Never interact with the
    // Press & Hold verification itself; that remains a user action.
    const prepared=await prepareTracking(normalized);
    const end=Date.now()+180000;
    let last='';
    let challengeSeen=false;
    while(Date.now()<end){
      last=clean(document.body?.innerText||'');
      const parsed=parse(last,normalized);
      if(parsed?.notFound)return{ok:false,trackingError:'Turkish Cargo returned no shipment record.',officialTracker:location.href};
      if(parsed?.ok)return parsed;
      if(challengeVisible())challengeSeen=true;
      await sleep(700);
    }

    return{
      ok:false,
      humanVerificationRequired:challengeSeen,
      trackingError:challengeSeen
        ?'Turkish Cargo verification is still pending. Complete Press & Hold in this tab, then refresh the MAWB in Mayavi.'
        :'Turkish Cargo result card did not appear in the normal browser session.',
      officialTracker:location.href,
      debugSample:last.slice(0,1000)
    };
  }

  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=='RUN_TURKISH_TRACK')return;
    run(message.mawb)
      .then(sendResponse)
      .catch(error=>sendResponse({ok:false,trackingError:error?.message||String(error),officialTracker:location.href}));
    return true;
  });
})();
