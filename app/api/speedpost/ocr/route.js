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
    let consigneeConfidence='unreadable';
    const start=Date.now();
    worker=await createWorker('eng',1,{cachePath:'/tmp/speedpost-ocr',cacheMethod:'none'});
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT}).catch(()=>{});
    async function recognize(buffer,isEmsCrop=false,timeoutMs=12000,orientation='original',recipientOnly=false){
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
      const score={unreadable:0,low:1,medium:2,high:3};
      if(recipient.consigneeName&&recipient.consigneeAddress&&
          (score[recipient.recipientConfidence||'unreadable']>score[consigneeConfidence]
            || !consigneeName||!consigneeAddress)){
        consigneeName=recipient.consigneeName;
        consigneeAddress=recipient.consigneeAddress;
        consigneeOcrOrientation=orientation;
        consigneeToHeadingCovered=recipient.toHeadingCovered===true;
        consigneeConfidence=recipient.recipientConfidence||'low';
      }
      if(recipientOnly)return data;
      const candidates=edOcrCandidates(data.text||'',{emsRegion:isEmsCrop});
      for(const item of candidates){
        const existing=output.find(x=>x.number===item.number);
        if(!existing)output.push(item);
        else{existing.emsNearby ||=item.emsNearby;existing.occurrences+=item.occurrences}
      }
      return data;
    }
    // Read the LARGE printed consignee lines separately from the tiny CN22
    // customs table. The sample parcel's recipient is in the upper-right
    // region; isolating it stops customs text being mistaken for an address.
    async function readPrintedRecipientArea(oriented,orientation){
      if(consigneeConfidence==='high'||Date.now()-start>=45500)return;
      const md=await sharp(oriented).metadata();
      const left=0, top=0;
      const width=md.width;
      const height=md.height;
      if(width<250||height<150)return;
      const crop=await sharp(oriented).extract({left,top,width,height})
        .resize({width:Math.min(1900,Math.max(1150,width*2))})
        .greyscale().normalise().sharpen().png().toBuffer();
      await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
      try{await recognize(crop,false,8500,orientation+' TO crop',true);}
      finally{await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT}).catch(()=>{});}
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
    // First rotate sideways parcel labels, then use isolated PSM6 OCR on
    // printed TO lines. Give each attempt a bounded budget under 60 seconds.
    if(Date.now()-start<36000
      &&(consigneeConfidence!=='high'||!output.some(x=>x.checkDigitValid))){
      try{
        const upright=await sharp(base).rotate(90).png().toBuffer();
        await recognize(upright,false,10500,'90 degrees');
        await readPrintedRecipientArea(upright,'90 degrees');
      }catch{/* Keep partial OCR results from other orientations. */}
    }
    if(Date.now()-start<45000
      &&(consigneeConfidence!=='high'||!output.some(x=>x.checkDigitValid))){
      try{
        const other=await sharp(base).rotate(270).png().toBuffer();
        await recognize(other,false,7500,'270 degrees');
        await readPrintedRecipientArea(other,'270 degrees');
      }catch{/* Keep partial OCR results from other orientations. */}
    }
    if(consigneeConfidence!=='high'&&Date.now()-start<45000){
      try{await readPrintedRecipientArea(base,'original');}catch{/* Nothing to save if unclear. */}
    }
    output.sort((a,b)=>Number(b.checkDigitValid)-Number(a.checkDigitValid)||
      Number(b.emsNearby)-Number(a.emsNearby)||b.occurrences-a.occurrences);
    // The user must approve uncertain OCR candidates; no silent fabricated ED number.
    output.sort((a,b)=>Number(b.checkDigitValid)-Number(a.checkDigitValid)||Number(b.emsNearby)-Number(a.emsNearby));
    return respond({ok:true,candidates:output.slice(0,10),
      consigneeName,consigneeAddress,consigneeOcrOrientation,consigneeToHeadingCovered,
      consigneeConfidence,consigneeNeedsReview:consigneeConfidence!=='high',
      autoSelect:output.length===1&&output[0].checkDigitValid&&output[0].emsNearby,
      message:output.length?'EMS ED number and consignee extracted independently from your photo.':'ED number by the EMS label was not readable. Upload a clearer barcode photo or enter the ED manually.'});
  }catch(e){
    return respond({ok:false,error:'Receipt OCR unavailable: '+String(e?.message||e).slice(0,160)},502);
  }finally{try{await worker?.terminate()}catch{}}
}
