// A count nobody has drawn as one thin dashed line (ToLaD#565), default headless (no GPU flags), from the page as pages.yml
// stages it (served over http), at 390×844: each scene drawn dashed (the page) and faint (the old look, the bar's
// "unknown counts" chip picked), and the two side by side. The amniotes: home, the lizards and snakes framed (merged clades
// with no count in them), a lone lizard, a fossil dinosaur; the mammals: a #507 species (Data Deficient, never counted).
//   npm run build:single && node scripts/dashedshot.mjs <out-dir> [dist-dir] [only,scenes]
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const OUT = process.argv[2] || 'perf-out/dashed';
const DIST = process.argv[3] || 'dist-single';
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
mkdirSync(OUT, { recursive: true });

// [name, tree, kind, arg]: 'home' | 'clade' [taxon] | 'species' [sci]
const SCENES = [
  ['amniotes-home', 'amniotes', 'home'],
  ['squamates', 'amniotes', 'clade', 'Squamata'],
  ['lizards', 'amniotes', 'clade', 'Lacertidae'],
  ['lizard', 'amniotes', 'species', 'Lacerta agilis'],
  ['dinosaur', 'amniotes', 'species', 'Tyrannosaurus rex'],
  ['mammal-507', 'mammals', 'species', 'Gerbillus agag'],
].filter((s) => !ONLY || ONLY.has(s[0]));

const still = (page) =>
  page.waitForFunction(() => !window.__fan.anim && !window.__fan.gesturing, null, { timeout: 120_000 }).then(() => page.waitForTimeout(1500));

/** Pick a choice on the bar's chip `name` (ChoiceChip): its menu opened, the item whose label starts with `label` tapped. */
async function pick(page, name, label) {
  await page.locator('.chip > button', { hasText: `${name}:` }).click();
  await page.locator('.chip-menu [role="menuitemradio"]', { hasText: label }).click();
  await page.waitForTimeout(400);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const tree of ['amniotes', 'mammals']) {
    const scenes = SCENES.filter((s) => s[1] === tree);
    if (!scenes.length) continue;
    const served = await pageUrl(tree === 'amniotes' ? 'tree=amniotes' : '', DIST);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', String(e)));
    page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
    await page.goto(served.url);
    await page.waitForFunction(() => (window.__fan?.fan.branches.length ?? 0) > 3000, null, { timeout: 600_000 });
    await still(page);
    console.log(`${tree}: gl ${await page.evaluate(() => !!window.__fan.gl)}`);
    for (const [name, , kind, arg] of scenes) {
      const said = await page.evaluate(
        ([kind, arg]) => {
          const f = window.__fan;
          if (kind === 'home') {
            f.flyTo(() => f.homeCamera());
            return 'home';
          }
          if (kind === 'clade') {
            const v = f.fan.nodes.find((u) => u.split.taxon === arg);
            if (!v) return `${arg}: no such clade`;
            f.flyToClade(v);
            return `${arg}: ${v.strands.length} species, ${v.strands.filter((b) => b.sp.countUnknown).length} with no count`;
          }
          const b = f.fan.branches.find((x) => x.sp.sci === arg);
          if (!b) return `${arg}: not on the tree`;
          f.flyToSpecies(b.sp, false);
          return `${arg}: count ${b.sp.countUnknown ? 'unknown' : Math.round(b.sp.alive)}${b.sp.extinct ? ', extinct' : ''}`;
        },
        [kind, arg ?? ''],
      );
      await still(page);
      const counts = await page.evaluate(() => {
        const S = window.__fan.gl?.segs;
        if (!S) return 'no gl';
        let d = 0;
        for (let j = 0; j < S.n; j++) if (S.f[16 * j + 15] > 0.5) d++;
        return `${S.n} chords, ${d} dashed`;
      });
      console.log(`${name}: ${said}; ${counts}`);
      await page.screenshot({ path: join(OUT, `${name}-dashed.png`) });
      await pick(page, 'unknown counts', 'faint');
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT, `${name}-faint.png`) });
      await pick(page, 'unknown counts', 'dashed');
      await page.waitForTimeout(400);
    }
    await ctx.close();
    served.close();
  }
  // Side by side: dashed (the page) on the left, faint (the old look) on the right.
  const ctx = await browser.newContext({ viewport: { width: 800, height: 880 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [name] of SCENES) {
    const src = (k) => `data:image/png;base64,${readFileSync(join(OUT, `${name}-${k}.png`)).toString('base64')}`;
    await page.setContent(
      `<body style="margin:0;background:#222;color:#ddd;font:14px sans-serif;display:flex;gap:20px">` +
        ['dashed', 'faint'].map((k) => `<div><div style="height:30px;line-height:30px;padding-left:6px">${name}: ${k === 'dashed' ? 'dashed (the page)' : 'faint (the old look)'}</div><img src="${src(k)}" width="390" height="844"></div>`).join('') +
        `</body>`,
    );
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, `${name}.png`), clip: { x: 0, y: 0, width: 800, height: 874 } });
  }
  await ctx.close();
} finally {
  await browser.close();
}
