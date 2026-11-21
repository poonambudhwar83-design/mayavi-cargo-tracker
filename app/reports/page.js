import {headers} from 'next/headers';
import {readSession} from '../../lib/mayaviAuth.js';
import ReportsHome from './ReportsHome.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export const metadata={
  title:'Monthly Reports • Mayavi Cargo',
  robots:{index:false,follow:false}
};

export default async function ReportsPage({searchParams}){
  const requestHeaders=await headers();
  const session=readSession({headers:requestHeaders,url:'https://tracker.mayavicargo.com/reports'});
  if(session?.role!=='admin'){
    return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:20,background:'#f5f8fc',color:'#16395d'}}>
      <section style={{width:'min(520px,100%)',padding:28,background:'#fff',borderRadius:16,border:'1px solid #d5e3f3'}}>
        <div style={{fontSize:12,fontWeight:900,color:'#3f69a5'}}>MAYAVI CARGO • REPORTS</div>
        <h1 style={{margin:'9px 0'}}>Admin login required</h1>
        <p style={{lineHeight:1.6}}>Monthly comparison reports are available to the Mayavi Admin account. Open the main Mayavi login, sign in as Admin, then select Reports.</p>
        <a href="/" style={{display:'inline-block',padding:'11px 16px',borderRadius:9,background:'#1d56a0',color:'#fff',fontWeight:800,textDecoration:'none'}}>Open Mayavi Login</a>
      </section>
    </main>;
  }
  const requested=await searchParams;
  const view=String(requested?.view||'');
  return <ReportsHome initialReport={['import-goods','export-client'].includes(view)?view:'import-customer'}/>;
}
