'use client';
import ImportProfitSheet from './ImportProfitSheet.js';

const tabStyle={padding:'11px 17px',borderRadius:9,border:'1px solid #c9d6e8',cursor:'pointer',fontSize:13,fontWeight:900};
export default function ImportFinanceSection(){
  return <>
    <nav aria-label="Import finance pages" style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',padding:'12px clamp(12px,3vw,32px)',background:'#eaf1fb',borderBottom:'1px solid #d4e1f2'}}>
      <strong style={{fontSize:13,color:'#1d3d66',marginRight:7}}>IMPORT</strong>
      <button type="button" aria-current="page"
        style={{...tabStyle,background:'#2055a2',color:'#fff',cursor:'default'}}>
        Import Profit Sheet
      </button>
    </nav>
    <ImportProfitSheet/>
  </>;
}
