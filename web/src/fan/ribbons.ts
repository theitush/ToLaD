// The merged clades' ribbons (lod.ts) as world-space rows kept per layout (ToLaD#502, step 1).
//
// A merged clade's ribbon at grid row k is its strands' hull there (Fold.extent: a walk over every strand in it) and
// their green share (Lod.greenShareAt: another). Neither depends on the camera, only on the layout (the fold's
// openness, `ver`) and the grid (`gridH`), so they are worked out once a row and kept, in world units, until either
// changes: a pan or a time-only zoom reads them back, and a frame turns them into screen points (view.ts drawMerged,
// through the camera) without walking a single strand. A clade whose rows on screen lie wholly off it to the side is
// known from those rows alone (Rows.hull), before any point is made.
//
// The points stay the canvas path view.ts has always made (screen space: the ribbon's inset, the forks' cuts and the
// peels' steps are measured in pixels), so the look is the same to the bit; what is kept is the world geometry under it.
//
// (The width zoom opens the gaps (fold.ts setScale bumps `ver`), so a pinch that changes the width scale still
// rebuilds the rows on screen once a frame; the rooms answered by range, step 2, is what makes that rebuild cheap.
// A grid change is no layout change: the rows are kept by height across a coarser grid, Ribbons.)

import type { Fold } from './fold';
import type { FanNode } from './layout';
import type { Lod } from './lod';

/** Rows a chunk holds (a clade's rows are kept in chunks of this many, by k). */
const CH = 64;

/** One merged clade's rows at one layout and grid: per chunk (k / CH), [left, right, green] a row, NaN until asked. */
export class Rows {
  readonly chunks = new Map<number, Float64Array>();
  constructor(
    private readonly owner: Ribbons,
    readonly v: FanNode,
    private readonly i0: number,
    private readonly i1: number,
  ) {}

  /** Row k's chunk (a, made all unasked when new) and its offset in it (j); the last chunk asked kept before the map. */
  private at(k: number): void {
    // (k on the grid drawn; kept by its row on the finest grid since the layout's (Ribbons.step): the same height.)
    k *= this.owner.step;
    const c = Math.floor(k / CH);
    if (c !== this.c || !this.a) {
      let a = this.chunks.get(c);
      if (!a) this.chunks.set(c, (a = this.owner.chunk()));
      this.a = a;
      this.c = c;
    }
    this.j = 3 * (k - c * CH);
  }
  private a: Float64Array | null = null;
  private c = NaN;
  private j = 0;

  /** Row k's [left, right] (world) into out. */
  row(k: number, out: [number, number]): [number, number] {
    this.at(k);
    const a = this.a!;
    const j = this.j;
    if (a[j] !== a[j]) {
      this.owner.fold!.extent(this.i0, this.i1, k, out);
      a[j] = out[0];
      a[j + 1] = out[1];
    } else {
      out[0] = a[j];
      out[1] = a[j + 1];
    }
    return out;
  }

  /** Row k's green share (Lod.greenShareAt; asked only of rows drawn, not of those the hull only reads). */
  green(k: number): number {
    this.at(k);
    const a = this.a!;
    const j = this.j + 2;
    if (a[j] !== a[j]) a[j] = this.owner.lod!.greenShareAt(this.v, k, this.owner.fold!.gridH);
    return a[j];
  }

  /** The hull (world [least left, greatest right]) of rows k0..k1 into out, as drawMerged's points span it. */
  hull(k0: number, k1: number, out: [number, number]): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = k0; k <= k1; k++) {
      this.row(k, out);
      const l = out[0];
      const r = Math.max(l, out[1]);
      if (l < lo) lo = l;
      if (r > hi) hi = r;
    }
    out[0] = lo;
    out[1] = hi;
    return out;
  }
}

/** Rows kept across a grid this many times coarser than the finest asked since the layout's; past it, made again. */
const KEEP_STEPS = 4;
/** Whether the rows outlast a coarser grid (ToLaD#502); off, they are made again at every grid change, as before (tests). */
let keepAcross = true;
export function setRibbonsKeep(on: boolean): void {
  keepAcross = on;
}

/**
 * Every merged clade's rows at the layout they were asked at, by height; dropped (their chunks pooled) when it changes.
 *
 * A row is a height (y = k * gridH), and the grids are powers of two, so a coarser grid's rows are a finer one's. The rows
 * are kept by their place on the finest grid asked since the layout (`H0`): the grid's change at a gesture's start and
 * end (twice as coarse while the fold moves, view.ts applyFold) and a pinch out read the rows already made, where each
 * made every clade's rows on screen again. A finer grid than H0 (a pinch in), or one more than KEEP_STEPS coarser,
 * starts again from it.
 */
export class Ribbons {
  fold: Fold | null = null;
  lod: Lod | null = null;
  private ver = -1;
  private H = NaN;
  /** The finest grid since the layout's, and the grid drawn's rows' step on it (H / H0). */
  private H0 = NaN;
  step = 1;
  private readonly by = new Map<FanNode, Rows>();
  private readonly pool: Float64Array[] = [];

  /** Clade v's rows (strands i0..i1) at fold f's layout and grid. */
  of(f: Fold, lod: Lod, v: FanNode, i0: number, i1: number): Rows {
    if (f !== this.fold || lod !== this.lod || f.ver !== this.ver) this.reset(f, lod);
    else if (f.gridH !== this.H) {
      const s = f.gridH / this.H0;
      if (keepAcross && s >= 1 && s <= KEEP_STEPS) {
        this.H = f.gridH;
        this.step = s;
      } else this.reset(f, lod);
    }
    let r = this.by.get(v);
    if (!r) this.by.set(v, (r = new Rows(this, v, i0, i1)));
    return r;
  }

  /** A chunk of rows, all unasked. */
  chunk(): Float64Array {
    return (this.pool.pop() ?? new Float64Array(3 * CH)).fill(NaN);
  }

  private reset(f: Fold, lod: Lod): void {
    for (const r of this.by.values()) for (const a of r.chunks.values()) this.pool.push(a);
    this.by.clear();
    this.fold = f;
    this.lod = lod;
    this.ver = f.ver;
    this.H = this.H0 = f.gridH;
    this.step = 1;
  }
}
