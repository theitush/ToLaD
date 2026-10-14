// The columns as the layout (steady.ts) places them, read off its rows: xRange, nearestColumn, nearestStrand. (Until
// ToLaD#300 this file tested the fold, the layout steady.ts replaced; steady.test.ts tests the steady layout itself.)
import { describe, expect, it } from 'vitest';
import { SY_HOME } from './fold';
import { Steady } from './steady';
import { columnsAt, laneAt, layoutFan, leftAt, nearestColumn, nearestStrand, TIME_H, type EdgeStyle, type Fan, type FanBranch, type WidthMode } from './layout';
import { CARNIVORA, FELIDAE } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE } from './splits';

const SCREEN = 390;
const fans = new Map<string, Fan>();
function folded(mode: WidthMode, edge: EdgeStyle): { fan: Fan; fold: Steady; home: number } {
  const key = `${mode}:${edge}`;
  let fan = fans.get(key);
  if (!fan) fans.set(key, (fan = layoutFan(CARNIVORA, mode, CARNIVORA_TREE, edge)));
  const fold = new Steady(fan);
  fan.tess.fold = fold;
  // Home frames the closed order (camera.ts frame: 72 px of margins, 4% of slack).
  const [x0, x1] = fold.homeExtent();
  const home = (SCREEN - 72) / ((x1 - x0) * 1.04);
  return { fan, fold, home };
}
const heights = (fan: Fan, n: number) => Array.from({ length: n + 1 }, (_, k) => -TIME_H + ((fan.trunkBottom.y + TIME_H) * k) / n);

describe('the columns', () => {
  it('the species keep one left-to-right order, the tree\'s, under every width and edge, at both levels', () => {
    for (const [clade, tree] of [
      [FELIDAE, FELIDAE_TREE],
      [CARNIVORA, CARNIVORA_TREE],
    ] as const) {
      const orders = (['linear', 'log'] as WidthMode[]).flatMap((mode) =>
        (['curved', 'straight'] as EdgeStyle[]).map((edge) => layoutFan(clade, mode, tree, edge).root.strands.map((b) => b.sp.sci).join(',')),
      );
      for (const o of orders) expect(o).toBe(orders[0]);
    }
  });

  // Held on the fold; on steady a strand pokes 0.02 world out at the carnivores' home (linear, Spilogale putorius):
  // ToLaD#304. An expected failure until that is fixed, when the `.fails` comes off.
  it.fails('xRange, on a grid (read off the rows, every strand at once): holds each strand at every height in the range (ToLaD#304)', () => {
    for (const mode of ['log', 'linear'] as WidthMode[]) {
      const { fan, fold, home } = folded(mode, 'curved');
      const yb = fan.trunkBottom.y;
      const dogs = fan.nodes.find((n) => n.split.taxon === 'Canidae')!;
      for (const [z, sy] of [
        [1, SY_HOME],
        [15, SY_HOME * 40],
      ]) {
        const sx = home * z;
        fold.setScale(sx, SCREEN);
        fold.setGrid(Math.pow(2, Math.round(Math.log2(3 / sy))));
        // (Spans a screen tall or so, as the draw asks: the whole world at home.)
        const scr = (y: number): [number, number] => [y - 440 / sy, y + 440 / sy];
        const ranges: [number, number][] = [z === 1 ? [-TIME_H - 5, yb + 5] : scr(fan.time.y(1e-3)), scr(fan.time.y(1e-5)), scr(dogs.y), scr(dogs.y - 300 / sy)];
        for (const s of fan.branches.filter((_, i) => i % 7 === 0)) {
          for (const [y0, y1] of ranges) {
            const [L, R] = fan.tess.xRange(s, y0, y1);
            for (let k = 0; k <= 300; k++) {
              const y = y0 + ((y1 - y0) * k) / 300;
              if (y < s.tipY || y > yb) continue;
              const w = laneAt(s, y).w;
              if (!(w > 0)) continue;
              const x = leftAt(s, y);
              expect(x, `${mode} ×${z} ${s.sp.sci} at ${y}`).toBeGreaterThanOrEqual(L);
              expect(x + w, `${mode} ×${z} ${s.sp.sci} at ${y}`).toBeLessThanOrEqual(R);
            }
          }
        }
      }
      fold.setGrid(0);
    }
  }, 120_000);
});

describe('nearestColumn (ToLaD#255)', () => {
  it("finds columnsAt's nearest point, folded, at every zoom", () => {
    const { fan, fold, home } = folded('linear', 'curved');
    const brute = (x: number, y: number) => {
      let best = NaN;
      let bd = Infinity;
      for (const [a, b] of columnsAt(fan, y)) {
        const p = Math.min(b, Math.max(a, x));
        if (Math.abs(p - x) < bd) [bd, best] = [Math.abs(p - x), p];
      }
      return best;
    };
    const [x0, x1] = fold.homeExtent();
    let n = 0;
    for (const z of [1, 5, 50]) {
      fold.setScale(home * z, SCREEN);
      for (const y of heights(fan, 40))
        for (let k = 0; k <= 60; k++) {
          const x = x0 - 0.1 * (x1 - x0) + (1.2 * (x1 - x0) * k) / 60;
          const q = nearestColumn(fan, x, y);
          if (q === null) continue;
          n++;
          const p = brute(x, y);
          expect(Math.abs(q - x)).toBeCloseTo(Math.abs(p - x), 9);
        }
    }
    expect(n).toBeGreaterThan(5000);
  });

  it("nearestStrand finds the strand a pass over every one does", () => {
    const { fan, fold, home } = folded('linear', 'curved');
    const brute = (x: number, y: number) => {
      let best: FanBranch | null = null;
      let bd = Infinity;
      for (const b of fan.branches) {
        if (y < b.tipY) continue;
        const l = leftAt(b, y);
        const d = Math.max(0, l - x, x - l - laneAt(b, y).w);
        if (d < bd) [bd, best] = [d, b];
      }
      return best;
    };
    const [x0, x1] = fold.homeExtent();
    let n = 0;
    for (const z of [1, 5, 50]) {
      fold.setScale(home * z, SCREEN);
      for (const y of heights(fan, 30))
        for (let k = 0; k <= 50; k++) {
          const x = x0 - 0.1 * (x1 - x0) + (1.2 * (x1 - x0) * k) / 50;
          if (y > fan.trunkBottom.y) continue;
          n++;
          expect(nearestStrand(fan, x, y)?.sp.gid).toBe(brute(x, y)?.sp.gid);
        }
    }
    expect(n).toBeGreaterThan(3000);
  });
});
