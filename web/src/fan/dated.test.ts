// The fan's tree from the data (ToLaD#145): the dated tree (format 1.6) for any clade,
// with no hand table. Felidae is what the fan draws; Carnivora must build and lay out
// by the same path (drawing it well is #146).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layoutFan } from './layout';
import { loadClade } from './panthera-extract';
import { FELIDAE, speciesRec, type CladeRec } from './panthera';
import { allSplits, FELIDAE_TREE, speciesUnder, splitFrom } from './splits';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/mammals');
const read = (rel: string) => new Uint8Array(readFileSync(resolve(DATA, rel)));

/** A clade as the fan takes it: its dated tree and the species it places. */
function clade(name: string) {
  const raw = loadClade(read, name);
  const by = new Map(raw.species.map((s) => [s.sci, s]));
  const tree = splitFrom(raw.dated!, (s) => by.get(s)?.common ?? null, (s) => !!by.get(s)?.extinct, raw.datedMeta!);
  const placed = new Set(speciesUnder(tree));
  const species = raw.species.filter((s) => placed.has(s.sci)).map((s, i) => speciesRec(s, i));
  const sum = (f: (s: (typeof species)[number]) => number) => species.reduce((a, s) => a + f(s), 0);
  const rec: CladeRec = { ...raw, common: name, ever: sum((s) => s.ever), everLo: sum((s) => s.everLo), everHi: sum((s) => s.everHi), alive: sum((s) => s.alive), species };
  return { raw, tree, rec };
}

describe('the dated tree from the data', () => {
  it('Felidae: every split is dated and ordered, every species placed once, sources carried', () => {
    const sp = speciesUnder(FELIDAE_TREE);
    expect(new Set(sp).size).toBe(sp.length);
    expect(FELIDAE.species.map((s) => s.sci).sort()).toEqual([...sp].sort());
    for (const s of allSplits()) {
      expect(s.lo).toBeLessThanOrEqual(s.ageMa);
      expect(s.hi).toBeGreaterThanOrEqual(s.ageMa);
      // the ages rule (ToLaD#145): ensemble / alvarez dated clades, upham-interp and fossil-floor beside the old tags
      expect(s.source).toMatch(/^(ensemble|alvarez|upham|upham-interp|upham-imputed|fossil-floor|fossil|interpolated|override)$/);
      for (const k of s.kids) if (typeof k !== 'string') expect(k.ageMa).toBeLessThan(s.ageMa);
    }
    // the living cats: Upham's 40 matched (the Red List's, less the Sunda leopard cat and Chinese mountain cat it lumps), plus the
    // southern tiger cat Upham lacks
    const living = FELIDAE.species.filter((s) => !s.extinct);
    expect(living.length).toBeGreaterThanOrEqual(38);
    for (const s of ['Panthera leo', 'Panthera tigris', 'Felis catus', 'Neofelis diardi', 'Lynx pardinus', 'Leopardus guttulus']) expect(sp).toContain(s);
    // no synonym rows (#116): none of Open Tree's extra Felis names
    for (const s of ['Felis affinis', 'Felis haussa', 'Lynx vulgaris', 'Puma yaguarondi']) expect(sp).not.toContain(s);
    // common names and generation lengths come from the data
    expect(FELIDAE.species.find((s) => s.sci === 'Panthera leo')!.common).toBe('Lion');
    expect(FELIDAE.species.find((s) => s.sci === 'Panthera spelaea')!.common).toBe('Cave lion');
    for (const s of living) expect(s.genSource).toMatch(/COMBINE|curated history/);
  });

  it('Felidae: the override table holds Panthera (Figueiró 2017) and the domestic cat', () => {
    const big = allSplits().find((s) => speciesUnder(s).filter((n) => n.startsWith('Panthera ') && !FELIDAE.species.find((x) => x.sci === n)!.extinct).length === 5 && s.source === 'override')!;
    expect(big.ageMa).toBe(4.58);
    expect(big.cite).toMatch(/Figueiró/);
    const cat = allSplits().find((s) => s.kids.includes('Felis catus'))!;
    expect(cat.ageMa).toBeCloseTo(0.0095, 4);
  });

  it('Carnivora builds and lays out by the same path', { timeout: 600_000 }, () => {
    const { tree, rec } = clade('Carnivora');
    const splits = allSplits(tree);
    const living = rec.species.filter((s) => !s.extinct).length;
    const fan = layoutFan(rec, 'log', tree);
    expect(fan.branches.length).toBe(rec.species.length);
    expect(fan.nodes.length).toBe(splits.length);
    const bySource: Record<string, number> = {};
    for (const s of splits) bySource[s.source!] = (bySource[s.source!] ?? 0) + 1;
    console.log(`Carnivora: ${rec.species.length} species (${living} living), ${splits.length} splits, root ${tree.ageMa} Ma, by source ${JSON.stringify(bySource)}`);
    expect(living).toBeGreaterThan(250);
  });
});
