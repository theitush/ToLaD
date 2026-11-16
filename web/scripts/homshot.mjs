// ToLaD#497 shots: from a level (landed as a tap on it lands), a real tap on humans (their name, picture or column), then a
// second tap on them, then a double tap; a screenshot and the chain after each. 390x844, default headless, no GPU flags.
//   flock /tmp/tolad-browser.lock node scripts/homshot.mjs <out-dir> <prefix> [Primates,Hominidae,...] [name|picture|column]
//   (PAGE=<url>: that page instead of dist-single, e.g. the live site for a before shot.)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2];
const PREFIX = process.argv[3] || '';
const LEVELS = (process.argv[4] || 'Primates,Hominidae').split(',');
const HOW = process.argv[5] || 'name';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
let served = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  // (LIVE=1: the deployed site, main as it stands, for the before shots.)
  const live = process.env.LIVE ? 'https://theitush.github.io/ToLaD/' : process.env.PAGE;
  served = live ? null : await pageUrl('');
  await page.goto(live || served.url);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 60000 });
  const cdp = await ctx.newCDPSession(page);
  const still = async () => {
    await page.waitForTimeout(700);
    await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
    await page.waitForTimeout(400);
  };
  const say = () =>
    page.evaluate(() => {
      const f = window.__fan;
      const lv = f.levelNow(true);
      const nm = lv.b ? lv.b.sp.common : (lv.v.split?.taxon ?? 'home');
      const at = f.brackets?.atKey;
      const stack = at ? at.up.map((u) => u.split?.taxon ?? 'home').join(' < ') : '?';
      const b = f.fan.branches.find((q) => q.sp.sci === 'Homo sapiens');
      const [x0, y0] = f.toScreen(b.cx, b.tipY);
      return `${nm} | stack ${stack} | card ${!!f.selected} | human tip at view (${x0 | 0}, ${y0 | 0}) of ${f.w}x${f.h}`;
    });
  const spot = (how) =>
    page.evaluate((how) => {
      const f = window.__fan;
      const b = f.fan.branches.find((q) => q.sp.sci === 'Homo sapiens');
      let p = null;
      if (how === 'name') {
        const h = f.nameHits.find((q) => q.b === b);
        if (h) p = [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2];
      } else if (how === 'picture') {
        const h = f.thumbHits.find((q) => q[3] === b && !q[4]);
        if (h) p = [h[0], h[1]];
      } else
        for (let y = 8; !p && y < f.h - 8; y += 4) for (let x = 8; x < f.w - 8; x += 2) if (f.hitBranch(x, y) === b && !f.pillAt(x, y) && !f.picAt(x, y) && !f.plusAt(x, y)) { p = [x, y]; break; }
      if (!p) return null;
      // (View point to page point: the tree on its side turns the view, as Input reads a touch back.)
      const r = f.canvas.getBoundingClientRect();
      return f.flip ? [r.left + r.width - p[1], r.top + p[0]] : [r.left + p[0], r.top + p[1]];
    }, how);
  for (const lv of LEVELS) {
    await page.evaluate((latin) => {
      const f = window.__fan;
      f.anim = null;
      f.backing = null;
      f.tapAt = null;
      f.cam = f.homeCamera();
      f.camera.settle();
      f.onSelect(null);
      f.selected = null;
      f.carded = null;
      const u = f.fan.nodes.find((q) => q.split && (q.split.taxon ?? '').replace(/\s*\(.*\)\s*$/, '') === latin);
      if (u) f.goLevel({ v: u }, f.cam, false);
      f.request();
    }, lv);
    await still();
    const tag = `${PREFIX}${lv}-${HOW}`;
    console.log(`${tag} 0 at:`, await say());
    await page.screenshot({ path: `${OUT}/${tag}-0-at.png` });
    for (const [k, st] of [
      [1, 'tap1'],
      [2, 'tap2'],
    ]) {
      const p = await spot(HOW);
      if (!p) {
        console.log(`${tag} ${k} ${st}: no human ${HOW} on screen`);
        continue;
      }
      await page.touchscreen.tap(p[0], p[1]);
      await still();
      console.log(`${tag} ${k} ${st} @${p.map((q) => q | 0)}:`, await say());
      await page.screenshot({ path: `${OUT}/${tag}-${k}-${st}.png` });
    }
    // A double tap high on the screen, off the card.
    const at = [{ x: 195, y: 200, id: 7 }];
    await Promise.all([
      cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at }),
      cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
      cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at }),
      cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    ]);
    await still();
    console.log(`${tag} 3 dbl:`, await say());
    await page.screenshot({ path: `${OUT}/${tag}-3-dbl.png` });
  }
} finally {
  await browser.close();
  served?.close();
}
