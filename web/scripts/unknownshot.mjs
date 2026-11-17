// A species whose count nobody knows (ToLaD#507, FLAG bit 11), default headless (no GPU flags), from the page as pages.yml
// stages it (served over http, the mammal level), at 390×844. For each: its branch on the tree beside a known relative
// (the smallest group holding it and another, framed as a tap on that group frames it), then its card as the search
// opens it: the face, the Details, and the link "no range map, never counted" tapped (the methods page's step 8).
//   npm run build:single && node scripts/unknownshot.mjs <out-dir> [dist-dir]
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/unknown';
const DIST = process.argv[3] || 'dist-single';
mkdirSync(OUT, { recursive: true });
const site = mkdtempSync(join(tmpdir(), 'unknown-site-'));
for (const f of ['index.html', 'mammals.json', 'globe.json', 'globe-draw.js']) copyFileSync(join(DIST, f), join(site, f));
const served = await pageUrl('level=mammals', site);
const browser = await chromium.launch({ headless: true });
const SPECIES = (process.env.SPECIES || 'Gerbillus agag,Makalata obscura,Scotophilus borbonicus').split(',');

const still = (page) =>
  page.waitForFunction(() => !window.__fan.anim && !window.__fan.gesturing, null, { timeout: 60_000 }).then(() => page.waitForTimeout(1200));

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(served.url);
  await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  for (const sci of SPECIES) {
    const name = sci.split(' ')[1];
    // The tree: the smallest group holding it and at least one more, its relatives named.
    const group = await page.evaluate((sci) => {
      const f = window.__fan;
      const b = f.fan.branches.find((b) => b.sp.sci === sci);
      if (!b) return null;
      const holds = f.fan.nodes.filter((n) => n.strands.includes(b) && n.strands.length >= 2).sort((a, z) => a.strands.length - z.strands.length);
      const v = holds[0];
      f.flyToClade(v);
      return { group: v.name ?? v.split?.taxon ?? '', kin: v.strands.map((s) => `${s.sp.sci} (${s.sp.countUnknown ? 'unknown' : Math.round(s.sp.alive)})`) };
    }, sci);
    if (!group) {
      console.log(`${sci}: not on the fan`);
      continue;
    }
    await still(page);
    const widths = await page.evaluate((sci) => {
      const f = window.__fan;
      const b = f.fan.branches.find((b) => b.sp.sci === sci);
      const kin = f.fan.nodes.filter((n) => n.strands.includes(b) && n.strands.length >= 2).sort((a, z) => a.strands.length - z.strands.length)[0].strands;
      return kin.map((s) => `${s.sp.sci} ${(s.width * f.cam.sx).toFixed(2)} px`);
    }, sci);
    console.log(`${sci}: group ${group.group}: ${group.kin.join(', ')}\n  widths now: ${widths.join('; ')}`);
    await page.screenshot({ path: join(OUT, `${name}-1-tree.png`) });
    // Its hairline up close: the band of the page it crosses (the view is turned a quarter: its x is the page's y).
    const py = await page.evaluate((sci) => {
      const f = window.__fan;
      const b = f.fan.branches.find((b) => b.sp.sci === sci);
      const xr = f.fan.tess.xRange(b, f.camera.worldY(-20), f.camera.worldY(f.h + 20));
      return f.camera.screenX((xr[0] + xr[1]) / 2);
    }, sci);
    const top = Math.max(0, Math.min(844 - 100, Math.round(py) - 50));
    await page.screenshot({ path: join(OUT, `${name}-1b-hairline.png`), clip: { x: 0, y: top, width: 390, height: 100 } });
    // Landed on it and on its best-known relative, no card: the faint band and a known one, each at its own zoom.
    for (const [tag, who] of [['1c-landed', sci], ['1d-relative', null]]) {
      await page.evaluate(
        ([sci, who]) => {
          const f = window.__fan;
          const b = f.fan.branches.find((b) => b.sp.sci === sci);
          const kin = f.fan.nodes.filter((n) => n.strands.includes(b) && n.strands.length >= 2).sort((a, z) => a.strands.length - z.strands.length)[0].strands;
          const to = who ? b : kin.filter((k) => k !== b).sort((a, z) => z.sp.alive - a.sp.alive)[0];
          f.flyToSpecies(to.sp, false);
        },
        [sci, who ?? ''],
      );
      await still(page);
      await page.screenshot({ path: join(OUT, `${name}-${tag}.png`) });
    }
    // The card, as the search opens it: a flight to the species, the card at its tip.
    await page.evaluate((sci) => {
      const f = window.__fan;
      f.flyToSpecies(f.fan.branches.find((b) => b.sp.sci === sci).sp);
    }, sci);
    await page.waitForSelector('.card-sp', { timeout: 30000 });
    await page.waitForSelector('.card-sp .globe canvas, .card-sp .range img', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, `${name}-2-card.png`) });
    await page.evaluate(() => document.querySelector('.card-sp .facts')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${name}-3-face.png`) });
    await page.evaluate(() => {
      const d = document.querySelector('.card-sp details.more');
      d?.setAttribute('open', '');
      d?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${name}-4-details.png`) });
    const text = await page.evaluate(() => document.querySelector('.card-sp .body')?.innerText.replace(/\s*\n\s*/g, ' | ') ?? '');
    console.log(`  card: ${text.slice(0, 900)}`);
    // Its "why" tapped: "How we count" at What we don't know.
    const at = await page.evaluate(() => {
      const a = document.querySelector('.card-sp .facts a[data-method="m-unknown"]');
      a?.click();
      return a?.dataset.method ?? null;
    });
    if (at) {
      await page.waitForSelector('.methods', { timeout: 10000 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, `${name}-5-page.png`) });
      await page.goBack({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    } else console.log('  no link to m-unknown on the face');
    await page.evaluate(() => document.querySelector('.card-sp .x')?.click());
    await page.waitForTimeout(800);
  }
} finally {
  await browser.close();
  served.close();
}
