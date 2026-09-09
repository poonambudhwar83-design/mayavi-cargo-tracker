from pathlib import Path

path = Path('lib/turkish.js')
s = path.read_text()
if 'TK_SMART_TARGET_V2' in s:
    print('already applied')
    raise SystemExit(0)

def replace_between(text, start_marker, end_marker, replacement):
    a = text.index(start_marker)
    b = text.index(end_marker, a)
    return text[:a] + replacement.rstrip() + '\n\n' + text[b:]

read_dom = r'''async function readDomResult(page, mawb) {
  // TK_SMART_TARGET_V2: read the result card under the TK SMART heading.
  const serial = digitsOnly(mawb).slice(3);
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate(awb => {
        const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
        const visible = el => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 3 && r.height > 3 && st.display !== 'none' && st.visibility !== 'hidden';
        };
        const roots = [document];
        const addShadows = root => {
          for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { roots.push(el.shadowRoot); addShadows(el.shadowRoot); }
        };
        addShadows(document);
        const blocks = [];
        for (const root of roots) {
          const nodes = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,section,article,main,div,table,tbody,tr,ul,ol')];
          const tk = nodes.find(el => visible(el) && /^TK\s*SMART$/i.test(norm(el.innerText || el.textContent || '')));
          if (tk) {
            tk.scrollIntoView({ block: 'start', behavior: 'auto' });
            let container = tk;
            for (let i = 0; i < 8 && container?.parentElement; i++) {
              const parent = container.parentElement;
              const t = norm(parent.innerText || parent.textContent || '');
              if (t.length >= 60 && t.length <= 50000) blocks.push(t);
              container = parent;
            }
            let sib = tk.nextElementSibling;
            for (let i = 0; sib && i < 12; i++, sib = sib.nextElementSibling) {
              const t = norm(sib.innerText || sib.textContent || '');
              if (t) blocks.push(t);
            }
          }
          for (const el of nodes) {
            if (!visible(el)) continue;
            const t = norm(el.innerText || el.textContent || '');
            if (t.length < 50 || t.length > 50000) continue;
            const details = /FROM|ORIGIN|TO|DESTINATION|PIECE|PCS|KG|WEIGHT|VOLUME|FLIGHT|DLV|DELIVERED|RCF|DEP/i.test(t);
            if ((t.includes(awb) || /TK\s*SMART/i.test(t)) && details) blocks.push(t);
          }
        }
        const unique = [...new Set(blocks)].sort((a,b) => a.length - b.length);
        return unique.find(t => /FROM|ORIGIN|TO|DESTINATION|PIECE|PCS|KG|WEIGHT|VOLUME|FLIGHT|DLV|DELIVERED|RCF|DEP/i.test(t)) || unique.at(-1) || '';
      }, serial);
      if (text) {
        const parsed = parseTkSmart(text, mawb);
        if (parsed?.useful || parsed?.notFound) return { parsed, text };
      }
    } catch {}
  }
  return null;
}'''

position = r'''async function positionTrackingArea(page) {
  let mode = 'NOT_FOUND';
  for (const frame of page.frames()) {
    try {
      const hit = await frame.evaluate(() => {
        const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
        const visible = el => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 3 && r.height > 3 && st.display !== 'none' && st.visibility !== 'hidden';
        };
        const scan = root => {
          for (const el of root.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,section,article')) {
            if (!visible(el)) continue;
            const t = norm(el.innerText || el.textContent || '');
            if (/^TK\s*SMART$/i.test(t)) return { el, mode: 'TK_SMART' };
            if (el.shadowRoot) { const nested = scan(el.shadowRoot); if (nested) return nested; }
          }
          return null;
        };
        let target = scan(document);
        if (!target) {
          const el = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,section,div,p,span')].find(x => {
            if (!visible(x)) return false;
            const t = norm(x.innerText || x.textContent || '').toLowerCase();
            return t === 'cargo tracking information' || t.startsWith('cargo tracking information ');
          });
          if (el) target = { el, mode: 'CARGO_TRACKING_INFORMATION' };
        }
        if (!target) return '';
        target.el.scrollIntoView({ block: 'start', behavior: 'auto' });
        window.scrollBy({ top: target.mode === 'TK_SMART' ? 180 : 560, left: 0, behavior: 'auto' });
        return target.mode;
      });
      if (hit) { mode = hit; break; }
    } catch {}
  }
  if (mode === 'NOT_FOUND') for (const frame of page.frames()) try { await frame.evaluate(() => window.scrollBy({ top: 900, left: 0, behavior: 'auto' })); } catch {}
  await sleep(900);
  return mode;
}'''

ocr = r'''async function screenshotOcr(page, mawb) {
  const positionMode = await positionTrackingArea(page);
  let worker;
  const samples = [];
  try {
    worker = await createWorker('eng');
    for (let i = 0; i < 5; i++) {
      if (i) {
        const step = i === 1 ? 260 : 430;
        for (const frame of page.frames()) try { await frame.evaluate(y => window.scrollBy({ top: y, left: 0, behavior: 'auto' }), step); } catch {}
        await sleep(600);
      }
      const image = await page.screenshot({ type: 'png', fullPage: false });
      const result = await worker.recognize(image);
      const text = result?.data?.text || '';
      const flat = clean(text);
      samples.push(`[${positionMode}#${i+1}] ${flat.slice(0, 5000)}`);
      const parsed = parseTkSmart(text, mawb);
      if (parsed?.notFound) return { notFound: true, samples };
      if (parsed?.useful) {
        parsed.shipment.source = 'Turkish Cargo TK SMART screenshot OCR / Cargo Tracking Information';
        return { parsed, samples, screenshotIndex: i + 1, positionMode };
      }
    }
    return { samples, positionMode };
  } catch (error) {
    return { samples, positionMode, error: error?.message || 'OCR failed' };
  } finally {
    if (worker) try { await worker.terminate(); } catch {}
  }
}'''

s = replace_between(s, 'async function readDomResult(page, mawb) {', 'async function positionTrackingArea(page) {', read_dom)
s = replace_between(s, 'async function positionTrackingArea(page) {', 'async function screenshotOcr(page, mawb) {', position)
s = replace_between(s, 'async function screenshotOcr(page, mawb) {', 'export async function trackTurkish(input) {', ocr)
path.write_text(s)
print('patched lib/turkish.js')
