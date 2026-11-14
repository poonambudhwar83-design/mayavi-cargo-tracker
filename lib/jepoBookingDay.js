// The weekday belongs to the saved BOOKING calendar date, not today's timezone.
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function jepoBookingWeekday(value){
 const match=String(value??'').slice(0,10).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
 if(!match)return '';
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const date=new Date(Date.UTC(year,month-1,day));
 if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)return '';
 return DAYS[date.getUTCDay()];
}
