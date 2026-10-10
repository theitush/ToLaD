// The width model's screenshot set (width = alive at the time, green = has
// living descendants) at 390×844, default headless (no GPU flags): home, the
// lion near now and 1–100 kya, the cave lion, the stem below the clade's
// origin, and the mesh at 5e4 / 100 / 35 individuals per scale bar.
//   npm run build:single && node scripts/aliveshot.mjs <out-dir> [prefix] [only,names]
//   (DSF: device scale factor, default 2; DEBUG=1: the ?debug readout)
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'perf-out/alive';
const PREFIX = process.argv[3] || 'a';
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
mkdirSync(OUT, { recursive: true });
// [name, kind, args]: 'home' | 'frame' [species|null, agoTop, agoBot (years), x (0–1 across the column)] |
// 'bar' [species, agoYears, perBar, sy] | 'card' [species, agoYears]
const scenes = [
  ['home', 'home'],
  ['lion-now', 'frame', ['Lion', 0, 160]],
  ['lion-kya', 'frame', ['Lion', 1e3, 1e5]],
  ['cave-lion', 'frame', ['Cave lion', 3e3, 3e5]],
  ['stem', 'frame', [null, 3e6, 4e7]],
  ['bar-5e4', 'bar', ['Lion', 3000, 5e4, 40]],
  ['bar-100', 'bar', ['Lion', 3000, 100, 40]],
  ['bar-35', 'bar', ['Lion', 3000, 35, 40]],
  ['card', 'card', ['Lion', 70]],
];
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DSF || 2), isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href + (process.env.DEBUG ? '?debug' : ''));
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 20000 });
  for (const [name, kind, args] of scenes) {
    if (ONLY && !ONLY.has(name)) continue;
    await page.evaluate(
      ([kind, args]) => {
        const f = window.__fan;
        f.setMode('linear');
        f.tap(-1e6, -1e6);
        const fan = f.fan;
        const unit = fan.branches[0].unit;
        if (kind === 'home') {
          f.cam = f.homeCamera();
          f.camera.settle();
        } else if (kind === 'frame') {
          const [sp, top, bot] = args;
          const b = sp && fan.branches.find((b) => b.sp.common === sp);
          const yT = fan.time.y(top / 1e6);
          const yB = fan.time.y(bot / 1e6);
          const sy = (0.78 * f.h) / (yB - yT);
          const h = f.homeCamera();
          const sx = b ? (0.8 * f.w) / b.width : h.sx * 1.4;
          f.cam = { cx: b ? b.colLeft + b.width / 2 : 0, cy: (yT + yB) / 2 - (0.02 * f.h) / sy, sx, sy, ty: sy };
          f.camera.settle();
        } else if (kind === 'card') {
          const [sp, ago] = args;
          const b = fan.branches.find((b) => b.sp.common === sp);
          f.cam = f.homeCamera();
          f.camera.settle();
          const y = fan.time.y(ago / 1e6);
          const [px, py] = f.toScreen(b.colLeft + 0.2 * f.model(b).lanes(y).w, y);
          f.tap(px, py);
        } else {
          const [sp, ago, perBar, sy] = args;
          const b = fan.branches.find((b) => b.sp.common === sp);
          const sx = 70 / perBar / unit;
          f.cam = { cx: 0, cy: fan.time.y(ago / 1e6), sx, sy, ty: sy };
          f.camera.settle();
          const L = f.model(b).lanes(f.cam.cy);
          f.cam.cx = L.left + L.gw;
          f.camera.settle();
        }
        f.request();
      },
      [kind, args ?? []],
    );
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png` });
    console.log('shot', name, await page.evaluate(() => document.querySelector('.wlab')?.textContent));
  }
} finally {
  await browser.close();
}
