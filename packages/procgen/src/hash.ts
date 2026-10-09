/**
 * 32-bit integer hash and counter-based RNG.
 *
 * Everything here is integer-only (`Math.imul`, `^`, `>>>`), so it is bit-identical
 * across JS engines and identical to the GLSL port in `glsl.ts`.
 *
 * The core mixer is Chris Wellons' "lowbias32" (hash-prospector), a 2-multiply
 * avalanche hash. `mix(h, v)` folds one 32-bit word into a running hash state;
 * `rand(seed, counter)` is the counter-based RNG: stateless, any draw is O(1).
 */

const GOLDEN = 0x9e3779b9;
const TWO32 = 4294967296;
const INV_TWO32 = 1 / TWO32;
const INV_TWO24 = 1 / 16777216;

/** lowbias32: bijective avalanche mixer on uint32. */
export function lowbias32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** Fold one uint32 word `v` into hash state `h`. Not commutative. */
export function mix(h: number, v: number): number {
  return lowbias32((h ^ lowbias32((v + GOLDEN) >>> 0)) >>> 0);
}

/** Hash of two words. */
export function hash2(a: number, b: number): number {
  return mix(a >>> 0, b >>> 0);
}

/** Hash of three words. */
export function hash3(a: number, b: number, c: number): number {
  return mix(mix(a >>> 0, b >>> 0), c >>> 0);
}

/** Counter-based RNG: the `counter`-th uint32 of stream `seed`. */
export function rand(seed: number, counter: number): number {
  return mix(seed >>> 0, counter >>> 0);
}

/** Uniform float in [0, 1) with 24 bits, matching GLSL `randFloat`. Exact (power-of-two scale). */
export function randFloat(seed: number, counter: number): number {
  return (rand(seed, counter) >>> 8) * INV_TWO24;
}

/** Uniform float in [0, 1) with 32 bits (CPU only). */
export function u32ToUnit(u: number): number {
  return u * INV_TWO32;
}

/**
 * Fold a non-negative integer of any size into the hash state, as little-endian
 * 32-bit limbs (at least one limb). `hashNum` and `hashBig` agree on equal values.
 */
export function hashBig(h: number, x: bigint): number {
  if (x < 0n) throw new RangeError('hashBig: negative');
  do {
    h = mix(h, Number(x & 0xffffffffn));
    x >>= 32n;
  } while (x > 0n);
  return h;
}

/** `hashBig` for a safe non-negative integer Number (< 2^53). */
export function hashNum(h: number, x: number): number {
  if (x < TWO32) return mix(h, x >>> 0);
  const lo = x % TWO32;
  const hi = (x - lo) / TWO32;
  return mix(mix(h, lo), hi);
}

/** Hash a string (UTF-16 code units) into a uint32 seed. */
export function hashString(s: string, h = 0x2545f491): number {
  h = mix(h, s.length);
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return h;
}
