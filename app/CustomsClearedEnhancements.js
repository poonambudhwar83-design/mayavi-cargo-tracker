'use client';
import { useEffect } from 'react';

const DATE_RANGE_KEY='mayavi_cleared_import_arrival_range';
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
function goodsValue(tr,i){
  const td=tdAt(tr,i);if(!td)return'';
  const input=td.querySelector('input');
  return String(input?.value??txt(td)).trim();
}
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
function mailSortValue(value=''){
  const s=String(value||'').trim();
  const m=s.match(/(20\d{2})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if(!m)return null;
  let h=Number(m[4]);
  if(h===12)h=0;
  if(m[6].toUpperCase()==='PM')h+=12;
  const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),h,Number(m[5]),0,0);
  return Number.isFinite(d.getTime())?d.getTime():null;
}
function arrivalSortValue(dateValue='',timeValue=''){
  const dm=String(dateValue||'').trim().match(/(20\d{2})-(\d{2})-(\d{2})/);
  if(!dm)return null;
  let h=0,m=0;
  const tm=String(timeValue||'').trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if(tm){
    h=Number(tm[1]);m=Number(tm[2]);
    if(tm[3]){
      if(h===12)h=0;
      if(tm[3].toUpperCase()==='PM')h+=12;
    }
  }
  const d=new Date(Number(dm[1]),Number(dm[2])-1,Number(dm[3]),h,m,0,0);
  return Number.isFinite(d.getTime())?d.getTime():null;
}
function arrivalDateOnly(value=''){
  const m=String(value||'').trim().match(/(20\d{2}-\d{2}-\d{2})/);
  return m?m[1]:'';
}
function readDateRange(){
  try{
    const parsed=JSON.parse(sessionStorage.getItem(DATE_RANGE_KEY)||'{}');
    return {from:String(parsed?.from||''),to:String(parsed?.to||'')};
  }catch{return {from:'',to:''}}
}
function saveDateRange(from='',to=''){
  try{sessionStorage.setItem(DATE_RANGE_KEY,JSON.stringify({from,to}))}catch{}
}
function hideLocationFiltersForClearedImport(){
  const type=[...document.querySelectorAll('.typeTabs button')].find(b=>b.classList.contains('active'));
  if(!/IMPORT/i.test(txt(type)))return;
  document.querySelectorAll('section.filters').forEach(section=>{
    if(section.id==='mayavi-cleared-enhancements')return;
    [...section.querySelectorAll(':scope > div')].forEach(div=>{
      const label=txt(div.querySelector('label')).toUpperCase();
      if(label==='ORIGIN'||label==='DESTINATION'){
        const select=div.querySelector('select');
        if(select&&select.value){select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));}
        div.style.display='none';
      }
    });
  });
}
function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function makeHeaderSelect(key,label,values){
  const select=document.createElement('select');
  select.setAttribute('data-cleared-header-filter',key);
  select.setAttribute('aria-label',`${label} filter`);
  select.style.cssText='display:block;width:100%;min-width:92px;margin-top:4px;padding:3px 22px 3px 6px;font-size:11px;line-height:1.2;border:1px solid #cbd5e1;border-radius:6px;background:#fff;';
  select.innerHTML=`<option value="">All ${label}</option>${values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
  return select;
}

export default function CustomsClearedEnhancements(){
  useEffect(()=>{
    let scheduled=false;
    const install=()=>{
      scheduled=false;
      const clearedActive=[...document.querySelectorAll('.adminViews button')].some(b=>b.classList.contains('active')&&/CUSTOMS CLEARED/i.test(txt(b)));
      const table=document.querySelector('.tableWrap table');
      const oldBar=document.getElementById('mayavi-cleared-enhancements');
      if(!clearedActive||!table){
        oldBar?.remove();
        document.querySelectorAll('[data-cleared-header-filter]').forEach(el=>el.remove());
        document.querySelectorAll('[data-cleared-date-range-wrap]').forEach(el=>el.remove());
        document.getElementById('mayavi-cleared-total-inline')?.remove();
        return;
      }

      hideLocationFiltersForClearedImport();
      oldBar?.remove();

      const headersEls=[...table.querySelectorAll('thead th')];
      const headers=headersEls.map(th=>{
        const clone=th.cloneNode(true);
        clone.querySelectorAll('[data-cleared-header-filter],[data-cleared-filter-label],[data-cleared-date-range-wrap]').forEach(el=>el.remove());
        return txt(clone).replace(/\s+/g,' ');
      });
      const clientIndex=headers.findIndex(v=>/^Client/i.test(v));
      const companyIndex=headers.findIndex(v=>/^Company/i.test(v));
      const goodsIndex=headers.findIndex(v=>/^Goods/i.test(v));
      const weightIndex=headers.findIndex(v=>/^Weight$/i.test(v));
      const mailIndex=headers.findIndex(v=>/^Mail Time/i.test(v));
      const arrivalDateIndex=headers.findIndex(v=>/^Arrival Date/i.test(v));
      const arrivalTimeIndex=headers.findIndex(v=>/^Arrival Time/i.test(v));
      if(clientIndex<0||companyIndex<0||weightIndex<0)return;

      const rows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.querySelectorAll('td').length>2);
      const type=[...document.querySelectorAll('.typeTabs button')].find(b=>b.classList.contains('active'));
      const importMode=/IMPORT/i.test(txt(type));
      const exportMode=/EXPORT/i.test(txt(type));
      if(rows.length>1&&((importMode&&mailIndex>=0)||(exportMode&&arrivalDateIndex>=0))){
        const ordered=[...rows].map((row,index)=>({
          row,
          index,
          score:importMode
            ? mailSortValue(txt(tdAt(row,mailIndex)))
            : arrivalSortValue(txt(tdAt(row,arrivalDateIndex)),arrivalTimeIndex>=0?txt(tdAt(row,arrivalTimeIndex)):'')
        })).sort((a,b)=>{
          if(a.score==null&&b.score==null)return a.index-b.index;
          if(a.score==null)return 1;
          if(b.score==null)return -1;
          if(a.score===b.score)return a.index-b.index;
          return b.score-a.score;
        });
        if(ordered.some((item,index)=>item.row!==rows[index])){
          const body=table.querySelector('tbody');
          ordered.forEach(({row},index)=>{
            body?.appendChild(row);
            const serial=tdAt(row,0)?.querySelector('strong');
            if(serial&&/^\d+$/.test(txt(serial)))serial.textContent=String(index+1);
          });
        }
      }

      const clients=uniq(rows.map(r=>clientValue(r,clientIndex)));
      const companies=uniq(rows.map(r=>companyValue(r,companyIndex)));
      const goods=goodsIndex>=0?uniq(rows.map(r=>goodsValue(r,goodsIndex))):[];
      const clientHeader=headersEls[clientIndex];
      const hasNativeClientFilter=Boolean(clientHeader?.querySelector('select:not([data-cleared-header-filter])'));
      const signature=JSON.stringify({clients,companies,goods,headers:headers.length,hasNativeClientFilter});

      const previous={
        client:table.querySelector('[data-cleared-header-filter="client"]')?.value||'',
        company:table.querySelector('[data-cleared-header-filter="company"]')?.value||'',
        goods:table.querySelector('[data-cleared-header-filter="goods"]')?.value||''
      };
      const currentSignature=table.dataset.clearedFilterSignature||'';
      if(currentSignature!==signature){
        table.querySelectorAll('[data-cleared-header-filter]').forEach(el=>el.remove());
        const configs=[
          ...(!hasNativeClientFilter?[{index:clientIndex,key:'client',label:'Clients',values:clients}]:[]),
          {index:companyIndex,key:'company',label:'Companies',values:companies},
          ...(goodsIndex>=0?[{index:goodsIndex,key:'goods',label:'Goods',values:goods}]:[])
        ];
        configs.forEach(({index,key,label,values})=>{
          const th=headersEls[index];if(!th)return;
          const select=makeHeaderSelect(key,label,values);
          th.appendChild(select);
          if(previous[key]&&[...select.options].some(o=>o.value===previous[key]))select.value=previous[key];
        });
        table.dataset.clearedFilterSignature=signature;
      }

      let totalEl=document.getElementById('mayavi-cleared-total-inline');
      if(!totalEl){
        totalEl=document.createElement('div');
        totalEl.id='mayavi-cleared-total-inline';
        totalEl.style.cssText='font-size:12px;font-weight:700;text-align:right;margin:2px 4px 5px;color:#475569;';
        const wrap=document.querySelector('.tableWrap');
        wrap?.parentNode?.insertBefore(totalEl,wrap);
      }

      const apply=()=>{
        const injectedClient=table.querySelector('[data-cleared-header-filter="client"]');
        const nativeClient=clientHeader?.querySelector('select:not([data-cleared-header-filter])');
        const client=injectedClient?.value||nativeClient?.value||'';
        const company=table.querySelector('[data-cleared-header-filter="company"]')?.value||'';
        const goods=table.querySelector('[data-cleared-header-filter="goods"]')?.value||'';
        const range=importMode?readDateRange():{from:'',to:''};
        let total=0,shown=0;
        rows.forEach(r=>{
          const c=clientValue(r,clientIndex);
          const co=companyValue(r,companyIndex);
          const g=goodsIndex>=0?goodsValue(r,goodsIndex):'';
          const arrival=arrivalDateIndex>=0?arrivalDateOnly(txt(tdAt(r,arrivalDateIndex))):'';
          const inRange=(!range.from&&!range.to)||Boolean(arrival&&(!range.from||arrival>=range.from)&&(!range.to||arrival<=range.to));
          const show=(!client||c===client)&&(!company||co===company)&&(!goods||g===goods)&&inRange;
          r.style.display=show?'':'none';
          if(show){shown++;total+=weightFromCell(weightValue(r,weightIndex));}
        });
        if(totalEl)totalEl.textContent=`${total.toLocaleString(undefined,{maximumFractionDigits:2})} kg • ${shown} master${shown===1?'':'s'}`;
      };

      if(importMode&&arrivalDateIndex>=0){
        const dateHeader=headersEls[arrivalDateIndex];
        let wrap=dateHeader?.querySelector('[data-cleared-date-range-wrap]');
        if(!wrap&&dateHeader){
          wrap=document.createElement('div');
          wrap.setAttribute('data-cleared-date-range-wrap','1');
          wrap.style.cssText='display:block;position:relative;margin-top:4px;';
          const button=document.createElement('button');
          button.type='button';
          button.setAttribute('data-cleared-date-range-button','1');
          button.style.cssText='width:100%;min-width:92px;padding:3px 6px;font-size:11px;font-weight:700;line-height:1.2;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#334155;cursor:pointer;';
          const panel=document.createElement('div');
          panel.setAttribute('data-cleared-date-range-panel','1');
          panel.style.cssText='display:none;position:absolute;z-index:60;top:27px;left:0;width:210px;padding:9px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 10px 24px rgba(15,23,42,.18);text-align:left;';
          panel.innerHTML='<label style="display:block;font-size:10px;font-weight:700;color:#475569;margin-bottom:2px;">FROM ARRIVAL DATE</label><input data-cleared-date-from type="date" style="width:100%;box-sizing:border-box;padding:5px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;margin-bottom:7px;"><label style="display:block;font-size:10px;font-weight:700;color:#475569;margin-bottom:2px;">TO ARRIVAL DATE</label><input data-cleared-date-to type="date" style="width:100%;box-sizing:border-box;padding:5px;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;margin-bottom:8px;"><div style="display:flex;gap:6px;"><button type="button" data-cleared-date-apply style="flex:1;padding:5px;border:0;border-radius:6px;background:#0f766e;color:#fff;font-size:11px;font-weight:800;cursor:pointer;">APPLY</button><button type="button" data-cleared-date-clear style="flex:1;padding:5px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;font-size:11px;font-weight:800;cursor:pointer;">CLEAR</button></div>';
          wrap.appendChild(button);wrap.appendChild(panel);dateHeader.appendChild(wrap);
          const fromInput=panel.querySelector('[data-cleared-date-from]');
          const toInput=panel.querySelector('[data-cleared-date-to]');
          const setButtonState=()=>{
            const range=readDateRange();
            const active=Boolean(range.from||range.to);
            button.textContent=active?'DATE RANGE ✓':'DATE RANGE';
            button.style.background=active?'#ccfbf1':'#fff';
            button.style.borderColor=active?'#14b8a6':'#cbd5e1';
            button.title=active?`${range.from||'Any'} to ${range.to||'Any'}`:'Filter by Arrival Date range';
          };
          const saved=readDateRange();fromInput.value=saved.from;toInput.value=saved.to;setButtonState();
          button.onclick=e=>{e.preventDefault();e.stopPropagation();const opening=panel.style.display==='none';panel.style.display=opening?'block':'none';if(opening){const r=readDateRange();fromInput.value=r.from;toInput.value=r.to;}};
          panel.onclick=e=>e.stopPropagation();
          panel.querySelector('[data-cleared-date-apply]').onclick=()=>{
            let from=fromInput.value||'',to=toInput.value||'';
            if(from&&to&&from>to){const swap=from;from=to;to=swap;fromInput.value=from;toInput.value=to;}
            saveDateRange(from,to);setButtonState();apply();panel.style.display='none';
          };
          panel.querySelector('[data-cleared-date-clear]').onclick=()=>{
            fromInput.value='';toInput.value='';saveDateRange('','');setButtonState();apply();panel.style.display='none';
          };
        }
      }else{
        table.querySelectorAll('[data-cleared-date-range-wrap]').forEach(el=>el.remove());
      }

      table.querySelectorAll('[data-cleared-header-filter]').forEach(s=>s.onchange=apply);
      apply();
    };

    const closePanels=e=>{
      if(e.target.closest?.('[data-cleared-date-range-wrap]'))return;
      document.querySelectorAll('[data-cleared-date-range-panel]').forEach(p=>p.style.display='none');
    };
    document.addEventListener('click',closePanels);
    const queue=()=>{if(scheduled)return;scheduled=true;setTimeout(install,0)};
    const observer=new MutationObserver(queue);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','value','style']});
    install();
    return()=>{
      observer.disconnect();
      document.removeEventListener('click',closePanels);
      document.getElementById('mayavi-cleared-enhancements')?.remove();
      document.getElementById('mayavi-cleared-total-inline')?.remove();
      document.querySelectorAll('[data-cleared-header-filter]').forEach(el=>el.remove());
      document.querySelectorAll('[data-cleared-date-range-wrap]').forEach(el=>el.remove());
    }
  },[]);
  return null;
}
