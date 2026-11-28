import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
import {initPaper,expirePaper,openPaper,observePaper,registerPaper,paperReport} from '../../../lib/stocksPaperPerformance.js';
import {scanSunil,SUNIL_RULES} from '../../../lib/sunilPaperStrategy.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const instruments={NIFTY:'NSE',BANKNIFTY:'NSE',SENSEX:'BSE',BEL:'NSE',HCLTECH:'NSE',RELIANCE:'NSE',HDFCBANK:'NSE'};
const retired=new Set(['RELIANCE','HDFCBANK','BEL','HCLTECH']);
const equityOptions=new Set(['BEL','HCLTECH','RELIANCE','HDFCBANK']);
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const ema=(a,n)=>{if(a.length<n)return null;let x=a.slice(0,n).reduce((s,v)=>s+v,0)/n;for(const v of a.slice(n))x+=(v-x)*2/(n+1);return x;};
function rsi(a){if(a.length<15)return null;let g=0,l=0;for(let i=1;i<=14;i++){const d=a[i]-a[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}g/=14;l/=14;for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(13*g+Math.max(0,d))/14;l=(13*l+Math.max(0,-d))/14;}return l===0?(g===0?50:100):100-100/(1+g/l);}
const istDate=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const stamp=c=>typeof c==='number'||(/^\d{10,13}$/.test(String(c)))?new Date(Number(c)<1e12?Number(c)*1000:Number(c)).toISOString():/(?:Z|[+-]\d\d:\d\d)$/.test(String(c))?String(c):String(c).replace(' ','T')+'+05:30';
function cleanCandles(rows){const unique=new Map();for(const c of rows||[]){if(!Array.isArray(c)||c.length<5||!c.slice(1,5).every(v=>num(v)!==null&&num(v)>0))continue;let t;try{t=Date.parse(stamp(c[0]));}catch{continue;}if(!Number.isFinite(t))continue;const a=[new Date(t).toISOString(),...c.slice(1,7).map(num)];if(a[2]<Math.max(a[1],a[4])||a[3]>Math.min(a[1],a[4]))continue;const ist=new Date(t+19800000),minute=ist.getUTCHours()*60+ist.getUTCMinutes();if(minute<555||minute>=930||(minute-555)%5!==0)continue;unique.set(t,a);}return [...unique.values()].sort((a,b)=>Date.parse(a[0])-Date.parse(b[0]));}
const histCache=new Map();
async function previousCandles(exchange,symbol,today){const k=exchange+'|'+symbol+'|'+today,hit=histCache.get(k);if(hit&&Date.now()-hit.at<3600000)return hit.rows;const start=new Date(Date.parse(today+'T00:00:00+05:30')-10*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});const end=new Date(Date.parse(today+'T00:00:00+05:30')-86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});const data=await provider('/v1/historical/candles',{exchange,segment:'CASH',groww_symbol:exchange+'-'+symbol,start_time:start+' 09:15:00',end_time:end+' 15:30:00',candle_interval:'5minute'});const rows=cleanCandles(data?.candles).filter(c=>istDate(c[0])<today);if(rows.length){if(histCache.size>20)for(const [key,v] of histCache)if(Date.now()-v.at>3600000)histCache.delete(key);histCache.set(k,{at:Date.now(),rows});}return rows;}
function technical(c){const a=c.map(x=>x[4]);const series=[];let e12=null,e26=null,signal=null;for(let i=0;i<a.length;i++){if(i===11)e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12;else if(i>11)e12+=(a[i]-e12)*2/13;if(i===25)e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;else if(i>25)e26+=(a[i]-e26)*2/27;if(e12!==null&&e26!==null)series.push(e12-e26);}
const macd=series.at(-1)??null;signal=ema(series,9);
const b=a.slice(-20),mid=b.length===20?b.reduce((s,v)=>s+v,0)/20:null,sd=mid===null?null:Math.sqrt(b.reduce((s,v)=>s+(v-mid)**2,0)/20);
let atr=null,up=null,down=null,st=null;const tr=[];for(let i=0;i<c.length;i++){const x=c[i],prev=c[i-1]?.[4];tr.push(prev===undefined?x[2]-x[3]:Math.max(x[2]-x[3],Math.abs(x[2]-prev),Math.abs(x[3]-prev)));if(i<9)continue;atr=i===9?tr.slice(0,10).reduce((s,v)=>s+v,0)/10:(atr*9+tr[i])/10;const h=(x[2]+x[3])/2,u=h+3*atr,d=h-3*atr;const oldUp=up,oldDown=down,oldSt=st;up=oldUp===null||u<oldUp||prev>oldUp?u:oldUp;down=oldDown===null||d>oldDown||prev<oldDown?d:oldDown;st=oldSt===null?up:oldSt===oldUp?(x[4]>up?down:up):(x[4]<down?up:down);}
return {ema50:ema(a,50),macd,macdSignal:signal,macdHist:macd===null||signal===null?null:macd-signal,bbMid:mid,bbUpper:mid===null?null:mid+2*sd,bbLower:mid===null?null:mid-2*sd,supertrend:st,supertrendDirection:st===null?null:a.at(-1)>st?'BULLISH':'BEARISH'};
}
function group15(rows){const groups=new Map();for(const c of rows){const t=Date.parse(c[0]),k=Math.floor(t/900000)*900000;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}return [...groups.entries()].filter(([k,a])=>a.length===3&&a.every((c,i)=>Date.parse(c[0])===k+i*300000)).map(([k,a])=>[new Date(k).toISOString(),a[0][1],Math.max(...a.map(c=>c[2])),Math.min(...a.map(c=>c[3])),a[2][4]]);}
const futuresCache=new Map(),futuresSnapshots=new Map();
async function fetchFuturesContext(exchange,symbol,expiries,today,now,spot){try{const cacheKey=exchange+'|'+symbol+'|'+today;let contract=futuresCache.get(cacheKey);if(!contract){const monthly=[...new Map(expiries.filter(x=>x>today).map(x=>[x.slice(0,7),x])).values()].slice(0,2);const candidates=[...new Set([expiries.find(x=>x>today),...monthly].filter(Boolean))].sort();const results=await Promise.all(candidates.map(async expiry=>{try{const p=await provider('/v1/historical/contracts',{exchange,underlying_symbol:symbol,expiry_date:expiry});const key=p?.contracts?.find(x=>typeof x==='string'&&x.endsWith('-FUT'));return key?{key,expiry}:null;}catch{return null;}}));contract=results.find(Boolean);if(contract)futuresCache.set(cacheKey,contract);}if(!contract)return {available:false,reason:'No non-expiry-day futures contract found.'};const p=await provider('/v1/historical/candles',{exchange,segment:'FNO',groww_symbol:contract.key,start_time:today+' 09:15:00',end_time:today+' 15:30:00',candle_interval:'5minute'});const rows=cleanCandles(p?.candles).filter(c=>istDate(c[0])===today&&Date.parse(c[0])+300000<=now);const last=rows.at(-1),first=rows[0];if(!last||!first)return {available:false,reason:'Futures candles unavailable.'};const fresh=now-Date.parse(last[0])-300000>=0&&now-Date.parse(last[0])-300000<420000;const validVol=rows.every(c=>c[5]!==null&&c[5]>=0);const volume=validVol?rows.reduce((a,c)=>a+c[5],0):0;const vwap=volume>0?rows.reduce((a,c)=>a+(c[2]+c[3]+c[4])/3*c[5],0)/volume:null;return {available:true,...contract,fresh,lastClose:last[4],asOf:last[0],vwap,volume:validVol?volume:null,oi:last[6]??null,oiChange:last[6]!=null&&first[6]!=null?last[6]-first[6]:null,sessionChange:last[4]-first[1],volumeRatio:rows.length>=6&&rows.slice(-6,-1).every(c=>c[5]!==null&&c[5]>0)&&last[5]!==null?last[5]/(rows.slice(-6,-1).reduce((a,c)=>a+c[5],0)/5):null,direction:vwap===null?null:last[4]>vwap?'BULLISH':last[4]<vwap?'BEARISH':'NEUTRAL'};}catch{return {available:false,reason:'Futures provider data unavailable.'};}}
async function futuresContext(exchange,symbol,expiries,today,now,spot){const k=exchange+'|'+symbol+'|'+today;let hit=futuresSnapshots.get(k);if(!hit||Date.now()-hit.at>30000){const promise=fetchFuturesContext(exchange,symbol,expiries,today,now,spot);hit={at:Date.now(),promise};futuresSnapshots.set(k,hit);if(futuresSnapshots.size>12)for(const [key,v] of futuresSnapshots)if(Date.now()-v.at>60000)futuresSnapshots.delete(key);}let timer;try{const f=await Promise.race([hit.promise,new Promise(resolve=>{timer=setTimeout(()=>resolve({available:false,reason:'Futures lookup timeout; no points awarded.'}),6500);})]);return f.available?{...f,fresh:Date.now()-Date.parse(f.asOf)-300000>=0&&Date.now()-Date.parse(f.asOf)-300000<420000}:f;}finally{clearTimeout(timer);}}
function parseLeg(x){const g=x?.greeks||{};return {key:x?.trading_symbol||null,ltp:num(x?.ltp),oi:num(x?.open_interest),oiChange:null,volume:num(x?.volume),bid:null,ask:null,iv:num(g.iv),delta:num(g.delta),theta:num(g.theta),gamma:num(g.gamma),quoteTime:null};}
let cachedToken=null,tokenUntil=0,tokenRequest=null;
async function accessToken(){
if(!process.env.GROWW_API_KEY||!process.env.GROWW_API_SECRET)throw new Error('Market provider credentials missing. Configure GROWW_API_KEY and GROWW_API_SECRET securely.');
if(cachedToken&&Date.now()<tokenUntil)return cachedToken;
if(tokenRequest)return tokenRequest;
tokenRequest=(async()=>{const timestamp=String(Math.floor(Date.now()/1000)),checksum=createHash('sha256').update(process.env.GROWW_API_SECRET+timestamp).digest('hex');
const res=await fetch('https://api.groww.in/v1/token/api/access',{method:'POST',headers:{Authorization:'Bearer '+process.env.GROWW_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({key_type:'approval',checksum,timestamp}),cache:'no-store',signal:AbortSignal.timeout(12000)});
if(!res.ok)throw new Error('Market provider authentication HTTP '+res.status+'. Check daily Groww approval and API credentials.');
const body=await res.json();if(typeof body.token!=='string'||body.isActive===false)throw new Error('Market provider approval pending. Approve your API key on Groww.');
const raw=String(body.expiry||'').replace(' ','T'),expiry=Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(raw)?raw:raw+'+05:30');cachedToken=body.token;tokenUntil=Number.isFinite(expiry)&&expiry>Date.now()+30000?Math.min(expiry-30000,Date.now()+21600000):Date.now()+600000;return cachedToken;
})().finally(()=>{tokenRequest=null});return tokenRequest;
}
const providerCache=new Map(),pendingRequests=new Map();
let nextProviderAt=0,providerCooldownUntil=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function provider(path,params={}){
const url=new URL('https://api.groww.in'+path);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
const key=url.toString(),ttl=path.endsWith('/expiries')||path.endsWith('/contracts')?3600000:path.endsWith('/candles')?60000:path.endsWith('/ltp')||path.includes('/option-chain/')||path.endsWith('/quote')?15000:5000;
const hit=providerCache.get(key);if(hit&&Date.now()-hit.at<ttl)return hit.payload;
if(providerCooldownUntil>Date.now())throw new Error('Market provider HTTP 429 — cooling down; no fresh entry.');
if(pendingRequests.has(key))return pendingRequests.get(key);
const job=(async()=>{const at=Math.max(Date.now(),nextProviderAt);nextProviderAt=at+750;await delay(Math.max(0,at-Date.now()));if(providerCooldownUntil>Date.now())throw new Error('Market provider HTTP 429 — cooling down; no fresh entry.');
const res=await fetch(url,{headers:{Authorization:'Bearer '+await accessToken(),Accept:'application/json','X-API-VERSION':'1.0'},cache:'no-store',signal:AbortSignal.timeout(12000)});
if(res.status===401){cachedToken=null;tokenUntil=0;}
if(res.status===429){const raw=res.headers.get('retry-after'),seconds=raw?Number(raw):NaN,date=raw?Date.parse(raw):NaN,wait=Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-Date.now():60000;providerCooldownUntil=Date.now()+Math.max(60000,wait);throw new Error('Market provider HTTP 429 — rate limit; automatic cooldown active.');}
if(!res.ok)throw new Error('Market provider HTTP '+res.status+' (check Groww approval or subscription).');const body=await res.json();if(body.status!=='SUCCESS')throw new Error('Market provider did not return successful data.');
providerCache.set(key,{at:Date.now(),payload:body.payload});if(providerCache.size>200){for(const [k,v] of providerCache)if(Date.now()-v.at>60000)providerCache.delete(k);while(providerCache.size>200)providerCache.delete(providerCache.keys().next().value);}return body.payload;})().finally(()=>pendingRequests.delete(key));pendingRequests.set(key,job);return job;}
function normalizeQuoteTime(v){const n=num(v);let t=n===null?(typeof v==='string'?Date.parse(stamp(v)):NaN):n>=1e15?n/1000:n>=1e12?n:n>=1e9?n*1000:NaN;return Number.isFinite(t)&&t>=Date.UTC(2020,0,1)&&t<=Date.now()+10000?Math.floor(t):null;}
function bookQuote(q){
const positive=v=>{const n=num(v);return n!==null&&n>0?n:null;};
const levels=side=>Array.isArray(side)?side.map(x=>({price:positive(x?.price),qty:positive(x?.quantity)})).filter(x=>x.price!==null&&x.qty!==null):[];
const buys=levels(q?.depth?.buy).sort((a,b)=>b.price-a.price),sells=levels(q?.depth?.sell).sort((a,b)=>a.price-b.price);
const topBid=positive(q?.bid_price),topAsk=positive(q?.offer_price),depthBid=buys[0]?.price??null,depthAsk=sells[0]?.price??null;
const valid=(b,a)=>b!==null&&a!==null&&a>=b;
if(valid(topBid,topAsk)&&num(q?.bid_quantity)!==0&&num(q?.offer_quantity)!==0)return {bid:topBid,ask:topAsk,source:'top quote'};
if(valid(depthBid,depthAsk))return {bid:depthBid,ask:depthAsk,source:'market depth'};
return {bid:null,ask:null,source:'unavailable'};
}
async function enrich(exchange,leg){if(!leg.key)return;try{const q=await provider('/v1/live-data/quote',{exchange,segment:'FNO',trading_symbol:leg.key});const book=bookQuote(q);leg.bid=book.bid;leg.ask=book.ask;leg.bookSource=book.source;leg.quoteStatus=book.source==='unavailable'?'No valid two-sided book returned':'Book available';leg.oiChange=num(q.oi_day_change);if(leg.oiChange===null&&num(q.open_interest)!==null&&num(q.previous_open_interest)!==null)leg.oiChange=num(q.open_interest)-num(q.previous_open_interest);leg.quoteTime=normalizeQuoteTime(q.last_trade_time);leg.quoteLtp=num(q.last_price);if(num(q.volume)!==null)leg.volume=num(q.volume);}catch(e){leg.quoteStatus=/429/.test(e?.message||'')?'Rate limited':'Quote request unavailable';/* Never fabricate. */}}

// Regular technical paper strategy v2. Premium levels are observed historical levels, never fixed percentages.
function premiumLevels(rows,entry,bid,underlyingStop,context){
 const fail=reason=>({ok:false,reason});
 if(rows.length<15||!(entry>=bid&&bid>0)||!Number.isFinite(underlyingStop))return fail('Insufficient premium candles or executable quote / spot structure.');
 const last=rows.at(-1),closes=rows.map(c=>c[4]),e=ema(closes,9),r=rsi(closes);
 const tr=rows.slice(-15).slice(1).map((c,i)=>{const prev=rows.slice(-15)[i][4];return Math.max(c[2]-c[3],Math.abs(c[2]-prev),Math.abs(c[3]-prev));});
 const a=tr.reduce((x,y)=>x+y,0)/14;
 if(!(a>0)||e===null||r===null||last[4]<e||r<50||r>80||Math.abs(entry-last[4])>1.5*a)return fail('Premium momentum / ATR or quote-to-candle alignment not confirmed.');
 const sessions=[...new Set(rows.map(c=>istDate(c[0])))],todayRows=rows.filter(c=>istDate(c[0])===sessions.at(-1)),priorRows=rows.filter(c=>istDate(c[0])===sessions.at(-2));
 if(todayRows.length<5)return fail('Need five completed premium candles in current session.');
 const swing=Math.min(...todayRows.slice(-5).map(c=>c[3]));
 const floorTick=x=>Math.floor((x+1e-8)*20)/20;
 const stop=floorTick(swing-0.25*a),risk=entry-stop;
 if(!(stop>0&&risk>=Math.max(3*(entry-bid),0.5*a,0.10)&&risk<=0.25*entry&&risk<=3*a))return fail('Premium swing stop creates excessive or insufficient risk.');
 const levels=[];
 for(const [label,session] of [['Current session',todayRows],['Previous session',priorRows]]){
  if(!session.length)continue;
  levels.push({price:Math.max(...session.map(c=>c[2])),label:label+' high'});
  for(let i=2;i+2<session.length;i++){const h=session[i][2];if(h>=session[i-2][2]&&h>=session[i-1][2]&&h>=session[i+1][2]&&h>=session[i+2][2]&&(h>session[i-1][2]||h>session[i+1][2]))levels.push({price:h,label:label+' swing high'});}
 }
 const buffer=Math.max(0.1*a,entry-bid,0.05),zones=[];
 for(const l of levels.filter(x=>x.price>entry).sort((x,y)=>x.price-y.price)){
  const z=zones.at(-1);if(z&&l.price-z.price<=Math.max(0.25*a,0.10)){if(!z.labels.includes(l.label))z.labels.push(l.label);continue;}zones.push({price:l.price,labels:[l.label]});
 }
 const z1=zones[0],z2=zones[1],target1=z1?floorTick(z1.price-buffer):null,target2=z2?floorTick(z2.price-buffer):null;
 if(!(target1>entry&&target1-entry>=risk-1e-8&&target2>target1&&target2-entry>=2*risk-1e-8))return fail('Nearest two premium resistance zones do not offer buffered 1R / 2R. No artificial extension.');
 const {minutesLeft,spot,spotAtr,spotBarrier,delta,iv,theta,gamma}=context||{};
 const absDelta=Math.abs(delta??0),bars=Math.floor(minutesLeft/5);
 if(!(bars>=2&&absDelta>0&&absDelta<=1&&spotAtr>0&&spot>0))return fail('Insufficient time or underlying volatility / delta data.');
 // Heuristic movement budgets, not probabilities or price predictions; no theta-unit assumption.
 const premiumBudget=Math.min(6,1.5*Math.sqrt(bars))*a,spotBudget=Math.min(6,1.5*Math.sqrt(bars))*spotAtr;
 const requiredSpotMove1=(target1-entry)/absDelta,requiredSpotMove2=(target2-entry)/absDelta;
 if(target2-entry>premiumBudget||requiredSpotMove2>spotBudget)return fail('T2 exceeds conservative remaining-session ATR movement budget.');
 const barrierDistance=Number.isFinite(spotBarrier)?Math.abs(spotBarrier-spot):null;
 if(barrierDistance!==null&&requiredSpotMove1>barrierDistance+0.5*spotAtr)return fail('Nearest underlying resistance / support limits room for T1 at current delta.');
 return {ok:true,version:'TECH_V3',entry,stop,target1,target:target2,risk,atr:a,rsi:r,ema9:e,swingLow:swing,spotStop:underlyingStop,rr:(target2-entry)/risk,zone1:z1,zone2:z2,buffer,minutesLeft,premiumBudget,spotBudget,requiredSpotMove1,requiredSpotMove2,spotBarrier:spotBarrier??null,barrierDistance,delta,iv,theta,gamma,reason:'Buffered nearest two current/prior-session premium resistance zones; swing/ATR stop; 1R/2R minimum; remaining-time ATR and underlying delta room checks.'};
}
async function optionTechnicalPlan(exchange,symbol,expiry,strike,side,leg,today,underlyingStop,context){
 if(!leg?.key||!(leg.ask>0&&leg.bid>0))return {ok:false,reason:'Fresh two-sided premium quote required.'};
 try{
 const d=new Date(expiry+'T00:00:00Z'),label=String(d.getUTCDate()).padStart(2,'0')+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]+String(d.getUTCFullYear()).slice(-2);
 const growwSymbol=exchange+'-'+symbol+'-'+label+'-'+strike+'-'+side.toUpperCase();
 const start=new Date(Date.parse(today+'T00:00:00+05:30')-5*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
 let timer;try{
 const p=await Promise.race([provider('/v1/historical/candles',{exchange,segment:'FNO',groww_symbol:growwSymbol,start_time:start+' 09:15:00',end_time:today+' 15:30:00',candle_interval:'5minute'}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),4500);})]);
 const now=Date.now(),rows=cleanCandles(p?.candles).filter(c=>Date.parse(c[0])+300000<=now),latest=rows.at(-1);
 if(!latest||istDate(latest[0])!==today||now-Date.parse(latest[0])-300000>=420000)return {ok:false,reason:'Fresh completed option candles unavailable.'};
 return premiumLevels(rows,leg.ask,leg.bid,underlyingStop,context);
 }finally{clearTimeout(timer);}
 }catch{return {ok:false,reason:'Option historical candle feed unavailable.'};}
}

// End-of-day paper close only; no entry scan or broker order.
// Historical market-close paper mark: separate from observed strategy exits.
async function recoverClosingMarks(sql,today){
 const rows=await sql`SELECT *,expiry::text AS expiry_text FROM mayavi_stocks_paper_performance WHERE trade_day=${today}::date AND status='UNVERIFIED' AND exit_price IS NULL ORDER BY opened_at LIMIT 40`;
 let marked=0;const pending=[];
 const cache=new Map();
 for(const p of rows){
  if(!Object.hasOwn(instruments,p.symbol)||!['CE','PE'].includes(p.side)||!(Number(p.strike)>0)||!p.expiry_text)continue;
  const exchange=instruments[p.symbol],d=new Date(p.expiry_text+'T00:00:00Z'),label=String(d.getUTCDate()).padStart(2,'0')+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]+String(d.getUTCFullYear()).slice(-2);
  const symbol=exchange+'-'+p.symbol+'-'+label+'-'+Number(p.strike)+'-'+p.side;
  try{
   let candle=cache.get(symbol);
   if(!cache.has(symbol)){
    const data=await provider('/v1/historical/candles',{exchange,segment:'FNO',groww_symbol:symbol,start_time:today+' 15:25:00',end_time:today+' 15:30:00',candle_interval:'5minute'});
    candle=cleanCandles(data?.candles).find(c=>Date.parse(c[0])===Date.parse(today+'T15:25:00+05:30')&&Number(c[5])>0)||null;
    cache.set(symbol,candle);
   }
   if(!candle){pending.push(p.contract_key);continue;}
   const closeAt=today+'T15:30:00+05:30',price=candle[4];
   if(Date.parse(p.opened_at)>=Date.parse(closeAt)||!(price>0)){pending.push(p.contract_key);continue;}
   const mark={source:'Groww historical FNO 5-minute final candle close',groww_symbol:symbol,candle_start:candle[0],market_close:closeAt,price,recorded_at:new Date().toISOString(),note:'Retrospective close-price paper sale; intraday stop/target sequence not observed; not a verified executable bid.'};
   const updated=await sql`UPDATE mayavi_stocks_paper_performance SET status='EOD_MARK',exit_price=${price},closed_at=${closeAt}::timestamptz,coverage_gap=true,plan_meta=COALESCE(plan_meta,'{}'::jsonb)||${JSON.stringify({eod_mark:mark})}::jsonb WHERE id=${p.id} AND trade_day=${today}::date AND status='UNVERIFIED' AND exit_price IS NULL RETURNING id`;
   marked+=updated.length;
  }catch{pending.push(p.contract_key);}
 }
 console.log('paper_eod_mark',JSON.stringify({day:today,marked,pending:pending.length}));
 return {marked,pending:pending.length};
}

async function closePaperCron(request){
 const secret=process.env.CRON_SECRET;
 if(!secret||request.headers.get('authorization')!=='Bearer '+secret)return json({ok:false,error:'Unauthorized'},401);
 const now=Date.now(),ist=new Date(now+19800000),minute=ist.getUTCHours()*60+ist.getUTCMinutes(),today=day();
 if(ist.getUTCDay()===0||ist.getUTCDay()===6||minute<920||minute>1020)return json({ok:true,skipped:true});
 const db=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
 if(!db)return json({ok:false,error:'Paper DB unavailable'},503);
 const sql=neon(db);await initPaper(sql);
 if(minute>=930){
  const rows=await sql`UPDATE mayavi_stocks_paper_performance SET status='UNVERIFIED',closed_at=now(),coverage_gap=true WHERE status='OPEN' AND trade_day<=${today}::date RETURNING id`;
  const recovery=await recoverClosingMarks(sql,today);return json({ok:true,unverified:rows.length,...recovery});
 }
 const rows=await sql`SELECT *,expiry::text AS expiry_text FROM mayavi_stocks_paper_performance WHERE trade_day=${today}::date AND status='OPEN' ORDER BY opened_at LIMIT 100`;
 if(!rows.length)return json({ok:true,attempted:0,remaining:0});
 const quotes=new Map();let attempted=0;
 for(const p of rows){
  if(!Object.hasOwn(instruments,p.symbol)||!p.contract_key)continue;
  const exchange=instruments[p.symbol],k=exchange+'|'+p.contract_key;
  if(!quotes.has(k)){const l={key:p.contract_key};await enrich(exchange,l);quotes.set(k,l);}
  const leg=quotes.get(k),qt=Number(leg.quoteTime),local=new Date(qt+19800000),qm=local.getUTCHours()*60+local.getUTCMinutes();
  if(!Number.isFinite(qt)||istDate(qt)!==today||qm<920||qm>=930)continue;
  await observePaper(sql,p.username,p,leg,p.expiry_text,minute);
  attempted++;
 }
 const [left]=await sql`SELECT count(*)::int AS n FROM mayavi_stocks_paper_performance WHERE trade_day=${today}::date AND status='OPEN'`;
 return json({ok:true,attempted,remaining:left?.n??null});
}


// Read-only MCX discovery and quotes. Keep commodity entries disabled until complete feed verification.
const mcxNames=['GOLD','SILVER','CRUDEOIL','NATURALGAS'];
let mcxMaster=null,mcxMasterAt=0,mcxMasterJob=null;
async function commodityMaster(){
 if(mcxMaster&&Date.now()-mcxMasterAt<3600000)return mcxMaster;
 if(!mcxMasterJob)mcxMasterJob=(async()=>{
  const r=await fetch('https://growwapi-assets.groww.in/instruments/instrument.csv',{signal:AbortSignal.timeout(10000),cache:'no-store'});
  if(!r.ok)throw Error('Groww instrument master unavailable');
  const split=l=>(l.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)||[]).filter((x,i,a)=>x!==''||i<a.length-1).map(x=>x.replace(/,$/,'').replace(/^"|"$/g,'').replace(/""/g,'"').trim());
  const lines=(await r.text()).split(/\r?\n/),h=split(lines.shift()||'').map(x=>x.replace(/^\uFEFF/,''));
  const ix=k=>h.indexOf(k);
  for(const k of ['exchange','segment','trading_symbol','groww_symbol','underlying_symbol','expiry_date','instrument_type','strike_price','lot_size'])if(ix(k)<0)throw Error('Groww instrument columns unavailable');
  const rows=[];
  for(const l of lines){if(!l.startsWith('MCX,')&&!l.includes('MCX'))continue;const a=split(l),symbol=a[ix('underlying_symbol')],type=a[ix('instrument_type')],expiry=a[ix('expiry_date')],key=a[ix('trading_symbol')],groww=a[ix('groww_symbol')];if(a[ix('exchange')]!=='MCX'||!mcxNames.includes(symbol)||!['FUT','CE','PE'].includes(type)||!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!key||!groww)continue;rows.push({symbol,type,expiry,key,groww,segment:a[ix('segment')]||'COMMODITY',strike:num(a[ix('strike_price')]),masterLot:num(a[ix('lot_size')])});}
  if(!rows.length)throw Error('No MCX contracts found in Groww instrument master');
  mcxMaster=rows;mcxMasterAt=Date.now();return rows;
 })().finally(()=>{mcxMasterJob=null});
 return mcxMasterJob;
}
async function commoditySnapshot(symbol){
 if(!mcxNames.includes(symbol))return json({ok:false,error:'Unsupported commodity'},400);
 const today=day();let master;try{master=await commodityMaster();}catch(e){return json({ok:false,error:'Groww MCX instrument discovery failed: '+(e.message||'Unknown error')},503);}const rows=master.filter(x=>x.symbol===symbol&&x.expiry>=today).sort((a,b)=>a.expiry.localeCompare(b.expiry));
 const future=rows.find(x=>x.type==='FUT');if(!future)return json({ok:false,error:'No upcoming MCX futures contract in Groww master'},422);
 const quote=async c=>{
  const segments=[...new Set([c.segment,'COMMODITY','FNO'])].filter(x=>['COMMODITY','FNO'].includes(x)),attempts=[];
  for(const segment of segments){
   try{const q=await provider('/v1/live-data/quote',{exchange:'MCX',segment,trading_symbol:c.key});const book=bookQuote(q),t=normalizeQuoteTime(q.last_trade_time),ltp=num(q.last_price);
   if(!(ltp>0))throw Error('No positive last traded price');
   return {...c,segment,ltp,bid:book.bid,ask:book.ask,quoteTime:t,fresh:Number.isFinite(t)&&Date.now()-t>=-10000&&Date.now()-t<120000,volume:num(q.volume),oi:num(q.open_interest),source:'Groww quote',attempts};
   }catch(e){attempts.push(segment+' quote: '+(e.message||'Unavailable'));if(/429|401|authentication|approval pending/i.test(e.message||''))break;}
   try{const p=await provider('/v1/live-data/ltp',{segment,exchange_symbols:'MCX_'+c.key});const ltp=num(p?.['MCX_'+c.key]);if(!(ltp>0))throw Error('No positive last traded price');return {...c,segment,ltp,bid:null,ask:null,quoteTime:null,fresh:false,source:'Groww LTP — timestamp unavailable',attempts};}catch(e){attempts.push(segment+' LTP: '+(e.message||'Unavailable'));if(/429|401|authentication|approval pending/i.test(e.message||''))break;}
  }
  return {...c,error:attempts.join(' | ')||'Groww MCX quote unavailable',attempts};
 };
 const f=await quote(future);
 const options=rows.filter(x=>x.type!=='FUT'&&x.expiry>today&&x.strike>0);
 const expiry=options[0]?.expiry||null;
 const opt=options.filter(x=>x.expiry===expiry);
 const strikes=[...new Set(opt.filter(x=>x.type==='CE'&&opt.some(y=>y.type==='PE'&&y.strike===x.strike)).map(x=>x.strike))];
 const strike=f.ltp>0&&strikes.length?strikes.reduce((a,b)=>Math.abs(a-f.ltp)<=Math.abs(b-f.ltp)?a:b):null;
 const pair=strike==null?[]:opt.filter(x=>x.strike===strike);
 const quotes=await Promise.all(['CE','PE'].map(type=>{const c=pair.find(x=>x.type===type);return c?quote(c):null;}));
 let candles=0,chainAvailable=false,historyError=null,chainError=null;
 try{const p=await provider('/v1/historical/candles',{exchange:'MCX',segment:f.segment||future.segment,groww_symbol:future.groww,start_time:today+' 09:00:00',end_time:today+' 23:55:00',candle_interval:'5minute'});candles=Array.isArray(p?.candles)?p.candles.length:0;}catch(e){historyError=/^Market provider/.test(e?.message||'')?e.message:'MCX candles unavailable';}
 if(expiry){try{const p=await provider('/v1/option-chain/exchange/MCX/underlying/'+symbol,{expiry_date:expiry});chainAvailable=Boolean(p?.strikes&&Object.keys(p.strikes).length);}catch(e){chainError=/^Market provider/.test(e?.message||'')?e.message:'MCX option chain unavailable';}}
 return json({ok:true,symbol,future:f,expiry,strike,call:quotes[0],put:quotes[1],candles,chainAvailable,historyError,chainError,entryEnabled:false,asOf:new Date().toISOString()});
}

export async function GET(request){
try{
if(new URL(request.url).searchParams.get('paperClose')==='1')return await closePaperCron(request);
const session=readSession(request);if(session?.role!=='admin')return json({ok:false,error:'Admin access required.'},403);
const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
if(!url)return json({ok:false,error:'Authentication unavailable.'},503);
const sql=neon(url);const [u]=await sql`SELECT role,session_version,is_active FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
if(!u?.is_active||u.role!=='admin'||Number(u.session_version)!==Number(session.sessionVersion||0))return json({ok:false,error:'Admin access required.'},403);
const q=new URL(request.url).searchParams;if(q.has('commodityQuote'))return await commoditySnapshot(q.get('commodityQuote'));const symbol=q.get('symbol')||'NIFTY',exchange=instruments[symbol];if(!Object.hasOwn(instruments,symbol))return json({ok:false,error:'Unsupported index.'},400);
const today=day(),now=Date.now(),year=Number(today.slice(0,4));
const paperUser=String(session.username).toLowerCase();let paperActive=null,paperAvailable=false,paperError=null;try{await initPaper(sql);await expirePaper(sql,paperUser,today);paperAvailable=true;if(q.get('paperReport')==='1')return json({ok:true,rows:await paperReport(sql,paperUser,today)});paperActive=await openPaper(sql,paperUser,symbol);}catch{paperAvailable=false;paperError='Paper history storage temporarily unavailable';if(q.get('paperReport')==='1')return json({ok:false,error:paperError},503);}
if(retired.has(symbol)){if(!paperAvailable)return json({ok:false,error:'Paper history storage temporarily unavailable'},503);if(!paperActive)return json({ok:true,symbol,monitorOnly:true});await accessToken();const leg={key:paperActive.contract_key};await enrich(exchange,leg);await observePaper(sql,paperUser,paperActive,leg,paperActive.expiry_text,0);return json({ok:true,symbol,monitorOnly:true});}
await accessToken();
const [dates,candleData,historical]=await Promise.all([provider('/v1/historical/expiries',{exchange,underlying_symbol:symbol,year}),provider('/v1/historical/candles',{exchange,segment:'CASH',groww_symbol:exchange+'-'+symbol,start_time:today+' 09:15:00',end_time:today+' 15:30:00',candle_interval:'5minute'}),previousCandles(exchange,symbol,today).catch(()=>[])]);
const expiries=[...new Set((dates?.expiries||[]).filter(e=>typeof e==='string'&&e>=today))].sort();
const expiry=q.get('sunil')==='1'?expiries.find(e=>e>today):(q.get('expiry')||(paperActive&&expiries.includes(paperActive.expiry_text)?paperActive.expiry_text:expiries[0]));if(!expiry||!expiries.includes(expiry))return json({ok:false,error:'No upcoming expiry returned by Groww for this index.'},422);
const [raw,liveIndex]=await Promise.all([provider('/v1/option-chain/exchange/'+exchange+'/underlying/'+symbol,{expiry_date:expiry}),provider('/v1/live-data/ltp',{segment:'CASH',exchange_symbols:Object.entries(instruments).filter(([k])=>!retired.has(k)).map(([k,v])=>v+'_'+k).join(',')}).catch(()=>null)]);
const indexReceivedAt=new Date().toISOString();
const indexLtp=num(liveIndex?.[exchange+'_'+symbol]);
const chain=Object.entries(raw?.strikes||{}).filter(([k])=>num(k)!==null).map(([k,v])=>({strike:num(k),ce:parseLeg(v?.CE),pe:parseLeg(v?.PE)})).sort((a,b)=>a.strike-b.strike);
const spot=num(raw?.underlying_ltp);if(!spot||!chain.length)return json({ok:false,error:'Option chain unavailable.'},503);
const indexGap=indexLtp!==null&&indexLtp>0?Math.abs(indexLtp-spot):null;
const indexTolerance=spot*0.001;
const indexAligned=indexGap!==null&&indexGap<=indexTolerance;
const dataCheck={exchange,provider:'Groww',indexLtp,chainSpot:spot,indexGap,indexTolerance,indexAligned,indexReceivedAt:indexLtp!==null?indexReceivedAt:null,exchangeTimestamp:null};
const candles=cleanCandles(candleData?.candles).filter(c=>istDate(c[0])===today);
const closed=cleanCandles([...historical,...candles]).filter(c=>Date.parse(c[0])+300000<=now),last=closed.at(-1),closes=closed.map(c=>c[4]),e9=ema(closes,9),e21=ema(closes,21),r=rsi(closes);
const tech=technical(closed),historySessions=[...new Set(historical.map(c=>istDate(c[0])))].sort(),prevSession=historySessions.at(-1),prevRows=historical.filter(c=>istDate(c[0])===prevSession),previousHigh=prevRows.length?Math.max(...prevRows.map(c=>c[2])):null,previousLow=prevRows.length?Math.min(...prevRows.map(c=>c[3])):null,previousClose=prevRows.at(-1)?.[4]??null;
const pivot=previousHigh===null?null:(previousHigh+previousLow+previousClose)/3;
const todayClosed=closed.filter(c=>istDate(c[0])===today);const opening=todayClosed.filter(c=>{const n=new Date(Date.parse(c[0])+19800000);return n.getUTCHours()*60+n.getUTCMinutes()<570;});
const openingHigh=opening.length===3?Math.max(...opening.map(c=>c[2])):null,openingLow=opening.length===3?Math.min(...opening.map(c=>c[3])):null;
const tr=closed.slice(1).map((c,i)=>Math.max(c[2]-c[3],Math.abs(c[2]-closed[i][4]),Math.abs(c[3]-closed[i][4]))),atr=tr.length>=14?tr.slice(-14).reduce((a,b)=>a+b,0)/14:null;
const sum=(leg,k)=>chain.every(x=>x[leg][k]!==null)?chain.reduce((a,x)=>a+x[leg][k],0):null;
const coi=sum('ce','oi'),poi=sum('pe','oi'),pcr=coi>0&&poi!==null?poi/coi:null;
let cchg=null,pchg=null;
const maxOI=(leg,rows)=>rows.filter(x=>x[leg].oi!==null&&x[leg].oi>0).sort((a,b)=>b[leg].oi-a[leg].oi)[0]?.strike??null;
const support=maxOI('pe',chain.filter(x=>x.strike<=spot)),resistance=maxOI('ce',chain.filter(x=>x.strike>=spot));
const maxPain=chain.every(x=>x.ce.oi!==null&&x.pe.oi!==null)?chain.map(x=>({strike:x.strike,pain:chain.reduce((v,y)=>v+Math.max(x.strike-y.strike,0)*y.ce.oi+Math.max(y.strike-x.strike,0)*y.pe.oi,0)})).sort((a,b)=>a.pain-b.pain)[0]?.strike:null;
// Sunil scan anchors the comparison pair to opening spot, not moving live ATM.
const sunilOpening=todayClosed.find(x=>Date.parse(x[0])===Date.parse(today+'T09:15:00+05:30'));
const strikeReference=q.get('sunil')==='1'&&sunilOpening?sunilOpening[1]:spot;
const atm=chain.reduce((a,b)=>Math.abs(a.strike-strikeReference)<=Math.abs(b.strike-strikeReference)?a:b);
const watchKey=q.get('watch');const watch=watchKey?chain.flatMap(x=>[x.ce,x.pe]).find(x=>x.key===watchKey):null;
const paperLeg=paperActive&&paperActive.expiry_text===expiry?chain.flatMap(x=>[x.ce,x.pe]).find(x=>x.key===paperActive.contract_key):null;
await Promise.all([...new Set([atm.ce,atm.pe,...(watch?[watch]:[]),...(paperLeg?[paperLeg]:[])])].map(x=>enrich(exchange,x)));
cchg=atm.ce.oiChange;pchg=atm.pe.oiChange;
const t=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const part=k=>t.find(x=>x.type===k)?.value;const mins=Number(part('hour'))*60+Number(part('minute'));const inHours=!['Sat','Sun'].includes(part('weekday'))&&mins>=555&&mins<930;
const candleFresh=Boolean(last&&now-Date.parse(last[0])-300000>=0&&now-Date.parse(last[0])-300000<420000&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(last[0]))===today);
// Explicit admin-only Sunil paper research request, isolated from regular paper entries.
if(q.get('sunil')==='1'){
 const base={ok:true,symbol,expiry,strike:atm.strike,rules:SUNIL_RULES,asOf:new Date().toISOString(),paperOnly:true};
 const wait=reason=>json({...base,sunil:{status:'WAIT',reason}});
 if(symbol!=='BANKNIFTY')return wait('Initial research limited to BANKNIFTY.');
 if(!inHours||mins>=910||!candleFresh||!indexAligned)return wait('Market closed, late session or fresh aligned data unavailable.');
 if(!sunilOpening||!atm.ce.key||!atm.pe.key||expiry<=today)return wait('Verified non-expiry-day CE and PE required.');
 try{
  const d=new Date(expiry+'T00:00:00Z'),label=String(d.getUTCDate()).padStart(2,'0')+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]+String(d.getUTCFullYear()).slice(-2);
  const from=new Date(Date.parse(today+'T00:00:00+05:30')-7*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const fetchSide=async side=>cleanCandles((await provider('/v1/historical/candles',{exchange,segment:'FNO',groww_symbol:exchange+'-'+symbol+'-'+label+'-'+atm.strike+'-'+side,start_time:from+' 09:15:00',end_time:today+' 15:30:00',candle_interval:'5minute'}))?.candles);
  const [ceRows,peRows]=await Promise.all([fetchSide('CE'),fetchSide('PE')]);
  const quote=l=>({ask:l.ask,bid:l.bid,time:l.quoteTime});
  const sunil=scanSunil({date:today,now:Date.now(),indexRows:closed,ceRows,peRows,quotes:{CE:quote(atm.ce),PE:quote(atm.pe)},aligned:indexAligned,contractVerified:true});
  return json({...base,sunil,notes:['Opening-ATM pair and nearest non-expiry-day expiry are testing assumptions. Quote age uses last-trade time, not a verified order-book timestamp. Candidates are not recorded or executed.']});
 }catch{return wait('Sunil option candle data temporarily unavailable.');}
}
const higher=group15(closed),higherCloses=higher.map(c=>c[4]),h9=ema(higherCloses,9),h21=ema(higherCloses,21);
const higherTrend=h9===null||h21===null?'UNAVAILABLE':higherCloses.at(-1)>h9&&h9>h21?'BULLISH':higherCloses.at(-1)<h9&&h9<h21?'BEARISH':'NEUTRAL';
const previous=closed.at(-2),prevEma=ema(closes.slice(0,-1),9);
const bullPullback=Boolean(previous&&last&&prevEma!==null&&previous[3]<=prevEma&&previous[4]>=prevEma&&last[4]>previous[2]&&last[4]>last[1]);
const bearPullback=Boolean(previous&&last&&prevEma!==null&&previous[2]>=prevEma&&previous[4]<=prevEma&&last[4]<previous[3]&&last[4]<last[1]);
const orbCe=Boolean(openingHigh!==null&&todayClosed.length>=4&&previous&&last&&previous[4]<=openingHigh&&last[4]>openingHigh);
const orbPe=Boolean(openingLow!==null&&todayClosed.length>=4&&previous&&last&&previous[4]>=openingLow&&last[4]<openingLow);
const prev=closed.slice(-4,-1);
const triggerHigh=prev.length===3?Math.max(...prev.map(c=>c[2])):null,triggerLow=prev.length===3?Math.min(...prev.map(c=>c[3])):null;
const readiness=[
{label:'Trading session / entry cutoff',ok:inHours&&mins<910},
{label:'Live index LTP agrees with chain spot (within 0.1%)',ok:indexAligned},
{label:'Fresh completed 5-minute candle',ok:candleFresh},
{label:'At least 3 completed candles today',ok:todayClosed.length>=3},
{label:'EMA, RSI, ATR, MACD and Supertrend available',ok:e9!==null&&e21!==null&&r!==null&&atr>0&&tech.macdHist!==null&&tech.supertrendDirection!==null},
{label:'PCR and ATM OI changes available',ok:pcr!==null&&cchg!==null&&pchg!==null},
{label:'Non-expiry day',ok:expiry>today}
];
const check=(label,ce,pe)=>({label,ce:Boolean(ce),pe:Boolean(pe)});
const checks=[
check('EMA trend',e9!==null&&e21!==null&&last?.[4]>e9&&e9>e21,e9!==null&&e21!==null&&last?.[4]<e9&&e9<e21),
check('RSI range',r!==null&&r>=55&&r<=72,r!==null&&r<=45&&r>=28),
check('Completed candle breakout',triggerHigh!==null&&last?.[4]>triggerHigh,triggerLow!==null&&last?.[4]<triggerLow),
check('ATM OI change alignment',cchg!==null&&pchg!==null&&pchg>cchg,cchg!==null&&pchg!==null&&cchg>pchg),
check('PCR filter',pcr!==null&&pcr>=0.9,pcr!==null&&pcr<=1.1),
check('MACD histogram',tech.macdHist!==null&&tech.macdHist>0,tech.macdHist!==null&&tech.macdHist<0),
check('Supertrend',tech.supertrendDirection==='BULLISH',tech.supertrendDirection==='BEARISH')
];
const allReady=readiness.every(x=>x.ok);
const summaryOnly=q.get('scan')==='1';
const futures=await futuresContext(exchange,symbol,expiries,today,now,spot);
const setups={ce:orbCe?'Opening range breakout':bullPullback?'EMA pullback continuation':triggerHigh!==null&&last?.[4]>triggerHigh?'Three-candle breakout':null,pe:orbPe?'Opening range breakdown':bearPullback?'EMA pullback continuation':triggerLow!==null&&last?.[4]<triggerLow?'Three-candle breakdown':null};
const researchChecks=[
check('15-minute trend alignment',higherTrend==='BULLISH',higherTrend==='BEARISH'),
check('Price action setup',Boolean(setups.ce),Boolean(setups.pe)),
check('Avoid chasing (within 1.5 ATR of EMA9)',atr>0&&e9!==null&&Math.abs(last?.[4]-e9)<=1.5*atr,atr>0&&e9!==null&&Math.abs(last?.[4]-e9)<=1.5*atr),
check('Fresh futures candle and VWAP confirmation',futures.available&&futures.fresh&&futures.direction==='BULLISH',futures.available&&futures.fresh&&futures.direction==='BEARISH'),
check('ATM option delta magnitude 0.45–0.70',atm.ce.delta!==null&&atm.ce.delta>=0.45&&atm.ce.delta<=0.7,atm.pe.delta!==null&&atm.pe.delta<=-0.45&&atm.pe.delta>=-0.7)
];
const researchDirection=allReady?['ce','pe'].find(k=>researchChecks.every(x=>x[k])&&checks.filter(x=>x.label!=='Completed candle breakout').every(x=>x[k])):null;
const research={higherTrend,h9,h21,setups,checks:researchChecks,futures,side:researchDirection?.toUpperCase()||'WAIT',strategy:researchDirection?setups[researchDirection]:null};

const available=(...v)=>v.every(x=>x!==null&&x!==undefined);
const scoreItem=(label,max,ce,pe,known=true)=>({label,max,available:Boolean(known),ce:known?ce:0,pe:known?pe:0});
const trend5=checks[0], trend15=higherTrend, futureKnown=futures.available&&futures.fresh&&futures.vwap!==null&&futures.direction!==null;
const breakdown=[
scoreItem('Price action / breakout',20,setups.ce?20:0,setups.pe?20:0,todayClosed.length>=3&&triggerHigh!==null),
scoreItem('5m and 15m trend',15,(trend5.ce?7:0)+(trend15==='BULLISH'?8:0),(trend5.pe?7:0)+(trend15==='BEARISH'?8:0),available(e9,e21)&&trend15!=='UNAVAILABLE'),
scoreItem('Futures VWAP',15,futures.direction==='BULLISH'?15:0,futures.direction==='BEARISH'?15:0,futureKnown),
scoreItem('EMA 9 / 21 / 50',10,(trend5.ce?5:0)+(e21>tech.ema50?5:0),(trend5.pe?5:0)+(e21<tech.ema50?5:0),available(e9,e21,tech.ema50)),
scoreItem('ATM OI change',10,checks[3].ce?10:0,checks[3].pe?10:0,available(cchg,pchg)),
scoreItem('Supertrend',10,checks[6].ce?10:0,checks[6].pe?10:0,available(tech.supertrendDirection)),
scoreItem('RSI',5,checks[1].ce?5:0,checks[1].pe?5:0,available(r)),
scoreItem('MACD',5,checks[5].ce?5:0,checks[5].pe?5:0,available(tech.macdHist)),
scoreItem('PCR',5,checks[4].ce?5:0,checks[4].pe?5:0,available(pcr)),
scoreItem('Futures volume confirmation',5,futures.direction==='BULLISH'&&futures.volumeRatio>=1.2?5:0,futures.direction==='BEARISH'&&futures.volumeRatio>=1.2?5:0,futureKnown&&available(futures.volumeRatio))
];
const scores={ce:breakdown.reduce((a,x)=>a+x.ce,0),pe:breakdown.reduce((a,x)=>a+x.pe,0)};
const best=scores.ce>scores.pe?'ce':scores.pe>scores.ce?'pe':null;
const score=Math.max(scores.ce,scores.pe),tier=score>=85?'STRONG':score>=75?'FAVORABLE':score>=60?'WATCH':'NO TRADE';
const leg=best?atm[best]:null,qt=leg?.quoteTime,quoteFresh=Number.isFinite(qt)&&Date.now()-qt<120000&&Date.now()-qt>=-10000;
const entry=leg?.ask??null;
const spotStop=best&&atr>0&&todayClosed.length>=3?(best==='ce'?Math.min(...todayClosed.slice(-3).map(c=>c[3]))-0.25*atr:Math.max(...todayClosed.slice(-3).map(c=>c[2]))+0.25*atr):null;
const sideSign=best==='ce'?1:-1;
const spotBarriers=[best==='ce'?previousHigh:previousLow,best==='ce'?openingHigh:openingLow,best==='ce'?(pivot===null?null:2*pivot-previousLow):(pivot===null?null:2*pivot-previousHigh),best==='ce'?resistance:support,...todayClosed.slice(2,-2).filter((c,i)=>{const k=i+2;return best==='ce'?c[2]>=todayClosed[k-1][2]&&c[2]>=todayClosed[k+1][2]:c[3]<=todayClosed[k-1][3]&&c[3]<=todayClosed[k+1][3];}).map(c=>best==='ce'?c[2]:c[3])].filter(x=>Number.isFinite(x)&&(x-spot)*sideSign>0).sort((a,b)=>(a-b)*sideSign);
const targetContext={minutesLeft:920-mins,spot,spotAtr:atr,spotBarrier:spotBarriers[0]??null,delta:leg?.delta??null,iv:leg?.iv??null,theta:leg?.theta??null,gamma:leg?.gamma??null};
const technicalPlan=best&&score>=75&&inHours&&mins<910&&candleFresh&&quoteFresh&&expiry>today&&leg?.bid>0&&entry>=leg.bid&&(entry-leg.bid)/entry<=0.02&&providerCooldownUntil<=Date.now()?await optionTechnicalPlan(exchange,symbol,expiry,atm.strike,best,leg,today,spotStop,targetContext):{ok:false,reason:'Waiting for a favorable score, fresh liquid quote and regular session.'};
const {stop=null,risk=null,target=null,target1=null}=technicalPlan;
const gates=[
{label:'Market open / before 3:10 PM',ok:inHours&&mins<910},
{label:'Fresh completed candle and index cross-check',ok:candleFresh&&indexAligned},
{label:'At least three completed candles today',ok:todayClosed.length>=3},
{label:'Non-expiry day; stock options require >3 calendar days to expiry',ok:expiry>today&&(!equityOptions.has(symbol)||Date.parse(expiry)-Date.parse(today)>3*86400000)},
{label:'Price action confirmation',ok:Boolean(best&&setups[best])},
{label:'Fresh option last-trade timestamp',ok:quoteFresh},
{label:'Liquidity / bid-ask spread at most 2%',ok:Boolean(leg?.key&&leg.bid>0&&entry>=leg.bid&&entry>0&&(entry-leg.bid)/entry<=0.02&&leg.volume>0)},
{label:'Technical premium levels: '+technicalPlan.reason,ok:Boolean(technicalPlan.ok&&risk>0&&target-entry>=2*risk-1e-8)},
{label:'5m / 15m trend and no chasing',ok:Boolean(best&&checks[0][best]&&researchChecks[0][best]&&researchChecks[2][best])},
{label:'Fresh aligned futures VWAP and ATM delta',ok:Boolean(best&&researchChecks[3][best]&&researchChecks[4][best])},
{label:'Provider cooldown and quote recheck',ok:providerCooldownUntil<=Date.now()&&Number.isFinite(qt)&&Date.now()-qt<120000}
];
const weighted={scores,score,side:best?.toUpperCase()||'NEUTRAL',tier,breakdown,gates,availablePoints:breakdown.filter(x=>x.available).reduce((a,x)=>a+x.max,0)};
let signal={side:'WAIT',reason:score<75?'Weighted score below 75/100.':!best?'Directional scores tied.':'Entry blocked: '+gates.filter(x=>!x.ok).map(x=>x.label).join('; ')+'.'};
if(best&&score>=75&&gates.every(x=>x.ok)){const direction=best.toUpperCase();signal={side:direction,strike:atm.strike,key:leg.key,entry,stop,target,target1,score,tier,pattern:setups[best],spotStop,technicalPlan,quoteTime:new Date(qt).toISOString(),reason:'TECH V3 '+score+'/100; '+setups[best]+'. '+technicalPlan.reason+' T2 reward/risk '+technicalPlan.rr.toFixed(2)+'; trail after T1; gross excluding costs.'};}
// Show a non-executable planning scenario only for a favorable directional score.
// Never substitute last traded price for executable ask; mandatory entry gates are unchanged.
const liquidAsk=quoteFresh&&gates[6].ok&&risk>0&&target-entry>=2*risk-1e-8;
const referencePrice=liquidAsk?entry:null;
const refStop=liquidAsk?stop:null,refRisk=liquidAsk?risk:null;
const conditionalPlan=best&&score>=75&&signal.side==='WAIT'&&inHours&&mins<910&&candleFresh&&gates[3].ok&&providerCooldownUntil<=Date.now()?{side:best.toUpperCase(),strike:atm.strike,expiry,score,tier,referencePrice:refRisk>0?referencePrice:null,referenceSource:liquidAsk?'ASK':'LTP',stop:refRisk>0?refStop:null,target1:refRisk>0?target1:null,target2:refRisk>0?target:null,technicalPlan,spotStop,quoteTime:quoteFresh?new Date(qt).toISOString():null,pending:gates.filter(x=>!x.ok).map(x=>x.label),exitTime:'15:20 IST',status:'CONDITIONAL — NOT AN ENTRY'}:null;
const counts={ce:checks.filter(x=>x.ce).length,pe:checks.filter(x=>x.pe).length};
const watchSide=inHours&&mins<910&&candleFresh&&indexAligned&&todayClosed.length>=3?['ce','pe'].find(k=>counts[k]>=4&&counts[k]>counts[k==='ce'?'pe':'ce']&&checks[0][k]&&(checks[5][k]||checks[6][k])):null;
const directionalWatch={side:watchSide?.toUpperCase()||'NEUTRAL',counts,filterTotal:checks.length,matched:watchSide?checks.filter(x=>x[watchSide]).map(x=>x.label):[],pending:watchSide?checks.filter(x=>!x[watchSide]).map(x=>x.label):[],blocked:readiness.filter(x=>!x.ok).map(x=>x.label),pattern:watchSide?setups[watchSide]:null,asOf:last?.[0]??null};
// Separate, deliberately high-risk expiry-day paper research; never changes the regular strategy.
const expiryDay=expiries.includes(today)&&!equityOptions.has(symbol);
const expiryPaper={active:expiryDay,expiry:today,selectedExpiry:expiry,signal:null,reason:expiryDay?'Waiting for a fresh, liquid ₹3–10 premium candidate.':'No index expiry today.',counts:{ce:0,pe:0},gates:[]};
if(expiryDay&&expiry!==today)expiryPaper.reason='Select today’s expiry to scan its ₹3–10 premium contracts.';
if(expiryDay&&expiry===today){
const cheap={};for(const side of ['ce','pe'])cheap[side]=chain.filter(x=>{const l=x[side];return l.key&&l.ltp>=3&&l.ltp<=10&&l.volume>0&&l.oi>0&&(side==='ce'?x.strike>spot:x.strike<spot);}).sort((a,b)=>b[side].volume-a[side].volume||Math.abs(a.strike-spot)-Math.abs(b.strike-spot));
expiryPaper.counts={ce:cheap.ce.length,pe:cheap.pe.length};
const expiryGates=[
{label:'Index expiry today, 9:30 AM–2:30 PM IST',ok:inHours&&mins>=570&&mins<870},
{label:'Fresh completed candle / spot cross-check',ok:candleFresh&&indexAligned},
{label:'Directional score ≥85 with price action',ok:Boolean(best&&score>=85&&setups[best]&&todayClosed.length>=3)},
{label:'Trend alignment and ATR available',ok:Boolean(best&&checks[0][best]&&checks[6][best]&&atr>0)},
{label:'Liquid OTM candidate with chain LTP ₹3–10',ok:Boolean(best&&cheap[best].length)}
];
expiryPaper.gates=expiryGates;
if(expiryGates.every(x=>x.ok)){
const shortlist=cheap[best].slice(0,2);let timer;try{await Promise.race([Promise.all(shortlist.map(x=>enrich(exchange,x[best]))),new Promise(resolve=>{timer=setTimeout(resolve,4000);})]);}finally{clearTimeout(timer);}
const selected=shortlist.find(x=>{const l=x[best],age=Date.now()-l.quoteTime;return Number.isFinite(l.quoteTime)&&age>=-10000&&age<30000&&l.ask>=3&&l.ask<=10&&l.bid>0&&l.ask>=l.bid&&l.ask-l.bid<=Math.min(0.30,l.ask*0.05)+1e-8&&l.volume>0&&providerCooldownUntil<=Date.now();});
expiryPaper.gates.push({label:'Actual ask ₹3–10, recent trade <30s and narrow two-sided spread',ok:Boolean(selected)});
if(selected){const l=selected[best],en=l.ask,sl=Math.floor(en*0.7*20)/20,rr=en-sl;if(sl>0&&rr>0){expiryPaper.signal={mode:'expiry',side:best.toUpperCase(),strike:selected.strike,key:l.key,entry:en,stop:sl,target1:Math.ceil((en+rr)*20)/20,target:Math.ceil((en+2*rr)*20)/20,score,tier,pattern:setups[best],spotStop:best==='ce'?last[4]-atr:last[4]+atr,quoteTime:new Date(l.quoteTime).toISOString(),reason:'High-risk expiry paper setup; entire premium may be lost. Illustrative 1R/2R targets, not a forecast.'};expiryPaper.reason='Paper setup only; full premium at risk.';}}
}
if(!expiryPaper.signal)expiryPaper.reason='WAIT — '+(expiryPaper.gates.filter(x=>!x.ok).map(x=>x.label).join('; ')||'No valid executable price.')+'.';
}
if(paperAvailable){try{if(paperActive){await observePaper(sql,paperUser,paperActive,paperLeg,expiry,mins,candleFresh&&indexAligned&&last?{close:last[4],completedAt:Date.parse(last[0])+300000}:null);}else if(inHours&&mins<910&&candleFresh&&indexAligned&&providerCooldownUntil<=Date.now()){await registerPaper(sql,paperUser,today,symbol,expiry,signal,conditionalPlan,best?atm[best].key:null);}}catch{paperError='Paper tracking update unavailable';}}
const atmQuote={strike:atm.strike,ce:atm.ce,pe:atm.pe};
if(summaryOnly)return json({ok:true,symbol,spot,dataCheck,expiry,atmQuote,expiryPaper,directionalWatch,weighted,conditionalPlan,paperError,signal,candleFresh,inHours,asOf:new Date().toISOString(),metrics:{rsi:r,pcr,supertrendDirection:tech.supertrendDirection},watch:watch?{key:watch.key,bid:watch.bid,quoteTime:watch.quoteTime}:null});
return json({ok:true,symbol,spot,dataCheck,expiry,atmQuote,expiryPaper,directionalWatch,weighted,conditionalPlan,paperError,expiries,chain,candles,history:{sessions:historySessions.length,candles:historical.length,from:historySessions[0]??null,to:prevSession??null,completedToday:todayClosed.length},metrics:{...tech,previousHigh,previousLow,previousClose,pivot,pivotR1:pivot===null?null:2*pivot-previousLow,pivotS1:pivot===null?null:2*pivot-previousHigh,openingHigh,openingLow,rsi:r,ema9:e9,ema21:e21,atr,pcr,callOI:coi,putOI:poi,callChange:cchg,putChange:pchg,support,resistance,maxPain,atm:atm.strike},signal,diagnostics:{readiness,checks,triggerHigh,triggerLow,lastCompletedAt:last?.[0]??null},research,asOf:new Date().toISOString(),candleFresh,inHours});
}catch(e){return json({ok:false,error:/^Market provider/.test(e?.message||'')?e.message:'Market data or authentication temporarily unavailable.'},503);}
}
