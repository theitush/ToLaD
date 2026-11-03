// Territories, fit zooms and the cut (ToLaD#333): property tests at the cats, the carnivores and the mammals.
import { describe, expect, it } from 'vitest';
import { Steady } from './steady';
import { layoutFan, type Fan } from './layout';
import { CARNIVORA, FELIDAE, mammaliaClade } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';
import { LADDER, Territories, type CutItem, type RowsOf } from './cut';
import { PIC_D as PIC, PIC_LIFT } from './pics';

await loadMammalsFromFiles();

const SCREEN = 390;
/** A name pill's thickness and a picture's diameter (view.ts LABEL_PILL, pics.ts PIC_D). */
const BOXES = [22, 50];
/** A name pill's length (px), and the tree's height on screen (px): the labels' rows as the view takes them. */
const PILL_LEN = 80;
const TALL = 3000;
type Level = 'cats' | 'carnivores' | 'mammals';
interface Setup {
  fan: Fan;
  /** Rooms by life (the view's) and widest rooms (the fit-zoom ladder's properties). */
  f: Steady;
  t: Territories;
  wf: Steady;
  wt: Territories;
  home: number;
  /** World y per screen px. */
  py: number;
  rows: RowsOf;
}
function setup(level: Level): Setup {
  const fan =
    level === 'cats'
      ? layoutFan(FELIDAE, 'linear', FELIDAE_TREE)
      : level === 'carnivores'
        ? layoutFan(CARNIVORA, 'linear', CARNIVORA_TREE)
        : layoutFan(mammaliaClade(), 'linear', mammaliaTree());
  const f = new Steady(fan, level === 'cats');
  f.setAll(0);
  fan.tess.fold = f;
  const wf = new Steady(fan, level === 'cats', false);
  wf.setAll(0);
  const [x0, x1] = f.homeExtent();
  const t = new Territories(fan, f, SCREEN);
  // (The view's grid: rows a few px apart, a power of two in world y.)
  const now = fan.time.y(0);
  const py = (fan.root.yBot - now) / TALL;
  f.setGrid(Math.pow(2, Math.round(Math.log2(3 * py))));
  // A label, one unit at its youngest tip (view.ts cutLabels): its picture PIC_LIFT over the tip, its name pill PILL_LEN
  // long right under it. The tip is its head climbed's (view.ts CutTerritories.whole: the widest clade the head is in
  // whose species are all the item's), not its riders': a sister riding on it lends it no row (ToLaD#358, #359).
  const rows: RowsOf = (r) => {
    let [a, z] = r.head >= 0 ? [t.first[r.head], t.last[r.head]] : [~r.head, ~r.head];
    for (let u = r.head >= 0 ? t.nodes[r.head].parent : t.strands[~r.head].node; u; u = u.parent) {
      const j = t.index.get(u)!;
      if (t.first[j] < r.f || t.last[j] > r.l) break;
      [a, z] = [t.first[j], t.last[j]];
    }
    let ty = Infinity;
    for (let i = a; i <= z; i++) ty = Math.min(ty, t.strands[i].tipY);
    ty = Math.max(ty, now);
    const d1 = ty - PIC_LIFT * py;
    const p0 = d1 + 4 * py;
    return [d1 - PIC * py, d1, p0, p0 + PILL_LEN * py];
  };
  return { fan, f, t, wf, wt: new Territories(fan, wf, SCREEN), home: (SCREEN - 72) / ((x1 - x0) * 1.04), py, rows };
}
const ZOOMS = [0.5, 1, 2.2, 5, 14, 50, 400];
const levels: Level[] = ['cats', 'carnivores', 'mammals'];
const S = new Map(levels.map((l) => [l, setup(l)]));
/** Relative float slack. */
const REL = 1e-6;

/**
 * Items' territories (rooms by life) per row: sweeping them left to right, on every grid row an item's labels take
 * (Steady.cell's rows) it starts at or after where the last on that row ended. O(rows the labels take).
 */
function sweep(s: Setup, cs: readonly CutItem[], rows: RowsOf = s.rows): number {
  const h = s.f.gridH;
  const end = new Map<number, number>();
  let n = 0;
  for (const c of cs) {
    if (!(c.x1 > c.x0)) continue;
    const [ya, yb] = rows(c);
    let k0 = Math.ceil(ya / h);
    let k1 = Math.floor(yb / h);
    if (k0 > k1) k0 = k1 = Math.round((ya + yb) / 2 / h);
    for (let k = k0; k <= k1; k++) {
      const e = end.get(k) ?? -Infinity;
      const tol = REL * Math.max(Math.abs(e), Math.abs(c.x0)) + 1e-9;
      if (!(c.x0 >= e - tol)) expect.fail(`row ${k}: item ${c.head} starts at ${c.x0}, before ${e}`);
      end.set(k, c.x1);
      n++;
    }
  }
  return n;
}

describe('cut: territories (ToLaD#333)', () => {
  for (const level of levels) {
    it(`${level}: per row, the cut's territories are disjoint and left to right (rooms by life, Steady.cell)`, () => {
      const s = S.get(level)!;
      const { f, t, home } = s;
      for (const px of BOXES)
        for (const z of ZOOMS) {
          f.setScale(home * z, SCREEN);
          const cs = t.cut(home * z, px, -Infinity, Infinity, s.rows);
          expect(sweep(s, cs)).toBeGreaterThan(0);
        }
    });

    it(`${level}: widest rooms: on screen they only grow with the width zoom; the pure width agrees with the layout's`, () => {
      const { wf: f, wt: t, home } = S.get(level)!;
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
    it(`${level}: widest rooms: a split is closed below its ramp and open above it (the fit ladder skips the rest)`, () => {
      const { wf: f } = S.get(level)!;
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

    it(`${level}: widest rooms: a box fits from its fit zoom on, not on the rung below; a daughter never before its parent`, () => {
      const { wt: t } = S.get(level)!;
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

/** An item's species (strand indices): its parts', in the drawn order. */
function speciesOf(t: Territories, c: CutItem): number[] {
  const out: number[] = [];
  for (const k of c.parts)
    if (k >= 0) for (let i = t.first[k]; i <= t.last[k]; i++) out.push(i);
    else out.push(~k);
  return out.sort((a, b) => a - b);
}
const key = (cs: CutItem[]) => cs.map((c) => `${c.head}:${c.f}-${c.l}:${c.fits ? 1 : 0}:${c.x0.toPrecision(12)}`).join(' ');


describe('cut: one cut through the tree (ToLaD#333)', () => {
  for (const level of levels) {
    it(`${level}: every species under exactly one item, in the drawn order; a fitting item holds its box`, () => {
      const s = S.get(level)!;
      const { f, t, home } = s;
      for (const px of BOXES)
        for (const z of ZOOMS) {
          const sx = home * z;
          f.setScale(sx, SCREEN);
          const cs = t.cut(sx, px, -Infinity, Infinity, s.rows);
          const seen = new Uint8Array(t.strands.length);
          let next = 0;
          for (const c of cs) {
            const sp = speciesOf(t, c);
            for (const i of sp) seen[i]++;
            expect(c.count).toBe(sp.length);
            expect([c.f, c.l]).toEqual([next, next + sp.length - 1]);
            expect(sp).toEqual(Array.from(sp, (_, i) => next + i));
            next = c.l + 1;
            if (c.fits) expect((c.x1 - c.x0) * sx).toBeGreaterThanOrEqual(px * (1 - REL));
            // (Only the root, before anything fits, can be an item that does not hold its box: a run rides with a fitting neighbour.)
            if (cs.length > 1) expect(c.fits).toBe(true);
          }
          expect(seen.every((k) => k === 1)).toBe(true);
        }
    });

    it(`${level}: zooming in, an item only splits (each species' item narrows), rooms by life and widest rooms`, () => {
      const s = S.get(level)!;
      for (const [f, t] of [[s.f, s.t], [s.wf, s.wt]] as const) {
        let prev: Int32Array | null = null;
        for (let k = -LADDER; k <= 10 * LADDER; k += 4) {
          const sx = s.home * Math.pow(2, k / LADDER);
          f.setScale(sx, SCREEN);
          const at = new Int32Array(2 * t.strands.length);
          for (const c of t.cut(sx, BOXES[1], -Infinity, Infinity, s.rows))
            for (let i = c.f; i <= c.l; i++) [at[2 * i], at[2 * i + 1]] = [c.f, c.l];
          if (prev) for (let i = 0; i < at.length; i += 2) if (at[i] < prev[i] || at[i + 1] > prev[i + 1]) expect.fail(`${sx}: species ${i / 2} from ${prev[i]}-${prev[i + 1]} to ${at[i]}-${at[i + 1]}`);
          prev = at;
        }
      }
    });

    it(`${level}: what shows depends only on the camera, not on the way there; a window gives what meets it`, () => {
      const s = S.get(level)!;
      const { f, t, home } = s;
      for (const z of [1, 5, 50]) {
        const sx = home * z;
        f.setScale(sx, SCREEN);
        const direct = key(t.cut(sx, 22, -Infinity, Infinity, s.rows));
        for (const via of [[0.5, 400], [14, 2.2], [1000]]) {
          for (const w of via) f.setScale(home * w, SCREEN);
          f.setScale(sx, SCREEN);
          expect(key(t.cut(sx, 22, -Infinity, Infinity, s.rows))).toBe(direct);
        }
        const all = t.cut(sx, 22, -Infinity, Infinity, s.rows);
        const r: [number, number] = [0, 0];
        const mid = (all[0].x0 + all[all.length - 1].x1) / 2;
        const half = SCREEN / sx / 2;
        const meets = (a: number, b: number) => b >= mid - half && a <= mid + half;
        // (An item meets the window when its room (culling) and its territory both do.)
        const room = (c: CutItem) => t.hull(c.f, c.l, r);
        const win = t.cut(sx, 22, mid - half, mid + half, s.rows);
        expect(key(win)).toBe(key(all.filter((c) => meets(...room(c)) && meets(c.x0, c.x1))));
      }
    });
  }

  it('mammals: a cut on one screen costs what is on it', () => {
    const s = S.get('mammals')!;
    const { f, t, home } = s;
    for (const z of [1, 50]) {
      const sx = home * z;
      f.setScale(sx, SCREEN);
      const all = t.cut(sx, 22, -Infinity, Infinity, s.rows);
      const mid = (all[0].x0 + all[all.length - 1].x1) / 2;
      t.cut(sx, 22, mid - SCREEN / sx / 2, mid + SCREEN / sx / 2, s.rows);
      const t1 = performance.now();
      let n = 0;
      for (let k = 0; k < 50; k++) n += t.cut(sx, 22, mid - SCREEN / sx / 2, mid + SCREEN / sx / 2, s.rows).length;
      const ms = (performance.now() - t1) / 50;
      console.log(`cut333: mammals ${z}x home: ${all.length} items in all, ${n / 50} on screen, ${ms.toFixed(3)} ms a cut (rows cached)`);
      expect(ms).toBeLessThan(5);
    }
  });
});
