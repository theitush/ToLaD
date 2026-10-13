// The mammal level (ToLaD#247): every living mammal under the whole dated tree (dated/skeleton.json `all`).
import { describe, expect, it } from 'vitest';
import { CARNIVORA, mammaliaClade } from './panthera';
import { allSplits, familyLabel, mammaliaTree, ORDER_TAXA, speciesUnder, taxonKey } from './splits';
import { loadMammalsFromFiles } from './mammals-node';

// (The page fetches mammals.json; here it is built from the files the same way.)
await loadMammalsFromFiles();

describe('Mammalia from the data', () => {
  const tree = mammaliaTree();
  const clade = mammaliaClade();

  it('draws every living mammal the tree places, once', () => {
    const sp = speciesUnder(tree);
    expect(new Set(sp).size).toBe(sp.length);
    expect(new Set(sp)).toEqual(new Set(clade.species.map((s) => s.sci)));
    const living = clade.species.filter((s) => !s.extinct).length;
    // (stats.json counts.tips_extant: 5,854 living species in the data.)
    expect(living).toBeGreaterThan(5500);
    // The carnivores are all in it.
    const all = new Set(sp);
    for (const s of CARNIVORA.species) expect(all.has(s.sci)).toBe(true);
  });

  it('finds the orders by name, each labelled', () => {
    const orders = allSplits(tree).filter((s) => ORDER_TAXA.has(taxonKey(s.taxon ?? '')));
    expect(orders.length).toBeGreaterThanOrEqual(20);
    for (const o of orders) expect(familyLabel(o)).toBeTruthy();
    const names = orders.map((o) => familyLabel(o));
    for (const n of ['Rodents', 'Bats', 'Primates', 'Carnivores', 'Hoofed mammals & whales']) expect(names).toContain(n);
  });
});
