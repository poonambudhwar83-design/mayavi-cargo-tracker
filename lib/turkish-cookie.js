const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function dismissTurkishCookies(page) {
  const labels = ['Accept all', 'Accept All', 'Allow all', 'Allow All'];
  let clicked = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    for (const frame of page.frames()) {
      try {
        const hit = await frame.evaluate(labels => {
          const norm = v => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const wanted = labels.map(norm);
          const nodes = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],div,span')];
          const el = nodes.find(node => {
            const r = node.getBoundingClientRect();
            const text = norm(node.innerText || node.value || node.textContent || '');
            return r.width > 3 && r.height > 3 && wanted.includes(text);
          });
          if (!el) return false;
          el.click();
          return true;
        }, labels);
        clicked = clicked || hit;
      } catch {}
    }
    await sleep(450);

    let visible = false;
    for (const frame of page.frames()) {
      try {
        visible = visible || await frame.evaluate(() => {
          const text = String(document.body?.innerText || '').toLowerCase();
          return text.includes('accept all') && text.includes('cookie');
        });
      } catch {}
    }
    if (!visible) return { cleared: true, clicked, mode: clicked ? 'COOKIE_ACCEPTED' : 'NO_COOKIE_BANNER' };
  }

  // Last resort: remove only visible cookie-consent overlays, never tracking content.
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(() => {
        const nodes = [...document.querySelectorAll('div,section,aside')];
        for (const el of nodes) {
          const text = String(el.innerText || '').toLowerCase();
          const style = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const consent = text.includes('cookie') && (text.includes('accept all') || text.includes('change settings') || text.includes('cookie policy'));
          const overlay = ['fixed','sticky'].includes(style.position) && r.width > innerWidth * 0.35 && r.height > 40;
          if (consent && overlay) el.remove();
        }
      });
    } catch {}
  }
  await sleep(250);
  return { cleared: true, clicked, mode: 'COOKIE_OVERLAY_REMOVED' };
}
