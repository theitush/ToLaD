// The first card's range globe on the phone proxy (ToLaD#601): phoneperf.mjs's phone (headless Chromium, 390x844, DPR 3,
// touch, the CPU throttled 4x), the page built and served gzipped as Pages serves it. Per scene, a fresh browser context
// (nothing cached): the page opened and its cards' file in, then the network throttled (NET Mbit/s, 40 ms latency) and one
// species' card opened. Timed: from the card's open to its globe drawn (or the Wikimedia map's box, where nothing maps
// it), with the globe files fetched on the way and their bytes over the wire.
//
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/globeperf.mjs
//
// Env: NET=1.5 (Mbit/s; 0: unthrottled), THROTTLE=4, ONLY=scene,scene.
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const NET = Number(process.env.NET ?? 1.5);
const THROTTLE = Number(process.env.THROTTLE || 4);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
// [name, query, species]: a mammal on each page, then the amniotes' reptiles (GARD's, globe-reptiles.json) and a bird.
const SCENES = [
  ['mammals-lion', 'level=mammals', 'Panthera leo'],
  ['amn-lion', 'tree=amniotes', 'Panthera leo'],
  ['amn-nile-croc', 'tree=amniotes', 'Crocodylus niloticus'],
  ['amn-aldabra', 'tree=amniotes', 'Aldabrachelys gigantea'],
  ['amn-sparrow', 'tree=amniotes', 'Passer domesticus'],
];

process.env.GZIP = '1';
const served = await pageUrl('', process.env.DIR || 'dist-single');
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, q, sci] of SCENES) {
    if (ONLY && !ONLY.has(name)) continue;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', String(e)));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    const bytes = new Map();
    cdp.on('Network.responseReceived', (e) => bytes.set(e.requestId, { url: new URL(e.response.url).pathname, n: 0 }));
    cdp.on('Network.loadingFinished', (e) => {
      const b = bytes.get(e.requestId);
      if (b) b.n = e.encodedDataLength;
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await page.goto(served.url.replace(/\/\?$|\/$/, '/') + `?${q}`);
    await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 300000 });
    await page.waitForFunction(() => performance.getEntriesByName('tl:card').length > 0, null, { timeout: 300000 }).catch(() => {});
    if (NET) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (NET * 1e6) / 8, uploadThroughput: (NET * 1e6) / 8 });
    const t0 = await page.evaluate((sci) => {
      const f = window.__fan;
      const b = f.fan.branches.find((b) => b.sp.sci === sci);
      if (!b) return null;
      const t = performance.now();
      f.onSelect({ sp: b.sp, ageMa: b.sp.t1 });
      return t;
    }, sci);
    if (t0 === null) {
      console.log(`${name.padEnd(14)} ${sci} not in the fan`);
      await ctx.close();
      continue;
    }
    const what = await page
      .waitForFunction(() => (document.querySelector('.card-sp .globe:not(.loading) canvas') ? 'globe' : document.querySelector('.card-sp .range') ? 'map' : document.querySelector('.card-sp .globe.none') ? 'none' : ''), null, { timeout: 300000, polling: 20 })
      .then((h) => h.jsonValue());
    const ms = (await page.evaluate(() => performance.now())) - t0;
    const credit = await page.evaluate(() => document.querySelector('.card-sp .globe a, .card-sp .range a')?.textContent ?? '');
    const files = [...bytes.values()].filter((b) => /globe/.test(b.url)).map((b) => `${b.url.slice(1)} ${(b.n / 1024).toFixed(0)} kB`);
    console.log(`${name.padEnd(14)} ${sci}: ${what} in ${Math.round(ms)} ms (${credit}) · ${files.join(', ') || 'no globe files'}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  served.close();
}
