'use client';
import { useEffect } from 'react';

function text(el){return String(el?.textContent||'').trim()}
function unique(values){return [...new Set(values.map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))}

export default function ActiveMasterFilters(){
  useEffect(()=>{
    let applying=false;
    const install=()=>{
      if(applying)return;
      applying=true;
      try{
        const adminActive=[...document.querySelectorAll('.adminViews button')].some(b=>b.classList.contains('active')&&/ACTIVE MASTERS/i.test(text(b)));
        const table=document.querySelector('.tableWrap table');
        const old=document.getElementById('mayavi-active-master-filters');
        if(!adminActive||!table){old?.remove();return}

        const type=[...document.querySelectorAll('.typeTabs button')].find(b=>b.classList.contains('active'));
        const isImport=/IMPORT/i.test(text(type));
        const headers=[...table.querySelectorAll('thead th')].map(th=>text(th).replace(/\s+/g,' '));
        const clientIndex=headers.findIndex(v=>/^Client/i.test(v));
        const companyIndex=headers.findIndex(v=>/^Company/i.test(v));
        const goodsIndex=headers.findIndex(v=>/^Goods/i.test(v));
        if(clientIndex<0||companyIndex<0){old?.remove();return}

        const bodyRows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.querySelectorAll('td').length>2);
        const getCell=(tr,i)=>text(tr.querySelectorAll('td')[i]);
        const clients=unique(bodyRows.map(r=>getCell(r,clientIndex)));
        const companies=unique(bodyRows.map(r=>getCell(r,companyIndex)).map(v=>v.replace(/^Select\s*/i,'').trim()));
        const goods=isImport&&goodsIndex>=0?unique(bodyRows.map(r=>getCell(r,goodsIndex))):[];

        let bar=old;
        const signature=JSON.stringify({isImport,clients,companies,goods});
        if(!bar){
          bar=document.createElement('section');
          bar.id='mayavi-active-master-filters';
          bar.className='filters';
          const tableWrap=document.querySelector('.tableWrap');
          tableWrap?.parentNode?.insertBefore(bar,tableWrap);
        }
        if(bar.dataset.signature!==signature){
          const previous={client:bar.querySelector('[data-filter="client"]')?.value||'',company:bar.querySelector('[data-filter="company"]')?.value||'',goods:bar.querySelector('[data-filter="goods"]')?.value||''};
          const select=(label,key,options)=>`<div><label>${label}</label><select data-filter="${key}"><option value="">All ${label}</option>${options.map(v=>`<option value="${v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\"/g,'&quot;')}">${v}</option>`).join('')}</select></div>`;
          bar.innerHTML=select('CLIENTS','client',clients)+select('COMPANIES','company',companies)+(isImport?select('GOODS','goods',goods):'')+'<button type="button" data-clear="1">CLEAR FILTERS</button>';
          bar.dataset.signature=signature;
          ['client','company','goods'].forEach(k=>{const s=bar.querySelector(`[data-filter="${k}"]`);if(s&&previous[k]&&[...s.options].some(o=>o.value===previous[k]))s.value=previous[k]});
          const apply=()=>{
            const client=bar.querySelector('[data-filter="client"]')?.value||'';
            const company=bar.querySelector('[data-filter="company"]')?.value||'';
            const goodsValue=bar.querySelector('[data-filter="goods"]')?.value||'';
            bodyRows.forEach(r=>{
              const c=getCell(r,clientIndex),co=getCell(r,companyIndex).replace(/^Select\s*/i,'').trim(),g=goodsIndex>=0?getCell(r,goodsIndex):'';
              const show=(!client||c===client)&&(!company||co.includes(company))&&(!goodsValue||g===goodsValue);
              r.style.display=show?'':'none';
            });
          };
          bar.querySelectorAll('select').forEach(s=>s.addEventListener('change',apply));
          bar.querySelector('[data-clear="1"]')?.addEventListener('click',()=>{bar.querySelectorAll('select').forEach(s=>s.value='');apply()});
          apply();
        }
      }finally{applying=false}
    };
    const observer=new MutationObserver(()=>setTimeout(install,0));
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    install();
    return()=>{observer.disconnect();document.getElementById('mayavi-active-master-filters')?.remove()}
  },[]);
  return null;
}
