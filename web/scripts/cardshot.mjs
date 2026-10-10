// The species card's screenshot set at 390×844, default headless (no GPU
// flags): home, then the card on a species at a time (tapped near the column's
// left edge at that age), optionally with its details opened.
//   npm run build:single && node scripts/cardshot.mjs <out-dir> [only,names]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'perf-out/card';
const ONLY = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
mkdirSync(OUT, { recursive: true });
// [name, species | null (home), agoYears, open details?]
const scenes = [
  ['home', null],
  ['lion-70y', 'Lion', 70],
  ['lion-70y-details', 'Lion', 70, true],
  ['cave-lion', 'Cave lion', 5e4],
  ['tiger-now', 'Tiger', 0.2],
  ['jaguar-now', 'Jaguar', 0.2],
  ['jaguar-details', 'Jaguar', 0.2, true],
  ['leopard-now', 'Leopard', 0.2],
  ['leopard-details', 'Leopard', 0.2, true],
  ['snow-leopard-details', 'Snow leopard', 0.2, true],
];
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DSF || 2), isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 20000 });
  for (const [name, sp, ago, open] of scenes) {
    if (ONLY && !ONLY.has(name)) continue;
    await page.evaluate(
      ([sp, ago]) => {
        const f = window.__fan;
        f.setMode('linear');
        f.tap(-1e6, -1e6);
        f.cam = f.homeCamera();
        f.camera.settle();
        if (sp) {
          const fan = f.fan;
          const b = fan.branches.find((b) => b.sp.common === sp);
          const y = fan.time.y(ago / 1e6);
          const [px, py] = f.toScreen(b.colLeft + 0.2 * f.model(b).lanes(y).w, y);
          f.tap(px, py);
        }
        f.request();
      },
      [sp, ago],
    );
    await page.waitForTimeout(700);
    if (open) await page.evaluate(() => document.querySelector('.card-sp details')?.setAttribute('open', ''));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const card = await page.evaluate(() => {
      const c = document.querySelector('.card-sp');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { sparklines: c.querySelectorAll('.hist').length, text: c.innerText.replace(/\s+/g, ' ').slice(0, 300), w: r.width, h: r.height, scrollW: c.scrollWidth };
    });
    console.log('shot', name, JSON.stringify(card));
  }
} finally {
  await browser.close();
}
