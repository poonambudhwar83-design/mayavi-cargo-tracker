// Bank transaction categorisation and aggregation for Summary of Accounts.
// Party names entered by Admin are authoritative. Legacy entries may be
// identified by clear platform names in Remarks, never by a guessed bank name.
export const ACCOUNT_PARTIES=['Zepto','Blinkit','Amazon','Meesho','Myntra'];
const PATTERNS=[
  [/\bzepto\b/i,'Zepto'],
  [/\bblinkit\b/i,'Blinkit'],
  [/\b(?:amazon|amzn)\b/i,'Amazon'],
  [/\bmeesho\b/i,'Meesho'],
  [/\b(?:myntra|mantra)\b/i,'Myntra']
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
  return {groups,entries:mapped,totals:summary({...totals,party:'ALL',lastCreditDate:''})};
}
