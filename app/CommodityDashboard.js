'use client';
import {useState,useEffect} from 'react';
import {PaperPerformance} from './StocksDashboard.js';
const items=[
 {key:'GOLD',name:'Gold',icon:'Au',risk:'Interest rates, USD and global risk sentiment'},
 {key:'SILVER',name:'Silver',icon:'Ag',risk:'Precious-metal prices and industrial demand'},
 {key:'CRUDEOIL',name:'Crude Oil',icon:'OIL',risk:'Supply, OPEC and inventory releases'},
 {key:'NATURALGAS',name:'Natural Gas',icon:'GAS',risk:'Weather, storage and demand; high volatility'}
];
const box={background:'#fff',border:'1px solid #cbd5e1',borderRadius:12,padding:14,minWidth:0};
const fmt=v=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
const ts=v=>v?new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'—';
export default function CommodityDashboard(){
 const [snap,setSnap]=useState({}),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true,running=false,controller;async function scan(){if(running||document.visibilityState==='hidden')return;running=true;try{for(const x of items){if(!active||document.visibilityState==='hidden')break;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),65000);try{const r=await fetch('/api/stocks?commodityQuote='+x.key,{cache:'no-store',signal:controller.signal});const d=await r.json();if(active)setSnap(p=>({...p,[x.key]:r.ok&&d.ok?d:{error:d.error||'Groww MCX feed unavailable'}}));if(r.status===429||/429/.test(d.error||''))break;}catch{if(active)setSnap(p=>({...p,[x.key]:{error:'Groww MCX feed unavailable'}}));}finally{clearTimeout(timeout);}}}finally{running=false;}}void scan();const id=setInterval(scan,180000);document.addEventListener('visibilitychange',scan);return()=>{active=false;clearInterval(id);document.removeEventListener('visibilitychange',scan);controller?.abort();};},[refresh]);
 const price=q=>q?.ltp==null?'—':'₹'+fmt(q.ltp)+(q.fresh?' · fresh at fetch':' · last quote');

 return <main style={{padding:'16px clamp(10px,3vw,28px)',background:'#f1f5f9',color:'#0f172a',minHeight:'70vh'}}>
 <h1 style={{margin:'0 0 6px'}}>COMMODITIES · MCX</h1><p style={{margin:'0 0 12px'}}>Admin only · Indian rupees (INR) · Separate options research and paper trading. No real orders.</p>
 <section aria-label="Commodity trading availability" style={{...box,borderColor:'#d97706',marginBottom:12}}><strong style={{color:'#92400e'}}>GROWW MCX — QUOTE DISCOVERY / ENTRY DISABLED</strong><p style={{fontSize:13,margin:'6px 0'}}>Read-only Groww commodity quote requests use exact contracts from the instrument master. Futures and nearby option quotes are displayed when returned. Entry, target, stop and automatic close remain disabled until full option candles, contract multiplier and session rules are independently validated. Quotes refresh best-effort while this page is visible.</p><button onClick={()=>setRefresh(v=>v+1)} style={{marginRight:12,padding:'6px 10px'}}>Refresh Groww data</button><a href="https://www.mcxindia.com/market-data/option-chain" target="_blank" rel="noreferrer">Official MCX option chain</a></section>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10}}>{items.map(x=>{const d=snap[x.key],f=d?.future;return <article key={x.key} style={box}><h2 style={{margin:'0 0 8px',fontSize:19}}>{x.name} <small style={{fontSize:12,color:'#64748b'}}>MCX</small></h2><p style={{fontSize:12,margin:'4px 0'}}>{x.risk}</p><strong style={{color:'#92400e',fontSize:13}}>NO ENTRY · {d?.error||f?.error?'FEED UNAVAILABLE':f?.ltp>0?'QUOTES AVAILABLE':'DATA PENDING'}</strong><p style={{fontSize:12}}>{d?.error||f?.error||('Last trade: '+ts(f?.quoteTime)+' IST')}</p><table style={{width:'100%',fontSize:13,marginTop:8,textAlign:'left'}}><tbody>{[['Futures contract',f?.key||'—'],['Futures price',price(f)],['Futures expiry',f?.expiry||'—'],['Nearby strike / expiry',d?.strike!=null?fmt(d.strike)+' / '+d.expiry:'—'],['Call premium',price(d?.call)],['Put premium',price(d?.put)],['Call bid / ask',fmt(d?.call?.bid)+' / '+fmt(d?.call?.ask)],['Put bid / ask',fmt(d?.put?.bid)+' / '+fmt(d?.put?.ask)],['Futures candles',d?.candles??'—'],['Full option chain',d?.chainAvailable?'Returned':'Not verified'],['Entry / targets / SL','Disabled'],['P/L multiplier','Not validated'],['Exit / P&L','—']].map(([label,value])=><tr key={label}><td style={{padding:'4px 0'}}>{label}</td><td style={{textAlign:'right',color:'#475569'}}>{value}</td></tr>)}</tbody></table><small>Nearby strike is based on front futures price, not confirmed ATM for a different expiry. {d?.historyError||''} {d?.chainError||''}</small></article>})}</div>
 <PaperPerformance commodity/>
 </main>;
}
