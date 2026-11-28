import {GET as stocks} from '../../stocks/route.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){const url=new URL(request.url);url.searchParams.set('sunil','1');url.searchParams.set('sunilCron','1');url.searchParams.set('symbol','BANKNIFTY');return stocks(new Request(url,{headers:request.headers}));}
