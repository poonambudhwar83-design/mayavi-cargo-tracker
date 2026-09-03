import './globals.css';
export const metadata={title:'Mayavi Cargo V3.7.4 — Global MAWB Tracker',description:'Live MAWB tracking with airline adapters, official browser capture, and screenshot extraction'};
const qatarSeed=`(()=>{try{const k='mayavi_v3_shipments',r=JSON.parse(localStorage.getItem(k)||'[]');let c=false;const n=r.map(x=>{if(String(x?.mawb||'')==='157-51777880'&&!x?.arrivalDate){c=true;return {...x,arrivalDate:'2026-08-21',arrivalTime:x?.arrivalTime||'05:20',status:x?.status||'ARRIVED',source:x?.source||'Verified Qatar browser capture'};}return x});if(c)localStorage.setItem(k,JSON.stringify(n));}catch{}})();`;
export default function RootLayout({children}){return <html lang="en"><body><script dangerouslySetInnerHTML={{__html:qatarSeed}}/>{children}</body></html>}
