// The search typed on the phone proxy (ToLaD#564): phoneperf.mjs's phone (headless Chromium, 390x844, DPR 3, touch, the CPU
// throttled 4x) on the amniotes (`?tree=amniotes`, every fossil, ~50,000 species), the magnifier tapped and "t rex" typed a key
// at a time, twice (the field cleared between). Per key: its work (ms from the keydown through React's commit and the list's
// style and layout), ms to the frame after the list is drawn (the fan's own frames in it too), the hits and the rows in the page. Also the long tasks between the first frame and the magnifier's tap (the search's names
// folded at idle, ToLaD#564) and the tap's own time to the field's frame.
//
//   npm run build:single && flock /tmp/tolad-browser.lock node scripts/searchperf.mjs
//
// Env: DIR=dist-single (the build served), THROTTLE=4, IDLE=15000 (ms waited after the first frame), WORD="t rex", TREE=amniotes.
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const THROTTLE = Number(process.env.THROTTLE || 4);
const IDLE = Number(process.env.IDLE || 15000);
const WORD = process.env.WORD || 't rex';
const TREE = process.env.TREE || 'amniotes';

process.env.HTTP = '1';
const served = await pageUrl('', process.env.DIR || 'dist-single');
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.addInitScript(() => {
    const w = window;
    w.__sp = { long: [] };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__sp.long.push([Math.round(e.startTime), Math.round(e.duration)]);
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* no long tasks */
    }
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.goto(served.url.replace(/\/\?$|\/$/, '/') + `?level=mammals${TREE === 'mammals' ? '' : `&tree=${TREE}`}`);
  await page.waitForFunction(() => window.__fan && window.__fan.frameMs.length > 0, null, { timeout: 180000 });
  const first = await page.evaluate(() => performance.now());
  await sleep(IDLE);
  const idleLong = await page.evaluate((t) => window.__sp.long.filter(([s]) => s >= t), first);
  console.log(`first frame ${Math.round(first)} ms; long tasks in the ${IDLE} ms after it: ${idleLong.map(([s, d]) => `${d} ms at ${s}`).join(', ') || 'none'}`);

  // (Until the frame after the next one: the list's DOM drawn, styled and painted.)
  const afterFrame = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(performance.now()))));
  const open = await page.evaluate(async (af) => {
    const t0 = performance.now();
    document.querySelector('button[aria-label="Find a species"]').click();
    const t1 = await new Function(`return (${af})()`)();
    return Math.round(t1 - t0);
  }, afterFrame.toString());
  await page.waitForSelector('.search-field input', { timeout: 300000 });
  console.log(`magnifier tapped: ${open} ms to the field's frame`);

  for (const round of [1, 2]) {
    const keys = [];
    for (const ch of WORD) {
      await page.evaluate((af) => {
        const inp = document.querySelector('.search-field input');
        window.__sp.key = null;
        window.__sp.work = null;
        inp.addEventListener(
          'keydown',
          () => {
            const t0 = performance.now();
            // The key's own work: React's render and commit (its microtask, queued before this one), the list's style and layout.
            window.addEventListener(
              'input',
              () =>
                queueMicrotask(() => {
                  void document.querySelector('.search-list')?.offsetHeight;
                  window.__sp.work = performance.now() - t0;
                }),
              { once: true },
            );
            new Function(`return (${af})()`)().then((t1) => (window.__sp.key = t1 - t0));
          },
          { once: true, capture: true },
        );
      }, afterFrame.toString());
      await page.keyboard.press(ch === ' ' ? 'Space' : ch);
      await page.waitForFunction(() => window.__sp.key != null, null, { timeout: 300000 });
      const r = await page.evaluate(() => {
        const opts = document.querySelectorAll('.search-list li[role="option"]');
        const set = opts[0]?.getAttribute('aria-setsize');
        return { ms: window.__sp.key, work: window.__sp.work, rows: opts.length, hits: set ? Number(set) : opts.length, q: document.querySelector('.search-field input').value };
      });
      keys.push(r);
    }
    console.log(`round ${round}: ` + keys.map((k) => `"${k.q}" ${Math.round(k.work)} ms work, ${Math.round(k.ms)} ms to the frame (${k.hits} hits, ${k.rows} rows)`).join(' · '));
    await page.evaluate(() => {
      const inp = document.querySelector('.search-field input');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, '');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(500);
  }
  await ctx.close();
} finally {
  await browser.close();
  served.close();
}
