// The species card mid-load and loaded (ToLaD#479) at 390×844, default headless (no GPU flags), from the page as
// pages.yml stages it (served over http, like globeshot). Per species: the Commons hosts (and, on the first card, the
// globe's code and globe.json) are held while the card opens, so the spinners show; a shot and the card's boxes; then
// released, a shot and the boxes again, and the shift between them. Last, the first card reopened from the cache.
// A species ending in '!' has its Commons images refused when released (a picture or map that fails, ToLaD#492).
//   npm run build:single && node scripts/spinshot.mjs <out-dir> [Genus species,...] [shot-name-prefix]
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/spin';
// (Or @file: the list in a file.)
const LIST = process.argv[3]?.startsWith('@') ? readFileSync(process.argv[3].slice(1), 'utf8').trim() : process.argv[3];
const SPECIES = LIST ? LIST.split(',') : ['Panthera leo', 'Panthera spelaea', 'Smilodon fatalis'];
const PREFIX = process.argv[4] ?? '';
const isImg = (route) => new URL(route.request().url()).hostname === 'upload.wikimedia.org';
mkdirSync(OUT, { recursive: true });
const site = mkdtempSync(join(tmpdir(), 'spin-site-'));
for (const f of ['index.html', 'mammals.json', 'globe.json', 'globe-draw.js']) copyFileSync(join('dist-single', f), join(site, f));
const served = await pageUrl('level=mammals', site);
const browser = await chromium.launch({ headless: true });

// The boxes that could move: the card, its name, the media row and its items, and the facts under them.
const boxes = () => {
  const r = (el) => {
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const out = {};
  const card = document.querySelector('.card-sp');
  if (!card) return out;
  out.card = r(card);
  const media = card.querySelector('.media');
  if (media && getComputedStyle(media).display !== 'none') {
    out.media = r(media);
    for (const el of media.children) out[`media>${el.className.split(' ')[0]}`] = { ...r(el), state: el.className };
  }
  const facts = card.querySelector('.facts');
  if (facts) out.facts = r(facts);
  out.spinners = [...card.querySelectorAll('.media .loading')].map((el) => el.className.split(' ')[0]);
  return out;
};
const shift = (a, b) =>
  Object.keys({ ...a, ...b })
    .filter((k) => k !== 'spinners')
    .map((k) => (!a[k] ? `${k} appeared` : !b[k] ? `${k} went (${a[k].w}×${a[k].h})` : `${k} dx ${b[k].x - a[k].x} dy ${b[k].y - a[k].y} dw ${b[k].w - a[k].w} dh ${b[k].h - a[k].h}`))
    .join('; ');

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  let hold = false;
  let globeHeld = true;
  const held = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const img = u.hostname === 'upload.wikimedia.org';
    const globe = /\/globe(\.json|-draw\.js)$/.test(u.pathname);
    if ((hold && img) || (globeHeld && globe)) held.push(route);
    else route.continue();
  });
  await page.goto(served.url);
  await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  // (A case may list alternatives, a/b/c: the first one in the fan is opened.)
  const open = (alts) =>
    page.evaluate((alts) => {
      const f = window.__fan;
      for (const sci of alts.split('/')) {
        const b = f.fan.branches.find((b) => b.sp.sci === sci);
        if (!b) continue;
        f.onSelect({ sp: b.sp, ageMa: b.sp.t1 });
        return sci;
      }
      return null;
    }, alts);
  for (const [i, alts0] of SPECIES.entries()) {
    const refuse = alts0.endsWith('!');
    const alts = alts0.replace(/!$/, '');
    hold = true;
    const sci = await open(alts);
    if (!sci) {
      console.log(alts.slice(0, 80), 'not in the fan');
      continue;
    }
    await page.waitForTimeout(700); // (the spinner fades in after 250 ms)
    const name = PREFIX + sci.toLowerCase().replace(/ /g, '-') + (refuse ? '-refused' : '');
    const a = await page.evaluate(boxes);
    await page.screenshot({ path: `${OUT}/${name}-loading.png` });
    hold = false;
    if (i === 0) globeHeld = false;
    for (const r of held.splice(0)) await (refuse && isImg(r) ? r.abort() : r.continue()).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('.card-sp .media .loading'), null, { timeout: 20000 }).catch(() => console.log(sci, 'still loading after 20 s'));
    await page.waitForTimeout(400);
    const b = await page.evaluate(boxes);
    await page.screenshot({ path: `${OUT}/${name}-loaded.png` });
    console.log(`${sci}${refuse ? ' (images refused)' : ''}${i === 0 ? ' (cold: globe held too)' : ''}\n  loading: ${JSON.stringify(a)}\n  loaded:  ${JSON.stringify(b)}\n  shift:   ${shift(a, b)}`);
  }
  // The first card again, its picture in the cache: no spinner, not even for a frame. (Routing turns Playwright's
  // cache off, so the routes go and the card opens once more to fill it.)
  await page.unroute('**/*');
  for (const r of held.splice(0)) await r.continue().catch(() => {});
  const close = async () => {
    await page.evaluate(() => window.__fan.tap(-1e6, -1e6));
    await page.waitForTimeout(300);
  };
  await close();
  const first = SPECIES[0].replace(/!$/, '');
  await open(first);
  await page.waitForFunction(() => !document.querySelector('.card-sp .media .loading'), null, { timeout: 20000 }).catch(() => {});
  await close();
  // (How long its items stay .loading: the spinner fades in from 250 ms, so under that it never shows.)
  await open(first);
  const a = await page.evaluate(boxes);
  const ms = await page.evaluate(
    () =>
      new Promise((ok) => {
        const t = performance.now();
        const poll = () => (!document.querySelector('.card-sp .media .loading') ? ok(Math.round(performance.now() - t)) : performance.now() - t > 2000 ? ok(-1) : setTimeout(poll, 5));
        poll();
      }),
  );
  await page.waitForTimeout(400);
  const b = await page.evaluate(boxes);
  await page.screenshot({ path: `${OUT}/${PREFIX}${first.split('/')[0].toLowerCase().replace(/ /g, '-')}-reopened.png` });
  console.log(`reopened ${first.split('/')[0]} from the cache: its items loading for ${ms < 0 ? 'over 2000' : ms} ms after the card opened\n  shift:   ${shift(a, b)}`);
} finally {
  await browser.close();
  served.close();
}
