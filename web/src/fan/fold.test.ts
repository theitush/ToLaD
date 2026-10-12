// The fold (ToLaD#146): one branch from afar, opening continuously as the width zoom grows.
import { describe, expect, it } from 'vitest';
import { Fold, inFamily, LEAN_CUT, leanFade, ROOM_BEND, SY_HOME } from './fold';
import { familySpan } from './view';
import { columnsAt, g, laneAt, layoutFan, leftAt, TIME_H, type EdgeStyle, type Fan, type FanBranch, type WidthMode } from './layout';
import { CARNIVORA, FELIDAE } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE } from './splits';

const SCREEN = 390;
const fans = new Map<string, Fan>();
function folded(mode: WidthMode, edge: EdgeStyle): { fan: Fan; fold: Fold; home: number } {
  const key = `${mode}:${edge}`;
  let fan = fans.get(key);
  if (!fan) fans.set(key, (fan = layoutFan(CARNIVORA, mode, CARNIVORA_TREE, edge)));
  const fold = new Fold(fan);
  fan.tess.fold = fold;
  // Home frames the closed order (camera.ts frame: 72 px of margins, 4% of slack).
  const [x0, x1] = fold.homeExtent();
  const home = (SCREEN - 72) / ((x1 - x0) * 1.04);
  return { fan, fold, home };
}
const heights = (fan: Fan, n: number) => Array.from({ length: n + 1 }, (_, k) => -TIME_H + ((fan.trunkBottom.y + TIME_H) * k) / n);
const ZOOMS = [1, 1.3, 2.2, 5, 14, 50, 120];
/**
 * A bend's least height on screen (px), and the share of the order's width at home that may be a hole: the
 * widest-ever rooms left 32% at 1 kya (linear: the domestic cat's billions) and ~2% elsewhere; a stretch's room
 * is its widest within ROOM_BAND (a 23% hole at most in a column that booms or crashes), the order's ~3% at most.
 */
const MIN_BEND_PX = 40;
const FAMILY_K = 4;
const FAMILY_MIN_PX = 8;
const MAX_GAP_SHARE = 0.05;
/** The share of the order's width at height y that no column covers. */
function gapShare(fan: Fan, y: number): number {
  const cs = columnsAt(fan, y).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let u = 0;
  let e = -Infinity;
  for (const [a, b] of cs) {
    const s = Math.max(a, e);
    if (b > s) u += b - s;
    e = Math.max(e, b);
  }
  return 1 - u / (e - cs[0][0]);
}
const centre = (b: FanBranch, y: number) => leftAt(b, y) + laneAt(b, y).w / 2;
/** Where a column stands: its centre, or a boom's inner edge (it flares into its own side, fold.ts). */
const stands = (b: FanBranch, y: number) => {
  const f = b.tess.fold!.flare[b.index];
  return f ? leftAt(b, y) + (f < 0 ? laneAt(b, y).w : 0) : centre(b, y);
};

/** Where the fold moves columns sideways (its events): each peel, each bend of a room, each extinct line's end, each parent column's peel. */
function events(fan: Fan, fold: Fold): [number, number][] {
  const out: [number, number][] = [];
  const n = fan.root.strands.length;
  for (const b of fan.branches) {
    out.push([b.leanY, b.splitY]);
    // (A boom that flares out over the order's edge (the dog, the cat: fold.ts flare) moves nothing but its own
    // outer edge as its room bends: its room's changes are no event for the rest, which stand still through them.)
    const f = fold.flare[b.index];
    if (!((f < 0 && b.index === 0) || (f > 0 && b.index === n - 1))) out.push(...fold.roomBends(b));
  }
  for (const v of fan.nodes) if (v.parent) out.push([v.leanY, v.yBot]);
  out.push(...fold.forks());
  return out.sort((p, q) => p[0] - q[0]);
}
/** The stretches between events (each a few heights inside it), at most n of them, the longest. */
function between(fan: Fan, fold: Fold, n: number): number[][] {
  const ev = events(fan, fold);
  const free: [number, number][] = [];
  let at = -TIME_H;
  for (const [a, b] of ev) {
    if (a > at) free.push([at, a]);
    at = Math.max(at, b);
  }
  if (fan.trunkBottom.y > at) free.push([at, fan.trunkBottom.y]);
  return free
    .sort((p, q) => q[1] - q[0] - (p[1] - p[0]))
    .slice(0, n)
    .map(([a, b]) => [0.02, 0.5, 0.98].map((t) => a + (b - a) * t));
}

describe('the fold', () => {
  for (const [mode, edge] of [
    ['log', 'curved'],
    ['linear', 'curved'],
    ['log', 'straight'],
  ] as [WidthMode, EdgeStyle][]) {
    it(`home: each family one branch (its splits closed), the families apart, the rooms side by side, standing on the stem's centre (${mode}, ${edge})`, () => {
      const { fan, fold, home } = folded(mode, edge);
      fold.setScale(home, SCREEN);
      for (let i = 0; i < fold.a.length; i++) expect(fold.a[i]).toBe(fold.pairFam[i] ? 0 : 1);
      for (const y of heights(fan, 160)) {
        const cs = columnsAt(fan, y).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
        for (let i = 1; i < cs.length; i++) expect(cs[i][0]).toBeGreaterThanOrEqual(cs[i - 1][1] - 1e-9 * fan.trunkWidth);
      }
      // "Now" stands on the stem's centre: its strands' mean slot centre (an own column's: its room's).
      const y0 = fan.time.y(0);
      const c = fan.root.strands.map((b) => (y0 < b.splitY ? centre(b, y0) : leftAt(b, y0) + b.baseW / 2));
      expect(c.reduce((t, x) => t + x, 0) / c.length).toBeCloseTo(fold.home, 6);
    });

    it(`at every zoom the columns never overlap or cross (${mode}, ${edge})`, () => {
      const { fan, fold, home } = folded(mode, edge);
      const ys = heights(fan, 200);
      let worst = 0;
      for (const z of ZOOMS) {
        fold.setScale(home * z, SCREEN);
        fold.setAnchor(fold.home, fan.time.y(1), home * z, SCREEN);
        for (const y of ys) {
          const cs = columnsAt(fan, y).sort((p, q) => p[0] - q[0]);
          for (let i = 1; i < cs.length; i++) worst = Math.max(worst, cs[i - 1][1] - cs[i][0]);
        }
      }
      expect(worst).toBeLessThan(1e-9 * fan.trunkWidth);
    });

    it(`columns move sideways only at the tree's events: between them every column stands straight (${mode}, ${edge})`, () => {
      const { fan, fold, home } = folded(mode, edge);
      const runs = between(fan, fold, 40);
      let worst = 0;
      for (const z of [1, 3, 20]) {
        fold.setScale(home * z, SCREEN);
        fold.setAnchor(fold.home, fan.time.y(2), home * z, SCREEN);
        for (const ys of runs) {
          for (const b of fan.branches) {
            if (!(ys[0] > b.tipY)) continue;
            const x = ys.map((y) => (y < b.splitY ? stands(b, y) : leftAt(b, y)) * home * z);
            worst = Math.max(worst, Math.max(...x) - Math.min(...x));
          }
        }
      }
      expect(worst).toBeLessThan(1e-6);
      // (Linear: the domestic cat's and dog's booms leave few stretches where the whole order holds still; the deep-zoom test checks each column's own.
      // Log: the dog's split from the wolf, its fork and the wolf's peel fall in what was the third still stretch: events of the tree.)
      expect(runs.length).toBeGreaterThanOrEqual(mode === 'linear' ? 1 : 2);
    });

    it(`edges are continuous in time at every zoom: no jog at a split, a tip or a fork (${mode}, ${edge})`, () => {
      const { fan, fold, home } = folded(mode, edge);
      const yb = fan.trunkBottom.y;
      let jog = 0;
      // Every strand's neighbours' tips and splits (where a row changes its columns), each strand's own.
      const marks = new Set<number>();
      for (const b of fan.branches) {
        if (b.tipY > -TIME_H) marks.add(b.tipY);
        marks.add(b.splitY);
        marks.add(b.leanY);
      }
      for (const z of [1.7, 8]) {
        fold.setScale(home * z, SCREEN);
        for (const y of marks) {
          if (!(y < yb - 1e-6)) continue;
          // (A height's row at a time: the fold works out one row per height.)
          const bs = fan.branches.filter((b) => y - 1e-7 >= b.tipY);
          const e = (yy: number) => bs.map((b) => [leftAt(b, yy), laneAt(b, yy).w]);
          const a = e(y - 1e-7);
          const c = e(y + 1e-7);
          for (let i = 0; i < bs.length; i++) {
            jog = Math.max(jog, Math.abs(a[i][0] - c[i][0]), Math.abs(a[i][0] + a[i][1] - c[i][0] - c[i][1]));
          }
        }
      }
      expect(jog).toBeLessThan(1e-4 * fan.trunkWidth);
    });
  }

  it('the opening is continuous in the zoom, width is untouched, and the order\'s halves open before the families', () => {
    const { fan, fold, home } = folded('log', 'curved');
    // A pinch (1% a frame) about a column: the columns on screen around it move a few px a frame at most.
    const ys = heights(fan, 8).slice(1, -1);
    let worst = 0;
    let found = 0;
    for (const name of ['Canis lupus', 'Panthera leo', 'Phoca vitulina']) {
      const A = fan.branches.find((b) => b.sp.sci === name);
      if (!A) continue;
      found++;
      let prev: number[] | null = null;
      for (let k = 0; k <= 320; k++) {
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
    for (const b of fan.branches.slice(0, 30)) expect(laneAt(b, b.tipY + 1).w).toBeCloseTo(b.unit * g(b.pop.aliveAt(fan.time.ageAt(b.tipY + 1)), 'log'), 9);
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
  });

  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`deep zoom: the column under the screen's centre stands still over its own span, but at the events on screen (${mode})`, () => {
      const { fan, fold, home } = folded(mode, 'curved');
      for (const name of ['Canis lupus', 'Panthera leo', 'Phoca vitulina']) {
        const b = fan.branches.find((q) => q.sp.sci === name)!;
        for (const z of [6, 20, 60]) {
          const sx = home * z;
          fold.setAll(0);
          fold.setScale(sx, SCREEN);
          const y0 = fan.time.y(0);
          const y1 = b.leanY;
          const cy = (y0 + y1) / 2;
          fold.setAnchor(centre(b, cy), cy, sx, SCREEN);
          // The strands on screen there (within half a screen of it; an extinct one at its last), and their events.
          const near = new Set(
            fan.branches.filter((q) => {
              const y = Math.max(cy, q.tipY + 1e-9);
              return y <= y1 && Math.abs(centre(q, y) - centre(b, y)) * sx < SCREEN / 2;
            }),
          );
          const nodes = fan.nodes.filter((v) => v.parent && v.strands.some((q) => near.has(q)));
          const inNear = (y: number) =>
            nodes.some((v) => y >= Math.min(v.leanY, v.y - ROOM_BEND) && y <= v.yBot) ||
            [...near].some((q) => (y >= q.leanY && y <= q.splitY) || fold.roomBends(q, false).some(([lo, hi]) => y >= lo && y <= hi));
          // Over each stretch between those events (a sister's end or split moves it, honestly: nothing else may;
          // not even a neighbour booming past its room, the domestic dog's billions beside the wolf).
          let lo = Infinity;
          let hi = -Infinity;
          let worst = 0;
          let runs = 0;
          for (let k = 0; k <= 300; k++) {
            const y = y0 + ((y1 - y0) * k) / 300;
            if (inNear(y)) {
              if (hi >= lo) runs++;
              lo = Infinity;
              hi = -Infinity;
              continue;
            }
            const c = centre(b, y) * sx;
            lo = Math.min(lo, c);
            hi = Math.max(hi, c);
            worst = Math.max(worst, hi - lo);
          }
          expect(worst, `${name} at ${z}x`).toBeLessThan(0.5);
          expect(runs + (hi >= lo ? 1 : 0)).toBeGreaterThan(0);
        }
      }
    });
  }

  for (const mode of ['linear', 'log'] as WidthMode[]) {
    it(`no ledge: every change of a room is a bend at least ${MIN_BEND_PX} px tall at zooms 1, 3 and 20 (${mode})`, () => {
      const { fan, fold, home } = folded(mode, 'curved');
      // The phone's home time scale (camera.ts frame: 270 px of margins above and below).
      const syHome = (844 - 270) / TIME_H;
      fold.setScale(home, SCREEN);
      const dy = 0.25;
      let worst = Infinity;
      let bends = 0;
      for (const z of [1, 3, 20]) {
        const sx = home * z;
        const sy = syHome * z;
        // Runs of change (pauses under 2 px bridged), each that moves its room by 2 px or more (a smaller jog is no ledge): their heights.
        for (const b of fan.branches) {
          const top = Math.max(b.tipY - Fold.endH(b), -TIME_H);
          let start = NaN;
          let last = NaN;
          let lo = Infinity;
          let hi = -Infinity;
          const close = () => {
            if (hi - lo >= 2 / sx) {
              worst = Math.min(worst, (start - last) * sy);
              bends++;
            }
            start = NaN;
            lo = Infinity;
            hi = -Infinity;
          };
          let prev = fold.roomAt(b, b.splitY - 1e-9);
          for (let y = b.splitY - dy; y > top; y -= dy) {
            const r = fold.roomAt(b, y);
            if (Math.abs(r - prev) * sx > 1e-4) {
              if (!(start === start)) start = y + dy;
              if ((last - y - dy) * sy > 2) {
                close();
                start = y + dy;
              }
              last = y;
              lo = Math.min(lo, prev, r);
              hi = Math.max(hi, prev, r);
            }
            prev = r;
          }
          if (start === start) close();
        }
      }
      // (A crash no longer steps a room, a boom does: a few bends.)
      expect(bends).toBeGreaterThan(5);
      expect(worst).toBeGreaterThanOrEqual(MIN_BEND_PX);
    });

    it(`the rooms leave no holes: the gaps are under ${MAX_GAP_SHARE * 100}% of the order's width at every height (${mode})`, () => {
      const { fan, fold } = folded(mode, 'curved');
      // (The holes the rooms leave: every split closed, the families' gaps too.)
      fold.setAll(0, true);
      for (const age of [0, 1e-4, 1e-3, 0.01, 0.1, 0.5, 1, 3, 10, 30]) {
        expect(gapShare(fan, fan.time.y(age)), `${age} Ma`).toBeLessThan(MAX_GAP_SHARE);
      }
    });
  }

  it(`home: the families stand apart, at least ${FAMILY_K}x further than any two species inside a family (and ${FAMILY_MIN_PX} px); zooming in, the species part`, () => {
    for (const mode of ['log', 'linear'] as WidthMode[]) {
      const { fan, fold, home } = folded(mode, 'curved');
      const y = fan.time.y(0);
      const alive = fan.root.strands.filter((b) => b.tipY <= y);
      const gaps = (z: number) => {
        fold.setScale(home * z, SCREEN);
        fold.setAnchor(fold.home, y, home * z, SCREEN);
        let fam = Infinity;
        let inner = 0;
        let innerN = 0;
        let innerOpen = 0;
        for (let i = 1; i < alive.length; i++) {
          const p = alive[i - 1];
          const q = alive[i];
          const g = (leftAt(q, y) - leftAt(p, y) - laneAt(p, y).w) * home * z;
          const v = fan.nodes.filter((n) => n.strands.includes(p) && n.strands.includes(q)).sort((m, n) => m.ageMa - n.ageMa)[0];
          if (inFamily(v)) {
            inner = Math.max(inner, g);
            innerN++;
            if (g > 1) innerOpen++;
          } else fam = Math.min(fam, g);
        }
        return { fam, inner, open: innerOpen / innerN };
      };
      const h = gaps(1);
      console.log(mode, JSON.stringify([1, 3, 15].map((z) => gaps(z))));
      expect(h.fam).toBeGreaterThanOrEqual(FAMILY_MIN_PX);
      expect(h.fam).toBeGreaterThanOrEqual(FAMILY_K * h.inner);
      // Zooming in, more and more of the species inside the families part (a gap over 1 px).
      expect(gaps(3).open).toBeGreaterThan(h.open);
      expect(gaps(15).open).toBeGreaterThan(gaps(3).open);
    }
  });

  it('weasels opened (the ferret badgers first): each column straight between its own lineage\'s splits, moving sideways only at one (not at a cousin\'s, no lean over a decade)', () => {
    for (const mode of ['log', 'linear'] as WidthMode[]) {
      const { fan, fold, home } = folded(mode, 'curved');
      const fam = fan.nodes.find((n) => n.split.taxon === 'Mustelidae')!;
      const groups = [fam.strands.filter((b) => /^Melogale /.test(b.sp.sci)), fam.strands];
      expect(groups[0].length).toBeGreaterThan(3);
      for (const z of [8, 20]) {
        const sx = home * z;
        fold.setScale(sx, SCREEN);
        // (The events inside the family: its forks. Its columns' peels and room bends move their neighbours by
        // their rooms' change, a few px at most over a bend: under 0.3 px a step.)
        // (Only its own lineage's: the splits on its path. A cousin's fork closing leaves it standing.)
        const forks = fold.forks();
        // (And the family's peels: a room growing from its founders' slot is a width's change, not a gap's.)
        const peels = fam.strands.map((c) => fold.roomBends(c, false)[0]);
        const evOf = (b: FanBranch) => [...peels, ...forks.filter((_, p) => b.path.some((s) => s.node === fold.pairNode[p]))];
        for (const g of groups) {
          const y0 = fan.time.y(0);
          const cx = g.reduce((s, b) => s + centre(b, y0), 0) / g.length;
          fold.setAnchor(cx, fan.time.y(1), sx, SCREEN);
          fold.setAnchor(cx, fan.time.y(1), sx, SCREEN);
          let worst = 0;
          let nFree = 0;
          let nAll = 0;
          for (const b of g) {
            const ev = evOf(b);
            const free = (y: number) => !ev.some(([a, c]) => y >= a - 1e-6 && y <= c + 1e-6);
            let prev = NaN;
            for (let y = Math.max(b.tipY, y0); y < b.splitY; y += 2) {
              nAll++;
              if (!free(y)) {
                prev = NaN;
                continue;
              }
              nFree++;
              const x = centre(b, y) * sx;
              if (prev === prev) worst = Math.max(worst, Math.abs(x - prev));
              prev = x;
            }
          }
          expect(worst, `${mode} z${z} ${g.length}`).toBeLessThan(0.3);
          // (And the events are short: most of each column's span is straight.)
          expect(nFree / nAll).toBeGreaterThan(0.7); // (its forks and the family's peels: 0.77 at z20)
        }
      }
    }
  });

  it(`zoomed into the weasels, a bend runs at most ${LEAN_CUT} px across per px of height where drawn (leanFade): the columns on screen keep all their bends, the far families' near-flat closings are culled (ToLaD#210)`, () => {
    for (const mode of ['log', 'linear'] as WidthMode[]) {
      const { fan, fold, home } = folded(mode, 'curved');
      const g = fan.branches.filter((b) => /^Mustela /.test(b.sp.sci));
      for (const z of mode === 'log' ? [20] : [8, 20]) {
        const sx = home * z;
        fold.setScale(sx, SCREEN);
        const y0 = fan.time.y(0);
        const cx = g.reduce((s, b) => s + centre(b, y0), 0) / g.length;
        fold.setAnchor(cx, fan.time.y(1), sx, SCREEN);
        fold.setAnchor(cx, fan.time.y(1), sx, SCREEN);
        const px = (x: number) => (x - cx) * sx + SCREEN / 2;
        const sy = SY_HOME * 1.6;
        let worstOwn = 0;
        let worstAt = '';
        let culled = 0;
        for (const b of fan.branches) {
          const own = g.includes(b);
          let px0 = NaN;
          for (let y = Math.max(b.tipY, y0); y < fan.root.y; y += 2) {
            const x = px(centre(b, y));
            if (px0 === px0 && Math.min(x, px0) < SCREEN && Math.max(x, px0) > 0) {
              const s = Math.abs(x - px0) / (2 * sy);
              const f = leanFade(x - px0, 2 * sy);
              // (Drawn: within the bound.)
              if (f > 0) expect(s).toBeLessThan(LEAN_CUT);
              else culled++;
              if (own && y < b.splitY && 1 - f > worstOwn) {
                worstOwn = 1 - f;
                worstAt = `${b.sp.sci} ${fan.time.ageAt(y).toFixed(2)} Ma ${s.toFixed(1)}`;
              }
            }
            px0 = x;
          }
        }
        // (The weasels' own columns, down to their splits, are never culled; something far is, zoomed in.)
        expect(worstOwn, `${mode} z${z} ${worstAt}`).toBe(0);
        if (z >= 20) expect(culled, `${mode} z${z}`).toBeGreaterThan(0);
      }
    }
  }, 240_000);

  it('dogs x15: the columns stand still over 100-500 yr (no neighbour\'s decline or boom slants them), the wolf too; the families beside stand still while the dogs open', () => {
    for (const mode of ['log', 'linear'] as WidthMode[]) {
      const { fan, fold, home } = folded(mode, 'curved');
      const v = fan.nodes.find((n) => n.split.taxon === 'Canidae')!;
      const wolf = v.strands.find((b) => b.sp.sci === 'Canis lupus')!;
      const sx = home * 15;
      fold.setScale(sx, SCREEN);
      const [a, b] = familySpan(v);
      fold.setAnchor((a + b) / 2, fan.time.y(1), sx, SCREEN);
      const px = (s: FanBranch, t: number) => stands(s, fan.time.y(t)) * sx;
      for (const s of v.strands) {
        if (s.tipY > fan.time.y(5e-4)) continue;
        const xs = [1e-4, 2e-4, 3e-4, 5e-4].map((t) => px(s, t));
        expect(Math.max(...xs) - Math.min(...xs), s.sp.sci).toBeLessThan(0.5);
      }
      const w = [1e-4, 5e-4].map((t) => px(wolf, t));
      expect(Math.abs(w[1] - w[0])).toBeLessThan(0.5);
      // The families beside the dogs: the dogs' opening moves them by one amount at every height from the dogs'
      // crown up (their room, kept from their split), not with each of the dogs' splits.
      const S = fan.root.strands;
      const inDogs = Array.from(fold.a, (_, p) => v.strands.includes(S[p]) && v.strands.includes(S[p + 1]));
      const at = (s: FanBranch, open: boolean) => {
        const keep = Float64Array.from(fold.a);
        if (!open) inDogs.forEach((d, p) => d && (fold.a[p] = 0));
        fold.ver++;
        const xs = [0, 1e-3, 0.1, 1, 3, 10].map((t) => px(s, t));
        fold.a.set(keep);
        fold.ver++;
        return xs;
      };
      for (const s of [S[v.strands[0].index - 1], S[v.strands[v.strands.length - 1].index + 1]]) {
        if (!s) continue;
        const o = at(s, true);
        const c = at(s, false);
        const d = o.map((x, k) => x - c[k]);
        expect(Math.max(...d) - Math.min(...d), s.sp.sci).toBeLessThan(2);
        expect(Math.max(...d.map(Math.abs)), s.sp.sci).toBeGreaterThan(20);
      }
    }
  });

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

  it('xRange, folded on a grid (read off the rows, every strand at once): holds each strand at every height in the range', () => {
    for (const mode of ['log', 'linear'] as WidthMode[]) {
      const { fan, fold, home } = folded(mode, 'curved');
      const yb = fan.trunkBottom.y;
      const dogs = fan.nodes.find((n) => n.split.taxon === 'Canidae')!;
      const [a, b] = familySpan(dogs);
      for (const [z, sy] of [
        [1, SY_HOME],
        [15, SY_HOME * 40],
      ]) {
        const sx = home * z;
        fold.setScale(sx, SCREEN);
        if (z > 1) fold.setAnchor((a + b) / 2, fan.time.y(1), sx, SCREEN);
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
