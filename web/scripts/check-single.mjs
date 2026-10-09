// Open dist-single/index.html from file:// with all network blocked and check
// that the mammal data renders.   npm run build:single && node scripts/check-single.mjs
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'perf-out';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let code = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const blocked = [];
  const errors = [];
  await page.route(/^(https?|wss?):/, (r) => {
    blocked.push(r.request().url());
    return r.abort();
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href);
  await page.waitForFunction(() => !!window.__tolad, null, { timeout: 30000 });
  await sleep(3000);
  const r = await page.evaluate(() => ({ labels: window.__tolad.labels?.count ?? 0, tiles: window.__toladApp.source.files.size - 1, inst: window.__tolad.info().instances }));
  await page.screenshot({ path: `${OUT}/single-file.png`, timeout: 120000 });
  console.log(`file:// single-file: ${r.tiles} tiles loaded, ${r.labels} labels, ${r.inst} instances, ${blocked.length} network requests, ${errors.length} errors`);
  if (blocked.length || errors.length || r.labels === 0) {
    console.log(blocked, errors);
    code = 1;
  }
} finally {
  await browser.close();
}
process.exit(code);
