'use client';
import { useEffect } from 'react';

function text(el){return String(el?.textContent||'').trim()}
function weightValue(value=''){
  const s=String(value||'').replace(/,/g,'').trim();
  if(!s||s==='—')return 0;
  const parts=s.split('/').map(v=>Number(String(v).replace(/[^0-9.\-]/g,''))).filter(Number.isFinite);
  return parts.length?(parts.length>1?parts.at(-1):parts[0]):0;
}

export default function MasterTotals(){
  useEffect(()=>{
    let busy=false;
    const update=()=>{
      if(busy)return;
      busy=true;
      try{
        const isAdmin=Boolean(document.querySelector('.adminViews'));
        const tableWrap=document.querySelector('.tableWrap');
        const table=tableWrap?.querySelector('table');
        const existing=document.getElementById('mayavi-master-total-summary');
        if(!isAdmin||!tableWrap||!table){existing?.remove();return}

        [...document.querySelectorAll('.tableSummary')].forEach(el=>{
          if(el.id!=='mayavi-master-total-summary')el.style.display='none';
        });

        const headers=[...table.querySelectorAll('thead th')].map(th=>text(th).replace(/\s+/g,' '));
        const weightIndex=headers.findIndex(v=>/^Weight$/i.test(v));
        const rows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.querySelectorAll('td').length>2&&tr.style.display!=='none');
        const total=weightIndex<0?0:rows.reduce((sum,tr)=>{
          const cells=tr.querySelectorAll('td');
          return sum+weightValue(text(cells[weightIndex]));
        },0);

        const activeType=[...document.querySelectorAll('.typeTabs button')].find(b=>b.classList.contains('active'));
        const activeView=[...document.querySelectorAll('.adminViews button')].find(b=>b.classList.contains('active'));
        const type=/EXPORT/i.test(text(activeType))?'EXPORT':'IMPORT';
        const view=/CLEARED/i.test(text(activeView))?'CUSTOMS CLEARED':'ACTIVE MASTERS';

        let bar=existing;
        if(!bar){
          bar=document.createElement('section');
          bar.id='mayavi-master-total-summary';
          bar.className='tableSummary';
          tableWrap.parentNode?.insertBefore(bar,tableWrap.nextSibling);
        }
        bar.innerHTML=`<span>${view} • ${type} • ${rows.length} master${rows.length===1?'':'s'} shown</span><strong>Total Weight: ${total.toLocaleString(undefined,{maximumFractionDigits:2})} kg</strong>`;
      }finally{busy=false}
    };

    const observer=new MutationObserver(()=>setTimeout(update,0));
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','class']});
    update();
    return()=>{
      observer.disconnect();
      document.getElementById('mayavi-master-total-summary')?.remove();
      [...document.querySelectorAll('.tableSummary')].forEach(el=>{if(el.id!=='mayavi-master-total-summary')el.style.display=''})
    };
  },[]);
  return null;
}
