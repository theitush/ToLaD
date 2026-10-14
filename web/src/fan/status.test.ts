import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FELIDAE, type SpeciesRec } from './panthera';
import { loadClade, type RedListRec } from './panthera-extract';
import { RED_LIST, redListOf, statusOf } from './status';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/mammals');
const sp = (sci: string) => FELIDAE.species.find((s) => s.sci === sci)!;
const fake = (sci: string, extinct: boolean, redList: RedListRec | null) => ({ ...sp('Panthera leo'), sci, extinct, redList }) as SpeciesRec;
const rec = (category: string, year: number, source = 'iucn-2026-1'): RedListRec => ({
  category, year, source, sourceLabel: source, cite: `x ${year}`, url: source === 'not-listed' ? '' : 'https://www.iucnredlist.org/species/1/2',
});

// The living cats only the Mammal Diversity Database gives (ToLaD#278: split or described since Upham 2019): COMBINE has no
// generation length for them (allometric), PHYLACINE no range, and the Red List has assessed only Felis lybica (the rest NE).
const MDD_CATS = ['Felis lybica', 'Prionailurus javanensis', 'Leopardus braccatus', 'Leopardus pajeros', 'Leopardus fasciatus', 'Leopardus garleppi', 'Leopardus pardinoides'];

describe('Red List status from the data (ToLaD#48)', () => {
  it('every living wild cat reads its status from the data, with the assessment page', () => {
    // (The domestic cat is not listed: Not Evaluated, no page; see the extract test below.)
    for (const s of FELIDAE.species.filter((x) => !x.extinct && x.sci !== 'Felis catus')) {
      expect(s.redList, s.sci).toBeTruthy();
      if (MDD_CATS.includes(s.sci) && s.redList!.source === 'not-listed') {
        expect(s.redList!.category).toBe('NE');
        continue;
      }
      expect(s.redList!.source).toBe('iucn-2026-1');
      expect(s.redList!.url).toMatch(/^https:\/\/www\.iucnredlist\.org\/species\/\d+\/\d+$/);
      expect(s.redList!.cite).toMatch(/^IUCN Red List 2026-1, e\.T\d+A\d+$/);
    }
    expect(sp('Panthera tigris').redList).toMatchObject({ category: 'EN', year: 2022, url: 'https://www.iucnredlist.org/species/15955/214862019' });
  });

  it('the curated entry overrides only a newer assessment; the data wins otherwise', () => {
    // the lion's curated 2024 entry is older than the list's 2025 assessment
    expect(RED_LIST['Panthera leo'].year).toBeLessThan(sp('Panthera leo').redList!.year);
    expect(redListOf(sp('Panthera leo'))!.source).toBe('iucn-2026-1');
    // a curated entry newer than the data wins
    const old = fake('Panthera tigris', false, rec('CR', 2010));
    expect(redListOf(old)).toMatchObject({ category: 'EN', year: 2022, source: 'curated' });
    // no data: curated stands in
    expect(redListOf(fake('Panthera onca', false, null))).toMatchObject({ category: 'NT', source: 'curated' });
  });

  it('every category gets a chip, LC and NE included; fossils are prehistoric; EX since 1500 kept', () => {
    expect(statusOf(fake('Prionailurus bengalensis', false, rec('LC', 2023)))).toMatchObject({ kind: 'iucn', code: 'LC', label: 'Least Concern' });
    expect(statusOf(fake('Felis catus', false, rec('NE', 2026, 'not-listed')))).toMatchObject({ kind: 'iucn', code: 'NE', label: 'Not Evaluated' });
    expect(statusOf(fake('Panthera spelaea', true, null))).toEqual({ kind: 'prehistoric', label: 'Extinct (prehistoric)' });
    expect(statusOf(fake('Thylacinus cynocephalus', true, rec('EX', 2016)))).toMatchObject({ kind: 'iucn', code: 'EX' });
    expect(statusOf(fake('Panthera spelaea', true, rec('LC', 2020)))!.kind).toBe('prehistoric');
  });

  it('the extract reads any clade: every living cat has a status', () => {
    const cats = loadClade((rel) => new Uint8Array(readFileSync(resolve(DATA, rel))), 'Felidae');
    const living = cats.species.filter((s) => !s.extinct && s.redList);
    expect(living.length).toBeGreaterThan(30);
    for (const s of cats.species) if (!s.extinct) expect(s.redList, s.sci).not.toBeNull();
    const by = new Map(cats.species.map((s) => [s.sci, s.redList]));
    expect(by.get('Prionailurus bengalensis')).toMatchObject({ category: 'LC', year: 2023, source: 'iucn-2026-1' });
    expect(by.get('Acinonyx jubatus')).toMatchObject({ category: 'VU', source: 'iucn-2026-1' });
    expect(by.get('Felis catus')).toMatchObject({ category: 'NE', source: 'not-listed', url: '' });
  });
});
