import { describe, expect, it } from 'vitest';
import { closedAt, FAMILY_EN, FOLD_HI_PX, FOLD_LO_PX, foldUnits, isFamily, openness, stackAt } from './fold';
import { laneAt, layoutFan, leftAt } from './layout';
import { CARNIVORA, FELIDAE } from './panthera';
import { CARNIVORA_TREE, speciesUnder } from './splits';

describe('the carnivores (ToLaD#146)', () => {
  it('come from the data: every placed species, the cats among them', () => {
    expect(CARNIVORA.species.length).toBe(speciesUnder(CARNIVORA_TREE).length);
    expect(CARNIVORA.species.length).toBeGreaterThanOrEqual(284);
    const cats = new Set(FELIDAE.species.map((s) => s.sci));
    expect(CARNIVORA.species.filter((s) => cats.has(s.sci)).length).toBe(FELIDAE.species.length);
  });
});

describe('fold units (semantic zoom, variant B)', () => {
  for (const mode of ['linear', 'log'] as const) {
    const fan = layoutFan(CARNIVORA, mode, CARNIVORA_TREE);
    const units = foldUnits(fan);

    it(`are the families, by the -idae rule, disjoint (${mode})`, () => {
      const taxa = units.map((u) => u.taxon);
      for (const t of ['Felidae', 'Canidae', 'Ursidae', 'Phocidae', 'Otariidae', 'Mustelidae']) expect(taxa).toContain(t);
      for (const t of taxa) expect(isFamily(t)).toBe(true);
      for (const u of units) expect(FAMILY_EN[u.taxon]).toBeTruthy();
      const seen = new Set<number>();
      for (const u of units) for (const b of u.strands) {
        expect(seen.has(b.index)).toBe(false);
        seen.add(b.index);
      }
      expect(units.find((u) => u.taxon === 'Felidae')!.strands.length).toBe(FELIDAE.species.length);
    });

    it(`closed, a family is one column: its species' widths and greens summed, stacked with no gaps (${mode})`, () => {
      for (const u of units) {
        for (const a of [0.001, 0.02, 0.5, 3]) {
          const y = fan.time.y(a);
          if (!(y > u.yTop && y < u.yBot)) continue;
          const c = closedAt(u, y);
          let w = 0;
          let gw = 0;
          let x = c.left;
          for (let i = 0; i < u.strands.length; i++) {
            const L = laneAt(u.strands[i], y);
            const st = stackAt(u, i, y, L.w);
            // (The grid is linear between samples: within a few thousandths of the column.)
            expect(Math.abs(st.left - x)).toBeLessThanOrEqual(0.02 * c.w + 1e-9);
            x += L.w;
            w += L.w;
            gw += L.gw;
          }
          expect(Math.abs(c.w - w)).toBeLessThanOrEqual(0.02 * w + 1e-9);
          expect(Math.abs(c.gw - gw)).toBeLessThanOrEqual(0.02 * w + 1e-9);
        }
      }
    });

    it(`at its crown the closed column is the crown's own column (${mode})`, () => {
      for (const u of units) {
        const y = u.yBot - 1e-9;
        const c = closedAt(u, y);
        expect(Math.abs(c.left - leftAt(u.strands[0], y))).toBeLessThanOrEqual(0.02 * u.node.width + 1e-9);
      }
    });

    it(`opens with the zoom, continuously, from ${FOLD_LO_PX} to ${FOLD_HI_PX} px per species (${mode})`, () => {
      for (const u of units) {
        const at = (px: number) => openness(u, (px * u.strands.length) / (u.x1 - u.x0));
        expect(at(FOLD_LO_PX * 0.99)).toBe(0);
        expect(at(FOLD_HI_PX * 1.01)).toBe(1);
        let prev = 0;
        for (let px = FOLD_LO_PX; px <= FOLD_HI_PX; px += 0.01) {
          const e = at(px);
          expect(e).toBeGreaterThanOrEqual(prev);
          expect(e - prev).toBeLessThan(0.02);
          prev = e;
        }
      }
    });
  }
});
