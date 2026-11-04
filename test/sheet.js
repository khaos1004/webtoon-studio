const path = require('path'); const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1800, height: 1200 } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('file://' + path.join(__dirname, 'out/sheet/index.html'));
  for (const k of ['presets', 'effects']) {
    const t = await p.evaluate((k) => window.__sheet(k), k);
    console.log(k, t.join(' | '));
    await (await p.$('#out')).screenshot({ path: path.join(__dirname, `out/sheet-${k}.png`) });
  }
  await b.close();
})();
