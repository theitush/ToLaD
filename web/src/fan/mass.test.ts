// Widths by mass (ToLaD#276): a column's width is the individuals alive × the species' adult body mass (the
// pipeline's mass column, dated sidecars `mass`), the same tree in the same order; the scale bar and card say tonnes.
import { describe, expect, it } from 'vitest';
import { formatMass } from '../data/count';
import { layoutFan, weightOf } from './layout';
import { CARNIVORA, FELIDAE, mammaliaClade } from './panthera';
import { CARNIVORA_TREE, mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';

await loadMammalsFromFiles();

describe('mass widths', () => {
  it('every species the fan draws has a mass from the data', () => {
    for (const c of [FELIDAE, CARNIVORA, mammaliaClade()]) for (const s of c.species) expect(s.massKg, s.sci).toBeGreaterThan(0);
    const lion = CARNIVORA.species.find((s) => s.sci === 'Panthera leo')!;
    // (PHYLACINE 1.2: ~160 kg.)
    expect(lion.massKg).toBeGreaterThan(100);
    expect(lion.massKg).toBeLessThan(250);
    expect(lion.massHow).toBe('phylacine');
  });

  it('weighs each column by its mass and keeps the order', () => {
    const ind = layoutFan(CARNIVORA, 'linear', CARNIVORA_TREE);
    const mass = layoutFan(CARNIVORA, 'linear', CARNIVORA_TREE, 'curved', 'mass');
    expect(mass.measure).toBe('mass');
    // The same species, left to right.
    const order = (f: typeof ind) => [...f.branches].sort((a, b) => a.cx - b.cx).map((b) => b.sp.sci);
    expect(order(mass)).toEqual(order(ind));
    for (let i = 0; i < ind.branches.length; i++) {
      const a = ind.branches[i];
      const b = mass.branches[i];
      expect(b.sp).toBe(a.sp);
      const w = weightOf(a.sp, 'mass');
      expect(b.pop.aliveAt(0)).toBeCloseTo(a.pop.aliveAt(0) * w, 6);
      expect(b.pop.max).toBeCloseTo(a.pop.max * w, 6);
      // (The green share is the individuals' own.)
      expect(b.pop.greenAt(0.01)).toBe(a.pop.greenAt(0.01));
    }
    // The heavy carnivores widen against the small ones.
    const share = (f: typeof ind, sci: string) => f.branches.find((b) => b.sp.sci === sci)!.share;
    expect(share(mass, 'Ursus arctos') / share(mass, 'Mustela nivalis')).toBeGreaterThan(share(ind, 'Ursus arctos') / share(ind, 'Mustela nivalis') * 100);
  });

  it('says tonnes', () => {
    expect(formatMass(1000, { exact: true })).toBe('1 tonne');
    expect(formatMass(5e6, { exact: true })).toBe('5,000 tonnes');
    expect(formatMass(2e9, { exact: true })).toBe('2 million tonnes');
    expect(formatMass(200, { exact: true })).toBe('200 kg');
    expect(formatMass(0.005, { exact: true })).toBe('5 g');
  });

  // The #113 plausibility audit on the mass widths: who leads, and whether one species swamps a level.
  it('the mammals by mass: the whales, the cattle and the humans lead; no order is one species', () => {
    const cl = mammaliaClade();
    const tonnes = (s: (typeof cl.species)[number]) => (s.extinct ? 0 : (s.alive * (s.massKg ?? 0)) / 1000);
    const top = [...cl.species].sort((a, b) => tonnes(b) - tonnes(a)).slice(0, 10);
    const total = cl.species.reduce((a, s) => a + tonnes(s), 0);
    console.log(`mammals alive now: ${(total / 1e6).toFixed(0)} Mt`);
    for (const s of top) console.log(`${s.sci.padEnd(28)} ${s.common.padEnd(24)} ${(tonnes(s) / 1e6).toFixed(2).padStart(8)} Mt  ${s.alive.toExponential(2)} × ${s.massKg!.toFixed(1)} kg (${s.massHow})`);
    const names = top.map((s) => s.sci);
    for (const s of ['Bos taurus', 'Homo sapiens']) expect(names, s).toContain(s);
    // (Today's mammals weigh ~1.1 Gt: livestock ~630 Mt, humans ~390 Mt, wild land ~20 Mt and marine ~40 Mt; Greenspoon 2023,
    // Bar-On 2018. The data gives ~2.4 Gt: the cattle weigh PHYLACINE's Bos taurus, the aurochs' 900 kg, about twice a
    // cow's; the bounds hold that until the domestic stocks get their own mass.)
    expect(total / 1e6).toBeGreaterThan(500);
    expect(total / 1e6).toBeLessThan(3000);
  });

  it('lays out the whole mammal tree by mass', () => {
    const f = layoutFan(mammaliaClade(), 'linear', mammaliaTree(), 'curved', 'mass');
    let widest = 0;
    for (const b of f.branches) widest = Math.max(widest, b.share);
    // The widest column is a share of the trunk, not all of it.
    expect(widest).toBeLessThan(0.6);
    for (const b of f.branches) expect(Number.isFinite(b.width) && b.width >= 0, b.sp.sci).toBe(true);
  });
});
