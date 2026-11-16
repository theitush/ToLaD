// Back on a tab left open (ToLaD#478), at 390×844, default headless (no GPU flags): the cats' group framed and a Lion
// card open, then (1) the WebGL context lost and restored: the tree must be drawn again where it stood, the card still
// open; (2) the context lost and never restored, the page hidden and shown again: the page must reload itself to the
// same place, the card open. Prints one line per step; screenshots into <out-dir>.
//   npm run build:single && node scripts/backprobe.mjs <out-dir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/back';
mkdirSync(OUT, { recursive: true });
const { url, close } = await pageUrl();
const browser = await chromium.launch({ headless: true });
let failed = 0;
const ok = (what, pass, info = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${info ? `: ${info}` : ''}`);
};
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  const ready = () => page.waitForFunction(() => !!window.__fan, null, { timeout: 90000 });
  await page.goto(url);
  await ready();
  // The cats framed, then taps on the Lion's column until its card opens (a column's tap goes a level deeper first).
  // The cats framed, then the Lion's (a search's pick), then taps on the middle of its column until its card opens.
  await page.evaluate(() => window.__fan.goToClade('Felidae'));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__fan.flyToSpecies(window.__fan.fan.branches.find((b) => b.sp.common === 'Lion').sp));
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4 && !(await page.$('.card-sp')); i++) {
    await page.evaluate(() => window.__fan.tap(window.__fan.w / 2, window.__fan.h * 0.45));
    await page.waitForTimeout(1200);
  }
  // What is on screen: the place, the card's first words, the GL layer's drawn pixels (read right after a draw).
  const state = () =>
    page.evaluate(() => {
      const f = window.__fan;
      let gl = -1;
      if (f.gl && !f.gl.lost) {
        f.draw();
        const g = f.gl.gl;
        const [W, H] = [g.drawingBufferWidth, g.drawingBufferHeight];
        const px = new Uint8Array(W * H * 4);
        g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
        gl = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i]) gl++;
      }
      const p = f.place();
      // (The card's species and the point touched; its lower parts, the range map's, fill in as they load.)
      const shown = document.querySelector('.card-sp')?.innerText.replace(/\s+/g, ' ');
      const card = shown ? `${shown.slice(0, shown.indexOf(')') + 1)} @ ${f.touch?.ageMa}` : null;
      return { node: p.node, strand: p.strand, framed: p.framed, cam: p.cam, card, gl, lost: f.contextLost };
    });
  const camSame = (a, b) => ['cx', 'cy', 'sx', 'sy'].every((k) => Math.abs(a.cam[k] - b.cam[k]) <= 1e-6 * Math.max(1, Math.abs(a.cam[k])));
  const s0 = await state();
  console.log('before', JSON.stringify({ ...s0, cam: undefined }));
  ok('a card is open', !!s0.card, s0.card);
  ok('the GL layer is drawn', s0.gl > 1000, `${s0.gl} px`);
  await page.screenshot({ path: `${OUT}/1-before.png` });

  // (1) Lost, then restored.
  await page.evaluate(() => {
    window.__lose = window.__fan.gl.gl.getExtension('WEBGL_lose_context');
    window.__lose.loseContext();
  });
  await page.waitForTimeout(400);
  const s1 = await state();
  ok('lost: the view knows', s1.lost);
  await page.screenshot({ path: `${OUT}/2-lost.png` });
  await page.evaluate(() => window.__lose.restoreContext());
  await page.waitForTimeout(800);
  const s2 = await state();
  console.log('restored', JSON.stringify({ ...s2, cam: undefined }));
  ok('restored: not lost', !s2.lost);
  ok('restored: the GL layer drawn as before', s2.gl === s0.gl, `${s2.gl} px vs ${s0.gl}`);
  ok('restored: the same place', s2.node === s0.node && s2.strand === s0.strand && camSame(s2, s0));
  ok('restored: the same card open', s2.card === s0.card, s2.card);
  await page.screenshot({ path: `${OUT}/3-restored.png` });

  // (2) Lost for good, the page hidden and shown again: it reloads itself to the same place.
  await page.evaluate(() => {
    window.__lose = window.__fan.gl.gl.getExtension('WEBGL_lose_context');
    window.__lose.loseContext();
    const vis = (v) => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      Object.defineProperty(document, 'hidden', { value: v === 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    vis('hidden');
    vis('visible');
  });
  const t0 = Date.now();
  await page.waitForEvent('load', { timeout: 15000 });
  await ready();
  await page.waitForTimeout(800);
  const s3 = await state();
  console.log('reloaded', `after ${Date.now() - t0} ms`, JSON.stringify({ ...s3, cam: undefined }));
  const nav = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type);
  ok('the page reloaded', nav === 'reload', nav);
  ok('reloaded: drawn', !s3.lost && s3.gl > 1000, `${s3.gl} px vs ${s0.gl}`);
  ok('reloaded: the same place', s3.node === s0.node && s3.strand === s0.strand && s3.framed === s0.framed && camSame(s3, s0));
  ok('reloaded: the same card open', s3.card === s0.card, s3.card);
  await page.screenshot({ path: `${OUT}/4-reloaded.png` });

  // (3) A fresh visit to the same address goes home: the place was for that page coming back.
  await page.goto(url);
  await ready();
  const s4 = await state();
  ok('a fresh visit: home, no card', !s4.card && !camSame(s4, s0));
} finally {
  await browser.close();
  close();
}
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
