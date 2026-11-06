// What the fan draws today must be what the species' record says is alive (ToLaD#435). A leaf's width comes from
// its history's segments, its stored count (`alive`) from the pipeline's sum of its parts: nothing forced the two to
// agree, and the domestic pig, goat and dromedary were stored and not drawn. Reads the built data, every species.
import { beforeAll, describe, expect, it } from 'vitest';
import { aliveAt } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade, type SpeciesRec } from './panthera';

/** Drawn and stored may differ by this much (whole births per generation on the rarest species, the rescale to the species' ever). */
const FACTOR = 1.2;

describe('drawn today against the stored count, every species', () => {
  let species: SpeciesRec[] = [];
  beforeAll(async () => {
    await loadMammalsFromFiles();
    species = mammaliaClade().species;
  }, 120_000);

  it('agree within a small factor', () => {
    expect(species.length).toBeGreaterThan(6000);
    const off = species
      .map((s) => ({ s, drawn: aliveAt(s, 0) }))
      .filter(({ s, drawn }) => (s.alive > 0 || drawn > 0) && !(Math.max(s.alive, drawn) <= FACTOR * Math.min(s.alive, drawn)))
      .map(({ s, drawn }) => `${s.sci} stored ${s.alive.toPrecision(3)} drawn ${drawn.toPrecision(3)}${s.extinct ? ' (extinct)' : ''}`);
    expect(off).toEqual([]);
  });

  it('nothing with a stored count is marked extinct', () => {
    expect(species.filter((s) => s.extinct && s.alive > 0).map((s) => s.sci)).toEqual([]);
  });
});
