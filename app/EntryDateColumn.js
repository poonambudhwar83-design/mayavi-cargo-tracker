'use client';
import { useEffect } from 'react';

function digits(value=''){return String(value||'').replace(/\D/g,'')}
function text(el){return String(el?.textContent||'').trim()}
function dateKey(value=''){
  if(!value)return'';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return'';
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(d);
  const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return map.year&&map.month&&map.day?`${map.year}-${map.month}-${map.day}`:'';
}
function formatDateKey(key=''){
  const m=String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}/${m[2]}/${m[1]}`:'—';
}
function formatEntryDate(value=''){return formatDateKey(dateKey(value))}
function rowMawb(tr){
  const cells=[...tr.querySelectorAll('td')];
  for(const td of cells){
    const value=text(td.querySelector('strong')||td);
    const match=value.match(/\b(\d{3}-\d{8})\b/);
    if(match)return match[1];
  }
  return'';
}

export default function EntryDateColumn(){
  useEffect(()=>{
    let stopped=false;
    let scheduled=false;
    let loading=false;
    let reloadTimer=null;
    let selectedDate='';
    const enteredAtByAwb=new Map();

    let style=document.getElementById('mayavi-entry-date-filter-style');
    if(!style){
      style=document.createElement('style');
      style.id='mayavi-entry-date-filter-style';
      style.textContent='.mayavi-entry-date-hidden{display:none!important;}';
      document.head.appendChild(style);
    }

    async function loadEntryDates(){
      if(loading||stopped)return;
      loading=true;
      try{
        const res=await fetch('/api/shipments',{cache:'no-store',credentials:'include'});
        const data=await res.json();
        if(!data?.ok)return;
        enteredAtByAwb.clear();
        for(const record of data.rows||[]){
          const d=record?.data||{};
          const key=digits(d.mawb||d.awb||record.awb);
          if(key)enteredAtByAwb.set(key,d.enteredAt||'');
        }
      }catch{}finally{
        loading=false;
        if(!stopped)install();
      }
    }

    function requestReload(){
      if(reloadTimer||loading||stopped)return;
      reloadTimer=setTimeout(()=>{
        reloadTimer=null;
        loadEntryDates();
      },350);
    }

    function applyFilter(table){
      const rows=[...table.querySelectorAll('tbody tr')];
      for(const tr of rows){
        if(tr.querySelectorAll('td').length<=1)continue;
        const awb=rowMawb(tr);
        if(!awb)continue;
        const key=digits(awb);
        const rowDate=dateKey(enteredAtByAwb.get(key)||'');
        tr.classList.toggle('mayavi-entry-date-hidden',Boolean(selectedDate&&rowDate!==selectedDate));
      }
    }

    function install(){
      if(stopped)return;
      scheduled=false;
      const table=document.querySelector('.tableWrap table');
      if(!table)return;

      const headerRow=table.querySelector('thead tr');
      let dateHeader=headerRow?.querySelector('th[data-entry-date-column]')||null;
      if(headerRow&&!dateHeader){
        const headers=[...headerRow.querySelectorAll('th')];
        if(headers.length){
          dateHeader=document.createElement('th');
          dateHeader.setAttribute('data-entry-date-column','1');
          dateHeader.style.minWidth='138px';
          dateHeader.style.width='138px';
          dateHeader.style.whiteSpace='nowrap';
          headers[0].insertAdjacentElement('afterend',dateHeader);
        }
      }

      let missingKnownDate=false;
      const rows=[...table.querySelectorAll('tbody tr')];
      for(const tr of rows){
        const cells=[...tr.querySelectorAll('td')];
        if(!cells.length)continue;

        if(cells.length===1&&cells[0].hasAttribute('colspan')){
          const empty=cells[0];
          if(!empty.hasAttribute('data-entry-date-colspan-adjusted')){
            const current=Number(empty.getAttribute('colspan'));
            if(Number.isFinite(current)&&current>0)empty.setAttribute('colspan',String(current+1));
            empty.setAttribute('data-entry-date-colspan-adjusted','1');
          }
          continue;
        }

        const awb=rowMawb(tr);
        if(!awb)continue;
        let td=tr.querySelector('td[data-entry-date-column]');
        if(!td){
          td=document.createElement('td');
          td.setAttribute('data-entry-date-column','1');
          td.style.minWidth='138px';
          td.style.width='138px';
          td.style.whiteSpace='nowrap';
          td.style.fontWeight='700';
          cells[0].insertAdjacentElement('afterend',td);
        }
        const key=digits(awb);
        td.textContent=formatEntryDate(enteredAtByAwb.get(key)||'');
        if(!enteredAtByAwb.has(key))missingKnownDate=true;
      }

      if(dateHeader&&!dateHeader.querySelector('input[data-entry-date-filter]')){
        dateHeader.innerHTML='<span>Entry Date</span>';
        const wrap=document.createElement('div');
        wrap.style.cssText='display:flex;align-items:center;gap:4px;margin-top:4px;';
        const input=document.createElement('input');
        input.type='date';
        input.setAttribute('data-entry-date-filter','1');
        input.setAttribute('aria-label','Filter by entry date');
        input.title='Select entry date';
        input.style.cssText='width:108px;min-width:108px;padding:3px 4px;font-size:11px;line-height:1.2;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#334155;';
        input.value=selectedDate;
        const clear=document.createElement('button');
        clear.type='button';
        clear.textContent='×';
        clear.title='Clear entry date filter';
        clear.setAttribute('aria-label','Clear entry date filter');
        clear.style.cssText='width:22px;height:22px;padding:0;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;font-size:15px;font-weight:700;line-height:18px;cursor:pointer;';
        input.onchange=()=>{
          selectedDate=input.value||'';
          applyFilter(table);
        };
        clear.onclick=e=>{
          e.preventDefault();
          selectedDate='';
          input.value='';
          applyFilter(table);
        };
        wrap.appendChild(input);
        wrap.appendChild(clear);
        dateHeader.appendChild(wrap);
      }else if(dateHeader){
        const input=dateHeader.querySelector('input[data-entry-date-filter]');
        if(input&&input.value!==selectedDate)input.value=selectedDate;
      }

      applyFilter(table);
      if(missingKnownDate)requestReload();
    }

    function queueInstall(){
      if(scheduled||stopped)return;
      scheduled=true;
      setTimeout(install,0);
    }

    const observer=new MutationObserver(queueInstall);
    observer.observe(document.body,{childList:true,subtree:true});
    install();
    loadEntryDates();

    return()=>{
      stopped=true;
      observer.disconnect();
      if(reloadTimer)clearTimeout(reloadTimer);
      document.querySelectorAll('.mayavi-entry-date-hidden').forEach(el=>el.classList.remove('mayavi-entry-date-hidden'));
      document.querySelectorAll('[data-entry-date-column]').forEach(el=>el.remove());
      document.querySelectorAll('[data-entry-date-colspan-adjusted]').forEach(el=>{
        const current=Number(el.getAttribute('colspan'));
        if(Number.isFinite(current)&&current>1)el.setAttribute('colspan',String(current-1));
        el.removeAttribute('data-entry-date-colspan-adjusted');
      });
      document.getElementById('mayavi-entry-date-filter-style')?.remove();
    };
  },[]);
  return null;
}
