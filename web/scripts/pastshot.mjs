// ToLaD#279 picstop shots: a pan into the past at a level, a shot every STEP px (390x844, default headless, no GPU flags), and per shot the fossils' pictures on screen,
// each with its top (screen px, along time): held at the screen's top edge (0) or under a label there, else as laid at its tip. A scene is a level as a tap on it lands (goLevel), `home`, or `hominins`: the Hominins' landing as a tap on the human picture
// from Primates lands (ToLaD#497).
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/pastshot.mjs <out-dir> <prefix> [hominins,Carnivora] [0,120,240,360]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2];
const PREFIX = process.argv[3] || '';
const SCENES = (process.argv[4] || 'hominins,Carnivora').split(',');
const STEPS = (process.argv[5] || '0,120,240,360').split(',').map(Number);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const served = process.env.PAGE ? null : await pageUrl(process.env.Q || '');
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(process.env.PAGE || served.url);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 60000 });
  const still = async () => {
    await page.waitForTimeout(700);
    await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
    await page.waitForTimeout(2500);
  };
  const go = (latin) =>
    page.evaluate((latin) => {
      const f = window.__fan;
      f.anim = null;
      f.cam = f.homeCamera();
      f.camera.settle();
      f.onSelect(null);
      f.selected = null;
      f.carded = null;
      const u = latin && f.fan.nodes.find((q) => q.split && (q.split.taxon ?? '').replace(/\s*\(.*\)\s*$/, '') === latin);
      if (u) f.goLevel({ v: u }, f.cam, false);
      f.request();
    }, latin);
  const say = () =>
    page.evaluate(() => {
      const f = window.__fan;
      const pics = f.cutLast?.pics ?? [];
      const fos = pics.filter((p) => !p.held);
      return `${pics.length - fos.length} column pictures, ${fos.length} fossils': ${fos.map((p) => `${p.face.sp.sci.replace(/^(\w)\w+ /, '$1. ')} @${Math.round(p.y - (p.d ?? 36) / 2)}`).join(', ')}`;
    });
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
    const cam0 = await page.evaluate(() => ({ ...window.__fan.cam }));
    for (const k of STEPS) {
      await page.evaluate(
        ([cam, k]) => {
          const f = window.__fan;
          f.anim = null;
          f.cam = { ...cam, cy: cam.cy + k / cam.sy };
          f.camera.settle();
          f.request();
        },
        [cam0, k],
      );
      await page.waitForTimeout(1500);
      console.log(`${PREFIX}${sc} +${k}px: ${await say()}`);
      await page.screenshot({ path: `${OUT}/${PREFIX}${sc.toLowerCase()}-${k}.png` });
    }
  }
} finally {
  await browser.close();
  served?.close();
}
