'use client';

import {useState} from 'react';
import MonthlyComparisonDashboard from '../MonthlyComparisonDashboard.js';

const REPORTS=[
  {id:'import-customer',label:'Import • Customer-wise',title:'Customer Monthly Comparison',subtitle:'Customer × goods/origin • weight, bags and profit',kind:'import',section:'customer'},
  {id:'import-goods',label:'Import • Goods-wise',title:'Goods Monthly Comparison',subtitle:'Protein, Clothes and every goods description • weight and profit',kind:'import',section:'goods'},
  {id:'export-client',label:'Export • Client-wise',title:'Client Monthly Comparison',subtitle:'Client × month • total load and MAWBs',kind:'export',section:'client'}
];

export default function ReportsHome({initialReport='import-customer'}){
  const [active,setActive]=useState(REPORTS.some(report=>report.id===initialReport)?initialReport:'import-customer');
  const selected=REPORTS.find(report=>report.id===active)||REPORTS[0];

  return <div style={{background:'#f4f7fc',minHeight:'100vh',fontFamily:'inherit'}}>
    <header style={{background:'#fff',borderBottom:'1px solid #d7e2f1',padding:'14px clamp(12px,3vw,36px)'}}>
      <div style={{maxWidth:1800,margin:'auto',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,color:'#416aa3',fontWeight:900,letterSpacing:1.1}}>MAYAVI CARGO • ADMIN REPORTS</div>
          <h1 style={{margin:'5px 0 0',fontSize:'clamp(23px,3vw,31px)',color:'#143967'}}>Reports</h1>
          <div style={{fontSize:13,color:'#61748b',marginTop:5}}>All monthly customer, goods and client comparisons in one place.</div>
        </div>
        <a href="/" style={{textDecoration:'none',borderRadius:9,padding:'11px 16px',border:'1px solid #bfd0ea',background:'#e8f1ff',color:'#174e98',fontWeight:850}}>← Back to Mayavi</a>
      </div>
    </header>
    <nav aria-label="Choose Mayavi report" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:10,padding:'16px clamp(12px,3vw,36px)',maxWidth:1800,margin:'auto'}}>
      {REPORTS.map(report=><button type="button" key={report.id} onClick={()=>setActive(report.id)}
        aria-current={active===report.id?'page':undefined}
        style={{cursor:'pointer',textAlign:'left',padding:'16px 18px',borderRadius:12,
          border:active===report.id?'2px solid #2563ad':'1px solid #d8e2ef',
          background:active===report.id?'#e7f0ff':'#fff',color:'#163b64',
          boxShadow:active===report.id?'0 3px 12px rgba(36,99,170,.10)':'none'}}>
        <div style={{fontWeight:900,fontSize:15}}>{report.label}</div>
        <div style={{marginTop:6,fontSize:12,lineHeight:1.5,color:'#546f90'}}>{report.subtitle}</div>
      </button>)}
    </nav>
    <MonthlyComparisonDashboard key={selected.id} kind={selected.kind} section={selected.section}/>
  </div>;
}
