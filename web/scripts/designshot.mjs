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
// [name, kind, args]: 'home' | 'far' | 'card' [species] | 'touch' [species, agoYears] | 'scroll' [zoom, agoYears] | 'bar' [species, agoYears, perBar, sy, at?]
//   | 'split' [splitMa, time zoom × home] | 'tapnode' [splitMa, ageMa]
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
  // A tap on a column (the touch marker), columns whose tips are above the screen, near now.
  ['touch', 'touch', ['Lion', 70]],
  ['scrolled', 'scroll', [2.2, 2000]],
  ['nearnow', 'bar', ['Lion', 25, 2e3, 900]],
  // Sequences (#54): a slow pan down from home until "now" is above the screen, and a zoom from home into the lion.
  ...[0, 60, 120, 180, 260, 360].map((dy, k) => [`pan${k + 1}`, 'pan', [1.5, dy]]),
  ...[0, 0.2, 0.4, 0.6, 0.8, 1].map((t, k) => [`zoom${k + 1}`, 'zoomin', ['Lion', 300, t]]),
  // The dated tree (#46): onto a split [its date Ma, time zoom × home], the mesh across one (the lion's
  // right edge just above its split from the cave lion), and a tap on a parent column [split Ma, age Ma].
  ['split-lionleopard', 'split', [2.57, 5]],
  ['split-cavelion', 'split', [0.5, 5]],
  ['split-root', 'split', [4.6, 3]],
  ['decline', 'bar', ['Lion', 50, 1e5, 3.5, 0.5]],
  ['mesh-split', 'bar', ['Lion', 499990, 100, 2e4, 1]],
  ['lineage', 'tapnode', [2.57, 1.2]],
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
        } else if (kind === 'touch') {
          f.cam = f.homeCamera();
          f.camera.settle();
          const b = fan.branches.find((b) => b.sp.common === args[0]);
          const y = fan.time.y(args[1] / 1e6);
          const [px, py] = f.toScreen(b.colLeft + 0.3 * f.model(b).lanes(y).w, y);
          f.tap(px, py);
        } else if (kind === 'scroll') {
          const h = f.homeCamera();
          f.cam = { ...h, sx: h.sx * args[0], sy: h.sy * args[0], ty: h.sy * args[0], cy: fan.time.y(args[1] / 1e6) };
          f.camera.settle();
        } else if (kind === 'pan') {
          // Zoom z with "now" at 160 px from the top, then the view moved down dy px (into the past).
          const [z, dy] = args;
          const h = f.homeCamera();
          const sy = h.sy * z;
          f.cam = { ...h, sx: h.sx * z, sy, ty: sy, cy: f.yNow + (f.h / 2 - (160 - dy)) / sy };
          f.camera.settle();
        } else if (kind === 'zoomin') {
          // From home (t = 0) to the species' individuals (t = 1, 4 per 70 px bar) about a point on its column.
          const [sp, ago, t] = args;
          const b = fan.branches.find((b) => b.sp.common === sp);
          const h = f.homeCamera();
          f.cam = h;
          const y = fan.time.y(ago / 1e6);
          const [px, py] = f.toScreen(b.colLeft + 0.3 * b.width, y);
          const F = Math.pow(70 / 4 / b.unit / h.sx, t);
          const sx = h.sx * F;
          const sy = h.sy * F;
          const wx = b.colLeft + 0.3 * b.width;
          f.cam = { cx: wx - (px - f.w / 2) / sx, cy: y - (py - f.h / 2) / sy, sx, sy, ty: sy };
          f.camera.settle();
        } else if (kind === 'split' || kind === 'tapnode') {
          const v = fan.nodes.find((n) => Math.abs(n.ageMa - args[0]) < 1e-9);
          if (kind === 'tapnode') {
            f.cam = f.homeCamera();
            f.camera.settle();
            const y = fan.time.y(args[1]);
            const [px, py] = f.toScreen(v.left + 0.5 * v.width, y);
            f.tap(px, py);
          } else {
            // The daughters' extent across 80% of the screen, the split mid-screen.
            const isN = (k) => 'strands' in k;
            const first = v.kids[0];
            const last = v.kids[v.kids.length - 1];
            const lo = isN(first) ? first.left : first.colLeft;
            const hi = isN(last) ? last.left + last.width : last.colLeft + last.width;
            const h = f.homeCamera();
            const sx = Math.max(h.sx, (0.8 * f.w) / (hi - lo));
            const sy = h.sy * args[1];
            f.cam = { cx: (lo + hi) / 2, cy: v.y, sx, sy, ty: sy };
            f.camera.settle();
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
