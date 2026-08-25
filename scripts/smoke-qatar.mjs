import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/google-chrome';
if (!fs.existsSync(executablePath)) throw new Error(`Chrome not found: ${executablePath}`);

const browser = await puppeteer.launch({
  executablePath,
  headless:true,
  args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  defaultViewport:{width:1440,height:1050}
});

try {
  const page=await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
  await page.goto('https://www.qrcargo.com/s/track-your-shipment',{waitUntil:'domcontentloaded',timeout:30000});
  await new Promise(r=>setTimeout(r,4000));

  const metadata=await page.evaluate(()=>{
    const rows=[];
    const seen=new Set();
    const walk=(root,scope='document')=>{
      if (!root?.querySelectorAll) return;
      for (const el of root.querySelectorAll('lightning-input,lightning-base-combobox,input[type="text"],button')) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r=el.getBoundingClientRect();
        const rootNode=el.getRootNode();
        const host=rootNode instanceof ShadowRoot ? rootNode.host : null;
        rows.push({
          scope,
          tag:el.tagName,
          label:el.label||el.getAttribute('label')||'',
          type:el.type||el.getAttribute('type')||'',
          name:el.name||el.getAttribute('name')||'',
          value:String(el.value??el.getAttribute('value')??'').slice(0,30),
          maxLength:Number(el.maxLength??el.getAttribute('maxlength')??-1),
          placeholder:el.placeholder||el.getAttribute('placeholder')||'',
          text:String(el.innerText||'').replace(/\s+/g,' ').trim().slice(0,80),
          visible:r.width>3&&r.height>3,
          host:host?.tagName||''
        });
      }
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot,`${scope}>${el.tagName.toLowerCase()}`);
    };
    walk(document);
    return rows;
  });

  console.log(JSON.stringify(metadata,null,2));
  if (!metadata.some(x=>x.visible&&/lightning-input|input/i.test(x.tag))) process.exitCode=1;
} finally {
  await browser.close();
}
