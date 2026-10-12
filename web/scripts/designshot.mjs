// The design pass's screenshot set at 390×844 (default headless, no GPU flags):
// home, the mesh at a range of individuals per scale bar, deep in the lives,
// zoomed far out, and a species card open.
//   npm run build:single && node scripts/designshot.mjs <out-dir> [prefix] [only,names]
//   (DSF: device scale factor, default 2; CLIP=x,y,w,h; DEBUG=1: the ?debug readout; EDGE=curved|straight: the fan's edges;
//   WIDTH=linear|log: the widths, default linear; LEVEL=carnivores: the folded carnivores, ToLaD#146)
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'perf-out/design';
const PREFIX = process.argv[3] || 'd';
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
mkdirSync(OUT, { recursive: true });
// [name, kind, args]: 'home' | 'far' | 'window' [youngYrs, oldYrs] | 'card' [species] | 'touch' [species, agoYears] | 'scroll' [zoom, agoYears] | 'bar' [species, agoYears, perBar, sy, at?]
//   | 'split' [splitMa, time zoom × home] | 'tapnode' [splitMa, ageMa] | 'pan' [zoom, px down from "now" at 160, px across]
//   | 'about' [species, agoYears, k, r] | 'frame' [species, agoYears, time zoom × home, width filled?] | 'search' [query, pick?]: from home, the search opened, the query typed, and the row named `pick` tapped
const scenes = [
  ['home', 'home'],
  ['far', 'far'],
  ['bar-5e4', 'bar', ['Lion', 3000, 5e4, 40]],
  ['bar-1e3', 'bar', ['Lion', 3000, 1e3, 40]],
  ['bar-100', 'bar', ['Lion', 3000, 100, 40]],
  ['bar-60', 'bar', ['Lion', 3000, 60, 40]],
  ['bar-35', 'bar', ['Lion', 3000, 35, 40]],
  ['deep', 'bar', ['Lion', 300, 4, 3000]],
  ['card', 'card', ['Tiger']],
  ['card-cave', 'card', ['Cave lion']],
  // A tap on a column (the touch marker), columns whose tips are above the screen, near now.
  ['touch', 'touch', ['Lion', 70]],
  ['scrolled', 'scroll', [2.2, 2000]],
  ['nearnow', 'bar', ['Lion', 25, 2e3, 900]],
  // Sequences (#54): a slow pan down from home until "now" is above the screen, and a zoom from home into the lion.
  ...[0, 60, 120, 180, 260, 360].map((dy, k) => [`pan${k + 1}`, 'pan', [1.5, dy]]),
  ...[0, 0.2, 0.4, 0.6, 0.8, 1].map((t, k) => [`zoom${k + 1}`, 'zoomin', ['Lion', 300, t]]),
  // A pan across with "now" off screen (#97): the labels beside their branches slide, none jumps.
  ...[0, 40].map((dx, k) => [`across${k + 1}`, 'pan', [3, 420, dx]]),
  // The dated tree (#46): onto a split [its date Ma, time zoom × home], the mesh across one (the lion's
  // right edge just above its split from the cave lion), and a tap on a parent column [split Ma, age Ma].
  ['split-lionleopard', 'split', [2.57, 5]],
  ['split-cavelion', 'split', [0.5, 5]],
  ['split-eurojag', 'split', [2.0, 5]],
  ['split-root', 'split', [4.58, 3]],
  ['decline', 'bar', ['Lion', 50, 1e5, 3.5, 0.5]],
  // The lion's last 200 years filling the screen; the mesh on the cave lion as it peels off the lion.
  ['last200', 'decline', ['Lion', 200]],
  ['mesh-lean', 'bar', ['Cave lion', 480000, 3e3, 60, 0]],
  // An extinct column's tip (its taper to nobody).
  ['tip-cave', 'bar', ['Cave lion', 16000, 1e4, 30, 0.5]],
  ['mesh-split', 'bar', ['Lion', 499990, 100, 2e4, 1]],
  ['lineage', 'tapnode', [2.57, 1.2]],
  // The cat family (the data's dated tree, ToLaD#145): Pantherinae vs Felinae (11.97 Ma), the crowded Felinae base
  // (10.4–7.5 Ma), the lynxes, the domestic cat; a tap on Panthera's stem opens its split card (date and source).
  ['split-felidae', 'split', [11.97, 2]],
  ['base-felinae', 'split', [10.42, 6]],
  ['split-lynx', 'split', [2.201, 4]],
  ['tap-panthera', 'tapnode', [4.58, 6]],
  ['tap-pantherinae', 'tapnode', [8.162, 9]],
  ['domestic-boom', 'split', [0.0095, 3]],
  ['card-sandcat', 'card', ['Sand cat']],
  ['card-domestic', 'card', ['Domestic cat']],
  // The Red List chip on a small cat (Least Concern, gray) and on the leopard (ToLaD#98).
  ['card-leopardcat', 'card', ['Mainland leopard cat']],
  ['card-leopard', 'card', ['Leopard']],
  // The merged data (ToLaD#70): the lion's column from its split down past its genomic deep past, a
  // range-loss trend (the Eurasian lynx, modelled, dashed) on its card, and the lion's card.
  ['lion-column', 'split', [0.5, 1.5]],
  ['card-lion', 'card', ['Lion']],
  ['card-lynx', 'card', ['Eurasian lynx']],
  // Texture at every zoom, branch-outs as lines (#100, #101): zoomed 2^k × home (time 2^(k·r)) about a
  // column `ago` years back: the leopard cat's stem below its start, the river forks at the Felidae base.
  ['stem-leopardcat', 'about', ['Mainland leopard cat', 1.2e7, 9, 1]],
  ['forks-base', 'about', ['Mainland leopard cat', 1.2e7, 12, 0.5]],
  ['peel-domestic', 'about', ['Domestic cat', 1e4, 3, 0.5]],
  // Held (no-data) stretches drawn faint (ToLaD#55): the leopard's and jaguar's columns since their last
  // figure, the snow leopard's from its split to its oldest genomic point.
  ['held-leopard', 'about', ['Leopard', 6, 6, 0.4]],
  ['held-jaguar', 'about', ['Jaguar', 10, 7, 0.4]],
  ['held-snow', 'about', ['Snow leopard', 1e6, 1, 0.3]],
  // Curated bottlenecks (ToLaD#141): the puma's and the cheetah's windows tinted and named on their columns,
  // a little zoomed and further in, and a tap inside each window at home opening the card's section on it.
  // (#149: 'frame', so the column is the picture, not a thread among the big cats in linear widths.)
  ['bneck-puma', 'frame', ['Puma', 16000, 2]],
  ['bneck-puma-in', 'about', ['Puma', 16000, 5, 0.6]],
  ['bneck-cheetah', 'frame', ['Cheetah', 11800, 2]],
  ['bneck-cheetah-in', 'about', ['Cheetah', 11800, 5, 0.6]],
  ['bneck-puma-deep', 'about', ['Puma', 16000, 8, 0.5]],
  ['bneck-tiger', 'about', ['Tiger', 2000, 6, 0.3]],
  ['bneck-iberian', 'about', ['Iberian lynx', 3000, 7, 0.3]],
  ['bneck-tap-puma', 'touch', ['Puma', 22000]],
  ['bneck-tap-cheetah', 'touch', ['Cheetah', 11800]],
  // Honest marks (ToLaD#149): only species-wide windows tinted (the lion's Gir and Asiatic events are
  // regional: on its card, not its column), each column framed from ~50 kya to now; the lion's card
  // touched in 1850, its India section open under the sparkline.
  ['bfit-lion', 'frame', ['Lion', 2000, 1.6]],
  ['bfit-lion-card', 'touch', ['Lion', 176]],
  ['bfit-cheetah', 'frame', ['Cheetah', 2000, 1.6]],
  ['bfit-puma', 'frame', ['Puma', 2000, 1.6]],
  ['bfit-iberian', 'frame', ['Iberian lynx', 2000, 1.6]],
  ['bfit-tiger', 'frame', ['Tiger', 2000, 1.6]],
  // The search (ToLaD#157): its button at home, "li" typed with the list open, the lion picked (flown there, card open).
  ['search-home', 'home'],
  ['search-li', 'search', ['li']],
  ['search-lion', 'search', ['li', 'Lion']],
  ['search-cave', 'search', ['cave', 'Cave lion']],
  // PSMC's blind spot (ToLaD#143): the lion's and leopard's columns about 15 kya, 50 kya -> now, their
  // post-glacial decline (20-10 kya, Figueiro et al. 2017), then flat to the next level (the genome scaled to meet it).
  ['blind-lion', 'about', ['Lion', 15000, 10, 0.1]],
  ['blind-leopard', 'about', ['Leopard', 15000, 10, 0.1]],
  // A flagged join met at the genome's long-run level (ToLaD#172): the puma's column from ~2 Mya to now, the
  // young end held at the anchor from ~61 kya, and its card with the one-sentence join.
  ['flag-puma', 'frame', ['Puma', 100000, 1, 0.5]],
  ['flag-puma-card', 'card', ['Puma']],
  // Wikipedia link + hotlinked Commons pictures (ToLaD#182; WAIT_MS=4000 lets them load): the lion's card,
  // home with the pills' thumbnails (WIDTH=log: eight pills), and a species with no picture (its card, its pill mid-span).
  ['wiki-lion-card', 'card', ['Lion']],
  ['wiki-home', 'home'],
  ['wiki-noimg-card', 'card', ['Panthera balamoides']],
  ['wiki-noimg', 'frame', ['Panthera balamoides', null, 1, 0.4]],
  // One level up, the carnivores (ToLaD#146): home, a family framed as home frames the order ('level' [taxon]), the
  // cats as the level button frames them, a busy deep past (~40 Ma: ['level', [taxon, Ma, time zoom, width zoom]]),
  // the wolf's card (the domestic dog is in its count), the search with "wol" typed.
  ['carn-home', 'home'],
  ['carn-dogs', 'level', ['Canidae']],
  ['carn-bears', 'level', ['Ursidae']],
  ['carn-seals', 'level', ['Phocidae']],
  ['carn-cats', 'level', ['Felidae']],
  ['carn-deep40', 'level', ['Carnivora', 40, 4, 3]],
  ['carn-card-dog', 'card', ['Grey wolf']],
  ['carn-search-wol', 'search', ['wol']],
  // The fold (ToLaD#146): the dogs at 1.5x, 3x and 6x home's width zoom, opening as they grow.
  ['carn-dogs-z15', 'zoomto', ['Canidae', 1.5]],
  ['carn-dogs-z3', 'zoomto', ['Canidae', 3]],
  ['carn-dogs-z6', 'zoomto', ['Canidae', 6]],
  // The world on the time axis (ToLaD#189): the last 150 kyr (the glacials, the LGM), ~70 Mya (K-Pg), the last 20 kyr
  // (the events). Q='periods=0&ice=0&events=0' for the layers off.
  ['world-150k', 'window', [0, 150000]],
  ['world-kpg', 'window', [30e6, 140e6]],
  ['world-20k', 'window', [0, 20000]],
  // The clades' brackets above "now" (ToLaD#193): a level's home, and a bracket tapped from home (['tapclade', [taxon]]:
  // the flight to the clade, now to its stem; a bracket too narrow to tap at home flown to as the tap would). LEVEL=carnivores for the order.
  ['brk-home', 'home'],
  ['brk-dogs', 'tapclade', ['Canidae']],
  ['brk-bigcats', 'tapclade', ['Pantherinae']],
  ['brk-tap-felidae', 'tapclade', ['Felidae']],
  ['brk-tap-panthera', 'tapclade', ['Panthera']],
];
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DSF || 2), isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  const q = [process.env.DEBUG ? 'debug' : '', process.env.EDGE ? `edge=${process.env.EDGE}` : '', process.env.LEVEL ? `level=${process.env.LEVEL}` : '', process.env.Q || ''].filter(Boolean).join('&');
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href + (q ? `?${q}` : ''));
  await page.waitForFunction(() => !!window.__fan, null, { timeout: Number(process.env.LOAD_MS || 20000) });
  for (const [name, kind, args] of scenes) {
    if (ONLY && !ONLY.has(name)) continue;
    // A search left open by the last scene closed.
    if (await page.$('.search-x')) await page.click('.search-x');
    await page.evaluate(
      ([kind, args, width]) => {
        const f = window.__fan;
        f.setMode(width);
        f.tap(-1e6, -1e6);
        const fan = f.fan;
        if (kind === 'home' || kind === 'card' || kind === 'search') {
          f.cam = f.homeCamera();
          f.camera.settle();
          if (kind === 'card') {
            const b = fan.branches.find((b) => (b.sp.common === args[0] || b.sp.sci === args[0]));
            f.selected = b.sp;
            f.onSelect({ sp: b.sp });
          }
        } else if (kind === 'touch') {
          f.cam = f.homeCamera();
          f.camera.settle();
          const b = fan.branches.find((b) => (b.sp.common === args[0] || b.sp.sci === args[0]));
          const y = fan.time.y(args[1] / 1e6);
          const [px, py] = f.toScreen(b.colLeft + 0.3 * f.model(b).lanes(y).w, y);
          f.tap(px, py);
        } else if (kind === 'scroll') {
          const h = f.homeCamera();
          f.cam = { ...h, sx: h.sx * args[0], sy: h.sy * args[0], ty: h.sy * args[0], cy: fan.time.y(args[1] / 1e6) };
          f.camera.settle();
        } else if (kind === 'window') {
          // The ages [young, old] (years ago) from 120 px under the top to 120 px above the foot.
          const [ya, yb] = args.map((a) => fan.time.y(a / 1e6));
          const h = f.homeCamera();
          const sy = (f.h - 240) / Math.abs(yb - ya);
          f.cam = { ...h, sy, ty: sy, cy: (ya + yb) / 2 };
          f.camera.settle();
        } else if (kind === 'pan') {
          // Zoom z with "now" at 160 px from the top, then the view moved down dy px (into the past).
          const [z, dy, dx = 0] = args;
          const h = f.homeCamera();
          const sy = h.sy * z;
          f.cam = { ...h, sx: h.sx * z, sy, ty: sy, cy: f.yNow + (f.h / 2 - (160 - dy)) / sy, cx: h.cx + dx / (h.sx * z) };
          f.camera.settle();
        } else if (kind === 'about') {
          const [sp, ago, k, r] = args;
          const b = fan.branches.find((b) => (b.sp.common === sp || b.sp.sci === sp));
          const h = f.homeCamera();
          const y = fan.time.y(ago / 1e6);
          const L = f.model(b).lanes(y);
          const sy = h.sy * 2 ** (k * r);
          f.cam = { cx: L.left + L.w / 2, cy: y, sx: h.sx * 2 ** k, sy, ty: sy };
          f.camera.settle();
        } else if (kind === 'frame') {
          // The species' column at `ago` years filling `fill` of the screen's width (ToLaD#149), time zoomed tz × home.
          const [sp, ago, tz, fill = 0.4] = args;
          const b = fan.branches.find((b) => (b.sp.common === sp || b.sp.sci === sp));
          const h = f.homeCamera();
          const y = fan.time.y(ago === null ? (b.sp.t0 + b.sp.t1) / 2 : ago / 1e6);
          const L = f.model(b).lanes(y);
          const sy = h.sy * tz;
          f.cam = { cx: L.left + L.w / 2, cy: y, sx: (fill * f.w) / L.w, sy, ty: sy };
          f.camera.settle();
        } else if (kind === 'zoomin') {
          // From home (t = 0) to the species' individuals (t = 1, 4 per 70 px bar) about a point on its column.
          const [sp, ago, t] = args;
          const b = fan.branches.find((b) => (b.sp.common === sp || b.sp.sci === sp));
          const h = f.homeCamera();
          f.cam = h;
          const y = fan.time.y(ago / 1e6);
          const [px, py] = f.toScreen(b.colLeft + 0.3 * b.width, y);
          const F = Math.pow(70 / 4 / b.unit / h.sx, t);
          const sx = h.sx * F;
          const sy = h.sy * F;
          const wx = b.colLeft + 0.3 * b.width;
          f.cam = { cx: wx - (px - f.w / 2) / sx, cy: y - (py - f.h / 2) / sy, sx, sy, ty: sy };
          f.camera.settle();
        } else if (kind === 'split' || kind === 'tapnode') {
          const v = fan.nodes.find((n) => Math.abs(n.ageMa - args[0]) < 1e-9);
          if (kind === 'tapnode') {
            f.cam = f.homeCamera();
            f.camera.settle();
            const y = fan.time.y(args[1]);
            const [px, py] = f.toScreen(v.left + 0.5 * v.width, y);
            f.tap(px, py);
          } else {
            // The parent column and its daughters after their peels across 80% of the screen; the peel
            // above the split and the lanes' blend below it in the middle third.
            const isN = (k) => 'strands' in k;
            let lo = v.left;
            let hi = v.left + v.width;
            for (const k of v.kids) {
              lo = Math.min(lo, isN(k) ? k.left : k.colLeft);
              hi = Math.max(hi, isN(k) ? k.left + k.width : k.colLeft + k.width);
            }
            const H = Math.max(...v.kids.map((k) => v.y - k.leanY)) + v.blend;
            const h = f.homeCamera();
            const sx = Math.max(h.sx, (0.8 * f.w) / (hi - lo));
            const sy = Math.max(h.sy * args[1], f.h / 3 / H);
            f.cam = { cx: (lo + hi) / 2, cy: v.y - (H - 2 * v.blend) / 2, sx, sy, ty: sy };
            f.camera.settle();
          }
        } else if (kind === 'zoomto') {
          // A clade (taxon args[0]) centred at args[1] × home's width zoom, its level's time frame (ToLaD#146: the fold opening).
          f.cam = f.levelCamera(args[0], args[1]) ?? f.homeCamera();
          f.camera.settle();
        } else if (kind === 'tapclade') {
          // Home drawn, then a tap on the clade's bracket (it flies there; the shot waits WAIT_MS for it to land).
          f.cam = f.homeCamera();
          f.camera.settle();
          f.draw();
          const at = f.bracketAt(args[0]);
          if (at) f.tap(at[0], at[1]);
          else f.flyToClade(fan.nodes.find((n) => n.split.taxon === args[0]));
        } else if (kind === 'level') {
          // A level (ToLaD#146): the split founding taxon args[0] framed as home frames the fan; with args[1] (Ma),
          // centred on that time, time zoomed args[2] and width args[3] × the frame.
          const h = f.levelCamera(args[0]) ?? f.homeCamera();
          f.cam = args[1] === undefined ? h : { ...h, cy: fan.time.y(args[1]), sy: h.sy * (args[2] ?? 1), ty: h.sy * (args[2] ?? 1), sx: h.sx * (args[3] ?? 1) };
          f.camera.settle();
        } else if (kind === 'decline') {
          // The species' last `args[1]` years filling the screen, its column 60% of its width.
          const b = fan.branches.find((b) => (b.sp.common === args[0] || b.sp.sci === args[0]));
          const y0 = fan.time.y(args[1] / 1e6);
          const y1 = fan.time.y(0);
          const sy = (0.8 * f.h) / (y0 - y1);
          const sx = (0.6 * f.w) / b.width;
          f.cam = { cx: b.cx, cy: y1 + (f.h / 2 - 120) / sy, sx, sy, ty: sy };
          f.camera.settle();
        } else if (kind === 'far') {
          const h = f.homeCamera();
          f.cam = { ...h, sx: h.sx / 6, sy: h.sy / 6, ty: h.sy / 6 };
          f.camera.settle();
        } else {
          const [sp, ago, perBar, sy, at] = args;
          const b = fan.branches.find((b) => (b.sp.common === sp || b.sp.sci === sp));
          // World width per individual (alive widths): the bar is 70 px.
          const sx = 70 / perBar / b.unit;
          f.cam = { cx: 0, cy: fan.time.y(ago / 1e6), sx, sy, ty: sy };
          f.camera.settle();
          const L = f.model(b).lanes(f.cam.cy);
          f.cam.cx = at === undefined ? L.left + L.gw : L.left + L.w * at;
          f.camera.settle();
        }
        f.request();
      },
      [kind, args ?? [], process.env.WIDTH || 'linear'],
    );
    if (kind === 'search') {
      await page.click('button[aria-label="Find a species"]');
      await page.keyboard.type(args[0], { delay: 40 });
      if (args[1]) {
        await page.click(`.search-list li:has(.nm:text-is("${args[1]}"))`);
        // The flight (~0.7 s), then the card.
        await page.waitForTimeout(1200);
      }
    }
    await page.waitForTimeout(Number(process.env.WAIT_MS || 900));
    // DETAILS=1: the card's Details opened and scrolled into view (a split's date source, ToLaD#145).
    if (process.env.DETAILS) {
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; d.scrollIntoView({ block: 'end' }); }));
      await page.waitForTimeout(300);
    }
    // CLIP=x,y,w,h (CSS px): only that part of the page (with DSF=4–6, a close look).
    const clip = process.env.CLIP ? Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, Number(process.env.CLIP.split(',')[i])])) : undefined;
    await page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png`, clip });
    console.log('shot', name);
  }
} finally {
  await browser.close();
}
