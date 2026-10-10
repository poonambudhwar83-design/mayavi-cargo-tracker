// India Post / UPU S10 printed EMS labels: ED + 9 digits + IN.
// Treat recognized characters as candidates, not confirmed parcel identifiers.
export function normalizeED(value=''){
  const s=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  return /^ED\d{9}IN$/.test(s)?s:'';
}
export function checkEdChecksum(value=''){
  const s=normalizeED(value);if(!s)return false;
  const digits=s.slice(2,11).split('').map(Number);
  const weights=[8,6,4,2,3,5,9,7];
  const sum=digits.slice(0,8).reduce((a,n,i)=>a+n*weights[i],0);
  const check=11-sum%11;
  return digits[8]===(check===10?0:check===11?5:check);
}
function decodeED(raw=''){
  const src=String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(src.length!==13||!/^E[D0OQ]/.test(src)||!/[I1L][NMH]$/.test(src))return'';
  const map={O:'0',Q:'0',D:'0',I:'1',L:'1',S:'5',B:'8',Z:'2',G:'6',T:'7',A:'4'};
  const digits=[...src.slice(2,11)].map(ch=>/[0-9]/.test(ch)?ch:(map[ch]||'?')).join('');
  return normalizeED('ED'+digits+'IN');
}
const pattern=/E[D0OQ][0-9OQDILSBZGTA]{9}[I1L][NMH]/g;
const emsKeyword=/\bEMS\b|SPEED\s*POST|EXPRESS\s*MAIL\s*SERVICE/i;
export function edOcrCandidates(text='',options={}){
  const raw=String(text||'').normalize('NFKC').toUpperCase();
  const lines=raw.split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  const emsLines=lines.flatMap((x,i)=>emsKeyword.test(x)?[i]:[]);
  const found=new Map();
  // Every candidate comes from the same printed line or at most two following
  // lines. Concatenating the whole document can produce false article numbers.
  for(let i=0;i<lines.length;i++){
    const nearEms=options.emsRegion===true||emsLines.some(j=>Math.abs(i-j)<=5);
    for(let span=1;span<=3&&i+span<=lines.length;span++){
      const textRegion=lines.slice(i,i+span).join('').replace(/[^A-Z0-9]/g,'');
      for(const m of textRegion.matchAll(pattern)){
        const number=decodeED(m[0]);
        if(!number)continue;
        const prev=found.get(number)||{number,checkDigitValid:checkEdChecksum(number),emsNearby:false,occurrences:0};
        prev.emsNearby ||=nearEms;
        prev.occurrences++;
        found.set(number,prev);
      }
    }
  }
  return [...found.values()].sort((a,b)=>
    Number(b.checkDigitValid)-Number(a.checkDigitValid)||
    Number(b.emsNearby)-Number(a.emsNearby)||
    b.occurrences-a.occurrences
  ).slice(0,12);
}
