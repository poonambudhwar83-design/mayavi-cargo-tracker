// Speed Post tracking is deliberately separate from airline/MAWB adapters.
import { trackParcelDetails } from './trackparcel.js';
// myspeedpost.com is an independent third-party site, NOT an official India Post website.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE='https://myspeedpost.com';
// Consignment details (including Booked On and Tariff) are rendered on this route.
// The old /track-ems-speedpost is a generic EMS search landing page.
const CONSIGNMENT_PATH='/track-ems-speedpost';
const EMS_FALLBACK_PATH='/speed-post-tracking';
const textClean=value=>String(value||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function speedPostNumber(value=''){
  const cleaned=String(value||'').toUpperCase().replace(/[\s-]/g,'');
  return /^ED[0-9]{9}IN$/.test(cleaned)?cleaned:'';
}

export function parseSpeedPostText(raw='',number=''){
  const normalized=String(raw||'').replace(/\r/g,'').replace(/\u00a0/g,' ')
    .split('\n').map(textClean).filter(Boolean);
  const flat=normalized.join('\n');
  if(!number||!flat.toUpperCase().includes(number.toUpperCase()))return null;
  // Search form text is not evidence. Only accept an actual consignment result.
  if(!/Consignment Details/i.test(flat)||!/CURRENT STATUS|BOOKED ON|LAST UPDATED/i.test(flat))return null;
  const labels=/^(?:CONSIGNMENT\s*#|CURRENT\s+STATUS|BOOKED\s+ON|LAST\s+UPDATED|ARTICLE\s+TYPE|TARIFF|(?:ARTICLE\s+)?WEIGHT|ORIGIN|DESTINATION|TIMELINE|MAP VIEW|BOOKING OFFICE|COUNTRY)\b/i;
  const take=(label)=>{
    const rx=new RegExp('^'+label+'(?:\\s*:\\s*|\\s+)?(.*)$','i');
    for(let i=0;i<normalized.length;i++){
      const m=normalized[i].match(rx);
      if(!m)continue;
      let value=textClean(m[1]).replace(/^[:\s]+/,'');
      if(!value){
        const next=textClean(normalized[i+1]||'');
        if(!next||labels.test(next))continue;
        value=next;
      }
      if(value.length>200||/^(?:N\/A|No data|—|-)$/i.test(value))continue;
      return value;
    }
    return '';
  };
  // EMS has shown "Item Delivered" as its actual CURRENT STATUS.
  const rawStatus=take('CURRENT\\s+STATUS');
  let status='';
  if(/^(?:Item\s+)?Delivered\b/i.test(rawStatus))status='Delivered';
  else if(/^Out\s+for\s+Delivery\b/i.test(rawStatus))status='Out for Delivery';
  else if(/^Reached\s+Destination\b/i.test(rawStatus))status='Reached Destination';
  else if(/^(?:In\s+Transit|Item\s+Dispatched|Dispatched|Item\s+Received|Booked|Accepted|Returned|Held)\b/i.test(rawStatus))
    status=rawStatus.replace(/^Item\s+/i,'');
  // Do not interpret the "Booked On" label or historic tracking steps as CURRENT status.
  const tariffRaw=take('TARIFF').replace(/,/g,'');
  const tariffMatch=tariffRaw.match(/(?:₹|INR\s*)?(\d+(?:\.\d{1,2})?)\s*(?:INR)?/i);
  const tariff=tariffMatch?tariffMatch[1]:'';
  const bookedOn=take('BOOKED\\s+ON');
  const lastUpdated=take('LAST\\s+UPDATED');
  const articleType=take('ARTICLE\\s+TYPE');
  let weight=take('(?:ARTICLE\\s+)?WEIGHT');
  const weightMatch=weight.match(/(\d+(?:\.\d+)?)\s*(kg|g|grams?|gm)\b/i);
  weight=weightMatch?weightMatch[1]+' '+weightMatch[2]:'';
  const origin=expandedPlace(flat,'origin');
  const destination=expandedPlace(flat,'destination');
  if(!status&&!bookedOn&&!lastUpdated&&!articleType&&!tariff&&!weight)return null;
  // This is source event time, not the time the Mayavi refresh was performed.
  // EMS's "Last Updated" identifies the delivered event when Item Delivered
  // is the current status. Preserve the exact displayed local-clock text:
  // a timezone is not supplied by this third-party page.
  const eventTime=/\b\d{1,2}\s+[A-Za-z]+\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/i;
  const deliveredAtText=status==='Delivered'&&eventTime.test(lastUpdated)
    ?lastUpdated:'';
  return {
    trackingNo:number,status,origin,destination,tariff,bookingDate:bookedOn,
    lastUpdated,articleType,weight,deliveredAtText,
    deliveryTimeSource:deliveredAtText?'MySpeedPost Item Delivered / Last Updated':'',
    outForDelivery:/out\s+for\s+delivery/i.test(status),
    outForDeliveryAt:'',delivered:status==='Delivered',
    source:'MySpeedPost third-party EMS tracking',officialSource:false,
    verifiedAt:new Date().toISOString(),
    trackingUrl:BASE+CONSIGNMENT_PATH+'?n='+encodeURIComponent(number)
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
    const parcelPage=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36');
    await parcelPage.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36');
    // Run BOTH websites independently: a slow MySpeedPost page cannot delay
    // the TrackParcel delivery result or prevent it being considered.
    const parcelLookup=trackParcelDetails(parcelPage,number).catch(()=>null);
    let shipment=null;
    // Keep the already working MySpeedPost fields independent of TrackParcel,
    // so a third-party outage never deletes or overwrites the old good details.
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:16000});
      await page.waitForFunction(no=>{
        const t=document.body?.innerText||'';
        return t.toUpperCase().includes(no)&&/Consignment Details/i.test(t)&&/Current Status/i.test(t);
      },{timeout:10000},number).catch(()=>{});
      let text=await page.evaluate(()=>document.body?.innerText||'');
      if(!parseSpeedPostText(text,number)){
        // EMS can require Track Now even when the tracking number is prefilled.
        await page.goto(BASE+EMS_FALLBACK_PATH,{waitUntil:'domcontentloaded',timeout:12000});
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
    const extra=await parcelLookup;
    if(extra){
      const joined={...(shipment||{}),trackingNo:number};
      // EMS is PRIMARY for cost, booking, time, status and known locations.
      // TrackParcel contributes data ONLY for gaps (including missing weight).
      for(const field of ['origin','destination','weight','address']){
        if(!joined[field]&&extra[field])joined[field]=extra[field];
      }
      if(extra.weight&&!shipment?.weight&&extra.weightSource)joined.weightSource=extra.weightSource;
      // A confirmed Delivered event is terminal on either independent source.
      // Otherwise EMS current status takes precedence.
      if(extra.status&&(!joined.status||(/^Delivered$/i.test(extra.status)&&!joined.delivered))){
        joined.status=extra.status;
        joined.delivered=/^Delivered$/i.test(extra.status);
        joined.outForDelivery=/^Out for Delivery$/i.test(extra.status);
      }
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
  const url=BASE+CONSIGNMENT_PATH+'?n='+encodeURIComponent(no)+'&sync=true';
  // Direct HTML and hydrated browser lookup run in parallel. The browser itself
  // checks MySpeedPost and TrackParcel on separate pages, in parallel.
  const [html,browser]=await Promise.all([fromHtml(url,no),fromBrowser(url,no)]);
  const merged=browser?{
    ...html,...browser,
    origin:browser.origin||html?.origin||'',
    destination:browser.destination||html?.destination||'',
    address:browser.address||html?.address||'',
    weight:browser.weight||html?.weight||'',
    tariff:browser.tariff||html?.tariff||'',
    bookingDate:browser.bookingDate||html?.bookingDate||'',
    articleType:browser.articleType||html?.articleType||'',
    lastUpdated:browser.lastUpdated||html?.lastUpdated||'',
    deliveredAtText:browser.deliveredAtText||html?.deliveredAtText||'',
    deliveryTimeSource:browser.deliveryTimeSource||html?.deliveryTimeSource||'',
    delivered:browser.delivered===true||html?.delivered===true,
    status:(browser.delivered===true||html?.delivered===true)?'Delivered':(browser.status||html?.status||'')
  }:html;
  if(!merged)return{ok:false,error:'MySpeedPost did not provide verified consignment details. Old saved data has not been changed.',trackingUrl:url};
  return{ok:true,shipment:merged};
}
