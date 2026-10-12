// The fold (ToLaD#146): one branch from afar, opening continuously as the width zoom grows.
import { describe, expect, it } from 'vitest';
import { Fold } from './fold';
import { columnsAt, g, laneAt, layoutFan, leftAt, TIME_H, type EdgeStyle, type Fan, type WidthMode } from './layout';
import { CARNIVORA } from './panthera';
import { CARNIVORA_TREE } from './splits';

const SCREEN = 390;
const fans = new Map<string, Fan>();
function folded(mode: WidthMode, edge: EdgeStyle): { fan: Fan; fold: Fold; home: number } {
  const key = `${mode}:${edge}`;
  let fan = fans.get(key);
  if (!fan) fans.set(key, (fan = layoutFan(CARNIVORA, mode, CARNIVORA_TREE, edge)));
  const fold = new Fold(fan);
  fan.tess.fold = fold;
  // Home frames the closed order (camera.ts frame: 72 px of margins, 4% of slack).
  const home = (SCREEN - 72) / (fan.trunkWidth * 1.04);
  return { fan, fold, home };
}
const heights = (fan: Fan, n: number) => Array.from({ length: n + 1 }, (_, k) => -TIME_H + ((fan.trunkBottom.y + TIME_H) * k) / n);
const ZOOMS = [1, 1.3, 1.7, 2.2, 3, 5, 8, 14, 25, 50, 120];

describe('the fold', () => {
  for (const [mode, edge] of [
    ['log', 'curved'],
    ['linear', 'curved'],
    ['log', 'straight'],
  ] as [WidthMode, EdgeStyle][]) {
    it(`home is one branch: every split closed, the columns side by side with no gap, about the stem's centre (${mode}, ${edge})`, () => {
      const { fan, fold, home } = folded(mode, edge);
      fold.setScale(home, SCREEN);
      expect(Math.max(...fold.a)).toBe(0);
      for (const y of heights(fan, 400)) {
        const cs = columnsAt(fan, y).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
        let w = 0;
        for (let i = 0; i < cs.length; i++) {
          w += cs[i][1] - cs[i][0];
          if (i) expect(Math.abs(cs[i][0] - cs[i - 1][1])).toBeLessThan(1e-9 * fan.trunkWidth + 1e-9);
        }
        if (cs.length) expect((cs[0][0] + cs[cs.length - 1][1]) / 2).toBeCloseTo(fold.home, 6);
        expect(w).toBeLessThanOrEqual(fan.trunkWidth * (1 + 1e-9));
      }
    });

    it(`at every zoom the columns never overlap or cross, and fully open is the river (${mode}, ${edge})`, () => {
      const { fan, fold, home } = folded(mode, edge);
      const ys = heights(fan, 500);
      let worst = 0;
      for (const z of ZOOMS) {
        fold.setScale(home * z, SCREEN);
        for (const y of ys) {
          const cs = columnsAt(fan, y).sort((p, q) => p[0] - q[0]);
          for (let i = 1; i < cs.length; i++) worst = Math.max(worst, cs[i - 1][1] - cs[i][0]);
        }
      }
      expect(worst).toBeLessThan(1e-9 * fan.trunkWidth);
      fold.setAll(1);
      for (const b of fan.branches.slice(0, 40)) for (const y of ys.filter((_, k) => k % 10 === 0)) expect(leftAt(b, y)).toBe(leftAt(b, y, undefined, true));
    });

    it(`edges are continuous in time at every zoom: no jog at a split, a tip or a fork (${mode}, ${edge})`, () => {
      const { fan, fold, home } = folded(mode, edge);
      const yb = fan.trunkBottom.y;
      let jog = 0;
      for (const z of [1, 1.7, 3, 8, 25]) {
        fold.setScale(home * z, SCREEN);
        for (const b of fan.branches.filter((_, i) => i % 15 === 0)) {
          for (const y of [b.tipY, b.splitY, b.leanY]) {
            if (!(y > b.tipY + 1e-6) || !(y < yb - 1e-6)) continue;
            const e = (yy: number) => {
              const l = leftAt(b, yy);
              return [l, l + laneAt(b, yy).w];
            };
            const a = e(y - 1e-7);
            const c = e(y + 1e-7);
            for (let k = 0; k < 2; k++) jog = Math.max(jog, Math.abs(a[k] - c[k]));
          }
        }
        // Every strand pair's neighbours: other strands' tips and splits are where a row changes its columns.
        const marks = new Set<number>();
        for (const b of fan.branches) {
          if (b.tipY > -TIME_H) marks.add(b.tipY);
          marks.add(b.splitY);
        }
        for (const y of marks) {
          if (!(y < yb - 1e-6)) continue;
          for (const b of fan.branches) {
            if (y - 1e-7 < b.tipY) continue;
            jog = Math.max(jog, Math.abs(leftAt(b, y - 1e-7) - leftAt(b, y + 1e-7)));
          }
        }
      }
      expect(jog).toBeLessThan(1e-4 * fan.trunkWidth);
    });

    it(`the opening is continuous in the zoom, width is untouched, and the order's halves open before the families (${mode}, ${edge})`, () => {
      const { fan, fold, home } = folded(mode, edge);
      // A pinch (1% a frame) about a column: the columns on screen around it move a few px a frame at most.
      const ys = heights(fan, 12).slice(1, -1);
      let worst = 0;
      let found = 0;
      for (const name of ['Grey wolf', 'Lion', 'Harbor seal']) {
        const A = fan.branches.find((b) => b.sp.common === name);
        if (!A) continue;
        found++;
        let prev: number[] | null = null;
        for (let k = 0; k <= 400; k++) {
          const sx = home * Math.pow(1.01, k);
          fold.setScale(sx, SCREEN);
          const xs = ys.flatMap((y) => {
            const a = y >= A.tipY ? leftAt(A, y) : NaN;
            return fan.branches.map((b) => (y >= b.tipY ? (leftAt(b, y) - a) * sx : NaN));
          });
          if (prev) for (let i = 0; i < xs.length; i++) if (Math.abs(xs[i]) < SCREEN / 2) worst = Math.max(worst, Math.abs(xs[i] - prev[i] * 1.01));
          prev = xs;
        }
      }
      expect(found).toBeGreaterThanOrEqual(2);
      expect(worst).toBeLessThan(0.03 * SCREEN);
      // Width: N(t) × the one unit, folded or not.
      fold.setScale(home * 3, SCREEN);
      for (const b of fan.branches.slice(0, 30)) expect(laneAt(b, b.tipY + 1).w).toBeCloseTo(b.unit * g(b.pop.aliveAt(fan.time.ageAt(b.tipY + 1)), mode), 9);
      // The root's widest split opens before any family's internal one.
      const root = fan.root;
      const fam = fan.nodes.filter((v) => /idae$/.test(v.split.taxon ?? ''));
      const at = (z: number) => {
        fold.setScale(home * z, SCREEN);
        const by = new Map<unknown, number>();
        fold.pairNode.forEach((v, i) => by.set(v, Math.max(by.get(v) ?? 0, fold.a[i])));
        return by;
      };
      const firstOpen = (v: unknown) => {
        for (let k = 0; k <= 60; k++) if ((at(Math.exp((Math.log(200) * k) / 60)).get(v) ?? 0) > 0.5) return k;
        return Infinity;
      };
      const r = Math.min(...fan.nodes.filter((v) => v === root || v.parent === root).map(firstOpen));
      for (const f of fam) expect(firstOpen(f)).toBeGreaterThanOrEqual(r);
      void root;
    });
  }
});
