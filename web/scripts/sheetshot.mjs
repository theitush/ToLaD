// The species card as a bottom sheet (ToLaD#509), default headless (no GPU flags), from the page as pages.yml stages it
// (served over http, the mammal level): for the human, the lion, the domestic cat and the species with the longest history
// that lists regional events, each flown to as the search does (its branch centred above the card, ToLaD#496), at
// 390×844: the card first opened, its Details open, scrolled to the bottom, and mid-swipe down; its height, its share of
// the screen, whether the × stays on screen, and every way out (×, back, a swipe down). Then the lion in landscape
// (844×390) and at a desktop width (1280×800).
//   npm run build:single && node scripts/sheetshot.mjs <out-dir> [tag]
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/sheet';
const TAG = process.argv[3] || 'after';
mkdirSync(OUT, { recursive: true });
const site = mkdtempSync(join(tmpdir(), 'sheet-site-'));
for (const f of ['index.html', 'mammals.json', 'mammals-card.json', 'globe.json', 'globe-draw.js']) copyFileSync(join('dist-single', f), join(site, f));
const served = await pageUrl('level=mammals', site);
const browser = await chromium.launch({ headless: true });
const SPECIES = [
  ['human', 'Homo sapiens'],
  ['lion', 'Panthera leo'],
  ['cat', 'Felis catus'],
];

/** The card's box, its scroller's, the ×'s, and the room the tree keeps above it (px from the bar's foot). */
const measure = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.card-sp');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const x = c.querySelector('.x')?.getBoundingClientRect();
    const bar = document.querySelector('.bar')?.getBoundingClientRect();
    const sc = [c, ...c.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY !== 'visible');
    const h = innerHeight;
    return {
      top: Math.round(r.top),
      h: Math.round(r.height),
      share: +((h - r.top) / h).toFixed(2),
      xOn: !!x && x.top >= 0 && x.bottom <= h,
      scrolls: !!sc,
      room: Math.round(r.top - (bar?.bottom ?? 0)),
    };
  });

const open = async (page, sci) => {
  await page.evaluate((sci) => {
    const f = window.__fan;
    const b = f.fan.branches.find((b) => b.sp.sci === sci);
    f.flyToSpecies(b.sp);
  }, sci);
  await page.waitForSelector('.card-sp', { timeout: 30000 });
  await page
    .waitForSelector('.card-sp .globe canvas, .card-sp .range img', {
      timeout: 30000,
    })
    .catch(() => {});
  await page.waitForTimeout(2500);
};
const closeCard = (page) => page.evaluate(() => document.querySelector('.card-sp .x')?.click());
const toBottom = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.card-sp');
    for (const e of [c, ...c.querySelectorAll('*')]) if (e.scrollHeight > e.clientHeight + 2) e.scrollTop = e.scrollHeight;
  });

try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto('about:blank');
  await page.goto(served.url);
  await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const long = await page.evaluate(() => {
    const skip = new Set(['Homo sapiens', 'Panthera leo', 'Felis catus']);
    const bs = window.__fan.fan.branches.filter((b) => !skip.has(b.sp.sci) && b.sp.history?.events?.some((e) => e.scope === 'regional'));
    bs.sort((a, b) => b.sp.history.events.length + b.sp.history.points.length / 50 - (a.sp.history.events.length + a.sp.history.points.length / 50));
    return [bs[0].sp.common.replace(/\W+/g, '-').toLowerCase(), bs[0].sp.sci];
  });
  for (const [name, sci] of [...SPECIES, long]) {
    await open(page, sci);
    const m0 = await measure(page);
    await page.screenshot({ path: join(OUT, `${TAG}-${name}-1open.png`) });
    await page.evaluate(() => document.querySelector('.card-sp details')?.setAttribute('open', ''));
    await page.waitForTimeout(400);
    const m1 = await measure(page);
    await page.screenshot({ path: join(OUT, `${TAG}-${name}-2details.png`) });
    await toBottom(page);
    await page.waitForTimeout(300);
    const m2 = await measure(page);
    await page.screenshot({ path: join(OUT, `${TAG}-${name}-3bottom.png`) });
    console.log(`${name} (${sci}): open ${JSON.stringify(m0)}\n  details ${JSON.stringify(m1)}\n  bottom ${JSON.stringify(m2)}`);
    await closeCard(page);
    await page.waitForTimeout(800);
  }

  // The ways out, on the lion's card: back, then a swipe down (mid-swipe shot), then the ×.
  const len0 = await page.evaluate(() => history.length);
  await open(page, 'Panthera leo');
  const len1 = await page.evaluate(() => history.length);
  await page.goBack({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  const afterBack = await page.evaluate(() => ({
    url: location.href,
    card: !!document.querySelector('.card-sp'),
  }));
  console.log(`back: history ${len0} -> ${len1} on open; after back: on page ${afterBack.url.startsWith('http')}, card open ${afterBack.card}`);
  if (!afterBack.url.startsWith('http')) {
    await page.goBack().catch(() => {});
    await page.goto(served.url);
    await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 180000 });
  }
  for (const [name, sci] of [...SPECIES, long]) {
    await open(page, sci);
    const r = await page.evaluate(() => document.querySelector('.card-sp').getBoundingClientRect().toJSON());
    const x0 = r.left + r.width / 2;
    const y0 = r.top + 8;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(x0, y0 + k * 25);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(OUT, `${TAG}-${name}-4swipe.png`) });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const gone = await page.evaluate(() => !document.querySelector('.card-sp'));
    console.log(`swipe down 150px on ${name}: closed ${gone}`);
    if (!gone) await closeCard(page);
    await page.waitForTimeout(500);
  }
  await open(page, 'Panthera leo');
  await closeCard(page);
  await page.waitForTimeout(800);
  const xb = await page.evaluate(() => ({
    card: !!document.querySelector('.card-sp'),
    len: history.length,
    url: location.href,
  }));
  console.log(`x: card closed ${!xb.card}, history ${xb.len}`);

  for (const [w, h] of [
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1200);
    await open(page, 'Panthera leo');
    console.log(`lion at ${w}x${h}: ${JSON.stringify(await measure(page))}`);
    await page.screenshot({ path: join(OUT, `${TAG}-lion-${w}x${h}.png`) });
    await closeCard(page);
    await page.waitForTimeout(600);
  }
} finally {
  await browser.close();
  served.close();
}
