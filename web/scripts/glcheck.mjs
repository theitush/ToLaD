// GPU vs CPU: the real mesh shader (meshgl.ts) decides, for thousands of
// sampled lion individuals, who is alive, who carries the living's line and who
// was born by a given time; the CPU mirror (mesh.ts lifeGPU / colourCode)
// decides the same from the same hashed inputs. Every pixel must agree.
//   npm run build:single && node scripts/glcheck.mjs
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let bad = 0;
try {
  const page = await (await browser.newContext({ viewport: { width: 400, height: 400 } })).newPage();
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href);
  await page.waitForFunction(() => !!window.__fan && !!window.__fanMesh && !!window.__fan.gl);
  const r = await page.evaluate(() => {
    const f = window.__fan;
    const M = window.__fanMesh;
    const gl = f.gl;
    const b = f.fan.branches.find((b) => b.sp.common === 'Lion');
    const m = f.model(b);
    const N = 64;
    const pal = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
    ];
    const results = { checked: 0, mismatches: [], counts: [0, 0, 0, 0, 0] };
    // The first pass after the canvas is resized is a warm-up (SwiftShader drops a few of its pixels).
    let warm = true;
    for (const lane of [1, 1, 0, 2]) {
      for (const g of [3, 5000, m.G - 30, m.G - 4, m.G - 1]) {
        const n = m.size(g);
        // nowRel inside the generation for the last ones (some alive, some not yet born), the real "now" otherwise.
        const nowRel = g >= m.G - 4 ? m.GL * 0.7 + 2 : m.sp.now - g * m.GL;
        gl.begin();
        const cells = [];
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            const i = Math.floor((((y * N + x) * 2654435761) % 4294967296) / 4294967296 * n);
            const inst = {
              x0: x + 1, y0: y + 1, x1: x + 2, y1: y + 2, slotX0: x + 1.5, slotDx: 1000, lw: 4, fineA: 1, p0: 0, T0: 0, A: 1, gBoff: 0,
              alpha: 1, mode: 0, lane, tipR: 0, GL: m.GL, Lm: m.sp.lifespanYears, nowRel,
              iBase: i, iStep: 1, nA: n, nB: 0, seedA: m.seedOf(g), seedB: 0, thrA: M.lineageThreshold(m.G, g, false), thrB: 0,
            };
            M.packInst(inst, gl.mesh.f, gl.mesh.u, gl.mesh.next());
            cells.push(inst);
          }
        }
        gl.end(N + 2, N + 2, 1, [0, 0, 0], 1e-3, -1e9, pal);
        const S = N + 2; // a pixel of margin all round
        const px = new Uint8Array(S * S * 4);
        gl.gl.readPixels(0, 0, S, S, gl.gl.RGBA, gl.gl.UNSIGNED_BYTE, px);
        if (warm) {
          warm = false;
          continue;
        }
        cells.forEach((c, k) => {
          const x = k % N;
          const y = Math.floor(k / N);
          const o = ((S - 2 - y) * S + x + 1) * 4;
          const [R, G, B, A] = px.slice(o, o + 4);
          // Premultiplied: divide by alpha to read the colour.
          const [r, g2, b2] = [R / Math.max(1, A), G / Math.max(1, A), B / Math.max(1, A)];
          const gpu = A < 2 ? -1 : r > 0.5 && g2 > 0.5 ? 3 : r > 0.5 ? 0 : g2 > 0.5 ? 1 : b2 > 0.5 ? 2 : -2;
          const L = M.lifeGPU(c.seedA, c.iBase, c.GL, c.Lm, c.nowRel, c.thrA);
          const code = M.colourCode(lane, L.alive, L.lineage);
          // Lit only if born by "now" (it covers some of the band).
          const cpu = code >= 0 && L.birth < c.nowRel ? code : -1;
          // Too faint to read back in 8 bits (a life a tiny share of the generation): not a decision.
          const cov = Math.min(1, Math.max(0, Math.min(L.birth + L.life, c.nowRel) - L.birth) / c.GL);
          if (cpu >= 0 && cov * 255 < 4) return;
          results.checked++;
          results.counts[cpu + 1]++;
          if (gpu !== cpu && results.mismatches.length < 10) results.mismatches.push({ lane, g, i: c.iBase, gpu, cpu, px: [R, G, B, A] });
          if (gpu !== cpu) results.bad = (results.bad || 0) + 1;
        });
      }
    }
    f.request();
    return results;
  });
  bad = r.bad || 0;
  console.log(`checked ${r.checked} individuals on the GPU: ${bad} disagree with the CPU mirror`);
  console.log(`  (none / alive / lineage / ended / withered: ${r.counts.join(' / ')})`);
  for (const mm of r.mismatches) console.log('  mismatch', JSON.stringify(mm));
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
