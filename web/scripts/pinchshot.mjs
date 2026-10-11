// #138: real two-finger touch pinches (CDP touch events -> pointer events -> engine/input.ts)
// on the built page at 390x844, from one start view: start, after a sideways pinch, after an upright pinch,
// after a diagonal one, with the ?debug readout (width × and time × home).
//   npm run build:single && node scripts/pinchshot.mjs [out-dir]   (default headless, no GPU flags)
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const out = process.argv[2] || 'perf-out/pinch';
mkdirSync(out, { recursive: true });
const html = resolve('dist-single/index.html');
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(pathToFileURL(html).href + '?debug');
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  const start = () =>
    page.evaluate(() => {
      const f = window.__fan;
      f.tap(-1e6, -1e6);
      const b = f.fan.branches.find((b) => b.sp.common === 'Lion');
      const h = f.homeCamera();
      const y = f.fan.time.y(0.2);
      f.cam = { ...h, sx: h.sx * 6, sy: h.sy * 3, ty: h.sy * 3, cx: b.colLeft + 0.5 * b.width, cy: y };
      f.camera.settle();
      f.request();
    });
  const cam = () => page.evaluate(() => ({ ...window.__fan.cam }));
  const pinch = async (a0, b0, a1, b1, n = 24) => {
    const pts = (u) => [
      { x: a0[0] + (a1[0] - a0[0]) * u, y: a0[1] + (a1[1] - a0[1]) * u, id: 0 },
      { x: b0[0] + (b1[0] - b0[0]) * u, y: b0[1] + (b1[1] - b0[1]) * u, id: 1 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
    for (let k = 1; k <= n; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(k / n) });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(250);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  const shot = async (name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}.png` });
  };
  const runs = [
    ['start', null],
    ['sideways', [[150, 420], [240, 428], [60, 423], [330, 425]]],
    ['upright', [[192, 360], [200, 470], [190, 250], [202, 580]]],
    ['diagonal', [[160, 380], [230, 450], [100, 330], [290, 500]]],
  ];
  let c0 = null;
  for (const [name, p] of runs) {
    await start();
    if (!c0) c0 = await cam();
    if (p) await pinch(...p);
    const c = await cam();
    console.log(name, `width ×${(c.sx / c0.sx).toFixed(3)}  time ×${(c.sy / c0.sy).toFixed(3)}`);
    await shot(`zoom138-${name}`);
  }
} finally {
  await browser.close();
}
