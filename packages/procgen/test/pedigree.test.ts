import { describe, expect, it } from 'vitest';
import { EXAMPLE_SPECIES } from '../src/examples.ts';
import { rand } from '../src/hash.ts';
import { Species, type Address } from '../src/species.ts';

const SMALL = ['tiny', 'clone', 'cod'] as const;
const BIG = ['human', 'microbe', 'bigsexual'] as const;

const same = (a: Address, b: Address) => a.generation === b.generation && a.index === b.index;

function randomAddress(s: Species, salt: number, t: number): Address {
  const g = Math.floor((rand(salt, t) / 4294967296) * s.generations);
  const n = s.size(g);
  const i = ((BigInt(rand(salt + 1, t)) << 64n) | (BigInt(rand(salt + 2, t)) << 32n) | BigInt(rand(salt + 3, t))) % n;
  return { generation: g, index: i };
}

describe('pedigree consistency, exhaustive on small species', () => {
  for (const name of SMALL) {
    const s = new Species(EXAMPLE_SPECIES[name]);

    it(`${name}: slots are a permutation of each generation`, () => {
      for (let g = 0; g < s.generations; g++) {
        const N = s.size(g);
        const seen = new Set<bigint>();
        for (let i = 0n; i < N; i++) {
          const slot = s.slotOf({ generation: g, index: i });
          expect(slot >= 0n && slot < N).toBe(true);
          seen.add(slot);
          expect(s.individualAtSlot(g, slot).index).toBe(i);
        }
        expect(seen.size).toBe(Number(N));
      }
    });

    it(`${name}: child ranges of all couples tile the next generation`, () => {
      for (let g = 0; g + 1 < s.generations; g++) {
        const N = s.size(g);
        const K = s.couples(g);
        const covered = new Array<number>(Number(s.size(g + 1))).fill(0);
        const byCouple = new Map<bigint, string>();
        for (let i = 0n; i < N; i++) {
          const a = { generation: g, index: i };
          const r = s.children(a);
          expect(r.generation).toBe(g + 1);
          const j = s.sexual ? s.slotOf(a) >> 1n : s.slotOf(a);
          if (j >= K) {
            expect(r.count).toBe(0n);
            continue;
          }
          const key = `${r.start}:${r.count}`;
          if (byCouple.has(j)) expect(byCouple.get(j)).toBe(key); // both partners agree
          else {
            byCouple.set(j, key);
            for (let c = r.start; c < r.start + r.count; c++) covered[Number(c)]!++;
          }
        }
        expect(covered.every((x) => x === 1)).toBe(true);
      }
    });

    it(`${name}: every child of P lists P as a parent; every parent of C lists C as a child`, () => {
      for (let g = 0; g < s.generations; g++) {
        const N = s.size(g);
        for (let i = 0n; i < N; i++) {
          const a = { generation: g, index: i };
          const r = s.children(a);
          for (let c = r.start; c < r.start + r.count; c++) {
            expect(s.parents({ generation: r.generation, index: c }).some((p) => same(p, a))).toBe(true);
          }
          const ps = s.parents(a);
          expect(ps.length).toBe(g === 0 ? 0 : s.sexual ? 2 : 1);
          for (const p of ps) {
            const pr = s.children(p);
            expect(pr.generation).toBe(g);
            expect(i >= pr.start && i < pr.start + pr.count).toBe(true);
          }
          if (s.sexual && ps.length === 2) {
            expect(s.sexOf(ps[0]!)).toBe('female');
            expect(s.sexOf(ps[1]!)).toBe('male');
            expect(s.partner(ps[0]!)).toEqual(ps[1]);
          }
        }
      }
    });
  }
});

describe('pedigree consistency, sampled on huge species', () => {
  for (const name of BIG) {
    const s = new Species(EXAMPLE_SPECIES[name]);
    it(`${name}: parents ↔ children agree on random individuals`, () => {
      for (let t = 0; t < 60; t++) {
        const a = randomAddress(s, 100, t);
        const ps = s.parents(a);
        for (const p of ps) {
          const r = s.children(p);
          expect(a.index >= r.start && a.index < r.start + r.count).toBe(true);
        }
        const r = s.children(a);
        const lim = r.count < 4n ? r.count : 4n;
        for (let c = r.start; c < r.start + lim; c++) {
          expect(s.parents({ generation: r.generation, index: c }).some((p) => same(p, a))).toBe(true);
        }
      }
    });
  }
});

describe('locality and mixing', () => {
  it('human edges are short in index space, except ≈ migrantRate long-range ones', () => {
    const s = new Species(EXAMPLE_SPECIES.human);
    let long = 0;
    let total = 0;
    for (let t = 0; t < 400; t++) {
      const a = randomAddress(s, 200, t);
      if (a.generation === 0) continue;
      const N = Number(s.size(a.generation));
      const M = Number(s.size(a.generation - 1));
      for (const p of s.parents(a)) {
        total++;
        // distance in "parent-generation individuals"
        const d = Math.abs(Number(a.index) * (M / N) - Number(p.index));
        if (d > 256) long++;
      }
    }
    // ε = 1/256 of slots are migrants; their couples have one far parent
    expect(long / total).toBeLessThan(0.02);
    expect(long).toBeGreaterThan(0);
  });

  it('ancestry converges: ancestor cone of one individual saturates the population', () => {
    const N = 2048;
    const s = new Species({
      key: 'mixing',
      sexual: true,
      segments: [{ generations: 200, startSize: N }],
      generationYears: 1,
      lifespanYears: 1,
    });
    let frontier = new Map<bigint, Address>([[0n, { generation: 199, index: 1000n }]]);
    let saturatedAt = -1;
    for (let back = 1; back < 199; back++) {
      const next = new Map<bigint, Address>();
      for (const a of frontier.values()) for (const p of s.parents(a)) next.set(p.index, p);
      frontier = next;
      if (back === 1) expect(frontier.size).toBe(2);
      // ~86% of a generation have descendants at all (Poisson(2) families), so 70% is saturation
      if (frontier.size > 0.7 * N) {
        saturatedAt = back;
        break;
      }
    }
    // log2(2048) = 11; measured ≈ 25 with the default ε = 1/256 (≈ 70 with ε = 0)
    expect(saturatedAt).toBeGreaterThan(10);
    expect(saturatedAt).toBeLessThan(40);
  });
});

describe('attributes', () => {
  it('are deterministic, in range, and alive ⇔ born ≤ now < death', () => {
    const s = new Species(EXAMPLE_SPECIES.human);
    let alive = 0;
    const lastG = s.generations - 1;
    for (let t = 0; t < 500; t++) {
      const g = lastG - (t % 4);
      const a = { generation: g, index: BigInt(rand(300, t)) % s.size(g) };
      const x = s.attributes(a);
      expect(x).toEqual(s.attributes(a));
      expect(x.birthTime >= g * 25 && x.birthTime < (g + 1) * 25).toBe(true);
      expect(x.lifespan >= 0 && x.lifespan < 80).toBe(true);
      expect(x.alive).toBe(x.birthTime <= s.now && x.deathTime > s.now);
      if (x.alive) alive++;
    }
    expect(alive).toBeGreaterThan(50);
    expect(alive).toBeLessThan(450);
  });
});
