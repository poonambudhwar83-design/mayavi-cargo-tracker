import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const URL='https://airasia.smartkargo.com/FrmAWBTracking.aspx';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function fetchAirAsiaWithBrowser(serial=''){
  if(!/^\d{8}$/.test(String(serial)))return {ok:false,reason:'INVALID AIRASIA AWB SERIAL'};
  let browser;
  try{
    chromium.setGraphicsMode=false;
    const executablePath=await chromium.executablePath();
    browser=await puppeteer.launch({
      args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--lang=en-IN,en'],
      executablePath,headless:'shell',
      defaultViewport:{width:1365,height:1000,deviceScaleFactor:1}
    });
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-IN,en;q=0.9'});
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#txtPrefix',{visible:true,timeout:12000});
    await page.waitForSelector('#TextBoxAWBno',{visible:true,timeout:12000});
    const setInput=async(selector,value)=>{
      await page.click(selector,{clickCount:3});
      await page.keyboard.press('Backspace');
      await page.type(selector,value,{delay:45});
      await page.$eval(selector,el=>{
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        el.blur();
      });
    };
    await setInput('#txtPrefix','807');
    await setInput('#TextBoxAWBno',String(serial));
    const entered=await page.evaluate(()=>({
      prefix:document.querySelector('#txtPrefix')?.value||'',
      awb:document.querySelector('#TextBoxAWBno')?.value||''
    }));
    if(entered.prefix.trim()!=='807'||entered.awb.trim()!==String(serial))
      return {ok:false,reason:'AIRASIA FORM VALUES NOT ENTERED',debug:{stage:'INPUT_MISMATCH',entered}};
    const button=await page.$('#ButtonGO');
    if(!button)return{ok:false,reason:'AIRASIA RED TRACK BUTTON NOT FOUND',debug:{stage:'TRACK_BUTTON_MISSING'}};
    await Promise.allSettled([
      page.waitForNavigation({waitUntil:'domcontentloaded',timeout:18000}),
      button.click({delay:110})
    ]);
    let html='',text='';
    for(let i=0;i<12;i++){
      await sleep(i===0?1200:750);
      text=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
      html=await page.content();
      const noDetails=/AWB\s+Details\s+not\s+available|no\s+records\s+found|invalid\s+awb/i.test(text);
      const match=new RegExp('\\b(?:807\\s*[- ]\\s*)?'+serial+'\\b').test(text);
      const trackingBody=/(?:booking|shipment|movement|status history|flight|pieces|weight|origin|destination|departed|arrived)/i.test(text);
      if(match&&trackingBody&&!noDetails)
        return {ok:true,html,debug:{stage:'AIRASIA_BROWSER_RESULT',entered,match:true,hasTable:/<table\b/i.test(html),pageLength:text.length,
          preview:text.slice(0,1500)}};
      if(noDetails&&i>5)break;
    }
    return {ok:false,reason:/AWB\s+Details\s+not\s+available/i.test(text)
      ?'AIRASIA OFFICIAL PAGE SAYS AWB DETAILS NOT AVAILABLE'
      :'AIRASIA TRACK RETURNED NO VERIFIED SHIPMENT DETAILS',
      debug:{stage:'NO_VERIFIED_RESULT',entered,hasAwb:text.includes(serial),pageLength:text.length,
        preview:text.slice(0,1000)}};
  }catch(e){
    return{ok:false,reason:'AIRASIA BROWSER FLOW: '+String(e?.message||e),debug:{stage:'BROWSER_ERROR'}};
  }finally{try{await browser?.close()}catch{}}
}
