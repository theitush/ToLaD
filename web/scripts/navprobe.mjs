// ToLaD#302: moving around a level by real touch drags and pinches (CDP touch events, as pinchshot), frame by frame:
// what jumps or flickers. From a level's frame, each gesture in turn; after every move step and at rest it logs the
// camera, the level the view is at (levelNow), which labels are on and which group pictures and pills are drawn, and
// flags a label turning on and off again within one gesture, a picture popping, the camera moving without the
// fingers, or levelNow flipping. Default headless, no GPU flags; run under flock /tmp/tolad-browser.lock.
//   npm run build:single && LEVEL=mammals node scripts/navprobe.mjs <taxon> [query] [out-dir]
//   (e.g. Hominini 'level=mammals'; SHOTS=1 screenshots each gesture's end)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const taxon = process.argv[2] || 'Hominini';
const query = process.argv[3] ?? 'level=mammals';
const out = process.argv[4] || 'perf-out/navprobe';
mkdirSync(out, { recursive: true });
process.env.LEVEL = 'mammals';
const { url, close } = await pageUrl(query);
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  if (process.env.SPOTS) page.on('console', (m) => console.log('  [page]', m.text()));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__fan && window.__fan.fan.branches.length > 1000, null, { timeout: 60000 });
  const cdp = await ctx.newCDPSession(page);
  // (SPOTS=<id>: each step, that name's spots, their fit and which is on: why it flickers, ToLaD#311.)
  const spotsOf = process.env.SPOTS || '';
  const state = () =>
    page.evaluate((spotsOf) => {
      const f = window.__fan;
      if (spotsOf) {
        const L = f.labLast;
        const ss = (L?.spots ?? []).filter((s) => s.id === spotsOf);
        console.log(`${L && L.frames ? 'carried' : 'laid'} ` + ss.filter((s) => s.fit > 0 || f.labelState.get(s.key)?.on).map((s) => `${f.labelState.get(s.key)?.on ? '*' : ''}${s.key.slice(s.id.length + 1)} ${s.fit.toFixed(2)} [${s.box.map((x) => x.toFixed(0))}]`).join(' | '));
      }
      const l = f.levelNow();
      const on = [...f.labelState].filter(([, s]) => s.on).map(([k]) => k);
      return {
        cam: { ...f.cam },
        lv: l.b ? l.b.sp.sci : l.v.name ?? '(unnamed)',
        on,
        pics: f.thumbHits.length,
        pills: f.famHits.map((h) => h.v.name ?? '?'),
        // (What the eye sees move, ToLaD#302: the screen x of the column picked at the gesture's start, at screen
        // y 450, its middle; the camera's cx moves with the layout too, as the rooms open, which nobody sees.)
        mark: (() => {
          const b = window.__mark;
          if (!b) return null;
          // (lanePoints: flat arrays since ToLaD#255.)
          const P = f.lanePoints(b, 0);
          let best = -1;
          for (let i = 0; i < P.n; i++) if (best < 0 || Math.abs(P.y[i] - 450) < Math.abs(P.y[best] - 450)) best = i;
          return best >= 0 ? P.x[best] + (P.w[best] * f.cam.sx) / 2 : null;
        })(),
      };
    }, spotsOf);
  const start = () =>
    page.evaluate((t) => {
      const f = window.__fan;
      // (The level's frame as a tap on it lands, cladeCamera: ToLaD#311.)
      const v = f.fan.nodes.find((n) => n.split.taxon === t);
      f.cam = v ? f.cladeCamera(v) : f.homeCamera();
      f.camera.settle();
      f.labelState.clear();
      f.request();
    }, taxon);
  // One gesture: fingers from a to b (one or two), in n steps; the state after each step and at rest.
  const gesture = async (name, from, to, n = 20) => {
    const pts = (u) => from.map((p, i) => ({ x: p[0] + (to[i][0] - p[0]) * u, y: p[1] + (to[i][1] - p[1]) * u, id: i }));
    await page.evaluate(() => {
      const f = window.__fan;
      // (The widest column under the gesture's middle row, near the screen's centre.)
      window.__mark = null;
      for (let d = 0; d < 195 && !window.__mark; d += 3) window.__mark = f.hitBranch(195 + d, 450) ?? f.hitBranch(195 - d, 450);
    });
    const log = [await state()];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
    for (let k = 1; k <= n; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(k / n) });
      await page.waitForTimeout(32);
      log.push(await state());
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    for (let k = 0; k < 8; k++) {
      await page.waitForTimeout(150);
      log.push(await state());
    }
    // flicker: a label on, off, on (or off, on, off) within the gesture; pictures' count changing back and forth
    const flick = new Set();
    const keys = new Set(log.flatMap((s) => s.on));
    for (const k of keys) {
      const seq = log.map((s) => s.on.includes(k));
      let changes = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) changes++;
      if (changes >= 2) flick.add(`${k}×${changes}`);
    }
    // (A name on, off, on again: what the eye sees flicker. A name moving between its spots is not counted there.)
    const ids = new Set(log.flatMap((s) => s.on.map((k) => k.split(':')[0])));
    const nameFlick = [];
    for (const id of ids) {
      const seq = log.map((s) => s.on.some((k) => k.split(':')[0] === id));
      let changes = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) changes++;
      if (changes >= 2) nameFlick.push(`${id}×${changes}`);
    }
    const lvs = [...new Set(log.map((s) => s.lv))];
    const runs = (a) => a.filter((x, i) => i === 0 || x !== a[i - 1]).join(',');
    const pics = runs(log.map((s) => s.pics));
    const pills = runs(log.map((s) => s.pills.length));
    // the camera moving after the fingers left (a fling is expected; a big jump is not)
    const c0 = log[n].cam;
    const cz = log[log.length - 1].cam;
    const settle = `Δcx ${((cz.cx - c0.cx) * cz.sx).toFixed(0)}px Δcy ${((cz.cy - c0.cy) * cz.sy).toFixed(0)}px ×w ${(cz.sx / c0.sx).toFixed(2)} ×t ${(cz.sy / c0.sy).toFixed(2)}`;
    // the largest single-step camera jump in screen px against the fingers' step
    let jump = 0;
    for (let i = 1; i <= n; i++) {
      const a = log[i - 1].cam, b = log[i].cam;
      jump = Math.max(jump, Math.abs((b.cx - a.cx) * b.sx), Math.abs((b.cy - a.cy) * b.sy));
    }
    // the marked column's screen x: its largest step under the fingers, and its move after they left
    let mjump = 0;
    for (let i = 1; i <= n; i++) if (log[i].mark !== null && log[i - 1].mark !== null) mjump = Math.max(mjump, Math.abs(log[i].mark - log[i - 1].mark));
    const mz = log[log.length - 1].mark;
    const mrel = mz !== null && log[n].mark !== null ? `${(mz - log[n].mark).toFixed(0)}px` : 'lost';
    console.log(`${name}: column seen moves ≤${mjump.toFixed(0)}px a step, ${mrel} after release`);
    console.log(`${name}: level ${lvs.join(' → ')} | names flicker ${nameFlick.join(' ') || 'none'} | spots flicker ${[...flick].join(' ') || 'none'} | pics ${pics} | pills ${pills} | max step ${jump.toFixed(0)}px | after release ${settle} | on at rest ${log[log.length - 1].on.length}`);
    if (process.env.SHOTS) await page.screenshot({ path: `${out}/${taxon}-${name}.png` });
  };
  await start();
  await page.waitForTimeout(800);
  const s0 = await state();
  console.log(`${taxon} (${query}): at ${s0.lv}, labels on ${s0.on.length}: ${s0.on.slice(0, 12).join(', ')}`);
  if (process.env.SHOTS) await page.screenshot({ path: `${out}/${taxon}-start.png` });
  if (process.env.LADDER) {
    // the ladder levelNow climbs from the line at the screen's centre: each frame and how far the view is off it
    console.log(await page.evaluate(() => {
      const f = window.__fan;
      const b = f.centreLine();
      const out = [`centre ${b?.sp.sci}: species frame off ${b ? f.offBy(f.frameOf({ b }), f.cam).toFixed(1) : '-'}`];
      for (let u = b ? b.node : null; u; u = u.parent)
        { const fr = f.frameOf({ v: u }); out.push(`${u.split.taxon || u.name} off ${f.offBy(fr, f.cam).toFixed(1)} z ${(Math.log(f.cam.sx / fr.sx) + Math.log(f.cam.sy / fr.sy)).toFixed(2)}`); }
      return out.filter((l, i) => i < 2 || !l.startsWith("Human ancestors")).slice(0, 8).join('\n  ');
    }));
  }
  if (process.env.COUNTS) {
    // what the page holds for each hominin: alive at a time (the constant model's N), ever lived, its band
    const rows = await page.evaluate(() => {
      const f = window.__fan;
      return f.fan.branches
        .filter((b) => /^(Homo|Australopithecus|Paranthropus|Ardipithecus|Sahelanthropus|Orrorin|Kenyanthropus) /.test(b.sp.sci))
        .map((b) => ({ sci: b.sp.sci, common: b.sp.common, n: (b.sp.ever * b.sp.genYears * 0.5) / ((b.sp.t0 - b.sp.t1) * 1e6), ever: b.sp.ever, t0: b.sp.t0, t1: b.sp.t1, gen: b.sp.genYears }));
    });
    for (const r of rows) console.log(`  ${r.sci} (${r.common}): alive ${Number(r.n).toPrecision(3)}, ever ${Number(r.ever).toPrecision(3)}, ${r.t0}-${r.t1} Ma, gen ${r.gen}`);
  }
  await gesture('pan-left', [[260, 500]], [[130, 500]]);
  await gesture('pan-right', [[130, 500]], [[260, 500]]);
  await gesture('pan-up', [[195, 600]], [[195, 380]]);
  await gesture('pan-down', [[195, 380]], [[195, 600]]);
  await gesture('pinch-out-x', [[160, 450], [230, 450]], [[80, 450], [310, 450]]);
  await gesture('pinch-in-x', [[80, 450], [310, 450]], [[160, 450], [230, 450]]);
  await gesture('pinch-out-y', [[195, 380], [195, 520]], [[195, 280], [195, 620]]);
  await gesture('pinch-in-y', [[195, 280], [195, 620]], [[195, 380], [195, 520]]);
  await gesture('slow-pan', [[200, 500]], [[170, 470]], 30);
} finally {
  await browser.close();
  close();
}
