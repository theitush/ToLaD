/**
 * Deterministic binomial / beta-binomial sampling for the split tree.
 *
 * Only IEEE basic arithmetic, Math.sqrt / Math.floor and integer hashing are used,
 * so results are bit-identical across engines.
 *
 * Method (documented choice):
 *  - n ≤ EXACT_MAX (64): exact — sum of n Bernoulli(p) trials, each one hash draw
 *    compared against p·2^32 (an exact power-of-two scaling).
 *  - n > EXACT_MAX: normal approximation with continuity correction. The mean is
 *    computed exactly in BigInt (floor(n·num/den) plus the fractional part), the
 *    deviate z comes from an integer inverse-CDF table (normal-table.ts) indexed
 *    by hash bits with linear interpolation, and σ = Math.sqrt(n·p·q). Result is
 *    clamped to [0, n]. With p ≈ 1/2 and n > 64, npq > 16, where the normal
 *    approximation is good; tails are truncated at |z| ≈ 6.3.
 *  - Beta-binomial (Dirichlet-multinomial over the leaves): when a concentration
 *    α is given, p is first perturbed to p' ~ Beta(α·kL, α·kR), approximated by a
 *    clamped normal with the beta's mean and variance pq/(α·k + 1). Recursively
 *    splitting with these node-level betas is exactly a Dirichlet(α,…,α)-multinomial
 *    at the leaves (up to the normal approximation of each beta).
 */
import { mix } from './hash.ts';
import { NORMAL_TABLE, NORMAL_TABLE_BUCKET_BITS, NORMAL_TABLE_SCALE_BITS } from './normal-table.ts';

export const EXACT_MAX = 64;
const TWO32 = 4294967296;
const FRAC_BITS = 32 - NORMAL_TABLE_BUCKET_BITS; // 22
const FRAC_MASK = (1 << FRAC_BITS) - 1;
const INV_FRAC = 1 / (1 << FRAC_BITS);
const INV_SCALE = 1 / (1 << NORMAL_TABLE_SCALE_BITS);
const P_FIXED_BITS = 52n;
const P_FIXED_ONE = 1n << P_FIXED_BITS;
const P_FIXED_ONE_N = 4503599627370496; // 2^52

/** Standard normal deviate from one uint32 via the integer inverse-CDF table. */
export function normalFromU32(u: number): number {
  const j = u >>> FRAC_BITS;
  const f = (u & FRAC_MASK) * INV_FRAC;
  const a = NORMAL_TABLE[j]!;
  const b = NORMAL_TABLE[j + 1]!;
  return (a + (b - a) * f) * INV_SCALE;
}

// Counter slots used inside one node's RNG stream.
const C_NORMAL = 0x100;
const C_BETA = 0x101;

/**
 * Number of the n items that fall in the left part when splitting with
 * probability num/den (0 ≤ num ≤ den, den ≥ 1), using hash stream `h`.
 * `alpha` (optional, > 0) turns it into a beta-binomial with node size `den`.
 */
export function splitCount(n: bigint, num: bigint, den: bigint, h: number, alpha?: number): bigint {
  if (n === 0n || num === 0n) return 0n;
  if (num === den) return n;

  let pNum = num;
  let pDen = den;
  let p = Number(num) / Number(den);

  if (alpha !== undefined && alpha > 0 && Number.isFinite(alpha)) {
    const rho = 1 / (alpha * Number(den) + 1);
    const z = normalFromU32(mix(h, C_BETA));
    let pp = p + z * Math.sqrt(p * (1 - p) * rho);
    if (pp < 0) pp = 0;
    else if (pp > 1) pp = 1;
    // re-express p' as an exact fixed-point rational so the mean stays integer-exact
    const fixed = Math.floor(pp * P_FIXED_ONE_N);
    pNum = BigInt(fixed);
    pDen = P_FIXED_ONE;
    p = fixed / P_FIXED_ONE_N;
    if (pNum === 0n) return 0n;
    if (pNum === pDen) return n;
  }

  if (n <= BigInt(EXACT_MAX)) {
    const threshold = p * TWO32; // exact: power-of-two scale
    const nn = Number(n);
    let c = 0;
    for (let k = 0; k < nn; k++) if (mix(h, k) < threshold) c++;
    return BigInt(c);
  }

  const prod = n * pNum;
  const meanFloor = prod / pDen;
  const frac = Number(prod - meanFloor * pDen) / Number(pDen);
  const sd = Math.sqrt(Number(n) * p * (1 - p));
  const z = normalFromU32(mix(h, C_NORMAL));
  const dev = Math.floor(frac + z * sd + 0.5);
  let r = meanFloor + BigInt(dev);
  if (r < 0n) r = 0n;
  else if (r > n) r = n;
  return r;
}
