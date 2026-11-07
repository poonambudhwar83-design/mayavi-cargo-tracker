// Parses a Gulf Air 072 ParcelsApp result captured in a normal browser.
// This endpoint cannot write shipments; Mayavi's authenticated UI saves
// only the AWB-matched result after its existing account checks.
import {parseGulfAirParcelsPage} from '../../../lib/gulfAirParcels.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
export async function POST(request){
  let body={};
  try{body=await request.json()}catch{return Response.json({ok:false,error:'Invalid JSON'},{status:400})}
  const awb=String(body.mawb||'').replace(/\D/g,'');
  if(!/^072\d{8}$/.test(awb))return Response.json({ok:false,error:'Only Gulf Air 072 AWBs accepted'},{status:400});
  const input=body.dom||{};
  const fields=['resultText','leftText','rightText'];
  if(fields.some(k=>typeof input[k]!=='string'||input[k].length>120000))
    return Response.json({ok:false,error:'Invalid ParcelsApp page text'},{status:400});
  if(!Array.isArray(input.timelineRows)||input.timelineRows.length>250||
     input.timelineRows.some(v=>typeof v!=='string'||v.length>1500))
    return Response.json({ok:false,error:'Invalid ParcelsApp timeline'},{status:400});
  const parsed=parseGulfAirParcelsPage(input,awb);
  if(!parsed.ok)return Response.json({ok:false,trackingError:parsed.reason},{status:422});
  return Response.json({ok:true,provider:'ParcelsApp Gulf Air via normal Chrome session',
    shipment:{...parsed.shipment,source:'ParcelsApp Gulf Air Cargo (browser session; AWB-verified)',
      browserVerifiedAt:new Date().toISOString()},serverSaved:false},
    {headers:{'Cache-Control':'no-store'}});
}
