// Paper research only. No broker orders, actual fills or reconstructed intraday highs.
// Public Groww instrument master; cache lookup, never guess lot sizes.
let master=null,masterAt=0,masterJob=null,masterRetry=0;
export async function lotSize(symbol,expiry,key,side,strike){
 if((!master||Date.now()-masterAt>21600000)&&Date.now()>=masterRetry){
 if(!masterJob)masterJob=(async()=>{try{const res=await fetch('https://growwapi-assets.groww.in/instruments/instrument.csv',{signal:AbortSignal.timeout(10000),cache:'no-store'});if(!res.ok)throw Error('master');const csv=await res.text();const split=l=>(l.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)||[]).filter((x,i,a)=>x!==''||i<a.length-1).map(x=>x.replace(/,$/,'').replace(/^"|"$/g,'').replace(/""/g,'"').trim());const lines=csv.split(/\r?\n/),head=split(lines.shift()||'').map(x=>x.replace(/^\uFEFF/,''));const at=k=>head.indexOf(k);for(const k of ['exchange','trading_symbol','groww_symbol','underlying_symbol','expiry_date','instrument_type','strike_price','lot_size'])if(at(k)<0)throw Error('columns');const m=new Map();for(const l of lines){if(!l)continue;const a=split(l);if(!['NIFTY','BANKNIFTY','SENSEX','BEL','HCLTECH','RELIANCE','HDFCBANK'].includes(a[at('underlying_symbol')]))continue;const n=Number(a[at('lot_size')]);if(!Number.isInteger(n)||n<=0)continue;const x={symbol:a[at('underlying_symbol')],expiry:a[at('expiry_date')],side:a[at('instrument_type')],strike:Number(a[at('strike_price')]),n,exchange:a[at('exchange')]};for(const k of ['trading_symbol','groww_symbol']){const id=a[at(k)];if(id)m.set(x.exchange+'|'+id,x);}}if(!m.size)throw Error('empty master');master=m;masterAt=Date.now();}catch{masterRetry=Date.now()+300000;}finally{masterJob=null;}})();await masterJob;}
 if(!master||Date.now()-masterAt>21600000)return null;
 const x=master.get((symbol==='SENSEX'?'BSE':'NSE')+'|'+key);
 return x&&x.symbol===symbol&&x.expiry===expiry&&x.side===side&&x.strike===Number(strike)?x.n:null;
}
let initialized;
export async function initPaper(sql){
 if(!initialized)initialized=(async()=>{
 await sql`CREATE TABLE IF NOT EXISTS mayavi_stocks_paper_performance (
 id bigserial PRIMARY KEY, username text NOT NULL, trade_day date NOT NULL, symbol text NOT NULL,
 expiry date NOT NULL, contract_key text NOT NULL, strike numeric NOT NULL, side text NOT NULL,
 cohort text NOT NULL, score integer NOT NULL, entry numeric NOT NULL, stop numeric NOT NULL,
 target1 numeric NOT NULL, target2 numeric NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(),
 last_observed_at timestamptz, last_price numeric, target1_at timestamptz, target2_at timestamptz,
 status text NOT NULL DEFAULT 'OPEN', exit_price numeric, closed_at timestamptz,
 coverage_gap boolean NOT NULL DEFAULT false, UNIQUE(username,trade_day,symbol,contract_key)
 )`;
 await sql`ALTER TABLE mayavi_stocks_paper_performance ADD COLUMN IF NOT EXISTS lot_size integer`;
 await sql`ALTER TABLE mayavi_stocks_paper_performance ADD COLUMN IF NOT EXISTS strategy_version text, ADD COLUMN IF NOT EXISTS active_stop numeric, ADD COLUMN IF NOT EXISTS peak_bid numeric, ADD COLUMN IF NOT EXISTS spot_stop numeric, ADD COLUMN IF NOT EXISTS plan_meta jsonb`;
 await sql`CREATE UNIQUE INDEX IF NOT EXISTS mayavi_stocks_paper_one_open ON mayavi_stocks_paper_performance(username,symbol) WHERE status='OPEN'`;
 })().catch(e=>{initialized=null;throw e});
 return initialized;
}
export async function expirePaper(sql,user,today){
 await sql`UPDATE mayavi_stocks_paper_performance SET status='UNVERIFIED', closed_at=now(),coverage_gap=true WHERE username=${user} AND status='OPEN' AND (trade_day<${today}::date OR (trade_day=${today}::date AND now() >= ((trade_day::timestamp + interval '15 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata')))`;
}
export async function openPaper(sql,user,symbol){
 const [r]=await sql`SELECT *, expiry::text AS expiry_text FROM mayavi_stocks_paper_performance WHERE username=${user} AND symbol=${symbol} AND status='OPEN' LIMIT 1`;return r||null;
}
export async function observePaper(sql,user,p,leg,expiry,minute,underlying=null){
 if(!p||p.expiry_text!==expiry||!leg||leg.key!==p.contract_key)return;
 const qt=Number(leg.quoteTime),opened=Date.parse(p.opened_at),prev=Date.parse(p.last_observed_at||p.opened_at);
 // Confirmed and conditional-ask cohorts use bid. LTP cohort uses last traded price, never executable fill.
 const px=Number(p.cohort==='INDICATIVE_LTP'?leg.quoteLtp:leg.bid);
 if(!Number.isFinite(qt)||qt<=prev||qt<=opened||Date.now()-qt>=120000||qt>Date.now()+10000||!(px>0))return;
 const at=new Date(qt).toISOString(),t1=px>=Number(p.target1),t2=px>=Number(p.target2),v2=['TECH_V2','TECH_V3'].includes(p.strategy_version);
 const active=Number(p.active_stop??p.stop),stop=px<=active,peak=Math.max(Number(p.peak_bid??p.entry),px);
 const invalid=v2&&p.spot_stop!=null&&underlying&&underlying.completedAt>opened&&underlying.completedAt<=qt+10000&&(p.side==='CE'?underlying.close<=Number(p.spot_stop):underlying.close>=Number(p.spot_stop));
 const quoteIST=new Date(qt+19800000),quoteMinute=quoteIST.getUTCHours()*60+quoteIST.getUTCMinutes();
 // Do not count post-cutoff movements as target hits. Only a fresh quote at/after cutoff can indicate time exit.
 const timed=quoteMinute>=920, status=timed?'TIME_EXIT':stop?(v2&&active>Number(p.stop)?'TRAIL_EXIT':'STOP'):t2?'T2':invalid?'TECH_EXIT':'OPEN',gap=qt-prev>180000;
 const nextStop=v2&&status==='OPEN'&&(p.target1_at||t1)?Math.max(active,Number(p.entry),Math.floor((peak-(Number(p.entry)-Number(p.stop)))*20)/20):active;
 await sql`UPDATE mayavi_stocks_paper_performance SET last_observed_at=${at}::timestamptz,last_price=${px},active_stop=${nextStop},peak_bid=${peak},coverage_gap=coverage_gap OR ${gap},target1_at=CASE WHEN ${!timed&&t1} THEN COALESCE(target1_at,${at}::timestamptz) ELSE target1_at END,target2_at=CASE WHEN ${!timed&&t2} THEN COALESCE(target2_at,${at}::timestamptz) ELSE target2_at END,status=${status},exit_price=CASE WHEN ${status}<>'OPEN' THEN ${px} ELSE NULL END,closed_at=CASE WHEN ${status}<>'OPEN' THEN ${at}::timestamptz ELSE NULL END WHERE id=${p.id} AND username=${user} AND status='OPEN' AND COALESCE(last_observed_at,opened_at)<${at}::timestamptz`;
}
export async function registerPaper(sql,user,today,symbol,expiry,signal,conditional,key){
 const confirmed=['CE','PE'].includes(signal?.side),p=confirmed?signal:conditional;
 if(!p||p.score<75||!key||!p.technicalPlan?.ok)return;
 const price=confirmed?p.entry:p.referencePrice,t2=confirmed?p.target:p.target2;
 const nums=[price,p.stop,p.target1,t2,p.strike,p.score].map(Number);
 if(!nums.every(x=>Number.isFinite(x)&&x>0)||!(p.stop<price&&p.target1>price&&t2>p.target1))return;
 const qt=Date.parse(p.quoteTime||'');if(!Number.isFinite(qt)||Date.now()-qt>=120000||qt>Date.now()+10000)return;
 const lot=await lotSize(symbol,expiry,key,p.side,p.strike);
 const cohort=confirmed?'CONFIRMED':p.referenceSource==='ASK'?'CONDITIONAL_ASK':'INDICATIVE_LTP';
 await sql`INSERT INTO mayavi_stocks_paper_performance(username,trade_day,symbol,expiry,contract_key,strike,side,cohort,score,entry,stop,target1,target2,lot_size,strategy_version,active_stop,peak_bid,spot_stop,plan_meta) VALUES(${user},${today}::date,${symbol},${expiry}::date,${key},${p.strike},${p.side},${cohort},${p.score},${price},${p.stop},${p.target1},${t2},${lot},${p.technicalPlan.version},${p.stop},${price},${p.spotStop},${JSON.stringify(p.technicalPlan)}::jsonb) ON CONFLICT DO NOTHING`;
}
export async function paperReport(sql,user,today){
 const rows=await sql`SELECT id,trade_day::text AS trade_day,symbol,expiry::text AS expiry,strike,side,cohort,score,entry,stop,target1,target2,lot_size,opened_at,last_observed_at,last_price,target1_at,target2_at,status,exit_price,closed_at,coverage_gap,strategy_version,active_stop,peak_bid,spot_stop,plan_meta FROM mayavi_stocks_paper_performance WHERE username=${user} AND trade_day>=${today}::date-30 ORDER BY opened_at DESC LIMIT 1000`;
 return rows;
}
