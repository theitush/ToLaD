// "How we count" (ToLaD#508) at 390×844 (default headless, no GPU flags): the Sources panel with its link, the page's
// top, the two maps, the grades and the card's words; and checks: every step's id there, back closes the page.
//   npm run build:single && node scripts/methodsshot.mjs <out-dir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/methods';
mkdirSync(OUT, { recursive: true });
const { url, close } = await pageUrl('');
const browser = await chromium.launch({ headless: true });
const fail = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.click('.sources-link');
  await page.waitForSelector('.card-sp.sources .methods-link');
  await page.screenshot({ path: `${OUT}/1-sources.png` });
  await page.click('.methods-link');
  await page.waitForSelector('.methods');
  await page.waitForSelector('.methods .m-maps canvas', { timeout: 30000 }).catch(() => fail.push('the two maps did not draw'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/2-top.png` });
  const ids = await page.$$eval('.methods [id]', (els) => els.map((e) => e.id));
  for (const id of ['m-alive', 'm-1500', 'm-histories', 'm-ever', 'm-descendants', 'm-grades', 'm-fossils', 'm-unknown', 'm-words']) if (!ids.includes(id)) fail.push(`no #${id}`);
  for (const [id, name] of [['m-1500', '3-maps'], ['m-ever', '4-ever'], ['m-grades', '5-grades'], ['m-words', '6-words']]) {
    await page.$eval(`#${id}`, (e) => e.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  await page.goBack();
  await page.waitForTimeout(500);
  if (await page.$('.methods')) fail.push('back left the page open');
  if (!(await page.$('.app canvas'))) fail.push('back left the tree');
  console.log(`methodsshot: ${fail.length ? `FAIL ${fail.join('; ')}` : 'ok'} (${OUT})`);
} finally {
  await browser.close();
  close();
}
if (fail.length) process.exit(1);
