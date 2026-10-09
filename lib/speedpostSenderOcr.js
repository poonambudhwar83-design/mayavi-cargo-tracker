// Dedicated OCR parser for the SENDER NAME in the FROM block on an EMS parcel.
// Never use the TO/recipient block as the sender. Output is a candidate for review.
function lineClean(value=''){
  return String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
}
const start=/^(?:FROM|SENDER|SENDER NAME)\s*(?::|[-–])?\s*$/i;
const inline=/^(?:FROM|SENDER|SENDER NAME)\s*:\s*(.+)$/i;
const stop=/^(?:TO|TO:|CONSIGNEE|RECIPIENT|CN\s*22|CN\s*23|DECLARATION|CUSTOMS|EMS|SPEED POST|INDIA POST|WEIGHT|TRACKING|DESCRIPTION|ARTICLE|BARCODE|PHONE|MOBILE|TEL|SIGNATURE)\b/i;
const address=/^(?:S\s*\/\s*O|D\s*\/\s*O|W\s*\/\s*O|C\s*\/\s*O|HOUSE|H\s*NO|VILL(?:AGE)?|POST|P\s*O|PO|DIST(?:RICT)?|ROAD|STREET|LANE|PIN|ZIP|[+]?\d)/i;
const ed=/\bED\s*\d{9}\s*IN\b/i;
function candidate(value=''){
  const v=lineClean(value).replace(/^(?:NAME\s*[:\-]\s*)/i,'').replace(/^[\s:–-]+|[\s:–-]+$/g,'');
  if(!v||v.length<4||v.length>90||!/[A-Za-z]{2}/.test(v))return '';
  if(stop.test(v)||address.test(v)||ed.test(v)||/\d{3,}/.test(v))return '';
  if(/\b(?:GIFT|FROM INDIA|CUSTOMS|DOCUMENTS|POSTAGE|CONTACT|POST OFFICE|SPEED POST)\b/i.test(v))return '';
  return v;
}
function readBlock(lines=[]){
  for(let i=0;i<lines.length;i++){
    const line=lineClean(lines[i]);
    const same=line.match(inline);
    if(!start.test(line)&&!same)continue;
    if(same){
      const name=candidate(same[1]);
      if(name)return name;
    }
    for(let j=i+1;j<Math.min(lines.length,i+5);j++){
      const next=lineClean(lines[j]);
      if(stop.test(next))break;
      const name=candidate(next);
      if(name)return name;
    }
  }
  return '';
}
function tsvLines(tsv=''){
  const raw=String(tsv||'').trim().split(/\r?\n/);
  const header=raw.shift()?.split('\t')||[];
  const col=Object.fromEntries(header.map((key,index)=>[key,index]));
  if(['text','level','page_num','block_num','par_num','line_num','left','top'].some(x=>col[x]===undefined))return [];
  const grouped=new Map();
  for(const row of raw){
    const p=row.split('\t');
    if(p[col.level]!=='5')continue;
    const t=lineClean(p.slice(col.text).join('\t'));
    const x=Number(p[col.left]),y=Number(p[col.top]);
    if(!t||!Number.isFinite(x)||!Number.isFinite(y))continue;
    const key=[col.page_num,col.block_num,col.par_num,col.line_num].map(k=>p[k]).join(':');
    if(!grouped.has(key))grouped.set(key,{y,x,words:[]});
    const g=grouped.get(key);g.y=Math.min(g.y,y);g.x=Math.min(g.x,x);
    g.words.push({x,t});
  }
  return [...grouped.values()].sort((a,b)=>a.y-b.y||a.x-b.x)
    .map(g=>g.words.sort((a,b)=>a.x-b.x).map(x=>x.t).join(' '));
}
export function readSenderNameFromFROM(text='',tsv=''){
  const plainLines=String(text||'').split(/\r?\n/).map(lineClean).filter(Boolean);
  const plain=readBlock(plainLines);
  const structured=readBlock(tsvLines(tsv));
  const name=plain||structured;
  return {senderName:name,fromBlockFound:Boolean(name),needsReview:true};
}
