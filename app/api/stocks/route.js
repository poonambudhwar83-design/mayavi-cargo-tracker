import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const instruments={NIFTY:'NSE',BANKNIFTY:'NSE',SENSEX:'BSE'};
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const ema=(a,n)=>{if(a.length<n)return null;let x=a.slice(0,n).reduce((s,v)=>s+v,0)/n;for(const v of a.slice(n))x+=(v-x)*2/(n+1);return x;};
function rsi(a){if(a.length<15)return null;let g=0,l=0;for(let i=1;i<=14;i++){const d=a[i]-a[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}g/=14;l/=14;for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(13*g+Math.max(0,d))/14;l=(13*l+Math.max(0,-d))/14;}return l===0?(g===0?50:100):100-100/(1+g/l);}
const istDate=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const stamp=c=>typeof c==='number'||(/^\d{10,13}$/.test(String(c)))?new Date(Number(c)<1e12?Number(c)*1000:Number(c)).toISOString():/(?:Z|[+-]\d\d:\d\d)$/.test(String(c))?String(c):String(c).replace(' ','T')+'+05:30';
function cleanCandles(rows){const unique=new Map();for(const c of rows||[]){if(!Array.isArray(c)||c.length<5||!c.slice(1,5).every(v=>num(v)!==null&&num(v)>0))continue;let t;try{t=Date.parse(stamp(c[0]));}catch{continue;}if(!Number.isFinite(t))continue;const a=[new Date(t).toISOString(),...c.slice(1,7).map(num)];if(a[2]<Math.max(a[1],a[4])||a[3]>Math.min(a[1],a[4]))continue;const ist=new Date(t+19800000),minute=ist.getUTCHours()*60+ist.getUTCMinutes();if(minute<555||minute>=930||(minute-555)%5!==0)continue;unique.set(t,a);}return [...unique.values()].sort((a,b)=>Date.parse(a[0])-Date.parse(b[0]));}
const histCache=new Map();
async function previousCandles(exchange,symbol,today){const k=exchange+'|'+symbol+'|'+today,hit=histCache.get(k);if(hit&&Date.now()-hit.at<3600000)return hit.rows;const start=new Date(Date.parse(today+'T00:00:00+05:30')-10*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});const end=new Date(Date.parse(today+'T00:00:00+05:30')-86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});const data=await provider('/v1/historical/candles',{exchange,segment:'CASH',groww_symbol:exchange+'-'+symbol,start_time:start+' 09:15:00',end_time:end+' 15:30:00',candle_interval:'5minute'});const rows=cleanCandles(data?.candles).filter(c=>istDate(c[0])<today);if(rows.length){histCache.clear();histCache.set(k,{at:Date.now(),rows});}return rows;}
function technical(c){const a=c.map(x=>x[4]);const series=[];let e12=null,e26=null,signal=null;for(let i=0;i<a.length;i++){if(i===11)e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12;else if(i>11)e12+=(a[i]-e12)*2/13;if(i===25)e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;else if(i>25)e26+=(a[i]-e26)*2/27;if(e12!==null&&e26!==null)series.push(e12-e26);}
const macd=series.at(-1)??null;signal=ema(series,9);
const b=a.slice(-20),mid=b.length===20?b.reduce((s,v)=>s+v,0)/20:null,sd=mid===null?null:Math.sqrt(b.reduce((s,v)=>s+(v-mid)**2,0)/20);
let atr=null,up=null,down=null,st=null;const tr=[];for(let i=0;i<c.length;i++){const x=c[i],prev=c[i-1]?.[4];tr.push(prev===undefined?x[2]-x[3]:Math.max(x[2]-x[3],Math.abs(x[2]-prev),Math.abs(x[3]-prev)));if(i<9)continue;atr=i===9?tr.slice(0,10).reduce((s,v)=>s+v,0)/10:(atr*9+tr[i])/10;const h=(x[2]+x[3])/2,u=h+3*atr,d=h-3*atr;const oldUp=up,oldDown=down,oldSt=st;up=oldUp===null||u<oldUp||prev>oldUp?u:oldUp;down=oldDown===null||d>oldDown||prev<oldDown?d:oldDown;st=oldSt===null?up:oldSt===oldUp?(x[4]>up?down:up):(x[4]<down?up:down);}
return {ema50:ema(a,50),macd,macdSignal:signal,macdHist:macd===null||signal===null?null:macd-signal,bbMid:mid,bbUpper:mid===null?null:mid+2*sd,bbLower:mid===null?null:mid-2*sd,supertrend:st,supertrendDirection:st===null?null:a.at(-1)>st?'BULLISH':'BEARISH'};
}
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
const raw=String(body.expiry||''),expiry=Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(raw)?raw:raw+'+05:30');cachedToken=body.token;tokenUntil=Math.min(Date.now()+900000,Number.isFinite(expiry)?expiry-30000:Date.now()+60000);return cachedToken;
})().finally(()=>{tokenRequest=null});return tokenRequest;
}
async function provider(path,params={}){const url=new URL('https://api.groww.in'+path);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);const res=await fetch(url,{headers:{Authorization:'Bearer '+await accessToken(),Accept:'application/json','X-API-VERSION':'1.0'},cache:'no-store',signal:AbortSignal.timeout(12000)});if(res.status===401){cachedToken=null;tokenUntil=0;}if(!res.ok)throw new Error('Market provider HTTP '+res.status+' (check Groww approval, subscription or rate limit).');const body=await res.json();if(body.status!=='SUCCESS')throw new Error('Market provider did not return successful data.');return body.payload;}
async function enrich(exchange,leg){if(!leg.key)return;try{const q=await provider('/v1/live-data/quote',{exchange,segment:'FNO',trading_symbol:leg.key});leg.bid=num(q.bid_price);leg.ask=num(q.offer_price);leg.oiChange=num(q.oi_day_change);leg.quoteTime=num(q.last_trade_time);}catch{/* Missing quote stays null, never fabricate. */}}
export async function GET(request){
try{
const session=readSession(request);if(session?.role!=='admin')return json({ok:false,error:'Admin access required.'},403);
const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
if(!url)return json({ok:false,error:'Authentication unavailable.'},503);
const sql=neon(url);const [u]=await sql`SELECT role,session_version,is_active FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
if(!u?.is_active||u.role!=='admin'||Number(u.session_version)!==Number(session.sessionVersion||0))return json({ok:false,error:'Admin access required.'},403);
const q=new URL(request.url).searchParams, symbol=q.get('symbol')||'NIFTY',exchange=instruments[symbol];if(!Object.hasOwn(instruments,symbol))return json({ok:false,error:'Unsupported index.'},400);
const today=day(),now=Date.now(),year=Number(today.slice(0,4));
await accessToken();
const [dates,candleData,historical]=await Promise.all([provider('/v1/historical/expiries',{exchange,underlying_symbol:symbol,year}),provider('/v1/historical/candles',{exchange,segment:'CASH',groww_symbol:exchange+'-'+symbol,start_time:today+' 09:15:00',end_time:today+' 15:30:00',candle_interval:'5minute'}),previousCandles(exchange,symbol,today).catch(()=>[])]);
const expiries=[...new Set((dates?.expiries||[]).filter(e=>typeof e==='string'&&e>=today))].sort();
const expiry=q.get('expiry')||expiries[0];if(!expiry||!expiries.includes(expiry))return json({ok:false,error:'No upcoming expiry returned by Groww for this index.'},422);
const raw=await provider('/v1/option-chain/exchange/'+exchange+'/underlying/'+symbol,{expiry_date:expiry});
const chain=Object.entries(raw?.strikes||{}).filter(([k])=>num(k)!==null).map(([k,v])=>({strike:num(k),ce:parseLeg(v?.CE),pe:parseLeg(v?.PE)})).sort((a,b)=>a.strike-b.strike);
const spot=num(raw?.underlying_ltp);if(!spot||!chain.length)return json({ok:false,error:'Option chain unavailable.'},503);
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
const atm=chain.reduce((a,b)=>Math.abs(a.strike-spot)<=Math.abs(b.strike-spot)?a:b);
const watchKey=q.get('watch');const watch=watchKey?chain.flatMap(x=>[x.ce,x.pe]).find(x=>x.key===watchKey):null;
await Promise.all([...new Set([atm.ce,atm.pe,...(watch?[watch]:[])])].map(x=>enrich(exchange,x)));
cchg=atm.ce.oiChange;pchg=atm.pe.oiChange;
const t=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const part=k=>t.find(x=>x.type===k)?.value;const mins=Number(part('hour'))*60+Number(part('minute'));const inHours=!['Sat','Sun'].includes(part('weekday'))&&mins>=555&&mins<930;
const candleFresh=Boolean(last&&now-Date.parse(last[0])-300000>=0&&now-Date.parse(last[0])-300000<420000&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(last[0]))===today);
let signal={side:'WAIT',reason:'Waiting for fresh data and sufficient completed candles (historical + current session).'};
let direction=null;
if(inHours&&candleFresh&&e21!==null&&r!==null&&atr>0&&pcr!==null&&cchg!==null&&pchg!==null&&mins<910&&expiry>today&&todayClosed.length>=3&&tech.macdHist!==null&&tech.supertrendDirection!==null){
const prev=closed.slice(-4,-1);if(last[4]>e9&&e9>e21&&r>=55&&r<=72&&last[4]>Math.max(...prev.map(c=>c[2]))&&pchg>cchg&&pcr>=0.9&&tech.macdHist>0&&tech.supertrendDirection==='BULLISH')direction='CE';
if(last[4]<e9&&e9<e21&&r<=45&&r>=28&&last[4]<Math.min(...prev.map(c=>c[3]))&&cchg>pchg&&pcr<=1.1&&tech.macdHist<0&&tech.supertrendDirection==='BEARISH')direction='PE';
signal.reason='No confirmed breakout with aligned EMA, RSI, MACD, Supertrend and OI filters.';
}
if(!inHours||!candleFresh)signal.reason='Market closed or completed candle is stale. No new entry.';
if(expiry===today)signal.reason='Expiry-day entry disabled for this experimental strategy.';
if(mins>=910&&inHours)signal.reason='No new entry after 3:10 PM IST.';
if(direction){const leg=atm[direction.toLowerCase()];if(leg.key&&leg.bid>0&&leg.ask>=leg.bid&&leg.ask>0&&(leg.ask-leg.bid)/leg.ask<=0.02&&leg.volume>0){
const stamp=leg.quoteTime;const fresh=Number.isFinite(stamp)&&Date.now()-stamp<120000&&Date.now()-stamp>=-10000;
if(fresh){const entry=leg.ask,stop=Math.round(entry*0.8*100)/100,target=Math.round(entry*1.4*100)/100;
signal={side:direction,strike:atm.strike,key:leg.key,entry,stop,target,spotStop:direction==='CE'?last[4]-atr:last[4]+atr,quoteTime:new Date(stamp).toISOString(),reason:'Experimental paper setup: confirmed 5-minute breakout with EMA, RSI, MACD, Supertrend and ATM OI change alignment. Stop/target are illustrative 20%/40% premium levels.'};}
else signal.reason='Candidate quote timestamp stale or unavailable.';
}else signal.reason='Candidate strike lacks sufficient volume or has a wide bid/ask spread.';}
return json({ok:true,symbol,spot,expiry,expiries,chain,candles,history:{sessions:historySessions.length,candles:historical.length,from:historySessions[0]??null,to:prevSession??null,completedToday:todayClosed.length},metrics:{...tech,previousHigh,previousLow,previousClose,pivot,pivotR1:pivot===null?null:2*pivot-previousLow,pivotS1:pivot===null?null:2*pivot-previousHigh,openingHigh,openingLow,rsi:r,ema9:e9,ema21:e21,atr,pcr,callOI:coi,putOI:poi,callChange:cchg,putChange:pchg,support,resistance,maxPain,atm:atm.strike},signal,asOf:new Date().toISOString(),candleFresh,inHours});
}catch(e){return json({ok:false,error:/^Market provider/.test(e?.message||'')?e.message:'Market data or authentication temporarily unavailable.'},503);}
}
