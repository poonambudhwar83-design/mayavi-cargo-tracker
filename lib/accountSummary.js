// Bank transaction categorisation and aggregation for Summary of Accounts.
// Party names entered by Admin are authoritative. Legacy entries may be
// identified by clear platform names in Remarks, never by a guessed bank name.
export const ACCOUNT_PARTIES=['Zepto','Blinkit','Amazon','Meesho','Myntra','Zomato','FirstCry','Nykaa','Flipkart'];
const PATTERNS=[
  [/\bzepto\b/i,'Zepto'],
  [/\bblinkit\b/i,'Blinkit'],
  [/\b(?:amazon|amzn)\b/i,'Amazon'],
  [/\bmeesho\b/i,'Meesho'],
  [/\b(?:myntra|mantra)\b/i,'Myntra'],
  [/\bzomato\b/i,'Zomato'],
  [/\bfirst[\s-]*cry\b/i,'FirstCry'],
  [/\b(?:nykaa|nykaaye)\b/i,'Nykaa'],
  [/\bflip[\s-]*kart\b/i,'Flipkart']
];
const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
export function accountParty(entry={}){
  const explicit=clean(entry.partyName||entry.party_name);
  if(explicit){
    for(const [pattern,name] of PATTERNS)if(pattern.test(explicit))return name;
    return explicit;
  }
  const remarks=clean(entry.remarks);
  for(const [pattern,name] of PATTERNS)if(pattern.test(remarks))return name;
  return 'Unclassified';
}
const toPaise=value=>Math.round((Number(value)||0)*100);
const fromPaise=value=>value/100;

// Build complete month-wise credit/debit totals for every recognised platform.
// All amounts are summed in paise to avoid floating point rounding errors.
export function summarizeMonthlyEntries(entries=[]){
  const byMonth=new Map();
  const newParty=party=>({party,count:0,creditPaise:0,debitPaise:0});
  for(const entry of entries){
    const month=String(entry.date||'').slice(0,7);
    if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))continue;
    if(!byMonth.has(month))byMonth.set(month,{
      month,count:0,creditPaise:0,debitPaise:0,
      parties:new Map(ACCOUNT_PARTIES.map(p=>[p,newParty(p)]))
    });
    const group=byMonth.get(month);
    const party=entry.party||accountParty(entry);
    if(!group.parties.has(party))group.parties.set(party,newParty(party));
    const detail=group.parties.get(party);
    const credit=toPaise(entry.credit),debit=toPaise(entry.debit);
    group.count++;group.creditPaise+=credit;group.debitPaise+=debit;
    detail.count++;detail.creditPaise+=credit;detail.debitPaise+=debit;
  }
  const amounts=g=>({count:g.count,credit:fromPaise(g.creditPaise),
    debit:fromPaise(g.debitPaise),net:fromPaise(g.creditPaise-g.debitPaise)});
  return [...byMonth.values()].sort((a,b)=>b.month.localeCompare(a.month)).map(g=>{
    const partyList=[...ACCOUNT_PARTIES.map(p=>g.parties.get(p)),...
      [...g.parties.values()].filter(p=>!ACCOUNT_PARTIES.includes(p.party)&&p.party!=='Unclassified')
        .sort((a,b)=>a.party.localeCompare(b.party)),
      ...(g.parties.has('Unclassified')?[g.parties.get('Unclassified')]:[])];
    return {month:g.month,...amounts(g),parties:partyList.map(p=>({party:p.party,...amounts(p)}))};
  });
}
export function summarizeAccountEntries(entries=[]){
  const byParty=new Map(ACCOUNT_PARTIES.map(p=>[p,{party:p,count:0,creditPaise:0,debitPaise:0,lastCreditDate:''}]));
  const mapped=entries.map(entry=>{
    const party=accountParty(entry);
    if(!byParty.has(party))byParty.set(party,{party,count:0,creditPaise:0,debitPaise:0,lastCreditDate:''});
    const group=byParty.get(party);
    const credit=toPaise(entry.credit),debit=toPaise(entry.debit);
    group.count++;group.creditPaise+=credit;group.debitPaise+=debit;
    const date=String(entry.date||'');
    if(credit>0&&date>group.lastCreditDate)group.lastCreditDate=date;
    return {...entry,party,partySource:clean(entry.partyName||entry.party_name)?'Entered':'Remarks / Unclassified',
      credit:fromPaise(credit),debit:fromPaise(debit)};
  }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||
    String(b.createdAt||'').localeCompare(String(a.createdAt||''))||
    String(b.id||'').localeCompare(String(a.id||'')));
  const totals=mapped.reduce((a,r)=>{
    a.count++;a.creditPaise+=toPaise(r.credit);a.debitPaise+=toPaise(r.debit);return a;
  },{count:0,creditPaise:0,debitPaise:0});
  const summary=g=>({party:g.party,count:g.count,credit:fromPaise(g.creditPaise),
    debit:fromPaise(g.debitPaise),net:fromPaise(g.creditPaise-g.debitPaise),
    lastCreditDate:g.lastCreditDate||null});
  const groups=[...ACCOUNT_PARTIES.map(p=>byParty.get(p)),...
    [...byParty.values()].filter(g=>!ACCOUNT_PARTIES.includes(g.party)&&g.party!=='Unclassified')
      .sort((a,b)=>a.party.localeCompare(b.party)),...(byParty.has('Unclassified')?[byParty.get('Unclassified')]:[])
  ].map(summary);
  return {groups,entries:mapped,monthly:summarizeMonthlyEntries(mapped),
    totals:summary({...totals,party:'ALL',lastCreditDate:''})};
}
