'use client';
import {PaperPerformance} from './StocksDashboard.js';
const items=[
 {key:'GOLD',name:'Gold',icon:'Au',risk:'Interest rates, USD and global risk sentiment'},
 {key:'SILVER',name:'Silver',icon:'Ag',risk:'Precious-metal prices and industrial demand'},
 {key:'CRUDEOIL',name:'Crude Oil',icon:'OIL',risk:'Supply, OPEC and inventory releases'},
 {key:'NATURALGAS',name:'Natural Gas',icon:'GAS',risk:'Weather, storage and demand; high volatility'}
];
const box={background:'#fff',border:'1px solid #cbd5e1',borderRadius:12,padding:14,minWidth:0};
export default function CommodityDashboard(){
 return <main style={{padding:'16px clamp(10px,3vw,28px)',background:'#f1f5f9',color:'#0f172a',minHeight:'70vh'}}>
 <h1 style={{margin:'0 0 6px'}}>COMMODITIES · MCX</h1><p style={{margin:'0 0 12px'}}>Admin only · Indian rupees (INR) · Separate options research and paper trading. No real orders.</p>
 <section aria-label="Commodity trading availability" style={{...box,borderColor:'#d97706',marginBottom:12}}><strong style={{color:'#92400e'}}>WATCHLIST READY — LIVE FEED VERIFICATION PENDING</strong><p style={{fontSize:13,margin:'6px 0'}}>All four instruments are planned for day/evening monitoring during their actual MCX sessions, with holiday and expiry checks. Entry, target, stop and automatic close are disabled until contract data and quote freshness are verified. No equity timing or lot size will be reused.</p><a href="https://www.mcxindia.com/market-data/option-chain" target="_blank" rel="noreferrer">Official MCX option chain</a></section>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10}}>{items.map(x=><article key={x.key} style={box}><h2 style={{margin:'0 0 8px',fontSize:19}}>{x.name} <small style={{fontSize:12,color:'#64748b'}}>MCX</small></h2><p style={{fontSize:12,margin:'4px 0'}}>{x.risk}</p><strong style={{color:'#92400e',fontSize:13}}>NO ENTRY · DATA PENDING</strong><table style={{width:'100%',fontSize:13,marginTop:8,textAlign:'left'}}><tbody>{['Futures price','Option expiry / strike','Call / Put premium','Entry','Target 1','Target 2','Stop loss','Lot multiplier','Exit','P/L per lot'].map(label=><tr key={label}><td style={{padding:'4px 0'}}>{label}</td><td style={{textAlign:'right',color:'#64748b'}}>—</td></tr>)}</tbody></table></article>)}</div>
 <PaperPerformance commodity/>
 </main>;
}
