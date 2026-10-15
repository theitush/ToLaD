// Territories, fit zooms and the cut (ToLaD#333): property tests at the cats, the carnivores and the mammals.
import { describe, expect, it } from 'vitest';
import { Steady } from './steady';
import { layoutFan, type Fan } from './layout';
import { CARNIVORA, FELIDAE, mammaliaClade } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';
import { LADDER, Territories, type CutItem } from './cut';

await loadMammalsFromFiles();

const SCREEN = 390;
/** A name pill's thickness and a picture's diameter (view.ts LABEL_PILL, pics.ts PIC_D). */
const BOXES = [22, 50];
type Level = 'cats' | 'carnivores' | 'mammals';
function setup(level: Level): { fan: Fan; f: Steady; t: Territories; home: number } {
  const fan =
    level === 'cats'
      ? layoutFan(FELIDAE, 'linear', FELIDAE_TREE)
      : level === 'carnivores'
        ? layoutFan(CARNIVORA, 'linear', CARNIVORA_TREE)
        : layoutFan(mammaliaClade(), 'linear', mammaliaTree());
  const f = new Steady(fan, level === 'cats');
  f.setAll(0);
  fan.tess.fold = f;
  const [x0, x1] = f.homeExtent();
  return { fan, f, t: new Territories(fan, f, SCREEN), home: (SCREEN - 72) / ((x1 - x0) * 1.04) };
}
const ZOOMS = [0.5, 1, 2.2, 5, 14, 50, 400];
const levels: Level[] = ['cats', 'carnivores', 'mammals'];
const S = new Map(levels.map((l) => [l, setup(l)]));
/** Relative float slack. */
const REL = 1e-6;

describe('cut: territories (ToLaD#333)', () => {
  for (const level of levels) {
    it(`${level}: in space and time, two territories that share a time are disjoint (rooms by life, Steady.territory)`, () => {
      const { fan, f, t, home } = S.get(level)!;
      // (An item's labels stand from its youngest tip up to its parent's split: its window in time.)
      const tipN = Float64Array.from(t.nodes, (v) => Math.min(...v.strands.map((b) => Math.max(b.tipY, fan.time.y(0)))));
      const win = (k: number, j: number): [number, number] => [k >= 0 ? tipN[k] : Math.max(t.strands[~k].tipY, fan.time.y(0)), t.nodes[j].y];
      for (const z of ZOOMS) {
        f.setScale(home * z, SCREEN);
        // The cut's items for a pill at this zoom, as the labels see them: every pair sharing a time stands apart.
        const cs = t.cut(home * z, 22).filter((c) => c.kind !== 'run');
        const box = cs.map((c) => {
          const k = c.kind === 'leaf' ? ~c.j : c.j;
          const up = k >= 0 ? t.nodes[k].parent : t.strands[~k].node;
          return { x: t.span(k), y: up ? win(k, t.index.get(up)!) : [-Infinity, Infinity] };
        });
        for (let a = 0; a < box.length; a++)
          for (let b = a + 1; b < box.length; b++) {
            const [p, q] = [box[a], box[b]];
            if (!(p.y[0] < q.y[1] && q.y[0] < p.y[1])) continue;
            const tol = REL * Math.max(Math.abs(p.x[1]), Math.abs(q.x[0])) + 1e-9;
            expect(p.x[1] <= q.x[0] + tol || q.x[1] <= p.x[0] + tol).toBe(true);
          }
        // Sisters: always sharing their parent's split, side by side left to right.
        t.nodes.forEach((_, j) => {
          let prev = -Infinity;
          for (const k of t.kids[j]) {
            const [c, d] = t.span(k);
            expect(c).toBeGreaterThanOrEqual(prev - REL * Math.abs(c) - 1e-9);
            expect(d).toBeGreaterThanOrEqual(c);
            prev = d;
          }
        });
      }
    });

    it(`${level}: on screen they only grow with the width zoom; the pure width agrees with the layout's`, () => {
      const { f, t, home } = S.get(level)!;
      const n = t.nodes.length;
      const step = Math.max(1, Math.floor(n / 300));
      let prev: Float64Array | null = null;
      for (const z of [...ZOOMS, 1000]) {
        const sx = home * z;
        f.setScale(sx, SCREEN);
        const now = new Float64Array(Math.ceil(n / step));
        for (let j = 0, k = 0; j < n; j += step, k++) {
          const [a, b] = t.span(j);
          now[k] = (b - a) * sx;
          expect(Math.abs(t.widthAt(j, sx) - (b - a))).toBeLessThan(REL * (b - a) + 1e-9);
          if (prev) expect(now[k]).toBeGreaterThanOrEqual(prev[k] - REL * now[k]);
        }
        prev = now;
      }
    });

    it(`${level}: a split is closed below its ramp and open above it (the fit ladder skips the rest)`, () => {
      const { f } = S.get(level)!;
      for (let p = 0; p < f.a.length; p += Math.max(1, Math.floor(f.a.length / 200))) {
        const r = f.openRamp(p, SCREEN);
        if (!r) {
          expect(f.openOne(p, 1e-9, SCREEN)).toBe(1);
          continue;
        }
        expect(f.openOne(p, r[0] * 0.999, SCREEN)).toBe(0);
        expect(f.openOne(p, r[1] * 1.001, SCREEN)).toBe(1);
      }
    });

    it(`${level}: a box fits from its fit zoom on, not on the rung below; a daughter never before its parent`, () => {
      const { t } = S.get(level)!;
      for (const px of BOXES) {
        const z = t.fitZoom(px);
        const n = t.nodes.length;
        for (let j = 0; j < n; j += Math.max(1, Math.floor(n / 60))) {
          const sx = z.node[j];
          expect(sx).toBeLessThan(Infinity);
          expect(sx * t.widthAt(j, sx)).toBeGreaterThanOrEqual(px * (1 - REL));
          const lo = sx / Math.pow(2, 1 / LADDER);
          expect(lo * t.widthAt(j, lo)).toBeLessThan(px);
          for (const k of t.kids[j]) expect(k >= 0 ? z.node[k] : z.strand[~k]).toBeGreaterThanOrEqual(sx);
        }
      }
    });
  }
});

/** An item's species (strand indices). */
function speciesOf(t: Territories, c: CutItem): number[] {
  const out: number[] = [];
  if (c.kind === 'leaf') return [c.j];
  const K = [...t.kids[c.j]].slice(c.q0, c.q1 + 1);
  for (const k of K)
    if (k >= 0) for (let i = t.first[k]; i <= t.last[k]; i++) out.push(i);
    else out.push(~k);
  return out;
}
const key = (cs: CutItem[]) => cs.map((c) => `${c.kind}${c.j}:${c.q0}-${c.q1}:${c.fits ? 1 : 0}:${c.x0.toPrecision(12)}`).join(' ');

describe('cut: one cut through the tree (ToLaD#333)', () => {
  for (const level of levels) {
    it(`${level}: every species under exactly one item; items disjoint, left to right; a fitting item holds its box`, () => {
      const { f, t, home } = S.get(level)!;
      for (const px of BOXES)
        for (const z of ZOOMS) {
          const sx = home * z;
          f.setScale(sx, SCREEN);
          const cs = t.cut(sx, px);
          const seen = new Uint8Array(t.strands.length);
          let prev = -Infinity;
          for (const c of cs) {
            const sp = speciesOf(t, c);
            for (const i of sp) seen[i]++;
            expect(c.count).toBe(sp.length);
            expect(c.x0).toBeGreaterThanOrEqual(prev - REL * Math.abs(c.x0) - 1e-9);
            prev = c.x1;
            if (c.fits) expect((c.x1 - c.x0) * sx).toBeGreaterThanOrEqual(px * (1 - REL));
            // (Only a run, or the root before anything fits, can be an item that does not hold its box.)
            if (c.kind !== 'run' && cs.length > 1) expect(c.fits).toBe(true);
          }
          expect(seen.every((k) => k === 1)).toBe(true);
        }
    });

    it(`${level}: what shows depends only on the camera, not on the way there; a window gives what meets it`, () => {
      const { f, t, home } = S.get(level)!;
      for (const z of [1, 5, 50]) {
        const sx = home * z;
        f.setScale(sx, SCREEN);
        const direct = key(t.cut(sx, 22));
        for (const via of [[0.5, 400], [14, 2.2], [1000]]) {
          for (const w of via) f.setScale(home * w, SCREEN);
          f.setScale(sx, SCREEN);
          expect(key(t.cut(sx, 22))).toBe(direct);
        }
        const all = t.cut(sx, 22);
        const mid = (all[0].x0 + all[all.length - 1].x1) / 2;
        const half = SCREEN / sx / 2;
        const win = t.cut(sx, 22, mid - half, mid + half);
        expect(key(win)).toBe(key(all.filter((c) => c.x1 >= mid - half && c.x0 <= mid + half)));
      }
    });
  }

  it('mammals: a cut on one screen costs what is on it', () => {
    const { f, t, home } = S.get('mammals')!;
    const t0 = performance.now();
    new Territories(t.fan, f, SCREEN).fitZoom(22);
    const fitMs = performance.now() - t0;
    for (const z of [1, 50]) {
      const sx = home * z;
      f.setScale(sx, SCREEN);
      const all = t.cut(sx, 22);
      const mid = (all[0].x0 + all[all.length - 1].x1) / 2;
      const t1 = performance.now();
      let n = 0;
      for (let k = 0; k < 50; k++) n += t.cut(sx, 22, mid - SCREEN / sx / 2, mid + SCREEN / sx / 2).length;
      const ms = (performance.now() - t1) / 50;
      console.log(`cut333: mammals ${z}x home: ${all.length} items in all, ${n / 50} on screen, ${ms.toFixed(3)} ms a cut (fit zooms once: ${fitMs.toFixed(0)} ms)`);
      expect(ms).toBeLessThan(5);
    }
  });
});

describe('cut: borrowed room, Been et al. 1D active ranges (ToLaD#333, plan step 2b)', () => {
  for (const level of levels)
    it(`${level}: daughters that borrow room hold disjoint boxes inside their stretch of runs; more labels`, () => {
      const { f, t, home } = S.get(level)!;
      const px = BOXES[0];
      const k0 = Territories.rung(home / 2);
      let more = 0;
      for (let k = k0; k < k0 + 6 * LADDER; k += 3) {
        const sx = Math.pow(2, k / LADDER);
        f.setScale(sx, SCREEN);
        const items = t.cut(sx, px);
        const lent = t.borrowed(sx, px, items);
        // Stretches: runs side by side; each lent daughter's box inside its own stretch, none meeting another.
        const boxes: [number, number][] = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind !== 'run') continue;
          let e = i;
          while (e + 1 < items.length && items[e + 1].kind === 'run') e++;
          const [x0, x1] = [items[i].x0, items[e].x1];
          for (let r = i; r <= e; r++)
            for (let q = items[r].q0; q <= items[r].q1; q++) {
              const d = t.kids[items[r].j][q];
              if (!lent.has(d)) continue;
              const [a, b] = t.span(d);
              const h = px / 2 / sx;
              const c = (a + b) / 2;
              expect(c - h).toBeGreaterThanOrEqual(x0 - REL * Math.abs(x0) - 1e-9);
              expect(c + h).toBeLessThanOrEqual(x1 + REL * Math.abs(x1) + 1e-9);
              boxes.push([c - h, c + h]);
            }
          i = e;
        }
        boxes.sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < boxes.length; i++) expect(boxes[i][0]).toBeGreaterThanOrEqual(boxes[i - 1][1] - REL * Math.abs(boxes[i][0]) - 1e-9);
        more += boxes.length;
      }
      if (level !== 'cats') expect(more).toBeGreaterThan(0);
    });
});
