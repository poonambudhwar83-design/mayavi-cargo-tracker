'use client';
import {useMemo} from 'react';
import {speedPostProfitTotals,speedPostDailySummary} from '../lib/speedpostMonthlyProfit.js';
import {speedPostEntryDay} from '../lib/speedpostCostReports.js';
const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2});
const format=value=>value===null||value===undefined?'—':money.format(value);
const th={padding:'9px 8px',fontSize:11,color:'#1c3757',textAlign:'left',background:'#eaf1fd',whiteSpace:'nowrap',position:'sticky',top:0,zIndex:1,borderBottom:'1px solid #cbd8e8'};
const td={padding:'9px 8px',fontSize:12,borderBottom:'1px solid #e4ecf5',whiteSpace:'nowrap'};
const card={border:'1px solid #dce5f1',borderRadius:12,padding:15,background:'#fff'};
export default function SpeedPostMonthlyProfit({rows=[],entryMonths=[],month='',onSelectMonth,loading=false,historyIncomplete=false}){
  const report=useMemo(()=>speedPostProfitTotals(rows),[rows]);
  const dailyReport=useMemo(()=>speedPostDailySummary(rows),[rows]);
  const t=report.totals;
  const fields=[['TOTAL ENTRIES',t.packets],['CALCULATED',t.complete],
    ['AMOUNT RECEIVED',format(t.amountReceived)],['CONSULTING COST',format(t.consultingCost)],
    ['PACKING + TRANSPORT',format(t.packingTransport)],['NET PROFIT',format(t.profit)]];
  return <section aria-label="Speed Post Monthly Profit & Costing" style={{...card,marginBottom:12}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:12}}>
      <div><h2 style={{margin:'0 0 4px',fontSize:18,color:'#173f91'}}>EMS • Monthly Profit & Costing</h2>
        <p style={{margin:0,color:'#64748b',fontSize:12}}>Monthly reporting follows original Mayavi entry dates, including Delivered packets.</p></div>
      <label style={{fontWeight:800,fontSize:12,color:'#173f91'}}>ENTRY MONTH
        <select aria-label="Select monthly profit entry month" value={month} onChange={e=>onSelectMonth(e.target.value)}
          style={{display:'block',padding:'8px 11px',marginTop:5,borderRadius:8,border:'1px solid #bdcdea',minWidth:185,background:'#fff',color:'#183153'}}>
          {entryMonths.length?entryMonths.map(([value,items])=>
            <option value={value} key={value}>{value==='UNKNOWN'?'Date unavailable':value} • {items.length} entries</option>
          ):<option value="">No entries yet</option>}
        </select>
      </label>
    </div>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:13}}>
      <div style={{padding:'9px 12px',background:'#eef5ff',borderRadius:9,fontSize:12}}>
        <strong>UK</strong> • Up to 5 kg: ₹1,050/kg • Above 5 kg: ₹950/kg
      </div>
      <div style={{padding:'9px 12px',background:'#f0fdf4',borderRadius:9,fontSize:12}}>
        <strong>USA</strong> • Up to 5 kg: ₹1,300/kg • Above 5 kg: ₹1,200/kg
      </div>
    </div>
    <p style={{margin:'0 0 13px',color:'#566c82',fontSize:12}}>
      Rounded Weight = next full kg. Total Cost = Tariff + Cash Cost (₹150 × Rounded kg).
      Cost/kg = Total Cost ÷ Rounded kg. Consulting Cost = Cost/kg × Rounded kg.
      Packing & Transportation = ₹10 × Rounded kg. Profit = Amount Received − Consulting Cost − Packing & Transportation.
    </p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:9,marginBottom:15}}>
      {fields.map(([name,value])=><div key={name} style={{padding:12,background:name==='NET PROFIT'?'#eaf8ef':'#f3f7ff',borderRadius:9,border:'1px solid #e0e9f5'}}>
        <small style={{display:'block',fontWeight:850,color:'#536882'}}>{name}</small>
        <strong style={{display:'block',marginTop:5,fontSize:18,color:name==='NET PROFIT'&&t.profit<0?'#b91c1c':name==='NET PROFIT'?'#167144':'#193f80'}}>{value}</strong>
      </div>)}
    </div>
    <section aria-label="EMS daily financial summary" style={{border:'1px solid #cbd9eb',borderRadius:11,background:'#f9fbff',padding:12,marginBottom:15}}>
      <h3 style={{fontSize:16,color:'#173f91',margin:'0 0 5px'}}>DAILY SUMMARY • {month||'Entry month not available'}</h3>
      <p style={{fontSize:12,color:'#536a85',margin:'0 0 11px'}}>
        Each date shows how many ED packets were first entered, their total weights, Tariff + Cash Cost,
        and profit calculated from the UK/USA selling rates. Delivered packets stay on their original entry date.
      </p>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',minWidth:1100,borderCollapse:'separate',borderSpacing:0}}>
          <thead><tr>{['Entry Date','No. of Packets','Actual Weight (kg)','Rounded Weight (kg)',
            'Total Tariff (₹)','Total Cash Cost (₹)','Total Amount (₹)','Daily Profit (₹)','Profit Pending'].map(label=>
            <th key={label} style={{...th,position:'static'}}>{label}</th>)}</tr></thead>
          <tbody>{dailyReport.daily.length?dailyReport.daily.map(day=>
            <tr key={day.date}>
              <td style={{...td,fontWeight:750}}>{day.date==='UNKNOWN'?'Entry date unknown':day.date}</td>
              <td style={td}>{day.packets}</td>
              <td style={td}>{day.actualWeightKg.toLocaleString('en-IN',{maximumFractionDigits:4})}</td>
              <td style={td}>{day.roundedWeightKg.toLocaleString('en-IN')}</td>
              <td style={td}>{format(day.tariff)}</td>
              <td style={td}>{format(day.cashCost)}</td>
              <td style={{...td,fontWeight:800}}>{format(day.totalAmount)}</td>
              <td style={{...td,fontWeight:900,color:day.profit<0?'#b91c1c':'#167144'}}>{day.profitablePackets?format(day.profit):'—'}</td>
              <td style={{...td,color:day.pendingProfit?'#a16207':'#166534',fontWeight:700}}>{day.pendingProfit}</td>
            </tr>):<tr><td colSpan={9} style={{...td,textAlign:'center',padding:18,color:'#64748b'}}>No packets booked in this month.</td></tr>}</tbody>
          <tfoot><tr style={{background:'#e9f4ee',fontWeight:900}}>
            <td style={td}>MONTH TOTAL</td>
            <td style={td}>{dailyReport.month.packets}</td>
            <td style={td}>{dailyReport.month.actualWeightKg.toLocaleString('en-IN',{maximumFractionDigits:4})}</td>
            <td style={td}>{dailyReport.month.roundedWeightKg.toLocaleString('en-IN')}</td>
            <td style={td}>{format(dailyReport.month.tariff)}</td>
            <td style={td}>{format(dailyReport.month.cashCost)}</td>
            <td style={td}>{format(dailyReport.month.totalAmount)}</td>
            <td style={{...td,color:dailyReport.month.profit<0?'#b91c1c':'#166534'}}>
              {dailyReport.month.profitablePackets?format(dailyReport.month.profit):'—'}
            </td>
            <td style={td}>{dailyReport.month.pendingProfit}</td>
          </tr></tfoot>
        </table>
      </div>
      <p style={{fontSize:11,color:'#64748b',margin:'10px 0 0'}}>
        Total Amount = available Tariff Total + available Cash Cost Total. Missing Tariff or Cash values are not treated as confirmed zero.
        Daily Profit includes only fully costed parcels with a configured selling rate; Profit Pending shows excluded packets.
        Actual and rounded weights are shown separately to avoid mixing parcel weight with billing weight.
      </p>
    </section>
    {historyIncomplete&&<p role="alert" style={{color:'#9a3412',fontWeight:800,fontSize:12}}>Only the latest 5,000 EMS entries are loaded; displayed financial totals are not a full historical ledger.</p>}
    {t.missing>0&&<p style={{background:'#fff8e7',color:'#8a4c06',padding:10,borderRadius:8,fontSize:12,fontWeight:750}}>
      {t.missing} of {t.packets} entries are missing a weight, tariff or configured selling rate.
      They remain visible but are excluded from Amount Received and Net Profit totals.
      Destinations other than UK/USA need a confirmed selling rate.
    </p>}
    <div style={{overflowX:'auto',maxHeight:'68vh',overflowY:'auto'}}>
      <table style={{width:'100%',minWidth:1620,borderCollapse:'separate',borderSpacing:0}}>
        <thead><tr>{['S.No.','ED No.','Entry Date','Consignee','Destination','Actual Weight','Rounded Weight (kg)',
          'Tariff (₹)','Cash Cost (₹)','Total Cost (₹)','Cost / kg (₹)','Selling Rate / kg (₹)',
          'Amount Received (₹)','Consulting Cost (₹)','Packing + Transport (₹)','Profit (₹)'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead>
        <tbody>{report.rows.length?report.rows.map((row,i)=>
          <tr key={row.trackingNo||i} style={{background:i%2?'#f8faff':'#fff'}}>
            <td style={td}>{i+1}</td>
            <td style={{...td,fontWeight:800}}>{row.trackingNo||'—'}</td>
            <td style={td}>{speedPostEntryDay(row)==='UNKNOWN'?'—':speedPostEntryDay(row)}</td>
            <td style={td}>{row.consigneeName||'—'}</td>
            <td style={td}>{row.country}</td>
            <td style={td}>{row.weight||'—'}</td>
            <td style={td}>{row.roundedWeight===null?'—':row.roundedWeight}</td>
            <td style={td}>{format(row.tariff)}</td>
            <td style={td}>{format(row.cashCost)}</td>
            <td style={td}>{format(row.totalCost)}</td>
            <td style={td}>{row.costPerKg===null?'—':format(row.costPerKg)}</td>
            <td style={td}>{row.rate===null?'—':format(row.rate)}</td>
            <td style={{...td,fontWeight:800}}>{format(row.amountReceived)}</td>
            <td style={td}>{format(row.consultingCost)}</td>
            <td style={td}>{format(row.packingTransport)}</td>
            <td title={row.missing||undefined} style={{...td,color:row.profit===null?'#a16207':row.profit<0?'#b91c1c':'#15803d',fontWeight:900}}>
              {row.profit===null?row.missing:format(row.profit)}
            </td>
          </tr>):<tr><td colSpan={16} style={{...td,textAlign:'center',padding:25,color:'#64748b'}}>
            {loading?'Loading saved EMS records…':'No EMS entries for this month.'}
          </td></tr>}</tbody>
        <tfoot><tr style={{background:'#e9f4ee',fontWeight:900}}>
          <td colSpan={6} style={td}>MONTH TOTAL • {t.complete}/{t.packets} costed packets</td>
          <td style={td}>{t.roundedWeight}</td><td colSpan={5} style={td}></td>
          <td style={td}>{format(t.amountReceived)}</td><td style={td}>{format(t.consultingCost)}</td>
          <td style={td}>{format(t.packingTransport)}</td><td style={{...td,color:t.profit<0?'#b91c1c':'#166534'}}>{format(t.profit)}</td>
        </tr></tfoot>
      </table>
    </div>
  </section>;
}
