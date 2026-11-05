import {neon} from '@neondatabase/serverless';
import {readSession} from '../../../../lib/mayaviAuth.js';
import {summarizeAccountEntries} from '../../../../lib/accountSummary.js';
import {createAccountSummaryPdf} from '../../../../lib/accountSummaryPdf.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const respond=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const validId=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
const validMonth=v=>v==='ALL'||/^(20\d{2})-(0[1-9]|1[0-2])$/.test(String(v||''));
function db(){
  const url=process.env.DATABASE_URL||process.env.POSTGRES_URL||
    process.env.NEON_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||'';
  if(!url)throw Error('Shared Mayavi database is not configured.');
  return neon(url);
}
async function admin(request,sql){
  const session=readSession(request);
  if(!session)return {error:'Log in to Mayavi first.',status:401};
  if(session.role!=='admin')return {error:'Only Admin can view Account summaries.',status:403};
  const rows=await sql`SELECT role,is_active FROM mayavi_users WHERE lower(username)=${session.username} LIMIT 1`;
  if(rows[0]?.role!=='admin'||!rows[0]?.is_active)return {error:'Admin login is inactive.',status:403};
  return {session};
}
export async function GET(request){
  try{
    const sql=db(),auth=await admin(request,sql);
    if(auth.error)return respond({ok:false,error:auth.error},auth.status);
    const url=new URL(request.url),month=url.searchParams.get('month')||'ALL',
      accountId=url.searchParams.get('accountId')||'ALL',party=url.searchParams.get('party')||'ALL',
      download=url.searchParams.get('download')||'';
    if(!validMonth(month))return respond({ok:false,error:'Invalid report month.'},400);
    if(accountId!=='ALL'&&!validId(accountId))return respond({ok:false,error:'Invalid bank account.'},400);
    if(party.length>120)return respond({ok:false,error:'Invalid party filter.'},400);
    if(download&&download!=='pdf')return respond({ok:false,error:'Unsupported report format.'},400);
    const selectedId=accountId==='ALL'?null:accountId;
    const accounts=await sql`SELECT id,holder_name,bank_name,account_number
      FROM mayavi_bank_accounts ORDER BY created_at ASC,id ASC`;
    const account=accounts.find(a=>a.id===selectedId);
    if(selectedId&&!account)return respond({ok:false,error:'Bank account not found.'},404);
    const records=await sql`SELECT e.id,e.account_id,e.entry_date::TEXT AS date,
      e.credit,e.debit,e.transaction_mode AS mode,e.remarks,e.party_name,
      e.created_at,a.bank_name,a.account_number,a.holder_name
      FROM mayavi_bank_entries e JOIN mayavi_bank_accounts a ON a.id=e.account_id
      WHERE (${selectedId}::uuid IS NULL OR e.account_id=${selectedId}::uuid)
      ORDER BY e.entry_date DESC,e.created_at DESC,e.id DESC LIMIT 25001`;
    if(records.length>25000)return respond({ok:false,error:'More than 25,000 bank transactions. Select one bank account for a complete month-wise report.'},422);
    const rows=records.map(r=>({
      id:r.id,accountId:r.account_id,date:r.date,credit:Number(r.credit)||0,
      debit:Number(r.debit)||0,mode:r.mode||'',remarks:r.remarks||'',partyName:r.party_name||'',
      createdAt:r.created_at,bankName:r.bank_name,accountNo:r.account_number,
      holderName:r.holder_name
    }));
    // Monthly totals always span all saved months for the chosen bank account.
    // The month dropdown filters only the detailed party statement below.
    const allReport=summarizeAccountEntries(rows);
    const report=month==='ALL'?allReport:summarizeAccountEntries(rows.filter(r=>r.date.startsWith(month)));
    const monthly=allReport.monthly;
    if(party!=='ALL'&&!report.groups.some(g=>g.party===party))
      return respond({ok:false,error:'Party not found in this statement.'},400);
    const visible=party==='ALL'?report.entries:report.entries.filter(e=>e.party===party);
    const months=monthly.map(r=>r.month);
    const accountName=account?account.holder_name+' - '+account.bank_name+' ('+account.account_number+')':'All bank accounts';
    if(download==='pdf'){
      const pdf=createAccountSummaryPdf({...report,monthly,account:accountName,month,party});
      const safeParty=party==='ALL'?'ALL':party.replace(/[^a-zA-Z0-9]/g,'_').slice(0,40);
      return new Response(pdf,{headers:{
        'Content-Type':'application/pdf',
        'Content-Disposition':'attachment; filename="Mayavi_Summary_of_Accounts_'+month+'_'+safeParty+'.pdf"',
        'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
      }});
    }
    return respond({ok:true,groups:report.groups,totals:report.totals,entries:visible,
      monthly,countVisible:visible.length,months,month,party,accountId});
  }catch(error){
    console.error('account_summary_get',error?.message);
    return respond({ok:false,error:'Unable to load Summary of Accounts. '+(error?.message||'')},503);
  }
}
