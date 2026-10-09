// Integer-only hashing. Everything that decides the *content* of the synthetic
// tree goes through these functions, so results are bit-identical on every
// device and JS engine (Math.imul and 32-bit ops are exactly specified).

/** murmur3 fmix32 finalizer. Returns an unsigned 32-bit integer. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash three 32-bit integers into one unsigned 32-bit integer. */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h = fmix32(h ^ Math.imul(b + 0x7f4a7c15, 0xcc9e2d51));
  h = fmix32(h ^ Math.imul(c ^ 0x1b873593, 0xe6546b64));
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32) for tests and scripted dives. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
