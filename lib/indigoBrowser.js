import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const URL='https://6ecargo.goindigo.in/FrmAWBTracking.aspx';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function launchBrowser(){
  chromium.setGraphicsMode=false;
  const executablePath=await chromium.executablePath();
  return puppeteer.launch({
    args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--lang=en-IN,en'],
    defaultViewport:{width:1365,height:1000,deviceScaleFactor:1},
    executablePath,
    headless:'shell'
  });
}

export async function fetchIndigoWithBrowser(serial=''){
  let browser;
  try{
    browser=await launchBrowser();
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-IN,en;q=0.9'});
    await page.evaluateOnNewDocument(()=>{
      try{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});}catch{}
      try{Object.defineProperty(navigator,'languages',{get:()=>['en-IN','en']});}catch{}
      try{window.chrome=window.chrome||{runtime:{}};}catch{}
    });

    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#txtPrefix',{visible:true,timeout:12000});
    await page.waitForSelector('#TextBoxAWBno',{visible:true,timeout:12000});

    const fill=async(selector,value)=>{
      await page.click(selector,{clickCount:3});
      await page.keyboard.press('Backspace');
      await page.type(selector,String(value),{delay:90});
      await page.$eval(selector,el=>{
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        el.blur();
      });
    };

    await fill('#txtPrefix','312');
    await fill('#TextBoxAWBno',serial);
    const entered=await page.evaluate(()=>({
      prefix:document.querySelector('#txtPrefix')?.value||'',
      awb:document.querySelector('#TextBoxAWBno')?.value||''
    }));

    const button=await page.$('#ButtonGO');
    if(!button)return{ok:false,reason:'INDIGO TRACK BUTTON NOT FOUND',debug:{entered}};

    await Promise.allSettled([
      page.waitForNavigation({waitUntil:'domcontentloaded',timeout:15000}),
      button.click({delay:120})
    ]);

    let html='';
    let text='';
    for(let i=0;i<14;i++){
      await sleep(i===0?1200:650);
      html=await page.content();
      text=await page.evaluate(()=>document.body?.innerText||'').catch(()=> '');
      if(/AWB\s*:?\s*312[- ]?\d{8}|ARRIVED|DEPARTED|BOOKED|MANIFESTED|RECEIVED FROM FLIGHT|\b6E\s*\d{2,4}\b/i.test(text) && !/AWB Details not available/i.test(text)){
        return{ok:true,html,debug:{stage:'SUCCESS_BROWSER',entered,preview:text.slice(0,5000)}};
      }
    }

    return{
      ok:false,
      reason:/AWB Details not available/i.test(text)?'INDIGO BROWSER FLOW SAYS AWB DETAILS NOT AVAILABLE':'INDIGO BROWSER FLOW RETURNED NO SHIPMENT DETAILS',
      html,
      debug:{stage:'BROWSER_NO_FIELDS',entered,preview:text.slice(0,5000)}
    };
  }catch(e){
    return{ok:false,reason:`INDIGO BROWSER ERROR: ${e?.message||e}`,debug:{stage:'BROWSER_ERROR'}};
  }finally{
    try{if(browser)await browser.close();}catch{}
  }
}
