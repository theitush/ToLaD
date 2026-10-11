// The fold units' openness and the frame cost at a few views (ToLaD#146): default headless, no GPU flags.
//   npm run build:single && node scripts/foldprobe.mjs [frames]
// Prints, per width mode: each family's on-screen px per species at home and at its own level (fold.ts),
// then the CPU frame time (FanView.draw, median and p90 of N redraws) at home, the cats, the dogs and a
// busy zoom (the domestic cat's peel, 3x home).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const N = Number(process.argv[2] || 30);
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: Number(process.env.LOAD_MS || 200000) });
  for (const mode of ['linear', 'log']) {
    const out = await page.evaluate(
      ([mode, N]) => {
        const f = window.__fan;
        f.setMode(mode);
        const h = f.homeCamera();
        const per = (u, sx) => (((u.x1 - u.x0) * sx) / u.strands.length).toFixed(1);
        const rows = (f.folds ?? []).map((u) => `${u.taxon} n=${u.strands.length} home ${per(u, h.sx)} px, own ${per(u, f.familyCamera(u).sx)} px`);
        const time = (cam) => {
          f.cam = cam;
          f.camera.settle();
          f.draw();
          const ms = [];
          for (let i = 0; i < N; i++) {
            const t = performance.now();
            f.draw();
            ms.push(performance.now() - t);
          }
          ms.sort((a, b) => a - b);
          return `median ${ms[Math.floor(N / 2)].toFixed(1)} ms, p90 ${ms[Math.floor(N * 0.9)].toFixed(1)} ms`;
        };
        const views = { home: h };
        for (const t of ['Felidae', 'Canidae']) if (f.unit?.(t)) views[t] = f.familyCamera(f.unit(t));
        const dom = f.fan.branches.find((b) => b.sp.common === 'Domestic cat');
        if (dom) {
          const y = f.fan.time.y(1e-2);
          views['busy (domestic cat peel, 3x)'] = { cx: dom.cx, cy: y, sx: h.sx * 3, sy: h.sy * 3, ty: h.sy * 3 };
        }
        for (const [k, c] of Object.entries(views)) rows.push(`frame ${k}: ${time(c)}`);
        return rows;
      },
      [mode, N],
    );
    console.log(`== ${mode}\n${out.join('\n')}`);
  }
} finally {
  await browser.close();
}
