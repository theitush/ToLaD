import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFile } from '../data/tolad-decoder.js';
import { BirthCurve, historySpans, spanStyle } from './history';
import { aliveAt, layoutFan, strandAt } from './layout';
import { PANTHERA, type SpeciesRec } from './panthera';
import { speciesModel, TwigModel } from './twigs';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/mammals');
const read = (rel: string) => readFileSync(resolve(DATA, rel));

/** Every species row named `sci` across the tiles, decoded independently of panthera-extract. */
function decoded(sci: string): { ever: number; alive: number; t0: number; t1: number; hist: any } {
  const sk = decodeFile(read('skeleton.tld')) as any;
  for (const t of sk.meta.tiles as { file: string }[]) {
    const f = decodeFile(read(t.file)) as any;
    for (let i = 0; i < f.n; i++) {
      if (f.name(i) === sci && f.isSpecies(i) && !f.isStub(i)) {
        return { ever: f.ever(i), alive: f.alive(i), t0: f.t0(i), t1: f.t1(i), hist: f.history(i) };
      }
    }
  }
  throw new Error(sci);
}

const byName = (common: string) => PANTHERA.species.find((s) => s.common === common)!;

describe('Panthera data', () => {
  it('numbers and histories are the decoded data/mammals values', () => {
    expect(PANTHERA.species.length).toBeGreaterThanOrEqual(9);
    for (const s of PANTHERA.species) {
      const d = decoded(s.sci);
      expect(s.ever).toBe(d.ever);
      expect(s.alive).toBe(d.alive);
      expect(s.t0).toBe(d.t0);
      expect(s.t1).toBe(d.t1);
      if (d.hist) {
        expect(s.history).not.toBeNull();
        expect(s.history!.points.map((p) => [p.year, p.n, p.grade])).toEqual(d.hist.points.map((p: any) => [p.year, p.n, p.grade]));
        expect(s.history!.segments.length).toBe(d.hist.segments.length);
      } else {
        expect(s.history).toBeNull();
      }
    }
    // Lion and tiger carry curated histories that drive their counts.
    for (const c of ['Lion', 'Tiger']) {
      expect(byName(c).births).not.toBeNull();
      expect(byName(c).history!.points.some((p) => p.baseline)).toBe(true);
    }
  });
});

describe('history-driven procgen', () => {
  for (const c of ['Lion', 'Tiger']) {
    it(`${c}: generation sizes follow the history's segments`, () => {
      const rec = byName(c);
      const segs = rec.births!.segments;
      const sp = speciesModel(rec);
      expect(sp.generations).toBe(segs.reduce((a, s) => a + s.generations, 0));
      expect(Number(sp.totalEver) / rec.ever).toBeCloseTo(1, 5);
      let g0 = 0;
      for (const s of segs) {
        // The ramp's integral, generation by generation (procgen floors it).
        const L = s.generations;
        const C = (t: number) => s.startSize * t + ((s.endSize - s.startSize) * t * t) / (2 * L);
        for (const t of [0, L >> 1, L - 1]) {
          const exact = C(t + 1) - C(t);
          expect(Math.abs(Number(sp.size(g0 + t)) - exact)).toBeLessThanOrEqual(1);
        }
        g0 += L;
      }
    });
  }

  it('lions and tigers thin over the last ~150 years', () => {
    for (const c of ['Lion', 'Tiger']) {
      const rec = byName(c);
      const sp = speciesModel(rec);
      const G = sp.generations;
      const back = Math.round(150 / rec.genYears);
      expect(Number(sp.size(G - 1)) * 3).toBeLessThan(Number(sp.size(G - back)));
    }
  });

  it('the last generation ends at the tip, on its calendar years', () => {
    const fan = layoutFan(PANTHERA, 'linear');
    const i = PANTHERA.species.findIndex((s) => s.common === 'Lion');
    const m = new TwigModel(fan.branches[i], fan.time, 'linear');
    expect(m.ageOf(m.G * m.GL)).toBeCloseTo(0, 12);
    // 100 years ago lies in the generation the history puts there.
    const h = m.rec.history!;
    const y = fan.time.y(100 / 1e6);
    const g = m.generationAt(y);
    let year = h.nowYear - (m.G - g) * m.GL;
    expect(Math.abs(year - (h.nowYear - 100))).toBeLessThan(m.GL);
    year = h.nowYear;
    expect(m.generationAt(fan.time.y(0))).toBe(m.G - 1);
  });
});

describe('width = individuals alive, with a varying population', () => {
  for (const mode of ['linear', 'log'] as const) {
    it(`lion/tiger: tip = alive now, between = the births curve × lifespan ÷ generation (${mode})`, () => {
      const fan = layoutFan(PANTHERA, mode);
      for (const c of ['Lion', 'Tiger']) {
        const i = PANTHERA.species.findIndex((s) => s.common === c);
        const b = fan.branches[i];
        const sp: SpeciesRec = b.sp;
        expect(aliveAt(sp, sp.t1) / sp.alive).toBeCloseTo(1, 2);
        expect(strandAt(b, sp.t1, mode).f).toBe(1);
        // The widest is the curve's highest level: the pre-decline baseline, or (lion: a genomic deep
        // past, ToLaD#60) a Middle Pleistocene peak. Either way the curve's peak sits on a point (it
        // is log-linear between points), and the oldest level is held back to the first appearance.
        const h = sp.history!;
        const ages = [sp.t0, ...h.points.map((p) => (h.nowYear - p.year) / 1e6).filter((a) => a < sp.t0 && a > sp.t1)];
        // (segment ends snap to whole generations, so a point's year is within a generation of the peak)
        expect(Math.max(...ages.map((a) => strandAt(b, a, mode).w)) / b.width).toBeCloseTo(1, 4);
        const oldest = Math.max(...ages.slice(1));
        expect(strandAt(b, sp.t0, mode).w).toBeCloseTo(strandAt(b, (sp.t0 + oldest) / 2, mode).w, 9);
        // Alive in generation k ≈ its procgen births × mean lifespan ÷ generation length: the same points,
        // log-linear between them (procgen's ramps are linear), corners filleted: within a few %.
        const m = new TwigModel(b, fan.time, mode);
        for (const back of [1, 5, 20, 40, 1000]) {
          const k = m.G - back;
          const ageMa = ((back - 0.5) * m.GL) / 1e6;
          const n = (m.size(k) * m.sp.lifespanYears) / m.GL;
          expect(Math.abs(aliveAt(sp, ageMa) / n - 1)).toBeLessThan(0.06);
        }
      }
    });
  }

  it('BirthCurve integrates its segments', () => {
    const c = new BirthCurve(
      [
        { generations: 10, startSize: 100, endSize: 100 },
        { generations: 4, startSize: 100, endSize: 20 },
      ],
      5,
    );
    expect(c.total).toBe(1000 + 240);
    expect(c.years).toBe(70);
    expect(c.bornAfter(20)).toBeCloseTo(240, 9);
    expect(c.bornAfter(70)).toBe(1240);
    expect(c.bornAfter(0)).toBe(0);
    expect(c.sizeAt(20)).toBeCloseTo(100, 9);
    expect(c.sizeAt(0)).toBeCloseTo(20, 9);
  });
});

describe('honesty', () => {
  it('interpolated and modelled spans are dashed, grade D / unverified dotted, measured solid', () => {
    expect(spanStyle({ grade: 'B', kind: 'held' })).toBe('solid');
    expect(spanStyle({ grade: 'C', kind: 'interpolated' })).toBe('dashed');
    expect(spanStyle({ grade: 'C', kind: 'model' })).toBe('dashed');
    expect(spanStyle({ grade: 'D', kind: 'interpolated' })).toBe('dotted');
    expect(spanStyle({ grade: 'B', kind: 'unverified' })).toBe('dotted');
    expect(spanStyle({ grade: 'C', kind: 'genomic' })).toBe('dashed');
    expect(spanStyle({ grade: 'D', kind: 'natural' })).toBe('dashed');
    expect(spanStyle({ grade: 'D', kind: 'rangeloss' })).toBe('dashed');
    const spans = historySpans(byName('Tiger').history!);
    expect(spans.some((s) => s.kind === 'interpolated' && s.style !== 'solid')).toBe(true);
    for (const s of spans) {
      expect(s.ago0).toBeGreaterThanOrEqual(s.ago1);
      if (s.kind === 'interpolated') expect(s.style).not.toBe('solid');
    }
  });
});
