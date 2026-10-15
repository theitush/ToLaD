// The scale yardstick's generator (ToLaD#343), small: a few hundred species, well under a second. The benchmark itself
// (scaleperf.test.ts, scripts/scale.mjs) is on demand only.
import { describe, expect, it } from 'vitest';
import type { DatedSplit } from './panthera-extract';
import { cladeOf } from './panthera';
import { treeOf } from './splits';
import { synthData, synthMarks } from './synthetic';

describe('synthetic tree', () => {
  const d = synthData({ n: 600, fossil: 0.02 });
  const sp = d.clade.species;

  it('is deterministic, and the seed changes it', () => {
    expect(JSON.stringify(synthData({ n: 600, fossil: 0.02 }))).toBe(JSON.stringify(d));
    expect(JSON.stringify(synthData({ n: 600, fossil: 0.02, seed: 2 }))).not.toBe(JSON.stringify(d));
  });

  it('has n living species and the fossils, each named once and placed once in the dated tree', () => {
    expect(sp.filter((s) => !s.extinct).length).toBe(600);
    expect(sp.filter((s) => s.extinct).length).toBe(12);
    expect(new Set(sp.map((s) => s.sci)).size).toBe(sp.length);
    const seen: string[] = [];
    const walk = (t: DatedSplit, up: number) => {
      expect(t.kids.length).toBeGreaterThanOrEqual(2);
      expect(t.age).toBeLessThanOrEqual(up);
      for (const k of t.kids) typeof k === 'string' ? seen.push(k) : walk(k, t.age);
    };
    walk(d.clade.dated!, Infinity);
    expect(seen.sort()).toEqual(sp.map((s) => s.sci).sort());
    expect(d.clade.dated!.age).toBeCloseTo(195, 6);
  });

  it("has the mammal data's fields: dates, mass, generations, populations, some histories", () => {
    for (const s of sp) {
      expect(s.t0).toBeGreaterThan(s.t1);
      expect(s.mass!.g).toBeGreaterThan(0);
      expect(s.gen!.years).toBeGreaterThan(0);
      expect(s.ever).toBeGreaterThan(0);
      expect(s.extinct ? s.alive === 0 : s.alive > 0).toBe(true);
    }
    const h = sp.filter((s) => s.history).length;
    expect(h).toBeGreaterThan(30);
    expect(h).toBeLessThan(110);
  });

  it('opens on the fan’s own path (the tree, the clade) and names its depths', () => {
    const tree = treeOf(d.clade);
    const c = cladeOf(d.clade, tree, 'Synthetic');
    expect(c.species.length).toBe(sp.length);
    expect(c.species.filter((s) => s.births).length).toBe(sp.filter((s) => s.history).length);
    const m = synthMarks(d);
    expect(m.order).toMatch(/ia$/);
    expect(m.family).toMatch(/idae$/);
  });
});
