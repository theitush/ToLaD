// The dated tree (#46): splits at their table dates, widths adding up at every
// split, extinct branches gray above their split, parent columns green by the
// genealogy recurrence on the summed population, geometry fixed in the world.
import { describe, expect, it } from 'vitest';
import { FanCamera } from './camera';
import { columnsAt, isNode, laneAt, layoutFan, leftAt, nodeQ, type Fan, type FanBranch, type EdgeStyle, type FanNode, type WidthMode } from './layout';
import { FELIDAE } from './panthera';
import { parentShare, Q_STAR } from './population';
import { allSplits, FELIDAE_TREE, speciesUnder, type Split } from './splits';
import { TwigModel } from './twigs';

function camera(mode: WidthMode, edge: EdgeStyle): FanCamera {
  const fan = layoutFan(FELIDAE, mode, undefined, edge);
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
const EDGES: EdgeStyle[] = ['curved', 'straight'];
/** A hair above / below a height (relative, so it survives the log axis; small, since a genomic deep past still slopes at a split: the sums agree in the limit). */
const above = (y: number) => y - 1e-9 * Math.max(1, Math.abs(y));
const below = (y: number) => y + 1e-9 * Math.max(1, Math.abs(y));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const byName = (f: Fan, name: string) => f.branches.find((b) => b.sp.common === name)!;

describe('the dated tree', () => {
  for (const edge of EDGES) {
    it(`every species is placed once, under its own splits, sides chosen for the shortest leans (${edge})`, () => {
      const f = layoutFan(FELIDAE, 'linear', undefined, edge);
      const drawn = [...f.branches].sort((p, q) => p.index - q.index);
      expect(drawn.map((b) => b.sp.sci).sort()).toEqual(speciesUnder(FELIDAE_TREE).sort());
      expect(drawn).toEqual(f.root.strands);
      expect(new Set(f.branches.map((b) => b.sp.sci)).size).toBe(FELIDAE.species.length);
      expect(f.nodes.length).toBe(allSplits().length);
      // Each split's daughters are its table's, maybe mirrored; every column holds exactly its split's species.
      for (const v of f.nodes) {
        expect(v.strands.map((b) => b.sp.sci).sort()).toEqual(speciesUnder(v.split).filter((n) => f.branches.some((b) => b.sp.sci === n)).sort());
        const names = v.kids.map((k) => (isNode(k) ? k.split.name + k.ageMa : k.sp.sci));
        const table = v.split.kids.map((k) => (typeof k === 'string' ? k : k.name + k.ageMa)).filter((n) => names.includes(n));
        expect([table, [...table].reverse()]).toContainEqual(names);
      }
      expect(f.branches.map((b) => b.sp)).toEqual(FELIDAE.species);
    });
  }

  for (const mode of MODES) {
    it(`the toggle keeps every species in its left-to-right place: one order for both designs (${mode})`, () => {
      const [c, s] = EDGES.map((e) => layoutFan(FELIDAE, mode, undefined, e));
      // Left to right as drawn, by the columns' centres once they have peeled off.
      // (The species' order: the strands' in the stem. A column may tuck in under a wider neighbour's later spread, so not by centre.)
    const ltr = (f: Fan) => f.root.strands.map((b) => b.sp.sci);
      expect(ltr(s)).toEqual(ltr(c));
      expect(ltr(c)).toEqual(c.root.strands.map((b) => b.sp.sci));
      expect(s.branches.map((b) => b.index)).toEqual(c.branches.map((b) => b.index));
      // And every parent column holds its daughters in the same order.
      const kids = (f: Fan) => f.nodes.map((v) => v.kids.map((k) => (isNode(k) ? k.split.name + k.ageMa : k.sp.sci)));
      expect(kids(s)).toEqual(kids(c));
    });
  }

  it('one order for both designs on any tree: a random 40-species one, toggled either way round', () => {
    // Panthera's records, cloned, on a random binary tree (Felidae's size).
    const species = Array.from({ length: 40 }, (_, i) => ({ ...FELIDAE.species[i % FELIDAE.species.length], sci: `S${i}`, common: `S${i}` }));
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const build = (names: string[], age: number): Split | string => {
      if (names.length === 1) return names[0];
      const cut = 1 + Math.floor(rnd() * (names.length - 1));
      const a = age * (0.5 + 0.4 * rnd());
      return { name: `n${names.length}`, ageMa: age, lo: age, hi: age, kids: [build(names.slice(0, cut), a), build(names.slice(cut), a * 0.98)] } as Split;
    };
    const tree = build(species.map((s) => s.sci), 4.6) as Split;
    // (The species' order: the strands' in the stem. A column may tuck in under a wider neighbour's later spread, so not by centre.)
    const ltr = (f: Fan) => f.root.strands.map((b) => b.sp.sci);
    // Curved first, then straight (sides reused); and straight first on a fresh clade (sides searched).
    const c1 = layoutFan({ ...FELIDAE, species }, 'log', tree, 'curved');
    const s1 = layoutFan(c1.clade, 'log', tree, 'straight');
    const s2 = layoutFan({ ...FELIDAE, species }, 'log', tree, 'straight');
    expect(ltr(s1)).toEqual(ltr(c1));
    expect(ltr(s2)).toEqual(ltr(c1));
    expect(s2.branches.map((b) => b.cx)).toEqual(s1.branches.map((b) => b.cx));
  });

  for (const edge of EDGES) for (const mode of MODES) {
    it(`each split is at its table date (${mode}, ${edge})`, () => {
      const f = layoutFan(FELIDAE, mode, undefined, edge);
      // The oldest split is the fork, y = 0; the stem below it.
      expect(f.root.ageMa).toBe(FELIDAE_TREE.ageMa);
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
          // Its column grows out of its slice of the parent (no jog), and has peeled off to its own centre a fork span above.
          expect(leftAt(k, below(k.splitY))).toBeCloseTo(k.path[0].left, 12);
          // (A straight lean leaves at its slope: a hair above, a hair aside.)
          expect(leftAt(k, above(k.splitY))).toBeCloseTo(k.path[0].left, edge === 'curved' ? 5 : 3);
          const yF = k.leanY;
          if (yF > k.tipY) expect(leftAt(k, yF) + laneAt(k, yF).w / 2).toBeCloseTo(k.cx, 9);
          expect(k.path[0].node).toBe(v);
        }
      }
      // The table's dates (splits.ts), as drawn.
      const start = (n: string) => byName(f, n).t0;
      expect(start('Cave lion')).toBe(0.5);
      expect(start('Lion')).toBe(0.5);
      expect(start('Leopard')).toBe(2.57);
      expect(start('Snow leopard')).toBe(3.47);
      expect(start('Longdan tiger')).toBe(2.58);
      expect(start('European jaguar')).toBe(2.0);
      expect(start('Yucatán cave cat')).toBe(0.129);
    });

    it(`widths add up at every split: the parent just below = the daughters just above (${mode}, ${edge})`, () => {
      const f = layoutFan(FELIDAE, mode, undefined, edge);
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
        // Curved: where its daughters' peels are the shortest, the farthest left as far as the farthest right
        // (straight: the larger daughter runs straight on).
        // Off that place only where two splits come close in time, and then every peel under the edges' limit (12, layout.test).
        if (edge === 'curved') {
          const moves = v.kids.map((k) => (isNode(k) ? k.left - k.tile : k.cx - (k.x0 + k.baseW / 2)));
          const fork = v.y - v.kids[0].leanY;
          // (36: since ToLaD#145 the data's stem is a chain of fossil splits under 1 Myr apart, 12-15 Ma, and boundPeels
          // can only reach the least slope the tree allows there; layout.test bounds the edges themselves.)
          if (Math.abs(Math.max(...moves) + Math.min(...moves)) > 1e-9) for (const m of moves) expect(Math.abs(m) * 1.875).toBeLessThanOrEqual(36 * fork);
        }
        expect(v.left + v.width / 2).toBeCloseTo(v.cx, 9);
      }
      // The stem is everyone's founders.
      expect(f.root.strands.length).toBe(f.branches.length);
      expect(f.stem[1] - f.stem[0]).toBeCloseTo(sum(f.branches.map((b) => b.baseW)), 9);
      expect(columnsAt(f, 1)).toEqual([f.stem]);
    });

    it(`an extinct branch is 0% green above its split, its own column all line-ended (${mode}, ${edge})`, () => {
      const f = layoutFan(FELIDAE, mode, undefined, edge);
      const extinct = f.branches.filter((b) => b.sp.extinct);
      // (Since ToLaD#145 the data's tree holds every dated fossil cat, ~98, not just the four hand-placed Panthera fossils.)
      expect(extinct.length).toBe(FELIDAE.species.filter((s) => s.extinct).length);
      for (const c of ['Cave lion', 'European jaguar', 'Longdan tiger', 'Yucatán cave cat']) expect(extinct.map((b) => b.sp.common)).toContain(c);
      for (const b of extinct) {
        for (let k = 1; k <= 200; k++) {
          const y = b.tipY + ((above(b.splitY) - b.tipY) * k) / 200;
          const L = laneAt(b, y);
          expect(L.w).toBeGreaterThan(0);
          expect(L.gw).toBe(0);
        }
      }
    });

    it(`a parent column is green by the genealogy recurrence on the summed population, turning from its daughters' own shares (${mode}, ${edge})`, () => {
      const f = layoutFan(FELIDAE, mode, undefined, edge);
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
          const age = v.ageMa + ((k + 0.5) * GL) / 1e6;
          expect(nodeQ(v, age)).toBeCloseTo(h, 9);
          h = parentShare(h, N, N);
        }
        // Just below the split: the daughters side by side, each green by its own share just above it (no jump);
        // then, past the blend, one contiguous prefix of the recurrence's share.
        for (const b of v.strands) expect(laneAt(b, below(v.y)).gw).toBeCloseTo(laneAt(b, above(v.y)).gw, 5);
        const y = v.y + v.blend * 1.001;
        if (y < v.yBot) {
          const age = f.time.ageAt(y);
          const green = sum(v.strands.map((b) => laneAt(b, y).gw));
          expect(green / v.width).toBeCloseTo(nodeQ(v, age), 9);
          let seenGray = false;
          for (const b of v.strands) {
            const L = laneAt(b, y);
            if (seenGray) expect(L.gw).toBe(0);
            if (L.gw < L.w) seenGray = true;
          }
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

    it(`geometry is identical for two cameras at two zooms (${mode}, ${edge})`, () => {
      const sample = (f: Fan) =>
        f.branches.flatMap((b) =>
          [0, 1e-4, 0.01, 0.1, 0.3, 0.5, 1, 2, 2.3, 2.575, 3, 3.55, 4, 4.6, 5, 100].map((a) => {
            const y = f.time.y(a);
            const L = laneAt(b, y);
            return [leftAt(b, y), L.w, L.gw];
          }),
        );
      const a = camera(mode, edge);
      const ref = sample(a.fan);
      const b = camera(mode, edge);
      // (About the lion's column 100 kyr ago: zooming never goes into nothing.)
      const lion = byName(b.fan, 'Lion');
      const [px, py] = b.toScreen(lion.cx, b.fan.time.y(0.1));
      for (let k = 0; k < 30; k++) b.zoomAbout(px, py, 1.4, 1.2);
      b.settle();
      expect(b.cam.sx).toBeGreaterThan(a.cam.sx * 10);
      expect(sample(b.fan)).toEqual(ref);
      expect(sample(a.fan)).toEqual(ref);
    });
  }
});
