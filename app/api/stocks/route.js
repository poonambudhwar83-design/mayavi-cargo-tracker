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
const [dates,candleData]=await Promise.all([provider('/v1/historical/expiries',{exchange,underlying_symbol:symbol,year}),provider('/v1/historical/candles',{exchange,segment:'CASH',groww_symbol:exchange+'-'+symbol,start_time:today+' 09:15:00',end_time:today+' 15:30:00',candle_interval:'5minute'})]);
const expiries=[...new Set((dates?.expiries||[]).filter(e=>typeof e==='string'&&e>=today))].sort();
const expiry=q.get('expiry')||expiries[0];if(!expiry||!expiries.includes(expiry))return json({ok:false,error:'No upcoming expiry returned by Groww for this index.'},422);
const raw=await provider('/v1/option-chain/exchange/'+exchange+'/underlying/'+symbol,{expiry_date:expiry});
const chain=Object.entries(raw?.strikes||{}).filter(([k])=>num(k)!==null).map(([k,v])=>({strike:num(k),ce:parseLeg(v?.CE),pe:parseLeg(v?.PE)})).sort((a,b)=>a.strike-b.strike);
const spot=num(raw?.underlying_ltp);if(!spot||!chain.length)return json({ok:false,error:'Option chain unavailable.'},503);
const stamp=c=>typeof c==='number'?new Date(c<1e12?c*1000:c).toISOString():/(?:Z|[+-]\d\d:\d\d)$/.test(String(c))?String(c):String(c).replace(' ','T')+'+05:30';
candleData.candles=(candleData?.candles||[]).filter(c=>Array.isArray(c)&&c.length>=5).map(c=>[stamp(c[0]),...c.slice(1)]);
const candles=(candleData?.candles||[]).filter(c=>Array.isArray(c)&&Number.isFinite(Date.parse(c[0]))&&c.slice(1,5).every(v=>num(v)!==null)).map(c=>[c[0],...c.slice(1,7).map(num)]).sort((a,b)=>Date.parse(a[0])-Date.parse(b[0]));
const closed=candles.filter(c=>Date.parse(c[0])+300000<=now),last=closed.at(-1),closes=closed.map(c=>c[4]),e9=ema(closes,9),e21=ema(closes,21),r=rsi(closes);
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
let signal={side:'WAIT',reason:'Waiting for at least 21 completed 5-minute candles, fresh data and aligned indicators.'};
let direction=null;
if(inHours&&candleFresh&&e21!==null&&r!==null&&atr>0&&pcr!==null&&cchg!==null&&pchg!==null&&mins<910&&expiry>today){
const prev=closed.slice(-4,-1);if(last[4]>e9&&e9>e21&&r>=55&&r<=72&&last[4]>Math.max(...prev.map(c=>c[2]))&&pchg>cchg&&pcr>=0.9)direction='CE';
if(last[4]<e9&&e9<e21&&r<=45&&r>=28&&last[4]<Math.min(...prev.map(c=>c[3]))&&cchg>pchg&&pcr<=1.1)direction='PE';
signal.reason='No confirmed breakout with aligned EMA, RSI and OI filters.';
}
if(!inHours||!candleFresh)signal.reason='Market closed or completed candle is stale. No new entry.';
if(expiry===today)signal.reason='Expiry-day entry disabled for this experimental strategy.';
if(mins>=910&&inHours)signal.reason='No new entry after 3:10 PM IST.';
if(direction){const leg=atm[direction.toLowerCase()];if(leg.key&&leg.bid>0&&leg.ask>=leg.bid&&leg.ask>0&&(leg.ask-leg.bid)/leg.ask<=0.02&&leg.volume>0){
const stamp=leg.quoteTime;const fresh=Number.isFinite(stamp)&&Date.now()-stamp<120000&&Date.now()-stamp>=-10000;
if(fresh){const entry=leg.ask,stop=Math.round(entry*0.8*100)/100,target=Math.round(entry*1.4*100)/100;
signal={side:direction,strike:atm.strike,key:leg.key,entry,stop,target,spotStop:direction==='CE'?last[4]-atr:last[4]+atr,quoteTime:new Date(stamp).toISOString(),reason:'Experimental paper setup: confirmed 5-minute breakout with EMA, RSI and ATM OI change alignment. Stop/target are illustrative 20%/40% premium levels.'};}
else signal.reason='Candidate quote timestamp stale or unavailable.';
}else signal.reason='Candidate strike lacks sufficient volume or has a wide bid/ask spread.';}
return json({ok:true,symbol,spot,expiry,expiries,chain,candles,metrics:{rsi:r,ema9:e9,ema21:e21,atr,pcr,callOI:coi,putOI:poi,callChange:cchg,putChange:pchg,support,resistance,maxPain,atm:atm.strike},signal,asOf:new Date().toISOString(),candleFresh,inHours});
}catch(e){return json({ok:false,error:/^Market provider/.test(e?.message||'')?e.message:'Market data or authentication temporarily unavailable.'},503);}
}
