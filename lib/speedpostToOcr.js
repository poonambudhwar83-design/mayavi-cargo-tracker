// Read only the recipient / consignee block explicitly labelled "TO" on
// the EMS parcel label. Do not infer a name or address from a tracking website.
// User-uploaded photos are processed in memory and are not stored.
const HEADER=/^(?:TO|TO:|TO\s*[-–:]|CONSIGNEE|CONSIGNEE:|RECIPIENT|RECIPIENT:|ADDRESSEE:)(?:\s|$)/i;
const END=/^(?:FROM|FROM:|SENDER|SENDER:|CN\s*22|CN\s*23|CUSTOMS|CUSTOMS DECLARATION|DECLARATION|CONTENTS?|DESCRIPTION|NET WEIGHT|GROSS WEIGHT|POSTAGE|TARIFF|BOOKING DATE|COUNTRY OF ORIGIN|SIGNATURE|DATE\s*[:\-]|TOTAL|HS CODE|QUANTITY|QTY|VALUE|ARTICLE NO|ARTICLE NUMBER|EMS|SPEED POST|INDIA POST|TRACKING NO|AWB|SHIPMENT)/i;
const EMPTY=/^(?:TO|NAME|ADDRESS|RECIPIENT|CONSIGNEE|N\/A|NONE|NIL|NOT AVAILABLE|UNKNOWN|[-–—])$/i;
const edNo=/\bED[\s-]*\d{9}[\s-]*IN\b/i;
const clean=s=>String(s||'').normalize('NFKC').replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
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

export function readConsigneeFromEmsTO(text='',tsv=''){
  const rawLines=String(text||'').split(/\r?\n/).map(clean).filter(Boolean);
  const fromText=parseTO(rawLines);
  // TSV group boundaries are useful when line wrapping makes the main text
  // misordered; only use its recipient-labelled block, never generic matches.
  const groups=tsvLines(tsv);
  const fromTsv=parseTO(groups.map(g=>g.text));
  const fromCoveredHeading=parseRecipientBlockAboveFROM(groups);
  const fromPostalAnchor=parseRecipientByDestinationPostalCode(groups);
  const best=fromText.consigneeAddress&&fromText.consigneeName?fromText:
    (fromTsv.consigneeAddress&&fromTsv.consigneeName?fromTsv:
      fromText.toSectionFound?fromText:fromTsv.toSectionFound?fromTsv:
      fromPostalAnchor.consigneeName?fromPostalAnchor:fromCoveredHeading);
  return {
    consigneeName:best.consigneeName||'',
    consigneeAddress:best.consigneeAddress||'',
    toSectionFound:best.toSectionFound===true,
    toHeadingCovered:best.toHeadingCovered===true,
    needsReview:true
  };
}
