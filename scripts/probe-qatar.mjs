import puppeteer from 'puppeteer-core';

const url = 'https://www.qrcargo.com/s/track-your-shipment';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
});

async function deepEls(page, selector) {
  const handle = await page.evaluateHandle(sel => {
    const out = [], seen = new Set();
    const walk = root => {
      if (!root?.querySelectorAll) return;
      for (const el of root.querySelectorAll(sel)) {
        if (!seen.has(el)) { seen.add(el); out.push(el); }
      }
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return out;
  }, selector);
  const props = await handle.getProperties();
  const out = [];
  for (const prop of props.values()) {
    const el = prop.asElement();
    if (el) out.push(el);
  }
  await handle.dispose();
  return out;
}

try {
  const page = await browser.newPage();
  const network = [];
  page.on('response', r => {
    const u = r.url();
    if (/(track|shipment|cargo|aura|apex|croamis)/i.test(u)) network.push({status:r.status(), url:u});
  });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
  await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 5000));

  const inputs = await deepEls(page, 'input[type="text"]');
  const visible = [];
  for (const el of inputs) {
    const meta = await el.evaluate(x => {
      const r = x.getBoundingClientRect();
      return {visible:r.width>3&&r.height>3&&!x.disabled&&!x.readOnly,value:String(x.value||''),maxLength:Number(x.maxLength||-1)};
    });
    if (meta.visible) visible.push({el,meta});
  }
  const prefix = visible.find(x => x.meta.maxLength === 3 || x.meta.value === '157');
  const number = prefix ? visible.find(x => x !== prefix) : null;
  if (!prefix || !number) throw new Error(`Expected Qatar prefix+number fields, found ${visible.length}`);

  await number.el.click({clickCount:3});
  await page.keyboard.press('Backspace');
  await number.el.type('00000000', {delay:55});
  const typed = await number.el.evaluate(x => String(x.value||''));

  const buttons = await deepEls(page, 'button,[role="button"]');
  let clicked = false;
  for (const b of buttons) {
    const meta = await b.evaluate(x => {
      const r = x.getBoundingClientRect();
      return {visible:r.width>3&&r.height>3&&!x.disabled,text:String(x.innerText||x.value||x.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()};
    });
    if (meta.visible && /track shipment/i.test(meta.text)) {
      await b.click({delay:70});
      clicked = true;
      break;
    }
  }
  await new Promise(r => setTimeout(r, 5000));
  const body = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g,' ').slice(0,1600));
  console.log('QATAR_SUBMIT_PROBE=' + JSON.stringify({typed,clicked,network:network.slice(-12),bodyPreview:body}));
  if (typed !== '00000000' || !clicked) process.exitCode = 2;
} finally {
  await browser.close();
}
