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
function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function makeHeaderSelect(key,label,values){
  const select=document.createElement('select');
  select.setAttribute('data-active-header-filter',key);
  select.setAttribute('aria-label',`${label} filter`);
  select.style.cssText='display:block;width:100%;min-width:92px;margin-top:4px;padding:3px 22px 3px 6px;font-size:11px;line-height:1.2;border:1px solid #cbd5e1;border-radius:6px;background:#fff;';
  select.innerHTML=`<option value="">All ${label}</option>${values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
  return select;
}

export default function ActiveMasterFilters(){
  useEffect(()=>{
    let scheduled=false;
    const install=()=>{
      scheduled=false;
      const adminButtons=[...document.querySelectorAll('.adminViews button')];
      const isAdmin=adminButtons.length>0;
      const activeMastersVisible=!adminButtons.length||adminButtons.some(b=>b.classList.contains('active')&&/ACTIVE MASTERS/i.test(text(b)));
      const table=document.querySelector('.tableWrap table');
      document.getElementById('mayavi-active-master-filters')?.remove();
      if(!activeMastersVisible||!table){
        document.querySelectorAll('[data-active-header-filter]').forEach(el=>el.remove());
        document.querySelectorAll('[data-employee-custom-company]').forEach(el=>el.removeAttribute('data-employee-custom-company'));
        return;
      }

      const type=[...document.querySelectorAll('.typeTabs button')].find(b=>b.classList.contains('active'));
      const isImport=/IMPORT/i.test(text(type));
      const headersEls=[...table.querySelectorAll('thead th')];
      const headers=headersEls.map(th=>{
        const clone=th.cloneNode(true);
        clone.querySelectorAll('[data-active-header-filter]').forEach(el=>el.remove());
        return text(clone).replace(/\s+/g,' ');
      });
      const clientIndex=headers.findIndex(v=>/^Client/i.test(v));
      const companyIndex=headers.findIndex(v=>/^Company/i.test(v));
      const goodsIndex=headers.findIndex(v=>/^Goods/i.test(v));
      if(clientIndex<0||companyIndex<0){
        table.querySelectorAll('[data-active-header-filter]').forEach(el=>el.remove());
        return;
      }

      const rows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.querySelectorAll('td').length>2);
      rows.forEach(r=>{
        const td=cellEl(r,companyIndex);if(!td)return;
        const co=companyValue(r,companyIndex).toUpperCase();
        const custom=Boolean(co&&co!=='KCC'&&co!=='PV');
        if(!isAdmin&&custom)td.setAttribute('data-employee-custom-company','1');
        else td.removeAttribute('data-employee-custom-company');
      });

      const clients=unique(rows.map(r=>clientValue(r,clientIndex)));
      const rowCompanies=unique(rows.map(r=>companyValue(r,companyIndex)));
      const companies=isAdmin?unique(['KCC','PV',...rowCompanies]):['KCC','PV'];
      const goods=isImport&&goodsIndex>=0?unique(rows.map(r=>goodsValue(r,goodsIndex))):[];
      const signature=JSON.stringify({isImport,isAdmin,clients,companies,goods,headers:headers.length});
      const previous={
        client:table.querySelector('[data-active-header-filter="client"]')?.value||'',
        company:table.querySelector('[data-active-header-filter="company"]')?.value||'',
        goods:table.querySelector('[data-active-header-filter="goods"]')?.value||''
      };

      if(table.dataset.activeFilterSignature!==signature){
        table.querySelectorAll('[data-active-header-filter]').forEach(el=>el.remove());
        const configs=[
          {index:clientIndex,key:'client',label:'Clients',values:clients},
          {index:companyIndex,key:'company',label:'Companies',values:companies},
          ...(isImport&&goodsIndex>=0?[{index:goodsIndex,key:'goods',label:'Goods',values:goods}]:[])
        ];
        configs.forEach(({index,key,label,values})=>{
          const th=headersEls[index];if(!th)return;
          const select=makeHeaderSelect(key,label,values);
          th.appendChild(select);
          if(previous[key]&&[...select.options].some(o=>o.value===previous[key]))select.value=previous[key];
        });
        table.dataset.activeFilterSignature=signature;
      }

      const apply=()=>{
        const client=table.querySelector('[data-active-header-filter="client"]')?.value||'';
        const company=table.querySelector('[data-active-header-filter="company"]')?.value||'';
        const goods=table.querySelector('[data-active-header-filter="goods"]')?.value||'';
        rows.forEach(r=>{
          const c=clientValue(r,clientIndex);
          const co=companyValue(r,companyIndex);
          const g=goodsIndex>=0?goodsValue(r,goodsIndex):'';
          const show=(!client||c===client)&&(!company||co===company)&&(!goods||g===goods);
          r.style.display=show?'':'none';
        });
      };

      table.querySelectorAll('[data-active-header-filter]').forEach(s=>s.onchange=apply);
      apply();
    };

    const queue=()=>{if(scheduled)return;scheduled=true;setTimeout(install,0)};
    const observer=new MutationObserver(queue);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['value','class']});
    install();
    return()=>{
      observer.disconnect();
      document.getElementById('mayavi-active-master-filters')?.remove();
      document.querySelectorAll('[data-active-header-filter]').forEach(el=>el.remove());
      document.querySelectorAll('[data-employee-custom-company]').forEach(el=>el.removeAttribute('data-employee-custom-company'));
    }
  },[]);
  return null;
}
