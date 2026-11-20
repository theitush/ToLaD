// Scratch (speed502, not for commit): the main thread's long tasks after the first frame, on the phone proxy, and a CPU
// profile of that stretch alone. DIR=<dist> Q=tree=amniotes AFTER=10000 OUT=<prefix> node scripts/zzafter.mjs
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.env.OUT || 'after';
const AFTER = Number(process.env.AFTER || 10000);
process.env.HTTP = '1';
const served = await pageUrl('', process.env.DIR || 'dist-single');
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.addInitScript(() => {
    const w = window;
    w.__lt = [];
    w.__first = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__lt.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: true });
    const tick = () => {
      if (!w.__first && w.__fan && w.__fan.frameMs.length) w.__first = performance.now();
      if (!w.__first) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE || 4) });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  const url = served.url.replace(/\/\?$|\/$/, '/') + (process.env.Q ? `?${process.env.Q}` : '');
  await page.goto(url);
  await page.waitForFunction(() => window.__first > 0, null, { timeout: 300000 });
  if (process.env.TRACE) await browser.startTracing(page, { path: `${OUT}.trace.json`, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'v8.execute', 'toplevel'] });
  else await cdp.send('Profiler.start');
  const first = await page.evaluate(() => window.__first);
  await sleep(AFTER);
  if (process.env.TRACE) await browser.stopTracing();
  else writeFileSync(`${OUT}.cpuprofile`, JSON.stringify((await cdp.send('Profiler.stop')).profile));
  const frames = await page.evaluate(() => window.__fan.frameMs.length);
  console.log(`draws so far ${frames}`);
  const r = await page.evaluate(() => ({
    lt: window.__lt,
    marks: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('tl:')).map((m) => [m.name.slice(3), Math.round(m.startTime)]),
  }));
  console.log(`first frame ${Math.round(first)} ms; marks ${r.marks.map(([n, t]) => `${n} ${t}`).join(', ')}`);
  console.log(`long tasks after it (start ms from navigation, ms): ${r.lt.filter(([s]) => s >= first - 1).map(([s, d]) => `${s}:${d}`).join(' ')}`);
  console.log(`before it: ${r.lt.filter(([s]) => s < first - 1).map(([s, d]) => `${s}:${d}`).join(' ')}`);
  writeFileSync(`${OUT}.json`, JSON.stringify({ first, ...r }));
} finally {
  await browser.close();
  served.close();
}
