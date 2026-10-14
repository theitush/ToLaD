// ToLaD#255 (lab255): at rest after motion, the labels and brackets with carry (default) and without
// (?carry=0, a layout every frame, as main): a drag there and back, then a flight to the scene's level, then still.
//   node scripts/lab255shot.mjs <out-dir>   (ONLY=carn-home,mamm-home: those scenes; REPS=n: each n times, hashes printed)
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pageUrl } from './pageurl.mjs';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const REPS = Number(process.env.REPS || 1);
const SCENES = [
  ['carn-home', 'carnivores', null],
  ['carn-doglike', 'carnivores', 'Caniformia'],
  ['mamm-home', 'mammals', null],
  ['mamm-primates', 'mammals', 'Primates'],
];
process.env.HTTP = '1';
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, level, taxon] of SCENES) {
    if (ONLY && !ONLY.includes(name)) continue;
    for (let rep = 0; rep < REPS; rep++) {
    const hashes = [];
    for (const carry of ['1', '0']) {
      const served = await pageUrl(`level=${level}&carry=${carry}`);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log('pageerror', String(e)));
      await page.goto(served.url);
      await page.waitForFunction(() => !!window.__fan, null, { timeout: 120000 });
      await page.waitForTimeout(1500);
      const n = await page.evaluate(async (taxon) => {
        const f = window.__fan;
        f.gestureStart();
        for (let k = 0; k < 12; k++) {
          f.pan(k < 6 ? 9 : -9, k < 6 ? 14 : -14);
          f.draw();
        }
        f.gestureEnd();
        f.draw();
        f.flyTo(() => (taxon ? f.levelCamera(taxon) : f.homeCamera()));
        while (f.anim) await new Promise((r) => setTimeout(r, 50));
        return f.labelMs.length;
      }, taxon);
      await page.waitForTimeout(1500);
      const png = await page.screenshot();
      const h = createHash('md5').update(png).digest('hex').slice(0, 12);
      hashes.push(h);
      writeFileSync(`${out}/${name}-carry${carry}${rep ? `-${rep}` : ''}.png`, png);
      console.log(`${name} carry=${carry} ${h} (${n} label frames)`);
      await ctx.close();
      served.close();
    }
    console.log(`${name}: ${hashes[0] === hashes[1] ? 'IDENTICAL' : 'DIFFERENT'}`);
    }
  }
} finally {
  await browser.close();
}
