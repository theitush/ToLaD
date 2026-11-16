// ToLaD#352: from mammals home, a path of taps on groups' pills or pictures (real touches, 390×844, default headless,
// no GPU flags); after each landing a screenshot and what the view shows: the level it is at, the pills and pictures.
//   npm run build:single && node scripts/tapshot.mjs <out-dir> <prefix> <step,step,...>
//   (a step: a group's name as its pill shows it, _ for a space, `pic:<name>` its picture instead; run under flock /tmp/tolad-browser.lock)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const out = process.argv[2] || 'perf-out/tapshot';
const prefix = process.argv[3] || 't';
const steps = (process.argv[4] || '').split(',').filter(Boolean).map((s) => s.replace(/_/g, ' '));
mkdirSync(out, { recursive: true });
process.env.LEVEL = 'mammals';
// (PAGE=<url>: that page instead of dist-single, e.g. the live site for a before shot.)
const { url, close } = process.env.PAGE ? { url: process.env.PAGE, close() {} } : await pageUrl('level=mammals');
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__fan && window.__fan.fan.branches.length > 1000, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    // A pill's or picture's group by the name its pill shows (a signpost's, ToLaD#333), else its own.
    window.__nm = (v) => window.__fan.cutLast?.spots.find((s) => s.fam === v)?.text || (window.__levelName ? window.__levelName(v) : v.split?.taxon || v.name);
  });
  const state = () =>
    page.evaluate(() => {
      const f = window.__fan;
      const nm = window.__nm;
      const lv = f.levelNow(true);
      const lvName = lv.b ? lv.b.sp.common : nm(lv.v);
      const pills = f.famHits.map((h) => `${nm(h.v)}@${h.box.map((x) => x | 0).join(',')}`);
      const pics = f.thumbHits.map((t) => `${t[4] ? `${nm(t[4])} [${t[4].split?.taxon ?? ""} n=${t[4].strands.length}, face ${t[3].sp.common}]` : t[3].sp.common}@${t[0] | 0},${t[1] | 0}`);
      const names = f.nameHits.map((h) => h.b.sp.common);
      const plus = f.plusHits.map((h) => `+${h.bs.length}`);
      return { level: lvName, cam: { cx: +f.cam.cx.toFixed(4), cy: +f.cam.cy.toFixed(4), sx: +f.cam.sx.toExponential(3), sy: +f.cam.sy.toExponential(3) }, pills, pics, names, plus };
    });
  const shot = async (k, label) => {
    const s = await state();
    await page.screenshot({ path: `${out}/${prefix}${k}-${label.replace(/[^\w]+/g, '_')}.png` });
    console.log(`${k} ${label}: at ${s.level}; cam ${JSON.stringify(s.cam)}\n  pills ${s.pills.join(' | ')}\n  pics ${s.pics.join(' | ')}\n  names ${s.names.join(', ')}\n  plus ${s.plus.join(' ')}`);
  };
  await shot(0, 'home');
  let k = 1;
  for (const step of steps) {
    const pic = step.startsWith('pic:');
    const g = pic ? step.slice(4) : step;
    const at = await page.evaluate(
      ([g, pic]) => {
        const f = window.__fan;
        const nm = window.__nm;
        if (!pic) {
          const h = f.famHits.find((q) => nm(q.v) === g);
          if (h) return [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2];
        }
        const n = f.nameHits.find((q) => q.b.sp.common === g);
        if (n && !pic) return [(n.box[0] + n.box[2]) / 2, (n.box[1] + n.box[3]) / 2];
        const t = f.thumbHits.find((q) => (q[4] ? nm(q[4]) : q[3].sp.common) === g);
        return t ? [t[0], t[1]] : null;
      },
      [g, pic],
    );
    if (!at) {
      console.log(`${k} ${step}: not on screen`);
      break;
    }
    await page.touchscreen.tap(at[0], at[1]);
    // (Past the double-tap window, then the flight run out and the camera still for half a second.)
    await page.waitForTimeout(700);
    let last = '';
    for (let n = 0; n < 60; n++) {
      await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
      const c = await page.evaluate(() => JSON.stringify(window.__fan.cam));
      if (c === last) break;
      last = c;
      await page.waitForTimeout(500);
    }
    await shot(k++, step);
  }
} finally {
  await browser.close();
  close();
}
