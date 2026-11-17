// The built page on its two data files (ToLaD#502) at 390x844, default headless (no GPU flags): home drawn on
// mammals.json; a species' card while mammals-card.json is still coming (NET throttled only) and once it is in, with
// its picture; its genealogy (the lineage card); search finding a species and its card. Times from navigation printed.
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/splitshot.mjs <out-dir>
// Env: NET=1.5 (Mbit/s, files gzipped as Pages serves them), HOLD=ms, SPECIES=Panthera leo, FIND=snow leopard.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/split';
const NET = Number(process.env.NET || 0);
const SCI = process.env.SPECIES || 'Panthera leo';
const FIND = process.env.FIND || 'snow leopard';
mkdirSync(OUT, { recursive: true });
if (NET) process.env.GZIP = '1';
const served = await pageUrl('');
const browser = await chromium.launch({ headless: true });
const log = (s) => console.log(s);
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`pageerror ${e}`));
  page.on('console', (m) => m.type() === 'warning' && log(`console ${m.text()}`));
  const got = [];
  page.on('requestfinished', (r) => /\.json$/.test(r.url()) && got.push(r.url().split('/').pop()));
  if (NET) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (NET * 1e6) / 8, uploadThroughput: (NET * 1e6) / 8 });
  }
  // HOLD=ms: mammals-card.json held back that long (a card opened in the meantime waits for it).
  if (process.env.HOLD) await page.route('**/mammals-card.json', async (r) => (await new Promise((ok) => setTimeout(ok, Number(process.env.HOLD))), r.continue()));
  const mark = (n) => page.evaluate((n) => Math.round(performance.getEntriesByName('tl:' + n)[0]?.startTime ?? -1), n);
  await page.goto(served.url);
  await page.waitForFunction(() => window.__fan && window.__fan.frameMs.length > 1, null, { timeout: 180000 });
  log(`first frame ${await mark('first')} ms (mammals.json in ${await mark('fetch')} ms)`);
  const open = (lineage, ageMa) =>
    page.evaluate(
      ({ sci, lineage, ageMa }) => {
        const f = window.__fan;
        const b = f.fan.branches.find((x) => x.sp.sci === sci);
        f.openCard({ strand: b.index, k: -1, lineage, ageMa });
        return b.sp.common;
      },
      { sci: SCI, lineage, ageMa },
    );
  if ((await mark('card')) < 0) {
    // A card opened before mammals-card.json is in: its name, picture and globe, the facts' spinner.
    log(`card opened at ${await page.evaluate(() => Math.round(performance.now()))} ms, the cards' file not in: ${await open(false, 0)}`);
    await page.screenshot({ path: `${OUT}/card-wait.png` });
    log(`wait spinner: ${await page.locator('.facts-wait').count()}`);
  }
  await page.waitForFunction(() => performance.getEntriesByName('tl:card').length > 0, null, { timeout: 180000 });
  await page.evaluate(() => window.__fan.tap(-1e6, -1e6));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/home.png` });
  log(`mammals-card.json in at ${await mark('card')} ms`);
  log(`card: ${await open(false, 0)}`);
  await page.waitForFunction(() => [...document.querySelectorAll('.card-sp .pic img')].every((i) => i.complete), null, { timeout: 20000 }).catch(() => log('picture not loaded'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/card.png` });
  log(`facts: ${(await page.locator('.card-sp .facts').count()) ? 'shown' : 'MISSING'}; wait spinner: ${await page.locator('.facts-wait').count()}`);
  // Its genealogy: the lineage card at 50,000 years ago.
  await open(true, 0.05);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/genealogy.png` });
  // Search.
  await page.evaluate(() => window.__fan.tap(-1e6, -1e6));
  await page.waitForTimeout(300);
  await page.click('button[aria-label="Find a species"]');
  await page.fill('input[aria-label="Find a species"]', FIND);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/search.png` });
  const hits = await page.locator('.search [role="option"]').count();
  log(`search "${FIND}": ${hits} hits`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/search-pick.png` });
  log(`fetched: ${got.join(', ')}`);
} finally {
  await browser.close();
  served.close();
}
