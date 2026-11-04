import {cleanJepoTrackingNo,validateJepoLiveResult} from './jepoBranchTracking.js';
export async function readJepoTrackingBatch(numbers=[]){
 const awbs=[...new Set(numbers.map(cleanJepoTrackingNo).filter(Boolean))].slice(0,8);
 if(!awbs.length)return [];
 const chromium=(await import('@sparticuz/chromium')).default;
 const puppeteer=(await import('puppeteer-core')).default;
 const browser=await puppeteer.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true,protocolTimeout:60000});
 try{
  const page=await browser.newPage(),results=[];
  for(const awb of awbs){
   try{
    const response=await page.goto('https://jepoexpress.com/track',{waitUntil:'domcontentloaded',timeout:27000});
    if(response?.status()>=400)throw Error('JEPO website HTTP '+response.status());
    await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(x=>/awb|tracking|waybill/i.test(x.placeholder||'')),{timeout:13000});
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
    await page.waitForFunction(number=>{
      const body=document.body?.innerText||'';
      return body.toUpperCase().replace(/\s/g,'').includes(number)&&/\bStatus\s*:/i.test(body)&&/\bProgress\b/i.test(body);
    },{timeout:25000,polling:400},awb);
    const snapshot=await page.evaluate(()=>{
      const bodyText=(document.body?.innerText||'').slice(0,30000);
      const status=(bodyText.match(/\bStatus\s*:\s*(?:\n\s*)?([^\n\r]+)/i)?.[1]||'').trim();
      let latestProgress='';
      for(const table of document.querySelectorAll('table')){
       if(!/Progress/i.test(table.querySelector('thead')?.innerText||table.querySelector('tr')?.innerText||''))continue;
       const row=table.querySelector('tbody tr')||table.querySelectorAll('tr')[1];
       const cells=[...(row?.querySelectorAll('td,[role=cell]')||[])].map(x=>x.innerText.trim()).filter(Boolean);
       if(cells.length>1){latestProgress=cells[cells.length-1];break;}
      }
      return {bodyText,status,latestProgress};
    });
    results.push({ok:true,...validateJepoLiveResult(snapshot,awb)});
   }catch(e){results.push({ok:false,awb,error:String(e?.message||e).slice(0,240)});}
  }
  return results;
 }finally{await browser.close().catch(()=>{});}
}
