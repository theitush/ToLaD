// GPU vs CPU: the real mesh shader (meshgl.ts) decides, for thousands of
// sampled lion individuals, who is alive, which colour its lane gives it and who
// was born by a given time; the CPU mirror (mesh.ts lifeGPU / colourCode)
// decides the same from the same hashed inputs. Every pixel must agree.
//   npm run build:single && node scripts/glcheck.mjs
//   (EDGE=curved|straight: the fan's edges, ?edge=; default the app's)
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

// Default headless (its software GL renders WebGL2): no GPU flags.
const browser = await chromium.launch({ headless: true });
let bad = 0;
try {
  const page = await (await browser.newContext({ viewport: { width: 400, height: 400 } })).newPage();
  await page.goto(pathToFileURL(resolve('dist-single/index.html')).href + (process.env.EDGE ? `?edge=${process.env.EDGE}` : ''));
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
    ];
    const results = { checked: 0, mismatches: [], counts: [0, 0, 0, 0] };
    // The first pass after the canvas is resized is a warm-up (SwiftShader drops a few of its pixels).
    let warm = true;
    for (const lane of [1, 1, 0]) {
      for (const g of [3, 5000, m.G - 30, m.G - 4, m.G - 1]) {
        const n = m.size(g);
        // nowRel inside the generation for the last ones (some alive, some not yet born), the real "now" otherwise.
        const nowRel = g >= m.G - 4 ? m.GL * 0.7 + 2 : m.sp.now - g * m.GL;
        gl.begin();
        const cells = [];
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            const i = Math.floor((((y * N + x) * 2654435761) % 4294967296) / 4294967296 * n);
            // The green lane: the lanes' boundary far right of the slot (the right-hand lane is then never drawn).
            const inst = {
              // One slot (lattice level 0, slot i: index i of the generation), its line through the pixel's centre.
              x0: x + 1, y0: y + 1, x1: x + 2, y1: y + 2, xB0: x + 1.5 - 500, bw: 1000, lw: 4, fineA: 1, p0: 0, T0: 0, A: 1, gBoff: 0,
              alpha: 1, mode: 0, lane: lane === 0 ? 1 : lane, tipR: 0, GL: m.GL, Lm: m.sp.lifespanYears, nowRel, xG: lane === 0 ? 1e9 : -1e9,
              B0: i, lvl: 0, latSeed: 0, nA: n, nB: 0, seedA: m.seedOf(g), seedB: 0, sA: n, sB: 1, fA: 1, fB: 1,
            };
            const k = gl.mesh.next();
            M.packInst(inst, gl.mesh.f, gl.mesh.u, k);
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
          const gpu = A < 2 ? -1 : r > 0.5 ? 0 : g2 > 0.5 ? 1 : b2 > 0.5 ? 2 : -2;
          const L = M.lifeGPU(c.seedA, c.B0, c.GL, c.Lm, c.nowRel);
          const code = M.colourCode(lane, L.alive);
          // Lit only if born by "now" (it covers some of the band).
          const cpu = code >= 0 && L.birth < c.nowRel ? code : -1;
          // Too faint to read back in 8 bits (a life a tiny share of the generation): not a decision.
          const cov = Math.min(1, Math.max(0, Math.min(L.birth + L.life, c.nowRel) - L.birth) / c.GL);
          if (cpu >= 0 && cov * 255 < 4) return;
          results.checked++;
          results.counts[cpu + 1]++;
          if (gpu !== cpu && results.mismatches.length < 10) results.mismatches.push({ lane, g, i: c.B0, gpu, cpu, px: [R, G, B, A] });
          if (gpu !== cpu) results.bad = (results.bad || 0) + 1;
        });
      }
    }
    // The nested lattice of lines (mesh.ts latticeRep) at several levels, and a generation folded
    // onto its slots (fold > 1): coverage per pixel, GPU against the CPU mirror (shadeMesh).
    {
      const S = 128;
      gl.begin();
      const insts = [];
      const bands = [
        [0, 1, 1, 0.5],
        [3, 1, 1, 0.3],
        [10, 0, 1, 0.7],
        [20, 1, 1, 1],
        [2, 0, 3, 1],
        [0, 0, 3, 1],
        // Far out (beyond the lattice's walk depth), and lanes too narrow for lines (one line their width).
        [34, 1, 1, 0.8],
        [30, 0, 1, 1, 'narrow'],
      ];
      bands.forEach(([lvl, gray, fold, fineA, narrow], q) => {
        const g = fold > 1 ? m.G - 1 : m.G - 400 + q * 37;
        const n = m.size(g);
        const nowRel = fold > 1 ? m.GL * 0.9 : m.sp.now - g * m.GL;
        const bw = lvl === 0 ? 3.3 : 4.7;
        const B0 = Math.floor((3e6 + q * 123457) / 2 ** lvl);
        const h = S / bands.length;
        const inst = {
          x0: 0, y0: q * h, x1: S, y1: (q + 1) * h, xB0: -bw * 1.3, bw, lw: 0.9, fineA, p0: 0, T0: 0, A: 1, gBoff: 0,
          alpha: 0.9, mode: 0, lane: 1, tipR: 0, GL: m.GL, Lm: m.sp.lifespanYears, nowRel, xG: gray ? -1e9 : 1e9,
          B0, lvl, latSeed: m.latticeSeed, nA: n, nB: 0, seedA: m.seedOf(g), seedB: 0, sA: fold > 1 ? Math.floor(n / 4) : n, sB: 1, fA: fold, fB: 1,
        };
        // A narrow green lane (1.3 px) beside a narrow gray one (2.6 px), each one line its own width.
        if (narrow) Object.assign(inst, { xB0: 40.2, xG: 41.5, colL: 40.2, colR: 44.1, narG: 1, narR: 0.7, B0: 0 });
        // Leaning, widening columns (the shear, mesh.ts meshFrame): the lattice mapped through a moving left
        // edge, a changing pitch, a moving right edge and green lane (a straight lean, a curve's chord).
        if (q === 1) Object.assign(inst, { sL: 0.45, sP: 0.004, colL: -bw * 1.3, colR: 90, sR: 0.15, xG: 50, sG: 0.6 });
        if (q === 3) Object.assign(inst, { sL: -0.8, sP: -0.006, colL: -bw * 1.3, colR: 110, sR: -0.3, xG: 30, sG: -0.9 });
        insts.push(inst);
        const k = gl.mesh.next();
        M.packInst(inst, gl.mesh.f, gl.mesh.u, k);
      });
      gl.end(S, S, 1, [0, 0, 0], 1e-3, -1e9, pal);
      const px = new Uint8Array(S * S * 4);
      gl.gl.readPixels(0, 0, S, S, gl.gl.RGBA, gl.gl.UNSIGNED_BYTE, px);
      results.lattice = { checked: 0, lit: 0, bad: 0, worst: 0 };
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          let a = 0;
          for (const t of insts) a = Math.max(a, M.shadeMesh(t, x + 0.5, y + 0.5, 1e-3, -1e9, pal)[3]);
          const A = px[((S - 1 - y) * S + x) * 4 + 3] / 255;
          const e = Math.abs(A - a);
          results.lattice.checked++;
          if (a > 0.05) results.lattice.lit++;
          results.lattice.worst = Math.max(results.lattice.worst, e);
          if (e > 0.06) results.lattice.bad++;
        }
      }
    }
    // The cross-links (mesh.ts shadeLinks): texture bands (a band's representative generation)
    // and lives (each generation's own), at several lattice and time levels, GPU against the CPU mirror.
    {
      const S = 160;
      const insts = [];
      // [lvl, lambda, tauB, tauC, mode]
      const cases = [
        [3, 3.4, 7, 6.6, 0],
        [0, -0.5, 0, -1, 0],
        [12, 12.9, 3, 2.2, 0],
        [1, 1.2, 0, 0.7, 1],
        [0, -0.8, 0, -0.5, 1],
      ];
      const h = S / cases.length;
      // Years per px (linear here: A large), so that 2^tauC generations are ~6 px.
      cases.forEach(([lvl, lam, tauB, tauC, mode], q) => {
        const g0 = m.G - 900 + q * 61;
        const t = 2 ** tauB;
        const gA = Math.floor(g0 / t) * t;
        const n = m.size(gA);
        const ypp = (2 ** tauC * m.GL) / 6;
        const inst = {
          x0: 0, y0: q * h, x1: S, y1: (q + 1) * h, xB0: -7.3, bw: lvl === 0 ? 6.1 : 5.3, lw: mode ? 1.6 : 0.9, fineA: 1, p0: q * h, T0: h * ypp * 0.9, A: 1e9, gBoff: 0,
          alpha: 0.95, mode, lane: 1, tipR: 1, GL: m.GL, Lm: m.sp.lifespanYears, nowRel: m.sp.now - gA * m.GL, xG: 70.5,
          B0: Math.floor((2e5 + q * 7777) / 2 ** lvl), lvl, latSeed: m.latticeSeed, nA: n, nB: 0, seedA: m.seedOf(gA), seedB: 0, sA: n, sB: 1, fA: 1, fB: 1,
          colL: 0, colR: S, linkA: 1, lam, tauC, tauB, gA,
        };
        inst.kLog = ypp / (1e9 * Math.LN2);
        insts.push(inst);
      });
      // One kLog per draw: each case drawn alone.
      results.links = { checked: 0, lit: 0, bad: 0, worst: 0 };
      // (A warm-up draw at the new canvas size.)
      gl.begin();
      M.packInst(insts[0], gl.mesh.f, gl.mesh.u, gl.mesh.next());
      gl.end(S, S, 1, [0, 0, 0], insts[0].kLog, -1e9, pal);
      for (const inst of insts) {
        gl.begin();
        M.packInst(inst, gl.mesh.f, gl.mesh.u, gl.mesh.next());
        gl.end(S, S, 1, [0, 0, 0], inst.kLog, -1e9, pal);
        const px = new Uint8Array(S * S * 4);
        gl.gl.readPixels(0, 0, S, S, gl.gl.RGBA, gl.gl.UNSIGNED_BYTE, px);
        for (let y = Math.ceil(inst.y0); y < inst.y1; y++) {
          for (let x = 0; x < S; x++) {
            const a = M.shadeLinks(inst, x + 0.5, y + 0.5, inst.kLog, pal)[3];
            const full = M.shadeMesh(inst, x + 0.5, y + 0.5, inst.kLog, -1e9, pal)[3];
            const A = px[((S - 1 - y) * S + x) * 4 + 3] / 255;
            const e = Math.abs(A - full);
            results.links.checked++;
            if (a > 0.05) results.links.lit++;
            results.links.worst = Math.max(results.links.worst, e);
            if (e > 0.06) results.links.bad++;
          }
        }
      }
    }
    f.request();
    return results;
  });
  bad = (r.bad || 0) + r.lattice.bad + r.links.bad;
  console.log(`cross-links: ${r.links.checked} pixels (${r.links.lit} lit by links), ${r.links.bad} off by more than 0.06 (worst ${r.links.worst.toFixed(3)})`);
  console.log(`lattice of lines: ${r.lattice.checked} pixels (${r.lattice.lit} lit), ${r.lattice.bad} off by more than 0.06 in coverage (worst ${r.lattice.worst.toFixed(3)})`);
  console.log(`checked ${r.checked} individuals on the GPU: ${bad} disagree with the CPU mirror`);
  console.log(`  (none / alive / lineage / ended: ${r.counts.join(' / ')})`);
  for (const mm of r.mismatches) console.log('  mismatch', JSON.stringify(mm));
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
