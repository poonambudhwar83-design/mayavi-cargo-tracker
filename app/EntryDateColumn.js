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
    let fromDate='';
    let toDate='';
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
        const inRange=Boolean(
          rowDate &&
          (!fromDate||rowDate>=fromDate) &&
          (!toDate||rowDate<=toDate)
        );
        const filterActive=Boolean(fromDate||toDate);
        tr.classList.toggle('mayavi-entry-date-hidden',filterActive&&!inRange);
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
          dateHeader.style.minWidth='240px';
          dateHeader.style.width='240px';
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
          td.style.minWidth='240px';
          td.style.width='240px';
          td.style.whiteSpace='nowrap';
          td.style.fontWeight='700';
          cells[0].insertAdjacentElement('afterend',td);
        }
        const key=digits(awb);
        td.textContent=formatEntryDate(enteredAtByAwb.get(key)||'');
        if(!enteredAtByAwb.has(key))missingKnownDate=true;
      }

      if(dateHeader&&!dateHeader.querySelector('[data-entry-date-range]')){
        dateHeader.innerHTML='<span>Entry Date</span>';
        const wrap=document.createElement('div');
        wrap.setAttribute('data-entry-date-range','1');
        wrap.style.cssText='display:flex;align-items:flex-end;gap:5px;margin-top:4px;';

        const makeDateBox=(labelText,kind,value)=>{
          const box=document.createElement('label');
          box.style.cssText='display:flex;flex-direction:column;gap:2px;font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;';
          const label=document.createElement('span');
          label.textContent=labelText;
          const input=document.createElement('input');
          input.type='date';
          input.setAttribute(`data-entry-date-${kind}`,'1');
          input.setAttribute('aria-label',`${labelText} entry date`);
          input.style.cssText='width:92px;min-width:92px;padding:3px 4px;font-size:10px;line-height:1.2;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#334155;';
          input.value=value;
          box.appendChild(label);
          box.appendChild(input);
          return {box,input};
        };

        const from=makeDateBox('From','from',fromDate);
        const to=makeDateBox('To','to',toDate);
        const clear=document.createElement('button');
        clear.type='button';
        clear.textContent='×';
        clear.title='Clear entry date range';
        clear.setAttribute('aria-label','Clear entry date range');
        clear.style.cssText='width:22px;height:22px;padding:0;margin-bottom:1px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;font-size:15px;font-weight:700;line-height:18px;cursor:pointer;';

        const sync=()=>{
          fromDate=from.input.value||'';
          toDate=to.input.value||'';
          if(fromDate&&toDate&&fromDate>toDate){
            const temp=fromDate;
            fromDate=toDate;
            toDate=temp;
            from.input.value=fromDate;
            to.input.value=toDate;
          }
          applyFilter(table);
        };
        from.input.onchange=sync;
        to.input.onchange=sync;
        clear.onclick=e=>{
          e.preventDefault();
          fromDate='';
          toDate='';
          from.input.value='';
          to.input.value='';
          applyFilter(table);
        };

        wrap.appendChild(from.box);
        wrap.appendChild(to.box);
        wrap.appendChild(clear);
        dateHeader.appendChild(wrap);
      }else if(dateHeader){
        const from=dateHeader.querySelector('input[data-entry-date-from]');
        const to=dateHeader.querySelector('input[data-entry-date-to]');
        if(from&&from.value!==fromDate)from.value=fromDate;
        if(to&&to.value!==toDate)to.value=toDate;
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
