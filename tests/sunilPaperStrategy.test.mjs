import test from 'node:test';
import assert from 'node:assert/strict';
import {completedBars,levels,riskFilter,openingDirection,scanMorningPriceAction,stallExit,indexLevelBreakout,secondOppositeResearch,secondHoldVariant,strikeUniverse,compareStrikeSpeed,selectSunilSetup,scanSunil,createExitComparison,observeExitComparison,comparisonReport} from '../lib/sunilPaperStrategy.mjs';
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

test('first high-break side stays fixed and later low break locks session',()=>{
 const l=levels(ce,date,now),p=levels(pe,date,now);
 assert.equal(openingDirection(l,p).side,'CE');
 const bad={...l,bars:l.bars.map((b,i)=>i===5?[b[0],118,123,94,119,100]:b)};
 assert.equal(openingDirection(bad,p).status,'NO_TRADE');
 const recovered={...bad,bars:[...bad.bars,bar(date,8,130,150,125,145)]};
 const pnext={...p,bars:[...p.bars,bar(date,8,170,180,160,165)]};
 assert.equal(openingDirection(recovered,pnext).status,'NO_TRADE');
});
test('ambiguous simultaneous high break locks conservatively',()=>{
 const l=levels(ce,date,now),p=levels(pe,date,now);
 const both={...p,bars:p.bars.map((b,i)=>i===1?[b[0],240,260,230,245,100]:b)};
 assert.equal(openingDirection(l,both).ambiguous,true);
});
test('opening 40/80 is distinct from second setup and uses premium points',()=>{
 const twoNow=t+600000+1000;
 const a=[...prior(150,220,95,150),bar(date,0,100,120,95,115),bar(date,1,115,128,110,125)];
 const x=scanSunil({...input,now:twoNow,ceRows:a,quotes:{CE:{bid:125,ask:126,time:twoNow-500}}});
 assert.equal(x.status,'PAPER_CANDIDATE');assert.equal(x.opening40_80.trigger,'FIRST_HIGH_BREAK');
 assert.equal(x.opening40_80.stop,86);assert.equal(x.opening40_80.target,206);
});

test('morning previous close breakdown uses completed minute candles and index units',()=>{
 const m=(i,o,h,l,c)=>[new Date(t+i*60000).toISOString(),o,h,l,c,100];
 const minuteRows=[m(0,48100,48120,48090,48110),m(1,48110,48115,48085,48090),m(2,48090,48100,48070,48075),m(3,48075,48080,48048,48055),m(4,48055,48065,48048,48052),m(5,48052,48060,48044,48049),m(6,48049,48052,48035,48039),m(7,48039,48043,48015,48020)];
 const five=[...prior(48050,48100,47950,48050),bar(date,0,48100,48120,48048,48052)];
 const args={date,now:t+8*60000+1000,indexRows:five,indexMinuteRows:minuteRows};
 const result=scanMorningPriceAction(args);
 assert.equal(result.status,'INDEX_PATTERN');assert.equal(result.pattern,'PREVIOUS_CLOSE_BREAKDOWN');assert.equal(result.units,'INDEX_POINTS');assert.equal(result.spotStop,48060);assert.equal(result.spotTargets[0],47950);
 assert.equal(scanMorningPriceAction({...args,indexMinuteRows:minuteRows.filter((_,i)=>i!==2)}).status,'WAIT');
 assert.equal(scanMorningPriceAction({...args,now:Date.parse(date+'T11:30:00+05:30')}).status,'WAIT');
 assert.equal(scanMorningPriceAction({...args,now:t+7*60000+1000}).status,'WAIT');
});

test('three failed highs produce early exit research and a fresh high resets count',()=>{
 const a=[bar(date,0,100,120,95,115),bar(date,1,115,119,110,116),bar(date,2,116,120,112,115),bar(date,3,115,118,110,114)];
 const args={rows:a,date,now:t+4*300000+1000,entryAt:t};
 assert.equal(stallExit(args).status,'EARLY_EXIT_RESEARCH');
 assert.equal(stallExit({...args,now:t+3*300000+1000}).failedBars,2);
 assert.equal(stallExit({...args,rows:[...a,bar(date,4,114,125,113,124)],now:t+5*300000+1000}).failedBars,0);
 assert.equal(stallExit({...args,rows:a.filter((_,i)=>i!==1)}).status,'WAIT');
});
test('index breakout needs a known level base and opposite premium confirmation',()=>{
 const a=[...prior(48150,48230,48000,48150),bar(date,0,48200,48230,48190,48210),bar(date,1,48210,48228,48200,48220),bar(date,2,48220,48230,48205,48224),bar(date,3,48224,48229,48200,48220),bar(date,4,48220,48265,48215,48260)];
 const now5=t+5*300000+1000;
 const ce5=[...prior(100,140,90,110),...Array.from({length:5},(_,i)=>bar(date,i,100+i*5,112+i*5,95+i*5,110+i*5))];
 const pe5=[...prior(200,250,100,200),...Array.from({length:5},(_,i)=>bar(date,i,200-i*5,205-i*5,185-i*5,190-i*5))];
 const args={date,now:now5,indexRows:a,ceRows:ce5,peRows:pe5};
 assert.equal(indexLevelBreakout(args).status,'INDEX_PREMIUM_PATTERN');
 assert.equal(indexLevelBreakout({...args,ceRows:pe5}).status,'WAIT');
 assert.equal(indexLevelBreakout({...args,indexRows:a.map((b,i)=>i===77?[b[0],48220,48230,48100,48224,100]:b)}).status,'WAIT');
});

test('second opposite research is separate from strict same-day no-trade lock',()=>{
 const lead=[...prior(150,220,90,150),bar(date,0,100,120,95,115),bar(date,1,115,180,110,170),...Array.from({length:5},(_,i)=>bar(date,i+2,98,102,95,99)),bar(date,7,99,100,88,90)];
 const other=[...pe.slice(0,-1),bar(date,7,180,210,178,205)];
 const ix=[...index.slice(0,-1),bar(date,7,48270,48275,48230,48240)];
 const args={date,now,indexRows:ix,ceRows:lead,peRows:other};
 const x=secondOppositeResearch(args);assert.equal(x.status,'OPPOSITE_WATCH');assert.equal(x.side,'PE');
 assert.equal(scanSunil({...args,aligned:true,contractVerified:true}).status,'NO_TRADE');
 assert.equal(secondOppositeResearch({...args,peRows:pe}).status,'WAIT');
});
test('six candle hold watch requires consolidation and completed breakout',()=>{
 const rows=[...prior(150,220,95,150),bar(date,0,100,120,95,115),bar(date,1,115,180,110,170),...Array.from({length:6},(_,i)=>bar(date,i+2,119,123,115,120)),bar(date,8,120,133,119,130)];
 const x=secondHoldVariant({date,now:t+9*300000+1000,rows});assert.equal(x.status,'HOLD_BREAKOUT_WATCH');assert.equal(x.baseBars,6);assert.equal(x.target1,180);
 assert.equal(secondHoldVariant({date,now:t+8*300000+1000,rows}).status,'WAIT');
});

test('strike speed ranks ATM and ITM, excludes OTM, waits on stale quote',()=>{
 const strikes=[52300,52400,52500,52600,52700],spot=52500;
 assert.equal(strikeUniverse(spot,strikes,'CE')[1].strike,52400);
 assert.equal(strikeUniverse(spot,strikes,'PE')[1].strike,52600);
 const tm=t+4*300000+1000;
 const candidates=[{strike:52500,side:'CE',rows:Array.from({length:4},(_,i)=>bar(date,i,100+i*5,110+i*5,95+i*5,105+i*5)),quote:{bid:119,ask:120,time:tm-1000}},{strike:52400,side:'CE',rows:Array.from({length:4},(_,i)=>bar(date,i,200+i*10,215+i*10,195+i*10,210+i*10)),quote:{bid:239,ask:240,time:tm-1000}},{strike:52600,side:'CE',rows:[],quote:null}];
 const args={date,now:tm,spot,side:'CE',strikes,candidates};
 assert.equal(compareStrikeSpeed(args).preferred.strike,52400);
 assert.equal(compareStrikeSpeed({...args,now:tm+31000}).status,'WAIT');
});
test('selector uses morning price action only in morning and does not invent premium plans',()=>{
 const scan={status:'WAIT',risk:{status:'RESEARCH'},directionLock:{status:'DIRECTION_LOCKED',side:'PE'},confirmedSide:'PE'};
 const selected=ce,rank={status:'STRIKE_SPEED_WATCH',side:'PE',preferred:{type:'ATM',strike:48300,ask:131,bid:130,speed:1,quoteTime:now-1000,completedAt:t+8*300000}};
 const morning={status:'INDEX_PATTERN',side:'PE',signalTime:now-1000};
 const args={scan,morning,now,date,selectedRows:selected,strikeResearch:rank};
 assert.equal(selectSunilSetup(args).setup,'MORNING_PRICE_ACTION_20_30');
 assert.equal(selectSunilSetup(args).targetPoints,30);
 assert.equal(selectSunilSetup({...args,scan:{...scan,directionLock:{status:'NO_TRADE'}}}).status,'NO_TRADE');
 assert.equal(selectSunilSetup({...args,strikeResearch:null}).status,'WAIT');
 assert.equal(selectSunilSetup({...args,now:Date.parse(date+'T12:00:00+05:30')}).status,'WAIT');
});

test('strike universe excludes OTM and ranks ATM versus nearest ITM by observed speed',()=>{
 const strikes=[48000,48100,48200,48300,48400];
 assert.equal(strikeUniverse(48260,strikes,'CE').map(v=>v.strike).join(','),'48300,48200');
 assert.equal(strikeUniverse(48260,strikes,'PE').map(v=>v.strike).join(','),'48300,48400');
 const fast=ce.map(b=>[b[0],b[1]*2,b[2]*2,b[3]*2,b[4]*2,b[5]]);
 const args={date,now,spot:48260,side:'CE',strikes,candidates:[{strike:48300,side:'CE',rows:ce,quote:{bid:130,ask:131,time:now-1000}},{strike:48200,side:'CE',rows:fast,quote:{bid:260,ask:261,time:now-1000}}]};
 const x=compareStrikeSpeed(args);assert.equal(x.status,'STRIKE_SPEED_WATCH');assert.equal(x.preferred.strike,48200);
 assert.equal(compareStrikeSpeed({...args,candidates:args.candidates.slice(0,1)}).status,'WAIT');
});
test('automatic setup picks confirmed selected-contract premium levels and blocks risky sessions',()=>{
 const scan=scanSunil(input),rank={status:'STRIKE_SPEED_WATCH',side:'CE',preferred:{type:'ATM',strike:48300,ask:131,bid:130,speed:1,quoteTime:now-1000,completedAt:t+8*300000}};
 const args={date,now,scan,strikeResearch:rank,selectedRows:ce,spot:48280};
 const x=selectSunilSetup(args);assert.equal(x.status,'PAPER_PLAN');assert.equal(x.setup,'SECOND_SETUP_4_5');assert.equal(x.stop,111);assert.equal(x.target1,180);assert.equal(x.target2,220);
 assert.equal(selectSunilSetup({...args,scan:{...scan,status:'NO_TRADE'}}).status,'NO_TRADE');
 assert.equal(selectSunilSetup({...args,selectedRows:[]}).status,'WAIT');
 assert.equal(selectSunilSetup({...args,strikeResearch:{...rank,preferred:{...rank.preferred,quoteTime:now-31000}}}).status,'WAIT');
 assert.equal(selectSunilSetup({...args,strikeResearch:{...rank,preferred:{...rank.preferred,type:'OTM'}}}).status,'WAIT');
});
