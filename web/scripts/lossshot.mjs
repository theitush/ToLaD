// What dates a species' range loss, on its card (ToLaD#507 group 3), default headless (no GPU flags), from the page as
// pages.yml stages it (served over http, the mammal level, both data files), at 390×844. For each species: its card as
// the search opens it (once mammals-card.json is in), the face scrolled to the chart and the line under it, and for the
// first the line's words tapped (the methods page at step 2).
//   npm run build:single && node scripts/lossshot.mjs <out-dir> [dist-dir]
//   SPECIES="Myrmecobius fasciatus,Cuon alpinus" picks the species.
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/loss';
const DIST = process.argv[3] || 'dist-single';
mkdirSync(OUT, { recursive: true });
const site = mkdtempSync(join(tmpdir(), 'loss-site-'));
for (const f of ['index.html', 'mammals.json', 'mammals-card.json', 'globe.json', 'globe-draw.js']) copyFileSync(join(DIST, f), join(site, f));
const served = await pageUrl('level=mammals', site);
const browser = await chromium.launch({ headless: true });
const SPECIES = (
  process.env.SPECIES || 'Myrmecobius fasciatus,Myrmecophaga tridactyla,Cuon alpinus,Lemur catta,Bradypus torquatus'
).split(',');

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(served.url);
  await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  let first = true;
  for (const sci of SPECIES) {
    const name = sci.split(' ')[1];
    const ok = await page.evaluate((sci) => {
      const f = window.__fan;
      const b = f.fan.branches.find((b) => b.sp.sci === sci);
      if (!b) return false;
      f.flyToSpecies(b.sp);
      return true;
    }, sci);
    if (!ok) {
      console.log(`${sci}: not on the fan`);
      continue;
    }
    await page.waitForSelector('.card-sp', { timeout: 30000 });
    await page.waitForSelector('.card-sp .loss', { timeout: 30000 }).catch(() => console.log(`${sci}: no loss line`));
    await page.waitForSelector('.card-sp .globe canvas, .card-sp .range img', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, `${name}-1-card.png`) });
    await page.evaluate(() => (document.querySelector('.card-sp .spark') ?? document.querySelector('.card-sp .facts'))?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${name}-2-line.png`) });
    const line = await page.evaluate(() => document.querySelector('.card-sp .loss')?.innerText ?? '(none)');
    console.log(`${sci}: ${line}`);
    if (first) {
      first = false;
      const at = await page.evaluate(() => {
        const a = document.querySelector('.card-sp .loss a.mlink');
        a?.click();
        return a?.dataset.method ?? null;
      });
      if (at) {
        await page.waitForSelector('.methods', { timeout: 10000 });
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(OUT, `${name}-3-page-${at}.png`) });
        // The five cases, under the two maps.
        await page.evaluate(() => document.querySelector('[data-loss-cases]')?.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `${name}-4-page-cases.png`) });
        await page.goBack({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
    }
    await page.evaluate(() => document.querySelector('.card-sp .x')?.click());
    await page.waitForTimeout(800);
  }
} finally {
  await browser.close();
  served.close();
}
