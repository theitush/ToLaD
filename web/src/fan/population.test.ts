import { describe, expect, it } from 'vitest';
import { FELIDAE, type SpeciesRec } from './panthera';
import { parentShare, population, Q_STAR, shareBack } from './population';

const sp = (name: string) => FELIDAE.species.find((s) => s.common === name)!;
/** An age inside the flat stretch held before a history's oldest point (back to the species' start); without a history, the middle of its span (held throughout). */
const heldAge = (s: SpeciesRec) => {
  const h = s.history;
  if (!h) return s.t0 / 2;
  const oldest = Math.max(...h.points.map((q) => (h.nowYear - q.year) / 1e6));
  return (s.t0 + oldest) / 2;
};

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
    // (EVER and ALIV are LOG16-quantized, 0.23% steps: today's count to within two half-steps)
    expect(Math.abs(p.aliveAt(0) / sp('Lion').alive - 1)).toBeLessThan(2.5e-3);
    expect(p.aliveAt(200e-6)).toBeGreaterThan(4.9e5);
    // The most alive at once: the deep curve's peak, on one of its points (ToLaD#60: a Middle
    // Pleistocene high near 700 thousand at the lion's own mutation rate, ToLaD#74, not the held oldest level).
    const h = sp('Lion').history!;
    const peak = Math.max(...h.points.map((q) => p.aliveAt((h.nowYear - q.year) / 1e6)));
    expect(peak).toBeGreaterThan(6.5e5);
    expect(p.max / peak).toBeCloseTo(1, 4);
    expect(p.greenAt(0)).toBe(1);
    // During the crash (1950s–2000s) far fewer of those alive have descendants today.
    expect(p.greenAt(50e-6)).toBeLessThan(0.6);
    // Long before it, where the population is constant: the settled share. (1 Ma ago the lion's
    // genomic curve is still changing, ToLaD#60; its oldest level is held from ~1.3 Ma back.)
    expect(p.greenAt(heldAge(sp('Lion')))).toBeCloseTo(Q_STAR, 6);
  });

  it('extinct species: their whole span is gray (0% green), nobody is alive after it, and its founders before its start', () => {
    for (const s of FELIDAE.species.filter((s) => s.extinct)) {
      // From its first appearance (the default start) or from a split in between (the dated tree's).
      for (const start of [s.t0, (s.t0 + s.t1) / 2]) {
        const p = population(s, start);
        for (const a of [s.t1 + (start - s.t1) * 0.01, (start + s.t1) / 2, start]) {
          expect(p.greenAt(a)).toBe(0);
          expect(p.aliveAt(a)).toBeGreaterThan(0);
        }
        // It tapers smoothly to nobody at its last appearance.
        expect(p.aliveAt(s.t1)).toBe(0);
        expect(p.aliveAt(s.t1 + (start - s.t1) * 1e-4)).toBeLessThan(1e-3 * p.founders);
        expect(p.aliveAt(s.t1 * 0.9)).toBe(0);
        expect(p.aliveAt(start * 1.1)).toBe(p.founders);
        expect(p.stepAt(start * 1.1).n).toBe(p.founders);
      }
      const p = population(s);
      // Its founders (its share of the stem) are ancestors of living species too: green by the rule.
      expect(p.qBase).toBeCloseTo(Q_STAR, 9);
    }
  });

  it('living species are all green now and settle to ~0.797 within a few generations', () => {
    for (const s of FELIDAE.species.filter((s) => !s.extinct)) {
      const p = population(s);
      expect(p.greenAt(0)).toBe(1);
      // (The newest generation's step is the living's: all green; the one before it, less.)
      expect(p.greenAt((s.genYears * 0.5) / 1e6)).toBe(1);
      expect(p.greenAt((s.genYears * 1.5) / 1e6)).toBeLessThan(1);
      // Settled: the share no longer moves from one generation to the next ...
      // (5 kyr ago, was 10: since ToLaD#143 the lion's curve turns at 10 kya, the young edge of its dated
      // post-glacial decline, and a share read across a turn is not settled. At 5 kya every cat is on a
      // smooth log-linear stretch.)
      const back = (k: number) => p.greenAt(0.005 + (k * s.genYears) / 1e6);
      expect(back(0)).toBeCloseTo(back(3), 6);
      // ... at Q* for a constant population; a log-linear change shifts the settled share by about its
      // rate per generation: ~1e-4 for most, but the lion and leopard rise 12x and 4.7x from 10 kya to
      // 1500 CE (~1.6e-3 per generation, ToLaD#143), which moves theirs by ~1.1e-3.
      expect(Math.abs(back(0) - Q_STAR), s.common).toBeLessThan(['Lion', 'Leopard'].includes(s.common) ? 1.5e-3 : 1e-3);
      // Where the population is held constant (before its oldest point), exactly Q*.
      expect(p.greenAt(heldAge(s))).toBeCloseTo(Q_STAR, 6);
    }
  });
});

describe('the steps a species costs the fan are bounded (ToLaD#70)', () => {
  it('a few hundred green-share samples and a few thousand features per species, however many generations it spans', () => {
    // (Per generation, a genomic deep past was 78k-200k steps per Panthera species and ~100 s to load.)
    let gens = 0;
    for (const s of FELIDAE.species) {
      const p = population(s);
      gens = Math.max(gens, Math.max(0, (s.t0 - s.t1) * 1e6) / s.genYears);
      expect(p.shareSamples, s.common).toBeLessThanOrEqual(1500);
      expect(p.features().length, s.common).toBeLessThanOrEqual(8000);
    }
    expect(gens).toBeGreaterThan(5e5);
  });
});
