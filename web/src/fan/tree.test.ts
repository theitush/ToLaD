// The dated tree (#46): splits at their table dates, widths adding up at every
// split, extinct branches gray above their split, parent columns green by the
// genealogy recurrence on the summed population, geometry fixed in the world.
import { describe, expect, it } from 'vitest';
import { FanCamera } from './camera';
import { columnsAt, isNode, laneAt, layoutFan, leftAt, nodeQ, type Fan, type FanBranch, type FanNode, type WidthMode } from './layout';
import { PANTHERA } from './panthera';
import { parentShare, Q_STAR } from './population';
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
  it('every species of the clade is placed once, in the table\'s left-to-right order', () => {
    const f = layoutFan(PANTHERA, 'linear');
    expect([...f.branches].sort((p, q) => p.index - q.index).map((b) => b.sp.sci)).toEqual(speciesUnder(PANTHERA_TREE));
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
          // A species starts at the split that lists it: its own column from there up, out of its
          // sub-interval of the parent (no jog), centred on its own line above its fork.
          expect(k.t0).toBe(v.split.ageMa);
          expect(k.splitY).toBe(v.y);
          expect(leftAt(k, above(k.splitY))).toBeCloseTo(k.path[0].left, 4);
          expect(leftAt(k, below(k.splitY))).toBeCloseTo(k.path[0].left, 9);
          expect(leftAt(k, k.forkY) + laneAt(k, k.forkY).w / 2).toBeCloseTo(k.xc, 9);
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
        let x = v.left;
        for (const b of v.strands) {
          expect(leftAt(b, dn)).toBeCloseTo(x, 9);
          x += laneAt(b, dn).w;
        }
        expect(x).toBeCloseTo(v.left + v.width, 9);
        // And in counts: the parent is the sum of the daughters' founders.
        expect(v.n).toBeCloseTo(sum(v.strands.map((b) => b.pop.founders)), 6);
        // Centred on its daughters' width-weighted mean centre: the fork's V is balanced.
        const kw = v.kids.map((k) => (isNode(k) ? k.width : k.baseW));
        expect(v.left + v.width / 2).toBeCloseTo(v.kids.reduce((a, k, i) => a + kw[i] * k.xc, 0) / sum(kw), 9);
      }
      // The stem is everyone's founders.
      expect(f.root.strands.length).toBe(f.branches.length);
      expect(f.stem[1] - f.stem[0]).toBeCloseTo(sum(f.branches.map((b) => b.baseW)), 9);
      expect(columnsAt(f, 1)).toEqual([f.stem]);
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
          const green = sum(v.strands.map((b) => laneAt(b, y).gw));
          // (Within the lanes' blend just below the split, the drawn share eases from the daughters'
          // own into this: layout.ts Steps.greenIn.)
          if (y >= v.y + v.blend) expect(green / v.width).toBeCloseTo(h, 9);
          // One contiguous prefix below the lanes' blend (just below the split each daughter keeps its own
          // green on its own left, layout.ts FanNode.blend): green strands, then at most one part-green, then gray ones.
          let seenGray = y < v.y + v.blend ? null : false;
          for (const b of v.strands) {
            const L = laneAt(b, y);
            if (seenGray === null) continue;
            if (seenGray) expect(L.gw).toBe(0);
            if (L.gw < L.w) seenGray = true;
          }
          h = parentShare(h, N, N);
        }
        // Below the lanes' blend: the recurrence's share, one prefix (sampled down the column).
        for (let i = 1; i <= 20; i++) {
          const y = v.y + v.blend + ((Math.min(v.yBot, f.trunkBottom.y) - v.y - v.blend) * i) / 21;
          const green = sum(v.strands.map((b) => laneAt(b, y).gw));
          expect(green / v.width).toBeCloseTo(nodeQ(v, f.time.ageAt(y)), 9);
        }
        // At the split: the daughters' own lanes, which total the recurrence's start q[0] (linear widths: width ∝ count).
        if (mode === 'linear') expect(sum(v.strands.map((b) => laneAt(b, below(v.y)).gw)) / v.width).toBeCloseTo(v.q[0], 6);
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
      // Zoom in on the lion's column (zooming into a gap between branches is capped).
      const lion = byName(b.fan, 'Lion');
      const ly = b.fan.time.y(0.001);
      const [px, py] = b.toScreen(leftAt(lion, ly) + laneAt(lion, ly).w / 2, ly);
      for (let k = 0; k < 30; k++) b.zoomAbout(px, py, 1.4, 1.2);
      b.settle();
      expect(b.cam.sx).toBeGreaterThan(a.cam.sx * 10);
      expect(sample(b.fan)).toEqual(ref);
      expect(sample(a.fan)).toEqual(ref);
    });
  }
});
