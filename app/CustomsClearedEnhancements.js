'use client';
import { useEffect } from 'react';

function txt(el){return String(el?.textContent||'').trim()}
function uniq(values){return [...new Set(values.map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))}
function weightFromCell(value=''){
  const s=String(value||'').replace(/,/g,'').trim();
  if(!s||s==='—')return 0;
  const nums=s.match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite)||[];
  return nums.length?nums.at(-1):0;
}
function tdAt(tr,i){return tr.querySelectorAll('td')[i]||null}
function clientValue(tr,i){return txt(tdAt(tr,i))}
function companyValue(tr,i){
  const td=tdAt(tr,i);if(!td)return'';
  const select=td.querySelector('select');
  const selected=String(select?.value||'').trim();
  if(selected==='OTHER'){
    const input=td.querySelector('input');
    return String(input?.value||'').trim()||'OTHER';
  }
  if(selected)return selected;
  const raw=txt(td).replace(/\s+/g,' ').trim();
  if(/\bKCC\b/i.test(raw))return'KCC';
  if(/\bPV\b/i.test(raw))return'PV';
  return raw.replace(/^Select\s*/i,'').trim();
}
function weightValue(tr,i){return txt(tdAt(tr,i))}

export default function CustomsClearedEnhancements(){
  useEffect(()=>{
    let scheduled=false;
    const install=()=>{
      scheduled=false;
      const clearedActive=[...document.querySelectorAll('.adminViews button')].some(b=>b.classList.contains('active')&&/CUSTOMS CLEARED/i.test(txt(b)));
      const table=document.querySelector('.tableWrap table');
      let bar=document.getElementById('mayavi-cleared-enhancements');
      if(!clearedActive||!table){bar?.remove();return}

      const headers=[...table.querySelectorAll('thead th')].map(th=>txt(th).replace(/\s+/g,' '));
      const clientIndex=headers.findIndex(v=>/^Client/i.test(v));
      const companyIndex=headers.findIndex(v=>/^Company/i.test(v));
      const weightIndex=headers.findIndex(v=>/^Weight$/i.test(v));
      if(clientIndex<0||companyIndex<0||weightIndex<0){bar?.remove();return}

      const rows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.querySelectorAll('td').length>2);
      const clients=uniq(rows.map(r=>clientValue(r,clientIndex)));
      const companies=uniq(rows.map(r=>companyValue(r,companyIndex)));
      const signature=JSON.stringify({clients,companies,headers:headers.length});

      if(!bar){
        bar=document.createElement('section');
        bar.id='mayavi-cleared-enhancements';
        bar.className='filters';
        const wrap=document.querySelector('.tableWrap');
        wrap?.parentNode?.insertBefore(bar,wrap);
      }

      if(bar.dataset.signature!==signature){
        const oldClient=bar.querySelector('[data-cleared-client]')?.value||'';
        const oldCompany=bar.querySelector('[data-cleared-company]')?.value||'';
        const esc=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
        const options=arr=>arr.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
        bar.innerHTML=`<div><label>CLIENT</label><select data-cleared-client><option value="">All Clients</option>${options(clients)}</select></div><div><label>COMPANY</label><select data-cleared-company><option value="">All Companies</option>${options(companies)}</select></div><button type="button" data-cleared-reset>CLEAR FILTERS</button><div style="margin-left:auto;display:grid;gap:2px;min-width:150px;text-align:right"><span style="font-size:11px;font-weight:700;color:#64748b">TOTAL WEIGHT</span><strong data-cleared-total style="font-size:18px">0 kg</strong></div>`;
        bar.dataset.signature=signature;
        const cs=bar.querySelector('[data-cleared-client]'),cos=bar.querySelector('[data-cleared-company]');
        if(oldClient&&[...cs.options].some(o=>o.value===oldClient))cs.value=oldClient;
        if(oldCompany&&[...cos.options].some(o=>o.value===oldCompany))cos.value=oldCompany;
      }

      const apply=()=>{
        const client=bar.querySelector('[data-cleared-client]')?.value||'';
        const company=bar.querySelector('[data-cleared-company]')?.value||'';
        let total=0,shown=0;
        rows.forEach(r=>{
          const c=clientValue(r,clientIndex),co=companyValue(r,companyIndex);
          const show=(!client||c===client)&&(!company||co===company);
          r.style.display=show?'':'none';
          if(show){shown++;total+=weightFromCell(weightValue(r,weightIndex));}
        });
        const totalEl=bar.querySelector('[data-cleared-total]');
        if(totalEl)totalEl.textContent=`${total.toLocaleString(undefined,{maximumFractionDigits:2})} kg • ${shown} master${shown===1?'':'s'}`;
      };
      bar.querySelectorAll('select').forEach(s=>{s.onchange=apply});
      const reset=bar.querySelector('[data-cleared-reset]');
      if(reset)reset.onclick=()=>{bar.querySelectorAll('select').forEach(s=>s.value='');apply()};
      apply();
    };

    const queue=()=>{if(scheduled)return;scheduled=true;setTimeout(install,0)};
    const observer=new MutationObserver(queue);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','value']});
    install();
    return()=>{observer.disconnect();document.getElementById('mayavi-cleared-enhancements')?.remove()}
  },[]);
  return null;
}
