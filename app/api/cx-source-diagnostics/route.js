export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=45;
export async function GET(){
 const suffix='18860310',base='https://www.cathaycargoterminal.com/en-us/Shipment-Tracking';
 const results=[];
 for(const u of [base+'?AWBPrefix=160&AWBSuffix='+suffix,base+'/AWBPrefix/160/AWBSuffix/'+suffix]){
  try{
   const r=await fetch(u,{signal:AbortSignal.timeout(10000),cache:'no-store',headers:{'user-agent':'Mozilla/5.0','accept':'text/html'}});
   const html=await r.text();
   const main=html.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ');
   const terms=['Booking Details','Booking Status','Booking Information','Shipment Tracking','AWB Type','Departure Flight','Received from Shipper','18860310','65.0','65 kg','3 pc'];
   results.push({url:u,status:r.status,textLength:main.length,terms:terms.map(term=>({term,index:main.toLowerCase().indexOf(term.toLowerCase()),snippet:(i=>i<0?'':main.slice(Math.max(0,i-90),Math.min(main.length,i+260)))(main.toLowerCase().indexOf(term.toLowerCase()))})),nearEnd:main.slice(-600),hasFlight:/\bCX\s*\d{2,4}\b/i.test(main)});
  }catch(e){results.push({url:u,error:String(e?.message||e)});}
 }
 return Response.json({results},{headers:{'Cache-Control':'no-store'}});
}