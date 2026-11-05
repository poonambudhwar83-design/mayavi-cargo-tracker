import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import ExcelJS from 'exceljs';
import {readSession} from '../../../lib/mayaviAuth.js';
import {moneyInput,cleanAccountText,readLedgerEntry} from '../../../lib/accountLedger.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const idValid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
const monthValid=value=>value==='ALL'||/^(20\d{2})-(0[1-9]|1[0-2])$/.test(String(value||''));
function client(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw Error('Shared Mayavi database is not configured.');
  return neon(url);
}
async function verifyAdmin(request,sql){
  const session=readSession(request);
  if(!session)return {error:'Log in to Mayavi first.',status:401};
  const accountsOnly=session.role==='employee'&&session.username==='accounts'&&session.branchScope==='ACCOUNTS';
  if(session.role!=='admin'&&!accountsOnly)return {error:'Accounts access only.',status:403};
  const users=await sql`SELECT role,branch_scope,session_version,is_active FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
  const user=users[0];
  const allowed=(session.role==='admin'&&user?.role==='admin')||(accountsOnly&&user?.role==='employee'&&user?.branch_scope==='ACCOUNTS');
  if(!allowed||!user?.is_active||Number(user.session_version||0)!==Number(session.sessionVersion||0))return {error:'Accounts session inactive.',status:403};
  return {session};
}
async function ensureTables(sql){
  await sql`CREATE TABLE IF NOT EXISTS mayavi_bank_accounts (
    id UUID PRIMARY KEY,
    holder_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS mayavi_bank_entries (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES mayavi_bank_accounts(id),
    entry_date DATE NOT NULL,
    credit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit>=0),
    debit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit>=0),
    transaction_mode TEXT NOT NULL DEFAULT '',
    remarks TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mayavi_bank_entry_one_side CHECK ((credit>0 AND debit=0) OR (debit>0 AND credit=0))
  )`;
  await sql`ALTER TABLE mayavi_bank_entries ADD COLUMN IF NOT EXISTS transaction_mode TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE mayavi_bank_entries ADD COLUMN IF NOT EXISTS party_name TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE INDEX IF NOT EXISTS mayavi_bank_entry_account_date
    ON mayavi_bank_entries(account_id,entry_date,created_at,id)`;
}
const money=v=>Number(v||0);
const two=v=>Math.round(money(v)*100)/100;
const accountFromDb=a=>({
  id:a.id,holderName:a.holder_name,accountNo:a.account_number,bankName:a.bank_name,
  openingBalance:two(a.opening_balance),totalCredit:two(a.total_credit),
  totalDebit:two(a.total_debit),balance:two(a.current_balance),
  createdAt:a.created_at,updatedAt:a.updated_at
});
async function accounts(sql){
  const data=await sql`SELECT a.id,a.holder_name,a.account_number,a.bank_name,a.opening_balance,
    a.created_at,a.updated_at,COALESCE(t.total_credit,0) AS total_credit,
    COALESCE(t.total_debit,0) AS total_debit,
    a.opening_balance+COALESCE(t.total_credit,0)-COALESCE(t.total_debit,0) AS current_balance
    FROM mayavi_bank_accounts a LEFT JOIN (
      SELECT account_id,SUM(credit) AS total_credit,SUM(debit) AS total_debit
      FROM mayavi_bank_entries GROUP BY account_id
    ) t ON t.account_id=a.id
    ORDER BY a.created_at ASC,a.id ASC`;
  return data.map(accountFromDb);
}
async function ledger(sql,accountId,month){
  // Calculate balances across *all* earlier transactions first, then filter
  // by month; otherwise monthly views incorrectly reset the balance.
  const items=await sql`WITH running AS (
    SELECT e.id,e.account_id,e.entry_date::TEXT AS entry_date,e.credit,e.debit,e.transaction_mode,e.remarks,e.party_name,
    e.created_at,e.updated_at,
    (a.opening_balance+SUM(e.credit-e.debit)
      OVER (PARTITION BY e.account_id ORDER BY e.entry_date,e.created_at,e.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS balance
    FROM mayavi_bank_entries e
    JOIN mayavi_bank_accounts a ON a.id=e.account_id
    WHERE e.account_id=${accountId}::uuid
  ) SELECT * FROM running
    WHERE (${month}='ALL' OR LEFT(entry_date,7)=${month})
    ORDER BY entry_date DESC,created_at DESC,id DESC LIMIT 10001`;
  if(items.length>10000)throw Error('More than 10,000 transactions in this view. Please select a month.');
  return items.map(r=>({id:r.id,accountId:r.account_id,date:r.entry_date,
    credit:two(r.credit),debit:two(r.debit),balance:two(r.balance),
    mode:r.transaction_mode||'',partyName:r.party_name||'',remarks:r.remarks||'',createdAt:r.created_at,updatedAt:r.updated_at}));
}
function infoToValidate(data={}){
  const holderName=cleanAccountText(data.holderName,120);
  const bankName=cleanAccountText(data.bankName,120);
  const accountNo=String(data.accountNo??'').trim().replace(/\s+/g,'');
  if(!holderName||!bankName||!/^[A-Za-z0-9-]{4,40}$/.test(accountNo))
    throw Error('Enter Account Holder Name, Bank Name and a valid Account No. (4–40 characters).');
  const openingBalance=moneyInput(data.openingBalance);
  return {holderName,bankName,accountNo,openingBalance};
}
async function xlsxDownload(sql,account,month){
  const rows=await ledger(sql,account.id,month);
  const book=new ExcelJS.Workbook();
  book.creator='Mayavi Cargo';
  const sh=book.addWorksheet('Account Ledger');
  sh.mergeCells('A1:G1');
  sh.getCell('A1').value='MAYAVI — ACCOUNT LEDGER';
  sh.getCell('A1').font={bold:true,size:16,color:{argb:'FF17365C'}};
  sh.addRow(['Account Holder',account.holderName,'Bank',account.bankName]);
  sh.addRow(['Account No.',account.accountNo,'Month',month==='ALL'?'All Months':month]);
  sh.addRow(['Opening Balance',account.openingBalance,'Current Balance',account.balance]);
  sh.addRow(['Date','Credit','Debit','Mode of Transaction','Balance','Party / Platform','Remarks']);
  sh.getRow(5).font={bold:true,color:{argb:'FFFFFFFF'}};
  sh.getRow(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF284F8B'}};
  const start=6;
  for(const entry of rows){
    const date=new Date(entry.date+'T00:00:00Z');
    sh.addRow([date,entry.credit||null,entry.debit||null,entry.mode||'',entry.balance,entry.partyName||'',entry.remarks]);
  }
  sh.getColumn(1).width=21;sh.getColumn(2).width=21;sh.getColumn(3).width=21;
  sh.getColumn(4).width=23;sh.getColumn(5).width=23;sh.getColumn(6).width=26;sh.getColumn(7).width=58;
  for(let rn=start;rn<=sh.rowCount;rn++){
    sh.getCell('A'+rn).numFmt='dd mmm yyyy';
    for(const letter of ['B','C','E'])sh.getCell(letter+rn).numFmt='#,##0.00;[Red](#,##0.00)';
  }
  sh.views=[{state:'frozen',ySplit:5}];
  if(rows.length)sh.autoFilter={from:{row:5,column:1},to:{row:sh.rowCount,column:7}};
  const bytes=await book.xlsx.writeBuffer();
  return new Response(Buffer.from(bytes),{headers:{
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':'attachment; filename="Mayavi_Account_'+account.id.slice(0,8)+'_'+month+'.xlsx"',
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
  }});
}
export async function GET(request){
  try{
    const sql=client(),auth=await verifyAdmin(request,sql);
    if(auth.error)return json({ok:false,error:auth.error},auth.status);
    await ensureTables(sql);
    const url=new URL(request.url),month=url.searchParams.get('month')||'ALL';
    if(!monthValid(month))return json({ok:false,error:'Invalid statement month.'},400);
    const all=await accounts(sql),requested=url.searchParams.get('accountId')||'';
    const account=all.find(a=>a.id===requested)||(requested?null:all[0])||null;
    if(requested&&!account)return json({ok:false,error:'Account not found.'},404);
    const download=url.searchParams.get('download')||'';
    if(download){
      if(download!=='excel')return json({ok:false,error:'Unsupported download type.'},400);
      if(!account)return json({ok:false,error:'Create an account first.'},404);
      return xlsxDownload(sql,account,month);
    }
    const [entries,months]=account?await Promise.all([
      ledger(sql,account.id,month),
      sql`SELECT DISTINCT TO_CHAR(entry_date,'YYYY-MM') AS month
        FROM mayavi_bank_entries WHERE account_id=${account.id}::uuid ORDER BY month DESC`
    ]):[[],[]];
    return json({ok:true,accounts:all,selectedAccount:account,entries,
      months:months.map(x=>x.month),month});
  }catch(e){console.error('bank_accounts_get',e?.message);
    return json({ok:false,error:'Unable to load Account ledger. '+(e?.message||'')},503);}
}
export async function POST(request){
  try{
    const sql=client(),auth=await verifyAdmin(request,sql);
    if(auth.error)return json({ok:false,error:auth.error},auth.status);
    await ensureTables(sql);
    const body=await request.json().catch(()=>({})),action=body.action;
    if(action==='create_account'){
      const a=infoToValidate(body);
      const exists=await sql`SELECT id FROM mayavi_bank_accounts WHERE
        lower(bank_name)=lower(${a.bankName}) AND account_number=${a.accountNo} LIMIT 1`;
      if(exists.length)return json({ok:false,error:'This bank account is already saved. Select it from the account list.'},409);
      const id=randomUUID();
      await sql`INSERT INTO mayavi_bank_accounts
        (id,holder_name,account_number,bank_name,opening_balance,created_by)
        VALUES (${id}::uuid,${a.holderName},${a.accountNo},${a.bankName},${a.openingBalance},${auth.session.username})`;
      return json({ok:true,accountId:id,message:'Account details saved.'},201);
    }
    if(action==='add_entry'){
      if(!idValid(body.accountId))return json({ok:false,error:'Select a saved account.'},400);
      const entry=readLedgerEntry(body);
      const account=await sql`SELECT id FROM mayavi_bank_accounts WHERE id=${body.accountId}::uuid LIMIT 1`;
      if(!account.length)return json({ok:false,error:'Account not found.'},404);
      const id=randomUUID();
      await sql`INSERT INTO mayavi_bank_entries
        (id,account_id,entry_date,credit,debit,transaction_mode,party_name,remarks,created_by)
        VALUES (${id}::uuid,${body.accountId}::uuid,${entry.date}::DATE,
          ${entry.credit},${entry.debit},${entry.mode},${entry.partyName},${entry.remarks},${auth.session.username})`;
      return json({ok:true,entryId:id,message:'Transaction saved.'},201);
    }
    return json({ok:false,error:'Unknown account operation.'},400);
  }catch(e){
    const invalid=/Enter|Fill|Select|valid|positive|decimal/i.test(String(e.message||''));
    return json({ok:false,error:e?.message||'Could not save Account data.'},invalid?400:503);
  }
}
export async function PATCH(request){
  try{
    const sql=client(),auth=await verifyAdmin(request,sql);
    if(auth.error)return json({ok:false,error:auth.error},auth.status);
    await ensureTables(sql);
    const body=await request.json().catch(()=>({}));
    if(body.action==='update_account'){
      if(!idValid(body.accountId))return json({ok:false,error:'Choose an account.'},400);
      const a=infoToValidate(body);
      const other=await sql`SELECT id FROM mayavi_bank_accounts
        WHERE id<>${body.accountId}::uuid AND lower(bank_name)=lower(${a.bankName})
        AND account_number=${a.accountNo} LIMIT 1`;
      if(other.length)return json({ok:false,error:'These bank details already belong to another account.'},409);
      const rows=await sql`UPDATE mayavi_bank_accounts
        SET holder_name=${a.holderName},account_number=${a.accountNo},
          bank_name=${a.bankName},opening_balance=${a.openingBalance},updated_at=NOW()
        WHERE id=${body.accountId}::uuid RETURNING id`;
      return rows.length?json({ok:true,message:'Account details updated.'}):json({ok:false,error:'Account not found.'},404);
    }
    if(body.action==='update_entry'){
      if(!idValid(body.entryId)||!idValid(body.accountId))return json({ok:false,error:'Select a valid transaction.'},400);
      const entry=readLedgerEntry(body);
      const rows=await sql`UPDATE mayavi_bank_entries
        SET entry_date=${entry.date}::DATE,credit=${entry.credit},debit=${entry.debit},
          transaction_mode=${entry.mode},party_name=${entry.partyName},remarks=${entry.remarks},updated_at=NOW()
        WHERE id=${body.entryId}::uuid AND account_id=${body.accountId}::uuid RETURNING id`;
      return rows.length?json({ok:true,message:'Transaction updated; running balances recalculated.'})
        :json({ok:false,error:'Transaction not found.'},404);
    }
    return json({ok:false,error:'Unknown update operation.'},400);
  }catch(e){
    const invalid=/Enter|Fill|Select|valid|positive|decimal/i.test(String(e.message||''));
    return json({ok:false,error:e.message||'Could not update data.'},invalid?400:503);
  }
}
export async function DELETE(request){
  try{
    const sql=client(),auth=await verifyAdmin(request,sql);
    if(auth.error)return json({ok:false,error:auth.error},auth.status);
    await ensureTables(sql);
    const url=new URL(request.url),entryId=url.searchParams.get('entryId'),
      accountId=url.searchParams.get('accountId');
    if(!idValid(entryId)||!idValid(accountId))return json({ok:false,error:'Invalid transaction.'},400);
    const rows=await sql`DELETE FROM mayavi_bank_entries WHERE id=${entryId}::uuid
      AND account_id=${accountId}::uuid RETURNING id`;
    return rows.length?json({ok:true,message:'Transaction deleted. Remaining balances recalculated.'})
      :json({ok:false,error:'Transaction not found.'},404);
  }catch(e){return json({ok:false,error:'Unable to delete transaction.'},503);}
}
