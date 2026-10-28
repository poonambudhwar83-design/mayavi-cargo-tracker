'use client';
import {useState} from 'react';
import BranchLoadsDashboard from './BranchLoadsDashboard.js';
import DashboardClient from './DashboardClient.js';

const button={border:'1px solid #cbd5e1',borderRadius:9,padding:'11px 16px',fontSize:13,fontWeight:800,cursor:'pointer'};
export default function HaryanaAdminDashboard({currentUser,onLogout}){
  const [tab,setTab]=useState('BRANCHES');
  return <>
    <nav aria-label="Haryana Admin sections" style={{display:'flex',gap:10,flexWrap:'wrap',padding:'12px 16px',background:'#eef3ff',borderBottom:'1px solid #cbd5e1'}}>
      <button type="button" style={{...button,background:tab==='BRANCHES'?'#1d4ed8':'#fff',color:tab==='BRANCHES'?'#fff':'#1e293b'}} onClick={()=>setTab('BRANCHES')}>JIND / KARNAL LOADS</button>
      <button type="button" style={{...button,background:tab==='MASTERS'?'#1d4ed8':'#fff',color:tab==='MASTERS'?'#fff':'#1e293b'}} onClick={()=>setTab('MASTERS')}>ACTIVE IMPORT MASTERS</button>
    </nav>
    {tab==='BRANCHES'?<BranchLoadsDashboard currentUser={currentUser}/>:
    <DashboardClient isAdmin haryanaMode currentUser={currentUser} onLogout={onLogout}/>}
  </>;
}
