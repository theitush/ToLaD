// The level's group pictures over "now" (ToLaD#262): each exactly above its group's centre, stacked up where they meet.
import { describe, expect, it } from 'vitest';
import { PIC_GAP, placePics, type PicSpot } from './pics';

const overlap = (p: PicSpot, q: PicSpot) => Math.hypot(p.x - q.x, p.y - q.y) < (p.d + q.d) / 2 - 1e-6;

function check(xs: number[], nowS = 300, top = 60): PicSpot[] {
  const ps = placePics(xs, xs.map(() => nowS), nowS, top);
  expect(ps.length).toBe(xs.length);
  ps.forEach((p, i) => {
    // Exactly above its centre, never slid.
    expect(p.x).toBe(xs[i]);
    expect(p.y + p.d / 2).toBeLessThanOrEqual(nowS);
    // Lifted: a stalk straight down to "now".
    if (p.row > 0) expect(p.stalk).toEqual([p.x, p.y + p.d / 2, nowS]);
    else expect(p.stalk).toBeNull();
  });
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(overlap(ps[i], ps[j])).toBe(false);
  return ps;
}

describe('group pictures over "now" (ToLaD#262)', () => {
  it('apart: one row, full size, on "now"', () => {
    const ps = check([100, 200, 300]);
    expect(ps.every((p) => p.row === 0 && p.d === 50)).toBe(true);
  });
  it('close: the next one up a row, still above its centre', () => {
    const ps = check([100, 120, 300]);
    expect(ps.map((p) => p.row)).toEqual([0, 1, 0]);
    expect(ps[0].y - ps[1].y).toBe(50 + PIC_GAP);
  });
  it('a crowd: up to three rows, then smaller discs; none overlap', () => {
    check([100, 110, 120, 130]);
    const many = Array.from({ length: 40 }, (_, i) => 80 + i * 7);
    const ps = check(many);
    expect(Math.max(...ps.map((p) => p.row))).toBeLessThan(3);
    expect(ps[0].d).toBeLessThan(50);
  });
  it('an extinct group: its stalk down to its tip', () => {
    const ps = placePics([100], [420], 300, 60);
    expect(ps[0].stalk).toEqual([100, ps[0].y + ps[0].d / 2, 420]);
  });
});
