import assert from 'node:assert/strict';
import {amounts,allowedBranch,dateValid,decimal,DESTINATIONS,COMMODITIES,SERVICES,LOAD_STATUSES,EXTRA_COST_COMMODITIES,requiresExtraCost,requiresBottleCount,parseBottleCount,minimumJepoExtraCost,allocateExtraCost,totalJepoForLoad,totalBranchForLoad,jepoAmount,branchPayment,branchFromSavedAmounts,totalJepoPayment} from '../lib/branchLoads.js';
assert.equal(allowedBranch('jind'),'JIND');
assert.equal(allowedBranch('Karnal'),'KARNAL');
assert.equal(allowedBranch('sonu'),'');
assert.equal(dateValid('2026-10-26'),true);
assert.equal(dateValid('2026-02-30'),false);
assert.deepEqual(amounts('125.5','150','3500'),{amount:18825,balance:15325});
assert.deepEqual(amounts('10','100','1100'),{amount:1000,balance:-100});
assert.equal(amounts('0','100','0'),null);
assert.equal(decimal('-1'),null);
assert.equal(decimal('1.234',2),null);
assert.ok(DESTINATIONS.includes('UK')&&DESTINATIONS.includes('USA')&&DESTINATIONS.includes('Australia'));
assert.ok(COMMODITIES.includes('Protein')&&COMMODITIES.includes('Clothes'));
assert.deepEqual(EXTRA_COST_COMMODITIES,['Household and Medicine','Household and Ghee','Household and Electronics','Household and Hookah','Household and Nutrition']);
for(const commodity of EXTRA_COST_COMMODITIES){
  assert.ok(COMMODITIES.includes(commodity));
  assert.equal(requiresExtraCost(commodity),true);
}
assert.equal(requiresExtraCost('Household Goods'),false);
assert.equal(requiresBottleCount('Household and Ghee'),true);
assert.equal(requiresBottleCount('Household and Hookah'),false);
assert.equal(parseBottleCount('1'),1);
assert.equal(parseBottleCount('120'),120);
assert.equal(parseBottleCount('0'),null);
assert.equal(parseBottleCount('2.5'),null);
assert.equal(allocateExtraCost('Household and Ghee',1400,4).toJepo,1000);
assert.equal(allocateExtraCost('Household and Ghee',1400,4).toBranch,400);
assert.equal(allocateExtraCost('Household and Ghee',750,4),null);
assert.equal(allocateExtraCost('Household and Medicine',1400,null).toJepo,700);
assert.equal(allocateExtraCost('Household and Medicine',1400,null).toBranch,700);
assert.equal(minimumJepoExtraCost('Household and Medicine'),700);
assert.equal(minimumJepoExtraCost('Household and Nutrition'),150);
assert.deepEqual(allocateExtraCost('Household and Medicine',1000,null),{toJepo:700,toBranch:300});
assert.deepEqual(allocateExtraCost('Household and Nutrition',500,null),{toJepo:150,toBranch:350});
assert.equal(allocateExtraCost('Household and Medicine',699,null),null);
assert.equal(allocateExtraCost('Household and Nutrition',149,null),null);
assert.deepEqual(allocateExtraCost('Household and Medicine',699,null,{legacy:true}),{toJepo:699,toBranch:0});
assert.deepEqual(allocateExtraCost('Household and Nutrition',149,null,{legacy:true}),{toJepo:149,toBranch:0});
assert.equal(allocateExtraCost('Household and Electronics',1400,null).toBranch,1400);
assert.equal(allocateExtraCost('Household and Hookah',300,null).toJepo,0);
assert.equal(allocateExtraCost('Household and Nutrition',500,null).toJepo,150);
assert.equal(totalJepoForLoad(11685,'Household and Ghee',1400,4),12685);
assert.equal(totalBranchForLoad(12000,11685,'Household and Ghee',1400,4),715);
assert.equal(totalJepoForLoad(11685,'Household and Medicine',1400,null),12385);
assert.equal(totalBranchForLoad(12000,11685,'Household and Medicine',1400,null),1015);
assert.equal(totalJepoForLoad(11685,'Household and Nutrition',500,null),11835);
assert.equal(totalBranchForLoad(12000,11685,'Household and Nutrition',500,null),665);
assert.equal(totalBranchForLoad(12000,11685,'Household and Electronics',1400,null),1715);
assert.deepEqual(allocateExtraCost('Household and Ghee',900,null,{legacy:true}),{toJepo:900,toBranch:0});
assert.equal(requiresExtraCost('Medicine'),true);
assert.equal(requiresExtraCost('Nutrition'),true);
assert.equal(requiresExtraCost('Ghee'),true);
assert.equal(requiresExtraCost('Household and Electronics + other'),false);
assert.equal(decimal('120.25',2),120.25);
assert.equal(decimal('-10',2),null);
assert.equal(jepoAmount('15','779'),11685);
assert.equal(jepoAmount('47','546'),25662);
assert.equal(jepoAmount('18','527'),9486);
assert.equal(jepoAmount('8.5','360.25'),3062.13);
assert.equal(jepoAmount('8.5',''),null);
assert.equal(jepoAmount('0','500'),null);
assert.equal(jepoAmount('8.5','-1'),null);
assert.equal(branchFromSavedAmounts('12000','11685'),315);
assert.equal(branchFromSavedAmounts('29610','25662'),3948);
assert.equal(branchFromSavedAmounts('9486','9486'),0);
assert.equal(branchFromSavedAmounts('1000.01','999.99'),0.02);
assert.equal(branchFromSavedAmounts('9486','7074'),2412);
assert.equal(totalJepoPayment('11685.00','150.50'),11835.50);
assert.equal(totalJepoPayment('9486.00',''),9486);
assert.equal(totalJepoPayment('100.02','20.03'),120.05);
assert.equal(totalJepoPayment('100.00','-1'),null);
assert.equal(branchPayment('15','800','779'),315);
assert.equal(branchPayment('47','630','546'),3948);
assert.equal(branchPayment('18','527','527'),0);
assert.equal(branchPayment('10','100','110'),-100);
assert.equal(branchPayment('8.5','600','360.25'),2037.87);
assert.equal(branchPayment('0','500','100'),null);
assert.ok(SERVICES.includes('FedEx')&&SERVICES.includes('Aramex')&&SERVICES.includes('DHL')&&SERVICES.includes('Self'));
assert.deepEqual(LOAD_STATUSES,['AT_JIND_OFFICE','AT_KARNAL_OFFICE','AT_JEPO_OFFICE','DISPATCHED','IN_TRANSIT','DELIVERED']);
assert.ok(SERVICES.includes('TPL')&&SERVICES.includes('KCC'));
// Contract: branch workers see only their own records; Admin alone sees both.
// Checking the live route in prebuild protects against future cross-branch leaks.
import {readFileSync} from 'node:fs';
const route=readFileSync('app/api/branch-loads/route.js','utf8');
assert.ok(route.includes('WHERE branch=${auth.branch} ORDER BY record_date DESC'));
assert.ok(route.includes("const branch=auth.admin?allowedBranch(body.branch):auth.branch;"));
assert.ok(route.includes('WHERE id=${id} AND branch=${auth.branch} RETURNING id'));
// Delete is Admin-only across both Jind and Karnal. Even a forged employee
// HTTP DELETE request must receive 403 before a database DELETE can execute.
const deleteHandler=route.split('export async function DELETE(request)')[1]||'';
assert.ok(deleteHandler.includes("if(!auth.admin)return json({ok:false,error:'Only Admin can delete Jind / Karnal entries.'},403);"));
assert.ok(deleteHandler.indexOf("if(!auth.admin)return")<deleteHandler.indexOf("DELETE FROM mayavi_branch_loads"));
assert.ok(deleteHandler.includes('DELETE FROM mayavi_branch_loads WHERE id=${id} RETURNING id'));
assert.ok(!deleteHandler.includes('DELETE FROM mayavi_branch_loads WHERE id=${id} AND branch=${auth.branch} RETURNING id'));
assert.ok(route.includes('ADD COLUMN IF NOT EXISTS extra_cost NUMERIC(18,2) NOT NULL DEFAULT 0'));
assert.ok(route.includes('const extraCost=decimal(body.extraCost,2);'));
assert.ok(route.includes('extra_cost=${entry.extraCost}'));
assert.ok(route.includes('ADD COLUMN IF NOT EXISTS jepo_rate NUMERIC(15,4)'));
assert.ok(route.includes('const paidToJepo=jepoAmount(weight,body.jepoRate);'));
assert.ok(route.includes('jepo_rate=${entry.jepoRate},paid_to_jepo=${entry.paidToJepo}'));
assert.ok(!route.includes('decimal(body.paidToJepo'));
assert.ok(route.includes('const basePaidToBranch=branchPayment(weight,rate,body.jepoRate);'));
assert.ok(route.includes('paidToBranch:String(totalBranchForLoad(r.amount,r.paid_to_jepo,r.commodity,r.extra_cost,r.bottle_count,{legacy:true})??0)'));
assert.ok(!route.includes('decimal(body.paidToBranch'));
assert.ok(route.includes("if(body.statusOnly===true){"));
assert.ok(route.includes('UPDATE mayavi_branch_loads SET delivery_status=${status},updated_by=${auth.username},updated_at=NOW() WHERE id=${id} AND branch=${auth.branch} RETURNING id'));
const ui=readFileSync('app/BranchLoadsDashboard.js','utf8');
assert.ok(ui.includes('if(!isAdmin)return;'));
assert.ok(ui.includes("{isAdmin&&<button type=\"button\" aria-label={'Delete '+record.branch+' entry '"));
assert.ok(ui.includes('className={styles.quickDelete} disabled={busy} onClick={()=>remove(record)}>Delete</button>'));
assert.ok(!ui.includes('{isAdmin&&<button type="button" onClick={()=>remove(record)}'));
assert.ok(ui.includes('<button type="button" onClick={()=>edit(record)}'));
assert.ok(ui.includes('<th className={styles.extraCostHeader}>Extra Cost (₹)</th>'));
assert.ok(ui.includes('Extra Cost (INR)'));
assert.ok(ui.includes('aria-label="JEPO Rate per kg"'));
assert.ok(ui.includes('fmt(jepoPreview)'));
assert.ok(ui.includes('JEPO Rate (INR/kg)'));
assert.ok(!ui.includes('set(\'paidToJepo\''));
assert.ok(ui.includes('const branchPreview=branchBasePreview===null?null:totalBranchForLoad(preview?.amount,jepoPreview,draft.commodity,draft.extraCost,draft.bottleCount);'));
assert.ok(ui.includes('<BranchPaymentDisplay total={branchPreview} cash={branchCashPreview}/>'));
assert.ok(ui.includes('<JepoPaymentSplit total={totalJepoPreview} account={jepoPreview} cash={cashJepoPreview}/>'));
assert.ok(ui.includes('Total Amount Paid to JEPO (INR)'));
assert.ok(ui.includes('totals.totalJepo'));
assert.ok(ui.includes('totalJepoForLoad(record.paidToJepo,record.commodity,record.extraCost,record.bottleCount,{legacy:true})'));
assert.ok(ui.indexOf('key="totalPaidToJepo"')>ui.indexOf('key="extraCost"'));
assert.ok(ui.includes('statusOnly:true'));
assert.ok(!ui.includes('set(\'paidToBranch\''));
assert.ok(ui.includes('...(hasExtraCostColumn?[<td key="extraCost"'));

assert.ok(route.includes('bottle_count INTEGER'));
assert.ok(route.includes('bottle_count=${entry.bottleCount}'));
assert.ok(route.includes('const jepoExtraMinimum=minimumJepoExtraCost(commodity,bottleCount);'));
assert.ok(route.includes('extraCost<jepoExtraMinimum'));
assert.ok(ui.includes('aria-label="No. of Bottles"'));
assert.ok(ui.includes('totalJepoForLoad('));
assert.ok(ui.includes('totalBranchForLoad('));
assert.ok(COMMODITIES.includes('Household and Hookah')&&COMMODITIES.includes('Household and Nutrition'));
// Saving must always reach application-level validation. The native browser
// required validator previously blocked the wide, horizontally scrolled form.
assert.ok(ui.includes('<form noValidate onSubmit={save}>'));
assert.ok(ui.includes('aria-label="Save this load row"'));
assert.ok(ui.includes('<button type="button" onClick={save} disabled={busy} aria-label="Save this load row">'));
assert.ok(!ui.includes('Save Load</button>'));
assert.ok(!ui.includes('Save Edited Load</button>'));
assert.ok(ui.includes('Saving to Mayavi database…'));
assert.ok(ui.includes('Save nahi hua:'));
assert.ok(ui.includes('const [saveError,setSaveError]=useState(\'\');'));
assert.ok(ui.includes('function showSaveFailure(reason)'));
assert.ok(ui.includes('className={styles.inlineSaveError}'));
assert.ok(ui.includes('role="alert"'));
assert.ok(ui.includes("event?.preventDefault?.();"));
const stylesheet=readFileSync('app/BranchLoadsDashboard.module.css','utf8');
assert.ok(stylesheet.includes('.inlineSaveError'));
// A completed Save clears the form rather than leaving a sticky green saved
// banner in the empty next-entry row. The top status remains available.
assert.ok(!ui.includes('inlineSaveSuccess'));
assert.ok(!ui.includes('saveNotice'));

// Active register aggregates all undelivered entries across every date,
 // without any employee/admin date filter; the entry-date input remains.
assert.ok(ui.includes("r.status!=='DELIVERED'"));
assert.ok(ui.includes("const activeCount=useMemo(()=>rows.filter(r=>(filter==='ALL'||r.branch===filter)&&r.status!=='DELIVERED').length,[rows,filter]);"));
assert.ok(ui.includes("<th>Date</th>"));
assert.ok(ui.includes('aria-label="Date" required type="date"'));
assert.ok(ui.includes("sheet==='ACTIVE'?'No active loads yet."));
assert.ok(!ui.includes('Filter by date'));
assert.ok(!ui.includes('dayFilter'));
assert.ok(!ui.includes('Older entries are hidden by default'));
assert.ok(ui.includes('const writeRevision=useRef(0);'));
assert.ok(ui.includes('const latestRead=useRef(0);'));
assert.ok(ui.includes('const recordWrite=()=>{writeRevision.current+=1;latestRead.current+=1;};'));
assert.ok(ui.includes('recordWrite();'));
assert.ok(ui.includes("if(!current())return;"));
assert.ok(ui.includes("setSheet(saved.status==='DELIVERED'?'DELIVERED':'ACTIVE');"));
assert.ok(ui.includes("setDraft({...fresh(saved.branch),date:saved.date});"));
assert.ok(ui.includes('clientRequestId:saveRequestId'));
assert.ok(route.includes('ON CONFLICT (id) DO NOTHING'));
assert.ok(route.includes("const providedId=String(body.clientRequestId||'').trim();"));
assert.ok(route.includes('const saved=await one(sql,id);'));
// New optional confirmation fields must not block saving branch loads.
assert.ok(route.includes("ADD COLUMN IF NOT EXISTS amount_confirmation_no TEXT NOT NULL DEFAULT ''"));
assert.ok(route.includes("ADD COLUMN IF NOT EXISTS amount_confirmation_name TEXT NOT NULL DEFAULT ''"));
assert.ok(route.includes("ADD COLUMN IF NOT EXISTS amount_confirmation_approved_at TIMESTAMPTZ"));
assert.ok(route.includes("ADD COLUMN IF NOT EXISTS amount_confirmation_approved_by TEXT NOT NULL DEFAULT ''"));
assert.ok(route.includes('amount_confirmation_no=${entry.confirmationNo}'));
assert.ok(route.includes('amount_confirmation_name=${entry.confirmationName}'));
assert.ok(route.includes('amount_confirmation_approved_at=CASE WHEN'));
assert.ok(route.includes('amount_confirmation_approved_by=CASE WHEN'));
const approveHandler=route.split('if(body.approveConfirmation===true)')[1].split('if(body.statusOnly===true)')[0];
assert.ok(approveHandler.includes("if(!auth.admin)return json({ok:false,error:'Only Admin can decide transaction confirmations.'},403);"));
assert.ok(approveHandler.includes("if(!['YES','NO'].includes(decision))"));
assert.ok(approveHandler.includes("if(!['UTR','CASH'].includes(expectedMode)"));
assert.ok(approveHandler.includes('amount_confirmation_decision=${decision}'));
assert.ok(approveHandler.includes("COALESCE(amount_confirmation_decision,'PENDING')='PENDING'"));
assert.ok(approveHandler.includes("amount_confirmation_mode=${expectedMode}"));
assert.ok(approveHandler.indexOf('if(!auth.admin)return')<approveHandler.indexOf('SET amount_confirmation_decision=${decision}'));
assert.ok(approveHandler.includes('AND received=${expectedReceived}'));
assert.ok(approveHandler.includes('AND amount_confirmation_approved_at IS NULL'));
assert.ok(ui.includes('aria-label="Amount confirmation number"'));
assert.ok(!ui.includes('aria-label="Amount confirmation name"'));
assert.ok(ui.includes('aria-label="Payment confirmation mode"'));
assert.ok(ui.includes('<option value="CASH">Cash</option>'));
assert.ok(ui.includes('<option value="PENDING">Pending / Not available</option>'));
assert.ok(ui.includes('UTR optional. Cash / Pending also saves.'));
assert.ok(route.includes("const confirmationMode=['UTR','CASH','PENDING'].includes(requestedMode)"));
assert.ok(route.includes("confirmationNo:confirmationMode==='CASH'?'':confirmationNo"));
assert.ok(route.includes("ADD COLUMN IF NOT EXISTS amount_confirmation_mode TEXT NOT NULL DEFAULT 'PENDING'"));
assert.ok(route.includes("ADD COLUMN IF NOT EXISTS amount_confirmation_decision TEXT NOT NULL DEFAULT 'PENDING'"));
assert.ok(route.includes("ADD COLUMN IF NOT EXISTS amount_confirmation_decided_at TIMESTAMPTZ"));
assert.ok(route.includes("ADD COLUMN IF NOT EXISTS amount_confirmation_decided_by TEXT NOT NULL DEFAULT ''"));
assert.ok(route.includes("amount_confirmation_mode=${entry.confirmationMode}"));
assert.ok(!route.includes("if(!confirmationNo)return"));
assert.ok(!route.includes("if(!confirmationName)return"));
assert.ok(!ui.includes('pendingConfirmations.map(record=>'));
assert.ok(!ui.includes('className={styles.adminApprovals}'));
assert.ok(ui.includes('UTR / Cash • Admin Yes/No'));
assert.ok(ui.includes('key="confirmation"'));
assert.ok(ui.includes("onClick={()=>decideTransaction(record,'YES')}"));
assert.ok(ui.includes("onClick={()=>decideTransaction(record,'NO')}"));
assert.ok(ui.includes('styles.confirmPendingBlink'));
assert.ok(ui.includes("onClick={()=>decideTransaction(record,'YES')}"));
assert.ok(ui.includes("onClick={()=>decideTransaction(record,'NO')}"));
assert.ok(ui.includes('isAdmin&&awaitingAdminDecision(record)&&<div className={styles.adminDecisionButtons}>'));
assert.ok(ui.includes('className={styles.transactionInline}'));
assert.ok(ui.includes('className={styles.transactionDetails}'));
assert.ok(!ui.includes("approveTransaction(record)"));
assert.ok(ui.includes("const extraJepoMinimum=minimumJepoExtraCost(draft.commodity,draft.bottleCount);"));
assert.ok(ui.includes("extraJepoMinimum>0?'₹'+extraJepoMinimum+' to JEPO; remaining to Branch'"));

// The last JEPO column is a DISPLAY split, not a change to stored amounts:
// Total = Account (base weight × JEPO rate) + Cash (JEPO part of Extra Cost).
assert.ok(ui.includes('function JepoPaymentSplit({total,account,cash})'));
assert.ok(ui.includes('const cashJepoPreview=totalJepoPreview===null?null:jepoCashPart('));
assert.ok(ui.includes('account={jepoPreview} cash={cashJepoPreview}'));
assert.ok(ui.includes('account={Number(record.paidToJepo||0)}'));
assert.ok(ui.includes('cash={jepoCashPart(record.commodity,record.extraCost,record.bottleCount,{legacy:true})}'));
assert.ok(ui.includes('account={totals.paidToJepo} cash={totals.cashJepo}'));
assert.ok(ui.includes('cashJepo:t.cashJepo+Number(jepoCashPart('));
assert.ok(ui.includes('total={totalJepoForLoad(record.paidToJepo,record.commodity,record.extraCost,record.bottleCount,{legacy:true})}'));
assert.ok(ui.includes('total={totals.totalJepo}'));
// Cash displayed under Branch is the branch share of Extra Cost, not a second payment.
assert.ok(ui.includes("function BranchPaymentDisplay({total,cash})"));
assert.ok(ui.includes('<small className={styles.branchCashLabel}>Cash {fmt(cash)}</small>'));
assert.ok(ui.includes('cash={branchCashPart(record.commodity,record.extraCost,record.bottleCount,{legacy:true})}'));
assert.ok(ui.includes('cash={totals.cashBranch}'));
assert.ok(ui.includes('cashBranch:t.cashBranch+Number(branchCashPart('));
assert.equal(jepoAmount(10,500),5000);
assert.deepEqual(allocateExtraCost('Household and Ghee',700,2),{toJepo:500,toBranch:200});
assert.equal(totalJepoForLoad(5000,'Household and Ghee',700,2),5500);
assert.equal(totalBranchForLoad(12000,11685,'Household and Ghee',700,2),515);
assert.deepEqual(allocateExtraCost('Household and Medicine',1000,null),{toJepo:700,toBranch:300});
assert.equal(totalBranchForLoad(12000,11685,'Household and Medicine',1000,null),615);
assert.equal(allocateExtraCost('Household and Medicine',1000,null).toJepo,700);
assert.equal(totalJepoForLoad(5000,'Household and Medicine',1000,null),5700);
assert.equal(allocateExtraCost('Household and Medicine',1000,null).toBranch,300);
assert.equal(allocateExtraCost('Household and Nutrition',400,null).toJepo,150);
assert.equal(totalJepoForLoad(5000,'Household and Nutrition',400,null),5150);
assert.equal(allocateExtraCost('Household and Ghee',1100,4).toJepo,1000);
assert.equal(totalJepoForLoad(5000,'Household and Ghee',1100,4),6000);
assert.equal(allocateExtraCost('Household and Electronics',500,null).toJepo,0);
assert.equal(totalJepoForLoad(5000,'Household and Electronics',500,null),5000);
assert.equal(allocateExtraCost('Clothes',0,null).toJepo,0);
assert.equal(totalJepoForLoad(5000,'Clothes',0,null),5000);
// Every non-fixed commodity sends ALL Extra Cost to Branch, including "Other"
// and custom commodity labels. The entire entered cost is saved and exported.
assert.deepEqual(allocateExtraCost('Clothes',450,null),{toJepo:0,toBranch:450});
assert.deepEqual(allocateExtraCost('Other',275,null),{toJepo:0,toBranch:275});
assert.deepEqual(allocateExtraCost('Household and Electronics + other',330,null),{toJepo:0,toBranch:330});
assert.deepEqual(allocateExtraCost('Household and Hookah',1200,null),{toJepo:0,toBranch:1200});
assert.equal(totalJepoForLoad(5000,'Clothes',450,null),5000);
assert.equal(totalBranchForLoad(12000,11685,'Other',275,null),590);
assert.deepEqual(allocateExtraCost('Medicine',1000,null),{toJepo:700,toBranch:300});
assert.deepEqual(allocateExtraCost('Nutrition',500,null),{toJepo:150,toBranch:350});
assert.deepEqual(allocateExtraCost('Ghee',1400,4),{toJepo:1000,toBranch:400});
assert.equal(requiresBottleCount('Ghee'),true);
assert.ok(COMMODITIES.includes('Nutrition'));
assert.ok(ui.includes('const hasExtraCostColumn=true;'));
assert.ok(ui.includes('entryRow(true)'));
assert.ok(ui.includes('extraCost:t.extraCost+Number(r.extraCost||0)'));
assert.ok(ui.includes('r.extraCost||0'));
assert.ok(!ui.includes('Electronics / Hookah Extra Cost goes to JEPO.'));
assert.ok(route.includes('const extraCost=decimal(body.extraCost,2);'));

// Hookah / Electronics surcharge stays entirely with the branch in saved and
// on-screen calculations, while established JEPO fees are unchanged.
assert.ok(ui.includes("'Full Extra Cost to Branch'"));
assert.deepEqual(allocateExtraCost('Household and Electronics',500,null),{toJepo:0,toBranch:500});
assert.deepEqual(allocateExtraCost('Household and Hookah',300,null),{toJepo:0,toBranch:300});
assert.equal(totalBranchForLoad(12000,11685,'Household and Hookah',300,null),615);
assert.equal(totalJepoForLoad(5000,'Household and Hookah',300,null),5000);

// Remarks are optional, editable after Save and visible to employees only in
// their own branch. Preserve them in Active, Delivered and CSV exports.
assert.ok(route.includes("remarks TEXT NOT NULL DEFAULT ''"));
assert.ok(route.includes("ADD COLUMN IF NOT EXISTS remarks TEXT NOT NULL DEFAULT ''"));
assert.ok(route.includes('const remarks=textField(body.remarks,500);'));
assert.ok(route.includes('trackingNo,remarks,confirmationNo:'));
assert.ok(route.includes("remarks:r.remarks||''"));
assert.equal((route.match(/tracking_no,remarks,delivery_status/g)||[]).length,4);
assert.ok(route.includes('${entry.trackingNo},${entry.remarks},${entry.status}'));
assert.equal((route.match(/remarks=\$\{entry\.remarks\}/g)||[]).length,2);
assert.ok(ui.includes("remarks:''"));
assert.ok(ui.includes("remarks:row.remarks||''"));
assert.ok(ui.includes('aria-label="Remarks" rows={2} maxLength={500}'));
assert.ok(ui.includes('key="remarks" className={styles.remarksCell}'));
assert.ok(ui.includes("r.remarks||'',confirmationModeFor(r)"));
assert.ok(ui.includes("'Last Edited By','Remarks','Payment Mode'"));
assert.ok(ui.includes('<th>Remarks</th>'));
assert.ok(ui.includes('REMARKS_WIDTH'));
assert.ok(ui.includes('<td colSpan={10}>—</td>'));
assert.ok(stylesheet.includes('.remarksCell'));

// Reconcile the already-live direct row Save requirement as well.
assert.ok(ui.includes('onClick={save} disabled={busy} aria-label="Save this load row"'));
assert.ok(!ui.includes('<button type="submit" disabled={busy}>{busy?'));
// Daily Summary: all entries, including Delivered, grouped by booking date + branch.
import {aggregateDailyBranchLoads} from '../lib/branchDailySummary.js';
const dailySample=aggregateDailyBranchLoads([
  {branch:'KARNAL',date:'2026-10-26',weight:'19',paidToBranch:'450',status:'AT_KARNAL_OFFICE'},
  {branch:'KARNAL',date:'2026-10-26',weight:'8',paidToBranch:'225.50',status:'DELIVERED'},
  {branch:'KARNAL',date:'2026-10-26',weight:'13',paidToBranch:'374.50',status:'IN_TRANSIT'},
  {branch:'JIND',date:'2026-10-26',weight:'5',paidToBranch:'120',status:'DELIVERED'},
  {branch:'KARNAL',date:'2026-10-25',weight:'7.5',paidToBranch:'100.25',status:'DELIVERED'}
]);
assert.deepEqual(dailySample,[
 {branch:'JIND',date:'2026-10-26',loads:1,weight:5,branchAmount:120},
 {branch:'KARNAL',date:'2026-10-26',loads:3,weight:40,branchAmount:1050},
 {branch:'KARNAL',date:'2026-10-25',loads:1,weight:7.5,branchAmount:100.25}
]);
assert.equal(aggregateDailyBranchLoads(dailySample.filter(x=>x.branch==='JIND')).length,1);
assert.ok(ui.includes("onClick={()=>switchSheet('SUMMARY')}"));
assert.ok(ui.includes("sheet==='SUMMARY'||"));
assert.ok(ui.includes("dailySummary.map(r=><tr key={r.branch+'|'+r.date}"));
assert.ok(ui.includes("sheet==='SUMMARY'&&<section"));
assert.ok(ui.includes("sheet!=='SUMMARY'&&<div className={styles.scroller}"));
assert.ok(ui.includes("if(sheet==='SUMMARY'){"));
assert.ok(ui.includes("Daily Summary"));
assert.ok(ui.includes("Total Branch Amount (₹)"));
assert.ok(ui.includes("Daily summary branch filter"));
assert.ok(ui.includes("sheet==='ACTIVE'&&editing==='new'"));
assert.ok(ui.includes("Delivered Sheet ({deliveredCount})"));
console.log('Jind/Karnal daily loads, Daily Summary and branch data isolation checks passed.');
