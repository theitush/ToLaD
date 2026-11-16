// The fold moves the columns on every pan and pinch (ToLaD#146): the twig models keep the widths and pitch
// they sampled and read only the left edges again (TwigModel.refold, ColumnPath.reset). What they hand out
// must be what a fresh model works out at the fold as it is now.
import { describe, expect, it } from 'vitest';
import { Steady } from './steady';
import { layoutFan } from './layout';
import { CARNIVORA } from './panthera';
import { CARNIVORA_TREE } from './splits';
import { TwigModel } from './twigs';

describe('refold keeps the widths, reads the left edges again', () => {
  const fan = layoutFan(CARNIVORA, 'linear', CARNIVORA_TREE);
  const fold = new Steady(fan);
  fan.tess.fold = fold;
  fold.setAll(0);
  const now = fan.time.y(0);
  const H = fan.trunkBottom.y - now;
  const bs = fan.branches.filter((_, i) => i % 23 === 0);
  const ys = Array.from({ length: 40 }, (_, k) => now + (H * (k + 0.5)) / 40);
  const sx = 400 / fan.trunkWidth;
  const sy = 600 / H;

  // (On no grid, and on the view's: there the fold's edge is read once where it runs on through a sample (TwigModel.leftPair),
  // a few 1e-9 off the two reads either side of it at rest.)
  for (const grid of [0, Math.pow(2, Math.round(Math.log2(3 / sy)))]) {
    it(`at() and the kept path samples match a fresh model after the fold moves (grid ${grid})`, () => {
      fold.setAll(0);
      fold.setGrid(grid);
      const models = bs.map((b) => new TwigModel(b, fan.time, 'linear'));
      for (const m of models) {
        for (const y of ys) m.at(y);
        m.path.span(sx, sy, now, now + H / 2);
      }
      // The layout moves: splits half open.
      fold.setAll(0.5, true);
      let worst = 0;
      for (const m of models) {
        m.refold();
        const fresh = new TwigModel(m.b, fan.time, 'linear');
        for (const y of ys) {
          const a = m.at(y);
          const f = fresh.at(y);
          for (let i = 0; i < 4; i++) expect(a[i]).toBeCloseTo(f[i], 9);
        }
        const [i0, i1] = m.path.span(sx, sy, now, now + H / 2);
        const p = m.path;
        for (let k = i0; k <= i1; k++) {
          const y = p.ys[k];
          const e = 1e-9 * Math.max(1, Math.abs(y));
          const below = fresh.lanes(y + e).left;
          worst = Math.max(worst, Math.abs(p.vals[8 * k] - below) * sx);
        }
        // At rest: chosen afresh, the same as a fresh model's.
        m.foldRest();
        const [j0, j1] = m.path.span(sx, sy, now, now + H / 2);
        const [f0, f1] = fresh.path.span(sx, sy, now, now + H / 2);
        expect(j1 - j0).toBe(f1 - f0);
        for (let k = j0; k <= j1; k++) expect(m.path.vals[8 * k]).toBeCloseTo(fresh.path.vals[8 * (k - j0 + f0)], grid ? 7 : 9);
      }
      // (The kept samples' left edges are exact at the fold as it is now: read again, not carried over.)
      expect(worst).toBeLessThan(1e-6);
    });
  }
});
