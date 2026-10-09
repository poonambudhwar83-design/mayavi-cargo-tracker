// TrackParcel is a third-party tracker, NOT India Post's official portal.
// This adapter reads only fields shown for the exact requested ED consignment;
// it never guesses destination or delivery address from a country code.
const TRACK_URL='https://www.trackparcel.in/';
const clean=value=>String(value||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const placeholders=/^(Origin|Destination|Address|Country|Booking Office|Post Office|Delivery Address|Receiver Address|Weight|Details|Status|Tracking History|Live result|N\/A|Not Available|Unknown|—|-)$/i;
const labelStop=/^(Shipment|Tracking|Status|Event|Last Updated|Current Status|Origin|Destination|From|To|Weight|Article|Address|Receiver|Recipient|Consignee|Pin|City|State|Country|Date|Time|Route|Carrier|Timeline|Scan|Latest)/i;
function actual(value=''){
  const t=clean(value).replace(/^[:\-–—\s]+|[:\-–—\s]+$/g,'');
  return t.length>1&&t.length<250&&!placeholders.test(t)&&!/^https?:|^\w+@|^track (your|any)/i.test(t)?t:'';
}
function valuedLine(lines,pattern,kind='place'){
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(pattern);if(!m)continue;
    let value=actual(m[1]||'');
    if(!value){
      for(let j=i+1;j<Math.min(i+4,lines.length);j++){
        if(labelStop.test(lines[j])||placeholders.test(lines[j]))continue;
        value=actual(lines[j]);if(value)break;
      }
    }
    if(kind==='weight'){
      // TrackParcel's India Post result displays "WEIGHT" then "9710"
      // (grams), often without a unit in the visible page.
      const v=value.match(/^(\d+(?:\.\d+)?)\s*(kg|kgs|kgm|kilograms?|g|gm|gms|grams?)?$/i);
      if(!v)continue;
      if(v[2])return v[1]+' '+v[2];
      // Bare numeric TrackParcel weight is conventionally given in grams.
      // Restrict interpretation to plausible gram counts, rather than
      // guessing for small or unusually large unlabeled numbers.
      const grams=Number(v[1]);
      if(/^\d{3,6}$/.test(v[1])&&grams>=100&&grams<=50000)
        return grams+' g';
      continue;
    }
    if(value&&!/^(View|Share|Copy|Track|Home|Live|Search|Compare|Carrier|India Post|Courier|Map|Tracking Number)$/i.test(value))return value;
  }
  return'';
}

export function parseTrackParcelDetails(raw='',expectedNo=''){
  const awb=String(expectedNo||'').trim().toUpperCase();
  const all=String(raw||'').split(/\r?\n/).map(clean).filter(Boolean);
  const idx=all.findIndex(line=>line.toUpperCase().includes(awb));
  if(!awb||idx<0)return null;
  // Require a result card, not merely the tracking number in a form input.
  const surroundings=all.slice(Math.max(0,idx-9),Math.min(all.length,idx+13)).join('\n');
  if(!/\bIndia Post\b/i.test(surroundings)||!/(?:Live result|Delivered|In Transit|Out for Delivery|Booked|Dispatched|Tracking History|Shipment Details)/i.test(surroundings))return null;
  const section=all.slice(Math.max(0,idx-6),Math.min(all.length,idx+160));
  const origin=valuedLine(section,/^(?:Origin|Origin Location|Origin Office|Source|From)\s*(?::|[-–])?\s*(.*)$/i);
  const destination=valuedLine(section,/^(?:Destination|Destination Location|Destination Country|Delivery Country|To)\s*(?::|[-–])?\s*(.*)$/i);
  const weight=valuedLine(section,/^(?:Actual Weight|Gross Weight|Article Weight|Consignment Weight|Shipment Weight|Weight)\s*(?::|[-–])?\s*(.*)$/i,'weight');
  // Do not mistake the website's footer "Contact Address" for the parcel address.
  const address=valuedLine(section,/^(?:Delivery Address|Recipient Address|Receiver Address|Consignee Address|Destination Address|Full Address|Delivery Location Address|Address)\s*(?::|[-–])?\s*(.*)$/i);
  // Only use independent site values that are physically shown for this AWB.
  const status=(section.join('\n').match(/\b(Delivered|Out for Delivery|In Transit|Booked|Dispatched)\b/i)||[])[1]||'';
  const weightSource=weight?'TrackParcel India Post exact-ED weight field (bare digits interpreted as grams)':'';
  if(!origin&&!destination&&!weight&&!address&&!status)return null;
  return {trackingNo:awb,origin,destination,weight,weightSource,address,status,
    provider:'TrackParcel third-party India Post',detailsSource:'TrackParcel result for exact ED number'};
}
export async function trackParcelDetails(page,number){
  const id=String(number||'').trim().toUpperCase();
  if(!/^ED\d{9}IN$/.test(id))return null;
  try{
    await page.goto(TRACK_URL,{waitUntil:'domcontentloaded',timeout:16000});
    await page.waitForSelector('input',{timeout:7000}).catch(()=>{});
    const inserted=await page.evaluate(no=>{
      const candidates=[...document.querySelectorAll('input')];
      const input=candidates.find(el=>/tracking|consignment|waybill|awb|article|parcel/i.test([el.placeholder,el.name,el.id,el.getAttribute('aria-label')].join(' ')))||
        candidates.find(el=>['text','search',''].includes(el.type));
      if(!input)return false;
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      if(setter)setter.call(input,no);else input.value=no;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'n'}));
      return true;
    },id);
    if(!inserted)return null;
    await new Promise(resolve=>setTimeout(resolve,400));
    const clicked=await page.evaluate(()=>{
      const targets=[...document.querySelectorAll('button,input[type="submit"],[role="button"]')];
      const button=targets.find(x=>/^(?:Track|Track Parcel|Track Your Parcel|Track Now|Search|Submit)(?:\s*[→↗]*)?$/i.test((x.innerText||x.value||x.textContent||'').trim()))||
        targets.find(x=>/track/i.test((x.innerText||x.value||x.textContent||'').trim())&&!x.disabled);
      if(!button)return false;
      button.click();return true;
    });
    if(!clicked)return null;
    await page.waitForFunction((no)=>{
      const t=document.body?.innerText||'';
      const at=t.toUpperCase().indexOf(no.toUpperCase());
      const around=at>=0?t.slice(Math.max(0,at-300),at+650):'';
      return /\bIndia Post\b/i.test(around)&&/Live result|Delivered|Out for Delivery|In Transit|Shipment Details|Tracking History/i.test(around);
    },{timeout:13500},id).catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,900));
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)).catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,350));
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
    return parseTrackParcelDetails(text,id);
  }catch{return null;}
}
