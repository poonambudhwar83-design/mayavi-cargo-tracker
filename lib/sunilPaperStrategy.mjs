// Experimental paper research. No broker order or automatic real-money entry.
// Source rules: user-supplied TWS screenshots; exact assumptions are marked below.
export const SUNIL_CONFIG = Object.freeze({
  largeGap:100, nearLevel:10, roundStep:1000, roundBuffer:50, flatGap:20,
  rangeTolerance:10, consolidationPct:0.10, minConsolidationBars:4,
  maxConsolidationBars:5, initialRisk:20, protection:40, extended:80,
  trailTrigger:100, trailLock:60, maxSpreadFraction:0.02,
  openingRisk:40, openingReward:80, openingEntryBuffer:10,
  morningEndMinute:690, morningLevelTolerance:10,
  stallBars:3, levelBaseBars:3, indexBaseWidth:60, indexBreakoutTolerance:10
});
export const SUNIL_RULES = Object.freeze([
  {id:'morning',status:'RESEARCH',source:'Large opening gap near 100 points; exact entry unresolved'},
  {id:'closing',status:'TESTABLE',source:'Prior close breakdown/retest: 5-minute context, 1-minute close below level and next candle breaks it (0:34–2:21); exact candle geometry is experimental'},
  {id:'morning_price_action',status:'TESTABLE',source:'Prefer morning, use price action without indicators; red candle near current and previous highs; candle-based index SL (0:17–2:43). Morning cutoff and target selection experimental'},
  {id:'five_minute',status:'TESTABLE',source:'Mark first 5-minute high and low on index, CE and PE'},
  {id:'direction_lock',status:'TESTABLE',source:'First option to break opening high sets direction; subsequent break of its opening low means ignore market for rest of session (3:43–5:08)'},
  {id:'opening_40_80',status:'TESTABLE',source:'First option opening-high break or retest; 40 premium point risk and 80 point target example (1:02–2:47, 5:30–5:53)'},
  {id:'second_setup',status:'TESTABLE',source:'Pullback to first five-minute level; 4–5 sideways bars; break consolidation high; T1 current day high, T2 previous day high'},
  {id:'second_opposite',status:'TESTABLE',source:'Second Setup 3:23–3:46: after initial premium move, consolidate at opening low; low break permits opposite-side planning. Separate research variant, not an override of strict session lock'},
  {id:'second_hold_5_6',status:'RESEARCH',source:'Separate morning trade recap 0:51–1:17: 5–6 candle hold would support a call plan; exact level/timeframe not fully visible; variant only'},
  {id:'scalp',status:'RESEARCH',source:'1-minute confirmation; 8–10 buffer and 20-point SL discussed, exact trigger and units unresolved'},
  {id:'risk',status:'TESTABLE',source:'Flat open, round thousand levels, trapped opening range; thresholds are experimental'},
  {id:'three_chart',status:'TESTABLE',source:'Observe index and both option premium charts; premium decay caution'},
  {id:'profit',status:'TESTABLE',source:'30–40 points protection; 50:50 or CTC; market levels for targets'},
  {id:'trailing',status:'TESTABLE',source:'Example +100 points then lock +60; not a universal rule'},
  {id:'strike',status:'TESTABLE',source:'Option chain video 3:28–4:58: prefer ATM/ITM, avoid OTM, compare premium speed; no precise ITM depth, speed window or capital threshold supplied'},
  {id:'indicator_free_chain',status:'TESTABLE',source:'Option chain video 0:48–1:25: Sunil says he does not use OI or volume for his setup. Quote freshness and spread are separate engineering checks'},
  {id:'stall_exit',status:'TESTABLE',source:'1:30–1:47: if successive candles do not break a reference high, consider early exit; fresh re-entry possible. Three completed bars and timeframe are testing interpretations'},
  {id:'index_level_consolidation',status:'TESTABLE',source:'3:16–4:28: wait for sideways near a known level, then breakout and matching option premium movement; do not chase fast breaks'},
  {id:'no_premature_entry',status:'TESTABLE',source:'2:11–2:28: do not enter before setup activates'},
  {id:'recovery_size',status:'RESEARCH',source:'Personal example switched CE to PE and increased lots; conflicts with separate direction-lock rule. No automatic size increase or loss-recovery entry implemented'},
  {id:'paramanu',status:'PENDING',source:'Exact conditions not supplied'},
  {id:'expiry',status:'PENDING',source:'Exact conditions not supplied'}
]);
const barTime=b=>Date.parse(b[0]);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const valid=b=>Array.isArray(b)&&b.length>=5&&Number.isFinite(barTime(b))&&b.slice(1,5).every(x=>finite(x)&&x>0)&&b[2]>=Math.max(b[1],b[4])&&b[3]<=Math.min(b[1],b[4]);
const day=t=>new Date(t+19800000).toISOString().slice(0,10);
const start=d=>Date.parse(d+'T09:15:00+05:30');
const end=d=>Date.parse(d+'T15:30:00+05:30');
export function completedBars(rows,date,now,minutes=5){
  const step=minutes*60000,s=start(date),e=end(date),out=new Map();
  for(const b of rows||[]){if(!valid(b))continue;const t=barTime(b);if(t>=s&&t+step<=Math.min(e,now)&&(t-s)%step===0)out.set(t,b);}
  return [...out.values()].sort((a,b)=>barTime(a)-barTime(b));
}
function contiguous(bars,step=300000){return bars.every((b,i)=>i===0||barTime(b)-barTime(bars[i-1])===step);}
const high=b=>Math.max(...b.map(x=>x[2]));
const low=b=>Math.min(...b.map(x=>x[3]));
export function levels(rows,date,now){
  const t=completedBars(rows,date,now),days=[...new Set((rows||[]).filter(valid).map(b=>day(barTime(b))).filter(d=>d<date))].sort();
  const prev=days.at(-1),p=prev?completedBars(rows,prev,end(prev)):[],prev2=days.at(-2),p2=prev2?completedBars(rows,prev2,end(prev2)):[];
  const complete=p.length===75&&contiguous(p)&&barTime(p[0])===start(prev);
  const complete2=p2.length===75&&contiguous(p2)&&barTime(p2[0])===start(prev2);
  if(!t.length||barTime(t[0])!==start(date)||!contiguous(t))return null;
  return {bars:t,firstHigh:t[0][2],firstLow:t[0][3],open:t[0][1],dayHigh:high(t),dayLow:low(t),previousHigh:complete?high(p):null,previousLow:complete?low(p):null,previousClose:complete?p.at(-1)[4]:null,twoSessionsBackLow:complete2?low(p2):null};
}
function near(a,b,t){return finite(a)&&finite(b)&&Math.abs(a-b)<=t;}
export function riskFilter(l,cfg=SUNIL_CONFIG){
  if(!l||!finite(l.previousClose))return {status:'WAIT',reasons:['Complete current and previous session needed']};
  const spot=l.bars.at(-1)[4],gap=l.open-l.previousClose,round=Math.round(spot/cfg.roundStep)*cfg.roundStep,reasons=[];
  if(Math.abs(gap)<=cfg.flatGap)reasons.push('Flat opening (experimental threshold)');
  if(near(spot,round,cfg.roundBuffer))reasons.push('Near round thousand level (experimental buffer)');
  if(l.bars.length<2||l.bars.slice(1).every(b=>b[2]<=l.firstHigh&&b[3]>=l.firstLow))reasons.push('Still inside opening range');
  return {status:reasons.length?'NO_TRADE':'RESEARCH',gap,round,setup:Math.abs(gap)>=cfg.largeGap?'MORNING_LARGE_GAP':'CLOSING_DAY_LOW',reasons};
}
// Independent morning index price-action research; never equate spot points to option premium.
export function scanMorningPriceAction({date,now,indexRows,indexMinuteRows,cfg=SUNIL_CONFIG}){
 const l=levels(indexRows,date,now),wait=reason=>({setup:'MORNING_PRICE_ACTION',status:'WAIT',reason,units:'INDEX_POINTS'});
 const minute=new Date(now+19800000),minuteOfDay=minute.getUTCHours()*60+minute.getUTCMinutes();
 if(minuteOfDay>=cfg.morningEndMinute)return wait('Outside experimental morning entry window (ends 11:30 IST)');
 if(!l||!finite(l.previousClose)||!finite(l.previousHigh)||!finite(l.previousLow))return wait('Complete previous session and first five-minute candle required');
 const a=completedBars(indexMinuteRows,date,now,1);
 if(a.length<5||barTime(a[0])!==start(date)||!contiguous(a,60000)||now-barTime(a.at(-1))-60000>90000)return wait('Fresh contiguous one-minute index candles required');
 const [touch,confirm,trigger]=a.slice(-3),tol=cfg.morningLevelTolerance;
 const prior=a.slice(0,-3),priorDayHigh=high(prior);
 const close=l.previousClose;
 const atLevel=(bar,v)=>bar[3]<=v+tol&&bar[2]>=v-tol;
 const below=(ref,confirmation,next)=>confirmation[4]<ref[3]&&next[4]<confirmation[3]&&next[4]<next[1];
 let pattern=null,reference=null;
 if(atLevel(touch,close)&&confirm[4]<close&&trigger[4]<close&&below(touch,confirm,trigger)){pattern='PREVIOUS_CLOSE_BREAKDOWN';reference=close;}
 else if(atLevel(touch,l.previousHigh)&&atLevel(touch,priorDayHigh)&&touch[4]<touch[1]&&below(touch,confirm,trigger)){pattern='CURRENT_PREVIOUS_HIGH_REJECTION';reference=l.previousHigh;}
 if(!pattern)return wait('No completed previous-close breakdown or coincident-high rejection');
 const entry=trigger[4],stop=Math.max(touch[2],confirm[2],trigger[2]);
 if(!(stop>entry))return wait('Invalid candle-based index stop');
 // Only previously observed support levels, sorted by proximity; no hindsight or fixed targets.
 const known=[l.firstLow,l.previousLow,l.twoSessionsBackLow,low(prior)];
 const supports=[...new Set(known.filter(x=>finite(x)&&x<entry))].sort((x,y)=>y-x);
 const risk=stop-entry;
 return {setup:'MORNING_PRICE_ACTION',status:'INDEX_PATTERN',pattern,side:'PE',units:'INDEX_POINTS',reference,spotTrigger:entry,spotStop:stop,spotTargets:supports.slice(0,2),risk,signalTime:barTime(trigger)+60000,assumptions:['11:30 cutoff and 10-point proximity experimental','Three completed one-minute candles and conservative pattern high stop are interpretations','Support targets are known levels; option premium entry/exit not inferred','Research only; no order']};
}
// Standalone diagnostics, not a new automatic paper entry. Use only completed bars.
export function stallExit({rows,date,now,entryAt,minutes=5,cfg=SUNIL_CONFIG}){
 const wait=reason=>({status:'WAIT',reason});
 if(!finite(entryAt)||entryAt>now)return wait('Actual paper entry timestamp required');
 const a=completedBars(rows,date,now,minutes).filter(b=>barTime(b)>=entryAt);
 if(!a.length||!contiguous(a,minutes*60000)||now-barTime(a.at(-1))-minutes*60000>90000)return wait('Fresh contiguous post-entry option candles required');
 let ref=a[0][2],refAt=barTime(a[0]),count=0;
 for(const b of a.slice(1)){if(b[2]>ref){ref=b[2];refAt=barTime(b);count=0;}else count++;}
 return {status:count>=cfg.stallBars?'EARLY_EXIT_RESEARCH':'HOLD_RESEARCH',referenceHigh:ref,referenceAt:refAt,failedBars:count,signalTime:barTime(a.at(-1))+minutes*60000,assumptions:['Three completed candles after the last high; timeframe configurable','Observed bid required for any paper exit']};
}
export function indexLevelBreakout({date,now,indexRows,ceRows,peRows,cfg=SUNIL_CONFIG}){
 const wait=reason=>({status:'WAIT',reason});
 const l=levels(indexRows,date,now),ce=levels(ceRows,date,now),pe=levels(peRows,date,now);
 const n=cfg.levelBaseBars;
 if(!l||!ce||!pe||l.bars.length<n+2)return wait('Three synchronized charts and consolidation history required');
 const a=l.bars,b=a.at(-1),t=barTime(b);
 if(now-t-300000>120000||[ce,pe].some(x=>barTime(x.bars.at(-1))!==t||barTime(x.bars.at(-2))!==t-300000))return wait('Fresh synchronized completed bars required');
 const base=a.slice(-n-1,-1),prior=a.slice(0,-n-1);
 const known=[l.previousClose,l.previousHigh,l.previousLow,l.twoSessionsBackLow,l.firstHigh,l.firstLow,high(prior),low(prior)].filter(finite);
 const top=high(base),bottom=low(base),tol=cfg.indexBreakoutTolerance;
 const up=b[4]>top&&b[4]>b[1],down=b[4]<bottom&&b[4]<b[1],side=up?'CE':down?'PE':null;
 if(!side)return wait('No completed range breakout');
 const boundary=up?top:bottom;
 const ref=known.filter(v=>Math.abs(v-boundary)<=tol).sort((x,y)=>Math.abs(x-boundary)-Math.abs(y-boundary))[0];
 if(!finite(ref)||top-bottom>cfg.indexBaseWidth||!base.every(x=>x[3]<=ref+cfg.indexBaseWidth&&x[2]>=ref-cfg.indexBaseWidth))return wait('No tight base at previously observed level; avoid chasing');
 const gain=x=>x.bars.at(-1)[4]-x.bars.at(-2)[4],selected=up?ce:pe,opposite=up?pe:ce;
 if(!(gain(selected)>0&&gain(opposite)<0))return wait('Index breakout without corresponding premium confirmation');
 const lock=openingDirection(ce,pe);
 return {status:'INDEX_PREMIUM_PATTERN',side,reference:ref,spotTrigger:b[4],baseHigh:top,baseLow:bottom,premiumChange:gain(selected),oppositeChange:gain(opposite),sessionGate:lock.status==='DIRECTION_LOCKED'&&lock.side===side?'DIRECTION_ALIGNED':'WAIT_OR_BLOCKED',signalTime:t+300000,assumptions:['Three 5-minute base bars, 60 index point width and 10 point proximity are experimental','No automatic entry, no inferred premium target']};
}
function breakout(l,cfg){
  const a=l.bars,signal=a.at(-1);if(a.length<7)return null;
  for(const n of [cfg.maxConsolidationBars,cfg.minConsolidationBars]){
    const base=a.slice(-n-1,-1),before=a.slice(0,-n-1);
    if(base.length!==n||before.length<2||!contiguous([...base,signal]))continue;
    const h=high(base),lo=low(base),mid=(h+lo)/2;
    const touch=[l.firstHigh,l.firstLow].find(v=>lo<=v+cfg.rangeTolerance&&h>=v-cfg.rangeTolerance);
    if(touch===undefined||h-lo>mid*cfg.consolidationPct||high(before)<=h||signal[4]<=h||signal[1]>h)continue;
    const dayTarget=high(a.slice(0,-1)),priorTarget=l.previousHigh;
    if(!finite(priorTarget)||!(dayTarget>signal[4]&&priorTarget>dayTarget))continue;
    return {trigger:h,rangeLow:lo,level:touch,target1:dayTarget,target2:priorTarget,signalTime:barTime(signal)+300000};
  }return null;
}
// Rebuild direction causally from the fixed pair's completed intraday bars.
// Wick breaks are an experimental interpretation; same-bar ordering is unknown.
export function openingDirection(ce,pe){
  if(!ce||!pe)return {status:'WAIT',reason:'Both opening ranges required'};
  const a=ce.bars,b=pe.bars;
  if(a.length!==b.length||a.some((x,i)=>barTime(x)!==barTime(b[i])))return {status:'WAIT',reason:'Option histories not synchronized'};
  let side=null,breakIndex=null;
  for(let i=1;i<a.length;i++){
    const hits=[a[i][2]>ce.firstHigh,b[i][2]>pe.firstHigh];
    if(!side){
      if(hits[0]&&hits[1])return {status:'NO_TRADE',reason:'Both opening highs broke in the same candle; order unknown',ambiguous:true,at:barTime(a[i])+300000};
      if(!hits.some(Boolean))continue;
      side=hits[0]?'CE':'PE';breakIndex=i;
    }
    const l=side==='CE'?ce:pe,bar=l.bars[i];
    if(bar[3]<l.firstLow)return {status:'NO_TRADE',side,breakIndex,at:barTime(bar)+300000,reason:'First high-break option subsequently broke opening low (or same-bar order unknown); session locked'};
  }
  return side?{status:'DIRECTION_LOCKED',side,breakIndex,at:barTime(a[breakIndex])+300000}:{status:'WAIT',reason:'Neither option has broken its opening high'};
}
// Separate source variant. Never overrides strict direction lock or creates an order.
export function secondOppositeResearch({date,now,indexRows,ceRows,peRows,cfg=SUNIL_CONFIG}){
 const wait=reason=>({status:'WAIT',reason,setup:'SECOND_OPPOSITE'});
 const ix=levels(indexRows,date,now),ce=levels(ceRows,date,now),pe=levels(peRows,date,now);
 if(!ix||!ce||!pe||ix.bars.length<7)return wait('Three complete charts required');
 const t=barTime(ix.bars.at(-1));
 if(now-t-300000>120000||[ce,pe].some(l=>barTime(l.bars.at(-1))!==t))return wait('Fresh synchronized candles required');
 const firstBreak=l=>l.bars.findIndex((b,i)=>i>0&&b[2]>l.firstHigh);
 const ci=firstBreak(ce),pi=firstBreak(pe);
 if(ci===pi||ci<0&&pi<0)return wait('Initial option high-break direction unclear');
 const initial=pi<0||ci>=0&&ci<pi?'CE':'PE',opposite=initial==='CE'?'PE':'CE',lead=initial==='CE'?ce:pe,other=initial==='CE'?pe:ce,first=initial==='CE'?ci:pi;
 const a=lead.bars,last=a.at(-1),lo=lead.firstLow;
 // A fresh break after consolidation around opening low; prior low breaks invalidate this variant.
 for(const n of [5,4]){
   const base=a.slice(-n-1,-1),before=a.slice(0,-n-1);
   if(base.length!==n||before.length<=first||a.slice(first,-1).some(b=>b[3]<lo))continue;
   if(base.some(b=>b[3]<lo)||low(base)>lo+cfg.rangeTolerance||high(base)-low(base)>((high(base)+low(base))/2)*cfg.consolidationPct)continue;
   if(last[4]>=lo||last[4]>=low(base))continue;
   const delta=l=>l.bars.at(-1)[4]-l.bars.at(-2)[4];
   if(!(delta(lead)<0&&delta(other)>0&&(opposite==='CE'?delta(ix)>0:delta(ix)<0)))return wait('Opposite premium and index confirmation missing');
   return {status:'OPPOSITE_WATCH',setup:'SECOND_OPPOSITE',initialSide:initial,side:opposite,brokenPremiumLow:lo,baseBars:n,signalTime:t+300000,strictStrategyBlocked:true,assumptions:['Separate conflicting source variant; no executable entry, stop or target supplied','Completed 5-minute candles and consolidation width experimental']};
 }
 return wait('No fresh opening-low consolidation breakdown');
}
export function secondHoldVariant({date,now,rows,cfg=SUNIL_CONFIG}){
 const l=levels(rows,date,now);if(!l)return {status:'WAIT',reason:'Opening range unavailable'};
 const a=l.bars,last=a.at(-1),t=barTime(last);
 if(now-t-300000>120000)return {status:'WAIT',reason:'Stale candles'};
 for(const n of [6,5]){
  if(a.length<n+3)continue;
  const base=a.slice(-n-1,-1),prior=a.slice(0,-n-1),h=high(base),lo=low(base);
  const ref=[l.firstHigh,l.firstLow].find(v=>lo<=v+cfg.rangeTolerance&&h>=v-cfg.rangeTolerance);
  if(ref===undefined||h-lo>((h+lo)/2)*cfg.consolidationPct||high(prior)<=h||last[4]<=h)continue;
  const t1=high(a.slice(0,-1)),t2=l.previousHigh;
  return {status:'HOLD_BREAKOUT_WATCH',baseBars:n,reference:ref,trigger:h,target1:t1>last[4]?t1:null,target2:finite(t2)&&t2>Math.max(t1,last[4])?t2:null,signalTime:t+300000,assumptions:['5–6 completed bars and opening level are provisional; source exact level unclear','Research observation only']};
 }
 return {status:'WAIT',reason:'No 5–6 bar hold and breakout'};
}
function openingCandidate(l,lock,q,now,cfg){
  const a=l.bars,i=a.length-1,last=a[i],prev=a[i-1],h=l.firstHigh,lo=l.firstLow;
  if(!prev)return null;
  const initial=i===lock.breakIndex&&last[4]>h;
  const highRetest=i>lock.breakIndex&&last[3]<=h+cfg.openingEntryBuffer&&last[3]>=lo&&last[4]>h&&last[4]>last[1];
  const lowRetest=i>lock.breakIndex&&last[3]<=lo+cfg.openingEntryBuffer&&last[3]>=lo&&last[4]>last[1]&&last[4]>prev[4];
  if(!initial&&!highRetest&&!lowRetest)return null;
  const level=lowRetest&&!highRetest?lo:h;
  const qt=typeof q?.time==='number'?q.time:Date.parse(q?.time||'');
  if(!finite(q?.ask)||!finite(q?.bid)||q.bid<=0||q.ask<q.bid||(q.ask-q.bid)/q.ask>cfg.maxSpreadFraction||!finite(qt)||now-qt<0||now-qt>30000)return null;
  if(q.ask<level||q.ask>level+cfg.openingEntryBuffer||q.ask<=cfg.openingRisk)return null;
  return {setup:'OPENING_40_80',trigger:initial?'FIRST_HIGH_BREAK':highRetest?'HIGH_RETEST':'LOW_HOLD',side:lock.side,entry:q.ask,stop:q.ask-cfg.openingRisk,target:q.ask+cfg.openingReward,signalTime:barTime(last)+300000,assumptions:['Completed candle confirmation and 10-point entry buffer experimental','Fixed 40/80 premium points are the video example','No automatic execution']};
}
// Strike moneyness is based on underlying vs strike, never relative premium price.
// Keep opening pair for session direction-lock; live strike comparison is a separate research watch.
export function strikeUniverse(spot,strikes,side){
 if(!finite(spot)||spot<=0||!['CE','PE'].includes(side))return [];
 const all=[...new Set((strikes||[]).filter(x=>finite(x)&&x>0))].sort((a,b)=>a-b);
 if(!all.length||spot<all[0]||spot>all.at(-1))return [];
 // Nearest listed strike is conventional ATM proxy; deterministic lower-strike tie.
 const atm=all.reduce((a,b)=>Math.abs(b-spot)<Math.abs(a-spot)?b:a);
 const itm=all.filter(k=>side==='CE'?k<spot&&k!==atm:k>spot&&k!==atm).sort((a,b)=>Math.abs(a-spot)-Math.abs(b-spot))[0];
 return [{strike:atm,type:'ATM'},...(finite(itm)?[{strike:itm,type:'ITM'}]:[])];
}
export function compareStrikeSpeed({date,now,spot,side,strikes,candidates,cfg=SUNIL_CONFIG}){
 const universe=strikeUniverse(spot,strikes,side),watch={status:'WAIT',side,referenceSpot:spot,eligible:universe,assumptions:['Nearest listed ATM and one nearest ITM are experimental depth choices','Speed = signed premium points per minute over three completed five-minute candles; no OI or volume ranking','Quote freshness uses last trade; no actual fill or entry']};
 if(universe.length!==2)return {...watch,reason:'Both ATM and ITM strikes required'};
 const out=[];
 for(const u of universe){
  const c=(candidates||[]).find(x=>x.strike===u.strike&&x.side===side);
  const a=completedBars(c?.rows,date,now).slice(-4),q=c?.quote,qt=typeof q?.time==='number'?q.time:Date.parse(q?.time||'');
  if(a.length!==4||!contiguous(a)||now-barTime(a.at(-1))-300000>120000||!finite(q?.bid)||!finite(q?.ask)||q.bid<=0||q.ask<q.bid||(q.ask-q.bid)/q.ask>cfg.maxSpreadFraction||!finite(qt)||now-qt<0||now-qt>30000)return {...watch,reason:'Both eligible contracts need fresh candles and two-sided quotes'};
  const points=a.at(-1)[4]-a[0][4];out.push({...u,speed:points/15,points,premium:a.at(-1)[4],ask:q.ask,bid:q.bid,quoteTime:qt,completedAt:barTime(a.at(-1))+300000});
 }
 if(out[0].completedAt!==out[1].completedAt)return {...watch,reason:'ATM and ITM candle windows must match'};
 const ranked=out.sort((a,b)=>b.speed-a.speed||Number(b.type==='ATM')-Number(a.type==='ATM'));
 return {...watch,status:ranked[0].speed>0?'STRIKE_SPEED_WATCH':'WAIT',reason:ranked[0].speed>0?'Positive premium speed comparison only; separate setup and risk gates still required':'Neither eligible premium has positive speed',ranked,preferred:ranked[0].speed>0?ranked[0]:null};
}
export function scanSunil({date,now,indexRows,ceRows,peRows,quotes,aligned=false,contractVerified=false,cfg=SUNIL_CONFIG}){
  const index=levels(indexRows,date,now),ce=levels(ceRows,date,now),pe=levels(peRows,date,now);
  const risk=riskFilter(index,cfg),directionLock=openingDirection(ce,pe),levelBreakout=indexLevelBreakout({date,now,indexRows,ceRows,peRows,cfg}),base={secondOpposite:secondOppositeResearch({date,now,indexRows,ceRows,peRows,cfg}),secondHold:{CE:secondHoldVariant({date,now,rows:ceRows,cfg}),PE:secondHoldVariant({date,now,rows:peRows,cfg})},levelBreakout,directionLock,mode:'PAPER_RESEARCH_ONLY',risk,levels:{index:index&&{...index,bars:undefined},ce:ce&&{...ce,bars:undefined},pe:pe&&{...pe,bars:undefined}}};
  const wait=reason=>({...base,status:'WAIT',reason});
  if(!aligned||!contractVerified||!index||!ce||!pe)return wait('Verified same-expiry contracts and three complete charts required');
  if(directionLock.status==='NO_TRADE')return {...base,status:'NO_TRADE',reason:directionLock.reason};
  if(risk.status!=='RESEARCH')return {...base,status:risk.status,reason:risk.reasons.join('; ')};
  const latest=index.bars.at(-1),t=barTime(latest);
  if(now<t+300000||now-t-300000>120000||[ce,pe].some(l=>barTime(l.bars.at(-1))!==t))return wait('Fresh synchronized candles required');
  const delta=l=>l.bars.at(-1)[4]-l.bars.at(-2)[4],direction=delta(index);
  if(delta(ce)<=0&&delta(pe)<=0)return wait('Both option premiums weak; possible decay');
  const side=direction>0&&delta(ce)>0&&delta(pe)<0?'CE':direction<0&&delta(pe)>0&&delta(ce)<0?'PE':null;
  if(!side)return wait('Three-chart directional confirmation missing');
  if(directionLock.side!==side||directionLock.status!=='DIRECTION_LOCKED')return wait('Wait for the first high-break direction; no CE/PE switching');
  base.confirmedSide=side;
  const opening40_80=openingCandidate(side==='CE'?ce:pe,directionLock,quotes?.[side],now,cfg);
  if(opening40_80)base.opening40_80=opening40_80;
  const plan=breakout(side==='CE'?ce:pe,cfg),q=quotes?.[side];
  if(!plan)return opening40_80?{...base,status:'PAPER_CANDIDATE',side,entry:opening40_80.entry,stop:opening40_80.stop,target1:opening40_80.target,target2:null,plan:opening40_80}:wait('Second setup: wait for retest, consolidation breakout and ordered targets');
  const qt=typeof q?.time==='number'?q.time:Date.parse(q?.time||'');
  if(!finite(q?.ask)||!finite(q?.bid)||q.bid<=0||q.ask<q.bid||(q.ask-q.bid)/q.ask>cfg.maxSpreadFraction||!finite(qt)||now-qt<0||now-qt>30000)return wait('Fresh executable two-sided quote required');
  if(q.ask<plan.trigger||q.ask>=plan.target1||q.ask<=cfg.initialRisk)return wait('Entry no longer valid');
  const stop=q.ask-cfg.initialRisk;
  return {...base,status:'PAPER_CANDIDATE',side,entry:q.ask,stop,target1:plan.target1,target2:plan.target2,plan,assumptions:['ATM candidate selection experimental, not source rule','5-minute consolidation timeframe and width experimental','Premium stop 20 points illustrative','No automatic order']};
}
// Deterministic paper-only arbitration; priority is fixed before observations.
export function selectSunilSetup({scan,morning=null,now,cfg=SUNIL_CONFIG}){
 const wait=(reason,status='WAIT',watch=null)=>({status,reason,watch,paperOnly:true});
 if(!scan||!finite(now))return wait('No verified scan');
 if(scan.status==='NO_TRADE'||scan.directionLock?.status==='NO_TRADE'||scan.risk?.status==='NO_TRADE')return wait(scan.reason||'Risk filter blocked this session','NO_TRADE');
 if(scan.risk?.status!=='RESEARCH'||scan.directionLock?.status!=='DIRECTION_LOCKED')return wait('Risk and direction confirmation required');
 const ist=new Date(now+19800000),minute=ist.getUTCHours()*60+ist.getUTCMinutes(),morningWindow=minute<cfg.morningEndMinute;
 const validPlan=p=>finite(p?.entry)&&finite(p?.stop)&&finite(p?.target1)&&p.stop>0&&p.entry>p.stop&&p.target1>p.entry;
 const selected=(setup,p)=>({status:'PAPER_CANDIDATE',setup,side:p.side,entry:p.entry,stop:p.stop,target1:p.target1,target2:finite(p.target2)&&p.target2>p.target1?p.target2:null,riskPoints:p.entry-p.stop,rewardPoints:p.target1-p.entry,paperOnly:true,units:'OPTION_PREMIUM_POINTS',reason:'Predefined setup priority, not a real order'});
 if(scan.status==='PAPER_CANDIDATE'&&scan.side===scan.directionLock.side){
  const o=scan.opening40_80;
  if(morningWindow&&o&&o.side===scan.side&&validPlan({...o,target1:o.target}))return selected('MORNING_OPENING_40_80',{...o,target1:o.target});
  if(scan.plan?.setup!=='OPENING_40_80'&&validPlan(scan))return selected('SECOND_RETEST_CONSOLIDATION',scan);
 }
 if(morningWindow&&morning?.status==='INDEX_PATTERN'&&morning.side===scan.directionLock.side)return wait('Morning index pattern; actual option premium entry and SL not confirmed','WATCH','MORNING_PREVIOUS_CLOSE');
 if(scan.levelBreakout?.status==='INDEX_PREMIUM_PATTERN')return wait('Level breakout observed; premium entry and target not confirmed','WATCH','LEVEL_CONSOLIDATION');
 return wait('No complete eligible setup; do not force a trade');
}
// Deterministic paper-only router. Source patterns and experimental policy remain separate.
export function selectSunilSetup({scan,morning,strikeResearch,selectedRows,date,now,spot,cfg=SUNIL_CONFIG}){
 const wait=(reason,extra={})=>({status:'WAIT',reason,...extra,paperOnly:true});
 if(!scan||!finite(now))return wait('Scan unavailable');
 if(scan.status==='NO_TRADE'||scan.directionLock?.status==='NO_TRADE')return {status:'NO_TRADE',reason:scan.reason||scan.directionLock.reason,paperOnly:true};
 if(scan.risk?.status!=='RESEARCH'||scan.directionLock?.status!=='DIRECTION_LOCKED')return wait('Risk or direction gate not passed');
 const side=scan.directionLock.side;
 const ranking=strikeResearch;
 if(ranking?.status!=='STRIKE_SPEED_WATCH'||ranking.side!==side||!ranking.preferred)return wait('Fresh ATM/ITM premium speed comparison needed',{side});
 const s=ranking.preferred;
 if(!finite(s.quoteTime)||now-s.quoteTime<0||now-s.quoteTime>30000)return wait('Preferred quote too old',{side});
 if(!['ATM','ITM'].includes(s.type)||!finite(s.ask)||!finite(s.bid)||s.bid<=0||s.ask<s.bid||!finite(s.completedAt)||now-s.completedAt<0||now-s.completedAt>120000)return wait('Preferred contract not fresh',{side});
 const l=levels(selectedRows,date,now);
 if(!l||l.bars.length<2||barTime(l.bars.at(-1))+300000!==s.completedAt)return wait('Selected contract own candles required',{side});
 if(l.bars.at(-1)[4]<=l.bars.at(-2)[4])return wait('Selected premium is not rising',{side});
 const elapsed=new Date(now+19800000),minute=elapsed.getUTCHours()*60+elapsed.getUTCMinutes();
 const build=(setup,stop,target1,target2,reason)=>{
  if(![stop,target1].every(finite)||!(0<stop&&stop<s.bid&&s.ask<target1))return wait('Invalid premium stop or target',{side,setup});
  const risk=s.ask-stop,reward=target1-s.ask;
  if(reward<risk)return wait('First target offers less than 1:1 reward/risk',{side,setup});
  return {status:'PAPER_PLAN',setup,side,strike:s.strike,strikeType:s.type,entry:s.ask,stop,target1,target2:finite(target2)&&target2>target1?target2:null,riskPoints:risk,targetPoints:reward,rr:reward/risk,reason,paperOnly:true,asOf:now,assumptions:['Priority order, 1:1 minimum and exact thresholds are experimental','Premium points only; no index-to-premium conversion','No orders or automatic paper registration']};
 };
 // Morning bearish price action requires an independently rising option and confirmed index direction.
 if(minute<cfg.morningEndMinute&&morning?.status==='INDEX_PATTERN'&&morning.side===side&&now-morning.signalTime>=0&&now-morning.signalTime<=90000&&scan.confirmedSide===side&&s.ask>20){
  const stop=s.ask-20,target=s.ask+30;
  return build('MORNING_PRICE_ACTION_20_30',stop,target,s.ask+35,'Confirmed morning index pattern; experimental 20-point premium SL, 30–35-point scalp targets');
 }
 // Same-direction opening 40/80 must also be confirmed on the selected premium itself.
 const a=l.bars,first=a.findIndex((b,i)=>i>0&&b[2]>l.firstHigh);
 const selectedLock=first>0&&!a.slice(first).some(b=>b[3]<l.firstLow)?{side,breakIndex:first}:null;
 const selectedOpening=selectedLock?openingCandidate(l,selectedLock,{ask:s.ask,bid:s.bid,time:s.quoteTime},now,cfg):null;
 // Quote timestamp was validated in strike ranking; never fabricate an execution.
 const retest=breakout(l,cfg);
 if(scan.confirmedSide!==side)return wait('Three-chart directional confirmation required',{side});
 if(retest&&s.ask>=retest.trigger&&s.ask<retest.target1&&s.ask>cfg.initialRisk)
  return build('SECOND_SETUP_4_5',s.ask-cfg.initialRisk,retest.target1,retest.target2,'Retest and consolidation on selected premium; actual observed day highs are targets');
 if(selectedOpening)return build('OPENING_40_80',selectedOpening.stop,selectedOpening.target,null,'Selected contract opening high break or retest; fixed 40/80 source example');
 if(scan.levelBreakout?.status==='INDEX_PREMIUM_PATTERN'&&scan.levelBreakout.side===side&&scan.levelBreakout.sessionGate==='DIRECTION_ALIGNED')
  return wait('Index consolidation watch; selected contract premium entry/stop not independently confirmed',{side,setup:'LEVEL_CONSOLIDATION'});
 return wait('No complete setup on selected contract; do not force a trade',{side});
}
// Compare identical entry on observed executable bids; no candle-high hindsight.
// For partial exits at least two whole lots; odd counts are rounded down.
export function createExitComparison({entry,stop,target1,target2,lots,lotSize,at,cfg=SUNIL_CONFIG}){
  if(![entry,stop,target1,target2,at].every(finite)||!(0<stop&&stop<entry&&entry<target1&&target1<target2)||!Number.isInteger(lots)||lots<1||!Number.isInteger(lotSize)||lotSize<1)throw Error('Invalid paper entry');
  const keys=lots>=2?['FIXED','HALF_CTC','FULL_CTC','TRAIL_100_60','ORIGINAL_SL']:['FIXED','FULL_CTC','TRAIL_100_60','ORIGINAL_SL'];
  return {entry,stop,target1,target2,lots,lotSize,at,lastAt:at,peak:entry,cfg,methods:keys.map(id=>({id,remaining:lots,stop,fills:[],protected:false}))};
}
export function observeExitComparison(state,{bid,at,forceClose=false,chargesPerFill=0}){
  if(!finite(bid)||bid<=0||!finite(at)||at<=state.lastAt||!finite(chargesPerFill)||chargesPerFill<0)return state;
  const s={...state,lastAt:at,peak:Math.max(state.peak,bid),coverageGap:Boolean(state.coverageGap||at-state.lastAt>90000)};
  s.methods=state.methods.map(old=>{
    const m={...old,fills:[...old.fills]};if(!m.remaining)return m;
    const sell=(n,reason)=>{if(n<=0)return;m.fills.push({lots:n,bid,at,reason,gross:(bid-s.entry)*n*s.lotSize,charges:chargesPerFill});m.remaining-=n;};
    const gain=bid-s.entry,c=s.cfg;
    if(forceClose||bid<=m.stop){sell(m.remaining,forceClose?'TIME_EXIT':'STOP');return m;}
    if(m.id==='FIXED'&&(gain>=c.protection||bid>=s.target1)){sell(m.remaining,'FIXED_OR_T1');return m;}
    if(m.id!=='ORIGINAL_SL'&&gain>=c.protection&&!m.protected){
      if(m.id==='HALF_CTC')sell(Math.floor(s.lots/2),'PARTIAL');
      m.stop=Math.max(m.stop,s.entry);m.protected=true;
    }
    if(m.id==='TRAIL_100_60'&&gain>=c.trailTrigger)m.stop=Math.max(m.stop,s.entry+c.trailLock);
    const target=['ORIGINAL_SL','TRAIL_100_60'].includes(m.id)?s.target2:Math.min(s.target2,s.entry+c.extended);
    if(bid>=target)sell(m.remaining,'TARGET');
    return m;
  });return s;
}
export function comparisonReport(s){
  return s.methods.map(m=>{const gross=m.fills.reduce((a,f)=>a+f.gross,0),charges=m.fills.reduce((a,f)=>a+f.charges,0);return {method:m.id,remainingLots:m.remaining,activeStop:m.stop,gross,exitCharges:charges,netBeforeEntryCharges:gross-charges,peakPoints:s.peak-s.entry,bookedPoints:gross/(s.lots*s.lotSize),coverageGap:Boolean(s.coverageGap)};});
}
