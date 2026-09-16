'use client';
import { useEffect } from 'react';

function digits(value=''){return String(value||'').replace(/\D/g,'')}
function text(el){return String(el?.textContent||'').trim()}
function formatEntryDate(value=''){
  if(!value)return '—';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '—';
  return new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',
    day:'2-digit',
    month:'2-digit',
    year:'numeric'
  }).format(d);
}
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
    const enteredAtByAwb=new Map();

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

    function install(){
      if(stopped)return;
      scheduled=false;
      const table=document.querySelector('.tableWrap table');
      if(!table)return;

      const headerRow=table.querySelector('thead tr');
      if(headerRow&&!headerRow.querySelector('th[data-entry-date-column]')){
        const headers=[...headerRow.querySelectorAll('th')];
        if(headers.length){
          const th=document.createElement('th');
          th.setAttribute('data-entry-date-column','1');
          th.textContent='Entry Date';
          th.style.minWidth='96px';
          th.style.width='96px';
          th.style.whiteSpace='nowrap';
          headers[0].insertAdjacentElement('afterend',th);
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
          td.style.minWidth='96px';
          td.style.width='96px';
          td.style.whiteSpace='nowrap';
          td.style.fontWeight='700';
          cells[0].insertAdjacentElement('afterend',td);
        }
        const key=digits(awb);
        td.textContent=formatEntryDate(enteredAtByAwb.get(key)||'');
        if(!enteredAtByAwb.has(key))missingKnownDate=true;
      }
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
      document.querySelectorAll('[data-entry-date-column]').forEach(el=>el.remove());
      document.querySelectorAll('[data-entry-date-colspan-adjusted]').forEach(el=>{
        const current=Number(el.getAttribute('colspan'));
        if(Number.isFinite(current)&&current>1)el.setAttribute('colspan',String(current-1));
        el.removeAttribute('data-entry-date-colspan-adjusted');
      });
    };
  },[]);
  return null;
}
