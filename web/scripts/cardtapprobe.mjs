// The species' card under real touches (ToLaD#301), 390×844 (default headless, no GPU flags): a single tap on each of
// its controls does what it did (the card stays open, the view stays), a double tap on a control is the control's
// twice (never a level up), and a double tap on the card's text (Details open too) closes it, one level up.
//   npm run build:single && node scripts/cardtapprobe.mjs [species] [search query]
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const SP = process.argv[2] || 'Polar bear';
const Q = process.argv[3] || 'polar';
const browser = await chromium.launch({ headless: true });
const served = await pageUrl(process.env.LEVEL ? `level=${process.env.LEVEL}` : '');
const rows = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(served.url);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => {
    const f = window.__fan;
    window.__dbl = 0;
    const dt = f.doubleTap.bind(f);
    f.doubleTap = (x, y, r) => (window.__dbl++, dt(x, y, r));
    window.__state = () => {
      const card = document.querySelector('.card-sp');
      return {
        card: !!card,
        sel: f.selected?.common ?? null,
        dbl: window.__dbl,
        cam: [f.cam.cx, f.cam.cy, f.cam.sx, f.cam.sy].map((v) => +v.toPrecision(5)).join(','),
        details: !!card?.querySelector('details.more[open]'),
        big: card ? [...card.querySelectorAll('figure.big, .globe.big, canvas.big')].length : 0,
        spark: card?.querySelector('button.spark')?.getAttribute('aria-expanded') ?? '-',
      };
    };
  });
  const open = async () => {
    if (await page.$('.card-sp')) return;
    await page.click('button[aria-label="Find a species"]');
    await page.keyboard.type(Q, { delay: 30 });
    await page.click(`.search-list li:has(.nm:text-is("${SP}"))`);
    await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
    await page.waitForTimeout(1500);
  };
  const centre = (sel) =>
    page.evaluate((sel) => {
      const el = document.querySelector(`.card-sp ${sel}`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + Math.min(r.width / 2, 40), y: (r.top + r.bottom) / 2 } : null;
    }, sel);
  const dbl = async (p) => {
    const at = [{ x: p.x, y: p.y, id: 7 }];
    await Promise.all([
      cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at }),
      cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
      cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at }),
      cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    ]);
  };
  // [what, selector, single|double, expect]
  const CASES = [
    ['name link (Wikipedia)', '.t a.wp', 'single'],
    ['photo', 'figure.pic img', 'single'],
    ['photo', 'figure.pic img', 'double'],
    ['globe', 'canvas', 'single'],
    ['globe', 'canvas', 'double'],
    ['sparkline', 'button.spark', 'single'],
    ['Details ▾', 'details.more > summary', 'single'],
    ['Details ▾', 'details.more > summary', 'double'],
    ['card text', '.facts .ever', 'single'],
    ['card text', '.facts .ever', 'double'],
    ['Details text', 'details.more dd', 'double'],
    ['close ×', 'button.x', 'single'],
  ];
  for (const [what, sel, how] of CASES) {
    await open();
    if (what === 'Details text') {
      const s = await centre('details.more > summary');
      if (s) await page.touchscreen.tap(s.x, s.y);
      await page.waitForTimeout(400);
    }
    const p = await centre(sel);
    if (!p) {
      rows.push([what, how, '-', '-', `no ${sel}`, 'skip']);
      continue;
    }
    const before = await page.evaluate(() => window.__state());
    const pages = ctx.pages().length;
    if (how === 'single') await page.touchscreen.tap(p.x, p.y);
    else await dbl(p);
    await page.waitForTimeout(900);
    await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
    const after = await page.evaluate(() => window.__state());
    const tabs = ctx.pages().length - pages;
    for (const extra of ctx.pages().slice(1)) await extra.close();
    const up = after.dbl > before.dbl;
    const moved = after.cam !== before.cam;
    const fx = [
      after.card ? 'card open' : 'card closed',
      up ? 'LEVEL UP' : 'no level up',
      moved ? 'view moved' : 'view still',
      after.details !== before.details ? `details ${after.details ? 'opened' : 'closed'}` : '',
      after.big !== before.big ? 'enlarged/shrunk' : '',
      after.spark !== before.spark ? `sources ${after.spark === 'true' ? 'shown' : 'hidden'}` : '',
      tabs ? `${tabs} new tab` : '',
    ].filter(Boolean);
    const want = what === 'close ×' ? !after.card && !up : how === 'double' && what.endsWith('text') ? !after.card && up && moved : after.card && !up && !moved;
    rows.push([what, how, `@${p.x | 0},${p.y | 0}`, fx.join(', '), '', want ? 'ok' : 'WRONG']);
    // (Each case from the card as it opened.)
    if (after.card) await page.evaluate(() => window.__fan.tap(-1e6, -1e6));
    await page.evaluate(() => {
      const f = window.__fan;
      f.anim = null;
      f.backing = null;
      f.tapAt = null;
      f.cam = f.homeCamera();
      f.camera.settle();
      f.request();
    });
    await page.waitForTimeout(300);
  }
} finally {
  await browser.close();
  served.close();
}
console.log(`${SP}'s card:`);
console.log(['control', 'tap', 'at', 'what it did', 'note', ''].join(' | '));
for (const r of rows) console.log(r.join(' | '));
