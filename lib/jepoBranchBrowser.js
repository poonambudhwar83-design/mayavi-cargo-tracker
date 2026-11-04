import {cleanJepoTrackingNo,validateJepoLiveResult} from './jepoBranchTracking.js';
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
   const page=await browser.newPage();
   try{
    while(true){
     const index=cursor++;
     if(index>=awbs.length)break;
     const awb=awbs[index];
   try{
    const response=await page.goto('https://jepoexpress.com/track',{waitUntil:'domcontentloaded',timeout:27000});
    if(response?.status()>=400)throw Error('JEPO website HTTP '+response.status());
    await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(x=>/awb|tracking|waybill/i.test(x.placeholder||'')),{timeout:13000});
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
    await page.waitForFunction(previous=>{
      const body=document.body?.innerText||'';
      const forward=body.match(/\b(?:Fwd|Forwarding|AWB)\s*No\s*:\s*([A-Z0-9-]+)/i);
      const status=body.match(/\bStatus\s*:\s*(?:\n\s*)?([^\n\r]+)/i);
      const progress=[...document.querySelectorAll('table')].some(table=>{
        if(!/Progress/i.test(table.querySelector('thead')?.innerText||table.querySelector('tr')?.innerText||''))return false;
        const row=table.querySelector('tbody tr')||table.querySelectorAll('tr')[1];
        return (row?.querySelectorAll('td,[role=cell]').length||0)>=2;
      });
      return body!==previous&&Boolean(forward?.[1])&&Boolean(status?.[1]?.trim())&&progress;
    },{timeout:25000,polling:400},beforeResult);
    const snapshot=await page.evaluate(()=>{
      const bodyText=(document.body?.innerText||'').slice(0,30000);
      const status=(bodyText.match(/\bStatus\s*:\s*(?:\n\s*)?([^\n\r]+)/i)?.[1]||'').trim();
      let latestProgress='';
      let deliveredScanDate='';
      for(const table of document.querySelectorAll('table')){
       if(!/Progress/i.test(table.querySelector('thead')?.innerText||table.querySelector('tr')?.innerText||''))continue;
       const allRows=[...table.querySelectorAll('tbody tr')];
       const entries=(allRows.length?allRows:[...table.querySelectorAll('tr')].slice(1))
         .map(row=>[...row.querySelectorAll('td,[role="cell"]')].map(cell=>(cell.innerText||'').trim()));
       const first=entries.find(cells=>cells.length>1&&cells[cells.length-1]);
       if(first)latestProgress=first[first.length-1];
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
      return {bodyText,status,latestProgress,deliveredScanDate};
    });
    const validated={ok:true,...validateJepoLiveResult({...snapshot,submittedAwb:awb,freshResult:true},awb)};
    results[index]=validated;
   }catch(e){results[index]={ok:false,awb,error:String(e?.message||e).slice(0,240)};}
   // Persist each verified result immediately: even if one website request
   // hangs or the function reaches its time limit, completed rows remain saved.
   if(typeof onResult==='function')await onResult(results[index]);
    }
   }finally{await page.close().catch(()=>{});}
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,Math.floor(concurrency)||1),8,awbs.length)},()=>worker()));
  return results;
 }finally{await browser.close().catch(()=>{});}
}
