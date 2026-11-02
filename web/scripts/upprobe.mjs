// Where a double tap lands, route by route (ToLaD#301): real touches at 390×844 (default headless, no GPU flags), each
// double tap's level before, where it landed, the parent level it should land on (the first level up from the level
// shown whose frame visibly moves) and the brackets' stack's innermost row after. One line per double tap, a table.
//   npm run build:single && node scripts/upprobe.mjs [route names,...]
//   (LEVEL=mammals|cats: ?level=; Q: more query)
// A route's steps: t:<group or species> a tap on its column (off the pills); p:<group> a tap on its pill or picture;
// x a tap on a "+x" of several species; s:<query>|<pick> a search pick; m a tap on the stack's "…"; pan:dx,dy a drag;
// (a name's spaces as _) pinch:f a two-finger spread by f (width); d a double tap (at DY); c a double tap on the card,
// off its controls (ToLaD#301), which must close it; ~ the next tap's flight not waited
// for (a double tap mid-flight).
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const MAMMALS = process.env.LEVEL === 'mammals';
const ROUTES = MAMMALS
  ? {
      primates: 't:Primates t:Primates t:Primates t:Primates t:Primates d d d d d d',
      humans: 't:Homo_sapiens t:Homo_sapiens t:Homo_sapiens t:Homo_sapiens t:Homo_sapiens t:Homo_sapiens d d d d d d d',
      pills: 'p:Primates p:Hominidae p:Hominini d d d d',
      carn: 't:Carnivora t:Carnivora t:Carnivora d d d d',
      plus: 'x d d d',
      search: 's:chimp|Chimpanzee d d d d d',
      searchh: 's:homo_sap|Human d d d d d d',
      pan: 't:Primates t:Primates pan:0,140 d d',
      pinch: 't:Primates pinch:1.8 d d',
      more: 't:Homo_sapiens t:Homo_sapiens t:Homo_sapiens m m m',
      mid: 't:Primates ~t:Primates d d',
      midup: 't:Primates t:Primates t:Primates d ~d d',
      card: 't:Homo_sapiens t:Homo_sapiens t:Homo_sapiens t:Homo_sapiens t:Homo_sapiens t:Homo_sapiens c c c',
      cards: 's:chimp|Chimpanzee c c c',
    }
  : {
      dogs: 't:Canidae t:Canidae t:Canidae t:Canidae d d d d d',
      cats: 't:Felidae t:Felidae t:Felidae t:Felidae t:Felidae d d d d d d',
      pills: 'p:Ursidae p:Ursus d d d',
      plus: 'x d d d',
      plus2: 't:Canidae x d d d',
      search: 's:polar|Polar_bear d d d d',
      pan: 't:Mustelidae t:Mustelidae pan:0,140 d d d',
      pinch: 't:Felidae pinch:1.8 d d',
      more: 't:Canidae t:Canidae m m m',
      mid: 't:Canidae ~t:Canidae d d',
      midup: 't:Canidae t:Canidae t:Canidae d ~d d',
      card: 't:Ursidae t:Ursidae t:Ursidae t:Ursidae t:Ursidae d d',
      plus3: 't:Mustelidae x d d d',
      cardc: 't:Ursidae t:Ursidae t:Ursidae t:Ursidae t:Ursidae c c',
      cardcat: 't:Felidae t:Felidae t:Felidae t:Felidae t:Felidae c c',
      cards: 's:polar|Polar_bear c c',
    };
// The double tap's height (px): over the species' card, which takes the screen's foot (DY=470: on it, where it is tall).
const DY = Number(process.env.DY || 300);
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
  const cdp = await ctx.newCDPSession(page);
  // In the page: names, the level shown, and where a double tap should go from it.
  await page.evaluate(() => {
    const f = window.__fan;
    const nm = (lv) => (lv.b ? lv.b.sp.common || lv.b.sp.sci : (lv.v.split?.taxon ?? lv.v.name ?? '?').replace(/\s*\(.*\)\s*$/, '') || 'home');
    window.__up = {
      nm,
      now: () => nm(f.levelNow(true)),
      want: (lv) => {
        const u = f.levelsAbove(lv).find((u) => f.offBy(f.frameOf({ v: u }), f.cam) > 12);
        return u ? nm({ v: u }) : '(none: home)';
      },
      stack: () => {
        const at = f.brackets?.atKey;
        return at ? nm({ v: at.up[0] }) : '?';
      },
      named: (s) => {
        const fan = f.fan;
        const g = fan.nodes.find((v) => v.split && ((v.split.taxon ?? '').replace(/\s*\(.*\)\s*$/, '') === s || v.name === s));
        const b = fan.branches.find((q) => q.sp.common === s || q.sp.sci === s);
        return { g, b: b ?? (g ? [...g.strands].sort((p, q) => q.width - p.width)[0] : null) };
      },
    };
    window.__dbl = 0;
    window.__taps = 0;
    const tp = f.tap.bind(f);
    f.tap = (x, y) => (window.__taps++, tp(x, y));
    const dt = f.doubleTap.bind(f);
    f.doubleTap = (x, y, ran) => (window.__dbl++, (window.__dlog = `ran=${!!ran} anim=${!!f.anim} backing=${f.backing ? window.__up.nm(f.backing.lv) : '-'} now=${window.__up.nm(f.levelNow(true))}`), dt(x, y, ran));
    f.tap = ((tp) => (x, y) => ((window.__tlog = `tap ${x | 0},${y | 0} kind=${f.tapKind(x, y)}`), tp(x, y)))(f.tap.bind(f));
  });
  // (A held tap runs once the double-tap window's timer fires, late on a busy page: `taps`, the count it waits to pass.)
  const land = async (taps = -1) => {
    await page.waitForTimeout(420);
    if (taps >= 0) await page.waitForFunction((n) => window.__taps > n, taps, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !window.__fan.anim, null, { timeout: 20000 });
    await page.waitForTimeout(250);
  };
  const tap = (x, y) => page.touchscreen.tap(x, y);
  for (const [route, steps] of Object.entries(ROUTES)) {
    if (ONLY && !ONLY.has(route)) continue;
    try {
    // From home, nothing open.
    if (await page.$('.search-x')) await page.click('.search-x');
    await page.evaluate(() => {
      const f = window.__fan;
      f.anim = null;
      f.backing = null;
      f.tapAt = null;
      f.cam = f.homeCamera();
      f.camera.settle();
      f.onSelect(null);
      f.selected = null;
      f.request();
    });
    await page.waitForTimeout(400);
    let noWait = false;
    let trail = [];
    for (const s of steps.split(' ')) {
      let st = s.replaceAll('_', ' ');
      const mid = st.startsWith('~');
      if (mid) st = st.slice(1);
      const before = await page.evaluate(() => window.__up.now());
      const taps0 = await page.evaluate(() => window.__taps);
      if (st === 'd' || st === 'c') {
        // c: the double tap on the species' card (ToLaD#301), off its controls, where it is tall.
        let at0 = { x: 195, y: DY };
        if (st === 'c') {
          await page.waitForTimeout(800);
          const p = await page.evaluate(() => {
            const card = document.querySelector('.card-sp');
            if (!card) return null;
            // (Its count line's text, else any of its blank off the controls.)
            const ever = card.querySelector('.ever, .dim');
            if (ever) {
              const e = ever.getBoundingClientRect();
              return { x: e.left + Math.min(40, e.width / 2), y: (e.top + e.bottom) / 2 };
            }
            const r = card.getBoundingClientRect();
            const ctl = 'a, button, summary, input, select, textarea, label, img, canvas, [role="button"]';
            for (let y = r.bottom - 8; y > r.top + 8; y -= 6)
              for (let x = r.left + 12; x < r.right - 12; x += 8) {
                const el = document.elementFromPoint(x, y);
                if (el && card.contains(el) && !el.closest(ctl)) return { x, y };
              }
            return null;
          });
          if (!p) {
            rows.push([route, trail.join(' '), before, '-', '-', '-', 'no card open', 'skip']);
            trail.push('c?');
            continue;
          }
          at0 = p;
        }
        // Mid-flight (the last step's flight not waited for): from where it lands.
        const info = await page.evaluate((mid) => {
          const f = window.__fan;
          const on = mid && f.backing;
          const from = on ? f.backing.lv : f.levelNow(true);
          const cam = f.cam;
          if (on) f.cam = f.backing.cam;
          const want = window.__up.want(from);
          f.cam = cam;
          return { from: window.__up.nm(from), want, n: window.__dbl, t: window.__taps };
        }, noWait);
        // (Sent at once, so a busy page's frames do not stretch the gap past the double tap's window; FAST=0: two taps 90 ms apart.)
        if (process.env.FAST === '0') {
          await tap(at0.x, at0.y);
          await page.waitForTimeout(90);
          await tap(at0.x, at0.y);
        } else {
          const at = [{ x: at0.x, y: at0.y, id: 7 }];
          await Promise.all([
            cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at }),
            cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
            cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at }),
            cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
          ]);
        }
        if (mid) {
          // Its flight not waited for: the next double tap goes on from where it lands.
          await page.waitForTimeout(500);
          rows.push([route, trail.join(' '), info.from, '(flying)', info.want, '', '', '']);
          trail.push('~d');
          noWait = true;
          continue;
        }
        await land();
        const after = await page.evaluate(() => ({ at: window.__up.now(), stack: window.__up.stack(), n: window.__dbl, t: window.__taps, card: !!window.__fan.selected, log: `${window.__tlog ?? ''} ${window.__dlog ?? ''}` }));
        const ok = (after.at === info.want || (info.want.startsWith('(none') && after.at === info.from)) && after.n === info.n + 1 && !(st === 'c' && after.card);
        rows.push([route, trail.join(' ') + (noWait ? ' (mid-flight)' : ''), info.from, after.at, info.want, after.stack, (after.n === info.n + 1 ? '' : 'NOT A DOUBLE TAP') + (after.t > info.t ? ` (+${after.t - info.t} single tap)` : '') + (process.env.VERBOSE ? ` [${after.log}]` : ''), ok ? 'ok' : 'WRONG']);
        trail.push(st === 'c' ? `c@${at0.x | 0},${at0.y | 0}${after.card ? ' CARD STILL OPEN' : ''}` : 'd');
        noWait = false;
        continue;
      }
      if (st.startsWith('t:') || st.startsWith('p:')) {
        const name = st.slice(2);
        const p = await page.evaluate(
          ([name, pill]) => {
            const f = window.__fan;
            const { g, b } = window.__up.named(name);
            if (pill && g) {
              const h = f.famHits.find((q) => q.v === g) ?? f.thumbHits.find((q) => q[4] === g);
              if (h) return h.box ? [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2] : [h[0], h[1]];
            }
            if (!b) return null;
            const ty = f.toScreen(0, b.tipY)[1];
            const sy = f.toScreen(0, b.splitY)[1];
            for (let y = Math.max(140, ty + 10); y < Math.min(f.h - 160, sy - 4); y += 6)
              for (let x = 4; x < f.w - 4; x += 2) if (f.hitBranch(x, y) === b && !f.pillAt(x, y) && !f.picAt(x, y) && !f.plusAt(x, y)) return [x, y];
            return null;
          },
          [name, st.startsWith('p:')],
        );
        if (!p) {
          rows.push([route, trail.join(' '), before, '-', '-', '-', `no ${st} on screen`, 'skip']);
          trail.push(`${st}?`);
          continue;
        }
        await tap(p[0], p[1]);
      } else if (st === 'x') {
        const p = await page.evaluate(() => {
          const f = window.__fan;
          const h = f.plusHits.find((q) => q.bs.length > 1) ?? f.plusHits[0];
          return h ? [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2] : null;
        });
        if (!p) {
          trail.push('x?');
          continue;
        }
        await tap(p[0], p[1]);
      } else if (st === 'm') {
        const p = await page.evaluate(() => {
          const br = window.__fan.brackets;
          if (!br) return null;
          for (let y = 60; y < 844; y += 2) if (br.moreHit(br.x0 + 14, y)) return [br.x0 + 14, y];
          return null;
        });
        if (!p) {
          trail.push('m?');
          continue;
        }
        await tap(p[0], p[1]);
      } else if (st.startsWith('s:')) {
        const [query, pick] = st.slice(2).split('|');
        await page.click('button[aria-label="Find a species"]');
        await page.keyboard.type(query, { delay: 30 });
        await page.click(`.search-list li:has(.nm:text-is("${pick}"))`);
      } else if (st.startsWith('pan:')) {
        const [dx, dy] = st.slice(4).split(',').map(Number);
        const pt = (x, y) => [{ x, y, id: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(200, 400) });
        for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(200 + (dx * k) / 8, 400 + (dy * k) / 8) });
        await page.waitForTimeout(120);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else if (st.startsWith('pinch:')) {
        const fx = Number(st.slice(6));
        const pts = (d) => [
          { x: 195 - d, y: 420, id: 1 },
          { x: 195 + d, y: 420, id: 2 },
        ];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(50) });
        for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(50 * (1 + ((fx - 1) * k) / 10)) });
        await page.waitForTimeout(120);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      if (mid) {
        // The tap's hold (320 ms), then a little of its flight.
        await page.waitForTimeout(560);
        noWait = true;
      } else {
        await land(st.startsWith('t:') || st.startsWith('p:') || st === 'x' || st === 'm' ? taps0 : -1);
        if (st.startsWith('s:')) await page.waitForTimeout(600);
      }
      const now = await page.evaluate(() => window.__up.now());
      const tl = process.env.VERBOSE ? await page.evaluate(() => ` [${window.__tlog}]`) : '';
      trail.push(`${st}→${now}${tl}`);
    }
    } catch (e) {
      rows.push([route, '', '', '', '', '', String(e).split('\n')[0], 'ERROR']);
    }
  }
} finally {
  await browser.close();
  served?.close();
}
console.log(['route', 'before (steps)', 'level shown', 'landed', 'parent (want)', 'stack after', 'note', ''].join(' | '));
for (const r of rows) console.log(r.join(' | '));
