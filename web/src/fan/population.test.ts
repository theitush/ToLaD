import { describe, expect, it } from 'vitest';
import { PANTHERA } from './panthera';
import { parentShare, population, Q_STAR, shareBack } from './population';

const sp = (name: string) => PANTHERA.species.find((s) => s.common === name)!;

describe('who has living descendants: the genealogy back from now', () => {
  it('a constant, well-mixed population settles to the identical-ancestors share, ~0.797', () => {
    expect(Q_STAR).toBeCloseTo(0.7968, 4);
    expect(1 - Math.exp(-2 * Q_STAR)).toBeCloseTo(Q_STAR, 12);
    for (const N of [10, 1e4, 1e6]) {
      const h = shareBack(() => N, 0, 1000);
      expect(h[0]).toBe(1); // now: the living, all of them
      // Settled within about log2(N) generations (it gets there much sooner).
      expect(h[Math.ceil(Math.log2(N))]).toBeCloseTo(Q_STAR, 2);
      expect(h[h.length - 1]).toBeCloseTo(Q_STAR, 9);
      // Falling monotonically from 1.
      for (let k = 1; k < h.length; k++) expect(h[k]).toBeLessThanOrEqual(h[k - 1] + 1e-15);
    }
  });

  it('the step back is 1 − exp(−2·q·n_child/n_parent): each child draws two parents', () => {
    expect(parentShare(1, 100, 100)).toBeCloseTo(1 - Math.exp(-2), 12);
    expect(parentShare(0.5, 10, 1000)).toBeCloseTo(1 - Math.exp(-0.01), 12);
    expect(parentShare(0, 10, 10)).toBe(0);
  });

  it('a bottleneck narrows the whole column: before it only ~2·n_s·q are green, then they recover', () => {
    const big = 1e5;
    const small = 100;
    // Generations back from now: big for 20, a bottleneck of `small` for 5, big again before it.
    const n = (k: number) => (k >= 20 && k < 25 ? small : big);
    const h = shareBack(n, 30, 2000);
    expect(h[19]).toBeCloseTo(Q_STAR, 6);
    // Through the bottleneck (as many as the generation after it allows: n is small, q goes to ~1).
    expect(h[24]).toBeGreaterThan(Q_STAR);
    // Just before it: the green are about 2 · q · n_s of the big population (a narrow green lane).
    const green = h[25] * big;
    expect(green).toBeGreaterThan(small);
    expect(green).toBeLessThan(2.1 * small);
    // Recovering further back over ~log2(big/small) generations, back to the settled share.
    expect(h[26]).toBeGreaterThan(h[25]);
    expect(h[25 + 3 * Math.ceil(Math.log2(big / small))]).toBeCloseTo(Q_STAR, 2);
  });

  it('a decline towards now holds the share below 0.797, growth towards now above it', () => {
    // Declining towards now: older generations bigger (n grows going back).
    const decl = shareBack((k) => 1e4 * Math.pow(1.3, Math.min(k, 30)), 30, 200);
    const grow = shareBack((k) => 1e4 * Math.pow(0.8, Math.min(k, 30)), 30, 200);
    expect(decl[20]).toBeLessThan(Q_STAR - 0.1);
    expect(grow[20]).toBeGreaterThan(Q_STAR + 0.05);
    expect(grow[20]).toBeLessThanOrEqual(1);
    // Both settle once the size is constant again.
    expect(decl[decl.length - 1]).toBeCloseTo(Q_STAR, 6);
    expect(grow[grow.length - 1]).toBeCloseTo(Q_STAR, 6);
  });
});

describe('the Panthera populations', () => {
  it('lions: ~500 thousand before the decline, the living now; the crash leaves a gray band before it', () => {
    const p = population(sp('Lion'));
    expect(p.aliveAt(0)).toBeCloseTo(sp('Lion').alive, -2);
    expect(p.aliveAt(200e-6)).toBeGreaterThan(4.9e5);
    expect(p.max).toBeCloseTo(p.aliveAt(1), -3);
    expect(p.greenAt(0)).toBe(1);
    // During the crash (1950s–2000s) far fewer of those alive have descendants today.
    expect(p.greenAt(50e-6)).toBeLessThan(0.6);
    // Long before it: the settled share.
    expect(p.greenAt(1)).toBeCloseTo(Q_STAR, 6);
  });

  it('extinct species: gray (0% green) from their extinction down to the fork, their founders below their first appearance, nobody after it', () => {
    for (const s of PANTHERA.species.filter((s) => s.extinct)) {
      const p = population(s);
      for (const a of [s.t1, (s.t0 + s.t1) / 2, s.t0, s.t0 * 1.1, PANTHERA.t0]) {
        expect(p.greenAt(a)).toBe(0);
        expect(p.aliveAt(a)).toBeGreaterThan(0);
        expect(p.stepAt(a).q).toBe(0);
      }
      expect(p.aliveAt(s.t1 * 0.9)).toBe(0);
      expect(p.aliveAt(PANTHERA.t0)).toBe(p.founders);
      // One step: the modelled population, constant over the whole column.
      expect(p.steps.n.length).toBe(1);
      // Its founders (its share of the stem) are ancestors of living species too: green by the rule.
      expect(p.qBase).toBeCloseTo(Q_STAR, 9);
    }
  });

  it('living species are all green now and settle to ~0.797 within a few generations', () => {
    for (const s of PANTHERA.species.filter((s) => !s.extinct)) {
      const p = population(s);
      expect(p.greenAt(0)).toBe(1);
      // (The newest generation's step is the living's: all green; the one before it, less.)
      expect(p.greenAt((s.genYears * 0.5) / 1e6)).toBe(1);
      expect(p.greenAt((s.genYears * 1.5) / 1e6)).toBeLessThan(1);
      expect(p.greenAt(0.01)).toBeCloseTo(Q_STAR, 6);
    }
  });
});
