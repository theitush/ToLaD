// Whether a pill's hit box goes stale (ToLaD#301): real touches at 390×844 (default headless, no GPU flags) on each
// group's pill or picture where the last drawn frame put it, the view still; what the tap flew to, and whether what
// is under that point changed between the touch and the held tap running (the double-tap window, 320 ms).
//   npm run build:single && LEVEL=mammals [PRE=Primates,...] node scripts/hitprobe.mjs [groups,...]
// (PRE: from home, a tap on each of these groups' pills or pictures first, so the groups probed are the level's there.)
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const ONLY = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const browser = await chromium.launch({ headless: true });
let served = null;
const rows = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  const q = [process.env.LEVEL ? `level=${process.env.LEVEL}` : '', process.env.Q || ''].filter(Boolean).join('&');
  served = await pageUrl(q);
  await page.goto(served.url);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: 30000 });
  await page.evaluate(() => {
    const f = window.__fan;
    const nm = (v) => (v.split?.taxon ?? v.name ?? '?').replace(/\s*\(.*\)\s*$/, '') || 'home';
    window.__nm = nm;
    // What a tap at (x, y) goes to, from the hit lists the last frame drew.
    window.__under = (x, y) => {
      const p = f.pillAt(x, y);
      if (p) return `pill ${p.v ? nm(p.v) : p.b.sp.common}`;
      const t = f.picAt(x, y);
      if (t) return `pic ${t[4] ? nm(t[4]) : t[3].sp.common}`;
      return '-';
    };
    window.__frames = [];
    const draw = f.draw.bind(f);
    f.draw = () => {
      draw();
      if (window.__watch) window.__frames.push([performance.now() | 0, window.__under(...window.__watch)]);
    };
    const tap = f.tap.bind(f);
    f.tap = (x, y) => {
      window.__tapped = { t: performance.now() | 0, under: window.__under(x, y) };
      tap(x, y);
    };
    window.__home = () => {
      f.anim = null;
      f.backing = null;
      f.tapAt = null;
      f.cam = f.homeCamera();
      f.camera.settle();
      f.onSelect(null);
      f.selected = null;
      f.request();
    };
  });
  if (process.env.PRE) {
    for (const pre of process.env.PRE.split(',')) {
      const at = await page.evaluate((g) => {
        const f = window.__fan;
        const h = f.famHits.find((q) => window.__nm(q.v) === g);
        const t = f.thumbHits.find((q) => q[4] && window.__nm(q[4]) === g);
        return h ? [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2] : t ? [t[0], t[1]] : null;
      }, pre);
      if (!at) break;
      await page.touchscreen.tap(at[0], at[1]);
      await page.waitForTimeout(900);
      await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
      await page.waitForTimeout(400);
    }
  }
  const groups = await page.evaluate(() => {
    const f = window.__fan;
    const nm = window.__nm;
    return [...f.famHits.map((h) => nm(h.v)), ...f.thumbHits.filter((h) => h[4]).map((h) => nm(h[4]))];
  });
  for (const g of [...new Set(groups)]) {
    if (ONLY && !ONLY.has(g)) continue;
    await page.evaluate(() => window.__home());
    await page.waitForTimeout(600);
    // (PRE=a,b: first a tap on each of these groups' pills or pictures in turn, each flight landed.)
    for (const pre of (process.env.PRE || '').split(',').filter(Boolean)) {
      const at = await page.evaluate((g) => {
        const f = window.__fan;
        const h = f.famHits.find((q) => window.__nm(q.v) === g);
        const t = f.thumbHits.find((q) => q[4] && window.__nm(q[4]) === g);
        window.__tapped = null;
        return h ? [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2] : t ? [t[0], t[1]] : null;
      }, pre);
      if (!at) break;
      await page.touchscreen.tap(at[0], at[1]);
      await page.waitForFunction(() => !!window.__tapped, null, { timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
      await page.waitForTimeout(400);
    }
    const p = await page.evaluate((g) => {
      const f = window.__fan;
      const nm = window.__nm;
      const h = f.famHits.find((q) => nm(q.v) === g);
      const t = f.thumbHits.find((q) => q[4] && nm(q[4]) === g);
      const at = h ? [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2] : t ? [t[0], t[1]] : null;
      if (!at) return null;
      window.__watch = at;
      window.__frames = [];
      window.__tapped = null;
      return { at, kind: h ? 'pill' : 'pic', under: window.__under(...at), t: performance.now() | 0 };
    }, g);
    if (!p) continue;
    await page.touchscreen.tap(p.at[0], p.at[1]);
    await page.waitForFunction(() => !!window.__tapped, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const f = window.__fan;
      const fr = window.__frames;
      window.__watch = null;
      const seen = [...new Set(fr.map((x) => x[1]))];
      return { tapped: window.__tapped, seen, to: f.backing ? (f.backing.lv.v ? window.__nm(f.backing.lv.v) : f.backing.lv.b.sp.common) : '-' };
    });
    const ok = r.tapped && r.tapped.under === p.under;
    rows.push([g, `${p.kind} @${p.at.map((v) => v | 0)}`, p.under, r.tapped?.under ?? '(no tap)', r.to, r.seen.join(' → '), ok ? 'ok' : 'STALE']);
  }
} finally {
  await browser.close();
  served?.close();
}
console.log(['group', 'hit box', 'under at touch', 'under when tap ran', 'flew to', 'under it, frame by frame', ''].join(' | '));
for (const r of rows) console.log(r.join(' | '));
