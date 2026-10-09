/**
 * A species' procedural individuals: addressing, public IDs, pedigree, attributes.
 *
 * Address  (g, i)          generation g ∈ [0, G), index i ∈ [0, N(g))
 * Ordinal  k = C(g) + i     global serial in [0, T), T = total ever
 * Public ID P(k)            keyed Feistel permutation of [0, T) with cycle-walking
 * Handle   "<key>#<id>"
 *
 * Pedigree between generations h = g−1 (parents, size M) and g (children, size N):
 *
 *  1. Arrangement of generation h into "slots" (who mates with whom):
 *       slot = X_h(L_h(i))
 *     L_h  brick-wall local shuffle: a small keyed Feistel inside windows of width W,
 *          window offset alternating with the parity of h (1-D stepping stone).
 *     X_h  rare long-range migrants: a global keyed permutation P_h marks
 *          E = floor(ε·M) slots as migrant slots; those are rotated among themselves
 *          by a keyed shift, so a migrant lands next to a far-away partner.
 *     Sexual: couple j = slots (2j, 2j+1), K = floor(M/2); slot parity is the sex
 *     (even = female, odd = male), so every couple is one F + one M. If M is odd
 *     the last slot is unpaired and has no children. Asexual: couple j = slot j, K = M.
 *
 *  2. Distribution of the N births over the K couples by a balanced binary split
 *     tree: node [a, b) holding n births sends nL of them to [a, m), m = a + ⌊(b−a)/2⌋.
 *       - nodes with > splitBlock couples: nL = ⌊n·(m−a)/(b−a) + U⌋, U ~ hash/2^32
 *         (proportional, dithered rounding: no random-walk drift);
 *       - smaller nodes: nL = splitCount(n, m−a, b−a) (binomial, or beta-binomial
 *         when familyConcentration is set), so family sizes are multinomial
 *         within each block.
 *     Couple j's children are the contiguous range [prefix_j, prefix_j + c_j) of
 *     generation g. parents(child) and children(couple) both walk one root-to-leaf
 *     path: O(log K) hash + binomial draws, nothing stored.
 *
 * Children of couple j sit at j·N/K ± O(√splitBlock), i.e. right above their
 * parents' slots, so edges are short in index space except for the migrant
 * fraction ε (whose couples have one far-away member).
 */
import { splitCount } from './binomial.ts';
import { makePermutation, SmallPermutation, type Permutation } from './feistel.ts';
import { hashBig, hashNum, hashString, mix, rand, u32ToUnit } from './hash.ts';
import { PopulationModel, type Segment } from './population.ts';

export interface Address {
  generation: number;
  index: bigint;
}

export interface ChildRange {
  /** Generation of the children (parent generation + 1). */
  generation: number;
  /** First child index. */
  start: bigint;
  /** Number of children (may be 0). */
  count: bigint;
}

export type Sex = 'female' | 'male' | 'none';

export interface Attributes {
  sex: Sex;
  /** Birth time in years since the species' origin (start of generation 0). */
  birthTime: number;
  /** Lifespan in years. */
  lifespan: number;
  /** birthTime + lifespan. */
  deathTime: number;
  /** Born at or before `now` and not yet dead at `now`. */
  alive: boolean;
}

/**
 * Hook for population sub-structure (demes). Not used by any built-in model yet:
 * a later task will plug real demographic models (Demes / stdpopsim) in here.
 * The local shuffle never crosses a deme boundary; migrant exchange is currently
 * global (later: between neighbouring demes at the model's migration rate).
 */
export interface DemeStructure {
  /** The contiguous index range [start, end) of the deme containing index i of generation g (size `size`). */
  demeRange(g: number, size: bigint, i: bigint): readonly [bigint, bigint];
}

/** One panmictic deme spanning the whole generation. */
export const PANMICTIC: DemeStructure = {
  demeRange: (_g, size) => [0n, size],
};

export interface SpeciesSpec {
  /** Short key used in handles, e.g. "human". */
  key: string;
  /** Optional extra salt (changing it re-rolls every individual). */
  seed?: number;
  /** true: two parents (mother, father); false: one parent. */
  sexual: boolean;
  /** Births-per-generation profile, piecewise linear. */
  segments: readonly Segment[];
  /** Generation length in years. */
  generationYears: number;
  /** Mean lifespan in years (lifespans are triangular on [0, 2·mean]). */
  lifespanYears: number;
  /** "Now" in years since origin. Default: end of the last generation. */
  now?: number;
  /** Local shuffle window width in individuals (multiple of 4, ≤ 2^16). Default 64. */
  window?: number;
  /** Fraction of slots that are long-range migrants. Default 1/256. */
  migrantRate?: number;
  /**
   * Dirichlet concentration α of family sizes (beta-binomial splitting). Smaller =
   * more variable family sizes ("sweepstakes" reproducers). Omit for multinomial.
   */
  familyConcentration?: number;
  /**
   * Split-tree nodes with more than this many couples split proportionally (with
   * dithered rounding) instead of binomially; randomness lives only inside blocks
   * of ≤ splitBlock couples. This bounds how far children drift from their
   * parents in index space (otherwise ~√N). Default 64.
   */
  splitBlock?: number;
  /** Population sub-structure hook. Default: PANMICTIC. */
  demes?: DemeStructure;
}

// Seed-derivation tags (fixed forever: changing one changes every individual).
const TAG_ID = 0x1d;
const TAG_SHUFFLE = 0x5f;
const TAG_MIGRANT = 0x3a;
const TAG_SPLIT = 0x59;
const TAG_ATTR = 0xa7;
const TAG_SEX = 0x5e;
// attribute field counters
const F_BIRTH = 1;
const F_LIFE_A = 2;
const F_LIFE_B = 3;

const TWO32 = 4294967296;

export class Species {
  readonly key: string;
  readonly sexual: boolean;
  readonly seed: number;
  readonly population: PopulationModel;
  readonly generations: number;
  readonly totalEver: bigint;
  readonly generationYears: number;
  readonly lifespanYears: number;
  readonly now: number;
  readonly window: bigint;
  /** Migrant fraction as a 32-bit fixed-point integer (ε·2^32). */
  readonly migrantFixed: bigint;
  readonly familyConcentration: number | undefined;
  readonly splitBlock: bigint;
  readonly demes: DemeStructure;
  private readonly idPerm: Permutation;

  constructor(spec: SpeciesSpec) {
    if (!/^[a-z0-9_-]+$/i.test(spec.key)) throw new RangeError(`bad species key "${spec.key}"`);
    this.key = spec.key;
    this.sexual = spec.sexual;
    this.seed = mix(hashString(spec.key), (spec.seed ?? 0) >>> 0);
    this.population = new PopulationModel(spec.segments, spec.sexual ? 2n : 1n);
    this.generations = this.population.generations;
    this.totalEver = this.population.totalEver;
    this.generationYears = spec.generationYears;
    this.lifespanYears = spec.lifespanYears;
    this.now = spec.now ?? this.generations * this.generationYears;
    const w = spec.window ?? 64;
    if (!Number.isInteger(w) || w < 4 || w % 4 !== 0 || w > 65536) {
      throw new RangeError('window must be a multiple of 4 in [4, 65536]');
    }
    this.window = BigInt(w);
    const eps = spec.migrantRate ?? 1 / 256;
    if (!(eps >= 0 && eps <= 1)) throw new RangeError('migrantRate must be in [0, 1]');
    this.migrantFixed = BigInt(Math.floor(eps * TWO32));
    this.familyConcentration = spec.familyConcentration;
    const blk = spec.splitBlock ?? 64;
    if (!Number.isSafeInteger(blk) || blk < 1) throw new RangeError('splitBlock must be a positive integer');
    this.splitBlock = BigInt(blk);
    this.demes = spec.demes ?? PANMICTIC;
    this.idPerm = makePermutation(this.totalEver, mix(this.seed, TAG_ID));
  }

  // ---------------------------------------------------------------- counts

  /** N(g): individuals born in generation g. */
  size(g: number): bigint {
    return this.population.size(g);
  }

  /** C(g): individuals born before generation g. */
  cumulative(g: number): bigint {
    return this.population.cumulative(g);
  }

  // ---------------------------------------------------------------- addressing

  private check(a: Address): void {
    const n = this.population.size(a.generation);
    if (a.index < 0n || a.index >= n) {
      throw new RangeError(`index ${a.index} out of [0, ${n}) in generation ${a.generation}`);
    }
  }

  /** (g, i) → global ordinal k = C(g) + i. */
  ordinal(a: Address): bigint {
    this.check(a);
    return this.population.cumulative(a.generation) + a.index;
  }

  /** Global ordinal → (g, i). */
  address(k: bigint): Address {
    const g = this.population.generationOf(k);
    return { generation: g, index: k - this.population.cumulative(g) };
  }

  /** Ordinal → public ID (bijection on [0, totalEver)). */
  encodeId(k: bigint): bigint {
    if (k < 0n || k >= this.totalEver) throw new RangeError('ordinal out of range');
    return this.idPerm.forward(k);
  }

  /** Public ID → ordinal. */
  decodeId(id: bigint): bigint {
    if (id < 0n || id >= this.totalEver) throw new RangeError('id out of range');
    return this.idPerm.inverse(id);
  }

  idOf(a: Address): bigint {
    return this.encodeId(this.ordinal(a));
  }

  addressOfId(id: bigint): Address {
    return this.address(this.decodeId(id));
  }

  /** Display handle "<key>#<id>". */
  handle(a: Address): string {
    return `${this.key}#${this.idOf(a)}`;
  }

  /** Inverse of `handle` (throws on a different species key). */
  addressOfHandle(handle: string): Address {
    const { key, id } = parseHandle(handle);
    if (key !== this.key) throw new RangeError(`handle is for "${key}", not "${this.key}"`);
    return this.addressOfId(id);
  }

  // ---------------------------------------------------------------- arrangement

  private genSeed(tag: number, g: number): number {
    return hashNum(mix(this.seed, tag), g);
  }

  /** Window [start, end) of the brick-wall local shuffle containing index i. */
  private windowOf(g: number, size: bigint, i: bigint): { start: bigint; end: bigint; key: number } {
    const [d0, d1] = this.demes.demeRange(g, size, i);
    const W = this.window;
    const off = (g & 1) === 1 ? W >> 1n : 0n;
    const win = (i - d0 + off) / W;
    const base = d0 + win * W - off;
    const start = base < d0 ? d0 : base;
    const end = base + W > d1 ? d1 : base + W;
    const key = hashBig(hashBig(this.genSeed(TAG_SHUFFLE, g), d0), win);
    return { start, end, key };
  }

  private localForward(g: number, size: bigint, i: bigint): bigint {
    const w = this.windowOf(g, size, i);
    const p = new SmallPermutation(Number(w.end - w.start), w.key);
    return w.start + BigInt(p.forward(Number(i - w.start)));
  }

  private localInverse(g: number, size: bigint, s: bigint): bigint {
    // windows are the same partition for indices and local slots
    const w = this.windowOf(g, size, s);
    const p = new SmallPermutation(Number(w.end - w.start), w.key);
    return w.start + BigInt(p.inverse(Number(s - w.start)));
  }

  private migrantSetup(g: number, size: bigint): { perm: Permutation; E: bigint; shift: bigint } | null {
    const E = (size * this.migrantFixed) >> 32n;
    if (E < 2n) return null;
    const seed = this.genSeed(TAG_MIGRANT, g);
    const perm = makePermutation(size, seed);
    const shift = 1n + (BigInt(rand(seed, 0)) * 0x100000000n + BigInt(rand(seed, 1))) % (E - 1n);
    return { perm, E, shift };
  }

  private migrate(g: number, size: bigint, s: bigint, dir: 1n | -1n): bigint {
    const m = this.migrantSetup(g, size);
    if (!m) return s;
    const r = m.perm.forward(s);
    if (r >= m.E) return s;
    let r2 = (r + dir * m.shift) % m.E;
    if (r2 < 0n) r2 += m.E;
    return m.perm.inverse(r2);
  }

  /** Mating slot of individual (g, i). */
  slotOf(a: Address): bigint {
    this.check(a);
    const size = this.population.size(a.generation);
    return this.migrate(a.generation, size, this.localForward(a.generation, size, a.index), 1n);
  }

  /** Individual occupying mating slot s of generation g. */
  individualAtSlot(g: number, s: bigint): Address {
    const size = this.population.size(g);
    if (s < 0n || s >= size) throw new RangeError('slot out of range');
    const local = this.migrate(g, size, s, -1n);
    return { generation: g, index: this.localInverse(g, size, local) };
  }

  /** Number of parent units (couples, or single parents) in generation g. */
  couples(g: number): bigint {
    const M = this.population.size(g);
    return this.sexual ? M >> 1n : M;
  }

  // ---------------------------------------------------------------- split tree

  /**
   * Walk the split tree distributing generation g's births over generation g−1's
   * couples. mode "child": find the couple whose range contains child index `x`.
   * mode "couple": find the child range of couple `x`.
   */
  private walk(g: number, mode: 'child' | 'couple', x: bigint): { couple: bigint; start: bigint; count: bigint } {
    const K = this.couples(g - 1);
    let n = this.population.size(g);
    const seedG = this.genSeed(TAG_SPLIT, g);
    const alpha = this.familyConcentration;
    let a = 0n;
    let b = K;
    let off = 0n;
    let depth = 0;
    while (b - a > 1n) {
      if (n === 0n && mode === 'couple') return { couple: x, start: off, count: 0n };
      const half = (b - a) >> 1n;
      const m = a + half;
      const k = b - a;
      const h = hashBig(mix(seedG, depth), a);
      let nL: bigint;
      if (n === 0n) nL = 0n;
      else if (k > this.splitBlock) {
        // stratified level: proportional split with random dithered rounding,
        // floor(n·half/k + U/2^32). Keeps every block's birth total within ±1 per
        // level of its expectation, so children stay above their parents.
        nL = ((n * half) << 32n) + BigInt(h) * k;
        nL = nL / (k << 32n);
      } else nL = splitCount(n, half, k, h, alpha);
      const goLeft = mode === 'child' ? x < off + nL : x < m;
      if (goLeft) {
        b = m;
        n = nL;
      } else {
        a = m;
        off += nL;
        n -= nL;
      }
      depth++;
    }
    return { couple: a, start: off, count: n };
  }

  // ---------------------------------------------------------------- pedigree

  /** Parents of (g, i): [mother, father] (sexual), [parent] (asexual), [] for g = 0. */
  parents(a: Address): Address[] {
    this.check(a);
    if (a.generation === 0) return [];
    const { couple } = this.walk(a.generation, 'child', a.index);
    const h = a.generation - 1;
    if (!this.sexual) return [this.individualAtSlot(h, couple)];
    return [this.individualAtSlot(h, couple << 1n), this.individualAtSlot(h, (couple << 1n) | 1n)];
  }

  /** Children of (g, i) as a contiguous index range in generation g+1. */
  children(a: Address): ChildRange {
    this.check(a);
    const next = a.generation + 1;
    if (next >= this.generations) return { generation: next, start: 0n, count: 0n };
    const s = this.slotOf(a);
    const j = this.sexual ? s >> 1n : s;
    if (j >= this.couples(a.generation)) return { generation: next, start: 0n, count: 0n };
    const r = this.walk(next, 'couple', j);
    return { generation: next, start: r.start, count: r.count };
  }

  /** The partner of (g, i) (the other member of its couple), or null. */
  partner(a: Address): Address | null {
    if (!this.sexual) return null;
    const s = this.slotOf(a);
    const other = s ^ 1n;
    if (other >= this.population.size(a.generation)) return null;
    return this.individualAtSlot(a.generation, other);
  }

  // ---------------------------------------------------------------- attributes

  private attrSeed(a: Address): number {
    return hashBig(this.genSeed(TAG_ATTR, a.generation), a.index);
  }

  sexOf(a: Address): Sex {
    if (!this.sexual) return 'none';
    const s = this.slotOf(a);
    if (s === this.population.size(a.generation) - 1n && (s & 1n) === 0n) {
      // the unpaired last slot: sex by hash
      return (rand(this.attrSeed(a), TAG_SEX) & 1) === 0 ? 'female' : 'male';
    }
    return (s & 1n) === 0n ? 'female' : 'male';
  }

  attributes(a: Address): Attributes {
    this.check(a);
    const h = this.attrSeed(a);
    const gy = this.generationYears;
    const birthTime = (a.generation + u32ToUnit(rand(h, F_BIRTH))) * gy;
    const lifespan = this.lifespanYears * (u32ToUnit(rand(h, F_LIFE_A)) + u32ToUnit(rand(h, F_LIFE_B)));
    const deathTime = birthTime + lifespan;
    return {
      sex: this.sexOf(a),
      birthTime,
      lifespan,
      deathTime,
      alive: birthTime <= this.now && deathTime > this.now,
    };
  }

  /** Deterministic per-individual uint32 stream for extra fields (counter ≥ 16 is free). */
  fieldHash(a: Address, field: number): number {
    return rand(this.attrSeed(a), field);
  }
}

/** Split "<key>#<id>" into its parts. */
export function parseHandle(handle: string): { key: string; id: bigint } {
  const m = /^([a-z0-9_-]+)#(\d+)$/i.exec(handle);
  if (!m) throw new SyntaxError(`bad handle "${handle}"`);
  return { key: m[1]!, id: BigInt(m[2]!) };
}
