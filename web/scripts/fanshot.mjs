// Screenshots of the fan view from the single-file build.
//   npm run build:single && node scripts/fanshot.mjs [out-dir] [prefix]
//   (STEPS_FILE: JSON [name, js] steps; W, H: viewport; CLIP=x,y,w,h: a part of the page)
// Steps are evaluated against window.__fan (see src/fan/view.ts).
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'perf-out/fan';
const PREFIX = process.argv[3] || 'fan';
mkdirSync(OUT, { recursive: true });
const url = pathToFileURL(resolve('dist-single/index.html')).href;
const browser = await chromium.launch({ headless: true });
const W = Number(process.env.W || 390);
const H = Number(process.env.H || 844);
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 90000 });
  const settle = () => page.waitForTimeout(900);
  const shot = async (name) => {
    await settle();
    // CLIP=x,y,w,h (CSS px): only that part of the page, e.g. to look closely at an edge.
    const clip = process.env.CLIP ? Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, Number(process.env.CLIP.split(',')[i])])) : undefined;
    await page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png`, clip });
    console.log('shot', name);
  };
  await shot('1-fan');
  const steps = JSON.parse(process.env.STEPS_FILE ? readFileSync(process.env.STEPS_FILE, 'utf8') : process.env.STEPS || '[]');
  for (const [name, code] of steps) {
    await page.evaluate(code);
    await shot(name);
  }
} finally {
  await browser.close();
}
