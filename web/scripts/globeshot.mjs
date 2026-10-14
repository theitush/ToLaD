// The card's range globe (ToLaD#267) at 390×844, default headless (no GPU flags), from the page as pages.yml stages
// it (index.html + mammals.json + globe.json + globe-draw.js, served over http on a free port): one card per species
// (by scientific name, the mammal level so every mammal is there), then the lion's globe dragged and enlarged.
//   npm run build:single && node scripts/globeshot.mjs <out-dir> [Genus species,...]
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/globe';
const SPECIES = process.argv[3]
  ? process.argv[3].split(',')
  : ['Panthera leo', 'Panthera uncia', 'Vulpes vulpes', 'Cryptoprocta ferox', 'Panthera spelaea', 'Bos primigenius', 'Balaenoptera musculus'];
mkdirSync(OUT, { recursive: true });
const site = mkdtempSync(join(tmpdir(), 'globe-site-'));
for (const f of ['index.html', 'mammals.json', 'globe.json', 'globe-draw.js']) copyFileSync(join('dist-single', f), join(site, f));
process.env.HTTP = '1';
const served = await pageUrl('level=mammals', site);
const browser = await chromium.launch({ headless: true });
let bad = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 400)));
  const fetched = [];
  page.on('request', (r) => fetched.push(new URL(r.url()).pathname));
  await page.goto(served.url);
  await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  console.log('before any card:', fetched.filter((p) => /globe/.test(p)).join(' ') || 'no globe files fetched');
  for (const sci of SPECIES) {
    const ok = await page.evaluate((sci) => {
      const f = window.__fan;
      const b = f.fan.branches.find((b) => b.sp.sci === sci);
      if (!b) return false;
      f.onSelect({ sp: b.sp, ageMa: b.sp.t1 });
      return true;
    }, sci);
    if (!ok) {
      console.log(sci, 'not in the fan');
      bad++;
      continue;
    }
    await page.waitForSelector('.card-sp .globe canvas, .card-sp .range', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(400);
    const what = await page.evaluate(() => (document.querySelector('.card-sp .globe canvas') ? 'globe' : document.querySelector('.card-sp .range') ? 'wikimedia map' : 'none'));
    const name = sci.toLowerCase().replace(/ /g, '-');
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(sci, what);
  }
  console.log('after:', [...new Set(fetched.filter((p) => /globe/.test(p)))].join(' '));
  // The lion's globe dragged a quarter turn west, then tapped to enlarge.
  await page.evaluate(() => {
    const f = window.__fan;
    const b = f.fan.branches.find((b) => b.sp.sci === 'Panthera leo');
    f.onSelect({ sp: b.sp, ageMa: b.sp.t1 });
  });
  await page.waitForSelector('.card-sp .globe canvas');
  await page.waitForTimeout(300);
  const box = await (await page.$('.card-sp .globe canvas')).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(cx + k * 6, cy - k * 2);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/lion-dragged.png` });
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/lion-big.png` });
} finally {
  await browser.close();
  served.close();
}
process.exit(bad ? 1 : 0);
