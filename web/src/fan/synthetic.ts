// The scale yardstick's tree (ToLaD#343): a deterministic synthetic clade with the mammal data's exact shape (a dated
// tree, living and fossil species, population histories, mass, generation length, names), at any size: 7k (sanity: it
// should time like the mammals), 70k (every vertebrate) and 1M (every animal). `?level=synthetic&n=70000` opens it in
// the page (synthetic-level.ts); the benchmark (scale.test.ts, scripts/scale.mjs) times the same path in node.
//
// Nothing here is fitted to a clade; every rule is a standard model, its parameters read off data/mammals:
// - Topology and dates: the reconstructed tree of a constant-rate birth-death process conditioned on n living tips and
//   the root age, drawn as a coalescent point process (Lambert & Stadler 2013, Theor. Popul. Biol. 90:113; Gernhard
//   2008, J. Theor. Biol. 253:769): the n-1 node depths are i.i.d. with P(H > t) = 1/(1 + (λ/r)(e^{rt} - 1)),
//   r = λ - μ, truncated at the root age, and the tree is their Cartesian tree (O(n), a stack). Relative extinction
//   μ/λ = 0.8; r = ln(n)/age (the expected size of a birth-death clade of that age).
// - Polytomies: a split closer than POLY_MA to its parent merges into it (unresolved dates, as the data's
//   imputed splits); fossils: a fossil fraction of lineages grafted on a random edge at a uniform time on it.
// - Mass: Brownian motion of log10 mass down the tree (the standard model of a trait's phylogenetic signal); the
//   generation length (allometric, slope 0.19 as the data's) and the natural population (Damuth's law, n ∝ M^-0.75)
//   follow from it with log-normal scatter; individuals alive now log-normal around the natural level.
// - Names by temporal banding (Avise & Johns 1999, PNAS 96:7358): the first split under 66 Ma on each path founds an
//   order, under 33 Ma a family (-idae), under 18 Ma a genus (bands set so the 7k tree names ~1.2k splits, the mammals 689);
//   species are genus + a unique epithet.
// - Histories (~10% of the living, as the data's curated 746 of 7,066): a baseline from the species' start, then a
//   few recent segments (a heavy tail of long ones), in the data's HistoryRec shape.
import type { MammalData } from './mammals-data';
import type { DatedSplit, HistoryRec, RawClade, RawSpecies } from './panthera-extract';

export interface SynthOpts {
  /** Living species (the tips of the reconstructed tree). */
  n: number;
  /** The random seed (same seed and n: the same tree, value for value). */
  seed?: number;
  /** The root's age, Ma (the mammals': 195). */
  age?: number;
  /** Fossil species per living one (the mammal data's: 51 / 7,015). */
  fossil?: number;
}

/** Splits closer than this to their parent (Ma) merge into it: the polytomies. */
const POLY_MA = 0.1;
/** Relative extinction μ/λ. */
const EPS = 0.8;
/** The temporal bands (Ma): order, family, genus. */
const BANDS = [66, 33, 18] as const;

/** A 32-bit PRNG (mulberry32): deterministic in node and every browser. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYL = ['ba', 'ce', 'di', 'fo', 'gu', 'ka', 'le', 'mi', 'no', 'pu', 'ra', 'se', 'ti', 'vo', 'xu', 'za', 'bri', 'cla', 'dro', 'fen', 'gla', 'hor', 'lin', 'mor', 'nex', 'pha', 'quo', 'rhi', 'sta', 'tor', 'ul', 'ven', 'wy', 'xer', 'yl', 'zo', 'an', 'el', 'is', 'or'];
const M4 = SYL.length ** 4;
/** A pseudo-Latin word, one per i < 40^4 (i scrambled by a multiplier coprime to it: a bijection, so no two collide; exact below 2^53). */
function word(i: number): string {
  let x = (i * 1640531527) % M4;
  let s = '';
  for (let k = 0; k < 4; k++) {
    s += SYL[x % SYL.length];
    x = Math.floor(x / SYL.length);
  }
  return s;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const ADJ = ['Greater', 'Lesser', 'Common', 'Northern', 'Southern', 'Pygmy', 'Giant', 'Striped', 'Spotted', 'Red', 'Grey', 'Long-tailed', 'Short-eared', 'Desert', 'Forest', 'Island', 'Mountain', 'Black', 'Golden', 'Woolly'];

/** A standard normal (Box-Muller). */
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

/** The synthetic clade, as mammals.json holds the mammals (MammalData, without a layout seed). */
export function synthData(o: SynthOpts): MammalData {
  const n = Math.max(2, Math.floor(o.n));
  const age = o.age ?? 195;
  const r = rng((o.seed ?? 1) * 2654435761 + n);
  // ---- The coalescent point process: n-1 node depths, their Cartesian tree.
  const rr = Math.log(n) / age;
  const lam = rr / (1 - EPS);
  const F = (t: number) => 1 + (lam / rr) * Math.expm1(rr * t);
  const cT = 1 - 1 / F(age);
  const H = new Float64Array(n - 1);
  let hMax = 0;
  for (let i = 0; i < n - 1; i++) {
    const f = 1 / (1 - r() * cT);
    H[i] = Math.log1p(((f - 1) * rr) / lam) / rr;
    if (H[i] > hMax) hMax = H[i];
  }
  // (Rescaled so the deepest is the root's age.)
  for (let i = 0; i < n - 1; i++) H[i] *= age / hMax;
  // Nodes: 0..n-1 tips (living species), n.. splits. parent[], age[] per node; kids built after.
  const cap0 = 2 * n + 4 * Math.ceil(n * (o.fossil ?? 51 / 7015)) + 4;
  const parent = new Int32Array(cap0).fill(-1);
  const nodeAge = new Float64Array(cap0);
  let count = n;
  const stack: number[] = [0];
  for (let i = 1; i < n; i++) {
    const h = H[i - 1];
    const s = count++;
    nodeAge[s] = h;
    let last = -1;
    while (stack.length && nodeAge[stack[stack.length - 1]] < h) last = stack.pop()!;
    // s takes `last` (the top of what it rose over) as its left daughter; it becomes the right daughter of the stack top.
    parent[last] = s;
    if (stack.length) parent[s] = stack[stack.length - 1];
    parent[i] = s;
    stack.push(s, i);
  }
  // (A tip pushed then risen over: handled, its parent set when it was pushed.)
  const root = stack[0];
  // ---- Fossils: a fossil fraction of lineages, each grafted on a random edge at a uniform time along it.
  const extinct = new Uint8Array(cap0);
  const t1 = new Float64Array(cap0);
  const nFoss = Math.round(n * (o.fossil ?? 51 / 7015));
  for (let k = 0; k < nFoss; k++) {
    let e = Math.floor(r() * count);
    if (e === root) e = 0;
    const p = parent[e];
    const t = nodeAge[e] + r() * (nodeAge[p] - nodeAge[e]);
    const s = count++;
    const f = count++;
    nodeAge[s] = t;
    parent[s] = p;
    parent[e] = s;
    parent[f] = s;
    extinct[f] = 1;
    // (Extinct at a time skewed young, as the data's: most fossils of a species-level tree are Pleistocene.)
    t1[f] = t * r() ** 4;
    nodeAge[f] = t1[f];
  }
  // ---- Kids (left to right as built), polytomies merged.
  const kids: number[][] = Array.from({ length: count }, () => []);
  for (let v = 0; v < count; v++) if (v !== root && parent[v] >= 0) kids[parent[v]].push(v);
  const isTip = (v: number) => v < n || extinct[v] === 1;
  const merged = new Uint8Array(count);
  // (Pre-order with an explicit stack: deep enough trees would overflow recursion here.)
  const order: number[] = [];
  for (const st = [root]; st.length; ) {
    const v = st.pop()!;
    order.push(v);
    for (const k of kids[v]) st.push(k);
  }
  for (let j = order.length - 1; j >= 0; j--) {
    const v = order[j];
    if (isTip(v) || v === root) continue;
    if (nodeAge[parent[v]] - nodeAge[v] < POLY_MA) merged[v] = 1;
  }
  const eff = (v: number): number[] => (merged[v] ? kids[v].flatMap(eff) : kids[v]);
  // ---- Mass: Brownian motion of log10 grams down the tree; names by temporal banding.
  const logM = new Float64Array(count);
  const sig = 1.06 / Math.sqrt(age);
  const rank = new Int8Array(count).fill(-1);
  logM[root] = 1.8;
  for (const v of order) {
    if (v === root) continue;
    const p = parent[v];
    logM[v] = logM[p] + gauss(r) * sig * Math.sqrt(Math.max(0, nodeAge[p] - nodeAge[v]));
    if (!isTip(v) && !merged[v]) for (let b = 0; b < BANDS.length; b++) if (nodeAge[v] < BANDS[b] && nodeAge[p] >= BANDS[b]) rank[v] = b;
  }
  // The names: a word per named split, the genus each species takes from its nearest genus (else a word of its own).
  let wt = 0;
  let we = 0;
  const taxon = new Map<number, string>();
  const genus = new Int32Array(count).fill(-1);
  for (const v of order) {
    if (rank[v] >= 0) taxon.set(v, cap(word(wt++)) + (rank[v] === 0 ? 'ia' : rank[v] === 1 ? 'idae' : ''));
    if (v !== root) genus[v] = rank[v] === 2 ? v : genus[parent[v]];
  }
  const genusName = (v: number) => (genus[v] >= 0 ? taxon.get(genus[v])! : cap(word(wt++)));
  // ---- Species and their records; the dated tree over them.
  const species: RawSpecies[] = [];
  const sciOf = new Map<number, string>();
  const split = (v: number, from: number): DatedSplit | string => {
    if (isTip(v)) return sciOf.get(v)!;
    const a = nodeAge[v];
    return {
      age: a,
      lo: a * 0.85,
      hi: a * 1.15,
      source: from >= 0 && extinct[from] ? 'fossil' : 'ensemble',
      name: taxon.get(v) ?? '',
      nameEn: '',
      loose: 0,
      override: null,
      kids: [],
    };
  };
  let gid = 1;
  const gidOf = new Int32Array(count);
  for (const v of order) gidOf[v] = gid++;
  for (const v of order) {
    if (!isTip(v)) continue;
    const p = merged[parent[v]] ? effParent(v) : parent[v];
    const dead = extinct[v] === 1;
    const lm = logM[v] + gauss(r) * 0.1;
    const genY = 10 ** (0.498 + 0.186 * (lm - 1.8) + gauss(r) * 0.12);
    const nat = 10 ** (5.8 - 0.75 * (lm - 1.8) + gauss(r) * 0.9);
    const t0 = nodeAge[p];
    const alive = dead ? 0 : nat * 10 ** (gauss(r) * 0.35 - 0.05);
    const ever = nat * (((t0 - t1[v]) * 1e6) / genY) * 2;
    const sci = `${genusName(v)} ${word(we++)}`;
    sciOf.set(v, sci);
    const hist = !dead && r() < 0.106 ? history(r, t0, genY, nat, alive) : null;
    species.push({
      gid: gidOf[v],
      sci,
      ever,
      everLo: ever / 10,
      everHi: ever * 10,
      alive,
      grade: 'D',
      t0,
      t1: t1[v],
      extinct: dead,
      dateSource: 'interpolated',
      parentGid: gidOf[p],
      history: hist,
      redList: dead ? null : { category: ['LC', 'LC', 'LC', 'NT', 'VU', 'EN', 'CR', 'DD'][Math.floor(r() * 8)], year: 2020, source: 'synthetic', sourceLabel: 'Synthetic', cite: 'synthetic (ToLaD#343)', url: '' },
      natural: r() < 0.77 ? { n: nat, lo: nat / 4, hi: nat * 4, km2Natural: nat * 10, km2Current: dead ? 0 : alive * 10 } : null,
      common: r() < 0.94 ? `${ADJ[Math.floor(r() * ADJ.length)]} ${word(Math.floor(r() * M4))}` : null,
      gen: { years: Math.round(genY * 1000) / 1000, how: 'synthetic' },
      mass: { g: Math.round(10 ** lm * 10) / 10, how: 'synthetic' },
    });
  }
  function effParent(v: number): number {
    let p = parent[v];
    while (merged[p]) p = parent[p];
    return p;
  }
  // The dated tree: built top-down in pre-order (no recursion), each unmerged node a daughter of its nearest unmerged
  // ancestor (a merged split's daughters join its parent's: the polytomy).
  const built = new Map<number, DatedSplit>();
  for (const v of order) {
    if (merged[v]) continue;
    const s = split(v, kids[v].length ? kids[v][kids[v].length - 1] : -1);
    if (typeof s !== 'string') built.set(v, s);
    if (v !== root) built.get(effParent(v))!.kids.push(s);
  }
  const dated = built.get(root)!;
  const sum = (f: (s: RawSpecies) => number) => species.reduce((a, s) => a + f(s), 0);
  const clade: RawClade = {
    gid: 0,
    sci: 'Synthetica',
    ever: sum((s) => s.ever),
    everLo: sum((s) => s.everLo),
    everHi: sum((s) => s.everHi),
    alive: sum((s) => s.alive),
    grade: 'D',
    t0: age * 1.07,
    t1: 0,
    extinct: false,
    dateSource: 'synthetic',
    tile: -1,
    species,
    naturalMeta: { label: 'natural (pre-human) baseline: synthetic', grade: 'D', kind: 'reconstruction', cite: 'synthetic (ToLaD#343)', url: '' },
    dated,
    datedMeta: { upham: 'synthetic birth-death tree (ToLaD#343)', alvarez: 'synthetic', genHow: ['synthetic'], commonSource: 'synthetic' },
  };
  return { clade, wiki: {} };
}

/** A curated-style history: a baseline from the species' start, then recent segments (a few; a tenth many). */
function history(r: () => number, t0: number, G: number, nat: number, alive: number): HistoryRec {
  const k = r() < 0.75 ? 2 : 2 + Math.floor(r() ** 2 * 110);
  const gens = Math.max(1, Math.round((t0 * 1e6) / G));
  const segs: HistoryRec['segments'] = [{ year0: Math.round(-t0 * 1e6), generations: gens, startSize: nat * 2, endSize: nat * 2, grade: 'D', kind: 'baseline' }];
  let size = nat * 2;
  let year = 2026 - (k + 1) * 10 * G;
  for (let j = 0; j < k; j++) {
    const g = 1 + Math.floor(r() * 10);
    const end = j === k - 1 ? Math.max(2, alive * 2) : size * 10 ** (gauss(r) * 0.2);
    segs.push({ year0: year, generations: g, startSize: size, endSize: end, grade: 'D', kind: 'estimate' });
    size = end;
    year += g * G;
  }
  return {
    use: 'counts',
    component: 'wild',
    scope: 'global, all ages',
    notes: 'synthetic (ToLaD#343)',
    modelled: null,
    events: [],
    G,
    L: G / 2,
    nowYear: 2026,
    points: [
      { year: 1750, n: nat, lo: nat / 2, hi: nat * 2, grade: 'D', kind: 'estimate', baseline: true, cite: 'synthetic', url: '', note: '' },
      { year: 2020, n: alive, lo: alive / 2, hi: alive * 2, grade: 'D', kind: 'estimate', baseline: false, cite: 'synthetic', url: '', note: '' },
    ],
    segments: segs,
  };
}

/** Where the benchmark frames its two depths: the largest order, the largest family in it, a species in that. */
export function synthMarks(d: MammalData): { order: string; family: string; species: string } {
  let best: [number, string, DatedSplit | null] = [0, '', null];
  const size = (t: DatedSplit | string): number => (typeof t === 'string' ? 1 : t.kids.reduce((a, k) => a + size(k), 0));
  const biggest = (t: DatedSplit, suffix: (s: string) => boolean) => {
    best = [0, '', null];
    const walk = (s: DatedSplit) => {
      if (s.name && suffix(s.name)) {
        const z = size(s);
        if (z > best[0]) best = [z, s.name, s];
        return;
      }
      for (const k of s.kids) if (typeof k !== 'string') walk(k);
    };
    walk(t);
    return best;
  };
  const [, order, ot] = biggest(d.clade.dated!, (s) => s.endsWith('ia'));
  const [, family, ft] = biggest(ot ?? d.clade.dated!, (s) => s.endsWith('idae'));
  let t: DatedSplit | string = ft ?? ot ?? d.clade.dated!;
  while (typeof t !== 'string') t = t.kids[0];
  const sp = d.clade.species.find((s) => s.sci === t);
  return { order, family, species: sp?.common ?? sp?.sci ?? '' };
}
