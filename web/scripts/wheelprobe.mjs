// #168: real wheel events (CDP mouseWheel -> WheelEvent -> engine/input.ts) on the
// built page at 1280x800, as a desktop trackpad and mouse send them: an upright
// swipe with sideways jitter, a sideways one, a diagonal one, a pinch (ctrl),
// a mouse notch and shift+notch. Prints how much each zoomed width (sx) and time (sy).
// (Headless SwiftShader can space events past the 140 ms gesture gap, restarting the
// lock; each swipe's first event is past the dead zone so that costs nothing.)
//   npm run build:single && node scripts/wheelprobe.mjs   (default headless, no GPU flags)
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
let bad = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  const start = () =>
    page.evaluate(() => {
      const f = window.__fan;
      const b = f.fan.branches.find((b) => b.sp.common === 'Lion');
      const h = f.homeCamera();
      f.cam = { ...h, sx: h.sx * 6, sy: h.sy * 3, ty: h.sy * 3, cx: b.colLeft + 0.5 * b.width, cy: f.fan.time.y(0.2) };
      f.camera.settle();
      f.request();
    });
  const cam = () => page.evaluate(() => ({ sx: window.__fan.cam.sx, sy: window.__fan.cam.sy }));
  // modifiers: 2 ctrl, 8 shift.
  const wheel = (deltaX, deltaY, modifiers = 0) =>
    cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX, deltaY, modifiers });
  const pause = () => page.waitForTimeout(300);
  const cases = [
    ['upright swipe, sideways jitter', 'y', async () => { for (let k = 0; k < 20; k++) await wheel(k % 3 === 0 ? 2 : -1, -6); }],
    ['sideways swipe', 'x', async () => { for (let k = 0; k < 20; k++) await wheel(-6, k % 4 === 0 ? 1 : 0); }],
    ['diagonal swipe', 'xy', async () => { for (let k = 0; k < 20; k++) await wheel(-7, -6); }],
    ['ctrl pinch', 'xy', async () => { for (let k = 0; k < 10; k++) await wheel(0, -4, 2); }],
    ['mouse notch', 'y', () => wheel(0, -100)],
    ['shift+notch (deltaY)', 'x', () => wheel(0, -100, 8)],
    ['shift+notch (deltaX)', 'x', () => wheel(-100, 0, 8)],
  ];
  for (const [name, want, run] of cases) {
    await start();
    await pause();
    const a = await cam();
    await run();
    await pause();
    const b = await cam();
    const fx = b.sx / a.sx;
    const ft = b.sy / a.sy;
    const moved = (f) => f > 1.05;
    const still = (f) => Math.abs(f - 1) < 1e-6;
    const ok = (want.includes('x') ? moved(fx) : still(fx)) && (want.includes('y') ? moved(ft) : still(ft));
    if (!ok) bad++;
    console.log(`${ok ? 'ok ' : 'BAD'} ${name.padEnd(32)} width ×${fx.toFixed(3)}  time ×${ft.toFixed(3)}  (want ${want})`);
  }
} finally {
  await browser.close();
}
console.log(bad ? `${bad} bad` : 'all ok');
process.exit(bad ? 1 : 0);
