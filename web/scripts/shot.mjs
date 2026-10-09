// Quick look: serve dist/ and screenshot a few views of the mammal data.
//   npm run build && node scripts/shot.mjs [out-dir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4181;
const OUT = process.argv[2] || 'perf-out/shots';
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve()));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DPR || 2), isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => console.log('console', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(`http://localhost:${PORT}/${process.env.Q || ''}`);
  try {
    await page.waitForFunction(() => !!window.__tolad, null, { timeout: 20000 });
  } catch (e) {
    console.log('page text:', await page.evaluate(() => document.body.innerText));
    throw e;
  }
  await sleep(2500);
  console.log(JSON.stringify(await page.evaluate(() => window.__tolad.info())));
  const rafs = () =>
    page.evaluate(async () => {
      const t = performance.now();
      for (let i = 0; i < 5; i++) {
        window.__tolad.requestFrame();
        await new Promise((r) => requestAnimationFrame(r));
      }
      return (performance.now() - t) / 5;
    });
  console.log('opening: ms per forced frame', (await rafs()).toFixed(0));
  await page.screenshot({ path: `${OUT}/opening.png`, timeout: 60000 });
  if (process.env.NAMES === '') process.exit(0);
  for (const name of (process.env.NAMES || 'Primates,Mammuthus').split(',')) {
    await page.evaluate(() => {
      window.__tolad.syncGpu = true;
      window.__tolad.startRecording();
    });
    const ok = await page.evaluate((n) => window.__toladApp.flyToName(n), name);
    await sleep(2500);
    const rec = await page.evaluate(() => window.__tolad.stopRecording());
    console.log('flight frames (frame ms incl GPU / instances):', rec.map((x) => `${x.cpu.toFixed(0)}/${x.instances}`).join(' '));
    console.log(name, ok, JSON.stringify(await page.evaluate(() => window.__tolad.info())));
    const ft = await page.evaluate(async () => {
      const t = performance.now();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t;
    });
    console.log('two rAFs took', ft.toFixed(0), 'ms');
    for (let i = 0; i < 6; i++) {
      const lat = await page.evaluate(async () => {
        const t = performance.now();
        await new Promise((r) => setTimeout(r, 0));
        const t1 = performance.now();
        await new Promise((r) => requestAnimationFrame(r));
        return [t1 - t, performance.now() - t1, document.visibilityState];
      });
      console.log('timeout / raf latency', JSON.stringify(lat));
    }
    console.log('longtasks', JSON.stringify(await page.evaluate(() => window.__long.filter((x) => x[1] > 200))));
    console.log('diag', JSON.stringify(await page.evaluate(() => ({ errors: window.__toladApp.source.errors, files: [...window.__toladApp.source.files.keys()], chunks: window.__tolad.scene.chunks.size, labels: window.__tolad.labels?.count }))));
    console.log('timing', JSON.stringify(await page.evaluate(() => {
      const e = window.__tolad;
      const t0 = performance.now();
      e.cam.normalize();
      const t1 = performance.now();
      e.scene.build(e.cam);
      const t2 = performance.now();
      e.labels?.build(e.scene, e.cam, e.textBatch, true);
      const t3 = performance.now();
      return { normalize: t1 - t0, scene: t2 - t1, labels: t3 - t2, near: e.scene.near.count, draws: e.scene.draws.length };
    })));
    for (const passes of [0, 1, 2, 3]) {
      await page.evaluate((p) => {
        window.__tolad.renderer.passes = p;
        window.__tolad.syncGpu = true;
      }, passes);
      const r = await rafs();
      const st = await page.evaluate(() => {
        const e = window.__tolad;
        const t = performance.now();
        e.requestFrame();
        return new Promise((res) => requestAnimationFrame(() => res(performance.now() - t)));
      });
      await page.evaluate(() => window.__tolad.startRecording());
      await rafs();
      const rec = await page.evaluate(() => window.__tolad.stopRecording());
      console.log('passes', passes, 'ms per forced frame', r.toFixed(0), 'one synced frame', st.toFixed(0), 'frame() ms', rec.map((x) => x.cpu.toFixed(0)).join(','));
    }
    await page.screenshot({ path: `${OUT}/${name.replace(/ /g, '_')}.png`, timeout: 60000 });
  }
} finally {
  await browser.close();
  server.kill();
}
