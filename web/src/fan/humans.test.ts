// The human column follows humans' own history, not today's 8 billion back to its split (ToLaD#289).
import { beforeAll, describe, expect, it } from 'vitest';
import { mammaliaClade, type SpeciesRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { DEEP_PAST, Population, shapes } from './population';

let human: SpeciesRec;
beforeAll(async () => {
  await loadMammalsFromFiles();
  human = mammaliaClade().species.find((s) => s.sci === 'Homo sapiens')!;
});

describe("humans' width through time", () => {
  it("is today's count now, HYDE's ~4.4 million at 10,000 BCE, and at most 1e6 at 300,000 years ago", () => {
    expect(shapes(human)).toBe(true);
    const p = new Population(human, Math.max(human.t0, 0.6));
    expect(p.aliveAt(0) / human.alive).toBeCloseTo(1, 2);
    const n12k = p.aliveAt(0.012);
    expect(n12k).toBeGreaterThan(3e6);
    expect(n12k).toBeLessThan(6e6);
    expect(p.aliveAt(0.3)).toBeLessThanOrEqual(1e6);
    expect(p.aliveAt(0.3)).toBeGreaterThanOrEqual(1e4);
    // Never more than today's, and growing towards now from the last glacial on.
    for (let a = 0; a <= 0.6; a += 0.001) expect(p.aliveAt(a)).toBeLessThanOrEqual(human.alive * 1.0001);
    for (let a = 0.02; a > 0.0005; a -= 0.0005) expect(p.aliveAt(a - 0.0005)).toBeGreaterThanOrEqual(p.aliveAt(a) * 0.98);
    // The room is still its widest (today's).
    expect(p.max / human.alive).toBeCloseTo(1, 2);
  });

  it('every deep-past point is cited', () => {
    for (const d of DEEP_PAST['Homo sapiens']) {
      expect(d.cite.length).toBeGreaterThan(10);
      expect(d.url).toMatch(/^https:\/\/doi\.org\//);
      expect(d.lo).toBeLessThanOrEqual(d.n);
      expect(d.hi).toBeGreaterThanOrEqual(d.n);
    }
  });
});
