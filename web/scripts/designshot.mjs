// The design pass's screenshot set at 390×844 (default headless, no GPU flags):
// home, the mesh at a range of individuals per scale bar, deep in the lives,
// zoomed far out, and a species card open.
//   npm run build:single && node scripts/designshot.mjs <out-dir> [prefix] [only,names]
//   (DSF: device scale factor, default 2; CLIP=x,y,w,h; DEBUG=1: the ?debug readout; EDGE=curved|straight: the fan's edges;
//   WIDTH=linear|log: the widths, default linear; LEVEL=cats|carnivores|mammals: ?level= (default: the carnivores, ToLaD#146, #247))
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/design';
const PREFIX = process.argv[3] || 'd';
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
mkdirSync(OUT, { recursive: true });
// [name, kind, args]: 'home' | 'far' | 'window' [youngYrs, oldYrs] | 'card' [species] | 'touch' [species, agoYears] | 'scroll' [zoom, agoYears] | 'bar' [species, agoYears, perBar, sy, at?]
//   | 'split' [splitMa, time zoom × home] | 'tapnode' [splitMa, ageMa] | 'pan' [zoom, px down from "now" at 160, px across]
//   | 'about' [species, agoYears, k, r] | 'frame' [species, agoYears, time zoom × home, width filled?] | 'search' [query, pick?, double taps?]: from home, the search opened, the query typed, the row named `pick` tapped, then that many double taps
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
  // The texture inside a column (#192): the domestic cat's boom, its lines straight, only branching and ending.
  ['tex-domcat300', 'frame', ['Domestic cat', 300, 1.6]],
  ['tex-domcat2000', 'frame', ['Domestic cat', 2000, 1.6]],
  ['flag-puma-card', 'card', ['Puma']],
  // Wikipedia link + hotlinked Commons pictures (ToLaD#182; WAIT_MS=4000 lets them load): the lion's card,
  // home with the pills' thumbnails (WIDTH=log: eight pills), and a species with no picture (its card, its pill mid-span).
  ['wiki-lion-card', 'card', ['Lion']],
  ['wiki-home', 'home'],
  ['wiki-noimg-card', 'card', ['Panthera balamoides']],
  ['wiki-noimg', 'frame', ['Panthera balamoides', null, 1, 0.4]],
  // One level up, the carnivores (ToLaD#146): home, a family framed as home frames the order ('level' [taxon]), the
  // cats as the level button frames them, a busy deep past (~40 Ma: ['level', [taxon, Ma, time zoom, width zoom]]),
  // the wolf's card (the domestic dog its own leaf, split from it ~23 ka), the search with "wol" typed.
  ['carn-home', 'home'],
  ['carn-dogs', 'level', ['Canidae']],
  ['carn-bears', 'level', ['Ursidae']],
  ['carn-seals', 'level', ['Phocidae']],
  ['carn-cats', 'level', ['Felidae']],
  ['carn-deep40', 'level', ['Carnivora', 40, 4, 3]],
  // One more level up, every mammal (ToLaD#247, LEVEL=mammals): orders framed as home frames the whole.
  ['mamm-rodents', 'level', ['Rodentia']],
  ['mamm-bats', 'level', ['Chiroptera']],
  ['mamm-whales', 'level', ['Cetacea']],
  ['mamm-primates', 'level', ['Primates']],
  // The great apes and the hominins (ToLaD#275): Hominidae framed, the human lineage, a Neanderthal's card.
  ['mamm-hominidae', 'level', ['Hominidae']],
  ['mamm-homininae', 'level', ['Homininae']],
  // ToLaD#289: the Hominins and Homo levels (?fit=fossils: framed on the fossils), and tapped down to them from home along the humans.
  ['mamm-hominini', 'level', ['Hominini']],
  ['mamm-homo', 'level', ['Homo']],
  ['hom-taps-6', 'taps', ['Homo sapiens', 'tttttt']],
  ['hom-taps-7', 'taps', ['Homo sapiens', 'ttttttt']],
  ['hom-taps-5', 'taps', ['Homo sapiens', 'ttttt']],
  ['mamm-neanderthal', 'search', ['neander', 'Neanderthal']],
  ['carn-card-dog', 'card', ['Grey wolf']],
  ['carn-search-wol', 'search', ['wol']],
  // A pick that once landed beside the screen (ToLaD#211: the fold opening as the camera zooms): now centred, card open.
  ['tap-monkseal', 'search', ['hawaiian', 'Hawaiian monk seal']],
  ['tap-manedwolf', 'search', ['maned', 'Maned wolf']],
  ['tap-polarbear', 'search', ['polar', 'Polar bear']],
  // A double tap after a pick goes up to its parent level, then that one's (ToLaD#271): not back home.
  ['up-polar1', 'search', ['polar', 'Polar bear', 1]],
  ['up-polar2', 'search', ['polar', 'Polar bear', 2]],
  // The fold (ToLaD#146): the dogs at 1.5x, 3x and 6x home's width zoom, opening as they grow.
  ['carn-dogs-z15', 'zoomto', ['Canidae', 1.5]],
  ['carn-dogs-z3', 'zoomto', ['Canidae', 3]],
  ['carn-dogs-z6', 'zoomto', ['Canidae', 6]],
  ['carn-x3', 'zoomto', ['Carnivora', 3]],
  ['carn-dogs-x15', 'zoomto', ['Canidae', 15]],
  // The world on the time axis (ToLaD#189): the last 150 kyr (the glacials, the LGM), ~70 Mya (K-Pg), the last 20 kyr
  // (the events). Q='periods=0&ice=0&events=0' for the layers off.
  ['world-150k', 'window', [0, 150000]],
  ['world-kpg', 'window', [30e6, 140e6]],
  ['world-20k', 'window', [0, 20000]],
  // The domestic dog's boom out of the wolf, 100 yr to 50 kya at home's width (ToLaD#259).
  ['dog-window', 'window', [100, 50000]],
  // The clades' brackets above "now" (ToLaD#193): a level's home, and a bracket tapped from home (['tapclade', [taxon]]:
  // the flight to the clade, now to its stem; a bracket too narrow to tap at home flown to as the tap would). LEVEL=carnivores for the order.
  ['brk-home', 'home'],
  ['brk-dogs', 'tapclade', ['Canidae']],
  ['brk-bigcats', 'tapclade', ['Pantherinae']],
  ['brk-tap-felidae', 'tapclade', ['Felidae']],
  ['brk-tap-panthera', 'tapclade', ['Panthera']],
  // The fold's straightness (ToLaD#146): a group of species (['group', [sci regex, share of the width it fills at
  // agoMa, agoMa centred, time zoom × home]]): the weasels opened, the ferret badgers opened, the least weasel's
  // split from the mountain weasel (3.1 Ma) close up.
  ['weasels', 'group', ['^Mustela ', 0.85, 6, 1.6]],
  ['ferretbadgers', 'group', ['^Melogale ', 0.85, 3, 2.5]],
  ['weasel-3m', 'group', ['^Mustela (nivalis|altaica)$', 0.5, 3.1, 12]],
  // A cats genus zoomed in (ToLaD#232): the ocelot's kin, every column on screen joined down to its parent.
  ['leopardus', 'group', ['^Leopardus ', 0.85, 3, 2.5]],
  // (The same frames at the width zooms the fold of #210 framed them at: the deep base's connections, ToLaD#232.)
  ['leopardus-z', 'group', ['^Leopardus ', 0.85, 3, 2.5, 263]],
  ['ferretbadgers-z', 'group', ['^Melogale ', 0.85, 3, 2.5, 308]],
  ['weasels-z', 'group', ['^Mustela ', 0.85, 6, 1.6, 33.4]],
  // A pill's "+x" (ToLaD#197) tapped from home, the biggest: the species it stands for framed, their pills showing.
  ['plus-tap', 'tapplus'],
  // A species' name pill tapped from home (ToLaD#230): its branch framed; again: the clade it sits in; again: the one above.
  // (`tappill` [species]: home, its pill tapped, or the first pill shown's; `tapagain`: the same pill tapped where it now is.)
  ['pill-1', 'tappill'],
  ['pill-2', 'tapagain'],
  ['pill-3', 'tapagain'],
  // ToLaD#241: a species' pill tapped from home (its branch framed, its card open); then deep in the least weasel's past,
  // a double-tap at a time one step back: its frame, its clades', home. (`backtap`: a double-tap on nothing, the fan as it is.)
  ['back-pill', 'tappill'],
  ['back-0', 'frame', ['Least weasel', 1.5e6, 20]],
  ['back-1', 'backtap'],
  ['back-2', 'backtap'],
  ['back-3', 'backtap'],
  ['back-4', 'backtap'],
  ['back-5', 'backtap'],
  // ToLaD#258: home; a tap on a column of the dogs (their widest), one level deeper; a second, one more; then a
  // double-tap, one level out. (`taps` [species or group, letters]: from home, t a tap on its column, d a double-tap.)
  ['tap-0', 'home'],
  ['tap-1', 'taps', ['Canidae', 't']],
  ['tap-2', 'taps', ['Canidae', 'tt']],
  ['tap-3', 'taps', ['Canidae', 'ttd']],
  // ToLaD#262: names beside the branches, pictures over "now" above each group's centre: home, one and two taps down
  // the dogs (carnivores) or Panthera (LEVEL=cats: Big cats, then the genus), and a crowded level (the weasels' family).
  ['pics-0', 'home'],
  ['pics-1', 'taps', [process.env.LEVEL === 'cats' ? 'Panthera' : 'Canidae', 't']],
  ['pics-2', 'taps', [process.env.LEVEL === 'cats' ? 'Panthera' : 'Canidae', 'tt']],
  ['pics-weasels', 'taps', ['Mustelidae', 'tt']],
  // ToLaD#266: tapped on down to a species (the dogs': Dog-like, Dogs, the species), its card open as the flight lands.
  ['land-card', 'taps', [process.env.LEVEL === 'cats' ? 'Panthera' : 'Canidae', 'ttt']],
  // ToLaD#274: each level's frame keeps "now" near the top and its groups' pictures on screen: from home a tap at a time
  // down the dogs (carnivores: Dog-like, Dogs, a species; LEVEL=cats: Big cats, Panthera, a species; LEVEL=mammals:
  // Primates, then on); `frame-plus`: home's biggest "+x" tapped, every group it stood for named and pictured.
  ['frame-1', 'taps', [process.env.LEVEL === 'cats' ? 'Panthera' : process.env.LEVEL === 'mammals' ? 'Primates' : 'Canidae', 't']],
  ['frame-2', 'taps', [process.env.LEVEL === 'cats' ? 'Panthera' : process.env.LEVEL === 'mammals' ? 'Primates' : 'Canidae', 'tt']],
  ['frame-3', 'taps', [process.env.LEVEL === 'cats' ? 'Panthera' : process.env.LEVEL === 'mammals' ? 'Primates' : 'Canidae', 'ttt']],
  ['frame-plus', 'tapplus'],
  // ToLaD#246: a flight from home into the fisher's frame, and from there back home, caught every 360 ms (1.8 s each).
  ...[0, 360, 720, 1080, 1440, 1800].map((ms) => [`fly-in-${ms}`, 'flyin', ['Fisher', ms]]),
  ...[0, 360, 720, 1080, 1440, 1800].map((ms) => [`fly-out-${ms}`, 'flyout', ['Fisher', ms]]),
  // The groups the view is inside pinned at the top (ToLaD#233): home (nothing pinned, the stack itself), deep in a
  // bear's and a weasel's past ("now" far off the top), and (LEVEL=cats) the lion's past inside Panthera.
  ['pin-home', 'home'],
  ['pin-bear', 'frame', ['Brown bear', 4e5, 40]],
  ['pin-weasel', 'frame', ['Least weasel', 1.5e6, 20]],
  ['pin-lion', 'frame', ['Lion', 1.5e6, 8]],
  // The bears' and the weasels' family framed (their level), scrolled into its past; (LEVEL=cats) Panthera's.
  ['pin-ursidae', 'level', ['Ursidae', 3, 2.5]],
  ['pin-mustelidae', 'level', ['Mustelidae', 4, 2.5]],
  ['pin-panthera', 'level', ['Panthera', 2, 2.5]],
  // A slow pan from home into the past: the stack sticks under the buttons, then hands over to the pinned rows.
  ['pin-pan0', 'pan', [2, 0]],
  ['pin-pan1', 'pan', [2, 60]],
  ['pin-pan2', 'pan', [2, 100]],
  ['pin-pan3', 'pan', [2, 130]],
  ['pin-pan4', 'pan', [2, 220]],
];
const browser = await chromium.launch({ headless: true });
let served = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DSF || 2), isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  if (process.env.LOGS) page.on('console', (m) => console.log('  [page]', m.text()));
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  const q = [process.env.DEBUG ? 'debug' : '', process.env.EDGE ? `edge=${process.env.EDGE}` : '', process.env.LEVEL ? `level=${process.env.LEVEL}` : '', process.env.Q || ''].filter(Boolean).join('&');
  served = await pageUrl(q);
  await page.goto(served.url);
  await page.waitForFunction(() => !!window.__fan, null, { timeout: Number(process.env.LOAD_MS || 20000) });
  for (const [name, kind, args] of scenes) {
    if (ONLY && !ONLY.has(name)) continue;
    // A search left open by the last scene closed.
    if (await page.$('.search-x')) await page.click('.search-x');
    await page.evaluate(
      ([kind, args, width]) => {
        const f = window.__fan;
        // (A tap again on a pill keeps the fan as it is: setMode lays it out anew, a new fan the last flight is not in.)
        if (kind !== 'tapagain' && kind !== 'backtap' && kind !== 'dblempty') {
          f.setMode(width);
          f.tap(-1e6, -1e6);
        }
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
        } else if (kind === 'group') {
          // (zx: the width zoom fixed at zx × home's, the group centred: ToLaD#232's before/after at one camera.)
          const [re, fill, ma, tz, zx] = args;
          const r = new RegExp(re);
          const g = fan.branches.filter((b) => r.test(b.sp.sci));
          const h = f.homeCamera();
          const y = fan.time.y(ma);
          const fd = fan.tess.fold;
          let sx = h.sx;
          let cx = h.cx;
          const span = () => {
            const at = (b) => fd?.left(b.index, y) ?? f.model(b).lanes(y).left;
            const lo = Math.min(...g.map(at));
            const hi = Math.max(...g.map((b) => at(b) + f.model(b).lanes(y).w));
            return [lo, hi];
          };
          for (let k = 0; k < 8; k++) {
            fd?.setScale(sx, f.w);
            const [lo, hi] = span();
            cx = (lo + hi) / 2;
            sx = zx ? h.sx * zx : (fill * f.w) / Math.max(hi - lo, 1e-9);
          }
          fd?.setScale(sx, f.w);
          f.cam = { cx, cy: y, sx, sy: h.sy * tz, ty: h.sy * tz };
          f.camera.settle();
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
        } else if (kind === 'flyin' || kind === 'flyout') {
          // A flight caught args[1] ms in (ToLaD#246), run a frame each 16 ms as the app runs it: `flyin` from home into
          // species args[0]'s frame, `flyout` from that frame back home (the reset).
          const b = fan.branches.find((x) => x.sp.common === args[0]);
          f.cam = f.homeCamera();
          f.camera.settle();
          if (kind === 'flyout') {
            f.cam = f.speciesCamera(b);
            f.camera.settle();
          }
          const t0 = performance.now();
          if (kind === 'flyin') f.flyToSpecies(b.sp, false);
          else f.resetView();
          // (The last, 1.8 s on: to the landing.)
          for (let t = t0 + 16; f.anim && (t <= t0 + args[1] || (args[1] >= 1800 && t < t0 + 5000)); t += 16) if (!f.anim(t)) f.anim = null;
          f.anim = null;
          f.labelState.clear();
          f.draw();
        } else if (kind === 'tapplus') {
          f.cam = f.homeCamera();
          f.camera.settle();
          f.draw();
          f.draw();
          const hit = [...f.plusHits].sort((p, q) => q.bs.length - p.bs.length)[0];
          if (hit) f.tap((hit.box[0] + hit.box[2]) / 2, (hit.box[1] + hit.box[3]) / 2);
        } else if (kind === 'tappill' || kind === 'tapagain') {
          if (kind === 'tappill') {
            f.cam = f.homeCamera();
            f.camera.settle();
            f.draw();
            f.draw();
            window.__pill = (args[0] ? f.nameHits.find((h) => h.b.sp.common === args[0]) : f.nameHits[0])?.b.sp.common;
          }
          // (The landing taken at once and drawn settled, labels faded in: headless frames are slow, seconds apart.)
          f.labelState.clear();
          f.draw();
          const hit = f.nameHits.find((h) => h.b.sp.common === window.__pill);
          if (hit) f.tap((hit.box[0] + hit.box[2]) / 2, hit.box[3] - 10);
          if (f.anim && !f.anim(performance.now() + 1e5)) f.anim = null;
          f.labelState.clear();
          f.draw();
        } else if (kind === 'backtap' || kind === 'dblempty' || kind === 'dblfar') {
          // (ToLaD#245: a double-tap on a branch goes into it, so `backtap` taps on nothing: an empty spot, or off the
          // screen if there is none.)
          f.labelState.clear();
          f.draw();
          let at = null;
          if (kind === 'dblfar') {
            f.cam = f.homeCamera();
            f.camera.settle();
            f.draw();
            f.draw();
            // A species' own column (above its split) as far from the centre as there is one, a column tap there.
            let best = -1;
            for (let y = 200; y < f.h - 200; y += 12)
              for (let x = 14; x < f.w - 14; x += 4) {
                const b = f.hitBranch(x, y);
                if (!b || f.toWorld(x, y)[1] >= b.splitY || f.tapKind(x, y) !== 'card' || f.hitBranch(x - 4, y) !== b || f.hitBranch(x + 4, y) !== b) continue;
                const d = Math.abs(x - f.w / 2);
                if (d > best) [best, at] = [d, [x, y, b.sp.common]];
              }
          } else {
            for (let y = 130; !at && y < f.h - 160; y += 9) for (let x = 14; !at && x < f.w - 14; x += 7) if (!f.tapKind(x, y)) at = [x, y, 'nothing'];
          }
          at ??= [-1e4, -1e4, 'nothing (off screen)'];
          console.log(`double-tap at ${at[0].toFixed(0)},${at[1].toFixed(0)} on ${at[2]}`);
          f.doubleTap(at[0], at[1]);
          if (f.anim && !f.anim(performance.now() + 1e5)) f.anim = null;
          f.labelState.clear();
          f.draw();
        } else if (kind === 'taps') {
          // ToLaD#258: from home, a tap ('t') on the column of args[0] (a species, or a group by its name: its widest
          // species), or a double-tap ('d') on nothing, for each letter of args[1]; each flight landed.
          f.cam = f.homeCamera();
          f.camera.settle();
          f.draw();
          const named = (v) => v.split && ((v.split.taxon ?? '').replace(/\s*\(.*\)\s*$/, '') === args[0] || v.name === args[0]);
          const g = fan.nodes.find(named);
          const b = fan.branches.find((q) => q.sp.common === args[0] || q.sp.sci === args[0]) ?? (g ? [...g.strands].sort((p, q) => q.width - p.width)[0] : null);
          for (const c of args[1] ?? 't') {
            if (c === 't' && b) {
              // A point on its column between its tip and its split, off the pills and pictures.
              const ty = f.toScreen(0, b.tipY)[1];
              const sy = f.toScreen(0, b.splitY)[1];
              let p = null;
              for (let y = Math.max(140, ty + 10); !p && y < Math.min(f.h - 160, sy - 4); y += 6)
                for (let x = 4; !p && x < f.w - 4; x += 2) if (f.hitBranch(x, y) === b && !f.pillAt(x, y) && !f.picAt(x, y)) p = [x, y];
              console.log(`t: ${b.sp.common} at ${p}`);
              if (p) f.tap(p[0], p[1]);
            } else f.doubleTap(-1e4, -1e4);
            for (let t = performance.now() + 16; f.anim; t += 16) {
              if (!f.anim(t)) f.anim = null;
              f.applyFold();
            }
            f.labelState.clear();
            f.draw();
            console.log(`${c}: at ${(() => { const l = f.levelNow(); return l.b ? l.b.sp.common : l.v.name; })()}`);
          }
          f.labelState.clear();
          f.draw();
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
        // args[2]: that many double taps after it, each flight landed (ToLaD#271).
        for (let k = 0; k < (args[2] ?? 0); k++) {
          await page.waitForTimeout(800);
          await page.evaluate(() => window.__fan.doubleTap(-1e4, -1e4));
          await page.waitForTimeout(2400);
        }
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
    // EVAL=file.js: that file's text evaluated in the page before the shot (a probe), its value printed.
    if (process.env.EVAL) console.log(JSON.stringify(await page.evaluate(readFileSync(process.env.EVAL, 'utf8'))));
    await page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png`, clip, timeout: Number(process.env.LOAD_MS || 30000) });
    console.log('shot', name);
  }
} finally {
  served?.close();
  await browser.close();
}
