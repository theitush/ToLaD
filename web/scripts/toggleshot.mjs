// The edges' toggle (#78): click the chip, check the fan switches design in
// place (same camera, no reload), is remembered across a reload, and shoot
// the bar with the chip in both states (390×844, default headless).
//   npm run build:single && node scripts/toggleshot.mjs <out-dir>
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'perf-out/toggle';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
let bad = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) bad++;
};
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href);
  await page.waitForFunction(() => !!window.__fan);
  const chip = page.getByRole('button', { name: 'branch shape' });
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => ({ edge: window.__fan.fan.edge, cam: JSON.stringify(window.__fan.cam) }));
  await page.screenshot({ path: `${OUT}/chip-${a.edge}.png`, clip: { x: 0, y: 0, width: 390, height: 60 } });
  await page.evaluate(() => (window.__mark = 1));
  await chip.click();
  await page.waitForTimeout(500);
  const b = await page.evaluate(() => ({ edge: window.__fan.fan.edge, cam: JSON.stringify(window.__fan.cam), same: window.__mark === 1 }));
  await page.screenshot({ path: `${OUT}/chip-${b.edge}.png`, clip: { x: 0, y: 0, width: 390, height: 60 } });
  check(a.edge !== b.edge, `the chip switches ${a.edge} → ${b.edge}`);
  check(b.same, 'no reload');
  check(a.cam === b.cam, 'the camera stays put');
  check((await chip.textContent()) === b.edge, 'the chip names the design shown');
  await page.reload();
  await page.waitForFunction(() => !!window.__fan);
  const c = await page.evaluate(() => window.__fan.fan.edge);
  check(c === b.edge, `remembered across a reload (${c})`);
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
