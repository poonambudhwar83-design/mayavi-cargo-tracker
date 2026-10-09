// UPU S10-style ED...IN article number reading.
// Text OCR sometimes splits a printed barcode label, drops separator spaces,
// or confuses 0/O/Q, 1/I/L, 5/S, 8/B, 2/Z, 6/G and N/M.
export function normalizeED(value=''){
  const s=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  return /^ED[0-9]{9}IN$/.test(s)?s:'';
}
export function checkEdChecksum(value=''){
  const s=normalizeED(value);if(!s)return false;
  const digits=s.slice(2,11).split('').map(Number);
  const weights=[8,6,4,2,3,5,9,7];
  const weighted=digits.slice(0,8).reduce((a,n,i)=>a+n*weights[i],0);
  const check=11-weighted%11;
  return digits[8]===(check===10?0:check===11?5:check);
}
function decodeED(raw=''){
  const src=String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(src.length!==13||!/^E[D0OQ]/.test(src)||!/[I1L][NMH]$/.test(src))return'';
  const digit=ch=>(/[0-9]/.test(ch)?ch:({O:'0',Q:'0',D:'0',I:'1',L:'1',S:'5',B:'8',Z:'2',G:'6',T:'7',A:'4'}[ch]||'?'));
  const mid=[...src.slice(2,11)].map(digit).join('');
  return normalizeED('ED'+mid+'IN');
}
export function edOcrCandidates(text=''){
  const original=String(text||'').normalize('NFKC').toUpperCase();
  // Maintain line proximity; start with compact tokens, then lines with OCR spaces.
  const variants=[original.replace(/[^A-Z0-9]/g,'')];
  variants.push(...original.split(/\r?\n/).map(l=>l.replace(/[^A-Z0-9]/g,'')));
  // Allow misread D after E, and I/N suffix errors. Never guess the 9 digits
  // if OCR does not actually present them.
  const rx=/E[D0OQ][0-9OQDILSBZGT A]{9}[I1L][NMH]/g;
  const seen=new Map();
  for(const variant of variants){
    for(const m of variant.matchAll(rx)){
      const number=decodeED(m[0]);
      if(!number)continue;
      const verified=checkEdChecksum(number);
      const entry=seen.get(number)||{number,checkDigitValid:verified,occurrences:0};
      entry.occurrences+=1;
      seen.set(number,entry);
    }
  }
  return [...seen.values()].sort((a,b)=>Number(b.checkDigitValid)-Number(a.checkDigitValid)||b.occurrences-a.occurrences).slice(0,12);
}
