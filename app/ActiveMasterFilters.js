'use client';
import { useEffect } from 'react';

function text(el){return String(el?.textContent||'').trim()}
function unique(values){return [...new Set(values.map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))}
function cellEl(tr,i){return tr.querySelectorAll('td')[i]||null}
function clientValue(tr,i){return text(cellEl(tr,i))}
function goodsValue(tr,i){
  const td=cellEl(tr,i);if(!td)return'';
  const input=td.querySelector('input');
  return String(input?.value??text(td)).trim();
}
function companyValue(tr,i){
  const td=cellEl(tr,i);if(!td)return'';
  const select=td.querySelector('select');
  const selected=String(select?.value||'').trim();
  if(selected==='OTHER'){
    const input=td.querySelector('input');
    return String(input?.value||'').trim()||'OTHER';
  }
  if(selected)return selected;
  const raw=text(td).replace(/\s+/g,' ').trim();
  if(/\bKCC\b/i.test(raw))return'KCC';
  if(/\bPV\b/i.test(raw))return'PV';
  return raw.replace(/^Select\s*/i,'').trim();
}

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
        const clients=unique(bodyRows.map(r=>clientValue(r,clientIndex)));
        const companies=unique(bodyRows.map(r=>companyValue(r,companyIndex)));
        const goods=isImport&&goodsIndex>=0?unique(bodyRows.map(r=>goodsValue(r,goodsIndex))):[];

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
          const esc=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
          const select=(label,key,options)=>`<div><label>${label}</label><select data-filter="${key}"><option value="">All ${label}</option>${options.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></div>`;
          bar.innerHTML=select('CLIENTS','client',clients)+select('COMPANIES','company',companies)+(isImport?select('GOODS','goods',goods):'')+'<button type="button" data-clear="1">CLEAR FILTERS</button>';
          bar.dataset.signature=signature;
          ['client','company','goods'].forEach(k=>{const s=bar.querySelector(`[data-filter="${k}"]`);if(s&&previous[k]&&[...s.options].some(o=>o.value===previous[k]))s.value=previous[k]});
        }
        const apply=()=>{
          const client=bar.querySelector('[data-filter="client"]')?.value||'';
          const company=bar.querySelector('[data-filter="company"]')?.value||'';
          const goods=bar.querySelector('[data-filter="goods"]')?.value||'';
          bodyRows.forEach(r=>{
            const c=clientValue(r,clientIndex),co=companyValue(r,companyIndex),g=goodsIndex>=0?goodsValue(r,goodsIndex):'';
            const show=(!client||c===client)&&(!company||co===company)&&(!goods||g===goods);
            r.style.display=show?'':'none';
          });
        };
        bar.querySelectorAll('select').forEach(s=>s.onchange=apply);
        const clear=bar.querySelector('[data-clear="1"]');
        if(clear)clear.onclick=()=>{bar.querySelectorAll('select').forEach(s=>s.value='');apply()};
        apply();
      }finally{applying=false}
    };
    const observer=new MutationObserver(()=>setTimeout(install,0));
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['value','class']});
    install();
    return()=>{observer.disconnect();document.getElementById('mayavi-active-master-filters')?.remove()}
  },[]);
  return null;
}
