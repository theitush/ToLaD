// The design pass's screenshot set at 390×844 (default headless, no GPU flags):
// home, the mesh at a range of individuals per scale bar, deep in the lives,
// zoomed far out, and a species card open.
//   npm run build:single && node scripts/designshot.mjs <out-dir> [prefix] [only,names]
//   (DSF: device scale factor, default 2; CLIP=x,y,w,h; DEBUG=1: the ?debug readout)
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'perf-out/design';
const PREFIX = process.argv[3] || 'd';
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
mkdirSync(OUT, { recursive: true });
// [name, kind, args]: 'home' | 'far' | 'card' [species] | 'bar' [species, agoYears, perBar, sy, at?]
const scenes = [
  ['home', 'home'],
  ['far', 'far'],
  ['bar-5e4', 'bar', ['Lion', 3000, 5e4, 40]],
  ['bar-1e3', 'bar', ['Lion', 3000, 1e3, 40]],
  ['bar-100', 'bar', ['Lion', 3000, 100, 40]],
  ['bar-60', 'bar', ['Lion', 3000, 60, 40]],
  ['bar-35', 'bar', ['Lion', 3000, 35, 40]],
  ['deep', 'bar', ['Lion', 300, 4, 3000]],
  ['card', 'card', ['Tiger']],
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
        if (kind === 'home' || kind === 'card') {
          f.cam = f.homeCamera();
          f.camera.settle();
          if (kind === 'card') {
            const b = fan.branches.find((b) => b.sp.common === args[0]);
            f.selected = b.sp;
            f.onSelect({ sp: b.sp });
          }
        } else if (kind === 'far') {
          const h = f.homeCamera();
          f.cam = { ...h, sx: h.sx / 6, sy: h.sy / 6, ty: h.sy / 6 };
          f.camera.settle();
        } else {
          const [sp, ago, perBar, sy, at] = args;
          const b = fan.branches.find((b) => b.sp.common === sp);
          // World width per individual (alive widths): the bar is 70 px.
          const sx = 70 / perBar / b.unit;
          f.cam = { cx: 0, cy: fan.time.y(ago / 1e6), sx, sy, ty: sy };
          f.camera.settle();
          const L = f.model(b).lanes(f.cam.cy);
          f.cam.cx = at === undefined ? L.left + L.gw : L.left + L.w * at;
          f.camera.settle();
        }
        f.request();
      },
      [kind, args ?? []],
    );
    await page.waitForTimeout(900);
    // CLIP=x,y,w,h (CSS px): only that part of the page (with DSF=4–6, a close look).
    const clip = process.env.CLIP ? Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, Number(process.env.CLIP.split(',')[i])])) : undefined;
    await page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png`, clip });
    console.log('shot', name);
  }
} finally {
  await browser.close();
}
