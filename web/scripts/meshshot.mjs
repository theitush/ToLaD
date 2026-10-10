// Screenshots of the individuals mesh by what the width scale bar reads, with
// the ?debug readout: the camera on a species' lane boundary (green lane left
// of centre, gray lane right) at `ago` years, the bar reading `perBar`.
//   npm run build:single && node scripts/meshshot.mjs [out-dir] [scenes.json]
//   scenes: [[name, species, agoYears, perBar, sy, at?, widthMode?], ...]
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'perf-out/mesh';
mkdirSync(OUT, { recursive: true });
const scenes = process.argv[3]
  ? JSON.parse(readFileSync(process.argv[3], 'utf8'))
  : [
      ['bar-1e2', 'Lion', 3000, 100, 40],
      ['bar-1e3', 'Lion', 3000, 1e3, 40],
      ['bar-1e4', 'Lion', 3000, 1e4, 40],
      ['bar-5e4', 'Lion', 3000, 5e4, 40],
    ];
// Default headless (its software GL renders WebGL2): no GPU flags.
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href + '?debug');
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 20000 });
  for (const [name, sp, ago, perBar, sy, at, mode] of scenes) {
    const info = await page.evaluate(
      ([sp, ago, perBar, sy, at, mode]) => {
        const f = window.__fan;
        f.setMode(mode || 'linear');
        const fan = f.fan;
        const b = fan.branches.find((b) => b.sp.common === sp);
        // World width per individual (alive widths): the bar is 70 px.
        const sx = 70 / perBar / b.unit;
        f.cam = { cx: 0, cy: fan.time.y(ago / 1e6), sx, sy, ty: sy };
        f.camera.settle();
        const L = f.model(b).lanes(f.cam.cy);
        // The lane boundary in the middle (or a fraction `at` across the column).
        f.cam.cx = at === undefined ? L.left + L.gw : L.left + L.w * at;
        f.camera.settle();
        f.request();
        return { sx: f.cam.sx, sy: f.cam.sy, bar: f.widthScale() };
      },
      [sp, ago, perBar, sy, at ?? undefined, mode],
    );
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name, JSON.stringify(info));
  }
} finally {
  await browser.close();
}
