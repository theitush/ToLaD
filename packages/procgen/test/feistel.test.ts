import { describe, expect, it } from 'vitest';
import { BigPermutation, bitLength, makePermutation, SmallPermutation } from '../src/feistel.ts';
import { rand } from '../src/hash.ts';

describe('bitLength', () => {
  it('matches toString(2).length', () => {
    for (const x of [0n, 1n, 2n, 3n, 255n, 256n, (1n << 32n) - 1n, 1n << 32n, (1n << 100n) + 7n]) {
      expect(bitLength(x)).toBe(x === 0n ? 0 : x.toString(2).length);
    }
  });
});

describe('Feistel permutation is a bijection on [0, domain)', () => {
  it('exhaustive, small engine, domains 1..300', () => {
    for (let d = 1; d <= 300; d++) {
      const p = new SmallPermutation(d, d * 7919);
      const seen = new Uint8Array(d);
      for (let x = 0; x < d; x++) {
        const y = p.forward(x);
        if (!(y >= 0 && y < d) || seen[y] || p.inverse(y) !== x) throw new Error(`domain ${d}: bad at x=${x}`);
        seen[y] = 1;
      }
    }
  });

  it('exhaustive, BigInt engine on small domains', () => {
    for (const d of [1n, 2n, 3n, 17n, 64n, 65n, 1000n]) {
      const p = new BigPermutation(d, 1234);
      const seen = new Set<bigint>();
      for (let x = 0n; x < d; x++) {
        const y = p.forward(x);
        expect(y < d && y >= 0n).toBe(true);
        seen.add(y);
        expect(p.inverse(y)).toBe(x);
      }
      expect(seen.size).toBe(Number(d));
    }
  });

  it('round-trips on huge domains (sampled)', () => {
    for (const d of [102555000000n, (1n << 52n) - 3n, (1n << 52n) + 1n, 10n ** 30n, 10n ** 40n + 17n]) {
      const p = makePermutation(d, 42);
      for (let k = 0; k < 200; k++) {
        const x = ((BigInt(rand(1, k)) << 96n) ^ (BigInt(rand(2, k)) << 64n) ^ (BigInt(rand(3, k)) << 32n) ^ BigInt(rand(4, k))) % d;
        const y = p.forward(x);
        expect(y < d).toBe(true);
        expect(p.inverse(y)).toBe(x);
      }
    }
  });

  it('scrambles (consecutive inputs map far apart)', () => {
    const d = 102555000000n;
    const p = makePermutation(d, 9);
    let far = 0;
    for (let x = 0n; x < 100n; x++) {
      const dy = p.forward(x + 1n) - p.forward(x);
      if (dy > d / 1000n || dy < -d / 1000n) far++;
    }
    expect(far).toBeGreaterThan(95);
  });
});
