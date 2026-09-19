import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const START='https://aicargoportal.airindia.com/icargoneoportal/app/main/#/app';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const digitsOnly=s=>String(s||'').replace(/\D/g,'');
const pad=v=>String(v).padStart(2,'0');
const MONTH={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function parseDate(s=''){
  const t=String(s).toUpperCase();
  let m=t.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return`${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=t.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m=t.match(/(\d{1,2})[\s\-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[2]]}-${pad(m[1])}`;
  m=t.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]+(\d{1,2})[\s\-,]+(20\d{2})/);if(m)return`${m[3]}-${MONTH[m[1]]}-${pad(m[2])}`;
  return'';
}
function parseShortDate(s=''){
  const t=String(s).toUpperCase();
  const m=t.match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/);
  if(!m)return'';
  const month=Number(MONTH[m[2]]),day=Number(m[1]);
  const now=new Date();let year=now.getUTCFullYear();
  const candidate=Date.UTC(year,month-1,day);
  if(candidate>Date.now()+45*24*60*60*1000)year-=1;
  return`${year}-${MONTH[m[2]]}-${pad(day)}`;
}
function parseTime(s=''){const m=String(s).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);return m?`${pad(m[1])}:${m[2]}`:'';}
function cleanHtml(s=''){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();}

function parseSummary(text='',mawb=''){
  const flat=clean(text);
  const formatted=String(mawb||'').replace(/\D/g,'').replace(/^(\d{3})(\d{8})$/,'$1-$2');
  // The shipment summary card at the top of the Air India result is the
  // authoritative master quantity. Parse the AWB-adjacent "19 pcs 1,002 kg"
  // form first so the token "pcs" is never mistaken for a field label.
  const awbSummary=flat.match(/\b098-\d{8}\b\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\b/i);
  const labelledPieces=(flat.match(/\bPieces\s*:?\s*(\d{1,6})\b/i)||[])[1]||'';
  const labelledWeight=((flat.match(/\b(?:Weight|Wt)\s*:?\s*([\d,.]+)\s*(?:kg|kgs)?\b/i)||[])[1]||'').replace(/,/g,'');
  const pieces=awbSummary?.[1]||labelledPieces||(flat.match(/\b(\d{1,6})\s+pcs\b/i)||[])[1]||'';
  const weight=String(awbSummary?.[2]||labelledWeight||((flat.match(/\b([\d,.]+)\s+kg\b/i)||[])[1]||'')).replace(/,/g,'');
  const months='JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';
  const originRx=new RegExp(`\\b([A-Z]{3})\\s+(\\d{1,2}\\s+(?:${months})[A-Z]*),\\s*(\\d{1,2}:\\d{2})\\s*\\(A\\)\\s+Accepted\\b`,'i');
  const destRx=new RegExp(`\\b([A-Z]{3})\\s+(\\d{1,2}\\s+(?:${months})[A-Z]*),\\s*(\\d{1,2}:\\d{2})\\s*\\(A\\)\\s+Tracking\\s+View\\b`,'i');
  const scheduledArrivalRx=new RegExp(`\\bArrival:\\s*(\\d{1,2}\\s+(?:${months})[A-Z]*\\s+20\\d{2})\\s+(\\d{1,2}:\\d{2})\\s*\\((?:S|E)\\)`,'i');
  const simpleOriginRx=/\b([A-Z]{3})\s*-\s*Accepted\b/i;
  const simpleDestRx=/\b([A-Z]{3})\s*-\s*Tracking\s+View\b/i;
  const flightRouteRx=/\b(AI|IX)\s*[- ]\s*(\d{2,4})\b[\s\S]{0,220}?\b([A-Z]{3})\s*[–-]\s*([A-Z]{3})\b/i;
  const routeRx=/\b([A-Z]{3})\s*[–-]\s*([A-Z]{3})\b/;
  const originMatch=flat.match(originRx),destMatch=flat.match(destRx),scheduledArrivalMatch=flat.match(scheduledArrivalRx),simpleOriginMatch=flat.match(simpleOriginRx),simpleDestMatch=flat.match(simpleDestRx),flightRouteMatch=flat.match(flightRouteRx),routeMatch=flat.match(routeRx);
  const routeOrigin=(flightRouteMatch?.[3]||routeMatch?.[1]||'').toUpperCase();
  const routeDestination=(flightRouteMatch?.[4]||routeMatch?.[2]||'').toUpperCase();
  const origin=routeOrigin||originMatch?.[1]?.toUpperCase()||simpleOriginMatch?.[1]?.toUpperCase()||'';
  const destination=routeDestination||destMatch?.[1]?.toUpperCase()||simpleDestMatch?.[1]?.toUpperCase()||'';
  const bookingDate=originMatch?(parseDate(originMatch[2])||parseShortDate(originMatch[2])):'';
  const bookingTime=originMatch?parseTime(originMatch[3]):'';
  let arrivalDate=scheduledArrivalMatch?parseDate(scheduledArrivalMatch[1]):destMatch?(parseDate(destMatch[2])||parseShortDate(destMatch[2])):'';
  let arrivalTime=scheduledArrivalMatch?parseTime(scheduledArrivalMatch[2]):destMatch?parseTime(destMatch[3]):'';
  if(bookingDate&&arrivalDate){
    const beforeBooking=arrivalDate<bookingDate||(arrivalDate===bookingDate&&bookingTime&&arrivalTime&&arrivalTime<=bookingTime);
    if(beforeBooking){arrivalDate='';arrivalTime='';}
  }
  const arrivalIsActual=false;
  const flightNo=flightRouteMatch?`${String(flightRouteMatch[1]).toUpperCase()}${flightRouteMatch[2]}`:'';
  const serial=digitsOnly(mawb).slice(3),awbMatched=Boolean(serial&&digitsOnly(flat).includes(serial));
  return{mawb:formatted||mawb,carrierCode:'AI',airlineName:'Air India Cargo',origin,destination,bags:pieces,pieces,weight,flightNo,bookingDate,bookingTime,bookingDateSource:bookingDate?'Air India Accepted event':'',arrivalDate,arrivalTime,arrivalIsActual,status:destination?'BOOKED':'TRACKING',awbMatched};
}

function parseActivity(text='',fallback={}){
  const flat=clean(text);const dest=String(fallback.destination||'').toUpperCase();
  const totalPieces=String(fallback.pieces||fallback.bags||'').replace(/\D/g,'');
  const totalWeight=String(fallback.weight||'').replace(/,/g,'').replace(/[^0-9.]/g,'');
  const sameLoad=(pieces='',weight='')=>{const p=String(pieces||'').replace(/\D/g,''),w=String(weight||'').replace(/,/g,'').replace(/[^0-9.]/g,'');return(!totalPieces||p===totalPieces)&&(!totalWeight||Math.abs(Number(w)-Number(totalWeight))<0.01);};
  const verifiedWeight=((flat.match(/\b([\d,.]+)\s+kg\b/i)||[])[1]||'').replace(/,/g,'');
  const timelineIndex=flat.toUpperCase().indexOf('AWB ACTIVITY TIMELINE');
  const timeline=timelineIndex>=0?flat.slice(timelineIndex):'';
  if(!timeline)return verifiedWeight?{weight:verifiedWeight}:{};

  const masterBookedRx=/\bBOOKED\s+Booked\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\s+at\s+([A-Z]{3})\s+for\s+([A-Z0-9]{2})[- ]?(\d{2,4})[A-Z]?\s*,\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})[\s\S]{0,160}?\b([A-Z]{3})\s*[•·]\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s*,\s*(\d{1,2}:\d{2})(?::\d{2})?/gi;
  const masterBookedEvent=[...timeline.matchAll(masterBookedRx)].find(m=>sameLoad(m[1],m[2]))||null;
  const masterBooking=masterBookedEvent?{bookingDate:parseDate(masterBookedEvent[8]),bookingTime:parseTime(masterBookedEvent[9]),bookingDateSource:'Air India BOOKED event timestamp'}:{};

  const arrivals=[...timeline.matchAll(/\bARRIVAL\s+Arrived\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg[\s\S]{0,140}?\bon\s+([A-Z0-9]{2})[- ]?(\d{2,4})[A-Z]?[\s\S]{0,120}?(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(A\)[\s\S]{0,60}?\bat\s+([A-Z]{3})\b/gi)];
  const destinationArrivals=dest?arrivals.filter(m=>String(m[7]).toUpperCase()===dest):arrivals;
  if(destinationArrivals.length){
    // Activity View can contain one ARRIVAL per split load. Aggregate all actual
    // destination arrivals instead of stopping at the first event.
    const unique=[];const seen=new Set();
    for(const m of destinationArrivals){
      const key=[m[1],String(m[2]).replace(/,/g,''),m[3],m[4],parseDate(m[5]),parseTime(m[6]),m[7]].join('|');
      if(!seen.has(key)){seen.add(key);unique.push(m);}
    }
    const masterPieces=Number(totalPieces||0),masterWeight=Number(totalWeight||0);
    const arrivedPiecesTotal=unique.reduce((n,m)=>n+Number(m[1]||0),0);
    const arrivedWeightTotal=unique.reduce((n,m)=>n+Number(String(m[2]||'').replace(/,/g,'')),0);
    const complete=masterPieces>0?arrivedPiecesTotal>=masterPieces:(masterWeight>0&&arrivedWeightTotal>=masterWeight);
    const dated=[...unique].sort((a,b)=>`${parseDate(a[5])}T${parseTime(a[6])}`.localeCompare(`${parseDate(b[5])}T${parseTime(b[6])}`));
    const latest=dated[dated.length-1]||unique[0];
    const departureOrigin=(timeline.match(/\bDEPARTURE\s+Departed[\s\S]{0,420}?\bat\s+([A-Z]{3})\b/i)||[])[1]||'';
    const pieceParts=unique.map(m=>String(m[1]));
    const weightParts=unique.map(m=>String(m[2]).replace(/,/g,''));
    const remainingPieces=masterPieces?Math.max(0,masterPieces-arrivedPiecesTotal):0;
    const remainingWeight=masterWeight?Math.max(0,masterWeight-arrivedWeightTotal):0;
    const manifestRx=/\bMANIFESTED\s+Manifested\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\s+for\s+([A-Z0-9]{2})[- ]?(\d{2,4})[A-Z]?\s*,\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+at\s+([A-Z]{3})\b/gi;
    const manifests=[...timeline.matchAll(manifestRx)];
    const nextManifest=!complete?manifests.find(m=>remainingPieces&&Number(m[1]||0)===remainingPieces)||null:null;
    return{
      origin:String(fallback.origin||departureOrigin||'').toUpperCase(),destination:String(latest[7]).toUpperCase(),
      bags:masterPieces?(complete?pieceParts.join('+'):`${pieceParts.join('+')}+${remainingPieces}`):fallback.bags||fallback.pieces||latest[1],
      pieces:masterPieces?(complete?pieceParts.join('+'):`${pieceParts.join('+')}+${remainingPieces}`):pieceParts.join('+'),
      weight:masterWeight?`${weightParts.join('+')}/${masterWeight}`:weightParts.join('+'),
      masterPieces:totalPieces,masterWeight:totalWeight,
      flightNo:`${String(latest[3]).toUpperCase()}${latest[4]}`,flightDate:parseDate(latest[5]),
      arrivalDate:(!complete&&nextManifest&&parseDate(nextManifest[5]))?`${parseDate(latest[5])} / ${parseDate(nextManifest[5])}`:parseDate(latest[5]),arrivalTime:parseTime(latest[6]),arrivalIsActual:true,
      arrivalDates:(!complete&&nextManifest)?[parseDate(latest[5]),parseDate(nextManifest[5])].filter(Boolean):[parseDate(latest[5])].filter(Boolean),
      status:complete?'ARRIVED':'PART ARRIVED',
      arrivedPieces:String(arrivedPiecesTotal),arrivedWeight:String(arrivedWeightTotal),
      arrivedPiecesDisplay:masterPieces?`${pieceParts.join('+')}/${masterPieces}`:pieceParts.join('+'),
      arrivedWeightDisplay:masterWeight?`${weightParts.join('+')}/${masterWeight}`:weightParts.join('+'),
      remainingPieces:String(remainingPieces),remainingWeight:String(remainingWeight),
      nextFlightNo:nextManifest?`${String(nextManifest[3]).toUpperCase()}${nextManifest[4]}`:'',
      nextFlightDate:nextManifest?parseDate(nextManifest[5]):'',
      nextPieces:nextManifest?String(nextManifest[1]):'',nextWeight:nextManifest?String(nextManifest[2]).replace(/,/g,''):'',
      ...masterBooking,arrivalEvidence:unique.map(m=>clean(m[0])).join(' || ')
    };
  }
  // DELIVERY is terminal too. Check it before historical BOOKED events.
  const deliveredAtDestination=dest&&new RegExp(`\\bDELIVERY\\s+Delivered[\\s\\S]{0,420}?\\bat\\s+${dest}\\b`,'i').test(timeline);
  if(deliveredAtDestination)return{weight:verifiedWeight,arrivalIsActual:true,status:'ARRIVED'};

  const departureRx=/\bDEPARTURE\s+Departed\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg[\s\S]{0,160}?\bon\s+([A-Z0-9]{2})[- ]?(\d{2,4})[A-Z]?\s*,\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+(\d{1,2}:\d{2})\s*\(A\)[\s\S]{0,60}?\bat\s+([A-Z]{3})\b/gi;
  const departures=[...timeline.matchAll(departureRx)];
  // Air India, like Saudia, may expose each split piece as a separate movement.
  // If multiple partial departure events together equal the master, preserve every
  // part instead of letting the newest 13/33 event replace the earlier 20/33.
  if(departures.length>1&&Number(totalPieces||0)>0){
    const masterPieces=Number(totalPieces),masterWeight=Number(totalWeight||0);
    const unique=[];const seen=new Set();
    for(const m of departures){const key=[m[1],String(m[2]).replace(/,/g,''),m[3],m[4],parseDate(m[5])].join('|');if(!seen.has(key)){seen.add(key);unique.push(m);}}
    const parts=unique.filter(m=>Number(m[1]||0)<masterPieces);
    const piecesSum=parts.reduce((n,m)=>n+Number(m[1]||0),0);
    if(parts.length>1&&piecesSum>=masterPieces){
      const dated=[...parts].sort((a,b)=>`${parseDate(a[5])}T${parseTime(a[6])}`.localeCompare(`${parseDate(b[5])}T${parseTime(b[6])}`));
      const pieceParts=dated.map(m=>String(m[1])),weightParts=dated.map(m=>String(m[2]).replace(/,/g,''));
      const latest=dated[dated.length-1],prior=dated[dated.length-2];
      const latestAt=new Date(`${parseDate(latest[5])}T${parseTime(latest[6])||'23:59'}:00+05:30`);
      const latestFuture=!Number.isNaN(latestAt.getTime())&&latestAt.getTime()>Date.now();
      return{origin:String(prior?.[7]||latest[7]||fallback.origin||'').toUpperCase(),destination:String(fallback.destination||'').toUpperCase(),
        bags:pieceParts.join('+'),pieces:pieceParts.join('+'),weight:masterWeight?`${weightParts.join('+')}/${masterWeight}`:weightParts.join('+'),
        masterPieces:totalPieces,masterWeight:totalWeight,flightNo:`${String(latest[3]).toUpperCase()}${latest[4]}`,
        flightDate:parseDate(latest[5]),arrivalDate:[parseDate(prior?.[5]),parseDate(latest[5])].filter(Boolean).join(' / '),
        arrivalDates:[parseDate(prior?.[5]),parseDate(latest[5])].filter(Boolean),arrivalTime:parseTime(latest[6]),
        arrivalIsActual:!latestFuture,status:latestFuture?'PART ARRIVED':'ARRIVED',
        arrivedPieces:latestFuture?String(prior?.[1]||''):String(masterPieces),
        arrivedWeight:latestFuture?String(prior?.[2]||'').replace(/,/g,''):String(masterWeight||''),
        remainingPieces:latestFuture?String(latest[1]||''):'0',remainingWeight:latestFuture?String(latest[2]||'').replace(/,/g,''):'0',
        remarks:latestFuture?'Part load arrived':'',...masterBooking,departureEvidence:dated.map(m=>clean(m[0])).join(' || ')};
    }
  }
  const departure=departures[0]||null;
  if(departure){
    const departedPieces=Number(departure[1]||0),masterPieces=Number(totalPieces||0);
    const partial=masterPieces>0&&departedPieces>0&&departedPieces<masterPieces;
    // If only part of the master has departed, the next/current MANIFESTED event
    // describes the remaining load. Keep both legs so Mayavi first shows what
    // actually departed, then the next planned flight for the balance.
    const manifestRx=/\bMANIFESTED\s+Manifested\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\s+for\s+([A-Z0-9]{2})[- ]?(\d{2,4})[A-Z]?\s*,\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+at\s+([A-Z]{3})\b/gi;
    const manifests=[...timeline.matchAll(manifestRx)];
    const nextManifest=partial?manifests.find(m=>Number(m[1]||0)===masterPieces-departedPieces)||manifests.find(m=>Number(m[1]||0)<masterPieces):null;
    // Split Air India loads can show the first part's ARRIVAL outside the Activity
    // timeline while the balance is already manifested on the next flight. When
    // the first leg's planned destination date has passed, retain that first part
    // as arrived and show both parts together instead of replacing it with 13/33.
    const departedWeight=Number(String(departure[2]||'').replace(/,/g,''));
    const remainingPieces=partial?masterPieces-departedPieces:0;
    const remainingWeight=partial&&totalWeight?Math.max(0,Number(totalWeight)-departedWeight):0;
    const firstArrivalDate=String(fallback.arrivalDate||'');
    const firstArrivalTime=String(fallback.arrivalTime||'');
    const firstArrivalAt=firstArrivalDate?new Date(`${firstArrivalDate}T${firstArrivalTime||'23:59'}:00+05:30`):null;
    const firstPartArrived=partial&&firstArrivalAt&&!Number.isNaN(firstArrivalAt.getTime())&&Date.now()>=firstArrivalAt.getTime();
    if(firstPartArrived){
      return{origin:String(departure[7]).toUpperCase(),destination:String(fallback.destination||'').toUpperCase(),
        bags:`${departure[1]}+${remainingPieces}`,pieces:`${departure[1]}+${remainingPieces}`,
        weight:totalWeight?`${String(departure[2]).replace(/,/g,'')}+${remainingWeight}/${totalWeight}`:String(departure[2]).replace(/,/g,''),
        masterPieces:totalPieces,masterWeight:totalWeight,flightNo:nextManifest?`${String(nextManifest[3]).toUpperCase()}${nextManifest[4]}`:`${String(departure[3]).toUpperCase()}${departure[4]}`,
        flightDate:nextManifest?parseDate(nextManifest[5]):parseDate(departure[5]),
        arrivalDate:nextManifest&&parseDate(nextManifest[5])?`${firstArrivalDate} / ${parseDate(nextManifest[5])}`:firstArrivalDate,
        arrivalDates:[firstArrivalDate,nextManifest?parseDate(nextManifest[5]):''].filter(Boolean),
        arrivalTime:firstArrivalTime,arrivalIsActual:true,status:'PART ARRIVED',
        arrivedPieces:String(departure[1]),arrivedWeight:String(departure[2]).replace(/,/g,''),
        remainingPieces:String(remainingPieces),remainingWeight:String(remainingWeight),
        nextFlightNo:nextManifest?`${String(nextManifest[3]).toUpperCase()}${nextManifest[4]}`:'',nextFlightDate:nextManifest?parseDate(nextManifest[5]):'',
        nextPieces:nextManifest?String(nextManifest[1]):'',nextWeight:nextManifest?String(nextManifest[2]).replace(/,/g,''):'',
        remarks:'Part load arrived',...masterBooking,departureEvidence:clean(departure[0]),nextManifestEvidence:nextManifest?clean(nextManifest[0]):''};
    }
    return{origin:String(departure[7]).toUpperCase(),destination:String(fallback.destination||'').toUpperCase(),bags:partial?`${departure[1]}/${masterPieces}`:(fallback.bags||fallback.pieces||departure[1]),pieces:partial?`${departure[1]}/${masterPieces}`:(fallback.pieces||fallback.bags||departure[1]),weight:partial&&totalWeight?`${String(departure[2]).replace(/,/g,'')}/${totalWeight}`:(fallback.weight||String(departure[2]).replace(/,/g,'')),masterPieces:totalPieces,masterWeight:totalWeight,flightNo:`${String(departure[3]).toUpperCase()}${departure[4]}`,flightDate:parseDate(departure[5]),departureTime:parseTime(departure[6]),arrivalIsActual:false,status:partial?'PART DEPARTED':'IN TRANSIT',departedPieces:String(departure[1]),departedWeight:String(departure[2]).replace(/,/g,''),remainingPieces:partial?String(masterPieces-departedPieces):'0',remainingWeight:partial&&totalWeight?String(Math.max(0,Number(totalWeight)-Number(String(departure[2]).replace(/,/g,'')))):'',nextFlightNo:nextManifest?`${String(nextManifest[3]).toUpperCase()}${nextManifest[4]}`:'',nextFlightDate:nextManifest?parseDate(nextManifest[5]):'',nextPieces:nextManifest?String(nextManifest[1]):'',nextWeight:nextManifest?String(nextManifest[2]).replace(/,/g,''):'',...masterBooking,departureEvidence:clean(departure[0]),nextManifestEvidence:nextManifest?clean(nextManifest[0]):''};
  }
  if(/\bDEPARTURE\s+Departed\b/i.test(timeline))return{weight:verifiedWeight,status:'IN TRANSIT'};

  // For pre-departure cargo, current physical quantity comes from the live
  // Freight On Hand / MANIFESTED event, not from the older BOOKED quantity.
  // Keep the regex scoped to the event itself so it can never jump forward and
  // accidentally pick a later "58 pcs" BOOKED line.
  const fowRx=/\b(?:FREIGHT\s+ON\s+HAND|FOW)\b\s*(?:Freight\s+on\s+hand\s*)?(\d{1,6})\s+(?:pcs|pieces)\s+([\d,.]+)\s*kg\b/gi;
  const fow=[...timeline.matchAll(fowRx)].find(m=>sameLoad(m[1],m[2]))||null;
  const fowStampRx=/\b(?:FREIGHT\s+ON\s+HAND|FOW)\b\s*(?:Freight\s+on\s+hand\s*)?(\d{1,6})\s+(?:pcs|pieces)\s+([\d,.]+)\s*kg[\s\S]{0,140}?\b([A-Z]{3})\s*[•·]\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s*,\s*(\d{1,2}:\d{2})(?::\d{2})?/gi;
  const fowStamped=[...timeline.matchAll(fowStampRx)].find(m=>sameLoad(m[1],m[2]))||null;
  const manifestRx=/\bMANIFESTED\s+Manifested\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\s+for\s+([A-Z0-9]{2})[- ]?(\d{2,4})[A-Z]?\s*,\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})\s+at\s+([A-Z]{3})\b/gi;
  const manifested=[...timeline.matchAll(manifestRx)].find(m=>sameLoad(m[1],m[2]))||null;

  if(fow||manifested){
    const pieces=String(fallback.pieces||fallback.bags||fow?.[1]||manifested?.[1]||'');
    const weight=String(fallback.weight||fow?.[2]||manifested?.[2]||'').replace(/,/g,'');
    const manifestFlight=manifested?`${String(manifested[3]).toUpperCase()}${manifested[4]}`:'';
    return{
      origin:String(fallback.origin||(manifested?.[6]||'')).toUpperCase(),
      destination:String(fallback.destination||'').toUpperCase(),
      bags:pieces,pieces,weight,
      flightNo:manifestFlight||fallback.flightNo||'',
      flightDate:manifested?parseDate(manifested[5]):'',
      bookingDate:masterBooking.bookingDate||(fowStamped?parseDate(fowStamped[4]):''),
      bookingTime:masterBooking.bookingTime||(fowStamped?parseTime(fowStamped[5]):''),
      bookingDateSource:masterBooking.bookingDateSource||(fowStamped?'Air India Freight On Hand event timestamp':''),
      arrivalIsActual:false,
      status:'BOOKED',
      activityMilestone:fow?'FREIGHT ON HAND':'MANIFESTED',
      freightOnHandEvidence:fow?clean(fow[0]):'',
      manifestEvidence:manifested?clean(manifested[0]):''
    };
  }

  // All pre-departure Air India milestones stay BOOKED. Use the event timestamp after the bullet as booking time; the earlier date after flight number is the planned flight date.
  const bookedEvent=masterBookedEvent;
  if(bookedEvent)return{origin:String(fallback.origin||bookedEvent[3]).toUpperCase(),destination:String(fallback.destination||'').toUpperCase(),bags:fallback.bags||fallback.pieces||bookedEvent[1],pieces:fallback.pieces||fallback.bags||bookedEvent[1],weight:fallback.weight||String(bookedEvent[2]).replace(/,/g,''),flightNo:`${String(bookedEvent[4]).toUpperCase()}${bookedEvent[5]}`,flightDate:parseDate(bookedEvent[6]),bookingDate:parseDate(bookedEvent[8]),bookingTime:parseTime(bookedEvent[9]),bookingDateSource:'Air India BOOKED event timestamp',status:'BOOKED'};
  const bookedSimpleRx=/\bBOOKED\s+Booked\s+(\d{1,6})\s+pcs\s+([\d,.]+)\s+kg\s+at\s+([A-Z]{3})\s+for\s+([A-Z0-9]{2})[- ]?(\d{2,4})[A-Z]?\s*,\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+20\d{2})/gi;
  const booked=[...timeline.matchAll(bookedSimpleRx)].find(m=>sameLoad(m[1],m[2]))||null;
  if(booked)return{origin:String(fallback.origin||booked[3]).toUpperCase(),destination:String(fallback.destination||'').toUpperCase(),bags:fallback.bags||fallback.pieces||booked[1],pieces:fallback.pieces||fallback.bags||booked[1],weight:fallback.weight||String(booked[2]).replace(/,/g,''),flightNo:`${String(booked[4]).toUpperCase()}${booked[5]}`,flightDate:parseDate(booked[6]),status:'BOOKED'};
  if(/\bMANIFESTED\b|\bMANIFEST\b|\bACCEPTED\b|\bBUILT\s+UP\b|\bEXECUTED\b|\bBOOKED\b/i.test(timeline))return{weight:verifiedWeight,status:'BOOKED'};
  return verifiedWeight?{weight:verifiedWeight}:{};
}

async function airIndiaFlightFallback(shipment={},flightDate=''){
  const flight=String(shipment.flightNo||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const m=flight.match(/^(AI|IX)0*(\d{2,4})$/);const d=String(flightDate||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if(!m||!d||!shipment.origin||!shipment.destination)return null;
  const url=`https://www.flightstats.com/v2/flight-tracker/${m[1]}/${Number(m[2])}?year=${d[1]}&month=${Number(d[2])}&date=${Number(d[3])}`;
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'},cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null;
    const plain=cleanHtml(await r.text());
    const idx=plain.search(/Flight Arrival Times/i);const block=idx>=0?plain.slice(idx,idx+1200):plain;
    const arrivalDate=parseDate(block);
    const scheduled=(block.match(/Scheduled\s+(\d{1,2}:\d{2})\s+(?:IST|UTC|GMT|[A-Z]{3}|[+-]\d{2})\b/i)||[])[1]||'';
    const actual=(block.match(/Actual\s+(\d{1,2}:\d{2})\s+(?:IST|UTC|GMT|[A-Z]{3})\b/i)||[])[1]||'';
    const estimated=(block.match(/Estimated\s+(\d{1,2}:\d{2})\s+(?:IST|UTC|GMT|[A-Z]{3})\b/i)||[])[1]||'';
    const arrived=/\b(?:Arrived|Landed)\b/i.test(plain);
    const arrivalTime=parseTime(actual||estimated||scheduled);
    if(!arrivalTime||!arrivalDate)return null;
    return{arrivalDate,arrivalTime,arrivalIsActual:Boolean(arrived&&actual),status:arrived&&actual?'ARRIVED':'IN TRANSIT',flightStatusUrl:url,flightStatusSource:'FlightStats destination schedule/status'};
  }catch{return null;}
}

function merge(base={},next={}){const out={...base};for(const[k,v]of Object.entries(next||{})){if(v!==''&&v!==null&&v!==undefined)out[k]=v;}return out;}
function useful(s={}){return Boolean((s.origin&&s.destination)||s.pieces||s.weight||s.flightNo||s.arrivalDate||s.arrivalTime||(s.status&&s.status!=='TRACKING'));}
async function launch(){chromium.setGraphicsMode=false;return puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},executablePath:await chromium.executablePath(),headless:'shell'});}
async function activityTimelineVisible(page){return page.evaluate(()=>/AWB\s+Activity\s+Timeline/i.test(document.body?.innerText||'')).catch(()=>false);}
async function openActivityView(page){
  const sel='[data-testid="tabs-panel__tab-activityView"]';let clicked=false;
  if(await page.$(sel)){
    await page.$eval(sel,el=>{el.scrollIntoView({block:'center'});el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));el.click();}).catch(()=>{});
    clicked=true;
  }
  let visible=await page.waitForFunction(()=>/AWB\s+Activity\s+Timeline/i.test(document.body?.innerText||''),{timeout:5000}).then(()=>true).catch(()=>false);
  if(!visible){
    const forced=await page.evaluate(()=>{
      const visibleEl=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
      const els=[...document.querySelectorAll('button,[role="tab"],[role="button"],a,span,div')];
      const e=els.filter(visibleEl).find(x=>/^Activity\s+View$/i.test(String(x.innerText||x.textContent||'').trim()));
      if(!e)return false;const target=e.closest('button,[role="tab"],[role="button"],a')||e;target.scrollIntoView({block:'center'});target.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));target.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;
    }).catch(()=>false);
    if(forced)clicked=true;
    visible=await page.waitForFunction(()=>/AWB\s+Activity\s+Timeline/i.test(document.body?.innerText||''),{timeout:7000}).then(()=>true).catch(()=>false);
  }
  if(!visible&&clicked){await sleep(1500);visible=await activityTimelineVisible(page);}
  return{clicked,visible};
}

export async function trackAirIndia(mawb){
  const digits=digitsOnly(mawb);if(!/^098\d{8}$/.test(digits))return{ok:false,reason:'INVALID AIR INDIA MAWB',officialTracker:START};
  let browser;
  try{
    browser=await launch();const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
    await page.goto(START,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#shipmentValue',{timeout:22000});
    const input=await page.$('#shipmentValue');
    if(!input)return{ok:false,reason:'AIR INDIA AWB INPUT NOT FOUND',officialTracker:START,debug:{stage:'input'}};
    await input.click({clickCount:3});await page.keyboard.press('Backspace');await input.type(digits,{delay:18});
    const nextSel='[data-testid="shipment-search-form-panel__submit-button"]';
    await page.waitForFunction(sel=>{const e=document.querySelector(sel);return e&&!e.disabled;},{timeout:7000},nextSel).catch(()=>{});
    const enabled=await page.$eval(nextSel,e=>!e.disabled).catch(()=>false);
    if(!enabled)return{ok:false,reason:'AIR INDIA NEXT BUTTON NOT ENABLED',officialTracker:START,debug:{stage:'next'}};
    await page.click(nextSel);
    await page.waitForFunction(serial=>String(document.body?.innerText||'').replace(/\D/g,'').includes(serial),{timeout:18000},digits.slice(3)).catch(()=>{});
    await sleep(1800);

    const summaryText=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
    const summary=parseSummary(summaryText,mawb);
    if(!summary.awbMatched)return{ok:false,reason:'AIR INDIA RESULT DID NOT MATCH MAWB',officialTracker:START,debug:{stage:'details',bodySample:summaryText.slice(0,2800)}};

    const summaryScreenshot=await page.screenshot({type:'jpeg',quality:82,fullPage:false,encoding:'base64'}).catch(()=>null);
    if(!summaryScreenshot)return{ok:false,reason:'AIR INDIA DETAILS SCREENSHOT FAILED',officialTracker:START,debug:{stage:'screenshot'}};

    const activityState=await openActivityView(page);
    let activityText='';let activityScreenshot=false;
    if(activityState.clicked){
      activityText=clean(await page.evaluate(()=>document.body?.innerText||'').catch(()=>''));
      activityScreenshot=Boolean(await page.screenshot({type:'jpeg',quality:80,fullPage:false,encoding:'base64'}).catch(()=>null));
    }
    const activity=parseActivity(activityText,summary);
    let shipment=merge(summary,activity);
    // Air India source hierarchy for split loads:
    // Tracking View/summary owns master totals and planned split pieces.
    // Activity View owns actual moved/arrived pieces, weight and actual timestamps.
    // Never invent split weight from Tracking View because that view exposes pieces only.
    if(summary.origin)shipment.origin=summary.origin;
    if(summary.destination)shipment.destination=summary.destination;
    // For split arrivals, parseActivity deliberately returns cumulative displays
    // such as 20/33 and 20+13/33. Do not overwrite them with the master summary.
    if(shipment.status!=='PART DEPARTED'&&shipment.status!=='PART ARRIVED'&&shipment.status!=='ARRIVED'){
      if(summary.pieces||summary.bags){shipment.pieces=summary.pieces||summary.bags;shipment.bags=summary.bags||summary.pieces;}
      if(summary.weight)shipment.weight=summary.weight;
    }
    let flightFallback=null;
    // Use FlightStats only for planned destination timing. It must never promote a
    // BOOKED shipment without a matching Air India Activity View departure/arrival.
    if(!shipment.arrivalIsActual&&shipment.flightNo&&shipment.origin&&shipment.destination&&!shipment.arrivalTime&&activity.flightDate){
      flightFallback=await airIndiaFlightFallback(shipment,activity.flightDate);
      if(flightFallback){const keepBooked=shipment.status==='BOOKED';shipment=merge(shipment,flightFallback);if(keepBooked){shipment.status='BOOKED';shipment.arrivalIsActual=false;}}
    }
    if(!shipment.arrivalIsActual&&(shipment.arrivalDate||shipment.arrivalTime)&&shipment.status!=='DELAYED'&&shipment.status!=='BOOKED')shipment.status='IN TRANSIT';
    if(shipment.status==='ARRIVED'&&!shipment.arrivalIsActual)shipment.status='IN TRANSIT';
    if((shipment.status==='PART DEPARTED'||shipment.status==='PART ARRIVED')&&shipment.remainingPieces&&shipment.remainingPieces!=='0'){
      const parts=[`Remaining ${shipment.remainingPieces} pcs`];
      if(shipment.remainingWeight)parts.push(`${shipment.remainingWeight} kg`);
      if(shipment.nextFlightNo)parts.push(shipment.nextFlightNo);
      if(shipment.nextFlightDate)parts.push(shipment.nextFlightDate);
      shipment.remarks=shipment.status==='PART ARRIVED'?'Part load arrived':parts.join(' / ');
    }
    shipment.officialTracker=START;
    shipment.source=activity.arrivalEvidence?'Air India Cargo details-screen screenshot + Activity View verification':flightFallback?`Air India Cargo Activity View + ${flightFallback.flightStatusSource}`:'Air India Cargo details-screen screenshot + same-screen extraction';

    if(!useful(shipment))return{ok:false,reason:'AIR INDIA DETAILS FOUND NO VERIFIED SHIPMENT FIELDS',officialTracker:START,screenshotCaptured:true,screenshotVerified:true,debug:{stage:'parse',summarySample:summaryText.slice(0,3000),activitySample:activityText.slice(0,3500)}};
    return{ok:true,shipment,screenshotCaptured:true,screenshotVerified:true,screenshotOcrUsed:false,debug:{stage:'done',startUrl:START,resultUrl:page.url(),awbMatched:true,activityClicked:activityState.clicked,activityTimelineVisible:activityState.visible,summaryScreenshot:true,activityScreenshot,summarySample:summaryText.slice(0,3000),activitySample:activityText.slice(0,3500),arrivalEvidence:activity.arrivalEvidence||'',departureEvidence:activity.departureEvidence||'',flightFallback:flightFallback||null}};
  }catch(e){return{ok:false,reason:e?.message||String(e),officialTracker:START,debug:{stage:'exception'}};}
  finally{try{if(browser)await browser.close()}catch{}}
}