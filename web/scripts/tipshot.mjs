// ToLaD#279 step 4 shots: fossils named and pictured at their own tip. 390x844, default headless, no GPU flags.
// Home; the levels as a tap on them lands (goLevel); the Hominins' landing as a real tap on the human picture from Primates lands (ToLaD#497).
// Each shot's line: the level, and its fossils (strands ended before the labels' line, or standing inside a wider lane there) on screen, named or not.
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/tipshot.mjs <out-dir> <prefix> [home,hominins,Felidae,...]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2];
const PREFIX = process.argv[3] || '';
const SCENES = (process.argv[4] || 'home,hominins,Felidae,Proboscidea,Cetacea,Carnivora,Primates,Rodentia').split(',');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const served = await pageUrl('');
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(served.url);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 60000 });
  const still = async () => {
    await page.waitForTimeout(700);
    await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
    // (The pictures load from the web.)
    await page.waitForTimeout(2500);
  };
  const say = () =>
    page.evaluate(() => {
      const f = window.__fan;
      const lv = f.levelNow(true);
      const nm = lv.b ? lv.b.sp.common : (lv.v.split?.taxon ?? 'home');
      const named = new Set(f.nameHits.map((h) => h.b));
      const pics = new Set(f.thumbHits.filter((t) => !t[4]).map((t) => t[3]));
      const fold = f.fan.tess.fold;
      const { C } = fold.rooms();
      const yCol = f.fan.time.y(0.1);
      const gone = f.fan.branches.filter((b) => b.sp.extinct || b.tipY > yCol);
      const on = gone.filter((b) => {
        const [x, y] = f.toScreen(C[b.index], b.tipY);
        return x >= 0 && x <= f.w && y >= 0 && y <= f.h;
      });
      const list = on.map((b) => `${b.sp.sci.replace(/^(\w)\w+ /, '$1. ')}${named.has(b) ? ' N' : ''}${pics.has(b) ? ' P' : ''}`);
      return `${nm} | fossils with tips on screen ${on.length}, named ${on.filter((b) => named.has(b)).length}, pictured ${on.filter((b) => pics.has(b)).length}: ${list.join(', ')}`;
    });
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
    } else await go(sc === 'home' ? null : sc);
    await still();
    console.log(`${PREFIX}${sc}:`, await say());
    await page.screenshot({ path: `${OUT}/${PREFIX}${sc}.png` });
  }
} finally {
  await browser.close();
  served.close();
}
