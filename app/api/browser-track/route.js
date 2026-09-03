import { trackWithBrowser, inspectCathayFlightPage, trackCathayFlightStatus } from '../../../lib/browserTracker.js';
import { normalizeMawb } from '../../../lib/airlines.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

async function handle(mawb){
  const result=await trackWithBrowser(mawb);
  if(result.ok)return Response.json({ok:true,version:'3.7',provider:'Official airline browser capture',shipment:result.shipment,screenshotBase64:result.screenshotBase64||null,debug:result.debug||null});
  return Response.json({ok:false,version:'3.7',mawb,trackingError:result.reason||'BROWSER TRACKING FAILED',officialTracker:result.officialTracker||null,screenshotBase64:result.screenshotBase64||null,pageText:result.pageText||'',debug:result.debug||null},{status:503});
}

export async function POST(request){
  let body={};try{body=await request.json()}catch{return Response.json({ok:false,error:'Invalid request body.'},{status:400})}
  const mawb=normalizeMawb(body?.mawb);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}

export async function GET(request){
  const u=new URL(request.url);
  const flight=u.searchParams.get('flight');
  if(flight){
    const date=u.searchParams.get('date')||'';
    const inspect=u.searchParams.get('inspect')==='1';
    const result=inspect?await inspectCathayFlightPage(flight,date):await trackCathayFlightStatus(flight,date);
    return Response.json({...result,screenshotBase64:result.screenshotBase64?true:false},{status:result.ok?200:503});
  }
  const q=u.searchParams.get('mawb');
  const mawb=normalizeMawb(q);if(!mawb)return Response.json({ok:false,error:'Enter a valid 11-digit MAWB.'},{status:400});
  return handle(mawb);
}
