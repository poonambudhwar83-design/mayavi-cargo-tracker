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
    !/^(?:\\d{1,6}\\s*(?:g|gm|grams?|kg|kgs?)|https?:\/\/)/i.test(line);
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

export function readConsigneeFromEmsTO(text='',tsv=''){
  const rawLines=String(text||'').split(/\r?\n/).map(clean).filter(Boolean);
  const fromText=parseTO(rawLines);
  // TSV group boundaries are useful when line wrapping makes the main text
  // misordered; only use its recipient-labelled block, never generic matches.
  const groups=tsvLines(tsv);
  const fromTsv=parseTO(groups.map(g=>g.text));
  const best=fromText.consigneeAddress&&fromText.consigneeName?fromText:
    (fromTsv.consigneeAddress&&fromTsv.consigneeName?fromTsv:
      fromText.toSectionFound?fromText:fromTsv);
  return {
    consigneeName:best.consigneeName||'',
    consigneeAddress:best.consigneeAddress||'',
    toSectionFound:best.toSectionFound===true,
    needsReview:true
  };
}
