// Species search (ToLaD#157): what typing in the search field lists. Common and scientific names,
// accents and case ignored; a name that starts with the query first, then one with a word that
// starts with it, then one that merely contains it. A scientific name answers to its abbreviation
// too: "t rex", "T. rex" find *Tyrannosaurus rex* (ToLaD#564).

/** What the matcher needs of a species (SpeciesRec has these). */
export interface Named {
  common: string;
  sci: string;
  /** A domestic stock's leaf: its wild form's name finds it too (the wild boar finds the pig, ToLaD#435). */
  history?: { wildCommon?: string | null } | null;
}

/** A name folded for matching: accents stripped, lower case, runs of space and punctuation as one space. */
export function fold(s: string): string {
  // (Only a name with a letter past ASCII is decomposed: most are plain, and the index folds ~100,000, ToLaD#564.)
  return (NON_ASCII.test(s) ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const NON_ASCII = /[^\0-\x7f]/;

/** Letters a query needs before it matches inside a word ("li" would find every *Felis*). */
export const MID_MIN = 3;

/**
 * How a folded name matches a folded query: 0 a prefix, 1 a word starts with it, 2 inside a word
 * (a query of MID_MIN letters or more), -1 not at all.
 */
export function matchRank(name: string, q: string): number {
  if (!q) return -1;
  // (One scan for most names, which hold the query nowhere: ToLaD#564 runs this on ~50,000 species per keystroke.)
  const i = name.indexOf(q);
  if (i < 0) return -1;
  if (i === 0) return 0;
  if (name.charCodeAt(i - 1) === 32 || name.includes(` ${q}`, i)) return 1;
  return q.length >= MID_MIN ? 2 : -1;
}

/**
 * Whether a folded scientific name answers to a folded query as its abbreviated binomial (ToLaD#564): a query of one letter
 * and a word ("t rex"; "T. rex", "T.rex" fold to it) matches a name whose genus starts with the letter and whose epithet
 * (what follows the genus) starts with the word. A letter alone abbreviates nothing.
 */
export function matchAbbrev(sci: string, q: string): boolean {
  if (q.length < 3 || q[1] !== ' ' || q[0] < 'a' || q[0] > 'z' || sci[0] !== q[0]) return false;
  const sp = sci.indexOf(' ');
  return sp > 0 && sci.startsWith(q.slice(2), sp + 1);
}

/**
 * A list's species, each once, with their names folded, in the order of their folded common names (ToLaD#564): built once
 * and kept while the list holds the same species, as folding ~50,000 species' names and sorting the hits on every
 * keystroke took ~85 ms in node. (The page hands the search a new list of the same species at each of its renders.)
 */
interface Index {
  src: Named[];
  recs: Named[];
  common: string[];
  sci: string[];
  wild: (string | null)[];
}
let last: Index | null = null;

function indexOf(all: readonly Named[]): Index {
  if (last && last.src.length === all.length && all.every((s, k) => s === last!.src[k])) return last;
  const recs = [...new Set(all)];
  const c = recs.map((s) => fold(s.common));
  // (A stable sort: species of one name keep the list's order.)
  const order = recs.map((_, k) => k).sort((a, b) => (c[a] < c[b] ? -1 : c[a] > c[b] ? 1 : 0));
  last = {
    src: [...all],
    recs: order.map((k) => recs[k]),
    common: order.map((k) => c[k]),
    sci: order.map((k) => fold(recs[k].sci)),
    wild: order.map((k) => {
      const w = recs[k].history?.wildCommon;
      return w ? fold(w) : null;
    }),
  };
  return last;
}

/** Fold the species' names ahead of the first keystroke (the search panel, on opening). */
export function foldNames(all: readonly Named[]): void {
  indexOf(all);
}

/**
 * The species matching a query, best first: by how well either name matches (prefix, word start,
 * substring), a common-name match before a scientific one of the same kind, then by common name
 * (so "Leopard" comes before "Leopard cat"). A scientific name's abbreviation ("t rex") ranks as its
 * prefix. Each species once. An empty query matches nothing.
 */
export function searchSpecies<T extends Named>(all: readonly T[], query: string): T[] {
  const q = fold(query);
  if (!q) return [];
  const x = indexOf(all);
  // Ranks interleave: a common prefix (0), a scientific prefix or abbreviation (1), a common word start (2), a scientific
  // one (3), inside a word (4, 5). Each rank's species come in the index's order, by common name.
  const tiers: T[][] = [[], [], [], [], [], []];
  for (let k = 0; k < x.recs.length; k++) {
    const wild = x.wild[k];
    const rw = wild ? matchRank(wild, q) : -1;
    const rn = matchRank(x.common[k], q);
    const rc = rn < 0 ? rw : rw < 0 ? rn : Math.min(rn, rw);
    const rs = matchAbbrev(x.sci[k], q) ? 0 : matchRank(x.sci[k], q);
    const r = Math.min(rc < 0 ? 9 : 2 * rc, rs < 0 ? 9 : 2 * rs + 1);
    if (r < 9) tiers[r].push(x.recs[k] as T);
  }
  return tiers.flat();
}
