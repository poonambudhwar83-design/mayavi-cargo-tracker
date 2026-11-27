// Paper research only. No broker orders, actual fills or reconstructed intraday highs.
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
 await sql`CREATE UNIQUE INDEX IF NOT EXISTS mayavi_stocks_paper_one_open ON mayavi_stocks_paper_performance(username,symbol) WHERE status='OPEN'`;
 })().catch(e=>{initialized=null;throw e});
 return initialized;
}
export async function expirePaper(sql,user,today){
 await sql`UPDATE mayavi_stocks_paper_performance SET status='UNVERIFIED', closed_at=now(),coverage_gap=true WHERE username=${user} AND status='OPEN' AND (trade_day<${today}::date OR (trade_day=${today}::date AND now() >= (trade_day::timestamp + interval '15 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata'))`;
}
export async function openPaper(sql,user,symbol){
 const [r]=await sql`SELECT * FROM mayavi_stocks_paper_performance WHERE username=${user} AND symbol=${symbol} AND status='OPEN' LIMIT 1`;return r||null;
}
export async function observePaper(sql,user,p,leg,expiry,minute){
 if(!p||String(p.expiry).slice(0,10)!==expiry||!leg||leg.key!==p.contract_key)return;
 const qt=Number(leg.quoteTime),opened=Date.parse(p.opened_at),prev=Date.parse(p.last_observed_at||p.opened_at);
 // Confirmed and conditional-ask cohorts use bid. LTP cohort uses last traded price, never executable fill.
 const px=Number(p.cohort==='INDICATIVE_LTP'?leg.quoteLtp:leg.bid);
 if(!Number.isFinite(qt)||qt<=prev||qt<=opened||Date.now()-qt>=120000||qt>Date.now()+10000||!(px>0))return;
 const at=new Date(qt).toISOString(),t1=px>=Number(p.target1),t2=px>=Number(p.target2),stop=px<=Number(p.stop);
 const quoteIST=new Date(qt+19800000),quoteMinute=quoteIST.getUTCHours()*60+quoteIST.getUTCMinutes();
 // Do not count post-cutoff movements as target hits. Only a fresh quote at/after cutoff can indicate time exit.
 const timed=quoteMinute>=920, status=timed?'TIME_EXIT':stop?'STOP':t2?'T2':'OPEN',gap=qt-prev>180000;
 await sql`UPDATE mayavi_stocks_paper_performance SET last_observed_at=${at}::timestamptz,last_price=${px},coverage_gap=coverage_gap OR ${gap},target1_at=CASE WHEN ${!timed&&t1} THEN COALESCE(target1_at,${at}::timestamptz) ELSE target1_at END,target2_at=CASE WHEN ${!timed&&t2} THEN COALESCE(target2_at,${at}::timestamptz) ELSE target2_at END,status=${status},exit_price=CASE WHEN ${status}<>'OPEN' THEN ${px} ELSE NULL END,closed_at=CASE WHEN ${status}<>'OPEN' THEN ${at}::timestamptz ELSE NULL END WHERE id=${p.id} AND username=${user} AND status='OPEN' AND COALESCE(last_observed_at,opened_at)<${at}::timestamptz`;
}
export async function registerPaper(sql,user,today,symbol,expiry,signal,conditional,key){
 const confirmed=['CE','PE'].includes(signal?.side),p=confirmed?signal:conditional;
 if(!p||p.score<75||!key)return;
 const price=confirmed?p.entry:p.referencePrice,t2=confirmed?p.target:p.target2;
 const nums=[price,p.stop,p.target1,t2,p.strike,p.score].map(Number);
 if(!nums.every(x=>Number.isFinite(x)&&x>0)||!(p.stop<price&&p.target1>price&&t2>p.target1))return;
 const qt=Date.parse(p.quoteTime||'');if(!Number.isFinite(qt)||Date.now()-qt>=120000||qt>Date.now()+10000)return;
 const cohort=confirmed?'CONFIRMED':p.referenceSource==='ASK'?'CONDITIONAL_ASK':'INDICATIVE_LTP';
 await sql`INSERT INTO mayavi_stocks_paper_performance(username,trade_day,symbol,expiry,contract_key,strike,side,cohort,score,entry,stop,target1,target2) VALUES(${user},${today}::date,${symbol},${expiry}::date,${key},${p.strike},${p.side},${cohort},${p.score},${price},${p.stop},${p.target1},${t2}) ON CONFLICT DO NOTHING`;
}
export async function paperReport(sql,user,today){
 const rows=await sql`SELECT id,trade_day::text AS trade_day,symbol,expiry::text AS expiry,strike,side,cohort,score,entry,stop,target1,target2,opened_at,last_observed_at,last_price,target1_at,target2_at,status,exit_price,closed_at,coverage_gap FROM mayavi_stocks_paper_performance WHERE username=${user} AND trade_day>=${today}::date-30 ORDER BY opened_at DESC LIMIT 1000`;
 return rows;
}
