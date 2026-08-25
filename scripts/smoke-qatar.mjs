import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/google-chrome';
if (!fs.existsSync(executablePath)) throw new Error(`Chrome not found: ${executablePath}`);

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 1050 }
});

try {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
  await page.goto('https://www.qrcargo.com/s/track-your-shipment', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3500));

  const metadata = await page.evaluate(() => {
    const rows = [];
    const seen = new Set();
    const walk = (root, scope = 'document') => {
      if (!root?.querySelectorAll) return;
      for (const el of root.querySelectorAll('input,textarea,button,[role="button"]')) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        rows.push({
          scope,
          tag: el.tagName,
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          aria: el.getAttribute('aria-label') || '',
          title: el.title || '',
          maxLength: Number(el.maxLength || 0),
          readOnly: Boolean(el.readOnly),
          disabled: Boolean(el.disabled),
          visible: r.width > 3 && r.height > 3,
          value: String(el.value || '').slice(0, 20),
          text: String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        });
      }
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, `${scope}>${el.tagName.toLowerCase()}`);
    };
    walk(document);
    return rows;
  });

  console.log(JSON.stringify(metadata, null, 2));
  if (!metadata.some(x => x.tag === 'INPUT' && x.visible)) process.exitCode = 1;
} finally {
  await browser.close();
}
