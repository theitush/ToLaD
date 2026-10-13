// One level up from the cats (ToLaD#146): the order Carnivora from the data, every species its own column
// (variant A). Its tree and species come from the data's dated tree; its families are named by a rule and a
// small name map; at home the family labels stand on "now" and no two labels meet; the level button frames
// the cats; the search finds every species.
import { describe, expect, it } from 'vitest';
import { layoutFan } from './layout';
import { CARNIVORA, FELIDAE } from './panthera';
import { searchSpecies } from './search';
import { CARNIVORA_TREE, familyLabel, allSplits, speciesUnder } from './splits';
import { boxGap, families, familySpan, labelSpots, resolveLabels } from './view';
import { FanCamera } from './camera';

const fan = layoutFan(CARNIVORA, 'linear', CARNIVORA_TREE, 'curved');

describe('Carnivora from the data', () => {
  it('292 species: every living one and the dated fossils, each placed once', () => {
    const sp = speciesUnder(CARNIVORA_TREE);
    expect(sp.length).toBe(292);
    expect(new Set(sp).size).toBe(292);
    expect(CARNIVORA.species.length).toBe(292);
    const fossils = CARNIVORA.species.filter((s) => s.extinct).map((s) => s.common);
    expect(fossils.length).toBe(7);
    expect(fan.branches.length).toBe(292);
  });

  it('holds the cat family whole: the same 42 species as the cats on their own', () => {
    const fel = allSplits(CARNIVORA_TREE).find((s) => s.taxon === 'Felidae')!;
    expect(new Set(speciesUnder(fel))).toEqual(new Set(FELIDAE.species.map((s) => s.sci)));
  });

  it('names its families by the rule (-idae) and the name map', () => {
    const names = families(fan).map((f) => f.text);
    for (const n of ['Cats', 'Dogs', 'Bears', 'Seals', 'Sea lions', 'Weasels', 'Raccoons', 'Skunks', 'Hyenas', 'Mongooses', 'Civets']) expect(names).toContain(n);
    // Only families (and the order itself, labelled at the mammal level, ToLaD#247): no subfamily or genus gets a family label.
    for (const s of allSplits(CARNIVORA_TREE)) if (familyLabel(s)) expect(s.taxon).toMatch(/idae$|^Carnivora$/);
    expect(names).not.toContain('Carnivores');
  });

  it('a family span holds its species and no other', () => {
    for (const { v } of families(fan)) {
      const [x0, x1] = familySpan(v);
      const mine = new Set(v.strands);
      for (const b of fan.branches) {
        const inside = b.colLeft >= x0 - 1e-9 && b.colLeft + b.width <= x1 + 1e-9;
        if (mine.has(b)) expect(inside).toBe(true);
      }
    }
  });

  it('the search finds every species, by its English and its scientific name', () => {
    for (const s of CARNIVORA.species) {
      expect(searchSpecies(CARNIVORA.species, s.common)).toContain(s);
      expect(searchSpecies(CARNIVORA.species, s.sci)).toContain(s);
    }
    const wol = searchSpecies(CARNIVORA.species, 'wol').map((s) => s.common);
    expect(wol).toContain('Grey wolf');
  });
});

describe('Carnivora at home and at the cats', () => {
  const cam = new FanCamera(fan, () => {
    throw new Error('no model');
  });
  cam.w = 390;
  cam.h = 844;
  const measure = (t: string) => t.length * 7.5;
  const TOP = 60;

  it('at home: family labels on "now" with their brackets, the families first; no two labels meet', () => {
    cam.cam = cam.home();
    cam.settle();
    const spots = labelSpots(cam, fan, TOP, measure);
    const on = resolveLabels(spots, new Map());
    const shown = spots.filter((s) => on.get(s.key));
    const fams = shown.filter((s) => s.place === 'fam');
    expect(fams.length).toBeGreaterThanOrEqual(4);
    expect(fams.map((s) => s.text)).toContain('Cats');
    for (const s of fams) {
      expect(s.span![1]).toBeGreaterThan(s.span![0]);
      expect(s.box[0]).toBeGreaterThanOrEqual(0);
      expect(s.box[2]).toBeLessThanOrEqual(390);
    }
    expect(new Set(shown.map((s) => s.id)).size).toBe(shown.length);
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(boxGap(shown[i].box, shown[j].box)).toBeGreaterThanOrEqual(-1);
  });

  it('the cats framed (the level button): every cat column on screen, the family wider than half of it', () => {
    const v = fan.nodes.find((n) => n.split.taxon === 'Felidae')!;
    const [x0, x1] = familySpan(v);
    cam.cam = cam.frame(x0, x1, v.y, true);
    cam.settle();
    const [a] = cam.toScreen(x0, 0);
    const [b] = cam.toScreen(x1, 0);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(390);
    expect(b - a).toBeGreaterThan(195);
    // Its split near the bottom, "now" near the top.
    expect(cam.toScreen(0, v.y)[1]).toBeGreaterThan(844 / 2);
    expect(cam.toScreen(0, cam.yNow)[1]).toBeLessThan(844 / 4);
  });
});
