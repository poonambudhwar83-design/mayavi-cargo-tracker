'use client';
import { useEffect } from 'react';

const KEY='mayavi_indigo_sync_at';
const INTERVAL=5*60*1000;

export default function IndigoAutoSync(){
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const now=Date.now();
        const last=Number(sessionStorage.getItem(KEY)||0);
        if(now-last<INTERVAL)return;
        sessionStorage.setItem(KEY,String(now));
        const res=await fetch('/api/indigo-sync',{method:'POST',credentials:'include',cache:'no-store'});
        const data=await res.json();
        if(cancelled||!data?.ok||!data.updated)return;
        // Avoid a second full-page reload after IndiGo sync. It caused the
        // dashboard rows to flash/blink a moment after the user refreshed.
        // Ask the mounted dashboard to pull the just-saved server rows in place.
        window.dispatchEvent(new CustomEvent('mayavi:indigo-synced',{detail:{updated:data.updated}}));
      }catch{}
    })();
    return()=>{cancelled=true};
  },[]);
  return null;
}
