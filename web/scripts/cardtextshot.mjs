// The species card's words and their links to "How we count" (ToLaD#508), default headless (no GPU flags), from the page
// as pages.yml stages it (served over http, the mammal level), at 390×844: six cards (a census or cited count, a
// Greenspoon species, a modelled one, one #507 made flat, a domestic one, a fossil), each flown to as the search does, its
// face and its Details; then, where the card has them, its links listed (their anchors), one tapped: the page shot at
// that section, back closing it with the card as it was (open, same scroll).
//   npm run build:single && node scripts/cardtextshot.mjs <out-dir> [tag] [dist-dir]
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/cardtext';
const TAG = process.argv[3] || 'after';
const DIST = process.argv[4] || 'dist-single';
mkdirSync(OUT, { recursive: true });
const site = mkdtempSync(join(tmpdir(), 'cardtext-site-'));
for (const f of ['index.html', 'mammals.json', 'mammals-card.json', 'globe.json', 'globe-draw.js']) copyFileSync(join(DIST, f), join(site, f));
const served = await pageUrl('level=mammals', site);
const browser = await chromium.launch({ headless: true });
const SPECIES = [
  ['1-lion', 'Panthera leo'],
  ['2-quoll', 'Dasyurus hallucatus'],
  ['3-redfox', 'Vulpes vulpes'],
  ['4-nightmonkey', 'Aotus zonalis'],
  ['5-cat', 'Felis catus'],
  ['6-fossil', 'Panthera balamoides'],
];

const open = async (page, sci) => {
  const ok = await page.evaluate((sci) => {
    const f = window.__fan;
    const b = f.fan.branches.find((b) => b.sp.sci === sci);
    if (!b) return false;
    f.flyToSpecies(b.sp);
    return true;
  }, sci);
  if (!ok) return false;
  await page.waitForSelector('.card-sp', { timeout: 30000 });
  await page.waitForSelector('.card-sp .globe canvas, .card-sp .range img', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  return true;
};
const closeCard = (page) => page.evaluate(() => document.querySelector('.card-sp .x')?.click());
const body = (page) => page.evaluate(() => document.querySelector('.card-sp .body')?.scrollTop ?? -1);

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto('about:blank');
  await page.goto(served.url);
  await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  for (const [name, sci] of SPECIES) {
    if (!(await open(page, sci))) {
      console.log(`${name} (${sci}): not on the fan`);
      continue;
    }
    // The face: the facts block scrolled to the top of the sheet's content.
    await page.evaluate(() => document.querySelector('.card-sp .facts')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${TAG}-${name}-a-face.png`) });
    await page.evaluate(() => {
      const d = document.querySelector('.card-sp details.more');
      d?.setAttribute('open', '');
      d?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${TAG}-${name}-b-details.png`) });
    const text = await page.evaluate(() => document.querySelector('.card-sp .body')?.innerText.replace(/\s*\n\s*/g, ' | ') ?? '');
    const links = await page.evaluate(() => [...document.querySelectorAll('.card-sp a[data-method]')].map((a) => `${a.textContent.trim()} -> ${a.dataset.method}`));
    console.log(`${name} (${sci}):\n  text: ${text.slice(0, 1400)}\n  links: ${links.join(' ; ') || 'none'}`);
    if (links.length) {
      // A link tapped (the first on the face): the page at its section; back: the card as it was.
      const before = await body(page);
      const at = await page.evaluate(() => {
        const a = document.querySelector('.card-sp .facts a[data-method]');
        a.click();
        return a.dataset.method;
      });
      await page.waitForSelector('.methods', { timeout: 10000 });
      await page.waitForTimeout(800);
      const where = await page.evaluate((at) => {
        const m = document.querySelector('.methods');
        const t = document.getElementById(at);
        return { top: Math.round(t.getBoundingClientRect().top - m.getBoundingClientRect().top), scrolled: Math.round(m.scrollTop) };
      }, at);
      await page.screenshot({ path: join(OUT, `${TAG}-${name}-c-page-${at}.png`) });
      await page.goBack({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
      const after = await page.evaluate(() => ({ page: !!document.querySelector('.methods'), card: !!document.querySelector('.card-sp'), url: location.href }));
      console.log(`  tapped -> ${at}: its top ${where.top}px down the page (scrolled ${where.scrolled}); back: page ${after.page ? 'still open' : 'closed'}, card ${after.card ? 'open' : 'closed'}, scroll ${before} -> ${await body(page)}, address ${after.url === served.url ? 'kept' : after.url}`);
    }
    await closeCard(page);
    await page.waitForTimeout(800);
  }
} finally {
  await browser.close();
  served.close();
}
