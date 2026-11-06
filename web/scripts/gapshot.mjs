// The `gaps:` button keeps the view where it is (ToLaD#412): at the mammals, real button presses at home, on Carnivora's
// frame and on a free zoom, a shot and the view's state before and after each; then a double tap, home and the level
// button, which still go where they went.
//   npm run build:single && LEVEL=mammals node scripts/gapshot.mjs <dir for the shots>   (default headless, no GPU flags)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';

const dir = process.argv[2] ?? 'gapshot';
mkdirSync(dir, { recursive: true });
const { url, close } = await pageUrl('level=mammals&gaps=groups');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__fan, null, { timeout: 180_000 });

const state = () =>
  page.evaluate(() => {
    const v = window.__fan;
    const f = v.fan.tess.fold;
    f.setScale(v.cam.sx, v.w);
    const { C } = f.rooms();
    const on = [];
    for (let i = 0; i < C.length; i++) {
      const x = v.toScreen(C[i], 0)[0];
      if (x >= 0 && x <= v.w) on.push(i);
    }
    const lv = v.levelNow(true);
    const name = (i) => v.fan.root.strands[i]?.sp.sci;
    return `${f.gaps}: level ${lv.v ? lv.v.name : lv.b.sp.sci}, strands ${on[0]} (${name(on[0])}) .. ${on[on.length - 1]} (${name(on[on.length - 1])}), ${on.length} on screen; sx ${v.cam.sx.toPrecision(5)} sy ${v.cam.sy.toPrecision(7)} cy ${v.cam.cy.toPrecision(7)}`;
  });
const still = () =>
  page.waitForFunction(() => !window.__fan.anim && !window.__fan.gesturing, null, { timeout: 60_000 }).then(() => page.waitForTimeout(600));
let shot = 0;
const look = async (what) => {
  const file = `${String(++shot).padStart(2, '0')}-${what}.png`;
  console.log(`${file}\n  ${await state()}`);
  await page.screenshot({ path: join(dir, file) });
};
const press = async (what) => {
  await page.evaluate(() => (window.__was = window.__fan));
  const t = Date.now();
  await page.getByRole('button', { name: /^gaps:/ }).click();
  await page.waitForFunction(() => window.__fan && window.__fan !== window.__was, null, { timeout: 120_000 });
  console.log(`  (new view in ${Date.now() - t} ms)`);
  await page.waitForTimeout(600);
  await look(what);
};

await still();
await look('home-groups');
await press('home-clades');

await page.evaluate(() => {
  const v = window.__fan;
  v.flyToClade(v.fan.nodes.find((n) => n.split.taxon === 'Carnivora'));
});
await still();
await look('carnivora-clades');
await press('carnivora-age');
await press('carnivora-even');
await press('carnivora-groups');

// A double tap there: up a level, the switch having left no taps to go back by.
await page.evaluate(() => window.__fan.doubleTap(-1e4, -1e4));
await still();
await look('carnivora-groups-doubletap');

// A free zoom: real wheel events about a point on the screen, then a pan of what stands there.
await page.mouse.move(250, 500);
for (let k = 0; k < 14; k++) {
  await page.mouse.wheel(0, -60);
  await page.waitForTimeout(30);
}
await still();
await look('free-groups');
await press('free-clades');
await press('free-age');
await press('free-even');
await press('free-groups');

await page.getByRole('button', { name: 'All mammals' }).click();
await still();
await look('home-button');
await page.getByRole('button', { name: /^level:/ }).click();
await page.waitForTimeout(3000);
await still();
await look('level-button');

await browser.close();
close();
