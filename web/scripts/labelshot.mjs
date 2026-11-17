// ToLaD#502 step 2 check: a few scenes shot, with the labels the page drew there (names, pills, pictures and their
// places, from the view's last cut), for one build against another. 390x844, default headless, no GPU flags.
// Scenes: home, Carnivora and Primates as a tap on them lands (goLevel), the Hominins' landing (a real tap on the human
// picture at Primates, as tipshot.mjs), and a pinch midway (home, then zoomed 2^5 about the middle of the screen).
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/labelshot.mjs <out-dir> <prefix> [dist dir]
//   node scripts/labelshot.mjs <out-dir> --diff <prefixA> <prefixB>     (pixels and labels compared, no shots)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2];
const SCENES = ['home', 'Carnivora', 'Primates', 'hominins', 'pinch'];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function shoot(prefix, dir) {
  const served = await pageUrl('', dir);
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', String(e)));
    await page.goto(served.url);
    await page.waitForFunction(() => !!window.__fan, null, { timeout: 60000 });
    const still = async () => {
      await page.waitForTimeout(700);
      await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
      // (The pictures load from the web: settled when no more come for a while.)
      let n = -1;
      for (let k = 0; k < 12; k++) {
        await page.waitForTimeout(1500);
        const m = await page.evaluate(() => document.querySelectorAll('img').length + performance.getEntriesByType('resource').length);
        if (m === n) break;
        n = m;
      }
    };
    const go = (latin) =>
      page.evaluate((latin) => {
        const f = window.__fan;
        f.anim = null;
        f.backing = null;
        f.tapAt = null;
        f.cam = f.homeCamera();
        f.camera.settle();
        f.onSelect(null);
        f.selected = null;
        f.carded = null;
        const u = latin && f.fan.nodes.find((q) => q.split && (q.split.taxon ?? '').replace(/\s*\(.*\)\s*$/, '') === latin);
        if (u) f.goLevel({ v: u }, f.cam, false);
        f.request();
      }, latin);
    const labels = () =>
      page.evaluate(() => {
        const c = window.__fan.cutLast;
        const r = (x) => Math.round(x * 100) / 100;
        const s = (q) => `${q.key} "${q.text}" ${r(q.x)},${r(q.y1)}`;
        return { names: c.names.map(s), spots: c.spots.map(s), pics: c.pics.map((p) => `${p.face?.sp?.sci ?? p.face?.split?.taxon ?? '?'} ${r(p.x)},${r(p.y)} ${p.d ?? 36}`) };
      });
    const out = {};
    for (const sc of SCENES) {
      if (sc === 'hominins') {
        await go('Primates');
        await still();
        const p = await page.evaluate(() => {
          const f = window.__fan;
          const b = f.fan.branches.find((q) => q.sp.sci === 'Homo sapiens');
          const h = f.thumbHits.find((q) => q[3] === b && !q[4]);
          if (!h) return null;
          const r = f.canvas.getBoundingClientRect();
          return f.flip ? [r.left + r.width - h[1], r.top + h[0]] : [r.left + h[0], r.top + h[1]];
        });
        if (!p) {
          console.log('hominins: no human picture at Primates');
          continue;
        }
        await page.touchscreen.tap(p[0], p[1]);
      } else if (sc === 'pinch') {
        await go(null);
        await page.evaluate(() => {
          const f = window.__fan;
          f.zoomAbout(f.w / 2, f.h / 2, 32, 32);
          f.request();
        });
      } else await go(sc === 'home' ? null : sc);
      await still();
      out[sc] = await labels();
      console.log(`${prefix}${sc}: ${out[sc].names.length} names, ${out[sc].spots.length} pills, ${out[sc].pics.length} pictures`);
      await page.screenshot({ path: `${OUT}/${prefix}${sc}.png` });
    }
    writeFileSync(`${OUT}/${prefix}labels.json`, JSON.stringify(out, null, 1));
  } finally {
    served.close();
  }
}

async function diff(a, b) {
  const page = await (await browser.newContext()).newPage();
  const la = JSON.parse(readFileSync(`${OUT}/${a}labels.json`, 'utf8'));
  const lb = JSON.parse(readFileSync(`${OUT}/${b}labels.json`, 'utf8'));
  for (const sc of SCENES) {
    const url = (p) => `data:image/png;base64,${readFileSync(`${OUT}/${p}${sc}.png`).toString('base64')}`;
    const px = await page.evaluate(
      async ([u, v]) => {
        const load = async (s) => {
          const im = new Image();
          im.src = s;
          await im.decode();
          const c = document.createElement('canvas');
          [c.width, c.height] = [im.width, im.height];
          const g = c.getContext('2d');
          g.drawImage(im, 0, 0);
          return g.getImageData(0, 0, c.width, c.height);
        };
        const [p, q] = [await load(u), await load(v)];
        let [n, x0, y0, x1, y1] = [0, Infinity, Infinity, -1, -1];
        for (let i = 0; i < p.data.length; i += 4) {
          if (p.data[i] === q.data[i] && p.data[i + 1] === q.data[i + 1] && p.data[i + 2] === q.data[i + 2]) continue;
          n++;
          const [x, y] = [(i / 4) % p.width, Math.floor(i / 4 / p.width)];
          [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
        }
        return n ? `${n} px differ in ${x0},${y0}..${x1},${y1}` : '0 px differ';
      },
      [url(a), url(b)],
    );
    const same = JSON.stringify(la[sc]) === JSON.stringify(lb[sc]);
    console.log(`${sc}: ${px}; labels ${same ? 'the same' : 'DIFFER'}`);
    if (!same) for (const k of ['names', 'spots', 'pics']) if (JSON.stringify(la[sc]?.[k]) !== JSON.stringify(lb[sc]?.[k])) console.log(`  ${k}: ${JSON.stringify(la[sc]?.[k])}\n  vs ${JSON.stringify(lb[sc]?.[k])}`);
  }
}

try {
  if (process.argv[3] === '--diff') await diff(process.argv[4], process.argv[5]);
  else await shoot(process.argv[3] || '', process.argv[4] || 'dist-single');
} finally {
  await browser.close();
}
