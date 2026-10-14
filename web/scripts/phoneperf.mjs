// The phone proxy (ToLaD#255): headless Chromium (default SwiftShader, no GPU flags) at 390x844, DPR 3, touch, the
// CPU throttled 4x (CDP Emulation.setCPUThrottlingRate) from before the page loads, real touch gestures (CDP
// Input.dispatchTouchEvent → pointer events) and flights, every frame's rAF delta recorded in the page.
//
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/phoneperf.mjs
//
// Env: Q=extra query, THROTTLE=4, ONLY=scene,scene, PROFILE=scene (a CDP CPU profile of that
// scene's gestures, written to PROFILE_OUT, default phoneperf.cpuprofile), REPS=1 (gestures repeated).
// Per scene: load ms (navigation to the first frame drawn), then over the gestures the rAF deltas' p50/p95/max,
// dropped frames (each delta over 16.7 ms counts the vsyncs it missed) and the draw()'s own p50/p95 (frameMs).
// SwiftShader runs the GL on the CPU too: a phone GPU does that part elsewhere, so treat the deltas as a ceiling.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const THROTTLE = Number(process.env.THROTTLE || 4);
const Q = process.env.Q ?? '';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const PROFILE = process.env.PROFILE || '';
const REPS = Number(process.env.REPS || 1);
const W = 390;
const H = 844;

// [name, level, setup]: setup runs in the page once loaded (f = window.__fan), the view framed where the gestures start.
const SCENES = [
  ['carnivores', 'carnivores', { home: true }],
  ['cats', 'cats', { home: true }],
  ['mammals', 'mammals', { home: true }],
  ['rodents', 'mammals', { level: 'Rodentia' }],
  ['bats', 'mammals', { level: 'Chiroptera' }],
  ['species', 'mammals', { species: 'Domestic cat' }],
];

process.env.HTTP = '1';
const served = await pageUrl('', process.env.DIR || 'dist-single');
const browser = await chromium.launch({ headless: true });
const rows = [];
try {
  for (const [name, level, setup] of SCENES) {
    if (ONLY && !ONLY.has(name)) continue;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR || 3), isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', String(e)));
    // Every rAF's delta from the start; the first frame the fan draws.
    await page.addInitScript(() => {
      const w = window;
      w.__pp = { deltas: [], cb: [], rec: false, first: 0 };
      let last = 0;
      // The page's own rAF callbacks timed (the fan's frame: its flight step and draw, on the main thread).
      const raf = w.requestAnimationFrame.bind(w);
      w.requestAnimationFrame = (f) =>
        raf((t) => {
          const a = performance.now();
          f(t);
          if (w.__pp.rec) w.__pp.cb.push(performance.now() - a);
        });
      const tick = (t) => {
        if (w.__pp.rec && last) w.__pp.deltas.push(t - last);
        last = t;
        if (!w.__pp.first && w.__fan && w.__fan.frameMs.length) w.__pp.first = performance.now();
        requestAnimationFrame(tick);
      };
      raf(tick);
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    const url = served.url.replace(/\/\?$|\/$/, '/') + `?level=${level}${Q ? '&' + Q : ''}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__pp.first > 0, null, { timeout: 120000 });
    const load = await page.evaluate(() => window.__pp.first);
    // The view framed (unthrottled for the setup, it is not what is timed), settled.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const ok = await page.evaluate((s) => {
      const f = window.__fan;
      f.anim = null;
      if (s.home) f.cam = f.homeCamera();
      else if (s.level) {
        const c = f.levelCamera(s.level);
        if (!c) return false;
        f.cam = c;
      } else if (s.species) {
        const b = f.fan.branches.find((x) => x.sp.common === s.species);
        if (!b) return false;
        f.cam = f.speciesCamera(b);
      }
      f.request();
      return true;
    }, setup);
    if (!ok) {
      console.log(`${name}: setup failed`);
      await ctx.close();
      continue;
    }
    await sleep(1500);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await sleep(500);

    const touch = (type, points) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
    const pinch = async (cx, cy, d0, d1, steps = 20) => {
      const pts = (d) => [
        [cx - d * 0.36, cy - d * 0.93 / 2],
        [cx + d * 0.36, cy + d * 0.93 / 2],
      ];
      await touch('touchStart', pts(d0));
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', pts(d0 + ((d1 - d0) * i) / steps));
        await sleep(16);
      }
      await touch('touchEnd', []);
    };
    const pan = async (x0, y0, x1, y1, steps = 16, dt = 16) => {
      await touch('touchStart', [[x0, y0]]);
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]);
        await sleep(dt);
      }
      await touch('touchEnd', []);
    };
    const idle = () => page.waitForFunction(() => !window.__fan.anim && !window.__fan.raf, null, { timeout: 60000 }).catch(() => {});

    if (PROFILE === name) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    await page.evaluate(() => {
      window.__pp.deltas = [];
      window.__pp.cb = [];
      window.__pp.rec = true;
      window.__fan.frameMs.length = 0;
    });
    const t0 = Date.now();
    for (let r = 0; r < REPS; r++) {
      await pinch(W / 2, H * 0.55, 90, 300); // in
      await idle();
      await pan(W * 0.3, H * 0.5, W * 0.7, H * 0.4); // pan
      await idle();
      await pan(W * 0.7, H * 0.55, W * 0.2, H * 0.45, 5, 8); // fling
      await idle();
      await pinch(W / 2, H * 0.5, 300, 90); // out
      await idle();
      // A tap flight: into the widest species on screen, and back (the reset).
      await page.evaluate(() => {
        const f = window.__fan;
        const on = f.fan.branches.filter((b) => {
          const [x] = f.toScreen(b.cx, b.tipY);
          return x > 0 && x < f.w;
        });
        const b = (on.length ? on : f.fan.branches).reduce((p, q) => (q.width > p.width ? q : p));
        f.flyToSpecies(b.sp, false);
      });
      await idle();
      await page.evaluate(() => window.__fan.resetView());
      await idle();
    }
    const secs = (Date.now() - t0) / 1000;
    const rec = await page.evaluate(() => {
      window.__pp.rec = false;
      return { deltas: window.__pp.deltas, cb: window.__pp.cb, draw: [...window.__fan.frameMs] };
    });
    if (PROFILE === name) {
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(process.env.PROFILE_OUT || 'phoneperf.cpuprofile', JSON.stringify(profile));
    }
    const q = (a, p) => {
      if (!a.length) return 0;
      const s = [...a].sort((x, y) => x - y);
      return s[Math.min(s.length - 1, Math.floor(s.length * p))];
    };
    // Only the frames something was drawn in count (the ticker idles at 16.7 between gestures).
    const d = rec.deltas;
    const dropped = d.reduce((n, x) => n + Math.max(0, Math.round(x / 16.67) - 1), 0);
    const row = {
      name,
      load: Math.round(load),
      frames: d.length,
      p50: q(d, 0.5),
      p95: q(d, 0.95),
      max: q(d, 1),
      dropped,
      cbs: rec.cb.length,
      c50: q(rec.cb, 0.5),
      c95: q(rec.cb, 0.95),
      over16: rec.cb.filter((x) => x > 16.7).length,
      draws: rec.draw.length,
      d50: q(rec.draw, 0.5),
      d95: q(rec.draw, 0.95),
      secs,
    };
    rows.push(row);
    const f = (v) => v.toFixed(1).padStart(7);
    console.log(
      `${name.padEnd(11)} load ${String(row.load).padStart(6)} ms | frames ${String(row.frames).padStart(4)} p50 ${f(row.p50)} p95 ${f(row.p95)} max ${f(row.max)} dropped ${String(dropped).padStart(4)} | main n ${String(row.cbs).padStart(4)} p50 ${f(row.c50)} p95 ${f(row.c95)} >16 ${String(row.over16).padStart(3)} | draw n ${String(row.draws).padStart(4)} p50 ${f(row.d50)} p95 ${f(row.d95)} | ${secs.toFixed(1)} s`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
  served.close();
}
if (process.env.JSON_OUT) writeFileSync(process.env.JSON_OUT, JSON.stringify(rows, null, 1));
