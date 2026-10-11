// Species search (ToLaD#157): what typing in the search field lists. Common and scientific names,
// accents and case ignored; a name that starts with the query first, then one with a word that
// starts with it, then one that merely contains it.

/** What the matcher needs of a species (SpeciesRec has these). */
export interface Named {
  common: string;
  sci: string;
}

/** A name folded for matching: accents stripped, lower case, runs of space and punctuation as one space. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Letters a query needs before it matches inside a word ("li" would find every *Felis*). */
export const MID_MIN = 3;

/**
 * How a folded name matches a folded query: 0 a prefix, 1 a word starts with it, 2 inside a word
 * (a query of MID_MIN letters or more), -1 not at all.
 */
export function matchRank(name: string, q: string): number {
  if (!q) return -1;
  if (name.startsWith(q)) return 0;
  if (name.includes(` ${q}`)) return 1;
  return q.length >= MID_MIN && name.includes(q) ? 2 : -1;
}

/**
 * The species matching a query, best first: by how well either name matches (prefix, word start,
 * substring), a common-name match before a scientific one of the same kind, then by common name
 * (so "Leopard" comes before "Leopard cat"). Each species once. An empty query matches nothing.
 */
export function searchSpecies<T extends Named>(all: readonly T[], query: string): T[] {
  const q = fold(query);
  if (!q) return [];
  const hits: { s: T; r: number; name: string }[] = [];
  const seen = new Set<T>();
  for (const s of all) {
    if (seen.has(s)) continue;
    seen.add(s);
    const name = fold(s.common);
    const rc = matchRank(name, q);
    const rs = matchRank(fold(s.sci), q);
    // Ranks interleave: a common prefix (0), a scientific prefix (0.5), a common word start (1)...
    const r = Math.min(rc < 0 ? Infinity : rc, rs < 0 ? Infinity : rs + 0.5);
    if (r < Infinity) hits.push({ s, r, name });
  }
  hits.sort((a, b) => a.r - b.r || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return hits.map((h) => h.s);
}
