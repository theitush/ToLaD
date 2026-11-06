// The tree on its side (ToLaD#452) on a phone: shots of home and some clades at 390×844 with `?flip=1`, the labels' names and counts,
// and one tap, one pan and one pinch driven as real touches (CDP), saying what moved. Default headless, no GPU flags.
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/flipshot.mjs <out-dir> [query, default flip=1] [drive]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/flip';
const QUERY = process.argv[3] || 'flip=1';
const DRIVE = process.argv[4] === 'drive';
mkdirSync(OUT, { recursive: true });
const { url, close } = await pageUrl(QUERY);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__fan && window.__fan.cutLast, null, { timeout: 120000 });
const settle = () => page.waitForTimeout(2500);
const state = () =>
  page.evaluate(() => {
    const v = window.__fan;
    const c = v.cutLast;
    const ka100 = v.toScreen(0, v.fan.time.y(0.1))[1];
    return {
      w: v.w,
      h: v.h,
      n: c.pics.length,
      names: c.spots.map((s) => s.text),
      picY: [...new Set(c.pics.map((p) => Math.round(p.y)))],
      ka100: Math.round(ka100),
      now: Math.round(v.toScreen(0, v.yNow)[1]),
      cam: v.cam,
      chain: document.querySelector('.chain')?.textContent ?? '',
    };
  });
const show = (name, s) => console.log(`${name}: ${s.n} labels [${s.names.join(', ')}] picY ${s.picY} 100kya@${s.ka100} now@${s.now} view ${s.w}x${s.h} sx ${s.cam.sx.toPrecision(4)} sy ${s.cam.sy.toPrecision(4)} chain: ${s.chain}`);
await settle();
show('home', await state());
await page.screenshot({ path: `${OUT}/home.png` });
const CLADES = (process.env.CLADES ?? 'Rodentia,Chiroptera,Primates,Carnivora,Felidae').split(',');
for (const name of CLADES) {
  await page.evaluate((n) => window.__fan.goToClade(n), name);
  await settle();
  show(name, await state());
  await page.screenshot({ path: `${OUT}/${name.toLowerCase()}.png` });
}
// The chain at every level clade, on the page's type: the longest, how many lost outer names, any whose innermost name alone overflows.
console.log(
  'chains:',
  await page.evaluate(() => {
    const v = window.__fan;
    const el = document.querySelector('.chain');
    const levelNow = v.levelNow;
    let n = 0;
    let cut = 0;
    let long = '';
    const over = [];
    for (const node of v.fan.nodes) {
      v.levelNow = () => ({ v: node });
      v.chainV = null;
      v.chainFrame();
      const t = el.textContent;
      n++;
      if (t.startsWith('…')) cut++;
      if (t.length > long.length) long = t;
      if (el.scrollWidth > el.clientWidth) over.push(t);
    }
    v.levelNow = levelNow;
    v.chainV = null;
    v.request();
    return { n, cut, long, over };
  }),
);
// A group whose branch ended before 100 kya: its label floats past it. The first the ladder has, walking up the zoom.
const died = await page.evaluate(() => {
  const v = window.__fan;
  const T = v.territories();
  for (let sx = v.homeCamera().sx; sx < 1e5; sx *= 1.25) {
    const g = v.coverAt(T, sx).find((c) => v.fan.time.ageAt(c.wy) > 0.1);
    if (!g) continue;
    v.cam = { ...v.homeCamera(), sx, cx: (g.a + g.b) / 2 };
    v.request();
    return { sx, ma: v.fan.time.ageAt(g.wy) };
  }
  return null;
});
await settle();
console.log('died before 100 kya:', died, (await state()).names.join(', '));
await page.screenshot({ path: `${OUT}/died.png` });
if (DRIVE) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const drag = async (from, to, steps = 12) => {
    await touch('touchStart', from);
    for (let k = 1; k <= steps; k++) {
      await touch('touchMove', from.map(([x, y], i) => [x + ((to[i][0] - x) * k) / steps, y + ((to[i][1] - y) * k) / steps]));
      await page.waitForTimeout(16);
    }
    // (Held still a moment: no fling.)
    await page.waitForTimeout(250);
    console.log(`  finger still down, chain: ${await page.evaluate(() => document.querySelector('.chain')?.textContent)}`);
    await touch('touchEnd', []);
  };
  await page.evaluate(() => window.__fan.resetView());
  await page.waitForTimeout(5000);
  const a = await state();
  show('before pan', a);
  // A finger down the phone 120 px: the branches follow it, so the world x at a phone y moves.
  const worldAt = (px, py) => page.evaluate(([x, y]) => { const v = window.__fan; const r = v.canvas.getBoundingClientRect(); return v.toWorld(y - r.top, r.width - (x - r.left)); }, [px, py]);
  const w0 = await worldAt(200, 400);
  await drag([[200, 400]], [[200, 520]]);
  await settle();
  const w1 = await worldAt(200, 520);
  console.log(`pan: finger (200,400)->(200,520): the world point under it ${w0} -> ${w1}; cam.cx ${a.cam.cx} -> ${(await state()).cam.cx}`);
  await page.screenshot({ path: `${OUT}/after-pan.png` });
  // A sideways pan: time moves, labels stay on 100 kya while it is on screen.
  const b = await state();
  await drag([[120, 400]], [[200, 400]]);
  await settle();
  const c = await state();
  show('after sideways pan', c);
  console.log(`sideways pan 80 px: cam.cy ${b.cam.cy} -> ${c.cam.cy}, sy ${b.cam.sy} -> ${c.cam.sy}`);
  await page.screenshot({ path: `${OUT}/after-pan-time.png` });
  // A pinch down the phone's tall side: width (sx) only; across it: time (sy) only.
  const d = await state();
  await drag([[200, 360], [200, 460]], [[200, 260], [200, 560]]);
  await settle();
  const e = await state();
  console.log(`pinch up-down: sx ${d.cam.sx.toPrecision(4)} -> ${e.cam.sx.toPrecision(4)}, sy ${d.cam.sy.toPrecision(4)} -> ${e.cam.sy.toPrecision(4)}`);
  show('after pinch', e);
  await page.screenshot({ path: `${OUT}/after-pinch-width.png` });
  await drag([[150, 400], [250, 400]], [[90, 400], [310, 400]]);
  await settle();
  const f = await state();
  console.log(`pinch across: sx ${e.cam.sx.toPrecision(4)} -> ${f.cam.sx.toPrecision(4)}, sy ${e.cam.sy.toPrecision(4)} -> ${f.cam.sy.toPrecision(4)}`);
  show('after pinch across', f);
  await page.screenshot({ path: `${OUT}/after-pinch-time.png` });
  // A tap on a picture: its group's frame.
  await page.evaluate(() => window.__fan.goToClade('Carnivora'));
  await settle();
  const g = await page.evaluate(() => {
    const v = window.__fan;
    const r = v.canvas.getBoundingClientRect();
    const p = v.cutLast.pics[v.cutLast.pics.length - 1];
    return { x: r.left + r.width - p.y, y: r.top + p.x, name: v.cutLast.spots[p.i].text };
  });
  await touch('touchStart', [[g.x, g.y]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(3500);
  const h = await state();
  console.log(`tap on ${g.name}'s picture at phone (${g.x.toFixed(0)},${g.y.toFixed(0)})`);
  show('after tap', h);
  await page.screenshot({ path: `${OUT}/after-tap.png` });
}
await browser.close();
await close();
