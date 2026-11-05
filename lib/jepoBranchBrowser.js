import {cleanJepoTrackingNo,validateJepoLiveResult} from './jepoBranchTracking.js';

const isTransientBrowserError=error=>/detached Frame|frame got detached|Navigating frame was detached|Execution context was destroyed|Cannot find context|Cannot find execution context|Target closed|Session closed|Navigation timeout|timed out|waiting failed/i.test(String(error?.message||error));

// Poll against the CURRENT page frame. Puppeteer's waitForFunction is bound to
// the frame where it started, so JEPO's navigation on Track can detach it.
export async function waitForJepoInput(page){
 const deadline=Date.now()+15000;
 let consecutiveDetachments=0;
 while(Date.now()<deadline){
  if(page.isClosed())throw Error('JEPO browser page closed before tracking form appeared.');
  try{
   const found=await page.evaluate(()=>[...document.querySelectorAll('input')].some(x=>/awb|tracking|waybill/i.test(x.placeholder||'')));
   consecutiveDetachments=0;
   if(found)return;
  }catch(error){
   if(!isTransientBrowserError(error))throw error;
   if(++consecutiveDetachments>=5)throw Error('JEPO tracking form frame repeatedly detached.');
  }
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw Error('JEPO tracking form timed out after 15000ms.');
}

export async function waitForJepoResult(page,beforeResult){
 const deadline=Date.now()+26000;
 let consecutiveDetachments=0;
 while(Date.now()<deadline){
  if(page.isClosed())throw Error('JEPO browser page closed during tracking.');
  try{
   const snapshot=await page.evaluate(previous=>{
    const bodyText=(document.body?.innerText||'').slice(0,30000);
    const status=(bodyText.match(/\bStatus\s*:\s*(?:\n\s*)?([^\n\r]+)/i)?.[1]||'').trim();
    const forwarded=bodyText.match(/\b(?:Fwd|Forwarding|AWB)\s*No\s*:\s*([A-Z0-9-]+)/i);
    let latestProgress='',latestEventWhen='',deliveredScanDate='',hasTimeline=false;
    for(const table of document.querySelectorAll('table')){
     if(!/Progress/i.test(table.querySelector('thead')?.innerText||table.querySelector('tr')?.innerText||''))continue;
     const headers=[...table.querySelectorAll('thead th,thead td')].map(cell=>(cell.innerText||'').trim());
     const allRows=[...table.querySelectorAll('tbody tr')];
     const entries=(allRows.length?allRows:[...table.querySelectorAll('tr')].slice(1))
      .map(row=>[...row.querySelectorAll('td,[role="cell"]')].map(cell=>(cell.innerText||'').trim()));
     const first=entries.find(cells=>cells.length>1&&cells[cells.length-1]);
     if(first){
      latestProgress=first[first.length-1];hasTimeline=true;
      // Status timestamp belongs to JEPO timeline, not the current refresh.
      const useTime=first.length>=4||/time/i.test(headers[1]||'');
      latestEventWhen=[first[0],...(useTime?[first[1]]:[])].filter(Boolean).join(' ').slice(0,120);
     }
     for(const cells of entries){
      if(cells.length<2)continue;
      const progress=String(cells[cells.length-1]||'');
      if(/\b(?:not delivered|undelivered|delivery failed|attempted delivery)\b/i.test(progress))continue;
      if(/\b(?:delivered|delivery completed|proof of delivery|signed for)\b/i.test(progress)){
       deliveredScanDate=String(cells[0]||'')+' '+String(cells[1]||'');
       break;
      }
     }
     break;
    }
    return {bodyText,status,latestProgress,latestEventWhen,deliveredScanDate,
     freshResult:bodyText!==previous&&Boolean(forwarded?.[1])&&Boolean(status)&&hasTimeline};
   },beforeResult);
   consecutiveDetachments=0;
   if(snapshot.freshResult)return snapshot;
  }catch(error){
   if(!isTransientBrowserError(error))throw error;
   // Some navigation transitions need a few polls; a permanently detached
   // worker must be discarded and replaced rather than poisoning the queue.
   if(++consecutiveDetachments>=5)throw Error('JEPO browser frame repeatedly detached: '+String(error?.message||error).slice(0,130));
  }
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw Error('JEPO tracking timed out after 26000ms waiting for fresh result.');
}

export async function readJepoTrackingBatch(numbers=[],onResult=null,{concurrency=8}={}){
 const awbs=[...new Set(numbers.map(cleanJepoTrackingNo).filter(Boolean))].slice(0,240);
 if(!awbs.length)return [];
 const chromium=(await import('@sparticuz/chromium')).default;
 const puppeteer=(await import('puppeteer-core')).default;
 const browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true,protocolTimeout:60000});
 try{
  // Independent tabs avoid serial website waits. One browser instance limits
  // memory use while each page is isolated from another AWB's results.
  const results=new Array(awbs.length);
  let cursor=0;
  async function worker(){
   let page=null;
   try{
    while(true){
     const index=cursor++;
     if(index>=awbs.length)break;
     const awb=awbs[index];
   for(let attempt=0;attempt<2;attempt++){
   try{
    if(!page||page.isClosed())page=await browser.newPage();
    const response=await page.goto('https://jepoexpress.com/track',{waitUntil:'domcontentloaded',timeout:27000});
    if(response?.status()>=400)throw Error('JEPO website HTTP '+response.status());
    await waitForJepoInput(page);
    const beforeResult=await page.evaluate(()=>document.body?.innerText||'');
    const submitted=await page.evaluate(number=>{
      const input=[...document.querySelectorAll('input')].find(x=>/awb|tracking|waybill/i.test(x.placeholder||''));
      if(!input)return false;
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      setter.call(input,number);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      const form=input.closest('form');
      const buttons=[...(form||document).querySelectorAll('button,input[type="submit"]')];
      const button=buttons.find(x=>/^(track|track now|track shipment)$/i.test((x.innerText||x.value||'').trim()))||[...document.querySelectorAll('button')].find(x=>/^track$/i.test(x.innerText.trim()));
      if(button){button.click();return true;}
      if(form){form.requestSubmit();return true;}
      return false;
    },awb);
    if(!submitted)throw Error('Track control not found.');
    const snapshot=await waitForJepoResult(page,beforeResult);
    const validated={ok:true,...validateJepoLiveResult({...snapshot,submittedAwb:awb,freshResult:true},awb)};
    results[index]=validated;
    break;
   }catch(error){
    const message=String(error?.message||error).slice(0,240);
    const transient=isTransientBrowserError(error)||page?.isClosed();
    if(transient){
     // A detached frame remains unusable for all later AWBs. Create an
     // isolated tab for this same AWB, then continue with a healthy tab.
     await page?.close().catch(()=>{});
     page=null;
    }
    if(attempt===0&&transient)continue;
    results[index]={ok:false,awb,error:message};
    break;
   }
   }
   // Persist each verified result immediately: even if one website request
   // hangs or the function reaches its time limit, completed rows remain saved.
   if(typeof onResult==='function')await onResult(results[index]);
    }
   }finally{await page?.close().catch(()=>{});}
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,Math.floor(concurrency)||1),8,awbs.length)},()=>worker()));
  return results;
 }finally{await browser.close().catch(()=>{});}
}
