// JEPO tracking timeline: leftmost Date and its adjacent Time are the source of truth.
import {parseJepoDeliveryDate} from './jepoDeliveryDate.js';

const excludedDelivery=/\b(?:not delivered|undelivered|delivery failed|attempted delivery|delivery attempt|return to|returned to|rto)\b/i;
const actualDelivery=/\b(?:delivered|delivery completed|proof of delivery|signed for)\b/i;
function stampToOrder(date,time){
 const day=parseJepoDeliveryDate(date);
 if(!day)return '';
 const match=String(time||'').trim().match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?\b/i);
 if(!match)return day+'T00:00';
 let hours=Number(match[1]),mins=Number(match[2]);
 if(hours>23||mins>59)return day+'T00:00';
 const meridian=(match[3]||'').toUpperCase();
 if(meridian){
  if(hours<1||hours>12)return day+'T00:00';
  hours=(hours%12)+(meridian==='PM'?12:0);
 }
 return day+'T'+String(hours).padStart(2,'0')+':'+String(mins).padStart(2,'0');
}
export function summarizeJepoTimeline(rows=[]){
 const events=(Array.isArray(rows)?rows:[]).map((cells,index)=>{
  if(!Array.isArray(cells)||cells.length<2)return null;
  const date=String(cells[0]||'').trim().slice(0,90);
  const time=String(cells[1]||'').trim().slice(0,50);
  const progress=String(cells[cells.length-1]||'').trim().slice(0,400);
  if(!progress)return null;
  return {date,time,progress,index,orderedAt:stampToOrder(date,time)};
 }).filter(Boolean);
 const newest=events.reduce((best,event)=>{
  if(!best)return event;
  if(event.orderedAt&&!best.orderedAt)return event;
  if(event.orderedAt&&best.orderedAt&&event.orderedAt>best.orderedAt)return event;
  return best;
 },null);
 const delivered=events.filter(x=>actualDelivery.test(x.progress)&&!excludedDelivery.test(x.progress)
  &&parseJepoDeliveryDate(x.date)).sort((a,b)=>b.orderedAt.localeCompare(a.orderedAt))[0];
 return {
  latestProgress:newest?.progress||'',
  latestEventWhen:newest?.orderedAt?[newest.date,newest.time].filter(Boolean).join(' ').slice(0,120):'',
  deliveredScanDate:delivered?[delivered.date,delivered.time].filter(Boolean).join(' '):''
 };
}
