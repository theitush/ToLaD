/**
 * Keyed bijections on [0, domain) — balanced Feistel network over the smallest
 * even bit width covering the domain, plus cycle-walking (Black & Rogaway 2002)
 * to stay inside the domain. Invertible: `inverse(forward(x)) === x`.
 *
 * Two engines, chosen deterministically by domain size:
 *  - domain ≤ 2^52: Number arithmetic (halves ≤ 26 bits), fast.
 *  - larger: BigInt halves, round function output built from 32-bit hash words.
 * Both are integer-only.
 */
import { hashBig, mix } from './hash.ts';

export const FEISTEL_ROUNDS = 6;

/** Number of bits needed to represent x (x ≥ 0). bitLength(0) = 0. */
export function bitLength(x: bigint): number {
  let n = 0;
  while (x >= 0x100000000n) {
    x >>= 32n;
    n += 32;
  }
  const lo = Number(x);
  return n + (lo === 0 ? 0 : 32 - Math.clz32(lo));
}

export interface Permutation {
  readonly domain: bigint;
  forward(x: bigint): bigint;
  inverse(y: bigint): bigint;
}

/** Feistel half width in bits for a domain: ceil(bits(domain-1)/2), at least 1. */
function halfBitsFor(domain: bigint): number {
  const w = bitLength(domain - 1n);
  return Math.max(1, (w + 1) >> 1);
}

/** Number-engine permutation over [0, domain), domain ≤ 2^52. */
export class SmallPermutation {
  readonly domain: number;
  private readonly half: number; // bits per half
  private readonly scale: number; // 2^half
  private readonly mask: number;
  private readonly keys: number[];

  constructor(domain: number, key: number, rounds = FEISTEL_ROUNDS) {
    if (!(domain >= 1 && domain <= 4503599627370496 && Number.isInteger(domain))) {
      throw new RangeError(`SmallPermutation: bad domain ${domain}`);
    }
    this.domain = domain;
    this.half = halfBitsFor(BigInt(domain));
    this.scale = Number(1n << BigInt(this.half));
    this.mask = this.scale - 1;
    this.keys = [];
    for (let r = 0; r < rounds; r++) this.keys.push(mix(key >>> 0, r));
  }

  private round(k: number, r: number): number {
    return mix(k, r) & this.mask;
  }

  private enc(x: number): number {
    let L = Math.floor(x / this.scale);
    let R = x - L * this.scale;
    for (const k of this.keys) {
      const t = (L ^ this.round(k, R)) >>> 0;
      L = R;
      R = t;
    }
    return L * this.scale + R;
  }

  private dec(y: number): number {
    let L = Math.floor(y / this.scale);
    let R = y - L * this.scale;
    for (let i = this.keys.length - 1; i >= 0; i--) {
      const t = (R ^ this.round(this.keys[i]!, L)) >>> 0;
      R = L;
      L = t;
    }
    return L * this.scale + R;
  }

  forward(x: number): number {
    if (this.domain === 1) return 0;
    let y = this.enc(x);
    while (y >= this.domain) y = this.enc(y);
    return y;
  }

  inverse(y: number): number {
    if (this.domain === 1) return 0;
    let x = this.dec(y);
    while (x >= this.domain) x = this.dec(x);
    return x;
  }
}

/** BigInt-engine permutation over [0, domain), any size. */
export class BigPermutation {
  readonly domain: bigint;
  private readonly half: number;
  private readonly halfB: bigint;
  private readonly mask: bigint;
  private readonly words: number;
  private readonly keys: number[];

  constructor(domain: bigint, key: number, rounds = FEISTEL_ROUNDS) {
    if (domain < 1n) throw new RangeError('BigPermutation: domain < 1');
    this.domain = domain;
    this.half = halfBitsFor(domain);
    this.halfB = BigInt(this.half);
    this.mask = (1n << this.halfB) - 1n;
    this.words = Math.ceil(this.half / 32);
    this.keys = [];
    for (let r = 0; r < rounds; r++) this.keys.push(mix(key >>> 0, r));
  }

  private round(k: number, R: bigint): bigint {
    const h = hashBig(k, R);
    let out = 0n;
    for (let w = 0; w < this.words; w++) out = (out << 32n) | BigInt(mix(h, w));
    return out & this.mask;
  }

  private enc(x: bigint): bigint {
    let L = x >> this.halfB;
    let R = x & this.mask;
    for (const k of this.keys) {
      const t = L ^ this.round(k, R);
      L = R;
      R = t;
    }
    return (L << this.halfB) | R;
  }

  private dec(y: bigint): bigint {
    let L = y >> this.halfB;
    let R = y & this.mask;
    for (let i = this.keys.length - 1; i >= 0; i--) {
      const t = R ^ this.round(this.keys[i]!, L);
      R = L;
      L = t;
    }
    return (L << this.halfB) | R;
  }

  forward(x: bigint): bigint {
    if (this.domain === 1n) return 0n;
    let y = this.enc(x);
    while (y >= this.domain) y = this.enc(y);
    return y;
  }

  inverse(y: bigint): bigint {
    if (this.domain === 1n) return 0n;
    let x = this.dec(y);
    while (x >= this.domain) x = this.dec(x);
    return x;
  }
}

const SMALL_MAX = 1n << 52n;

/** Keyed permutation of [0, domain) with a bigint interface; picks the engine by size. */
export function makePermutation(domain: bigint, key: number, rounds = FEISTEL_ROUNDS): Permutation {
  if (domain <= SMALL_MAX) {
    const p = new SmallPermutation(Number(domain), key, rounds);
    return {
      domain,
      forward: (x) => BigInt(p.forward(Number(x))),
      inverse: (y) => BigInt(p.inverse(Number(y))),
    };
  }
  const p = new BigPermutation(domain, key, rounds);
  return { domain, forward: (x) => p.forward(x), inverse: (y) => p.inverse(y) };
}
