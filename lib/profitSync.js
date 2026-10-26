// Shipment edits are written to the shared Neon database. This module
// only signals the profit views to re-read that authoritative source.
export const PROFIT_SOURCE_EVENT='mayavi:profit-source-updated';
export const PROFIT_SOURCE_STORAGE_KEY='mayavi_profit_source_revision';

export function notifyProfitSourceChanged(){
  if(typeof window==='undefined')return;
  window.dispatchEvent(new Event(PROFIT_SOURCE_EVENT));
  try{window.localStorage.setItem(PROFIT_SOURCE_STORAGE_KEY,String(Date.now()));}catch{}
}

export function subscribeProfitSourceChanges(reload){
  if(typeof window==='undefined')return()=>{};
  const ifVisible=()=>{if(document.visibilityState!=='hidden')reload();};
  const onStorage=event=>{if(event.key===PROFIT_SOURCE_STORAGE_KEY)ifVisible();};
  window.addEventListener(PROFIT_SOURCE_EVENT,ifVisible);
  window.addEventListener('storage',onStorage);
  window.addEventListener('focus',ifVisible);
  window.addEventListener('pageshow',ifVisible);
  document.addEventListener('visibilitychange',ifVisible);
  return()=>{
    window.removeEventListener(PROFIT_SOURCE_EVENT,ifVisible);
    window.removeEventListener('storage',onStorage);
    window.removeEventListener('focus',ifVisible);
    window.removeEventListener('pageshow',ifVisible);
    document.removeEventListener('visibilitychange',ifVisible);
  };
}
