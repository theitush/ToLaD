import { describe, expect, it } from 'vitest';
import { drawWorldOver, drawWorldUnder, GEO_UNITS, GLACIALS, LGM, placeEventLabels, stripCells, worldFlags, WORLD_EVENTS, type Box, type Rank, type WorldHost } from './world';

describe('the world data', () => {
  it('each rank tiles time from now down, in order, with no gaps or overlaps', () => {
    for (const r of ['eon', 'era', 'period', 'epoch'] as Rank[]) {
      const us = GEO_UNITS.filter((u) => u.rank === r);
      expect(us[0].endMa).toBe(0);
      for (let k = 0; k < us.length; k++) {
        expect(us[k].startMa).toBeGreaterThan(us[k].endMa);
        if (k) expect(us[k].endMa).toBe(us[k - 1].startMa);
        expect(us[k].color).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });
  it('keeps the chart v2024/12 boundaries the brief names', () => {
    const at = (n: string) => GEO_UNITS.find((u) => u.name === n)!;
    expect(at('Holocene').startMa).toBe(0.0117);
    expect(at('Pleistocene').startMa).toBe(2.58);
    expect(at('Paleocene').startMa).toBe(66.0);
  });
  it('the glacials are the even MIS, ordered and apart, back to the Quaternary', () => {
    for (let k = 0; k < GLACIALS.length; k++) {
      const g = GLACIALS[k];
      expect(g.mis % 2).toBe(0);
      expect(g.fromKa).toBeGreaterThan(g.toKa);
      if (k) expect(g.toKa).toBeGreaterThan(GLACIALS[k - 1].fromKa);
    }
    expect(GLACIALS[0]).toMatchObject({ mis: 2, toKa: 14, fromKa: 29, strength: 1 });
    expect(GLACIALS[GLACIALS.length - 1].fromKa).toBeGreaterThanOrEqual(2580);
    // The LGM inside MIS 2.
    expect(LGM.fromKa).toBeLessThanOrEqual(29);
    expect(LGM.toKa).toBeGreaterThanOrEqual(14);
  });
  it('every event is cited and dated', () => {
    for (const e of WORLD_EVENTS) {
      expect(e.cite.length).toBeGreaterThan(10);
      expect(e.yrs).toBeGreaterThan(0);
    }
  });
});

// A log axis like the fan's: `pxPerDecade` px for each decade of (years + 10), now at y = 0.
const logAxis = (pxPerDecade: number, shift = 0) => (ma: number) => pxPerDecade * Math.log10((ma * 1e6 + 10) / 10) - shift;

describe('the strip', () => {
  it('shows the finest rank that fits: epochs near now, eras and eons deep', () => {
    const cells = stripCells(logAxis(90), 844, 4000);
    const rank = (n: string) => cells.find((c) => c.unit.name === n)?.unit.rank;
    expect(rank('Holocene')).toBe('epoch');
    expect(rank('Miocene')).toBe('epoch');
    // Deep, the periods of the Precambrian are too thin on a log axis: their eras or eons stand.
    expect(cells.some((c) => c.unit.name === 'Siderian')).toBe(false);
    // No gap: each cell starts where the one above it ends.
    for (let k = 1; k < cells.length; k++) expect(cells[k].y0).toBeCloseTo(cells[k - 1].y1, 6);
  });
  it('zoomed into the deep past, periods appear', () => {
    // ~300 px per decade, 100 Ma at the top of the screen.
    const f = logAxis(300, 300 * 7);
    const cells = stripCells(f, 844, 4000);
    expect(cells.map((c) => c.unit.rank)).toContain('period');
    expect(cells.some((c) => c.unit.name === 'Jurassic')).toBe(true);
  });
});

describe('the event labels', () => {
  const measure = (t: string) => t.length * 6;
  it('never overlap the axis labels, nor each other', () => {
    const taken: Box[] = [];
    for (let y = 100; y < 800; y += 30) taken.push([6, y - 9, 60, y + 9]);
    const items = WORLD_EVENTS.map((ev, k) => ({ ev, text: ev.label, sy: 120 + k * 37 }));
    const out = placeEventLabels(items, taken, measure, 14, 240, 56, 770);
    const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    for (const p of out) {
      for (const t of taken) expect(hit(p.box, t)).toBe(false);
      for (const q of out) if (q !== p) expect(hit(p.box, q.box)).toBe(false);
      expect(p.box[2]).toBeLessThanOrEqual(240);
    }
    expect(out.length).toBeGreaterThan(0);
  });
  it('are left out where there is no room', () => {
    const taken: Box[] = [[0, 0, 400, 900]];
    expect(placeEventLabels([{ ev: WORLD_EVENTS[0], text: 'x', sy: 300 }], taken, measure, 14, 240, 56, 770)).toEqual([]);
  });
});

describe('the switches', () => {
  it('reads ?periods=0&ice=0&events=0, all on by default', () => {
    expect(worldFlags('')).toEqual({ periods: true, ice: true, events: true });
    expect(worldFlags('?periods=0&ice=0&events=0')).toEqual({ periods: false, ice: false, events: false });
    expect(worldFlags('?ice=0')).toEqual({ periods: true, ice: false, events: true });
  });
  it('off, the layers draw nothing', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, k) => (k === 'measureText' ? () => ({ width: 40 }) : typeof k === 'string' && /^(fill|stroke)/.test(k) ? () => calls.push(k) : () => undefined),
      set: () => true,
    });
    const host = (on: boolean): WorldHost => ({
      ctx,
      w: 390,
      h: 844,
      world: { periods: on, ice: on, events: on },
      axisBoxes: [],
      fan: { time: { y: (ma: number) => -logAxis(90)(ma) }, trunkBottom: { y: -1e9 } },
      toScreen: (_x: number, y: number) => [0, -y + 200],
      under: () => calls.push('under'),
    });
    drawWorldUnder(host(false));
    drawWorldOver(host(false));
    expect(calls).toEqual([]);
    drawWorldUnder(host(true));
    drawWorldOver(host(true));
    expect(calls).toContain('under');
    expect(calls).toContain('fillRect');
    expect(calls).toContain('fillText');
  });
});
