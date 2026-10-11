'use client';
import { useEffect } from 'react';

// Only the IndiGo 312 sync is scheduled here; all other carriers are untouched.
const KEY='mayavi_indigo_sync_at';
const INTERVAL=2*60*1000;
const CHECK_INTERVAL=20*1000;

export default function IndigoAutoSync(){
  useEffect(()=>{
    let stopped=false;
    let pending=false;
    let controller=null;
    const sync=async()=>{
      if(stopped||pending||document.visibilityState==='hidden')return;
      const now=Date.now();
      const last=Number(sessionStorage.getItem(KEY)||0);
      if(last>0&&now-last<INTERVAL)return;
      // Record the attempt before awaiting so focus/visibility events cannot
      // start overlapping official-carrier requests.
      sessionStorage.setItem(KEY,String(now));
      pending=true;
      controller=new AbortController();
      try{
        const res=await fetch('/api/indigo-sync',{
          method:'POST',credentials:'include',cache:'no-store',signal:controller.signal
        });
        const data=await res.json();
        if(!res.ok||!data?.ok){
          sessionStorage.removeItem(KEY); // Retry on next foreground check.
          return;
        }
        if(!stopped&&data.updated>0){
          // Pull the updated server rows in place, with no full-page reload.
          window.dispatchEvent(new CustomEvent('mayavi:indigo-synced',{
            detail:{updated:data.updated,checked:data.checked}
          }));
        }
      }catch{
        if(!stopped)sessionStorage.removeItem(KEY);
      }finally{
        controller=null;
        pending=false;
      }
    };
    const foreground=()=>{if(document.visibilityState!=='hidden')void sync();};
    void sync();
    const timer=window.setInterval(()=>void sync(),CHECK_INTERVAL);
    document.addEventListener('visibilitychange',foreground);
    window.addEventListener('focus',foreground);
    return()=>{
      stopped=true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange',foreground);
      window.removeEventListener('focus',foreground);
      controller?.abort();
    };
  },[]);
  return null;
}
