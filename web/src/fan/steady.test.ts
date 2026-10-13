// The steady layout (ToLaD#259): every strand's centre is constant between its own splits, at every zoom.
import { describe, expect, it } from 'vitest';
import { Steady } from './steady';
import { lanesAt, layoutFan, segAt, type Fan, type FanNode, type WidthMode } from './layout';
import { CARNIVORA, FELIDAE, mammaliaClade } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';

await loadMammalsFromFiles();

const SCREEN = 390;
type Level = 'cats' | 'carnivores' | 'mammals';
function steady(level: Level, mode: WidthMode = 'linear'): { fan: Fan; f: Steady; home: number } {
  const fan =
    level === 'cats'
      ? layoutFan(FELIDAE, mode, FELIDAE_TREE)
      : level === 'carnivores'
        ? layoutFan(CARNIVORA, mode, CARNIVORA_TREE)
        : layoutFan(mammaliaClade(), mode, mammaliaTree());
  const f = new Steady(fan, level === 'cats');
  f.setAll(0);
  fan.tess.fold = f;
  const [x0, x1] = f.homeExtent();
  return { fan, f, home: (SCREEN - 72) / ((x1 - x0) * 1.04) };
}

/** Strand i's centre at y: its own column's (above its split), or its slot's in a parent column. */
const centre = (f: Steady, i: number, y: number) => {
  const b = f.strands[i];
  const l = f.left(i, y);
  return y < b.splitY ? l : l + b.baseW / 2;
};

/** Strand i's stretches between its own splits (world [top, bottom]), each past the fork it starts with. */
function stretches(f: Steady, fan: Fan, i: number): [number, number][] {
  const b = f.strands[i];
  const now = fan.time.y(0);
  const out: [number, number][] = [[Math.max(b.tipY, now), b.splitY - f.forkH(b.node)]];
  for (const s of b.path) {
    const v: FanNode = s.node;
    out.push([v.y, v.parent ? v.yBot - f.forkH(v.parent) : fan.trunkBottom.y]);
  }
  return out.filter(([t, u]) => u > t);
}

const ZOOMS = [1, 2.2, 5, 14, 50];
/** Measured 5.1 px (carnivores, 1x-50x, linear and log): a column booming just after its split outgrows its founders' slot before its peel has moved it clear (ToLaD#259, left over). */
const WORST_OVERLAP_PX = 6;

describe('steady: a branch moves sideways only at its own splits', () => {
  for (const level of ['cats', 'carnivores', 'mammals'] as Level[]) {
    it(`${level}: every strand's centre is constant between its splits, to under 0.5 px, at every zoom`, () => {
      const { fan, f, home } = steady(level);
      const n = f.strands.length;
      const step = Math.max(1, Math.floor(n / 240));
      let worst = 0;
      let checked = 0;
      for (const z of ZOOMS) {
        const sx = home * z;
        f.setScale(sx, SCREEN);
        for (let i = 0; i < n; i += step) {
          for (const [t, u] of stretches(f, fan, i)) {
            const c0 = centre(f, i, u);
            for (let k = 0; k <= 16; k++) {
              const y = t + ((u - t) * k) / 16;
              const d = Math.abs(centre(f, i, y) - c0) * sx;
              worst = Math.max(worst, d);
              checked++;
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
      expect(worst).toBeLessThan(0.5);
    });
  }

  it('columns overlap by no more than a boom'"'"'s peel and each fits its room (carnivores, linear and log)', () => {
    // (A column booming over its peel may brush its neighbour's slot while still near its founders': WORST_OVERLAP_PX.)
    let worst = 0;
    for (const mode of ['linear', 'log'] as WidthMode[]) {
      const { fan, f, home } = steady('carnivores', mode);
      for (const z of [1, 5, 50]) {
        f.setScale(home * z, SCREEN);
        const now = fan.time.y(0);
        for (let k = 0; k <= 60; k++) {
          const y = now + ((fan.root.y + 200 - now) * k) / 60;
          const cols: [number, number][] = [];
          let last: FanNode | null = null;
          f.strands.forEach((b, i) => {
            if (y < b.splitY) {
              last = null;
              const w = lanesAt(b, y)[0];
              if (w > 0) cols.push([f.left(i, y) - w / 2, f.left(i, y) + w / 2]);
              expect(w).toBeLessThanOrEqual(Math.max(b.width, b.baseW) * (1 + 1e-6) + 1e-9);
              return;
            }
            const s = segAt(b, y);
            if (s.node === last) return;
            last = s.node;
            const l = f.left(i, y) - s.off;
            cols.push([l, l + s.node.width]);
          });
          for (let q = 1; q < cols.length; q++) worst = Math.max(worst, (cols[q - 1][1] - cols[q][0]) * home * z);
        }
      }
    }
    expect(worst).toBeLessThan(WORST_OVERLAP_PX);
  });

  it('a row read off the grid is every strand read alone', () => {
    const { f, home } = steady('carnivores');
    f.setScale(home * 3, SCREEN);
    f.setGrid(4);
    for (const k of [-200, -120, -40, 0, 30]) {
      const xs = f.rowXs(k);
      f.strands.forEach((_, i) => expect(Math.abs(xs[i] - f.left(i, k * 4))).toBeLessThan(1e-9));
    }
  });

  it('follow keeps a point in its column as a gap opens', () => {
    const { fan, f, home } = steady('carnivores');
    f.setScale(home, SCREEN);
    const prev = f.snapshot();
    const i = Math.floor(f.strands.length / 3);
    const y = fan.time.y(0.001);
    const x0 = centre(f, i, y);
    f.setScale(home * 8, SCREEN);
    expect(Math.abs(f.follow(x0, y, prev) - centre(f, i, y))).toBeLessThan(1e-6);
  });
});
