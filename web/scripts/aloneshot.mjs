// The card's picture, globe and range map alone, full screen (ToLaD#506), at 390×844 and in landscape, default headless
// (no GPU flags), from the page as pages.yml stages it (served over http, the mammal level): the human's and the lion's
// cards; the lion's picture alone and closed by a tap; its globe alone, dragged (still open) and closed by back; a range
// map alone for a species with a map and no globe; and checks that closing leaves the card, its scroll, the tree and
// the address as they were.
//   npm run build:single && node scripts/aloneshot.mjs <out-dir>
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/alone';
mkdirSync(OUT, { recursive: true });
const site = mkdtempSync(join(tmpdir(), 'alone-site-'));
for (const f of ['index.html', 'mammals.json', 'globe.json', 'globe-draw.js']) copyFileSync(join('dist-single', f), join(site, f));
process.env.HTTP = '1';
const served = await pageUrl('level=mammals', site);
const browser = await chromium.launch({ headless: true });
let bad = 0;
const check = (what, ok) => {
  console.log(ok ? 'ok  ' : 'BAD ', what);
  if (!ok) bad++;
};
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(served.url);
  await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const open = async (sci) => {
    const ok = await page.evaluate((sci) => {
      const f = window.__fan;
      const b = f.fan.branches.find((b) => b.sp.sci === sci);
      if (!b) return false;
      f.onSelect({ sp: b.sp, ageMa: b.sp.t1 });
      return true;
    }, sci);
    await page.waitForSelector('.card-sp .globe canvas, .card-sp .range img', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    return ok;
  };
  // What closing must leave as it was: the card (its species, its scroll), the tree's place, the address, the history.
  const state = () =>
    page.evaluate(() => {
      const c = document.querySelector('.card-sp');
      const scrolls = [...document.querySelectorAll('*')].filter((e) => e.scrollTop > 0).map((e) => `${e.className}:${e.scrollTop}`);
      return JSON.stringify({ card: c?.querySelector('.t')?.textContent, scrolls, place: window.__fan.place(), href: location.href, ours: !!history.state?.['tolad:alone'] });
    });
  const alone = () => page.evaluate(() => !!document.querySelector('.alone'));
  // (Whether the larger thumbnail is the one shown: 'big ok', still 'big loading', or none (failed, or no larger one).)
  const big = () => page.evaluate(() => document.querySelector('.alone-it img.big')?.className ?? 'none');
  const tapAt = async (sel) => {
    const el = await page.$(sel);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600); // (a smooth scroll settling)
    const b = await el.boundingBox();
    const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className}` : 'nothing'; }, [b.x + b.width / 2, b.y + b.height / 2]);
    if (process.env.DEBUG) console.log('     tap', sel, JSON.stringify(b), hit);
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(1500);
  };

  check('human card', await open('Homo sapiens'));
  await page.screenshot({ path: `${OUT}/human-card.png` });
  check('lion card', await open('Panthera leo'));
  // (The card scrolled a little, if it scrolls, so that closing can show it kept its scroll.)
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('.card-sp, .card-sp *')) if (e.scrollHeight > e.clientHeight + 20) e.scrollTop = 30;
  });
  await page.screenshot({ path: `${OUT}/lion-card.png` });
  const before = await state();

  await tapAt('.card-sp .pic img');
  check('picture alone', await alone());
  await page.screenshot({ path: `${OUT}/lion-pic-alone.png` });
  console.log('     lion-pic-alone: %s', await big());
  await page.touchscreen.tap(195, 400);
  await page.waitForTimeout(800);
  check('a tap closes it', !(await alone()));
  check('card, scroll, tree, address and history as before', (await state()) === before);
  await page.screenshot({ path: `${OUT}/lion-after-pic.png` });

  await tapAt('.card-sp .globe canvas');
  check('globe alone', await alone());
  const c = await (await page.$('.alone canvas')).boundingBox();
  const [cx, cy] = [c.x + c.width / 2, c.y + c.height / 2];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(cx - k * 12, cy - k * 3);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('a drag turns it and leaves it open', await alone());
  await page.screenshot({ path: `${OUT}/lion-globe-alone.png` });
  await page.evaluate(() => history.back());
  await page.waitForTimeout(800);
  check('back closes it', !(await alone()));
  check('back: card, scroll, tree, address and history as before', (await state()) === before);
  await page.screenshot({ path: `${OUT}/lion-after-globe-back.png` });

  // Landscape: each opened in portrait, the phone then turned (the card's top runs off a landscape screen, so it is
  // opened where it can be tapped), and closed by a tap.
  for (const [sel, name] of [
    ['.card-sp .pic img', 'landscape-pic-alone'],
    ['.card-sp .globe canvas', 'landscape-globe-alone'],
  ]) {
    await tapAt(sel);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(800);
    check(`${name}: open`, await alone());
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await page.touchscreen.tap(422, 195);
    await page.waitForTimeout(800);
    check(`${name}: a tap closes it`, !(await alone()));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
  }

  // A species with a range map and no globe (PHYLACINE has none).
  let mapped = null;
  for (const sci of ['Australopithecus afarensis', 'Arctodus pristinus', 'Canis armbrusteri', 'Cebus olivaceus', 'Cercopithecus pogonias']) {
    if ((await open(sci)) && (await page.$('.card-sp .range img'))) {
      mapped = sci;
      break;
    }
  }
  check(`range map species: ${mapped}`, !!mapped);
  if (mapped) {
    await page.screenshot({ path: `${OUT}/map-card.png` });
    await tapAt('.card-sp .range img');
    check('range map alone', await alone());
    await page.screenshot({ path: `${OUT}/map-alone.png` });
    console.log('     map-alone: %s', await big());
    // A tap on its credit (a link, here kept from opening) does not close it.
    await page.evaluate(() => document.querySelector('.alone-credit a')?.addEventListener('click', (e) => e.preventDefault()));
    await tapAt('.alone-credit a');
    check('a tap on the credit leaves it open', await alone());
    await page.touchscreen.tap(195, 400);
    await page.waitForTimeout(800);
    check('closed', !(await alone()));
  }
} finally {
  await browser.close();
  served.close();
}
process.exit(bad ? 1 : 0);
