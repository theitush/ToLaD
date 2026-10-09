import { describe, expect, it } from 'vitest';
import { normalFromU32, splitCount } from '../src/binomial.ts';
import { NORMAL_TABLE } from '../src/normal-table.ts';
import { hash2 } from '../src/hash.ts';

function stats(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return { m, v };
}

describe('normal deviates from the integer table', () => {
  it('table is monotone and antisymmetric', () => {
    for (let j = 1; j < NORMAL_TABLE.length; j++) expect(NORMAL_TABLE[j]!).toBeGreaterThan(NORMAL_TABLE[j - 1]!);
    for (let j = 0; j < NORMAL_TABLE.length; j++) expect(NORMAL_TABLE[j]! + NORMAL_TABLE[1024 - j]!).toBe(0);
  });
  it('has mean ≈ 0, variance ≈ 1', () => {
    const xs: number[] = [];
    for (let k = 0; k < 20000; k++) xs.push(normalFromU32(hash2(77, k)));
    const { m, v } = stats(xs);
    expect(Math.abs(m)).toBeLessThan(0.03);
    expect(Math.abs(v - 1)).toBeLessThan(0.04);
  });
});

describe('splitCount', () => {
  for (const n of [1n, 5n, 64n, 65n, 1000n, 10n ** 9n, 10n ** 30n]) {
    it(`n = ${n}: within [0, n], mean ≈ np, var ≈ npq`, () => {
      const xs: number[] = [];
      for (let k = 0; k < 4000; k++) {
        const r = splitCount(n, 3n, 7n, hash2(n === 1n ? 1 : Number(n % 1000003n), k));
        expect(r >= 0n && r <= n).toBe(true);
        xs.push(Number(r - (n * 3n) / 7n));
      }
      const { m, v } = stats(xs);
      const nn = Number(n);
      const sd = Math.sqrt((nn * 12) / 49);
      // xs are offsets from floor(np); their mean should be ≈ frac(np)
      const frac = Number((n * 3n) % 7n) / 7;
      expect(Math.abs(m - frac)).toBeLessThan(0.1 * sd + 0.6);
      expect(Math.abs(v / (sd * sd) - 1)).toBeLessThan(0.12);
    });
  }

  it('beta-binomial (small α) is overdispersed', () => {
    const xs: number[] = [];
    for (let k = 0; k < 4000; k++) xs.push(Number(splitCount(200n, 1n, 2n, hash2(5, k), 0.5)));
    const { v } = stats(xs);
    expect(v).toBeGreaterThan(3 * 50); // binomial variance is 50
  });

  it('edge cases', () => {
    expect(splitCount(0n, 1n, 2n, 1)).toBe(0n);
    expect(splitCount(10n, 0n, 2n, 1)).toBe(0n);
    expect(splitCount(10n, 2n, 2n, 1)).toBe(10n);
  });
});
