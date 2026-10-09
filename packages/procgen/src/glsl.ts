/**
 * GLSL ES 3.00 port of `hash.ts`. Bit-identical to the TS functions of the same
 * name: GLSL `uint` arithmetic wraps mod 2^32 exactly like `Math.imul` / `>>> 0`.
 *
 * Paste into a `#version 300 es` shader (after the version line and precision
 * qualifiers). Defines: lowbias32, mixh, hash2, hash3, rand, randFloat.
 * (`mix` is a GLSL builtin, so the fold function is named `mixh` here.)
 */
export const HASH_GLSL = /* glsl */ `
uint lowbias32(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
uint mixh(uint h, uint v) {
  return lowbias32(h ^ lowbias32(v + 0x9e3779b9u));
}
uint hash2(uint a, uint b) { return mixh(a, b); }
uint hash3(uint a, uint b, uint c) { return mixh(mixh(a, b), c); }
uint rand(uint seed, uint counter) { return mixh(seed, counter); }
float randFloat(uint seed, uint counter) {
  return float(rand(seed, counter) >> 8u) * (1.0 / 16777216.0);
}
`;
