'use client';
import {useState} from 'react';
import ImportProfitSheet from './ImportProfitSheet.js';
import AbsImportLedger from './AbsImportLedger.js';
const tabStyle={padding:'11px 17px',borderRadius:9,border:'1px solid #c9d6e8',cursor:'pointer',fontSize:13,fontWeight:900};
export default function ImportFinanceSection(){
  const [tab,setTab]=useState('PROFIT');
  return <>
    <nav aria-label="Import finance pages" style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',padding:'12px clamp(12px,3vw,32px)',background:'#eaf1fb',borderBottom:'1px solid #d4e1f2'}}>
      <strong style={{fontSize:13,color:'#1d3d66',marginRight:7}}>IMPORT</strong>
      { [['PROFIT','Import Profit Sheet'],['LEDGER','Client Ledger'],['BALANCE','Client Balance']].map(([key,label])=><button key={key} type="button" aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)} style={{...tabStyle,background:tab===key?'#2055a2':'#fff',color:tab===key?'#fff':'#214f87'}}>{label}</button>) }
    </nav>
    {tab==='PROFIT'?<ImportProfitSheet/>:<AbsImportLedger view={tab}/>}
  </>;
}
