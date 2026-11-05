// Standalone A4-landscape PDF renderer for authenticated Account summaries.
const PW=842,PH=595,L=27;
const fmt=new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const money=n=>fmt.format(Number(n)||0);
const ascii=v=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'")
  .replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7E]/g,'?');
const clip=(v,n)=>{const s=ascii(v);return s.length>n?s.slice(0,n-3)+'...':s;};
const escape=v=>ascii(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const rect=(x,y,w,h,c)=>'q '+c+' rg '+x+' '+y+' '+w+' '+h+' re f Q\n';
const txt=(v,x,y,s=10,bold=false,c='0.12 0.22 0.36')=>
  'BT /'+(bold?'F2':'F1')+' '+s+' Tf '+c+' rg 1 0 0 1 '+x+' '+y+' Tm ('+escape(v)+') Tj ET\n';
const rule=y=>'0.85 0.89 0.94 RG 0.6 w '+L+' '+y+' m '+(PW-L)+' '+y+' l S\n';
function base(title,subtitle,detail){
  return rect(0,0,PW,PH,'1 1 1')+rect(0,525,PW,70,'0.07 0.17 0.32')+
    txt(title,L,562,18,true,'1 1 1')+
    txt(subtitle,L,539,9,false,'0.78 0.88 1')+txt(detail,L,502,10,true);
}
function footer(body,index,total){
  return body+rule(48)+txt('MAYAVI | ADMIN ONLY | Saved account transactions',L,29,8,false,'0.4 0.46 0.55')+
    txt('Page '+(index+1)+' / '+total,754,29,8,false,'0.4 0.46 0.55');
}
function serialize(pages){
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>',null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const ids=[];
  for(const page of pages){
    const id=objects.length,stream=id+1;ids.push(id);
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+PW+' '+PH+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+stream+' 0 R >>');
    objects.push('<< /Length '+Buffer.byteLength(page,'latin1')+' >>\nstream\n'+page+'endstream');
  }
  objects[2]='<< /Type /Pages /Count '+ids.length+' /Kids ['+ids.map(id=>id+' 0 R').join(' ')+'] >>';
  let out='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets=[0];
  for(let i=1;i<objects.length;i++){
    offsets[i]=Buffer.byteLength(out,'latin1');
    out+=i+' 0 obj\n'+objects[i]+'\nendobj\n';
  }
  const xref=Buffer.byteLength(out,'latin1');
  out+='xref\n0 '+objects.length+'\n0000000000 65535 f \n';
  for(let i=1;i<objects.length;i++)out+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  out+='trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  return Buffer.from(out,'latin1');
}
export function createAccountSummaryPdf({groups=[],entries=[],totals={},account='All bank accounts',month='ALL',party='ALL'}={}){
  const scope='ACCOUNT: '+clip(account,45)+'  |  PERIOD: '+(month==='ALL'?'All dates':month)+'  |  PARTY: '+clip(party,27);
  const now=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium'}).format(new Date());
  const pages=[],perOverview=17;
  for(let start=0;start<Math.max(groups.length,1);start+=perOverview){
    const part=groups.slice(start,start+perOverview);
    let p=base('SUMMARY OF ACCOUNTS',scope,'Platform-wise payments and receipts | Generated '+now+' IST');
    p+=rect(L,455,788,25,'0.88 0.93 0.99');
    for(const [t,x] of [['PARTY / PLATFORM',35],['ENTRIES',255],['CREDIT (INR)',337],
      ['DEBIT (INR)',465],['NET (INR)',587],['LAST CREDIT',714]])p+=txt(t,x,464,9,true);
    part.forEach((g,i)=>{
      const y=432-i*20;
      if(i%2)p+=rect(L,y-5,788,20,'0.97 0.98 1');
      p+=txt(clip(g.party,29),35,y,9)+txt(String(g.count),255,y,9)+
        txt(money(g.credit),337,y,9)+txt(money(g.debit),465,y,9)+
        txt(money(g.net),587,y,9)+txt(g.lastCreditDate||'-',714,y,9);
    });
    if(start+perOverview>=groups.length){
      p+=rule(95)+txt('ALL PARTIES: '+(totals.count||0)+' entries',35,78,11,true)+
        txt('Credit INR '+money(totals.credit)+'  |  Debit INR '+money(totals.debit)+'  |  Net INR '+money(totals.net),235,78,10,true);
    }
    pages.push(p);
  }
  const selected=party==='ALL'?groups.filter(g=>g.count):groups.filter(g=>g.party===party);
  for(const g of selected){
    const rows=entries.filter(e=>e.party===g.party),pageSize=17;
    // Continuation lines preserve the FULL remarks, even when very long.
    const detailLines=rows.flatMap(e=>{
      const chunks=ascii(e.remarks||'-').match(/.{1,40}/g)||['-'];
      return chunks.map((remarksPart,i)=>({...e,remarksPart,continued:i>0}));
    });
    for(let start=0;start<Math.max(detailLines.length,1);start+=pageSize){
      const part=detailLines.slice(start,start+pageSize);
      let p=base('PARTY: '+clip(g.party,52),scope,
        g.count+' entries | Credit INR '+money(g.credit)+' | Debit INR '+money(g.debit)+' | Net INR '+money(g.net));
      p+=txt('Credit dates and amounts appear in each transaction row; latest first.',L,480,9,false,'0.35 0.44 0.57');
      p+=rect(L,438,788,25,'0.88 0.93 0.99');
      for(const [t,x] of [['DATE',35],['BANK ACCOUNT',123],['CREDIT (INR)',296],
        ['DEBIT (INR)',391],['MODE',487],['REMARKS',576]])p+=txt(t,x,447,9,true);
      part.forEach((e,i)=>{
        const y=421-i*21;
        if(i%2)p+=rect(L,y-6,788,21,'0.97 0.98 1');
        const bank=String(e.bankName||'')+' / '+String(e.accountNo||'');
        p+=txt(e.continued?'':clip(e.date,10),35,y,9)+
          txt(e.continued?'':clip(bank,34),123,y,8)+
          txt(e.continued?'':(e.credit?money(e.credit):'-'),296,y,9)+
          txt(e.continued?'':(e.debit?money(e.debit):'-'),391,y,9)+
          txt(e.continued?'':clip(e.mode,14),487,y,8)+txt(e.remarksPart,576,y,8);
      });
      if(!rows.length)p+=txt('No transactions recorded for this party in the selected period.',35,415,11);
      pages.push(p);
    }
  }
  if(!selected.length)pages.push(base('NO MATCHING TRANSACTIONS',scope,'There are no saved transactions for this filter.'));
  return serialize(pages.map((p,i)=>footer(p,i,pages.length)));
}
