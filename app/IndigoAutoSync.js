'use client';
import { useEffect } from 'react';

const KEY='mayavi_indigo_sync_at';
const RELOAD_KEY='mayavi_indigo_sync_reload';
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
        const lastReload=Number(sessionStorage.getItem(RELOAD_KEY)||0);
        if(now-lastReload>60*1000){
          sessionStorage.setItem(RELOAD_KEY,String(now));
          window.location.reload();
        }
      }catch{}
    })();
    return()=>{cancelled=true};
  },[]);
  return null;
}
