import { createWorker } from 'tesseract.js';
import { readSession } from '../../../lib/mayaviAuth.js';
import { normalizeMawb } from '../../../lib/airlines.js';
import { parseTkSmart } from '../../../lib/turkish.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

export async function POST(request){
  const session=readSession(request);
  if(!session)return Response.json({ok:false,error:'Login required.'},{status:401});
  let worker;
  try{
    const form=await request.formData();
    const mawb=normalizeMawb(form.get('mawb')||'');
    const file=form.get('file');
    if(!mawb||!mawb.startsWith('235-'))return Response.json({ok:false,error:'A valid Turkish Cargo 235 MAWB is required.'},{status:400});
    if(!file||typeof file.arrayBuffer!=='function')return Response.json({ok:false,error:'Upload the Turkish Cargo result screenshot.'},{status:400});
    if(Number(file.size||0)>12*1024*1024)return Response.json({ok:false,error:'Screenshot is too large. Use an image under 12 MB.'},{status:413});
    const buffer=Buffer.from(await file.arrayBuffer());
    worker=await createWorker('eng');
    const result=await worker.recognize(buffer);
    const text=String(result?.data?.text||'');
    const parsed=parseTkSmart(text,text,mawb);
    if(parsed?.notFound)return Response.json({ok:false,error:'Turkish Cargo shows no shipment record for this MAWB.'},{status:422});
    const shipment=parsed?.shipment||null;
    if(!shipment)return Response.json({ok:false,error:'The Turkish result screenshot was read, but shipment fields were not clear enough. Capture the full Cargo Tracking Information card.'},{status:422});
    shipment.source='Turkish Cargo user-verified result screenshot OCR';
    shipment.officialTracker='https://www.turkishcargo.com/en/online-services/shipment-tracking';
    return Response.json({ok:true,shipment,ocrSample:text.replace(/\s+/g,' ').trim().slice(0,1600)});
  }catch(error){
    return Response.json({ok:false,error:error?.message||'Turkish screenshot read failed.'},{status:500});
  }finally{
    if(worker)try{await worker.terminate()}catch{}
  }
}
