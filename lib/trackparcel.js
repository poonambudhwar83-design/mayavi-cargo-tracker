// TrackParcel is a third-party tracker, NOT India Post's official portal.
// This adapter reads only fields shown for the exact requested ED consignment;
// it never guesses destination or delivery address from a country code.
const TRACK_URL='https://www.trackparcel.in/';
const clean=value=>String(value||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const placeholders=/^(Origin|Destination|Address|Country|Booking Office|Post Office|Delivery Address|Receiver Address|Weight|Details|Status|Tracking History|Live result|N\/A|Not Available|Unknown|—|-)$/i;
const labelStop=/^(Shipment|Tracking|Status|Event|Last Updated|Current Status|Origin|Destination|From|To|Weight|Article|Address|Receiver|Recipient|Consignee|Pin|City|State|Country|Date|Time|Route|Carrier|Timeline|Scan|Latest)/i;
function actual(value=''){
  const t=clean(value).replace(/^[:\-–—\s]+|[:\-–—\s]+$/g,'');
  // Never treat a footer, website citation or disclaimer as a parcel place.
  if(/(?:indiapost\.gov\.in|trackparcel\.in|TrackParcel is not India Post|checked 20\d{2}[-/]\d{2}[-/]\d{2}|\.gov\.in|https?:\/\/|FAQ|DISCLAIMER)/i.test(t))return'';
  return t.length>1&&t.length<250&&!placeholders.test(t)&&!/^https?:|^\w+@|^track (your|any)/i.test(t)?t:'';
}
function valuedLine(lines,pattern,kind='place'){
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(pattern);if(!m)continue;
    let value=actual(m[1]||'');
    if(!value){
      for(let j=i+1;j<Math.min(i+4,lines.length);j++){
        // Stop at the next field heading; do not steal that field's value
        // as the preceding field (e.g. WEIGHT 9710 mistaken for ORIGIN).
        if(labelStop.test(lines[j])||placeholders.test(lines[j]))break;
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
  const matchingIndices=all.flatMap((line,index)=>line.toUpperCase().includes(awb)?[index]:[]);
  if(!awb||!matchingIndices.length)return null;
  // The tracking form can repeat the ED above the result. Prefer the occurrence
  // beside the actual India Post result, rather than an empty input/header.
  const idx=matchingIndices.findLast(i=>{const nearby=all.slice(Math.max(0,i-8),Math.min(all.length,i+50)).join(' ');return /\bIndia Post\b/i.test(nearby)&&/Live result|Current Status|Delivered|In Transit|Tracking History|Shipment Details/i.test(nearby);})??matchingIndices[matchingIndices.length-1];
  // Require a result card, not merely the tracking number in a form input.
  const surroundings=all.slice(Math.max(0,idx-30),Math.min(all.length,idx+35)).join('\n');
  if(!/\bIndia Post\b/i.test(surroundings)||!/(?:Live result|Delivered|In Transit|Out for Delivery|Booked|Dispatched|Tracking History|Shipment Details)/i.test(surroundings))return null;
  const section=all.slice(Math.max(0,idx-6),Math.min(all.length,idx+160));
  const origin=valuedLine(section,/^(?:Origin|Origin Location|Origin Office|Source|From)\s*(?::|[-–])?\s*(.*)$/i);
  const destination=valuedLine(section,/^(?:Destination|Destination Location|Destination Country|Delivery Country|To)\s*(?::|[-–])?\s*(.*)$/i);
  const weight=valuedLine(section,/^(?:Actual Weight|Gross Weight|Article Weight|Consignment Weight|Shipment Weight|Weight)\s*(?::|[-–])?\s*(.*)$/i,'weight');
  // Do not mistake the website's footer "Contact Address" for the parcel address.
  // "To" on an ED-matched TrackParcel result is a tracking address, not
  // the manually entered consignee name/address field.
  const address=valuedLine(section,/^(?:Delivery Address|Recipient Address|Receiver Address|Consignee Address|Destination Address|Full Address|Delivery Location Address|Address|To Address|TO)\s*(?::|[-–])?\s*(.*)$/i);
  // Prefer the ED result's explicit current status over the timeline and
  // never search the site's whole page (which contains generic FAQ examples).
  const statusLines=section.slice(0,65);
  // TrackParcel displays the live status as an unlabelled badge above the
  // timeline. Read it only inside the exact ED-matched result card.
  const eventNames=/^(?:Item received at office of exchange \(Inb\)|Send item to domestic location \(Inb\)|Arrived at sorting centre|Sent to Export Customs|Out for Delivery|Item received|Item booked|Item bagged|Dispatched|Delivered|In Transit|Booked)(?:\s|$)/i;
  let status='';
  const historyAt=statusLines.findIndex(x=>/^TRACKING HISTORY$/i.test(x));
  const timelineAt=statusLines.findIndex(x=>/^Timeline$/i.test(x));
  const badgeEnd=[historyAt,timelineAt].filter(x=>x>=0).sort((a,b)=>a-b)[0]??statusLines.length;
  // Badge is before the history; do not pick an older timeline event here.
  const badge=statusLines.slice(0,badgeEnd);
  for(let i=0;i<badge.length;i++){
    const line=badge[i];
    const labeled=line.match(/^(?:(?:CURRENT|LATEST|DELIVERY|SHIPMENT|PARCEL)\s+)?STATUS\s*[:\-]?\s*(.+)$/i);
    const candidate=labeled?.[1]||line;
    const m=candidate.match(eventNames);
    if(m){status=m[0].trim();break;}
  }
  // If the result has no badge, the first dated tracking-history entry is
  // the latest event (the list is newest-first). Never use arbitrary FAQ text.
  if(!status&&historyAt>=0){
    for(let i=historyAt+1;i<Math.min(statusLines.length,historyAt+10);i++){
      const line=statusLines[i];
      const m=line.match(eventNames);
      if(!m)continue;
      const nearby=statusLines.slice(i+1,i+4).join(' ');
      if(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(nearby)){
        status=m[0].trim();break;
      }
    }
  }
  // Never infer CURRENT status from an ED result's timeline or FAQ.
  // Those blocks contain old Delivered events (including other parcels) and
  // previously caused fresh scanned EDs to be incorrectly marked Delivered.
  // If the tracking site's explicitly labeled current-status field is absent,
  // return status='' but preserve any exact-ED weight/address details.
  // A dated Delivered scan is the only source for delivery date/time.
  // Timelines may place a date immediately before or after the event.
  // Limit scanning to this confirmed ED result, never the entire web page.
  const dateRx=/\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/\s](?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|\d{1,2})[-/\s]\d{2,4})\b(?:\s*(?:at|,)?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i;
  let deliveredAtText='';
  if(/^Delivered$/i.test(status)){
    // TrackParcel has a dedicated DELIVERED ON field above the timeline.
    // Prefer its date/time to the historic scan's raw UTC timestamp.
    const deliveredOnIndex=section.findIndex(x=>/^DELIVERED ON(?:\\s|$)/i.test(x));
    if(deliveredOnIndex>=0){
      const deliveryText=section.slice(deliveredOnIndex,deliveredOnIndex+4).join(' ');
      const explicit=deliveryText.match(/\\b\\d{1,2}\\s+[A-Za-z]+\\s+20\\d{2},?\\s+\\d{1,2}:\\d{2}\\s*(?:am|pm)\\s*IST\\b/i);
      if(explicit)deliveredAtText=explicit[0].trim();
    }
    const deliveryEvent=/^(?:Item\s+)?Delivered(?:\s+(?:At|On|Successfully|To|Date))?\b|^Delivery\s+Date(?:\s*(?:\/\s*Time|and\s*Time))?\b/i;
    const scanLines=section.slice(0,125);
    for(let i=0;i<scanLines.length&&!deliveredAtText;i++){
      const line=scanLines[i];
      if(!deliveryEvent.test(line)||/not delivered|undelivered|delivery attempted/i.test(line))continue;
      const neighbors=[line,scanLines[i+1]||'',scanLines[i-1]||''];
      for(const candidate of neighbors){
        const match=candidate.match(dateRx);
        if(!match)continue;
        deliveredAtText=match[0].trim();
        break;
      }
      if(deliveredAtText)break;
    }
  }
  const weightSource=weight?'TrackParcel India Post exact-ED weight field (bare digits interpreted as grams)':'';
  // An input field + generic India Post FAQ is NOT a shipment result.
  // Require an explicit current-status label or a genuine parcel detail.
  if(!status&&!weight&&!address)return null;
  return {trackingNo:awb,origin,destination,weight,weightSource,address,status,deliveredAtText,
    trackParcelDeliveredAtText:deliveredAtText,deliveryTimeSource:deliveredAtText?'TrackParcel dated delivered scan':'',
    statusVerifiedSource:status?'TrackParcel ED-matched labeled current status':'',
    provider:'TrackParcel third-party India Post',detailsSource:'TrackParcel result for exact ED number'};
}
export async function trackParcelDetails(page,number){
  const id=String(number||'').trim().toUpperCase();
  if(!/^ED\d{9}IN$/.test(id))return null;
  let stage='open';
  const report=(outcome,extra={})=>{
    // Never log the ED or the private To address; only presence flags.
    console.info('speedpost_trackparcel_probe',JSON.stringify({stage,outcome,...extra}));
  };
  // TrackParcel uses a React-controlled field and a private POST result flow.
  // Setting input.value directly does NOT trigger its onChange: past lookups
  // clicked "Track Your Parcel" but the page never received the ED value.
  let clicked=false,matchedInput=false,sawResult=false;
  try{
    // Carrier-specific lookup is less ambiguous than homepage auto-detection.
    await page.goto(TRACK_URL+'carriers/india-post',{
      waitUntil:'domcontentloaded',timeout:17000
    });
    stage='hydrate';
    await page.waitForFunction(()=>{
      const input=[...document.querySelectorAll('input')]
        .find(el=>/tracking|consignment|awb|parcel/i
          .test([el.placeholder,el.name,el.id].join(' ')));
      return Boolean(input&&!input.disabled);
    },{timeout:11000}).catch(()=>{});
    let input=await page.$('input[placeholder*="tracking" i],input[name*="tracking" i],input[aria-label*="tracking" i]');
    if(!input){
      input=await page.$('input[type="text"],input[type="search"]');
    }
    if(!input){
      report('missing-input',{page:'india-post'});return null;
    }
    stage='enter';
    // ElementHandle.click()/press() can fail when React rehydrates or replaces
    // the input. Focus a currently visible field from inside the page, then
    // send native keyboard events at page level (not at a stale ElementHandle).
    for(let attempt=0;attempt<2&&!matchedInput;attempt++){
      const found=await page.evaluate(()=>{
        const inputs=[...document.querySelectorAll('input')].filter(el=>{
          const box=el.getBoundingClientRect();
          const style=getComputedStyle(el);
          return box.width>20&&box.height>10&&!el.disabled&&
            style.visibility!=='hidden'&&style.display!=='none'&&
            ['text','search',''].includes(el.type);
        });
        const input=inputs.find(el=>/tracking|consignment|awb|parcel|article|waybill/i
          .test([el.placeholder,el.name,el.id,el.getAttribute('aria-label')].join(' ')))||inputs[0];
        if(!input)return false;
        input.focus();
        input.select?.();
        return document.activeElement===input;
      }).catch(()=>false);
      if(!found){await new Promise(r=>setTimeout(r,400));continue;}
      // Remove any prefilled example using keyboard, then type each ED
      // character normally so React's onChange sees the actual user value.
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.type(id,{delay:25});
      matchedInput=await page.evaluate(no=>[...document.querySelectorAll('input')].some(el=>
        String(el.value||'').toUpperCase().replace(/\s/g,'')===no),id).catch(()=>false);
      if(!matchedInput)await new Promise(r=>setTimeout(r,550));
    }
    if(!matchedInput){report('react-input-mismatch',{page:'india-post'});return null;}
    await new Promise(resolve=>setTimeout(resolve,450));
    stage='submit';
    // Prefer the input's own form button; homepage calls-to-action are NOT
    // the tracking submit button and yielded empty 12-kB landing pages.
    clicked=await page.evaluate(no=>{
      const inputs=[...document.querySelectorAll('input')];
      const input=inputs.find(el=>String(el.value||'').toUpperCase().trim()===no);
      if(!input)return false;
      const form=input.closest('form');
      if(!form)return false;
      const buttons=[...form.querySelectorAll('button,input[type="submit"]')];
      const button=buttons.find(el=>!el.disabled&&
        (el.type==='submit'||/\btrack\b|search|submit/i.test(el.innerText||el.value||el.textContent||'')));
      if(button){button.click();return true;}
      if(typeof form.requestSubmit==='function'){form.requestSubmit();return true;}
      return false;
    },id).catch(()=>false);
    if(!clicked){
      await input.press('Enter').catch(()=>{});
      clicked=true;
    }
    stage='await-result';
    sawResult=Boolean(await page.waitForFunction(no=>{
      const t=String(document.body?.innerText||'');
      const at=t.toUpperCase().indexOf(no);
      if(at<0)return false;
      const around=t.slice(Math.max(0,at-350),Math.min(t.length,at+2500));
      return /\bIndia Post\b/i.test(around)&&/Live result|Delivered|Out for Delivery|In Transit|Shipment Details|Tracking History|\bWeight\b/i.test(around);
    },{timeout:20000},id).catch(()=>null));
    await new Promise(resolve=>setTimeout(resolve,350));
    stage='parse';
    const text=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
    let result=parseTrackParcelDetails(text,id);
    // Some TrackParcel revisions redirect to a result page after a POST, while
    // others hydrate a card on the same screen. Do not infer a weight from a
    // generic carrier/FAQ page, even if it contains 'India Post'.
    if(!result&&!sawResult){
      await new Promise(resolve=>setTimeout(resolve,1000));
      const current=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
      result=parseTrackParcelDetails(current,id);
    }
    report(result?'parsed':'unreadable-result',{
      clicked,matchedInput,sawResult,
      page:'india-post',hasNumber:text.toUpperCase().includes(id),
      hasWeightLabel:/\bweight\b/i.test(text),hasIndiaPost:/\bIndia Post\b/i.test(text),
      pageTextLength:text.length,hasWeight:!!result?.weight,hasStatus:!!result?.status,
      hasAddress:!!result?.address
    });
    return result;
  }catch(e){
    const detail=String(e?.message||'').replace(/ED\d{9}IN/gi,'[REDACTED]').slice(0,120);
    report('lookup-error',{errorType:e?.name||'Error',stage,detail,clicked,matchedInput,sawResult});
    return null;
  }
}
