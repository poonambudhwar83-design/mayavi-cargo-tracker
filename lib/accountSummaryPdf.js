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
export function createAccountSummaryPdf({groups=[],entries=[],monthly=[],peopleGroups=[],peopleEntries=[],totals={},account='All bank accounts',month='ALL',party='ALL'}={}){
  const scope='ACCOUNT: '+clip(account,45)+'  |  PERIOD: '+(month==='ALL'?'All dates':month)+'  |  PARTY: '+clip(party,27);
  const now=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium'}).format(new Date());
  const pages=[],perOverview=17;

  // Monthly overview and month-wise platform subtotals are always based on the
  // selected bank(s), not on the detail-period or party filters.
  if(monthly.length){
    const monthlyScope='ACCOUNT: '+clip(account,52)+'  |  ALL MONTHS  |  ALL PLATFORMS';
    const lifetime=monthly.reduce((a,r)=>({count:a.count+r.count,credit:a.credit+r.credit,
      debit:a.debit+r.debit,net:a.net+r.net}),{count:0,credit:0,debit:0,net:0});
    for(let start=0;start<monthly.length;start+=17){
      const chunk=monthly.slice(start,start+17);
      let p=base('MONTH-WISE ACCOUNT SUMMARY',monthlyScope,'Monthly totals | Generated '+now+' IST');
      p+=rect(L,455,788,25,'0.88 0.93 0.99');
      for(const [label,x] of [['MONTH',35],['ENTRIES',195],['CREDIT (INR)',285],
        ['DEBIT (INR)',430],['NET (INR)',590]])p+=txt(label,x,464,9,true);
      chunk.forEach((r,i)=>{
        const y=432-i*20;
        if(i%2)p+=rect(L,y-5,788,20,'0.97 0.98 1');
        p+=txt(r.month,35,y,10,true)+txt(String(r.count),195,y,9)+
          txt(money(r.credit),285,y,9)+txt(money(r.debit),430,y,9)+txt(money(r.net),590,y,9);
      });
      if(start+17>=monthly.length){
        p+=rule(72)+txt('TOTAL: '+lifetime.count+' entries',35,61,10,true)+
          txt('Credit INR '+money(lifetime.credit)+' | Debit INR '+money(lifetime.debit)+
            ' | Net INR '+money(lifetime.net),230,61,10,true);
      }
      pages.push(p);
    }
    for(const monthRow of monthly){
      const rows=monthRow.parties||[];
      for(let start=0;start<rows.length;start+=17){
        const chunk=rows.slice(start,start+17);
        let p=base('MONTH: '+monthRow.month+' | PLATFORM TOTALS',monthlyScope,
          monthRow.count+' entries  |  Credit INR '+money(monthRow.credit)+
          '  |  Debit INR '+money(monthRow.debit)+'  |  Net INR '+money(monthRow.net));
        p+=rect(L,455,788,25,'0.88 0.93 0.99');
        for(const [label,x] of [['PLATFORM',35],['ENTRIES',255],['CREDIT (INR)',355],
          ['DEBIT (INR)',492],['NET (INR)',636]])p+=txt(label,x,464,9,true);
        chunk.forEach((r,i)=>{
          const y=432-i*20;
          if(i%2)p+=rect(L,y-5,788,20,'0.97 0.98 1');
          p+=txt(clip(r.party,30),35,y,9,true)+txt(String(r.count),255,y,9)+
            txt(money(r.credit),355,y,9)+txt(money(r.debit),492,y,9)+txt(money(r.net),636,y,9);
        });
        pages.push(p);
      }
    }
  }
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
  // Cross-referenced people from remarks; NEVER added to platform/grand totals.
  if(peopleGroups.length){
    const detailScope=scope+' | PERSON CROSS-REFERENCE';
    for(let start=0;start<peopleGroups.length;start+=17){
      let p=base('PERSON-WISE ACCOUNTS',detailScope,
        'Person-wise credit, debit and original saved reasons | Not double-counted');
      p+=rect(L,455,788,25,'0.88 0.93 0.99');
      for(const [name,x] of [['PERSON',35],['ENTRIES',255],['CREDIT (INR)',355],
        ['DEBIT (INR)',500],['NET (INR)',638]])p+=txt(name,x,464,9,true);
      peopleGroups.slice(start,start+17).forEach((g,i)=>{
        const y=432-i*20;
        if(i%2)p+=rect(L,y-5,788,20,'0.97 0.98 1');
        p+=txt(clip(g.person,28),35,y,9,true)+txt(String(g.count),255,y,9)+
          txt(money(g.credit),355,y,9)+txt(money(g.debit),500,y,9)+txt(money(g.net),638,y,9);
      });
      pages.push(p);
    }
    const pageSize=17;
    for(const g of peopleGroups.filter(x=>x.count>0)){
      const rows=peopleEntries.filter(e=>e.person===g.person);
      const lines=rows.flatMap(e=>{
        const parts=ascii(e.reason||'Reason not specified').match(/.{1,42}/g)||['-'];
        return parts.map((reasonPart,i)=>({...e,reasonPart,continued:i>0}));
      });
      for(let start=0;start<lines.length;start+=pageSize){
        const pRows=lines.slice(start,start+pageSize);
        let p=base('PERSON: '+clip(g.person,48),detailScope,
          g.count+' entries | Credit INR '+money(g.credit)+' | Debit INR '+money(g.debit));
        p+=rect(L,455,788,25,'0.88 0.93 0.99');
        for(const [name,x] of [['DATE',35],['BANK',128],['CREDIT (INR)',295],
          ['DEBIT (INR)',395],['MODE',498],['WHY / REMARKS',575]])p+=txt(name,x,464,9,true);
        pRows.forEach((row,i)=>{
          const y=432-i*21;
          if(i%2)p+=rect(L,y-6,788,21,'0.97 0.98 1');
          p+=txt(row.continued?'':clip(row.date,10),35,y,9)+
            txt(row.continued?'':clip(row.bankName||'',30),128,y,9)+
            txt(row.continued?'':row.credit?money(row.credit):'-',295,y,9)+
            txt(row.continued?'':row.debit?money(row.debit):'-',395,y,9)+
            txt(row.continued?'':clip(row.mode||'',12),498,y,8)+
            txt(row.reasonPart,575,y,8);
        });
        pages.push(p);
      }
    }
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
