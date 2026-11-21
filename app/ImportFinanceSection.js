'use client';
import {useEffect,useState} from 'react';
import ImportProfitSheet from './ImportProfitSheet.js';
import ImportClientLedger from './ImportClientLedger.js';
import MonthlyComparisonDashboard from './MonthlyComparisonDashboard.js';

const tabStyle={padding:'11px 17px',borderRadius:9,border:'1px solid #c9d6e8',cursor:'pointer',fontSize:13,fontWeight:900};
export default function ImportFinanceSection(){
  const [tab,setTab]=useState('PROFIT');
  const [newLedgerAlerts,setNewLedgerAlerts]=useState(0);
  useEffect(()=>{
    let active=true;
    async function checkClearedAlerts(){
      if(document.visibilityState==='hidden')return;
      try{
        const response=await fetch('/api/import-client-receivables',{cache:'no-store',credentials:'include'});
        const data=await response.json();
        if(active&&response.ok&&data.ok)setNewLedgerAlerts((Number(data.unread)||0)+(Number(data.reconciliation?.openIssues)||0));
      }catch{} // Existing finance tab should never fail because notifications are unavailable.
    }
    void checkClearedAlerts();
    const timer=setInterval(()=>void checkClearedAlerts(),60000);
    document.addEventListener('visibilitychange',checkClearedAlerts);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',checkClearedAlerts);};
  },[tab]);
  return <>
    <nav aria-label="Import finance pages" style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',padding:'12px clamp(12px,3vw,32px)',background:'#eaf1fb',borderBottom:'1px solid #d4e1f2'}}>
      <strong style={{fontSize:13,color:'#1d3d66',marginRight:7}}>IMPORT</strong>
      <button type="button" aria-current={tab==='PROFIT'?'page':undefined} onClick={()=>setTab('PROFIT')}
        style={{...tabStyle,background:tab==='PROFIT'?'#2055a2':'#fff',color:tab==='PROFIT'?'#fff':'#214f87'}}>
        Import Profit Sheet
      </button>
      <button type="button" aria-current={tab==='LEDGER'?'page':undefined} onClick={()=>setTab('LEDGER')}
        style={{...tabStyle,background:tab==='LEDGER'?'#087b73':'#fff',color:tab==='LEDGER'?'#fff':'#1f5e63'}}>
        Client Ledger • Receivables{newLedgerAlerts>0?' • '+newLedgerAlerts+' New':''}
      </button>
      <button type="button" aria-current={tab==='CUSTOMER_COMPARISON'?'page':undefined} onClick={()=>setTab('CUSTOMER_COMPARISON')}
        style={{...tabStyle,background:tab==='CUSTOMER_COMPARISON'?'#2055a2':'#fff',color:tab==='CUSTOMER_COMPARISON'?'#fff':'#214f87'}}>
        Monthly Customer Comparison
      </button>
      <button type="button" aria-current={tab==='GOODS_COMPARISON'?'page':undefined} onClick={()=>setTab('GOODS_COMPARISON')}
        style={{...tabStyle,background:tab==='GOODS_COMPARISON'?'#2055a2':'#fff',color:tab==='GOODS_COMPARISON'?'#fff':'#214f87'}}>
        Monthly Goods Comparison
      </button>
    </nav>
    {tab==='PROFIT'?<ImportProfitSheet/>:tab==='CUSTOMER_COMPARISON'?<MonthlyComparisonDashboard kind="import" section="customer"/>:tab==='GOODS_COMPARISON'?<MonthlyComparisonDashboard kind="import" section="goods"/>:<ImportClientLedger onOpenProfit={()=>setTab('PROFIT')}/>}
  </>;
}
