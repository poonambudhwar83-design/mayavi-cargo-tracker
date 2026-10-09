// Private photo-reading route. Images are processed in memory and never saved.
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../../lib/mayaviAuth.js';
import { edOcrCandidates } from '../../../../lib/speedpostOcr.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

function respond(data,status=200){return Response.json(data,{status,headers:{'cache-control':'no-store'}})}
async function permitted(request){
  const user=readSession(request);
  if(!user||!['admin','sonu'].includes(user.username))return false;
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
  if(!url)return false;
  const sql=neon(url);
  const rows=await sql`SELECT is_active,role FROM mayavi_users WHERE lower(username)=lower(${user.username}) LIMIT 1`;
  return rows[0]?.is_active===true&&(user.username!=='admin'||rows[0]?.role==='admin');
}
function safeFormat(mime=''){
  return /^image\/(?:png|jpeg|webp|heic|heif|tiff|bmp)$/i.test(mime);
}
export async function POST(request){
  let worker;
  try{
    if(!(await permitted(request)))return respond({ok:false,error:'Admin or Sonu login required.'},403);
    const form=await request.formData();
    const file=form.get('photo');
    if(!file||typeof file.arrayBuffer!=='function')return respond({ok:false,error:'Please select a receipt photo.'},400);
    if(!safeFormat(file.type))return respond({ok:false,error:'Upload JPG, PNG, WebP or another supported photo format.'},400);
    if(file.size>8*1024*1024||file.size<20)return respond({ok:false,error:'Photo must be under 8 MB.'},413);
    const input=Buffer.from(await file.arrayBuffer());
    const sharp=(await import('sharp')).default;
    const {createWorker,PSM}=await import('tesseract.js');
    const metadata=await sharp(input,{limitInputPixels:40e6}).metadata();
    if(!metadata.width||!metadata.height)return respond({ok:false,error:'Photo could not be opened.'},422);
    const base=sharp(input,{limitInputPixels:40e6}).rotate().resize({
      width:Math.max(1300,Math.min(2400,metadata.width*2)),
      withoutEnlargement:false,
      fit:'inside'
    }).greyscale().normalise().sharpen();
    const variants=[
      await base.clone().png().toBuffer(),
      await base.clone().linear(1.4,-35).threshold(160).png().toBuffer()
    ];
    let output=[];
    const start=Date.now();
    worker=await createWorker('eng',1,{cachePath:'/tmp/speedpost-ocr',cacheMethod:'none'});
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT}).catch(()=>{});
    for(let i=0;i<variants.length;i++){
      const recognition=await Promise.race([
        worker.recognize(variants[i]).then(result=>({result})).catch(error=>({error})),
        new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),22000))
      ]);
      if(recognition.timeout)break;
      if(recognition.error)throw recognition.error;
      const candidates=edOcrCandidates(recognition.result?.data?.text||'');
      for(const item of candidates){
        if(!output.some(other=>other.number===item.number))output.push(item);
      }
      if(output.some(x=>x.checkDigitValid))break;
      if(Date.now()-start>38000)break;
    }
    // The user must approve uncertain OCR candidates; no silent fabricated ED number.
    output.sort((a,b)=>Number(b.checkDigitValid)-Number(a.checkDigitValid));
    return respond({ok:true,candidates:output.slice(0,10),
      autoSelect:output.length===1&&output[0].checkDigitValid,
      message:output.length?'Review detected ED number against your photo.':'No ED number found. Try a closer photo or enter the number manually.'});
  }catch(e){
    return respond({ok:false,error:'Receipt OCR unavailable: '+String(e?.message||e).slice(0,160)},502);
  }finally{try{await worker?.terminate()}catch{}}
}
