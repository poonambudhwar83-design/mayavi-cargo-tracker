import { airlineForMawb } from '../airlines.js';

function stripHtml(html='') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/tr>|<\/div>|<\/p>|<\/li>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/[ \t]+/g,' ')
    .replace(/\n\s+/g,'\n')
    .trim();
}

function dt(value='') {
  const m=String(value).match(/(\d{1,2})[\s\/-]+([A-Z]{3}|\d{1,2})[\s\/-]+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i);
  if(!m)return{date:'',time:''};
  const months={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  const mon=months[String(m[2]).toUpperCase()]||String(m[2]).padStart(2,'0');
  return{date:`${m[3]}-${mon}-${String(m[1]).padStart(2,'0')}`,time:m[4]?`${String(m[4]).padStart(2,'0')}:${m[5]}`:''};
}

function airport(v='') { const m=String(v).toUpperCase().match(/\b[A-Z]{3}\b/); return m?.[0]||''; }
function first(text, patterns) { for(const p of patterns){const m=text.match(p);if(m?.[1])return String(m[1]).trim();}return''; }

export async function trackCathayLive(mawb) {
  const airline=airlineForMawb(mawb);
  const digits=String(mawb).replace(/\D/g,'');
  if(!digits.startsWith('160')||digits.length!==11)return{ok:false,airline,reason:'Not a Cathay 160 MAWB'};
  const serial=digits.slice(3);
  const url=`https://www.cathaycargoterminal.com/en-us/Shipment-Tracking/AWBPrefix/160/AWBSuffix/${serial}`;
  try {
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/xhtml+xml'},cache:'no-store',redirect:'follow'});
    if(!r.ok)return{ok:false,airline,reason:`Cathay terminal HTTP ${r.status}`};
    const text=stripHtml(await r.text());
    if(!text.includes(digits)&&!text.includes(`160-${serial}`)&&!text.includes(serial))return{ok:false,airline,reason:'Cathay shipment record not found'};
    if(/Reject Reason|is not found|no record/i.test(text))return{ok:false,airline,reason:'Cathay shipment record not found'};

    const route=text.match(/AWB\s*Type[\s\S]{0,120}?\b(?:Import|Export)\b[\s:,-]+([A-Z]{3})[\s\-–>]+([A-Z]{3})/i)
      || text.match(/(?:Origin|From)\s*[:\-]?\s*([A-Z]{3})[\s\S]{0,100}?(?:Destination|To)\s*[:\-]?\s*([A-Z]{3})/i)
      || text.match(/\b([A-Z]{3})\s*(?:-|–|→|>)\s*([A-Z]{3})\b/);
    let origin=route?.[1]||'';
    let destination=route?.[2]||'';
    if(!origin) origin=airport(first(text,[/(?:Origin|From|Departure\s*Station)\s*[:\-]?\s*([A-Z]{3})/i]));
    if(!destination) destination=airport(first(text,[/(?:Destination|To|Arrival\s*Station)\s*[:\-]?\s*([A-Z]{3})/i]));

    const eventPatterns=[
      /Received\s+from\s+Flight[\s\S]{0,260}?(CX\s?\d{2,4})?[\s\S]{0,260}?(\d{1,2}\s+[A-Z]{3}\s+\d{4}\s+\d{1,2}:\d{2})/ig,
      /Cargo\s+Delivered[\s\S]{0,260}?(\d{1,2}\s+[A-Z]{3}\s+\d{4}\s+\d{1,2}:\d{2})/ig,
      /(?:Actual\s+Arrival|Arrived|Arrival)[\s\S]{0,160}?(\d{1,2}\s+[A-Z]{3}\s+\d{4}\s+\d{1,2}:\d{2})/ig
    ];
    const events=[];
    let flightNo='';
    for(const re of eventPatterns){let m;while((m=re.exec(text))){const value=m[m.length-1];const parsed=dt(value);if(parsed.date){events.push({...parsed,value});if(!flightNo&&m[1]&&/^CX/i.test(m[1]))flightNo=m[1].replace(/\s+/g,'').toUpperCase();}}}
    events.sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const arrival=events[0]||{date:'',time:''};

    const pieces=first(text,[/(?:Pieces?|PCS|No\.\s*of\s*Pieces)\s*[:\-]?\s*(\d+)/i,/(\d+)\s*(?:PCS|Pieces?)\b/i]);
    const weight=first(text,[/(?:Gross\s*Weight|Weight)\s*[:\-]?\s*([\d,.]+)\s*KG/i]);
    if(!flightNo) flightNo=(text.match(/\bCX\s?\d{2,4}\b/i)?.[0]||'').replace(/\s+/g,'').toUpperCase();
    const arrived=Boolean(arrival.date)||/Received\s+from\s+Flight|Cargo\s+Delivered|\bRCF\b/i.test(text);
    const eta=arrival.date&&arrival.time?`${arrival.date}T${arrival.time}:00`:null;

    return{ok:true,airline,shipment:{mawb,carrierCode:'CX',airlineName:'Cathay Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,arrivalDate:arrival.date,arrivalTime:arrival.time,arrivalIsActual:arrived&&Boolean(arrival.date),eta,actualArrival:arrived?eta:null,status:arrived?'ARRIVED':'IN_TRANSIT',officialTracker:'https://www.cathaycargo.com/en-us/track-and-trace.html',source:'Cathay Cargo Terminal official shipment record'},debug:{terminalUrl:url,originFound:Boolean(origin),destinationFound:Boolean(destination),arrivalFound:Boolean(arrival.date)}};
  } catch(e) { return{ok:false,airline,reason:e?.message||'Cathay terminal request failed'}; }
}
