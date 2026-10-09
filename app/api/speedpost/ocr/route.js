// Private photo-reading route. Images are processed in memory and never saved.
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../../lib/mayaviAuth.js';
import { edOcrCandidates } from '../../../../lib/speedpostOcr.js';
import { readConsigneeFromEmsTO } from '../../../../lib/speedpostToOcr.js';

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
    const base=await sharp(input,{limitInputPixels:40e6}).rotate().resize({
      width:Math.max(1300,Math.min(2600,metadata.width*2)),
      withoutEnlargement:false,fit:'inside'
    }).greyscale().normalise().sharpen().png().toBuffer();
    const size=await sharp(base).metadata();
    let output=[];
    let consigneeName='';
    let consigneeAddress='';
    let consigneeOcrOrientation='';
    let consigneeToHeadingCovered=false;
    const start=Date.now();
    worker=await createWorker('eng',1,{cachePath:'/tmp/speedpost-ocr',cacheMethod:'none'});
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT}).catch(()=>{});
    async function recognize(buffer,isEmsCrop=false,timeoutMs=16000,orientation='original'){
      const race=await Promise.race([
        worker.recognize(buffer,{}, {text:true,tsv:true}).then(result=>({result})).catch(error=>({error})),
        new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),timeoutMs))
      ]);
      if(race.timeout)throw Error('OCR_TIMED_OUT');
      if(race.error)throw race.error;
      const data=race.result?.data||{};
      // Recipient OCR reader is independent of the EMS ED barcode reader.
      // Only the photo's TO block / labelled recipient-address area is used.
      const recipient=readConsigneeFromEmsTO(data.text||'',data.tsv||'');
      if(recipient.consigneeName&&recipient.consigneeAddress
         &&(!consigneeName||!consigneeAddress||(!consigneeToHeadingCovered&&recipient.toSectionFound))){
        consigneeName=recipient.consigneeName;
        consigneeAddress=recipient.consigneeAddress;
        consigneeOcrOrientation=orientation;
        consigneeToHeadingCovered=recipient.toHeadingCovered===true;
      }
      const candidates=edOcrCandidates(data.text||'',{emsRegion:isEmsCrop});
      for(const item of candidates){
        const existing=output.find(x=>x.number===item.number);
        if(!existing)output.push(item);
        else{existing.emsNearby ||=item.emsNearby;existing.occurrences+=item.occurrences}
      }
      return data;
    }
    // Locate the literal EMS / SPEED POST printing first and zoom around it.
    // The ED number on a physical EMS label is usually next to that heading,
    // not the unrelated booking/tariff/details text elsewhere in the photo.
    function emsCoordinates(tsv=''){
      const rows=String(tsv).split(/\r?\n/);
      const headers=rows.shift()?.split('\t')||[];
      const at=name=>headers.indexOf(name);
      if(['left','top','width','height','text'].some(h=>at(h)<0))return null;
      const words=rows.map(line=>{
        const cols=line.split('\t');
        return {label:(cols.slice(at('text')).join('\t')||'').trim().toUpperCase(),
          x:Number(cols[at('left')]),y:Number(cols[at('top')]),w:Number(cols[at('width')]),h:Number(cols[at('height')])};
      });
      return words.find(w=>/^(EMS|SPEED)$/.test(w.label)&&Number.isFinite(w.x)&&Number.isFinite(w.y))||null;
    }
    const data=await recognize(base,false);
    const anchor=emsCoordinates(data.tsv||'');
    if(anchor&&size.width&&size.height){
      const cx=anchor.x+anchor.w/2,cy=anchor.y+anchor.h/2;
      const cropWidth=Math.min(size.width,Math.max(600,Math.round(size.width*0.88)));
      const cropHeight=Math.min(size.height,Math.max(450,Math.round(size.height*0.46)));
      const left=Math.max(0,Math.min(size.width-cropWidth,Math.round(cx-cropWidth/2)));
      const top=Math.max(0,Math.min(size.height-cropHeight,Math.round(cy-cropHeight/2)));
      const region=await sharp(base).extract({left,top,width:cropWidth,height:cropHeight}).resize({width:Math.min(3200,cropWidth*2)}).sharpen().png().toBuffer();
      await recognize(region,true);
    }
    if(!output.some(x=>x.checkDigitValid&&x.emsNearby)&&Date.now()-start<33000){
      const enhanced=await sharp(base).linear(1.25,-18).threshold(175).png().toBuffer();
      await recognize(enhanced,false);
    }
    // Sideways EMS box photographs require orientation-specific OCR.
    // These rotations also allow barcode OCR to succeed if the photo is sideways.
    if((!consigneeName||!consigneeAddress||!output.some(x=>x.checkDigitValid))&&Date.now()-start<33000){
      try{
        const sideways=await sharp(base).rotate(90).png().toBuffer();
        await recognize(sideways,false,10000,'90 degrees');
      }catch{/* Keep other OCR results if rotation fails. */}
    }
    if((!consigneeName||!consigneeAddress||!output.some(x=>x.checkDigitValid))&&Date.now()-start<44000){
      try{
        const sideways=await sharp(base).rotate(270).png().toBuffer();
        await recognize(sideways,false,8000,'270 degrees');
      }catch{/* Keep other OCR results if second rotation fails. */}
    }
    output.sort((a,b)=>Number(b.checkDigitValid)-Number(a.checkDigitValid)||
      Number(b.emsNearby)-Number(a.emsNearby)||b.occurrences-a.occurrences);
    // The user must approve uncertain OCR candidates; no silent fabricated ED number.
    output.sort((a,b)=>Number(b.checkDigitValid)-Number(a.checkDigitValid)||Number(b.emsNearby)-Number(a.emsNearby));
    return respond({ok:true,candidates:output.slice(0,10),
      consigneeName,consigneeAddress,consigneeOcrOrientation,consigneeToHeadingCovered,
      autoSelect:output.length===1&&output[0].checkDigitValid&&output[0].emsNearby,
      message:output.length?'EMS ED number and consignee extracted independently from your photo.':'ED number by the EMS label was not readable. Upload a clearer barcode photo or enter the ED manually.'});
  }catch(e){
    return respond({ok:false,error:'Receipt OCR unavailable: '+String(e?.message||e).slice(0,160)},502);
  }finally{try{await worker?.terminate()}catch{}}
}
