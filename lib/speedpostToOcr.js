// Read only the recipient / consignee block explicitly labelled "TO" on
// the EMS parcel label. Do not infer a name or address from a tracking website.
// User-uploaded photos are processed in memory and are not stored.
const HEADER=/^(?:TO|TO:|TO\s*[-–:]|CONSIGNEE|CONSIGNEE:|RECIPIENT|RECIPIENT:|ADDRESSEE:)(?:\s|$)/i;
const END=/^(?:FROM|FROM:|SENDER|SENDER:|CN\s*22|CN\s*23|CUSTOMS|CUSTOMS DECLARATION|DECLARATION|CONTENTS?|DESCRIPTION|NET WEIGHT|GROSS WEIGHT|POSTAGE|TARIFF|BOOKING DATE|COUNTRY OF ORIGIN|SIGNATURE|DATE\s*[:\-]|TOTAL|HS CODE|QUANTITY|QTY|VALUE|ARTICLE NO|ARTICLE NUMBER|EMS|SPEED POST|INDIA POST|TRACKING NO|AWB|SHIPMENT)/i;
const EMPTY=/^(?:TO|NAME|ADDRESS|RECIPIENT|CONSIGNEE|N\/A|NONE|NIL|NOT AVAILABLE|UNKNOWN|[-–—])$/i;
const edNo=/\bED[\s-]*\d{9}[\s-]*IN\b/i;
const clean=s=>String(s||'').normalize('NFKC').replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
// Printed courier labels have nearby CN22 instructions, barcodes and sender
// blocks. Treat a candidate as recipient data only when its NAME and ADDRESS
// both have independent structure; never save a plausible-looking OCR fragment.
const ukPostcode=/\b(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const northAmericaPostcode=/\b(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z][ -]?\d[A-Z]\d)\b/i;
const excluded=/sender.?s signature|signature|customs|declaration|cn[\s-]*2[23]|important!|size\s*\d|white or green|returned goods|net weight|total weight|quantity|postage|country of origin|hs tariff|fresher|commercial sample|contents|date and/i;
function recipientNameOK(value){
  const v=clean(value);
  if(v.length<4||v.length>90||excluded.test(v)||/\d|[|=<>\/]/.test(v))return false;
  if(!/^[\p{L}][\p{L}.'’ -]*[\p{L}]$/u.test(v))return false;
  const words=v.split(/\s+/);
  return words.length>=1&&words.length<=5&&words.some(w=>w.length>=3);
}
function recipientAddressOK(value){
  const v=clean(value);
  if(v.length<18||v.length>600||excluded.test(v)||/[|=<>]/.test(v))return false;
  // Printed shipping addresses normally contain a building/street number
  // and a recognizable destination/ZIP/postcode, not CN22 form instructions.
  const street=/\b(?:\d{1,6}[A-Z]?\s+[\p{L}\d' -]{2,45}\s+(?:RD|ROAD|ST|STREET|HILL|AVE|AVENUE|LN|LANE|DR|DRIVE|WAY|CLOSE|COURT|CT|BLVD|BOULEVARD|PL|PLACE)|(?:FLAT|UNIT|APT|APARTMENT|HOUSE)\s*[\w-]{1,12})\b/iu;
  const postcode=ukPostcode.test(v)||northAmericaPostcode.test(v)
    ||/\b\d{4}\s*,?\s*(?:AUSTRALIA|NEW ZEALAND)\b/i.test(v);
  const parts=v.split(',').map(x=>x.trim()).filter(Boolean);
  return street.test(v)&&postcode&&parts.length>=2
    &&!parts.some(x=>x.length>95||/^[^A-Za-z0-9]+$/.test(x));
}
function cleanRecipientAddress(value){
  return clean(value).replace(/\s*,\s*/g,', ').replace(/,{2,}/g,',');
}
function validRecipient(found){
  return found&&recipientNameOK(found.consigneeName||'')
    &&recipientAddressOK(found.consigneeAddress||'');
}

function isContent(line){
  return line.length>=2&&line.length<=180&&!END.test(line)&&!EMPTY.test(line)&&!edNo.test(line)&&
    !/^(?:\d{1,6}\s*(?:g|gm|grams?|kg|kgs?)|https?:\/\/)/i.test(line);
}
function parseTO(lines){
  for(let i=0;i<lines.length;i++){
    const line=clean(lines[i]);
    if(!HEADER.test(line))continue;
    // Reject "TO DELIVER" and prose: require a label ending at ':' or on its own.
    const match=line.match(/^(?:TO|CONSIGNEE|RECIPIENT|ADDRESSEE)\s*(?::|[-–])?\s*(.*)$/i);
    if(!match)continue;
    const label=line.match(/^(?:TO|CONSIGNEE|RECIPIENT|ADDRESSEE)\s*(?::|[-–])?$/i);
    const inline=clean(match[1]);
    if(!label&&!/^(?:TO|CONSIGNEE|RECIPIENT|ADDRESSEE)\s*:/i.test(line))continue;
    const parts=[];
    if(inline&&isContent(inline))parts.push(inline);
    for(let j=i+1;j<Math.min(lines.length,i+10);j++){
      const item=clean(lines[j]);
      if(END.test(item)||HEADER.test(item))break;
      if(isContent(item))parts.push(item.replace(/^(?:NAME|ADDRESS|ADD(?:RESS)?)\s*:\s*/i,''));
      if(parts.length>=6)break;
    }
    if(!parts.length)continue;
    let first=parts[0];
    first=first.replace(/^(?:MR|MRS|MS|MISS|DR)\.?\s*[:]\s*/i,m=>m.trim().replace(':',' ')+' ');
    const likelyName=/[A-Za-z]{2}/.test(first)&&
      !/^\d/.test(first)&&!/\b(?:STREET|ROAD|LANE|ST\.?|AVE\.?|AVENUE|FLAT|APARTMENT|BUILDING|POSTCODE|PINCODE|ZIP)\b/i.test(first)&&
      first.length<=85;
    const consigneeName=likelyName?first:'';
    const addressParts=likelyName?parts.slice(1):parts;
    // Only accept substantial address text instead of shipping instructions.
    const consigneeAddress=addressParts.join(', ').slice(0,600);
    if(!consigneeName&&!consigneeAddress)continue;
    return {consigneeName,consigneeAddress,toSectionFound:true};
  }
  return {consigneeName:'',consigneeAddress:'',toSectionFound:false};
}

function tsvLines(tsv=''){
  const rows=String(tsv||'').trim().split(/\r?\n/);
  const header=rows.shift()?.split('\t')||[];
  const index=new Map(header.map((x,i)=>[x,i]));
  for(const key of ['text','level','page_num','block_num','par_num','line_num','top','left']){
    if(!index.has(key))return [];
  }
  const groups=new Map();
  for(const row of rows){
    const p=row.split('\t');
    if(p[index.get('level')]!=='5')continue;
    const t=clean(p.slice(index.get('text')).join('\t'));
    if(!t)continue;
    const k=['page_num','block_num','par_num','line_num'].map(key=>p[index.get(key)]).join(':');
    const left=Number(p[index.get('left')]),top=Number(p[index.get('top')]);
    if(!Number.isFinite(left)||!Number.isFinite(top))continue;
    if(!groups.has(k))groups.set(k,{pieces:[],top,left});
    const g=groups.get(k);g.pieces.push({t,left});
    g.top=Math.min(g.top,top);g.left=Math.min(g.left,left);
  }
  return [...groups.values()].map(g=>({text:g.pieces.sort((a,b)=>a.left-b.left).map(x=>x.t).join(' '),top:g.top,left:g.left})).sort((a,b)=>a.top-b.top||a.left-b.left);
}

// On some international EMS boxes, the printed TO heading is hidden by
// a CN22 sticker. Accept the address block above FROM only if the layout
// has multiple independent lines: person's name + street + destination.
function parseRecipientBlockAboveFROM(lines){
  const from=lines.find(g=>/^\W*(?:FROM|SENDER)\b/i.test(g.text));
  if(!from)return {consigneeName:'',consigneeAddress:'',toSectionFound:false};
  const candidates=lines.filter(g=>g.top<from.top-12 && g.top>from.top-650 &&
    g.left>from.left+90 && !END.test(g.text) && !edNo.test(g.text))
    .sort((a,b)=>a.top-b.top||a.left-b.left);
  for(let i=0;i<candidates.length;i++){
    const one=clean(candidates[i].text);
    // Name must have letters but no street-number / postal-code / tariff.
    if(one.length<4||one.length>80||!/[A-Za-z]{2}/.test(one)||
       /\d|[:\/]|(?:POST|CN22|CUSTOMS|DECLARATION|FRESHNERS|KG)/i.test(one))continue;
    const following=[];
    for(let j=i+1;j<candidates.length&&following.length<6;j++){
      const next=candidates[j],prev=following.at(-1)?.line||candidates[i];
      if(next.top-prev.top>125||Math.abs(next.left-candidates[i].left)>280)break;
      if(/^\+?\d[\d\s-]{7,}$/.test(next.text))break; // Phone is not an address line.
      if(END.test(next.text))break;
      following.push({text:clean(next.text),line:next});
    }
    const parts=following.map(x=>x.text);
    const street=parts.some(v=>/^\d{1,5}\s+[\p{L}\d]+/u.test(v)&&/\b(?:RD|ROAD|ST|STREET|AVE|AVENUE|LANE|LN|HILL|DR|DRIVE|WAY|CLOSE|CT)\b/i.test(v));
    const destination=parts.some(v=>/\b(?:UK|USA|CANADA|UNITED KINGDOM|[A-Z]\d[A-Z]\s*\d[A-Z]\d|[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2})\b/i.test(v));
    if(street&&destination)return {
      consigneeName:one,consigneeAddress:parts.join(', ').slice(0,600),
      toSectionFound:false,toHeadingCovered:true
    };
  }
  return {consigneeName:'',consigneeAddress:'',toSectionFound:false};
}

// Sometimes the TO header is covered, but the country/postcode and large
// recipient printing remain readable. Find a consistent column containing a
// name, street, and destination postcode. Do not use a FROM-area address.
function parseRecipientByDestinationPostalCode(lines){
  const postal=/\b(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|[A-Z]\d[A-Z]\s*\d[A-Z]\d|\d{5}(?:-\d{4})?)\b/i;
  const street=/\b(?:RD|ROAD|ST|STREET|HILL|LANE|DR|DRIVE|AVENUE|AVE|CLOSE|WAY|COURT|BLVD)\b/i;
  const from=lines.find(x=>/^\W*(?:FROM|SENDER)\b/i.test(x.text));
  for(const end of lines){
    if(!postal.test(end.text))continue;
    // Require the destination to be in the consignee column or above FROM.
    if(from&&end.top>from.top-8&&end.left<=from.left+110)continue;
    const sameColumn=lines.filter(x=>x.top>=end.top-470&&x.top<=end.top+20
      &&Math.abs(x.left-end.left)<270
      &&(!from||x.top<from.top-8||x.left>from.left+110)
      &&!END.test(x.text)&&!edNo.test(x.text))
      .sort((a,b)=>a.top-b.top||a.left-b.left);
    const postcodeAt=sameColumn.findIndex(x=>postal.test(x.text));
    if(postcodeAt<2)continue;
    const streetAt=sameColumn.findIndex((x,i)=>i<postcodeAt
      &&/^\s*\d{1,6}[\s,]/.test(x.text)&&street.test(x.text));
    if(streetAt<1)continue;
    // A sender identity frequently precedes S/O or D/O; exclude it.
    const possibleName=[...sameColumn.slice(Math.max(0,streetAt-3),streetAt)]
      .reverse().find(x=>{
        const t=clean(x.text);
        return t.length>=4&&t.length<=85&&/[A-Z]{2,}/i.test(t)
          &&!/\d|[:\/]|(?:POST|CUSTOMS|DECLARATION|FRESHNERS|KG|S\/O|D\/O|W\/O|FROM)/i.test(t);
      });
    if(!possibleName)continue;
    const address=sameColumn.slice(streetAt,Math.min(sameColumn.length,postcodeAt+1))
      .map(x=>clean(x.text)).filter(t=>t&&!/^\+?\d[\d\s-]{7,}$/.test(t))
      .join(', ').slice(0,600);
    if(address.length<15)continue;
    return {consigneeName:clean(possibleName.text),consigneeAddress:address,
      toSectionFound:false,toHeadingCovered:true};
  }
  return {consigneeName:'',consigneeAddress:'',toSectionFound:false};
}

// For a focused crop of the large printed TO address, the label itself may
// be outside the image. Extract adjacent NAME > NUMBERED STREET > CITY >
// destination rows, never standalone CN22 instructions or phone numbers.
// A damaged postcode is returned only as a draft for manual correction.
function parsePrintedTOCrop(rawLines){
  const lines=rawLines.map(x=>clean(x).replace(/^[^\p{L}\d]+/u,'').replace(/[|_=]+$/,'').trim()).filter(Boolean);
  const street=/^\d{1,6}[A-Z]?\s+[\p{L}\d' .-]{2,60}\b(?:RD|ROAD|ST|STREET|AVE|AVENUE|LANE|LN|HILL|DR|DRIVE|WAY|CT|COURT|BLVD|CLOSE|PLACE|PL)\b/i;
  for(let i=1;i<lines.length;i++){
    const st=lines[i];
    if(!street.test(st))continue;
    const name=lines[i-1].replace(/^[^\p{L}]+/u,'').trim();
    if(!recipientNameOK(name))continue;
    const chunks=[st];
    for(let j=i+1;j<Math.min(i+5,lines.length);j++){
      const line=lines[j];
      if(/^\+?\d[\d ()-]{8,}$/.test(line))break; // phone
      if(/^(?:FROM|SENDER|CN[\s-]*2[23]|DECLARATION|CONTENTS)/i.test(line))break;
      if(excluded.test(line)||line.length>90||line.length<3)break;
      chunks.push(line);
      if(ukPostcode.test(line)||northAmericaPostcode.test(line))break;
      if(/,\s*(?:UK|USA|CANADA|UNITED KINGDOM)\b/i.test(line))break;
    }
    const address=cleanRecipientAddress(chunks.join(', '));
    if(chunks.length<2)continue;
    return {consigneeName:name,consigneeAddress:address,
      toSectionFound:false,toHeadingCovered:true};
  }
  return {consigneeName:'',consigneeAddress:'',toSectionFound:false};
}

export function readConsigneeFromEmsTO(text='',tsv=''){
  const rawLines=String(text||'').split(/\r?\n/).map(clean).filter(Boolean);
  const fromText=parseTO(rawLines);
  // TSV group boundaries are useful when line wrapping makes the main text
  // misordered; only use its recipient-labelled block, never generic matches.
  const groups=tsvLines(tsv);
  const fromTsv=parseTO(groups.map(g=>g.text));
  const fromCoveredHeading=parseRecipientBlockAboveFROM(groups);
  const fromPostalAnchor=parseRecipientByDestinationPostalCode(groups);
  // The old "first name-like text wins" rule sometimes selected CN22
  // disclaimer lines. Instead, accept only a complete postal address and
  // a clean recipient name from the same labelled/spatial TO block.
  const fromPrintedCrop=parsePrintedTOCrop(rawLines);
  const options=[fromText,fromTsv,fromPostalAnchor,fromCoveredHeading,fromPrintedCrop];
  const best=options.find(validRecipient);
  if(!best){
    const draft=fromPrintedCrop.consigneeName?fromPrintedCrop:null;
    return {consigneeName:draft?.consigneeName||'',
      consigneeAddress:draft?.consigneeAddress||'',
      toSectionFound:false,toHeadingCovered:Boolean(draft),
      needsReview:true,
      recipientConfidence:draft?'low':'unreadable'};
  }
  return {
    consigneeName:clean(best.consigneeName),
    consigneeAddress:cleanRecipientAddress(best.consigneeAddress),
    toSectionFound:best.toSectionFound===true,
    toHeadingCovered:best.toHeadingCovered===true,
    needsReview:best.toHeadingCovered===true,
    recipientConfidence:best.toSectionFound?'high':'medium'
  };
}
