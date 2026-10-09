import { describe, expect, it } from 'vitest';
import { EXAMPLE_SPECIES } from '../src/examples.ts';
import { rand } from '../src/hash.ts';
import { PopulationModel } from '../src/population.ts';
import { Species } from '../src/species.ts';

describe('population counts', () => {
  it('Σ N(g) = totalEver and C(g+1) − C(g) = N(g) ≥ min size (small species, exhaustive)', () => {
    for (const name of ['tiny', 'clone', 'cod'] as const) {
      const s = new Species(EXAMPLE_SPECIES[name]);
      let sum = 0n;
      for (let g = 0; g < s.generations; g++) {
        const n = s.size(g);
        expect(n >= (s.sexual ? 2n : 1n)).toBe(true);
        expect(s.cumulative(g)).toBe(sum);
        sum += n;
      }
      expect(sum).toBe(s.totalEver);
      expect(s.cumulative(s.generations)).toBe(s.totalEver);
    }
  });

  it('segment endpoints: births ramp from startSize to endSize', () => {
    const p = new PopulationModel([{ generations: 100, startSize: 1000, endSize: 5000 }], 1n);
    expect(p.size(0)).toBe(1020n); // first step of the integral of the ramp
    expect(p.size(99)).toBe(4980n);
    expect(p.totalEver).toBe(300000n);
  });

  it('sum over every generation for humans (11,416 gens)', () => {
    const s = new Species(EXAMPLE_SPECIES.human);
    let sum = 0n;
    for (let g = 0; g < s.generations; g++) sum += s.size(g);
    expect(sum).toBe(s.totalEver);
    expect(s.totalEver > 10n ** 11n && s.totalEver < 2n * 10n ** 11n).toBe(true);
  });

  it('generationOf inverts cumulative (boundaries + random ordinals, incl. 10^30)', () => {
    for (const name of ['tiny', 'human', 'microbe', 'bigsexual'] as const) {
      const s = new Species(EXAMPLE_SPECIES[name]);
      const p = s.population;
      for (let t = 0; t < 300; t++) {
        const g = Math.floor((rand(5, t) / 4294967296) * s.generations);
        const c0 = p.cumulative(g);
        const c1 = p.cumulative(g + 1);
        expect(p.generationOf(c0)).toBe(g);
        expect(p.generationOf(c1 - 1n)).toBe(g);
        const k = c0 + (BigInt(rand(6, t)) % (c1 - c0));
        expect(p.generationOf(k)).toBe(g);
        const a = s.address(k);
        expect(a.generation).toBe(g);
        expect(s.ordinal(a)).toBe(k);
      }
    }
  });

  it('public IDs round-trip and handles parse back', () => {
    for (const name of ['tiny', 'clone'] as const) {
      const s = new Species(EXAMPLE_SPECIES[name]);
      const seen = new Set<bigint>();
      for (let k = 0n; k < s.totalEver; k++) {
        const id = s.encodeId(k);
        expect(s.decodeId(id)).toBe(k);
        seen.add(id);
      }
      expect(seen.size).toBe(Number(s.totalEver));
    }
    for (const name of ['human', 'microbe', 'bigsexual'] as const) {
      const s = new Species(EXAMPLE_SPECIES[name]);
      for (let t = 0; t < 100; t++) {
        const k = ((BigInt(rand(7, t)) << 64n) | (BigInt(rand(8, t)) << 32n) | BigInt(rand(9, t))) % s.totalEver;
        const a = s.address(k);
        const h = s.handle(a);
        expect(h.startsWith(`${s.key}#`)).toBe(true);
        expect(s.addressOfHandle(h)).toEqual(a);
      }
    }
  });
});
