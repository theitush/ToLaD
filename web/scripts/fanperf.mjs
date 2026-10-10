// Frame times of the fan view in headless Chromium, mid-phone-ish: 390×844,
// DPR 3, 4× CPU throttling (CDP). Scripted zooms through the detail levels;
// per scene: the CPU time of each draw() (wrapped) and the rAF intervals.
//   node scripts/fanperf.mjs [page.html=dist-single/index.html]
// Headless GL is SwiftShader (software): GPU cost lands on the CPU too, so the
// rAF intervals overstate a phone's; the draw() column is the CPU side.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const page0 = resolve(process.argv[2] || 'dist-single/index.html');
const THROTTLE = Number(process.env.PERF_THROTTLE || 4);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(pathToFileURL(page0).href);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 20000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const scenes = [
    ['overview', 'Lion', 2e5, 1e9, 0.7],
    ['mid', 'Lion', 5e4, 1e7, 3],
    ['texture', 'Lion', 2000, 60, 5],
    ['lives', 'Lion', 300, 20, 30],
    ['near now', 'Lion', 25, 0.4, 300],
    ['deep', 'Tiger', 1.5e6, 100, 50],
  ];
  console.log(`scene        draw() ms p50 / p95 / max   rAF interval ms p50 / p95   (throttle ${THROTTLE}×)`);
  for (const [name, sp, ago, perBar, sy] of scenes) {
    const r = await page.evaluate(
      async ([sp, ago, perBar, sy]) => {
        const f = window.__fan;
        const fan = f.fan;
        const b = fan.branches.find((b) => b.sp.common === sp);
        const sumEver = fan.branches.reduce((a, b) => a + b.sp.ever, 0);
        const sx = ((70 / perBar) * sumEver) / fan.trunkWidth;
        f.cam = { cx: 0, cy: fan.time.y(ago / 1e6), sx, sy, ty: sy };
        f.camera.settle();
        const L = f.model(b).lanes(f.cam.cy);
        f.cam.cx = L.left + L.gw + (L.w - L.gw) * 0.5;
        f.camera.settle();
        const draw = f.draw.bind(f);
        const times = [];
        f.draw = () => {
          const t = performance.now();
          draw();
          times.push(performance.now() - t);
        };
        const ivs = [];
        let last = 0;
        await new Promise((done) => {
          let k = 0;
          const step = (now) => {
            if (last) ivs.push(now - last);
            last = now;
            // A slow pinch in and out about the middle, and a little pan: every frame redraws.
            f.zoomAbout(195, 422, k < 45 ? 1.01 : 1 / 1.01);
            f.pan(k % 2 ? 0.5 : -0.5, 0);
            if (++k < 90) requestAnimationFrame(step);
            else setTimeout(done, 50);
          };
          requestAnimationFrame(step);
        });
        f.draw = draw;
        const q = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
        return { d: [q(times, 0.5), q(times, 0.95), Math.max(...times)], i: [q(ivs, 0.5), q(ivs, 0.95)] };
      },
      [sp, ago, perBar, sy],
    );
    const f = (x) => x.toFixed(1).padStart(6);
    console.log(`${name.padEnd(12)} ${f(r.d[0])} ${f(r.d[1])} ${f(r.d[2])}        ${f(r.i[0])} ${f(r.i[1])}`);
  }
} finally {
  await browser.close();
}
