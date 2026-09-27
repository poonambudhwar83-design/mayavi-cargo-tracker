(()=>{
  if(window.__mayaviMalaysiaContentInstalled)return;
  window.__mayaviMalaysiaContentInstalled=true;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  const digits=v=>String(v??'').replace(/\D/g,'');
  const normalize=v=>{const d=digits(v);return d.length===11&&d.startsWith('232')?`232-${d.slice(3)}`:''};
  const pad=v=>String(v).padStart(2,'0');
  const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

  function dateISO(value=''){
    const s=clean(value).toUpperCase();
    let m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
    if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);
    if(m)return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    m=s.match(/\b(\d{1,2})[\s,-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,-]+(20\d{2})\b/);
    if(m)return `${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
    m=s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,-]+(\d{1,2})[\s,-]+(20\d{2})\b/);
    if(m)return `${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
    return '';
  }
  function time24(value=''){
    const s=clean(value).toUpperCase();
    let m=s.match(/\b(1[0-2]|0?\d):([0-5]\d)\s*(AM|PM)\b/);
    if(m){let h=Number(m[1]);if(m[3]==='PM'&&h<12)h+=12;if(m[3]==='AM'&&h===12)h=0;return `${pad(h)}:${m[2]}`;}
    m=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    return m?`${pad(m[1])}:${m[2]}`:'';
  }
  const airport=v=>(clean(v).toUpperCase().match(/\b[A-Z]{3}\b/)||[])[0]||'';
  const flightNo=v=>{const m=clean(v).toUpperCase().match(/\bMH\s*[- ]?(\d{1,4})\b/);return m?`MH${m[1]}`:''};
  const numeric=v=>(clean(v).replace(/,/g,'').match(/\d+(?:\.\d+)?/)||[])[0]||'';
  const keyNorm=k=>String(k||'').toLowerCase().replace(/[^a-z0-9]/g,'');

  function allNodes(value,path='',out=[]){
    if(value===null||value===undefined)return out;
    if(Array.isArray(value)){value.forEach((v,i)=>allNodes(v,`${path}[${i}]`,out));return out;}
    if(typeof value==='object'){
      for(const [k,v] of Object.entries(value)){
        out.push({key:k,norm:keyNorm(k),value:v,path:path?`${path}.${k}`:k});
        allNodes(v,path?`${path}.${k}`:k,out);
      }
    }
    return out;
  }
  function scalar(nodes,names=[]){
    const set=new Set(names.map(keyNorm));
    for(const n of nodes){
      if(!set.has(n.norm))continue;
      if(['string','number'].includes(typeof n.value)&&clean(n.value)!=='')return clean(n.value);
    }
    return '';
  }
  function arrayByKey(nodes,names=[]){
    const set=new Set(names.map(keyNorm));
    for(const n of nodes)if(set.has(n.norm)&&Array.isArray(n.value))return n.value;
    return [];
  }
  function bestFlightObjects(root){
    const found=[];
    const walk=v=>{
      if(!v||typeof v!=='object')return;
      if(Array.isArray(v)){v.forEach(walk);return;}
      const values=Object.values(v);
      const joined=values.filter(x=>['string','number'].includes(typeof x)).map(clean).join(' ');
      const fn=flightNo(joined);
      const keys=Object.keys(v).map(keyNorm);
      if(fn||keys.some(k=>k.includes('flightnumber')||k==='flightno')||keys.includes('departure')||keys.includes('arrival'))found.push(v);
      values.forEach(walk);
    };
    walk(root);
    return found;
  }
  function statusFrom(text=''){
    const s=clean(text).toUpperCase();
    if(/CARGO DELIVERED|DOCUMENT DELIVERED|DELIVERED|ARRIVED|RECEIVED FROM FLIGHT|\bRCF\b/.test(s))return'ARRIVED';
    if(/DELAY|LATE|OFFLOAD|SHORT SHIP|EXCEPTION/.test(s))return'DELAYED';
    if(/FLIGHT DEPARTED|DEPARTED|TRANSFERRED MANIFEST|IN TRANSIT|AIRBORNE|\bDEP\b/.test(s))return'IN TRANSIT';
    if(/GOODS MANIFESTED|GOODS ACCEPTED|BOOKED|CONFIRMED|\bRCS\b/.test(s))return'BOOKED';
    return'TRACKING';
  }
  function timestampParts(value=''){
    const s=clean(value);
    if(!s)return{date:'',time:''};
    const d=new Date(s);
    if(!Number.isNaN(d.getTime())&&/[TZ]|\d{4}-\d{1,2}-\d{1,2}/.test(s)){
      return{date:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,time:`${pad(d.getHours())}:${pad(d.getMinutes())}`};
    }
    return{date:dateISO(s),time:time24(s)};
  }

  function mapApi(payload,mawb){
    let root=payload;
    if(root&&typeof root==='object'&&Object.prototype.hasOwnProperty.call(root,'data'))root=root.data;
    if(root&&typeof root==='object'&&Object.prototype.hasOwnProperty.call(root,'data'))root=root.data;
    if(!root||typeof root!=='object')return null;
    const nodes=allNodes(root);
    const normalized=normalize(mawb);
    const raw=JSON.stringify(root);
    const flatDigits=digits(raw);
    if(!flatDigits.includes(digits(normalized))&&!flatDigits.includes(digits(normalized).slice(3)))return null;

    let origin=airport(scalar(nodes,['origin','originAirport','departureAirport','airportDeparture','originCode','from','fromAirport']));
    let destination=airport(scalar(nodes,['destination','destinationAirport','arrivalAirport','airportArrival','destinationCode','to','toAirport']));
    let pieces=numeric(scalar(nodes,['pieces','piece','pcs','totalPieces','totalPiece','packageCount','totalPackage','totalPackages','numberOfPieces','noOfPieces']));
    let weight=numeric(scalar(nodes,['weight','grossWeight','totalWeight','shipmentWeight','chargeableWeight']));
    let bookingDate=dateISO(scalar(nodes,['bookingDate','shipmentDate','awbDate','bookedDate']));
    let statusText=scalar(nodes,['shipmentStatus','status','currentStatus','latestStatus']);
    let flight=flightNo(scalar(nodes,['flightNo','flightNumber','flight','finalFlightNo']));
    let flightDate=dateISO(scalar(nodes,['flightDate','scheduledFlightDate']));
    let departureDate=dateISO(scalar(nodes,['departureDate','scheduledDepartureDate']));
    let departureTime=time24(scalar(nodes,['departureTime','scheduledDepartureTime','actualDepartureTime']));
    let arrivalDate=dateISO(scalar(nodes,['arrivalDate','scheduledArrivalDate','actualArrivalDate','estimatedArrivalDate']));
    let arrivalTime=time24(scalar(nodes,['arrivalTime','scheduledArrivalTime','actualArrivalTime','estimatedArrivalTime']));
    let arrivalIsActual=Boolean(scalar(nodes,['actualArrival','actualArrivalDate','actualArrivalTime']));

    const history=arrayByKey(nodes,['history','trackingHistory','events','milestones','trackingDetails']);
    const events=(Array.isArray(history)?history:[]).map(e=>{
      const en=allNodes(e), txt=Object.values(e||{}).filter(v=>['string','number'].includes(typeof v)).map(clean).join(' ');
      const st=scalar(en,['status','event','eventName','description','milestone','activity'])||txt;
      const ts=scalar(en,['timestamp','dateTime','eventTime','datetime','date']);
      const tp=timestampParts(ts||txt);
      return{raw:e,text:txt,status:st,date:tp.date,time:tp.time,station:airport(scalar(en,['station','location','airport','airportCode'])||txt)};
    }).filter(x=>x.text||x.status);

    const booked=events.find(e=>/BOOKED|BOOKING CONFIRMED/i.test(e.status+' '+e.text));
    if(!bookingDate&&booked?.date)bookingDate=booked.date;
    const actualArr=[...events].reverse().find(e=>/CARGO DELIVERED|DOCUMENT DELIVERED|ARRIVED|RECEIVED FROM FLIGHT|\bRCF\b/i.test(e.status+' '+e.text));
    if(actualArr){
      arrivalDate=actualArr.date||arrivalDate;
      arrivalTime=actualArr.time||arrivalTime;
      arrivalIsActual=Boolean(actualArr.date||actualArr.time);
      if(!destination&&actualArr.station)destination=actualArr.station;
    }
    const dep=[...events].reverse().find(e=>/FLIGHT DEPARTED|DEPARTED|\bDEP\b/i.test(e.status+' '+e.text));
    if(dep){departureDate=dep.date||departureDate;departureTime=dep.time||departureTime;}

    const flights=bestFlightObjects(root).map(obj=>{
      const n=allNodes(obj),txt=Object.values(obj).filter(v=>['string','number'].includes(typeof v)).map(clean).join(' ');
      const no=flightNo(scalar(n,['flightNo','flightNumber','flight'])||txt);
      const o=airport(scalar(n,['origin','departureAirport','airportDeparture','from'])||'');
      const d=airport(scalar(n,['destination','arrivalAirport','airportArrival','to'])||'');
      const depRaw=scalar(n,['departure','scheduledDeparture','actualDeparture','departureDateTime']);
      const arrRaw=scalar(n,['arrival','scheduledArrival','actualArrival','arrivalDateTime']);
      const dp=timestampParts(depRaw),ap=timestampParts(arrRaw);
      return{no,origin:o,destination:d,depDate:dp.date,depTime:dp.time,arrDate:ap.date,arrTime:ap.time,raw:txt};
    }).filter(x=>x.no||x.origin||x.destination||x.depDate||x.arrDate);

    const first=flights[0]||null,final=flights.at(-1)||null;
    if(first){origin=origin||first.origin;departureDate=departureDate||first.depDate;departureTime=departureTime||first.depTime;}
    if(final){destination=destination||final.destination;flight=flight||final.no;flightDate=flightDate||final.depDate;arrivalDate=arrivalDate||final.arrDate;arrivalTime=arrivalTime||final.arrTime;}
    if(!statusText&&events.length)statusText=events.at(-1)?.status||events.at(-1)?.text||'';

    const status=statusFrom([statusText,...events.map(e=>e.status+' '+e.text)].join(' '));
    const useful=Boolean((origin&&destination)||pieces||weight||flight||bookingDate||arrivalDate||events.length);
    if(!useful)return null;
    return{
      ok:true,
      provider:'MASkargo normal browser',
      officialTracker:`https://www.maskargo.com/en/shipment-tracking.html?prefixNumber=232&awbNumber=${digits(normalized).slice(3)}`,
      airline:{name:'Malaysia Airlines Cargo',iata:'MH'},
      shipment:{
        mawb:normalized,carrierCode:'MH',airlineName:'Malaysia Airlines Cargo / MASkargo',
        origin,destination,pieces,bags:pieces,weight,
        flightNo:flight,flightDate,bookingDate,
        departureDate,departureTime,departureIsActual:Boolean(dep?.date||dep?.time),
        departureFlightNo:first?.no||flight||'',departureOrigin:first?.origin||origin,departureDestination:first?.destination||'',
        arrivalDate,arrivalTime,arrivalIsActual,
        status,
        officialTracker:`https://www.maskargo.com/en/shipment-tracking.html?prefixNumber=232&awbNumber=${digits(normalized).slice(3)}`,
        source:'MASkargo official website via normal Chrome session'
      }
    };
  }

  function parseDom(text,mawb){
    const t=clean(text),normalized=normalize(mawb);
    if(!t||!normalized)return null;
    const serial=digits(normalized).slice(3),flat=digits(t);
    if(!flat.includes(serial)&&!/Shipment Details|Tracking Details/i.test(t))return null;
    if(/no results|no shipment|not found|invalid awb/i.test(t))return{notFound:true};

    const after=(label,limit=80)=>{
      const rx=new RegExp(label+'\\s*[:\\-]?\\s*([^|]{1,'+limit+'})','i');
      return clean((t.match(rx)||[])[1]||'');
    };
    let origin=airport(after('Origin|Airport Departure|Departure Airport'));
    let destination=airport(after('Destination|Airport Arrival|Arrival Airport'));
    const pieces=numeric(after('Total Package|Pieces?|PCS|Bags?'));
    const weight=numeric(after('Weight|Gross Weight'));
    let flight=flightNo(t);
    const route=t.match(/\b([A-Z]{3})\s*(?:-|→|TO)\s*([A-Z]{3})\b/i);
    if(route){origin=origin||route[1].toUpperCase();destination=destination||route[2].toUpperCase();}
    let bookingDate='';
    const bookBlock=(t.match(/.{0,100}(?:BOOKED|Booking Confirmed).{0,160}/i)||[])[0]||'';
    if(bookBlock)bookingDate=dateISO(bookBlock);
    const arrBlock=(t.match(/.{0,120}(?:CARGO DELIVERED|ARRIVED|RECEIVED FROM FLIGHT|RCF).{0,180}/i)||[])[0]||'';
    const depBlock=(t.match(/.{0,120}(?:FLIGHT DEPARTED|DEPARTED|DEP).{0,180}/i)||[])[0]||'';
    const arrivalDate=dateISO(arrBlock),arrivalTime=time24(arrBlock);
    const departureDate=dateISO(depBlock),departureTime=time24(depBlock);
    const status=statusFrom(t);
    const useful=Boolean((origin&&destination)||pieces||weight||flight||bookingDate||arrivalDate||status!=='TRACKING');
    if(!useful)return null;
    return{
      ok:true,provider:'MASkargo normal browser',
      officialTracker:location.href,
      airline:{name:'Malaysia Airlines Cargo',iata:'MH'},
      shipment:{
        mawb:normalized,carrierCode:'MH',airlineName:'Malaysia Airlines Cargo / MASkargo',
        origin,destination,pieces,bags:pieces,weight,flightNo:flight,
        bookingDate,departureDate,departureTime,departureIsActual:Boolean(departureDate||departureTime),
        arrivalDate,arrivalTime,arrivalIsActual:Boolean(arrivalDate||arrivalTime),
        status,officialTracker:location.href,
        source:'MASkargo official website via normal Chrome session'
      }
    };
  }

  async function apiTrack(mawb){
    const normalized=normalize(mawb);if(!normalized)return null;
    const full=digits(normalized);
    try{
      const url=`https://www.maskargo.com/bin/mh/revamp/maskargo/shipment/tracking?awbShipmentTrackingNumber=${encodeURIComponent(full)}`;
      const res=await fetch(url,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json,text/plain,*/*'}});
      const text=await res.text();
      if(!res.ok||!text||/^\s*</.test(text))return null;
      const json=JSON.parse(text);
      return mapApi(json,normalized);
    }catch{return null;}
  }

  async function run(mawb){
    const normalized=normalize(mawb);
    if(!normalized)return{ok:false,trackingError:'Invalid MASkargo 232 MAWB.',officialTracker:location.href};

    // First read the official API from the user's normal Chrome/IP. The site
    // blocks cloud/Vercel IPs, which is why the server adapter can stay blank.
    for(let i=0;i<3;i++){
      const api=await apiTrack(normalized);
      if(api?.ok)return api;
      await sleep(700);
    }

    // The deep link auto-runs the same official lookup. Wait for its rendered
    // Shipment Details / Tracking Details and read them as a fallback.
    const end=Date.now()+45000;let last='';
    while(Date.now()<end){
      last=clean(document.body?.innerText||'');
      const parsed=parseDom(last,normalized);
      if(parsed?.notFound)return{ok:false,trackingError:'MASkargo returned no shipment record.',officialTracker:location.href};
      if(parsed?.ok)return parsed;
      await sleep(600);
    }
    return{ok:false,trackingError:'MASkargo result did not load in the normal browser session.',officialTracker:location.href,debugSample:last.slice(0,1200)};
  }

  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=='RUN_MALAYSIA_TRACK')return;
    run(message.mawb)
      .then(sendResponse)
      .catch(error=>sendResponse({ok:false,trackingError:error?.message||String(error),officialTracker:location.href}));
    return true;
  });
})();
