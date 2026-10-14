import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { RangeMap, SpeciesCard } from './FanApp';
import { loadGlobeCode, RangeGlobe } from './Globe';
import { drawGlobe, GLOBE_COLORS } from './globe-draw';
import { globeData, loadGlobe, speciesRange, unpackRuns, type GlobeData } from './globe-data';
import { FELIDAE } from './panthera';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '..', '..', '..', 'data', 'mammals');

// What vite.config.ts globeJson() serves as globe.json.
beforeAll(async () => {
  await loadGlobe(async () => {
    const r = JSON.parse(readFileSync(join(DATA, 'ranges.json'), 'utf8'));
    const land = JSON.parse(readFileSync(join(here, 'globe-land.json'), 'utf8'));
    return { grid: r.grid, land, ranges: r.ranges } as GlobeData;
  });
  await loadGlobeCode(); // what a card does first: the drawing chunk, the data (already in, here)
});

/** A 2D context that records what is filled: per fill, its colour and how many rings were drawn into it. */
function recorder() {
  const fills: { color: string; rings: number }[] = [];
  let rings = 0;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    clearRect() {},
    beginPath: () => (rings = 0),
    moveTo: () => rings++,
    lineTo() {},
    closePath() {},
    arc: () => rings++,
    fill() {
      fills.push({ color: ctx.fillStyle, rings });
    },
    stroke() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

describe('range globe data (ToLaD#267)', () => {
  it('decodes the run-length cells', () => {
    expect(unpackRuns([])).toEqual([]);
    expect(unpackRuns([0, 3, 356, 2])).toEqual([0, 1, 2, 359, 360]);
  });

  it("the lion: PHYLACINE's 496 current cells, the rest of its natural range lost, facing Africa", () => {
    const r = speciesRange('Panthera leo')!;
    expect(r.cur).toBe(496);
    const raw = globeData()!.ranges['Panthera leo'];
    const cur = new Set(unpackRuns(raw[0]));
    expect(r.lost).toBe(unpackRuns(raw[1]).filter((i) => !cur.has(i)).length);
    expect(r.lost).toBeGreaterThan(2000);
    expect(r.centre[0]).toBeGreaterThan(0);
    expect(r.centre[0]).toBeLessThan(60);
    expect(r.centre[1]).toBeGreaterThan(-10);
    expect(r.centre[1]).toBeLessThan(40);
    expect(r.curShape.coordinates.length).toBeGreaterThan(20); // runs of cells, not single cells
    expect(r.curShape.coordinates.length).toBeLessThan(r.cur);
  });

  it('an extinct species has only the range it lost', () => {
    const r = speciesRange('Mammuthus primigenius')!;
    expect(r.cur).toBe(0);
    expect(r.lost).toBe(3294);
    expect(r.centre[1]).toBeGreaterThan(40); // the mammoth steppe
  });

  it('no PHYLACINE map, no range', () => {
    expect(speciesRange('Not a species')).toBeNull();
  });

  it('draws ocean, land, the range lost and the current range, in that order', () => {
    const d = globeData()!;
    const r = speciesRange('Panthera leo')!;
    const { ctx, fills } = recorder();
    drawGlobe(ctx, d, r, 240, r.centre);
    expect(fills.map((f) => f.color)).toEqual([GLOBE_COLORS.ocean, GLOBE_COLORS.land, GLOBE_COLORS.lost, GLOBE_COLORS.cur]);
    expect(fills[2].rings).toBeGreaterThan(50);
    expect(fills[3].rings).toBeGreaterThan(20);
    // The far side is clipped: turned to the Pacific, none of the lion's current range shows.
    const back = recorder();
    drawGlobe(back.ctx, d, r, 240, [-160, 0]);
    expect(back.fills.find((f) => f.color === GLOBE_COLORS.cur)?.rings ?? 0).toBe(0);
    // The mammoth: no current range to fill.
    const m = recorder();
    drawGlobe(m.ctx, d, speciesRange('Mammuthus primigenius')!, 240, [90, 60]);
    expect(m.fills.map((f) => f.color)).toEqual([GLOBE_COLORS.ocean, GLOBE_COLORS.land, GLOBE_COLORS.lost]);
  });
});

describe('range globe in the card (ToLaD#267)', () => {
  const w = {
    range: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/M.svg/500px-M.svg.png',
    rangeFile: 'https://commons.wikimedia.org/wiki/File:M.svg',
  };

  it("the lion's card shows the globe under the name, with its credit, not the Wikimedia map", () => {
    const lion = FELIDAE.species.find((s) => s.sci === 'Panthera leo')!;
    const html = renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} />);
    expect(html.indexOf('class="globe"')).toBeGreaterThan(html.indexOf('class="t"'));
    expect(html).toContain('<canvas');
    expect(html).toContain('Range · PHYLACINE 1.2');
    expect(html).not.toContain('class="range');
  });

  it('a species PHYLACINE has no map of falls back to the Wikimedia map, or to nothing', () => {
    const fb = renderToStaticMarkup(<RangeGlobe sci="Not a species" fallback={<RangeMap w={w} />} />);
    expect(fb).toContain('class="range loading"');
    expect(fb).toContain(`src="${w.range}"`);
    expect(fb).not.toContain('globe');
    expect(renderToStaticMarkup(<RangeGlobe sci="Not a species" fallback={null} />)).toBe('');
  });

  it('nearly every cat has a globe', () => {
    const n = FELIDAE.species.filter((s) => speciesRange(s.sci)).length;
    expect(n).toBeGreaterThan(FELIDAE.species.length * 0.9);
  });
});
