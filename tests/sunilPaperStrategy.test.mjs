import test from 'node:test';
import assert from 'node:assert/strict';
import {completedBars,levels,riskFilter,scanSunil,createExitComparison,observeExitComparison,comparisonReport} from '../lib/sunilPaperStrategy.mjs';
const date='2026-11-27',prev='2026-11-26',start=d=>Date.parse(d+'T09:15:00+05:30'),t=start(date),now=t+8*300000+10000;
const bar=(d,i,o,h,l,c)=>[new Date(start(d)+i*300000).toISOString(),o,h,l,c,100];
const prior=(o,h,l,c)=>Array.from({length:75},(_,i)=>bar(prev,i,o,h,l,c));
const index=[...prior(48050,48100,47950,48050),...Array.from({length:8},(_,i)=>bar(date,i,48200+i*10,48230+i*10,48190+i*10,48210+i*10))];
const ce=[...prior(150,220,95,150),bar(date,0,100,120,95,115),bar(date,1,115,180,114,170),...Array.from({length:5},(_,i)=>bar(date,i+2,118,123,113,119)),bar(date,7,119,132,118,130)];
const pe=[...prior(200,250,100,200),...Array.from({length:8},(_,i)=>bar(date,i,250-i*10,255-i*10,235-i*10,240-i*10))];
const input={date,now,indexRows:index,ceRows:ce,peRows:pe,quotes:{CE:{bid:130,ask:131,time:now-1000},PE:{bid:169,ask:170,time:now-1000}},aligned:true,contractVerified:true};
test('opening bar and previous levels require complete candles',()=>{
 assert.equal(completedBars(index,date,t+299999).length,0);
 const l=levels(index,date,now);assert.equal(l.firstHigh,48230);assert.equal(l.previousClose,48050);
 assert.equal(levels(index.filter(b=>Date.parse(b[0])!==t+300000),date,now),null);
});
test('flat gap and round level are conservative filters',()=>{
 const l=levels(index,date,now);assert.equal(riskFilter(l).status,'RESEARCH');
 assert.equal(riskFilter({...l,open:l.previousClose}).status,'NO_TRADE');
});
test('candidate is causal, with already formed targets',()=>{
 const x=scanSunil(input);assert.equal(x.status,'PAPER_CANDIDATE');assert.equal(x.side,'CE');assert.equal(x.entry,131);assert.equal(x.target1,180);assert.equal(x.target2,220);
 assert.equal(scanSunil({...input,aligned:false}).status,'WAIT');
 assert.equal(scanSunil({...input,quotes:{CE:{bid:130,ask:131,time:now-31000}}}).status,'WAIT');
 assert.equal(scanSunil({...input,ceRows:ce.slice(0,-1)}).status,'WAIT');
});
test('fixed, partial, CTC and original-stop outcomes stay independent',()=>{
 const s=createExitComparison({entry:100,stop:80,target1:140,target2:180,lots:2,lotSize:10,at:1000});
 const a=observeExitComparison(s,{bid:140,at:2000}),b=observeExitComparison(a,{bid:100,at:3000});
 const result=Object.fromEntries(comparisonReport(b).map(x=>[x.method,x]));
 assert.equal(result.FIXED.gross,800);assert.equal(result.HALF_CTC.gross,400);assert.equal(result.FULL_CTC.gross,0);assert.equal(result.ORIGINAL_SL.remainingLots,2);
 assert.equal(observeExitComparison(b,{bid:120,at:2500}),b);
});
test('single lot cannot be split; extended trailing is independent',()=>{
 const s=createExitComparison({entry:100,stop:80,target1:140,target2:250,lots:1,lotSize:10,at:1000});
 assert.ok(!s.methods.some(m=>m.id==='HALF_CTC'));
 const a=observeExitComparison(s,{bid:200,at:2000});assert.equal(a.methods.find(m=>m.id==='TRAIL_100_60').stop,160);
 const b=observeExitComparison(a,{bid:160,at:3000});assert.equal(comparisonReport(b).find(m=>m.method==='TRAIL_100_60').gross,600);
});
