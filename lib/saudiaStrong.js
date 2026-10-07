import { normalizeMawb } from './airlines.js';

const URL='https://sal.sa/trackshipment';
const API='https://sal.sa/TrackShipment/TrackingApi';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const n=v=>{const x=Number(String(v??'').replace(/,/g,''));return Number.isFinite(x)?x:0};
const pad=v=>String(v).padStart(2,'0');
function dt(v=''){const s=clean(v);let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);if(m){let h=+m[4],ap=(m[6]||'').toUpperCase();if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;return{epoch:Date.UTC(+m[3],+m[1]-1,+m[2],h,+m[5]),date:`${m[3]}-${pad(m[1])}-${pad(m[2])}`,time:`${pad(h)}:${m[5]}`};}const t=Date.parse(s);if(Number.isFinite(t)){const d=new Date(t);return{epoch:t,date:`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,time:`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`};}return{epoch:0,date:'',time:''};}
function flight(v=''){const m=clean(v).toUpperCase().replace(/\s+/g,'').match(/^(?:SV|SVA)?0*(\d{1,4}[A-Z]?)$/);return m?`SV${m[1]}`:'';}
function flightDateOnly(v=''){
  const s=clean(v).toUpperCase();
  const mon={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  let m=s.match(/\b([0-3]?\d)(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})\b/);
  if(m){const y=m[3].length===2?`20${m[3]}`:m[3];return `${y}-${mon[m[2]]}-${pad(m[1])}`;}
  m=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  // SAL Flight_Date values are commonly month/day/year.
  m=s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if(m)return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return '';
}
function hasFlightConfirmation(events=[],flightNo='',flightDate=''){
  return events.some(e=>{
    if(!/^(FOW|MAN|DEP)$/.test(e.code||''))return false;
    const sameNo=!flightNo||!e.flightNo||e.flightNo===flightNo;
    const sameDate=!flightDate||!e.flightDate||flightDateOnly(e.flightDate)===flightDateOnly(flightDate);
    return sameNo&&sameDate;
  });
}
function ev(raw,i){const x=dt(raw?.DateTime_LT);const planned=dt(raw?.Scheduled_Arrival||raw?.ScheduledArrival||raw?.Estimated_Arrival||raw?.EstimatedArrival||raw?.ETA||'');return{code:clean(raw?.Status).toUpperCase(),airport:clean(raw?.Airport).toUpperCase(),origin:clean(raw?.Flight_Origin).toUpperCase(),destination:clean(raw?.Flight_Dest).toUpperCase(),pieces:n(raw?.Pieces),weight:n(raw?.Weight),flightNo:flight(raw?.Flight_Number),flightDate:clean(raw?.Flight_Date),date:x.date,time:x.time,epoch:x.epoch,plannedArrivalDate:planned.date,plannedArrivalTime:planned.time,sequence:i,raw};}
function same(a,b){if(a.pieces&&b.pieces&&a.pieces!==b.pieces)return false;if(a.weight&&b.weight&&Math.abs(a.weight-b.weight)>.5)return false;return Boolean(a.pieces||a.weight);}
function sum(a){return a.reduce((z,x)=>({pieces:z.pieces+(x.pieces||0),weight:z.weight+(x.weight||0)}),{pieces:0,weight:0});}
function clamp(v,max){return max?Math.min(v,max):v;}
function scalarDate(obj){let found='';const walk=x=>{if(found||x==null)return;if(Array.isArray(x)){for(const v of x)walk(v);return;}if(typeof x==='object'){for(const [k,v] of Object.entries(x)){if(/^date$/i.test(k)){const d=flightDateOnly(v);if(d){found=d;return;}}walk(v);}return;}};walk(obj);return found;}
function reconcile(data){const headerExpectedDate=flightDateOnly(data?.Date||data?.ExpectedArrivalDate||data?.EstimatedArrivalDate||'')||scalarDate(data);const destination=clean(data?.Destination).toUpperCase(),origin=clean(data?.Origin).toUpperCase(),totalPieces=n(data?.TotalPieces),totalWeight=n(data?.TotalWeight);const raw=(Array.isArray(data?.Parts)?data.Parts:[]).flatMap(p=>Array.isArray(p?.Events)?p.Events:[]);const events=raw.map(ev).sort((a,b)=>a.epoch-b.epoch||a.sequence-b.sequence);const rcs=events.find(x=>x.code==='RCS'&&x.pieces);const masterPieces=rcs?.pieces||totalPieces,masterWeight=rcs?.weight||totalWeight;
  const arrivals=events.filter(x=>/^(ARR|DLV)$/.test(x.code)&&destination&&x.airport===destination);const arrived=sum(arrivals);arrived.pieces=clamp(arrived.pieces,masterPieces);arrived.weight=clamp(arrived.weight,masterWeight);const remaining={pieces:Math.max(0,masterPieces-arrived.pieces),weight:Math.max(0,masterWeight-arrived.weight)};
  const groups=new Map();for(const x of events.filter(e=>['MAN','FOW','DIS','DEP','ARR','DLV'].includes(e.code)&&e.flightNo)){const k=`${x.flightNo}|${x.flightDate||x.date}`;if(!groups.has(k))groups.set(k,{flightNo:x.flightNo,flightDate:x.flightDate||x.date,events:[]});groups.get(k).events.push(x);}
  const history=[];let active=null;for(const g of groups.values()){const f=g.events.filter(x=>x.code==='FOW'),d=g.events.filter(x=>x.code==='DIS'),dep=g.events.filter(x=>x.code==='DEP'),arr=g.events.filter(x=>/^(ARR|DLV)$/.test(x.code)&&x.airport===destination);const valid=f.filter(x=>!d.some(y=>same(x,y)));const rec={flightNo:g.flightNo,flightDate:g.flightDate,fow:sum(f),validFow:sum(valid),dis:sum(d),departed:sum(dep),arrived:sum(arr),cancelled:f.length>valid.length};history.push(rec);if((valid.length||dep.length)&&(!arr.length||sum(arr).pieces<sum(dep).pieces))active={...rec,events:g.events};}
  const fully=masterPieces>0&&arrived.pieces>=masterPieces&&(masterWeight<=0||arrived.weight>=masterWeight-.5);let status='TRACKING',loadStatus='',discrepancy='';const operational=events.filter(x=>/^(BKD|RCS|MAN|FOW|DIS|DEP|ARR|RCF|FIW|DLV)$/.test(x.code));let selected=arrivals.at(-1)||operational.at(-1)||events.at(-1)||{};
  if(fully){status='ARRIVED';loadStatus=`Complete Load Arrived — ${arrived.pieces}/${masterPieces} pcs`;discrepancy='Complete Load / No discrepancy';}
  else if(active){const moving=active.departed.pieces?active.departed:active.validFow;const balanceCovered=remaining.pieces>0&&moving.pieces>=remaining.pieces&&(remaining.weight<=0||moving.weight>=remaining.weight-.5);const prior=arrived.pieces>0;status=active.departed.pieces?'DEPARTED':prior?'PART ARRIVED':'IN TRANSIT';loadStatus=`${balanceCovered?(prior?'Complete Balance':'Complete Load'):'Part Load'} ${active.departed.pieces?'Confirmed':'Expected'} — ${moving.pieces}/${remaining.pieces||masterPieces||'?'} pcs — ${active.flightNo}`;if(prior)discrepancy=`Part Load: ${arrived.pieces}/${masterPieces||'?'} arrived | Balance ${remaining.pieces}/${masterPieces||'?'} pcs`;if(active.cancelled)discrepancy=`${discrepancy?discrepancy+' · ':''}FOW cancelled by DIS; movement recalculated`;selected=active.events.filter(x=>['DEP','FOW'].includes(x.code)).at(-1)||selected;}
  else if(arrived.pieces){status='PART ARRIVED';loadStatus=`Part Arrived — ${arrived.pieces}/${masterPieces||'?'} pcs`;discrepancy=`Part Load: ${arrived.pieces}/${masterPieces||'?'} arrived | Balance ${remaining.pieces}/${masterPieces||'?'} pcs`;}
  else {const last=events.at(-1);if(last?.code==='DIS'){status='IN TRANSIT';discrepancy='Latest planned/FOW movement cancelled by DIS — awaiting rebooking';}else if(last?.code==='MAN'){status='IN TRANSIT';loadStatus='Planned — awaiting FOW';}else if(last?.code==='FOW'){status='IN TRANSIT';loadStatus='Load Expected';}else if(last?.code==='DEP')status='DEPARTED';}
  const actual=arrivals.at(-1);
  // If the latest operational event is DIS, that flight was explicitly not
  // loaded. Do not retain it as the current active flight or ETA. Wait for the
  // next MAN/FOW/DEP assignment.
  const latestOperational=operational.at(-1)||{};
  const disLatest=latestOperational.code==='DIS';
  if(disLatest){status=arrived.pieces?'PART ARRIVED':'BOOKED';loadStatus='Offloaded / not loaded — awaiting next flight';discrepancy='FOW cancelled by DIS — awaiting next valid flight assignment';selected=latestOperational;active=null;}
  const resolvedFlightNo=disLatest?'':(active?.flightNo||actual?.flightNo||selected.flightNo||'');
  const resolvedFlightDate=disLatest?'':(active?.flightDate||actual?.flightDate||selected.flightDate||'');
  const fowToDelhi=!disLatest&&selected?.code==='FOW'&&selected?.destination==='DEL';
  const currentDelhiPlan=!disLatest&&!fully&&destination==='DEL'&&Boolean(resolvedFlightNo)&&Boolean(resolvedFlightDate)&&/^(BKD|RCS|MAN|FOW|DEP)$/.test(selected?.code||'');
  // For Saudia, the latest chronological shipment row is the current flight assignment.
  // Until ARR/RCF confirms actual arrival, use that current Delhi flight date as the
  // expected arrival date. If SAL later moves the cargo to another flight/date, the
  // next refresh automatically replaces this expected date with the new assignment.
  const expectedDate=fowToDelhi?(selected.plannedArrivalDate||flightDateOnly(resolvedFlightDate)):(currentDelhiPlan?flightDateOnly(resolvedFlightDate):'');
  const expectedTime=fowToDelhi?(selected.plannedArrivalTime||''):'';
  const flightConfirmed=hasFlightConfirmation(events,resolvedFlightNo,resolvedFlightDate);
  if(!fully&&!flightConfirmed&&expectedDate){
    discrepancy=discrepancy||'Expected flight not yet confirmed by FOW/MAN/DEP — check next flight before arrival window';
  }
  const movementBuckets=new Map();
  for(const x of events.filter(e=>/^(MAN|FOW|DIS|DEP|ARR|DLV)$/.test(e.code||'')&&(e.pieces||e.weight))){
    const fd=flightDateOnly(x.flightDate||x.date||'');
    const key=[x.flightNo||'SV',fd,x.pieces||0,Math.round((x.weight||0)*100)/100].join('|');
    const previous=movementBuckets.get(key);
    if(!previous||x.epoch>=previous.epoch)movementBuckets.set(key,x);
  }
  const latestArrivalEpoch=arrivals.reduce((max,x)=>Math.max(max,x.epoch||0),0);
  const partCandidates=[...movementBuckets.entries()]
    .map(([key,x])=>{
      // DIS means this planned portion was not loaded. It is history, not a
      // current physical part row. If a smaller balance (for example 4/79)
      // moves on the next flight it will appear as its own new row.
      if(x.code==='DIS')return null;
      const arrivedPart=/^(ARR|DLV)$/.test(x.code)&&(!destination||x.airport===destination);
      const departedPart=x.code==='DEP';
      const movingPart=/^(MAN|FOW)$/.test(x.code);
      if(!arrivedPart&&!departedPart&&!movingPart)return null;

      // Once a later destination ARR/DLV exists, an older MAN/FOW/DEP row is
      // stale history. Do not leave those bags shown as pending after they have
      // already arrived on a later event/flight.
      if(!arrivedPart&&latestArrivalEpoch&&(x.epoch||0)<=latestArrivalEpoch)return null;

      return{
        partId:key,
        partKey:key,
        pieces:x.pieces||0,
        weight:x.weight||0,
        totalPieces:masterPieces||0,
        totalWeight:masterWeight||0,
        flightNo:x.flightNo||'',
        flightDate:flightDateOnly(x.flightDate||x.date||''),
        arrivalDate:arrivedPart?x.date:'',
        arrivalTime:arrivedPart?x.time:'',
        arrivalIsActual:arrivedPart,
        status:arrivedPart?'ARRIVED':departedPart?'DEPARTED':'IN TRANSIT',
        remarks:arrivedPart?'Part shipment arrived':departedPart?'Part shipment departed':'Part shipment on flight movement',
        _eventEpoch:x.epoch||0
      };
    })
    .filter(Boolean);

  // Keep all actual arrived portions. Pending/moving portions are limited by
  // the authoritative remaining balance, so an old 5-piece pending movement
  // cannot remain visible after 4 of those pieces later arrive (balance = 1).
  const arrivedPartRows=partCandidates.filter(p=>p.status==='ARRIVED');
  const movingRows=partCandidates
    .filter(p=>p.status!=='ARRIVED')
    .sort((a,b)=>(b._eventEpoch||0)-(a._eventEpoch||0));
  let pendingBudget=remaining.pieces||0;
  const currentMoving=[];
  for(const p of movingRows){
    if(pendingBudget<=0)break;
    const pcs=Number(p.pieces||0);
    if(!pcs)continue;
    if(pcs<=pendingBudget){
      currentMoving.push(p);
      pendingBudget-=pcs;
    }
  }
  const partShipments=[...arrivedPartRows,...currentMoving]
    .map(({_eventEpoch,...p})=>p)
    .sort((a,b)=>String(a.arrivalDate||a.flightDate||'').localeCompare(String(b.arrivalDate||b.flightDate||''))||Number(b.pieces||0)-Number(a.pieces||0));
  const hadSplitLoad=partShipments.length>1||history.some(h=>{
    const moved=Math.max(Number(h.arrived?.pieces||0),Number(h.departed?.pieces||0),Number(h.validFow?.pieces||0));
    return masterPieces>0&&moved>0&&moved<masterPieces;
  });
  return{origin,destination,totalPieces:masterPieces,totalWeight:masterWeight,arrivedPieces:arrived.pieces,arrivedWeight:arrived.weight,pendingPieces:remaining.pieces,pendingWeight:remaining.weight,isPartLoad:arrived.pieces>0&&arrived.pieces<masterPieces,partLoad:hadSplitLoad,status,loadStatus,discrepancy,flightNo:resolvedFlightNo,flightDate:resolvedFlightDate,flightDestination:selected?.destination||destination||'',arrivalDate:(fully||arrived.pieces>0)?(actual?.date||expectedDate):expectedDate,arrivalTime:(fully||arrived.pieces>0)?(actual?.time||expectedTime):expectedTime,arrivalIsActual:fully,flightConfirmed,arrivalDateSource:fully?'SAL actual destination arrival':(expectedDate?'SAL latest Delhi flight assignment':''),sourceStatus:selected.code||'',airport:selected.airport||'',events,partLoadHistory:history,partShipments};}

export async function trackSaudiaStrong(input){const mawb=normalizeMawb(input);if(!mawb||!mawb.replace(/\D/g,'').startsWith('065'))return{ok:false,reason:'NOT SAUDIA'};try{const endpoint=`${API}?trackId=${encodeURIComponent(mawb)}&CurrentCulture=en-us`;const res=await fetch(endpoint,{headers:{Accept:'application/json','Accept-Language':'en-US,en;q=0.9',Referer:URL},cache:'no-store'});const text=await res.text();let outer;try{outer=JSON.parse(text)}catch{return{ok:false,reason:`SAL HTTP ${res.status} NON-JSON`,debug:{stage:'SAL_NON_JSON'}}}let data=outer?.message;if(typeof data==='string')try{data=JSON.parse(data)}catch{}if(!res.ok||!data||typeof data!=='object')return{ok:false,reason:'SAL DID NOT RETURN SHIPMENT DATA',debug:{stage:'SAL_NO_DATA'}};const r=reconcile(data);if(!r.events.length)return{ok:false,reason:'SAL HAS NO TIMELINE EVENTS',debug:{stage:'SAL_EMPTY_TIMELINE'}};const arrivedDisplay=r.isPartLoad&&r.arrivedPieces>0&&r.totalPieces?`${r.arrivedPieces}/${r.totalPieces}`:(r.totalPieces||'');const weightDisplay=r.isPartLoad&&r.arrivedWeight>0&&r.totalWeight?`${r.arrivedWeight}/${r.totalWeight}`:(r.totalWeight||'');const shipment={mawb,carrierCode:'SV',airlineName:'Saudia Cargo',officialTracker:URL,origin:r.origin,destination:r.destination,pieces:arrivedDisplay,bags:arrivedDisplay,weight:weightDisplay,totalPieces:r.totalPieces,arrivedPieces:r.arrivedPieces,pendingPieces:r.pendingPieces,totalWeight:r.totalWeight,arrivedWeight:r.arrivedWeight,pendingWeight:r.pendingWeight,isPartLoad:r.isPartLoad,partLoad:r.partLoad===true,flightNo:r.flightNo,flightDate:r.flightDate,flightDestination:r.flightDestination,arrivalDate:r.arrivalDate,arrivalTime:r.arrivalTime,arrivalIsActual:r.arrivalIsActual,status:r.status,loadStatus:r.loadStatus,discrepancy:r.discrepancy,sourceStatus:r.sourceStatus,airport:r.airport,source:'SAL complete shipment chronology',partLoadHistory:r.partLoadHistory,partShipments:r.partShipments||[]};return{ok:true,shipment,officialTracker:URL,debug:{stage:'SAL_FULL_CHRONOLOGY_SUCCESS',eventCount:r.events.length,timelineComplete:true}};}catch(e){return{ok:false,reason:`SAL FULL CHRONOLOGY ERROR: ${e?.message||e}`,debug:{stage:'SAL_ERROR'}};}}