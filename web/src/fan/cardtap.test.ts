import { describe, expect, it } from 'vitest';
import { cardTapper, type CardPointer } from './cardtap';

/** Taps on a card: [x, y, t down, t up, on a control?, moved by]. */
function run(taps: [number, number, number, number, boolean?, number?][]): [number, number][] {
  const ups: [number, number][] = [];
  const c = cardTapper((x, y) => ups.push([x, y]));
  taps.forEach(([x, y, t0, t1, ctl = false, dx = 0], i) => {
    const p = (x: number, t: number): CardPointer => ({ id: i + 1, x, y, t, ctl });
    c.down(p(x, t0));
    c.up(p(x + dx, t1));
  });
  return ups;
}

describe('a double tap on the card (ToLaD#301)', () => {
  it('two quick taps on the card: one level up, once', () => {
    expect(run([[100, 600, 0, 60], [102, 603, 150, 210]])).toEqual([[102, 603]]);
    // (A third tap starts afresh, a fourth makes another double tap.)
    expect(run([[100, 600, 0, 60], [100, 600, 150, 210], [100, 600, 300, 360], [100, 600, 450, 510]])).toHaveLength(2);
  });
  it('a single tap, taps too far apart in time or place: nothing', () => {
    expect(run([[100, 600, 0, 60]])).toEqual([]);
    expect(run([[100, 600, 0, 60], [100, 600, 500, 560]])).toEqual([]);
    expect(run([[100, 600, 0, 60], [200, 600, 150, 210]])).toEqual([]);
  });
  it("on the card's controls (links, Details, the pictures, the globe, ×): theirs, not a double tap", () => {
    expect(run([[100, 600, 0, 60, true], [100, 600, 150, 210, true]])).toEqual([]);
    expect(run([[100, 600, 0, 60, true], [100, 600, 150, 210]])).toEqual([]);
    expect(run([[100, 600, 0, 60], [100, 600, 150, 210, true]])).toEqual([]);
  });
  it('a drag (scrolling the card, turning the globe), a hold or a cancelled touch: not a tap', () => {
    expect(run([[100, 600, 0, 60, false, 30], [100, 600, 150, 210]])).toEqual([]);
    expect(run([[100, 600, 0, 600], [100, 600, 650, 700]])).toEqual([]);
    const ups: unknown[] = [];
    const c = cardTapper(() => ups.push(1));
    c.down({ id: 1, x: 0, y: 0, t: 0, ctl: false });
    c.up({ id: 1, x: 0, y: 0, t: 50, ctl: false });
    c.down({ id: 2, x: 0, y: 0, t: 100, ctl: false });
    c.cancel();
    c.down({ id: 3, x: 0, y: 0, t: 150, ctl: false });
    c.up({ id: 3, x: 0, y: 0, t: 200, ctl: false });
    expect(ups).toEqual([]);
  });
  it('two fingers at once: a pinch, not a tap', () => {
    const ups: unknown[] = [];
    const c = cardTapper(() => ups.push(1));
    c.down({ id: 1, x: 0, y: 0, t: 0, ctl: false });
    c.up({ id: 1, x: 0, y: 0, t: 50, ctl: false });
    c.down({ id: 2, x: 0, y: 0, t: 100, ctl: false });
    c.down({ id: 3, x: 30, y: 0, t: 110, ctl: false });
    c.up({ id: 2, x: 0, y: 0, t: 150, ctl: false });
    c.up({ id: 3, x: 30, y: 0, t: 160, ctl: false });
    expect(ups).toEqual([]);
  });
});
