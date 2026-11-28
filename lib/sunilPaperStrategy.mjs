// Experimental paper research. No broker order or automatic real-money entry.
// Source rules: user-supplied TWS screenshots; exact assumptions are marked below.
export const SUNIL_CONFIG = Object.freeze({
  largeGap:100, nearLevel:10, roundStep:1000, roundBuffer:50, flatGap:20,
  rangeTolerance:10, consolidationPct:0.10, minConsolidationBars:4,
  maxConsolidationBars:5, initialRisk:20, protection:40, extended:80,
  trailTrigger:100, trailLock:60, maxSpreadFraction:0.02
});
export const SUNIL_RULES = Object.freeze([
  {id:'morning',status:'RESEARCH',source:'Large opening gap near 100 points; exact entry unresolved'},
  {id:'closing',status:'RESEARCH',source:'Previous closing/day low retest for smaller gap; exact entry unresolved'},
  {id:'five_minute',status:'RESEARCH',source:'Mark first 5-minute high and low on index, CE and PE'},
  {id:'second_setup',status:'TESTABLE',source:'Pullback to first five-minute level; 4–5 sideways bars; break consolidation high; T1 current day high, T2 previous day high'},
  {id:'scalp',status:'RESEARCH',source:'1-minute confirmation; 8–10 buffer and 20-point SL discussed, exact trigger and units unresolved'},
  {id:'risk',status:'TESTABLE',source:'Flat open, round thousand levels, trapped opening range; thresholds are experimental'},
  {id:'three_chart',status:'TESTABLE',source:'Observe index and both option premium charts; premium decay caution'},
  {id:'profit',status:'TESTABLE',source:'30–40 points protection; 50:50 or CTC; market levels for targets'},
  {id:'trailing',status:'TESTABLE',source:'Example +100 points then lock +60; not a universal rule'},
  {id:'strike',status:'PENDING',source:'ATM/ITM/OTM selection not specified'},
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
export function scanSunil({date,now,indexRows,ceRows,peRows,quotes,aligned=false,contractVerified=false,cfg=SUNIL_CONFIG}){
  const index=levels(indexRows,date,now),ce=levels(ceRows,date,now),pe=levels(peRows,date,now);
  const risk=riskFilter(index,cfg),base={mode:'PAPER_RESEARCH_ONLY',risk,levels:{index:index&&{...index,bars:undefined},ce:ce&&{...ce,bars:undefined},pe:pe&&{...pe,bars:undefined}}};
  const wait=reason=>({...base,status:'WAIT',reason});
  if(!aligned||!contractVerified||!index||!ce||!pe)return wait('Verified same-expiry contracts and three complete charts required');
  if(risk.status!=='RESEARCH')return {...base,status:risk.status,reason:risk.reasons.join('; ')};
  const latest=index.bars.at(-1),t=barTime(latest);
  if(now<t+300000||now-t-300000>120000||[ce,pe].some(l=>barTime(l.bars.at(-1))!==t))return wait('Fresh synchronized candles required');
  const delta=l=>l.bars.at(-1)[4]-l.bars.at(-2)[4],direction=delta(index);
  if(delta(ce)<=0&&delta(pe)<=0)return wait('Both option premiums weak; possible decay');
  const side=direction>0&&delta(ce)>0&&delta(pe)<0?'CE':direction<0&&delta(pe)>0&&delta(ce)<0?'PE':null;
  if(!side)return wait('Three-chart directional confirmation missing');
  const plan=breakout(side==='CE'?ce:pe,cfg),q=quotes?.[side];
  if(!plan)return wait('Second setup: wait for retest, consolidation breakout and ordered targets');
  const qt=typeof q?.time==='number'?q.time:Date.parse(q?.time||'');
  if(!finite(q?.ask)||!finite(q?.bid)||q.bid<=0||q.ask<q.bid||(q.ask-q.bid)/q.ask>cfg.maxSpreadFraction||!finite(qt)||now-qt<0||now-qt>30000)return wait('Fresh executable two-sided quote required');
  if(q.ask<plan.trigger||q.ask>=plan.target1||q.ask<=cfg.initialRisk)return wait('Entry no longer valid');
  const stop=q.ask-cfg.initialRisk;
  return {...base,status:'PAPER_CANDIDATE',side,entry:q.ask,stop,target1:plan.target1,target2:plan.target2,plan,assumptions:['ATM candidate selection experimental, not source rule','5-minute consolidation timeframe and width experimental','Premium stop 20 points illustrative','No automatic order']};
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
    const target=m.id==='ORIGINAL_SL'?s.target2:Math.min(s.target2,s.entry+c.extended);
    if(bid>=target)sell(m.remaining,'TARGET');
    return m;
  });return s;
}
export function comparisonReport(s){
  return s.methods.map(m=>{const gross=m.fills.reduce((a,f)=>a+f.gross,0),charges=m.fills.reduce((a,f)=>a+f.charges,0);return {method:m.id,remainingLots:m.remaining,activeStop:m.stop,gross,exitCharges:charges,netBeforeEntryCharges:gross-charges,peakPoints:s.peak-s.entry,bookedPoints:gross/(s.lots*s.lotSize),coverageGap:Boolean(s.coverageGap)};});
}
