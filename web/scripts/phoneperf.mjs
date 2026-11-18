// The phone proxy (ToLaD#255): headless Chromium (default SwiftShader, no GPU flags) at 390x844, DPR 3, touch, the
// CPU throttled 4x (CDP Emulation.setCPUThrottlingRate) from before the page loads, real touch gestures (CDP
// Input.dispatchTouchEvent → pointer events) and flights, every frame's rAF delta recorded in the page.
//
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/phoneperf.mjs
//
// Env: SYNTH_N=70000: the synthetic level's scenes instead (ToLaD#343: home, its largest order, that order's largest
// family; scripts/scale.mjs), LOAD_TIMEOUT=ms (default 120000). Q=extra query, THROTTLE=4, LOADONLY=1 (load times only), ONLY=scene,scene, PROFILE=scene (a CDP CPU profile of that
// scene's gestures, written to PROFILE_OUT, default phoneperf.cpuprofile), REPS=1 (gestures repeated).
// NET=1.5: the network throttled to that many Mbit/s (CDP Network.emulateNetworkConditions, 40 ms latency), the files
// gzipped as Pages serves them (pageurl.mjs GZIP=1). LOADONLY also waits for the cards' file where there is one (tl:card, ToLaD#502).
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
const NET = Number(process.env.NET || 0);
if (NET) process.env.GZIP = '1';
const W = 390;
const H = 844;

// [name, level, setup]: setup runs in the page once loaded (f = window.__fan), the view framed where the gestures start.
const SYNTH_N = Number(process.env.SYNTH_N || 0);
// TREE=amniotes: the amniotes' page (`?tree=amniotes`, every fossil, ToLaD#539) at home, and Ita's route (ToLaD#502): from home the
// names of the groups holding Tyrannosaurus rex tapped till it is named, a pinch and a pan there, then a tap on its name (its card).
// The mammals' scenes carry the same route to the lion (`mammals-route`).
const TREE = process.env.TREE || 'mammals';
const SCENES = TREE === 'amniotes' ? [
  ['amn-home', 'mammals&tree=amniotes', { home: true }],
  ['amn-route', 'mammals&tree=amniotes', { home: true, route: 'Tyrannosaurus rex', via: 'Tyrannosauridae' }],
] : SYNTH_N ? [
  [`s${SYNTH_N}-home`, `synthetic&n=${SYNTH_N}`, { home: true }],
  [`s${SYNTH_N}-order`, `synthetic&n=${SYNTH_N}`, { synth: 'order' }],
  [`s${SYNTH_N}-family`, `synthetic&n=${SYNTH_N}`, { synth: 'family' }],
] : [
  ['mammals', 'mammals', { home: true }],
  ['rodents', 'mammals', { level: 'Rodentia' }],
  ['bats', 'mammals', { level: 'Chiroptera' }],
  ['species', 'mammals', { species: 'Domestic cat' }],
  ['mammals-route', 'mammals', { home: true, route: 'Panthera leo', via: 'Felidae' }],
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
      w.__pp = { deltas: [], cb: [], rec: false, first: 0, heap: 0, phase: '', by: {}, cbBy: {}, long: {} };
      // (Long tasks by phase, ToLaD#502: a tap's own work runs in its event, not a frame.)
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (w.__pp.rec && w.__pp.phase) (w.__pp.long[w.__pp.phase] ??= []).push(e.duration);
        }).observe({ type: 'longtask', buffered: false });
      } catch {
        /* no long tasks */
      }
      let last = 0;
      // The page's own rAF callbacks timed (the fan's frame: its flight step and draw, on the main thread).
      const raf = w.requestAnimationFrame.bind(w);
      w.requestAnimationFrame = (f) =>
        raf((t) => {
          const a = performance.now();
          f(t);
          if (w.__pp.rec) w.__pp.cb.push(performance.now() - a);
          if (w.__pp.rec && w.__pp.phase) (w.__pp.cbBy[w.__pp.phase] ??= []).push(performance.now() - a);
        });
      const tick = (t) => {
        if (w.__pp.rec && last) w.__pp.deltas.push(t - last);
        if (w.__pp.rec && last && w.__pp.phase) (w.__pp.by[w.__pp.phase] ??= []).push(t - last);
        // (The JS heap's peak, MB: Chromium's performance.memory, sampled every frame.)
        if (performance.memory) w.__pp.heap = Math.max(w.__pp.heap, performance.memory.usedJSHeapSize / 2 ** 20);
        last = t;
        if (!w.__pp.first && w.__fan && w.__fan.frameMs.length) w.__pp.first = performance.now();
        requestAnimationFrame(tick);
      };
      raf(tick);
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    if (NET) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (NET * 1e6) / 8, uploadThroughput: (NET * 1e6) / 8 });
    }
    const url = served.url.replace(/\/\?$|\/$/, '/') + `?level=${level}${Q ? '&' + Q : ''}`;
    // (LOADONLY=1: the load times only, no gestures, ToLaD#255; with PROFILE=scene, the load's CPU profile.)
    const LOADONLY = !!process.env.LOADONLY;
    if (LOADONLY && PROFILE === name) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
      await cdp.send('Profiler.start');
    }
    await page.goto(url);
    const ok0 = await page.waitForFunction(() => window.__pp.first > 0, null, { timeout: Number(process.env.LOAD_TIMEOUT || 120000) }).then(() => true, () => false);
    if (!ok0) {
      console.log(`${name.padEnd(11)} never opened within ${process.env.LOAD_TIMEOUT || 120000} ms`);
      rows.push({ name, load: null });
      await ctx.close();
      continue;
    }
    const load = await page.evaluate(() => window.__pp.first);
    if (LOADONLY) {
      if (PROFILE === name) {
        const { profile } = await cdp.send('Profiler.stop');
        writeFileSync(process.env.PROFILE_OUT || 'phoneperf.cpuprofile', JSON.stringify(profile));
      }
      // The page's own load stamps (src/stamp.ts, tl:<step>) and the HTML's arrival, ms from navigation (ToLaD#255);
      // the second frame (the labels') waited for.
      await page.waitForFunction(() => performance.getEntriesByName('tl:second').length > 0, null, { timeout: 60000 }).catch(() => {});
      // (A build before the split has no cards' file to wait for.)
      if (await page.evaluate(async () => (await fetch('mammals-card.json', { method: 'HEAD' })).ok)) await page.waitForFunction(() => performance.getEntriesByName('tl:card').length > 0, null, { timeout: 120000 }).catch(() => {});
      const marks = await page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        const out = n ? [['html', n.responseEnd], ['parsed', n.domInteractive]] : [];
        for (const m of performance.getEntriesByType('mark')) if (m.name.startsWith('tl:')) out.push([m.name.slice(3), m.startTime]);
        return out;
      });
      const heap = await page.evaluate(() => Math.round(window.__pp.heap));
      rows.push({ name, load: Math.round(load), heap, marks: Object.fromEntries(marks.map(([k, t]) => [k, Math.round(t)])) });
      console.log(`${name.padEnd(11)} load ${Math.round(load)} ms  heap ${heap} MB  ${marks.map(([k, t]) => `${k} ${Math.round(t)}`).join(' · ')}`);
      await ctx.close();
      continue;
    }
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
      } else if (s.synth) {
        const c = window.__synth && f.levelCamera(window.__synth[s.synth]);
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
    // (The view's own work per phase, ToLaD#502: each draw() and each tap()'s handler, ms; SwiftShader's raster of the canvas is not in them.)
    await page.evaluate(() => {
      const w = window;
      const f = w.__fan;
      w.__pp.drawBy = {};
      w.__pp.tapBy = {};
      for (const [k, into] of [['draw', 'drawBy'], ['tap', 'tapBy']]) {
        const g = f[k].bind(f);
        f[k] = (...a) => {
          const t = performance.now();
          g(...a);
          if (w.__pp.rec && w.__pp.phase) (w.__pp[into][w.__pp.phase] ??= []).push(performance.now() - t);
        };
      }
    });
    await sleep(1500);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    if (NET) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (NET * 1e6) / 8, uploadThroughput: (NET * 1e6) / 8 });
    }
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
      // (An older build may lack the label timings: then they read empty.)
      for (const k of ['frameMs', 'labelAllMs', 'labelLayMs']) if (window.__fan[k]) window.__fan[k].length = 0;
    });
    const t0 = Date.now();
    const phase = (k) => page.evaluate((x) => (window.__pp.phase = x), k);
    // (A flight's end: its animation done, whatever else asks for frames (pictures coming in); 3 minutes at most.)
    const landed = () => page.waitForFunction(() => !window.__fan.anim, null, { timeout: 180000 }).catch(() => {});
    const tap = async (x, y) => {
      await touch('touchStart', [[x, y]]);
      await sleep(40);
      await touch('touchEnd', []);
      // (A single tap may wait out the double-tap window, DOUBLE_TAP_MS 320, before it runs.)
      await sleep(450);
      await landed();
    };
    const steps = [];
    if (setup.route) {
      // Where the target is drawn now, in the page's px (the stage turned on the tree on its side, engine/input.ts: view x down the page, view y
      // from its right): its name's box (a tap there is a tap on it), the deepest group named holding it, and its tip.
      const where = (sci) =>
        page.evaluate((sci) => {
          const f = window.__fan;
          const r = f.canvas.getBoundingClientRect();
          const pg = (x, y) => (f.input?.turned ? [r.left + r.width - y, r.top + x] : [r.left + x, r.top + y]);
          const b = f.fan.branches.find((x) => x.sp.sci === sci);
          const mid = (q) => pg((q[0] + q[2]) / 2, (q[1] + q[3]) / 2);
          const on = (q) => q[2] > 0 && q[0] < f.w && q[3] > 0 && q[1] < f.h;
          const name = f.nameHits.find((h) => h.b === b && on(h.box));
          const groups = f.famHits.filter((h) => on(h.box) && h.v.strands.includes(b)).sort((p, q) => p.v.strands.length - q.v.strands.length);
          // (Its tip where the fold draws it: Steady's rowX, the layout's cx unfolded.)
          const fo = f.fan.tess.fold;
          const [x, y] = f.toScreen(fo && fo.rowX ? fo.rowX(b.index, b.tipY) : b.cx, b.tipY);
          return { name: name ? mid(name.box) : null, group: groups.length ? { at: mid(groups[0].box), n: groups[0].v.strands.length } : null, at: pg(x, y), shown: x > 0 && x < f.w && y > 0 && y < f.h };
        }, sci);
      await phase('grouptap');
      let w = await where(setup.route);
      // (A tap on the deepest group named holding it, from home: the birds' line, "Birds & kin".)
      if (w.group) {
        steps.push(`group(${w.group.n})`);
        await tap(...w.group.at);
      }
      // (Then into its family, as taps on its groups' names go: the flight a tap on a group's name flies, flyToClade.)
      await phase('flight');
      steps.push(`fly ${setup.via}`);
      await page.evaluate((t) => window.__fan.flyToClade(window.__fan.fan.nodes.find((v) => v.split.taxon === t)), setup.via);
      await landed();
      w = await where(setup.route);
      // A pinch in about it till it is named (twice at least), and a pan, as a finger looks round there.
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      for (let k = 0; k < 4 && (k < 2 || !w.name); k++) {
        await phase('pinch');
        const [x, y] = [clamp(w.at[0], 60, W - 60), clamp(w.at[1], 120, H - 120)];
        steps.push(`pinch@${Math.round(x)},${Math.round(y)}`);
        await pinch(x, y, 90, 200);
        await landed();
        w = await where(setup.route);
      }
      await phase('pan');
      steps.push('pan');
      await pan(W * 0.4, H * 0.55, W * 0.6, H * 0.45);
      await landed();
      w = await where(setup.route);
      // The tap on its name: the flight to it and its card.
      await phase('sptap');
      const c0 = await page.evaluate(() => performance.now());
      if (w.name) {
        steps.push('tap name');
        await tap(...w.name);
      } else {
        steps.push('flyToSpecies (not named)');
        await page.evaluate((sci) => window.__fan.flyToSpecies(window.__fan.fan.branches.find((x) => x.sp.sci === sci).sp), setup.route);
        await landed();
      }
      const card = await page.evaluate(() => [!!window.__fan.selected, performance.now()]);
      steps.push(`card ${card[0] ? 'open' : 'NOT open'} ${Math.round(card[1] - c0)} ms after the tap`);
    }
    for (let r = 0; r < (setup.route ? 0 : REPS); r++) {
      await phase('pinch');
      await pinch(W / 2, H * 0.55, 90, 300); // in
      await idle();
      await phase('pan');
      await pan(W * 0.3, H * 0.5, W * 0.7, H * 0.4); // pan
      await idle();
      await pan(W * 0.7, H * 0.55, W * 0.2, H * 0.45, 5, 8); // fling
      await idle();
      await phase('pinch');
      await pinch(W / 2, H * 0.5, 300, 90); // out
      await idle();
      // A tap flight: into the widest species on screen, and back (the reset).
      await phase('flight');
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
      return { by: window.__pp.by, cbBy: window.__pp.cbBy, long: window.__pp.long, drawBy: window.__pp.drawBy, tapBy: window.__pp.tapBy, heap: Math.round(window.__pp.heap), deltas: window.__pp.deltas, cb: window.__pp.cb, draw: [...window.__fan.frameMs], lab: [...(window.__fan.labelAllMs ?? [])], lay: [...(window.__fan.labelLayMs ?? [])] };
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
      heap: rec.heap,
      // (Per gesture, ToLaD#343: the rAF deltas' p50/p95 while pinching, panning, flying.)
      by: Object.fromEntries(Object.entries(rec.by).map(([k, a]) => [k, { p50: q(a, 0.5), p95: q(a, 0.95), n: a.length }])),
      // (Per phase the page's rAF callbacks' main-thread ms (its frames' own work) and its long tasks (a tap's work in its event).)
      cbBy: Object.fromEntries(Object.entries(rec.cbBy).map(([k, a]) => [k, { p50: +q(a, 0.5).toFixed(1), p95: +q(a, 0.95).toFixed(1), max: +q(a, 1).toFixed(1), n: a.length }])),
      long: Object.fromEntries(Object.entries(rec.long).map(([k, a]) => [k, { n: a.length, max: Math.round(q(a, 1)), sum: Math.round(a.reduce((x, y) => x + y, 0)) }])),
      drawBy: Object.fromEntries(Object.entries(rec.drawBy ?? {}).map(([k, a]) => [k, { p50: +q(a, 0.5).toFixed(1), p95: +q(a, 0.95).toFixed(1), max: +q(a, 1).toFixed(1), n: a.length }])),
      tapBy: Object.fromEntries(Object.entries(rec.tapBy ?? {}).map(([k, a]) => [k, a.map((x) => Math.round(x))])),
      steps,
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
      // (The labels, ToLaD#255: their work a frame (laid out or carried), and each layout's.)
      lab50: q(rec.lab, 0.5),
      labMean: rec.lab.length ? rec.lab.reduce((a, b) => a + b, 0) / rec.lab.length : NaN,
      lays: rec.lay.length,
      lay50: q(rec.lay, 0.5),
      lay95: q(rec.lay, 0.95),
      secs,
    };
    rows.push(row);
    const f = (v) => v.toFixed(1).padStart(7);
    if (steps.length) console.log(`${name} route: ${steps.join(' > ')}`);
    for (const [k, c] of Object.entries(row.drawBy)) console.log(`${name.padEnd(11)} ${k.padEnd(8)} draw() ms n ${c.n} p50 ${c.p50} p95 ${c.p95} max ${c.max} | tap() ms ${JSON.stringify(row.tapBy[k] ?? [])} | rAF p50 ${row.by[k]?.p50?.toFixed(1)} p95 ${row.by[k]?.p95?.toFixed(1)} | long tasks ${JSON.stringify(row.long[k] ?? {})}`);
    console.log(
      `${name.padEnd(11)} load ${String(row.load).padStart(6)} ms | frames ${String(row.frames).padStart(4)} p50 ${f(row.p50)} p95 ${f(row.p95)} max ${f(row.max)} dropped ${String(dropped).padStart(4)} | main n ${String(row.cbs).padStart(4)} p50 ${f(row.c50)} p95 ${f(row.c95)} >16 ${String(row.over16).padStart(3)} | draw n ${String(row.draws).padStart(4)} p50 ${f(row.d50)} p95 ${f(row.d95)} | labels/f p50 ${f(row.lab50)} mean ${f(row.labMean)} | layouts ${String(row.lays).padStart(3)} p50 ${f(row.lay50)} p95 ${f(row.lay95)} | ${secs.toFixed(1)} s`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
  served.close();
}
if (process.env.JSON_OUT) writeFileSync(process.env.JSON_OUT, JSON.stringify(rows, null, 1));
