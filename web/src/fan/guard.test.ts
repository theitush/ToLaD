// The layout's guard (ToLaD#281, #279): a strand whose end the data puts before its own split (a dating conflict the
// pipeline refuses, dated.py, but a hand date or a new source could bring) degrades that one strand, never the screen.
// Once, one such fossil turned every node's left NaN and blanked the whole mammal level.
import { describe, expect, it } from 'vitest';
import { layoutFan, type Fan } from './layout';
import { FELIDAE } from './panthera';
import { Steady } from './steady';
import { allSplits, FELIDAE_TREE } from './splits';

/** The cats with one fossil's end moved to `dMa` before its split (its split's age + dMa). */
function badDate(dMa: number): { fan: Fan; sci: string; split: number } {
  const split = allSplits(FELIDAE_TREE).find((s) => s.kids.some((k) => typeof k === 'string' && FELIDAE.species.find((x) => x.sci === k)?.extinct))!;
  const sci = split.kids.find((k): k is string => typeof k === 'string' && !!FELIDAE.species.find((x) => x.sci === k)?.extinct)!;
  const species = FELIDAE.species.map((s) => (s.sci === sci ? { ...s, t1: split.ageMa + dMa, t0: Math.max(s.t0, split.ageMa + dMa + 1) } : s));
  return { fan: layoutFan({ ...FELIDAE, species }, 'linear', FELIDAE_TREE), sci, split: split.ageMa };
}

const finite = (fan: Fan) => {
  for (const v of fan.nodes) for (const x of [v.left, v.cx, v.width, v.leanY]) expect(Number.isFinite(x)).toBe(true);
  for (const b of fan.branches) for (const x of [b.cx, b.colLeft, b.width, b.tipY, b.leanY]) expect(Number.isFinite(x)).toBe(true);
};

describe('a strand ending before its split', () => {
  for (const dMa of [0, 0.5, 5]) {
    it(`ends at its split, never below it, and the layout stays whole (${dMa} Myr before its split)`, () => {
      const { fan, sci } = badDate(dMa);
      const b = fan.branches.find((x) => x.sp.sci === sci)!;
      expect(b.tipY).toBeLessThanOrEqual(b.splitY);
      finite(fan);
      const f = new Steady(fan);
      f.setAll(0);
      fan.tess.fold = f;
      const [x0, x1] = f.homeExtent();
      expect(Number.isFinite(x0) && Number.isFinite(x1) && x1 > x0).toBe(true);
      f.setScale(318 / (x1 - x0), 390);
      for (let i = 0; i < f.strands.length; i++) {
        const s = f.strands[i];
        for (const y of [s.splitY - 1e-6, (s.splitY + s.tipY) / 2, s.tipY]) {
          const l = f.left(i, y);
          if (l !== null) expect(Number.isFinite(l)).toBe(true);
        }
      }
      for (const v of fan.nodes) expect(Number.isFinite(f.forkH(v))).toBe(true);
    });
  }
});
