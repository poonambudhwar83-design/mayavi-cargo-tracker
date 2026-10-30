// Bank reconciliation for original EMS entry dates. Blank is NOT zero.
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
export function speedPostBankDifference(combined,bankPaid){
  if(bankPaid===null||bankPaid===undefined||bankPaid===''||
     !Number.isFinite(Number(bankPaid))||Number(bankPaid)<0)return null;
  if(!Number.isFinite(Number(combined)))return null;
  return round(Number(combined)-Number(bankPaid));
}
export function speedPostBankMonthTotals(dayCosts=[],paidByDay={}){
  let paid=0,combined=0,bankDays=0;
  for(const {day,combined:dayCombined} of dayCosts){
    combined=round(combined+Number(dayCombined||0));
    const amount=paidByDay?.[day];
    if(speedPostBankDifference(dayCombined,amount)===null)continue;
    paid=round(paid+Number(amount));
    bankDays++;
  }
  return {bankPaid:paid,combinedTotal:combined,bankDays,days:dayCosts.length,
    pendingDays:dayCosts.length-bankDays,
    difference:dayCosts.length>0&&bankDays===dayCosts.length
      ?speedPostBankDifference(combined,paid):null};
}
