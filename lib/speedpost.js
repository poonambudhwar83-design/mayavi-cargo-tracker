// Speed Post tracking is deliberately separate from airline/MAWB adapters.
import { trackParcelDetails } from './trackparcel.js';
// myspeedpost.com is an independent third-party site, NOT an official India Post website.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE='https://myspeedpost.com';
const textClean=value=>String(value||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function speedPostNumber(value=''){
  const cleaned=String(value||'').toUpperCase().replace(/[\s-]/g,'');
  return /^ED[0-9]{9}IN$/.test(cleaned)?cleaned:'';
}

export function parseSpeedPostText(raw='',number=''){
  const input=String(raw||'').replace(/\r/g,'').replace(/\u00a0/g,' ');
  const normalized=input.split('\n').map(textClean).filter(Boolean);
  const flat=normalized.join('\n');
  if(!number||!flat.toUpperCase().includes(number.toUpperCase()))return null;
  // No shipment data is inferred from page headings, an empty search form or generic examples.
  if(!/Consignment Details|Current Status|Booked On/i.test(flat))return null;
  const take=(label,limit=3)=>{
    const rx=new RegExp('^'+label+'(?:\\s*:\\s*|\\s+)?(.*)$','i');
    for(let i=0;i<normalized.length;i++){
      const m=normalized[i].match(rx);
      if(!m)continue;
      let value=textClean(m[1]);
      if(!value||/^[:\-]$/.test(value))value=textClean(normalized[i+1]||'');
      if(!value||value.length>limit*100)return'';
      if(/^(Consignment Details|Current Status|Booked On|Last Updated|Article Type|Tariff|Origin|Destination|Timeline|Map View|Out for Delivery|Delivered|Booked)$/i.test(value))return'';
      return value;
    }
    return'';
  };
  // The site's desktop layout shows each field's label above its value.
  let status=take('CURRENT\\s+STATUS');
  const matchStatus=flat.match(/\b(Out for Delivery|Delivered|In Transit|Reached Destination|Booked|Item Dispatched|Item Received|Accepted|Returned|Held)\b/i);
  if(!status&&matchStatus)status=matchStatus[1];
  if(status&&!/^(Out for Delivery|Delivered|In Transit|Reached Destination|Booked|Item Dispatched|Item Received|Accepted|Returned|Held|Failed Delivery|Undelivered)$/i.test(status)){
    const known=status.match(/Out for Delivery|Delivered|In Transit|Reached Destination|Booked|Item Dispatched|Item Received|Accepted|Returned|Held/i);
    status=known?known[0]:'';
  }
  let tariff=take('TARIFF').replace(/,/g,'');
  const tariffMatch=tariff.match(/(?:₹|INR\s*)?([0-9]+(?:\.[0-9]{1,2})?)\s*(?:INR)?/i);
  tariff=tariffMatch?tariffMatch[1]:'';
  const bookedOn=take('BOOKED\\s+ON');
  const lastUpdated=take('LAST\\s+UPDATED');
  const articleType=take('ARTICLE\\s+TYPE');
  let weight=take('(?:ARTICLE\\s+)?WEIGHT');
  const weightMatch=weight.match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|g|grams?|gm)\b/i);
  weight=weightMatch?(weightMatch[1]+' '+weightMatch[2]):'';
  const cleanPlace=(value)=>{
    const t=textClean(value||'');
    if(!t||t.length>210||/^(Origin|Destination|Show|Hide|See Details|View Details|Map View|Timeline)$/i.test(t))return'';
    return t;
  };
  const origin=expandedPlace(flat,'origin');
  const destination=expandedPlace(flat,'destination');
  const hasShipmentEvidence=Boolean(bookedOn||lastUpdated||articleType||tariff||(/Consignment Details/i.test(flat)&&status));
  if(!hasShipmentEvidence)return null;
  return{
    trackingNo:number,status:status||'',origin,destination,tariff,bookingDate:bookedOn,
    lastUpdated,articleType,weight,
    outForDelivery:/out\s+for\s+delivery/i.test(status),
    outForDeliveryAt:'',
    delivered:/^Delivered$/i.test(status),
    source:'MySpeedPost third-party tracker',
    officialSource:false,
    verifiedAt:new Date().toISOString(),
    trackingUrl:BASE+'/track-ems-speedpost?n='+encodeURIComponent(number)+'&sync=true'
  };
}

// Read the value beneath COUNTRY or BOOKING OFFICE only after its card is expanded.
function expandedPlace(pageText='',section=''){
  const lines=String(pageText).split(/\r?\n/).map(textClean).filter(Boolean);
  const heading=section==='destination'?'DESTINATION':'ORIGIN';
  const label=section==='destination'?/^(?:COUNTRY|DESTINATION COUNTRY|COUNTRY NAME)\s*(?::|-)?\s*(.*)$/i:/^(?:BOOKING OFFICE|BOOKING OFFICE NAME|POST OFFICE)\s*(?::|-)?\s*(.*)$/i;
  const bad=/^(COUNTRY|DESTINATION|ORIGIN|BOOKING OFFICE|POST OFFICE|CITY|STATE|PINCODE|POSTAL CODE|ADDRESS|[-–—]|N\/A|NO DATA)$/i;
  const valid=x=>{x=textClean(x);return x.length<130&&/[a-z]/i.test(x)&&!bad.test(x)?x:''};
  for(let i=0;i<lines.length;i++){
    if(lines[i].toUpperCase()!==heading)continue;
    const end=Math.min(lines.length,i+25);
    for(let j=i+1;j<end;j++){
      if(/^(ORIGIN|DESTINATION|TIMELINE|MAP VIEW|CONSignment DETAILS)$/i.test(lines[j]))break;
      const m=lines[j].match(label);if(!m)continue;
      if(valid(m[1]))return valid(m[1]);
      for(let k=j+1;k<Math.min(j+4,end);k++){const result=valid(lines[k]);if(result)return result;}
    }
  }
  return'';
}

function htmlToText(html=''){
  return String(html||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/(?:div|section|span|p|li|h[1-6]|button|dd|dt|strong|label|summary|tr|td)>/gi,'\n')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'").replace(/&[a-z]+;/gi,' ')
    .replace(/[ \t]+/g,' ');
}

async function fromHtml(url,number){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),8500);
  try{
    const r=await fetch(url,{cache:'no-store',redirect:'follow',signal:ctrl.signal,headers:{
      'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'accept':'text/html,application/xhtml+xml','accept-language':'en-IN,en;q=0.9'
    }});
    if(!r.ok)return null;
    const html=await r.text();
    if(html.length>2000000)return null;
    return parseSpeedPostText(htmlToText(html),number);
  }catch{return null;}finally{clearTimeout(timer);}
}

async function clickDisclosure(page,title){
  return page.evaluate(title=>{
    const matches=[...document.querySelectorAll('button,summary,[role="button"]')]
      .filter(el=>(el.innerText||el.textContent||'').trim().toLowerCase()===title.toLowerCase());
    const b=matches.find(el=>{
      const box=el.getBoundingClientRect();
      return box.width>0&&box.height>0;
    });
    if(b){b.click();return true;}
    const text=[...document.querySelectorAll('h2,h3,h4,span,div')]
      .filter(el=>(el.innerText||'').trim().toLowerCase()===title.toLowerCase()&&el.children.length===0);
    const hit=text.find(el=>el.closest('button,[role="button"],summary'));
    if(hit){hit.closest('button,[role="button"],summary').click();return true;}
    return false;
  },title).catch(()=>false);
}

async function fromBrowser(url,number){
  let browser,page;
  try{
    chromium.setGraphicsMode=false;
    browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],executablePath:await chromium.executablePath(),headless:'shell'});
    page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36');
    let shipment=null;
    // Keep the already working MySpeedPost fields independent of TrackParcel,
    // so a third-party outage never deletes or overwrites the old good details.
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:16000});
      await delay(1000);
      let text=await page.evaluate(()=>document.body?.innerText||'');
      if(!text.toUpperCase().includes(number)||!/Consignment Details/i.test(text)){
        await page.goto(BASE+'/track',{waitUntil:'domcontentloaded',timeout:12000});
        await page.evaluate(no=>{
          const input=[...document.querySelectorAll('input')]
            .find(el=>/tracking|consignment|article|EK123/i.test((el.placeholder||'')+' '+(el.name||'')+' '+(el.id||'')))||
            document.querySelector('input[type="text"]');
          if(input){
            const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
            setter?.call(input,no);
            input.dispatchEvent(new Event('input',{bubbles:true}));
            input.dispatchEvent(new Event('change',{bubbles:true}));
          }
        },number);
        await delay(200);
        await page.evaluate(()=>{
          const btn=[...document.querySelectorAll('button,[role="button"]')]
            .find(el=>/Track Now/i.test(el.innerText||el.textContent||''));
          btn?.click();
        });
        await delay(1200);
        await page.waitForFunction(no=>document.body?.innerText?.includes(no)&&/Consignment Details/i.test(document.body?.innerText||''),{timeout:8000},number).catch(()=>{});
      }
      await page.evaluate(()=>window.scrollTo(0,Math.min(1000,document.body.scrollHeight))).catch(()=>{});
      await clickDisclosure(page,'Origin');
      await delay(450);
      const originText=await page.evaluate(()=>document.body?.innerText||'');
      const origin=expandedPlace(originText,'origin');
      await clickDisclosure(page,'Destination');
      await delay(550);
      const destinationText=await page.evaluate(()=>document.body?.innerText||'');
      const destination=expandedPlace(destinationText,'destination');
      shipment=parseSpeedPostText(destinationText,number)||parseSpeedPostText(originText,number);
      if(shipment){
        if(origin)shipment.origin=origin;
        if(destination)shipment.destination=destination;
      }
    }catch{
      // Existing source may be temporarily unavailable; try the user-provided
      // TrackParcel website independently for this exact ED consignment.
    }
    const extra=await trackParcelDetails(page,number);
    if(extra){
      const joined={...(shipment||{}),trackingNo:number};
      for(const field of ['origin','destination','weight','address']){
        if(extra[field])joined[field]=extra[field];
      }
      if(extra.status&&!joined.status)joined.status=extra.status;
      joined.detailsSource=extra.detailsSource;
      joined.trackParcelVerifiedAt=new Date().toISOString();
      joined.trackParcelUrl='https://www.trackparcel.in/';
      joined.source=shipment?.source
        ?shipment.source+' + TrackParcel exact ED lookup'
        :'TrackParcel exact ED lookup (third-party)';
      return joined;
    }
    return shipment;
  }catch{return null;}
  finally{try{await browser?.close()}catch{}}
}

export async function trackSpeedPost(value){
  const no=speedPostNumber(value);
  if(!no)return{ok:false,error:'Enter a valid ED + 9 digits + IN Speed Post number.'};
  const url=BASE+'/track-ems-speedpost?n='+encodeURIComponent(no)+'&sync=true';
  const html=await fromHtml(url,no);
  // Browser needed when the page is hydrated client-side or to expand Origin/Destination.
  const browser=await fromBrowser(url,no);
  const merged=browser?{...html,...browser,origin:browser.origin||html?.origin||'',destination:browser.destination||html?.destination||'',address:browser.address||html?.address||'',weight:browser.weight||html?.weight||'',tariff:browser.tariff||html?.tariff||''}:html;
  if(!merged)return{ok:false,error:'MySpeedPost did not provide verified consignment details. Old saved data has not been changed.',trackingUrl:url};
  return{ok:true,shipment:merged};
}
