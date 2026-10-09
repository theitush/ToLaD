// Quick look: serve dist/ and screenshot the opening view plus named clades.
//   npm run build && node scripts/shot.mjs [out-dir]
//   NAMES="Primates,Mammuthus" DPR=2 Q="?river&debug" LOG=1 node scripts/shot.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4181;
const OUT = process.argv[2] || 'perf-out/shots';
const NAMES = process.env.NAMES ?? 'Primates,Homo sapiens,Mammuthus';
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve()));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DPR || 2), isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`http://localhost:${PORT}/${process.env.Q || '?river'}`);
  await page.waitForFunction(() => !!window.__tolad, null, { timeout: 20000 });
  await sleep(2500);
  // Headless SwiftShader can stall frame production for several seconds once after
  // a flight that loads many tiles (frames themselves take ~10 ms with gl.finish);
  // wait for a frame before each screenshot.
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await settle();
  await page.screenshot({ path: `${OUT}/opening.png`, timeout: 120000 });
  for (const name of NAMES.split(',').filter(Boolean)) {
    const ok = await page.evaluate((n) => window.__toladApp.flyToName(n), name);
    await sleep(2500);
    await settle();
    console.log(name, ok ? 'ok' : 'NOT FOUND', await page.evaluate(() => window.__tolad.info().anchorId));
    await page.screenshot({ path: `${OUT}/${name.replace(/ /g, '_')}.png`, timeout: 120000 });
  }
  if (process.env.LOG) {
    await page.evaluate(() => window.__tolad.setMode(1));
    await sleep(1500);
    await settle();
    await page.screenshot({ path: `${OUT}/log.png`, timeout: 120000 });
  }
} finally {
  await browser.close();
  server.kill();
}
