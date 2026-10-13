// The level's group pictures on "now" (ToLaD#262, #266): each exactly above its group's centre, never lifted or slid;
// crowded, smaller, then overlapping a little (the more populous on top), then the least populous dropped.
import { describe, expect, it } from 'vitest';
import { PIC_D, PIC_GAP, PIC_LIFT, PIC_MIN, PIC_OVERLAP, placePics, type PicSpot } from './pics';

const NOW = 300;

function check(xs: number[], pop = xs.map(() => 1), ys = xs.map(() => NOW)): PicSpot[] {
  const ps = placePics(xs, ys, pop);
  for (const p of ps) {
    // Exactly above its centre, standing on "now" (or its tip): never slid, never lifted, never above it.
    expect(p.x).toBe(xs[p.i]);
    expect(p.y + p.d / 2).toBeCloseTo(ys[p.i] - PIC_LIFT, 9);
    expect(p.d).toBeGreaterThanOrEqual(PIC_MIN);
  }
  // Overlapping no more than a little.
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) expect(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y)).toBeGreaterThanOrEqual(PIC_OVERLAP * ps[i].d - 1e-9);
  return ps;
}

describe('group pictures on "now" (ToLaD#266)', () => {
  it('apart: all, full size', () => {
    const ps = check([100, 200, 300]);
    expect(ps.length).toBe(3);
    expect(ps.every((p) => p.d === PIC_D)).toBe(true);
  });
  it('close: smaller, all still there, side by side clear', () => {
    const ps = check([100, 130, 160]);
    expect(ps.length).toBe(3);
    expect(ps[0].d).toBeLessThan(PIC_D);
    expect(ps[0].d).toBeLessThanOrEqual(30 - PIC_GAP);
  });
  it('closer still: the smallest, overlapping a little, the more populous drawn last (on top)', () => {
    const ps = check([100, 114, 128], [5, 50, 1]);
    expect(ps.length).toBe(3);
    expect(ps.every((p) => p.d === PIC_MIN)).toBe(true);
    expect(ps[ps.length - 1].i).toBe(1);
    expect(ps[0].i).toBe(2);
  });
  it('a crowd: the least populous dropped, the most populous kept', () => {
    const xs = Array.from({ length: 40 }, (_, i) => 80 + i * 6);
    const pop = xs.map((_, i) => (i * 37) % 41);
    const ps = check(xs, pop);
    expect(ps.length).toBeLessThan(xs.length);
    const most = pop.indexOf(Math.max(...pop));
    expect(ps.some((p) => p.i === most)).toBe(true);
    // A dropped one has a kept, more populous one too near it.
    for (let i = 0; i < xs.length; i++) {
      if (ps.some((p) => p.i === i)) continue;
      expect(ps.some((p) => pop[p.i] >= pop[i] && Math.abs(p.x - xs[i]) < PIC_OVERLAP * PIC_MIN)).toBe(true);
    }
  });
  it('an extinct group: on its own tip', () => {
    const ps = check([100], [1], [420]);
    expect(ps[0].y + ps[0].d / 2).toBe(420 - PIC_LIFT);
  });
});
