// Scratch (turtle591): screenshots of levels / species frames on the amniotes page. node scripts/zzshot.mjs <out-dir> name:Level[:sx-mult] ...
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pageUrl } from './pageurl.mjs';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
process.env.HTTP = '1';
const served = await pageUrl('', process.env.DIR || 'dist-single');
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(served.url.replace(/\/\?$|\/$/, '/') + `?level=mammals&tree=amniotes${process.env.Q ? '&' + process.env.Q : ''}`);
  await page.waitForFunction(() => window.__fan && window.__fan.frameMs.length > 1, null, { timeout: 120000 });
  for (const arg of process.argv.slice(3)) {
    const [name, lv, mult, sp] = arg.split(':');
    const r = await page.evaluate(([lv, mult, sp]) => {
      const f = window.__fan;
      f.anim = null;
      if (sp) {
        const b = f.fan.branches.find((x) => x.sp.sci === sp);
        f.cam = f.speciesCamera(b);
      } else f.cam = lv === 'home' ? f.homeCamera() : f.levelCamera(lv);
      if (mult) f.cam = { ...f.cam, sx: f.cam.sx * Number(mult) };
      f.request();
      return { sx: f.cam.sx, sy: f.cam.sy };
    }, [lv, mult, sp]);
    await sleep(2500);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(name, JSON.stringify(r));
  }
} finally {
  await browser.close();
  served.close();
}
