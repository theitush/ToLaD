// Territories, fit zooms and the cut (ToLaD#333): property tests at the cats, the carnivores and the mammals.
import { describe, expect, it } from 'vitest';
import { Steady } from './steady';
import { layoutFan, type Fan } from './layout';
import { CARNIVORA, FELIDAE, mammaliaClade } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';
import { LADDER, Territories, type CutItem, type RowsOf } from './cut';

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
  // A name pill PILL_LEN long in the middle of its branch, from 4 px under its youngest tip (view.ts pillAt).
  const fl: [number, number] = [0, 0];
  const rows: RowsOf = (r) => {
    t.range(r, fl);
    let ty = Infinity;
    for (let i = fl[0]; i <= fl[1]; i++) ty = Math.min(ty, t.strands[i].tipY);
    ty = Math.max(ty, now);
    const by = r.kind === 'run' ? t.nodes[r.j].y : r.kind === 'leaf' ? t.strands[r.j].splitY : t.nodes[r.j].yBot;
    const a = ty + 4 * py;
    const y0 = Math.max(a, (a + by) / 2 - (PILL_LEN * py) / 2);
    return [y0, y0 + PILL_LEN * py];
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
      if (!(c.x0 >= e - tol)) expect.fail(`row ${k}: ${c.kind}${c.j} starts at ${c.x0}, before ${e}`);
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
            next = c.l + 1;
            if (c.fits) expect((c.x1 - c.x0) * sx).toBeGreaterThanOrEqual(px * (1 - REL));
            // (Only a run, or the root before anything fits, can be an item that does not hold its box.)
            if (c.kind !== 'run' && cs.length > 1) expect(c.fits).toBe(true);
          }
          expect(seen.every((k) => k === 1)).toBe(true);
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
        const room = (c: CutItem) => (c.kind === 'run' ? t.hull(c.j, c.q0, c.q1, r) : t.span(c.kind === 'leaf' ? ~c.j : c.j, r));
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

describe('cut: borrowed room, Been et al. 1D active ranges (ToLaD#333, plan step 2b)', () => {
  for (const level of levels)
    it(`${level}: daughters that borrow room hold disjoint boxes inside their stretch of runs, over their rows; more labels`, () => {
      const s = S.get(level)!;
      const { f, t, home } = s;
      const px = BOXES[0];
      const k0 = Territories.rung(home / 2);
      const st: [number, number] = [0, 0];
      let more = 0;
      for (let k = k0; k < k0 + 6 * LADDER; k += 3) {
        const sx = Math.pow(2, k / LADDER);
        f.setScale(sx, SCREEN);
        const items = t.cut(sx, px, -Infinity, Infinity, s.rows);
        const lent = t.borrowed(sx, px, items, undefined, s.rows);
        // Stretches: runs side by side; each lent daughter's box inside its own stretch's share of its rows, none meeting another.
        const boxes: [number, number][] = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind !== 'run') continue;
          let e = i;
          while (e + 1 < items.length && items[e + 1].kind === 'run' && items[e + 1].f === items[e].l + 1) e++;
          for (let r = i; r <= e; r++)
            for (let q = items[r].q0; q <= items[r].q1; q++) {
              const d = t.kids[items[r].j][q];
              const c = lent.get(d);
              if (c === undefined) continue;
              const [ya, yb] = s.rows(Territories.ref(d));
              const [x0, x1] = f.cell(items[i].f, items[e].l, ya, yb, 0, st);
              const h = px / 2 / sx;
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
