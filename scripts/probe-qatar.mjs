import puppeteer from 'puppeteer-core';

const url = 'https://www.qrcargo.com/s/track-your-shipment';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
});

try {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
  await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 5000));

  const result = await page.evaluate(() => {
    const rows = [];
    const seen = new Set();
    const walk = (root, where='document') => {
      if (!root?.querySelectorAll) return;
      for (const el of root.querySelectorAll('input,button,[role="button"]')) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) continue;
        rows.push({
          where,
          tag: el.tagName,
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          aria: el.getAttribute('aria-label') || '',
          text: String(el.innerText || el.value || '').replace(/\s+/g,' ').trim(),
          maxLength: Number(el.maxLength || -1),
          disabled: Boolean(el.disabled),
          readOnly: Boolean(el.readOnly)
        });
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot, 'shadow-root');
      }
    };
    walk(document);
    return {
      title: document.title,
      bodyPreview: (document.body?.innerText || '').replace(/\s+/g,' ').slice(0,1200),
      controls: rows
    };
  });

  console.log('QATAR_PROBE_RESULT=' + JSON.stringify(result));
  const hasLikelyAwb = result.controls.some(c => /awb|air waybill|shipment|prefix|number/i.test(`${c.name} ${c.id} ${c.placeholder} ${c.aria}`) || c.maxLength === 3 || c.maxLength === 8);
  const hasTrack = result.controls.some(c => /track shipment|track|search/i.test(c.text));
  console.log(`QATAR_PROBE_SUMMARY inputs=${result.controls.filter(c=>c.tag==='INPUT').length} hasLikelyAwb=${hasLikelyAwb} hasTrack=${hasTrack}`);
  if (!hasLikelyAwb || !hasTrack) process.exitCode = 2;
} finally {
  await browser.close();
}
