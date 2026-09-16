export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const URLS=[
  'https://api.cathaypacific.com/flightinformation/flight-status/olss-flight-status/v4.0/flightStatusByFlightNumber',
  'https://api.cathaypacific.com/flightinformation/flight-status/olss-flight-status/v5.0/flightStatusByFlightNumber'
];

async function probe(url,payload){
  try{
    const r=await fetch(url,{method:'POST',headers:{
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'accept':'application/json, text/plain, */*',
      'content-type':'application/json;charset=UTF-8',
      'origin':'https://www.cathaypacific.com',
      'referer':'https://www.cathaypacific.com/'
    },body:JSON.stringify(payload),cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(15000)});
    const text=await r.text();
    return{url,status:r.status,ok:r.ok,headers:Object.fromEntries([...r.headers.entries()].filter(([k])=>/content-type|server|x-|access-control/i.test(k))),body:text.slice(0,12000)};
  }catch(e){return{url,error:e?.message||String(e)}}
}

export async function GET(){
  const variants=[
    {travelDate:'2026-09-15',carrierCode:'CX',flightNumber:'679',locale:'en_US',departureArrival:'D'},
    {travelDate:'2026-09-15',carrierCode:'',flightNumber:'679',locale:'en_US',departureArrival:'D'},
    {travelDate:'2026-09-15',carrierCode:'CX',flightNumber:'679',locale:'en_HK',departureArrival:'D'},
    {travelDate:'2026-09-15',carrierCode:'CX',flightNumber:'0679',locale:'en_US',departureArrival:'D'}
  ];
  const out=[];
  for(const url of URLS)for(const payload of variants)out.push({payload,...await probe(url,payload)});
  return Response.json({ok:true,out});
}
