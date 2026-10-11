import { describe, expect, it } from 'vitest';
import { columnSpans, COLUMN_DIM } from './colstyle';
import { MODELLED_KINDS, noDataSpans } from './history';
import { layoutFan, type FanBranch } from './layout';
import { FELIDAE } from './panthera';
import { colSpansY } from './view';

const fan = layoutFan(FELIDAE, 'log');
const living = fan.branches.filter((b) => !b.sp.extinct);
const byName = (common: string) => fan.branches.find((b) => b.sp.common === common)!;

/** Ages (years before present) down a column, log-spaced from its start to a year ago. */
function ages(b: FanBranch): number[] {
  const out: number[] = [];
  const top = b.t0 * 1e6;
  for (let k = 0; k <= 400; k++) out.push(Math.pow(top, 1 - k / 400));
  return out;
}

/** The column's alive count at an age, in years. */
const alive = (b: FanBranch, yrs: number) => b.pop.aliveAt(yrs / 1e6);

describe('held (no-data) stretches on the fan columns (ToLaD#55)', () => {
  it('covers every living cat: no flat, figureless stretch of a column goes unmarked', () => {
    expect(living.length).toBeGreaterThanOrEqual(38);
    let marked = 0;
    for (const b of living) {
      const spans = columnSpans(b.sp, b.t0);
      const inHeld = (a: number) => spans.some((s) => a <= s.ago0 + 1e-6 && a >= s.ago1 - 1e-6);
      const h = b.sp.history;
      if (spans.length) marked++;
      for (const s of spans) {
        // Within the column, oldest first, never empty.
        expect(s.ago0, b.sp.common).toBeLessThanOrEqual(b.t0 * 1e6);
        expect(s.ago0, b.sp.common).toBeGreaterThan(s.ago1);
        expect(s.ago1, b.sp.common).toBeGreaterThanOrEqual(0);
        // Held flat: the column stays at the held level over it (history.ts noDataSpans' level; the Red List
        // count without a history), give or take its corner's fillet into the adjoining trend ...
        const nd = h && b.sp.births ? noDataSpans(h).find((x) => (x.side === 'before') === (s.ago1 > 0)) : null;
        const level = nd ? nd.level : b.sp.alive;
        for (let k = 1; k < 20; k++) {
          const a = s.ago0 + ((s.ago1 - s.ago0) * k) / 20;
          expect(Math.abs(Math.log(alive(b, a) / level)), `${b.sp.common} held at ${a} yr ago`).toBeLessThan(0.25);
        }
        // ... and no figure (cited or modelled) lies inside it.
        if (h && b.sp.births) for (const p of h.points) expect(inHeld(h.nowYear - p.year) && h.nowYear - p.year < s.ago0 - 1 && h.nowYear - p.year > s.ago1 + 1, `${b.sp.common} ${p.kind}@${p.year}`).toBe(false);
      }
      // The converse: where the column is flat with no figure near and no modelled curve, it is marked.
      if (!h || !b.sp.births) {
        // The Red List count held over the whole column.
        expect(spans, b.sp.common).toEqual([{ ago0: b.t0 * 1e6, ago1: 0, style: 'held' }]);
        continue;
      }
      const pts = h.points.map((p) => h.nowYear - p.year);
      const segAt = (a: number) => {
        let seg = h.segments[0];
        for (const s of h.segments) if (h.nowYear - s.year0 >= a) seg = s;
        return seg;
      };
      for (const a of ages(b)) {
        const lo = a / 1.05;
        const hi = a * 1.05;
        const flat = Math.abs(alive(b, lo) / alive(b, Math.min(hi, b.t0 * 1e6)) - 1) < 1e-3;
        const near = pts.some((p) => p >= lo && p <= hi);
        const seg = segAt(a);
        const modelled = MODELLED_KINDS.has(seg.kind) || seg.kind === 'genomic' || seg.kind === 'model';
        const between = a <= Math.max(...pts) && a >= Math.min(...pts);
        if (flat && !near && !modelled && !between) expect(inHeld(a), `${b.sp.common} flat at ${Math.round(a)} yr ago, unmarked`).toBe(true);
      }
    }
    expect(marked).toBeGreaterThanOrEqual(20);
  });

  it('every Panthera is held before its oldest genomic point, back to its start; held to now after its last figure where it has one', () => {
    // 'Puma': the Red List's English name for Puma concolor (the data's names since ToLaD#145; the hand table said Cougar).
    for (const c of ['Lion', 'Tiger', 'Leopard', 'Jaguar', 'Snow leopard', 'Puma', 'Cheetah']) {
      const b = byName(c);
      const h = b.sp.history!;
      const spans = columnSpans(b.sp, b.t0);
      const nd = noDataSpans(h);
      const p0 = h.points.slice().sort((a, x) => a.year - x.year)[0];
      // (Only where the column is older than the genomic curve: the lion's, leopard's and jaguar's columns start after it.)
      const before = b.t0 * 1e6 > h.nowYear - p0.year;
      if (before) expect(spans[0], c).toEqual({ ago0: b.t0 * 1e6, ago1: h.nowYear - p0.year, style: 'held' });
      expect(spans.length, c).toBe(nd.filter((s) => s.side === 'after').length + (before ? 1 : 0));
      const after = nd.find((s) => s.side === 'after');
      if (after) expect(spans[spans.length - 1], c).toEqual({ ago0: h.nowYear - after.year, ago1: 0, style: 'held' });
    }
    // Held in the deep past: tiger, snow leopard, cougar, cheetah; held to now: all but the lion and cougar (no figure since).
    for (const c of ['Tiger', 'Snow leopard', 'Puma', 'Cheetah']) expect(columnSpans(byName(c).sp, byName(c).t0)[0].ago0, c).toBeGreaterThan(1e5);
    for (const c of ['Tiger', 'Snow leopard', 'Leopard', 'Jaguar', 'Cheetah']) expect(columnSpans(byName(c).sp, byName(c).t0).at(-1)!.ago1, c).toBe(0);
  });

  it('modelled curves are not held: range-loss cats none, the domestic cat only after its last count', () => {
    for (const b of living.filter((x) => x.sp.history?.modelled === 'rangeloss')) expect(columnSpans(b.sp, b.t0), b.sp.common).toEqual([]);
    const dom = byName('Domestic cat');
    const nd = noDataSpans(dom.sp.history!);
    expect(nd.map((s) => s.side)).toEqual(['after']);
    // Its growth since domestication really moves (not a level held for want of figures).
    expect(alive(dom, 5000) / alive(dom, 500)).toBeLessThan(0.5);
  });

  it('the view draws them world-fixed: one [top, bottom, dim] per span, in world y', () => {
    const b = byName('Leopard');
    const ys = colSpansY(fan, b);
    const spans = columnSpans(b.sp, b.t0);
    expect(ys).toEqual(spans.map((s) => [fan.time.y(s.ago1 / 1e6), fan.time.y(s.ago0 / 1e6), COLUMN_DIM.held]));
    for (const [t, bt, d] of ys) {
      expect(bt).toBeGreaterThan(t);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(1);
    }
    expect(colSpansY(fan, b)).toBe(ys); // cached: no per-frame work
  });
});
