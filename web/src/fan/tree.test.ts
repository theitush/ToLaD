// The dated tree (#46): splits at their table dates, widths adding up at every
// split, extinct branches gray above their split, parent columns green by the
// genealogy recurrence on the summed population, geometry fixed in the world.
import { describe, expect, it } from 'vitest';
import { FanCamera } from './camera';
import { columnsAt, isNode, laneAt, layoutFan, leftAt, nodeLeft, nodeQ, type Fan, type FanBranch, type FanNode, type WidthMode } from './layout';
import { PANTHERA } from './panthera';
import { parentShare, Q_STAR, TAPER_C } from './population';
import { allSplits, PANTHERA_TREE, speciesUnder } from './splits';
import { TwigModel } from './twigs';

function camera(mode: WidthMode): FanCamera {
  const fan = layoutFan(PANTHERA, mode);
  const models = new Map<FanBranch, TwigModel>();
  const model = (b: FanBranch) => {
    let m = models.get(b);
    if (!m) models.set(b, (m = new TwigModel(b, fan.time, mode)));
    return m;
  };
  const c = new FanCamera(fan, model);
  c.w = 390;
  c.h = 844;
  c.cam = c.home();
  c.settle();
  return c;
}

const MODES: WidthMode[] = ['log', 'linear'];
/** A hair above / below a height (relative, so it survives the log axis). */
const above = (y: number) => y - 1e-7 * Math.max(1, Math.abs(y));
const below = (y: number) => y + 1e-7 * Math.max(1, Math.abs(y));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const byName = (f: Fan, name: string) => f.branches.find((b) => b.sp.common === name)!;

describe('the dated tree', () => {
  it('every species of the clade is placed once, under its own splits (sides chosen for the shortest leans)', () => {
    const f = layoutFan(PANTHERA, 'linear');
    const drawn = [...f.branches].sort((p, q) => p.index - q.index);
    expect(drawn.map((b) => b.sp.sci).sort()).toEqual(speciesUnder(PANTHERA_TREE).sort());
    expect(drawn).toEqual(f.root.strands);
    // Each split's daughters are its table's, maybe mirrored; every band holds exactly its split's species.
    for (const v of f.nodes) {
      expect(v.strands.map((b) => b.sp.sci).sort()).toEqual(speciesUnder(v.split).filter((n) => f.branches.some((b) => b.sp.sci === n)).sort());
      const names = v.kids.map((k) => (isNode(k) ? k.split.name + k.ageMa : k.sp.sci));
      const table = v.split.kids.map((k) => (typeof k === 'string' ? k : k.name + k.ageMa)).filter((n) => names.includes(n));
      expect([table, [...table].reverse()]).toContainEqual(names);
    }
    expect(f.branches.map((b) => b.sp)).toEqual(PANTHERA.species);
    expect(new Set(f.branches.map((b) => b.sp.sci)).size).toBe(PANTHERA.species.length);
    expect(f.nodes.length).toBe(allSplits().length);
  });

  for (const mode of MODES) {
    it(`each split is at its table date (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      // The oldest split is the fork, y = 0; the stem below it.
      expect(f.root.ageMa).toBe(PANTHERA_TREE.ageMa);
      expect(f.root.y).toBeCloseTo(0, 12);
      for (const v of f.nodes) {
        expect(v.y).toBe(f.time.y(v.split.ageMa));
        expect(v.yBot).toBe(v.parent ? v.parent.y : f.trunkBottom.y);
        // A daughter split is younger than its parent (higher up).
        if (v.parent) expect(v.y).toBeLessThan(v.parent.y);
        for (const k of v.kids) {
          if (isNode(k)) continue;
          // A species starts at the split that lists it: its own column from there up, its jog there.
          expect(k.t0).toBe(v.split.ageMa);
          expect(k.splitY).toBe(v.y);
          // It grows out of its parent: the same edges a hair either side of the split.
          expect(leftAt(k, above(k.splitY))).toBeCloseTo(leftAt(k, below(k.splitY)), 4);
          expect(laneAt(k, above(k.splitY)).w).toBeCloseTo(laneAt(k, below(k.splitY)).w, 4);
          expect(k.path[0].node).toBe(v);
        }
      }
      // The table's dates (splits.ts), as drawn.
      const start = (n: string) => byName(f, n).t0;
      expect(start('Cave lion')).toBe(0.5);
      expect(start('Lion')).toBe(0.5);
      expect(start('Leopard')).toBe(2.57);
      expect(start('Snow leopard')).toBe(3.5);
      expect(start('Longdan tiger')).toBe(2.58);
      expect(start('European jaguar')).toBe(2.0);
      expect(start('Yucatán cave cat')).toBe(0.129);
    });

    it(`widths add up at every split: the parent just below = the daughters just above (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      for (const v of f.nodes) {
        const up = above(v.y);
        const dn = below(v.y);
        const wUp = sum(v.strands.map((b) => laneAt(b, up).w));
        const wDn = sum(v.strands.map((b) => laneAt(b, dn).w));
        expect(wDn).toBeCloseTo(v.width, 9);
        expect(wUp).toBeCloseTo(wDn, 9);
        // Below the split the strands sit side by side with no gaps, filling the column.
        let x = nodeLeft(v, dn);
        for (const b of v.strands) {
          expect(leftAt(b, dn)).toBeCloseTo(x, 9);
          x += laneAt(b, dn).w;
        }
        expect(x).toBeCloseTo(nodeLeft(v, dn) + v.width, 9);
        // Just above, the same strands side by side in the same places (the daughters before they lean).
        x = nodeLeft(v, dn);
        for (const b of v.strands) {
          expect(leftAt(b, up)).toBeCloseTo(x, 4);
          x += laneAt(b, up).w;
        }
        // And in counts: the parent is the sum of the daughters' founders.
        expect(v.n).toBeCloseTo(sum(v.strands.map((b) => b.pop.founders)), 6);
      }
      // The stem is everyone's founders.
      expect(f.root.strands.length).toBe(f.branches.length);
      expect(f.stem[1] - f.stem[0]).toBeCloseTo(sum(f.branches.map((b) => b.baseW)), 9);
      const [col] = columnsAt(f, 1);
      expect(columnsAt(f, 1).length).toBe(1);
      expect(col[0]).toBeCloseTo(f.stem[0], 9);
      expect(col[1]).toBeCloseTo(f.stem[1], 9);
    });

    it(`an extinct branch is 0% green above its split, its own column all line-ended (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      const extinct = f.branches.filter((b) => b.sp.extinct);
      expect(extinct.map((b) => b.sp.common).sort()).toEqual(['Cave lion', 'European jaguar', 'Longdan tiger', 'Yucatán cave cat']);
      for (const b of extinct) {
        for (let k = 1; k <= 200; k++) {
          const y = b.tipY + ((above(b.splitY) - b.tipY) * k) / 200;
          const L = laneAt(b, y);
          expect(L.w).toBeGreaterThan(0);
          expect(L.gw).toBe(0);
        }
      }
    });

    it(`a parent column is green by the genealogy recurrence on the summed population (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      // The share with living descendants just above a split, weighted by size: what feeds the parent.
      const shareAbove = (k: FanNode | FanBranch, ageMa: number): [number, number] =>
        isNode(k) ? [nodeQ(k, ageMa), k.n] : [k.sp.extinct ? 0 : k.pop.greenAt(ageMa - 1e-9), k.pop.founders];
      for (const v of f.nodes) {
        const parts = v.kids.map((k) => shareAbove(k, v.ageMa));
        const N = sum(parts.map((p) => p[1]));
        let h = sum(parts.map(([q, n]) => q * n)) / N;
        const GL = v.genYears;
        expect(GL).toBeCloseTo(sum(v.strands.map((b) => b.pop.founders * b.sp.genYears)) / N, 9);
        for (let k = 0; k < 60; k++) {
          // Generation k below the split: the column's green share = h_k, drawn as one prefix across its strands.
          const y = f.time.y(v.ageMa + ((k + 0.5) * GL) / 1e6);
          if (y >= v.yBot) break;
          // The band's share there is the recurrence's (drawn as such past the blend below the split).
          expect(nodeQ(v, f.time.ageAt(y))).toBeCloseTo(h, 9);
          if (y >= v.y + v.blendH) expect(sum(v.strands.map((b) => laneAt(b, y).gw)) / v.width).toBeCloseTo(h, 9);
          // Past the blend below the split: one contiguous prefix, green strands, then at most one part-green, then gray ones.
          let seenGray = y < v.y + v.blendH;
          for (const b of v.strands) {
            const L = laneAt(b, y);
            if (seenGray && y >= v.y + v.blendH) expect(L.gw).toBe(0);
            if (L.gw < L.w) seenGray = true;
          }
          h = parentShare(h, N, N);
        }
      }
      // Deep down the stem it settles to the constant-population share.
      expect(nodeQ(f.root, 100)).toBeCloseTo(Q_STAR, 9);
      // Lion + cave lion just below their split: only the lion's descendants are alive today.
      const lion = byName(f, 'Lion');
      const cave = byName(f, 'Cave lion');
      const v = lion.node;
      expect(cave.node).toBe(v);
      expect(nodeQ(v, v.ageMa)).toBeCloseTo((lion.pop.greenAt(v.ageMa - 1e-9) * lion.pop.founders) / (lion.pop.founders + cave.pop.founders), 12);
    });

    it(`every edge is continuous: left, right and the green lane's, through every split, lean, blend and population change (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      const edges = (b: FanBranch, y: number) => {
        const L = laneAt(b, y);
        const l = leftAt(b, y);
        return [l, l + L.w, l + L.gw];
      };
      for (const b of f.branches) {
        const scale = Math.max(b.width, 1e-3);
        // Around every kink (the only places the pieces meet): a hair either side.
        const ks = [...f.steps.bounds(b), ...f.nodes.map((v) => v.y)].filter((y) => y > b.tipY && y < f.trunkBottom.y);
        for (const y of ks) {
          const a = edges(b, above(y));
          const c = edges(b, below(y));
          for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - c[i]) / scale, `${b.sp.common} edge ${i} at ${y}`).toBeLessThan(1e-4);
        }
        // And a fine sweep from its tip down past the fork: no step bigger than the slopes allow.
        // (Log widths: an extinct species' last fifth of its taper is steep, g(N) falling as log N; its
        // width is still g(N(t)) and continuous, the sweep starts above it.)
        const y0 =
          mode === 'log' && b.pop.taperDec > 0
            ? f.time.y((Math.pow(10, Math.log10(b.sp.t1 * 1e6 + TAPER_C) + 0.2 * b.pop.taperDec) - TAPER_C) / 1e6)
            : b.tipY;
        let prev = edges(b, y0);
        const dy = 0.04;
        for (let y = y0 + dy; y < 60; y += dy) {
          const e = edges(b, y);
          for (let i = 0; i < 3; i++) expect(Math.abs(e[i] - prev[i]), `${b.sp.common} edge ${i} at ${y}`).toBeLessThan(0.12);
          prev = e;
        }
      }
    });

    it(`the lanes run on through a split: just below it the daughters' own lanes, side by side (${mode})`, () => {
      const f = layoutFan(PANTHERA, mode);
      for (const v of f.nodes) {
        expect(v.blendH).toBeGreaterThan(0);
        const up = above(v.y);
        const dn = below(v.y);
        for (const b of v.strands) expect(laneAt(b, dn).gw).toBeCloseTo(laneAt(b, up).gw, 4);
        // Past the blend the band's green is the recurrence's share, within it moving there linearly.
        if (mode === 'linear') expect(sum(v.strands.map((b) => laneAt(b, dn).gw)) / v.width).toBeCloseTo(v.q[0], 6);
        // Past the blend: the band's one prefix.
        const y = v.y + v.blendH * 1.001;
        if (y < v.yBot) {
          const age = f.time.ageAt(y);
          let off = 0;
          for (const b of v.strands) {
            expect(laneAt(b, y).gw).toBeCloseTo(Math.min(b.baseW, Math.max(0, nodeQ(v, age) * v.width - off)), 9);
            off += b.baseW;
          }
        }
      }
      // The cave lion's strand stays gray below its split, the lion's green, before the blend mixes them.
      const cave = byName(f, 'Cave lion');
      expect(laneAt(cave, below(cave.splitY)).gw).toBeCloseTo(0, 4);
    });

    it(`geometry is identical for two cameras at two zooms (${mode})`, () => {
      const sample = (f: Fan) =>
        f.branches.flatMap((b) =>
          [0, 1e-4, 0.01, 0.1, 0.3, 0.5, 1, 2, 2.3, 2.575, 3, 3.55, 4, 4.6, 5, 100].map((a) => {
            const y = f.time.y(a);
            const L = laneAt(b, y);
            return [leftAt(b, y), L.w, L.gw];
          }),
        );
      const a = camera(mode);
      const ref = sample(a.fan);
      const b = camera(mode);
      for (let k = 0; k < 30; k++) b.zoomAbout(200, 500, 1.4, 1.2);
      b.settle();
      expect(b.cam.sx).toBeGreaterThan(a.cam.sx * 10);
      expect(sample(b.fan)).toEqual(ref);
      expect(sample(a.fan)).toEqual(ref);
    });
  }
});
