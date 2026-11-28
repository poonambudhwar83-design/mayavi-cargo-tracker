import {lotSize} from './stocksPaperPerformance.js';
const finite=Number.isFinite;
const minute=t=>{const d=new Date(t+19800000);return d.getUTCHours()*60+d.getUTCMinutes()};
const localDay=t=>new Date(t+19800000).toISOString().slice(0,10);
const allowed=new Set(['MORNING_PRICE_ACTION_20_30','OPENING_40_80','SECOND_SETUP_4_5']);
export function makeSunilState(plan,lot,at,qt){
 if(!allowed.has(plan?.setup)||!['CE','PE'].includes(plan.side)||!['ATM','ITM'].includes(plan.strikeType)||![plan.entry,plan.stop,plan.target1,at,qt].every(finite)||!(0<plan.stop&&plan.stop<plan.entry&&plan.entry<plan.target1)||!Number.isInteger(lot)||lot<=0||qt>at||at-qt>30000)return null;
 const target2=finite(plan.target2)&&plan.target2>plan.target1?plan.target2:plan.target1;
 return {entry:plan.entry,stop:plan.stop,target1:plan.target1,target2,lot,opened:at,lastAt:at,lastQuote:qt,peak:plan.entry,lastBid:null,gap:false,methods:[{id:'FIXED_T1',lots:1},{id:'FULL_CTC',lots:1},{id:'HALF_CTC',lots:2},{id:'TRAIL',lots:1}].map(m=>({...m,left:m.lots,stop:plan.stop,fills:[],protected:false}))};
}
export function stepSunil(state,{bid,quoteTime,now,force=false,early=false}){
 if(!finite(bid)||bid<=0||!finite(quoteTime)||!finite(now)||quoteTime<=state.lastQuote||quoteTime<=state.opened||quoteTime>now||now-quoteTime>30000||now<=state.lastAt)return null;
 const s={...state,lastAt:now,lastQuote:quoteTime,lastBid:bid,peak:Math.max(state.peak,bid),gap:state.gap||now-state.lastAt>90000};
 s.methods=state.methods.map(old=>{
  const m={...old,fills:[...old.fills]};if(!m.left)return m;
  const sell=(n,reason)=>{m.fills.push({lots:n,price:bid,at:now,reason});m.left-=n;};
  if(force||bid<=m.stop||early){sell(m.left,force?'TIME_EXIT':bid<=m.stop?(m.stop>state.stop?'TRAIL_STOP':'STOP'):'EARLY_EXIT');return m;}
  if(m.id==='FIXED_T1'){if(bid>=s.target1)sell(m.left,'T1');return m;}
  if(!m.protected&&(bid>=s.target1||bid-s.entry>=40)){if(m.id==='HALF_CTC')sell(1,'PARTIAL');m.stop=Math.max(m.stop,s.entry);m.protected=true;}
  if(m.id==='TRAIL'&&bid-s.entry>=100)m.stop=Math.max(m.stop,s.entry+60);
  if(bid>=s.target2)sell(m.left,'TARGET');return m;
 });return s;
}
export function sunilStats(state){
 return state.methods.map(m=>{const gross=m.fills.reduce((v,f)=>v+(f.price-state.entry)*f.lots*state.lot,0);const points=gross/(m.lots*state.lot);return {method:m.id,lots:m.lots,remaining:m.left,gross,points,profitPerLot:gross/m.lots,capital:state.entry*state.lot*m.lots,stop:m.stop,fills:m.fills};});
}
let initialized;
export async function initSunilPaper(sql){
 if(!initialized)initialized=(async()=>{
 await sql`CREATE TABLE IF NOT EXISTS mayavi_sunil_paper_v1 (
 id bigserial PRIMARY KEY, trade_day date NOT NULL, symbol text NOT NULL, expiry date NOT NULL, contract_key text NOT NULL, strike numeric NOT NULL, side text NOT NULL, setup text NOT NULL, signal_bucket bigint NOT NULL, plan jsonb NOT NULL, state jsonb NOT NULL, status text NOT NULL DEFAULT 'OPEN', opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, version integer NOT NULL DEFAULT 0, UNIQUE(trade_day,symbol,signal_bucket))`;
 await sql`CREATE UNIQUE INDEX IF NOT EXISTS mayavi_sunil_one_open ON mayavi_sunil_paper_v1(symbol) WHERE status='OPEN'`;
 })().catch(e=>{initialized=null;throw e});return initialized;
}
export async function expireSunil(sql,today,now){
 if(minute(now)>=930)await sql`UPDATE mayavi_sunil_paper_v1 SET status='UNVERIFIED',closed_at=now(),version=version+1 WHERE status='OPEN' AND trade_day<=${today}::date`;
 else await sql`UPDATE mayavi_sunil_paper_v1 SET status='UNVERIFIED',closed_at=now(),version=version+1 WHERE status='OPEN' AND trade_day<${today}::date`;
}
export async function activeSunil(sql){const [row]=await sql`SELECT *,expiry::text AS expiry_text FROM mayavi_sunil_paper_v1 WHERE symbol='BANKNIFTY' AND status='OPEN' LIMIT 1`;return row||null;}
export async function registerSunil(sql,{today,expiry,key,plan,quoteTime}){
 if(!key||plan?.status!=='PAPER_PLAN')return false;
 const lot=await lotSize('BANKNIFTY',expiry,key,plan.side,plan.strike),at=Date.now();
 if(localDay(at)!==today||minute(at)<555||minute(at)>=910||expiry<=today||!finite(plan.asOf)||at-plan.asOf>30000)return false;
 const state=makeSunilState(plan,lot,at,quoteTime);if(!state)return false;
 const bucket=Math.floor(at/300000);
 const rows=await sql`INSERT INTO mayavi_sunil_paper_v1(trade_day,symbol,expiry,contract_key,strike,side,setup,signal_bucket,plan,state) SELECT ${today}::date,'BANKNIFTY',${expiry}::date,${key},${plan.strike},${plan.side},${plan.setup},${bucket},${JSON.stringify(plan)}::jsonb,${JSON.stringify(state)}::jsonb WHERE (SELECT count(*) FROM mayavi_sunil_paper_v1 WHERE trade_day=${today}::date AND symbol='BANKNIFTY')<3 ON CONFLICT DO NOTHING RETURNING id`;
 return rows.length>0;
}
export async function observeSunil(sql,row,leg,early=false){
 if(!row||leg?.key!==row.contract_key)return false;
 const now=Date.now(),qt=leg.quoteTime;
 if(!finite(qt)||localDay(qt)!==localDay(now)||minute(qt)>=930||minute(qt)<555)return false;
 const next=stepSunil(row.state,{bid:leg.bid,quoteTime:qt,now,force:minute(qt)>=920,early});
 if(!next)return false;
 const closed=next.methods.every(m=>m.left===0);
 const rows=await sql`UPDATE mayavi_sunil_paper_v1 SET state=${JSON.stringify(next)}::jsonb,status=${closed?'CLOSED':'OPEN'},closed_at=CASE WHEN ${closed} THEN now() ELSE NULL END,version=version+1 WHERE id=${row.id} AND version=${row.version} AND status='OPEN' RETURNING id`;
 return rows.length>0;
}
export async function sunilReport(sql,today){
 const rows=await sql`SELECT id,trade_day::text,expiry::text,strike,side,setup,status,opened_at,closed_at,plan,state FROM mayavi_sunil_paper_v1 WHERE trade_day>=${today}::date-30 ORDER BY opened_at DESC LIMIT 200`;
 return rows.map(r=>({...r,metrics:sunilStats(r.state),coverageGap:r.status==='UNVERIFIED'||r.state.gap,entry:r.state.entry,lot:r.state.lot}));
}
