// The merged clades' green shares (lod.ts greenShareAt) as range sums over the strands, kept per grid row (ToLaD#502).
//
// A merged clade's green share at world y is its strands' green widths over their widths there (lanesAt). It depends on
// the fan alone, never on the camera or the fold's openness: only which heights are asked moves, with the time zoom (the
// grid's rows, y = k * gridH, gridH a power of two: a coarser grid's rows are a finer one's). And a clade's strands are
// one run i0..i1 of the tree order (FanBranch.index), so its sums are a range's sums over a row's strands.
//
// So each row asked keeps a segment tree over the tree order: the sums of every aligned block of BLOCK strands, of every
// pair of those, and so on up, each worked out the first time a clade covering it is asked (blocks smaller than BLOCK are
// summed from their strands, not kept). A clade that parts as the zoom goes in, or a parent that closes again as it comes
// out, then reads O(log n) blocks and at most 2 BLOCK strands at its ends, where it walked every strand it has, at every
// row, each time the merged clades changed. A row's strands are worked out at its age, found once a row (lanesAtAge).
//
// A clade holding no whole block (most merged clades at home) is summed from its strands, left to right, as before: the
// same share to the bit. A bigger one's are the same terms added in another order (block by block): the same to ~1e-14.

import { lanesAtAge, type Fan, type FanBranch, type TimeScale } from './layout';

/** Strands in a kept block at the least: shorter runs are summed from their strands. */
const BLOCK = 32;
/** The rows' kept sums take at most about this many bytes; past it they are all dropped and worked out again as asked. */
const BYTES = 64 * 2 ** 20;

/** Per grid row asked (by world y), the green and whole widths of the strands' aligned blocks. */
export class GreenRuns {
  /** The strands in tree order (S[i].index === i). */
  private readonly S: FanBranch[];
  private readonly n: number;
  /** Leaves: the strands, padded to a power of two (one block at the least). */
  private readonly P: number;
  /** A row's kept blocks: the segment tree's nodes 1 .. M - 1 (heap order: those of BLOCK strands or more), [w, g] each. */
  private readonly M: number;
  /** Rows kept at most. */
  private readonly cap: number;
  private readonly rows = new Map<number, Float64Array>();
  private readonly pool: Float64Array[] = [];
  private readonly time: TimeScale;
  /** The row being read: its height, age and blocks. */
  private y = NaN;
  private age = 0;
  private T: Float64Array = new Float64Array(0);
  /** A query's sums so far. */
  private sw = 0;
  private sg = 0;
  /** A run's sums (run()). */
  private rw = 0;
  private rg = 0;
  private readonly lane = new Float64Array(2);

  constructor(fan: Fan) {
    const all = fan.root.strands;
    this.n = all.length;
    this.S = new Array<FanBranch>(this.n);
    for (const b of all) this.S[b.index] = b;
    let P = BLOCK;
    while (P < this.n) P *= 2;
    this.P = P;
    this.M = (2 * P) / BLOCK;
    this.cap = Math.max(64, Math.floor(BYTES / (16 * this.M)));
    this.time = all[0]?.tess.time ?? fan.time;
  }

  /** Strands i0..i1's green share at world y (lanesAt's green widths over their widths; 0 with no width). */
  share(i0: number, i1: number, y: number): number {
    this.row(y);
    // (A run holding no whole block, as most merged clades at home are: its strands summed straight, left to right, as before.)
    if (Math.ceil(i0 / BLOCK) * BLOCK + BLOCK > i1 + 1) {
      this.run(i0, i1 + 1);
      return this.rw > 0 ? Math.min(1, this.rg / this.rw) : 0;
    }
    this.sw = 0;
    this.sg = 0;
    this.add(1, 0, this.P, i0, i1 + 1);
    return this.sw > 0 ? Math.min(1, this.sg / this.sw) : 0;
  }

  /** Row y's blocks, made (none worked out, its age in T[0], no node's) if new. */
  private row(y: number): void {
    if (y === this.y) return;
    let T = this.rows.get(y);
    if (!T) {
      if (this.rows.size >= this.cap) {
        for (const a of this.rows.values()) this.pool.push(a);
        this.rows.clear();
      }
      T = (this.pool.pop() ?? new Float64Array(2 * this.M)).fill(NaN);
      T[0] = this.time.ageAt(y);
      this.rows.set(y, T);
    }
    this.T = T;
    this.y = y;
    this.age = T[0];
  }

  /** Strands a..b - 1's sums at the row into the query's: node t covers lo..hi - 1. */
  private add(t: number, lo: number, hi: number, a: number, b: number): void {
    if (b <= lo || hi <= a) return;
    if (a <= lo && hi <= b) {
      this.block(t, lo, hi);
      this.sw += this.T[2 * t];
      this.sg += this.T[2 * t + 1];
      return;
    }
    if (hi - lo <= BLOCK) {
      this.run(Math.max(a, lo), Math.min(b, hi));
      this.sw += this.rw;
      this.sg += this.rg;
      return;
    }
    const mid = (lo + hi) >> 1;
    this.add(2 * t, lo, mid, a, b);
    this.add(2 * t + 1, mid, hi, a, b);
  }

  /** Kept node t's sums (strands lo..hi - 1), worked out if not yet. */
  private block(t: number, lo: number, hi: number): void {
    const T = this.T;
    if (T[2 * t] === T[2 * t]) return;
    if (hi - lo <= BLOCK) {
      this.run(lo, Math.min(hi, this.n));
      T[2 * t] = this.rw;
      T[2 * t + 1] = this.rg;
      return;
    }
    const mid = (lo + hi) >> 1;
    this.block(2 * t, lo, mid);
    this.block(2 * t + 1, mid, hi);
    T[2 * t] = T[4 * t] + T[4 * t + 2];
    T[2 * t + 1] = T[4 * t + 1] + T[4 * t + 3];
  }

  /** Strands a..b - 1's sums at the row, from the strands, into rw and rg. */
  private run(a: number, b: number): void {
    const S = this.S;
    const y = this.y;
    const L = this.lane;
    const tm = this.time;
    let w = 0;
    let g = 0;
    for (let i = a; i < b; i++) {
      const s = S[i];
      if (y < s.tipY) continue;
      lanesAtAge(s, y, s.tess.time === tm ? this.age : s.tess.time.ageAt(y), L, 0);
      w += L[0];
      g += L[1];
    }
    this.rw = w;
    this.rg = g;
  }
}
