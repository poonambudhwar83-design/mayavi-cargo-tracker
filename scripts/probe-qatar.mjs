import puppeteer from 'puppeteer-core';

const url = 'https://www.qrcargo.com/s/track-your-shipment';
const sleep = ms => new Promise(r => setTimeout(r, ms));
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

async function visibleTextInputs(page) {
  const inputs = await deepEls(page, 'input[type="text"],input:not([type])');
  const visible = [];
  for (const el of inputs) {
    try {
      const meta = await el.evaluate(x => {
        const r = x.getBoundingClientRect();
        return {
          visible: r.width > 3 && r.height > 3 && !x.disabled && !x.readOnly,
          value: String(x.value || ''),
          maxLength: Number(x.maxLength || -1),
          hint: `${x.placeholder || ''} ${x.name || ''} ${x.id || ''} ${x.getAttribute('aria-label') || ''}`
        };
      });
      if (meta.visible) visible.push({el, meta});
    } catch {}
  }
  return visible;
}

async function replaceValue(page, el, value) {
  await el.click({clickCount: 3});
  await page.keyboard.press('Backspace');
  await el.type(value, {delay: 55});
  return el.evaluate(x => String(x.value || ''));
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
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:45000});
  await sleep(5000);

  let visible = await visibleTextInputs(page);
  let prefix = visible.find(x => x.meta.maxLength === 3 || x.meta.value === '157' || /prefix/i.test(x.meta.hint));
  let number = prefix ? visible.find(x => x !== prefix) : null;
  let dynamicPrefix = false;

  if (prefix && !number) {
    dynamicPrefix = true;
    const prefixTyped = await replaceValue(page, prefix.el, '157');
    if (prefixTyped !== '157') throw new Error(`Qatar prefix did not stick: ${prefixTyped}`);
    await page.keyboard.press('Tab');
    await sleep(1500);
    visible = await visibleTextInputs(page);
    prefix = visible.find(x => x.meta.maxLength === 3 || x.meta.value === '157' || /prefix/i.test(x.meta.hint));
    number = prefix ? visible.find(x => x !== prefix) : null;
  }

  if (!prefix || !number) {
    throw new Error(`Expected Qatar prefix+number fields after prefix confirmation, found ${visible.length}`);
  }

  const typed = await replaceValue(page, number.el, '00000000');

  const buttons = await deepEls(page, 'button,input[type="submit"],[role="button"]');
  let clicked = false;
  let buttonText = '';
  for (const b of buttons) {
    try {
      const meta = await b.evaluate(x => {
        const r = x.getBoundingClientRect();
        return {
          visible:r.width>3 && r.height>3 && !x.disabled,
          text:String(x.innerText || x.value || x.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim()
        };
      });
      if (meta.visible && /track shipment/i.test(meta.text)) {
        await b.click({delay:70});
        clicked = true;
        buttonText = meta.text;
        break;
      }
    } catch {}
  }

  await sleep(6000);
  const body = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g,' ').slice(0,1800));
  console.log('QATAR_SUBMIT_PROBE=' + JSON.stringify({
    dynamicPrefix,
    visibleInputsAfterPrefix: visible.length,
    typed,
    clicked,
    buttonText,
    network: network.slice(-15),
    bodyPreview: body
  }));

  if (typed !== '00000000' || !clicked) process.exitCode = 2;
} finally {
  await browser.close();
}
