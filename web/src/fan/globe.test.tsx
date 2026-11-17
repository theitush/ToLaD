import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { RangeMap, SpeciesCard } from './FanApp';
import type { ReactElement, ReactNode } from 'react';
import { Alone, AloneView } from './Alone';
import { loadGlobeCode, RangeGlobe } from './Globe';
import { hookHarness } from './hookharness';
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

// The living cats only the Mammal Diversity Database gives (ToLaD#278: split or described since Upham 2019): COMBINE has no
// generation length for them (allometric), PHYLACINE no range, and the Red List has assessed only Felis lybica (the rest NE).
const MDD_CATS = ['Felis lybica', 'Prionailurus javanensis', 'Leopardus braccatus', 'Leopardus pajeros', 'Leopardus fasciatus', 'Leopardus garleppi', 'Leopardus pardinoides'];

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

  it("a tap on the globe shows it alone, facing as the card's was turned; a tap there closes it (ToLaD#506)", () => {
    const { render } = hookHarness();
    type AloneProps = { credit: ReactNode; onClose: () => void; children: ReactNode };
    type Canvas = ReactElement<{ onTap: () => void; onTurn?: (r: [number, number]) => void; start?: [number, number] | null }>;
    type Fig = ReactElement<{ className: string; children: [Canvas, ReactElement, ReactElement<AloneProps> | false] }>;
    const globe = () => render(() => RangeGlobe({ sci: 'Panthera leo' })) as Fig;
    expect(globe().props.children[2]).toBe(false);
    const card = globe().props.children[0];
    card.props.onTurn!([30, 5]); // turned in the card
    card.props.onTap(); // a tap: alone
    const alone = globe().props.children[2] as ReactElement<AloneProps>;
    expect(alone.type).toBe(Alone);
    expect(globe().props.className).toBe('globe');
    expect((alone.props.children as Canvas).props.start).toEqual([30, 5]);
    // The globe and its credit, nothing of the card.
    const html = renderToStaticMarkup(<AloneView {...alone.props} />);
    expect(html).toMatch(/^<div class="alone"><div class="alone-it"><canvas><\/canvas><\/div><div class="alone-credit"><a [^>]*>Range · PHYLACINE 1.2<\/a><\/div><\/div>$/);
    alone.props.onClose(); // a tap on it (no history here): back to the card
    expect(globe().props.children[2]).toBe(false);
  });

  it('a species split since PHYLACINE draws the range before the split, and its credit says whose (ToLaD#486)', () => {
    expect(speciesRange('Panthera leo')!.from).toBeUndefined();
    const r = speciesRange('Loxodonta cyclotis')!;
    expect(r.from).toBe('Loxodonta africana');
    expect(r.cur).toBe(speciesRange('Loxodonta africana')!.cur);
    const html = renderToStaticMarkup(<RangeGlobe sci="Loxodonta cyclotis" />);
    expect(html).toContain('<canvas');
    expect(html).toContain('Range of <i>Loxodonta africana</i> before the split · PHYLACINE 1.2'); // 1.2 never wraps alone
  });

  it('a species PHYLACINE has no map of falls back to the Wikimedia map, or to the bare globe (ToLaD#492)', () => {
    const fb = renderToStaticMarkup(<RangeGlobe sci="Not a species" fallback={(none) => <RangeMap w={w} none={none} />} />);
    expect(fb).toContain('class="range loading"');
    expect(fb).toContain(`src="${w.range}"`);
    expect(fb).not.toContain('globe');
    const bare = '<figure class="globe none"><canvas></canvas><span class="cap">Range not known</span></figure>';
    expect(renderToStaticMarkup(<RangeGlobe sci="Not a species" />)).toBe(bare);
    // The map failing: the bare globe in its box.
    expect(renderToStaticMarkup(<RangeGlobe sci="Not a species" fallback={(none) => <RangeMap w={w} initial="failed" none={none} />} />)).toBe(bare);
  });

  it("a placeholder map is no range: 'Range not known', not the Wikimedia map (ToLaD#507)", () => {
    const bare = '<figure class="globe none"><canvas></canvas><span class="cap">Range not known</span></figure>';
    for (const sci of ['Gerbillus agag', 'Oryzomys curasoae', 'Rhinopoma macinnesi']) {
      expect(globeData()!.ranges[sci]).toEqual([[], []]);
      expect(renderToStaticMarkup(<RangeGlobe sci={sci} fallback={(none) => <RangeMap w={w} none={none} />} />)).toBe(bare);
    }
  });

  it("the night monkeys: Colombia is A. jorgehernandezi's, green, and nothing of the move grey (ToLaD#507)", () => {
    const z = speciesRange('Aotus zonalis')!;
    const j = speciesRange('Aotus jorgehernandezi')!;
    expect([z.cur, z.lost, j.cur, j.lost]).toEqual([20, 0, 25, 0]);
    const zc = new Set(unpackRuns(globeData()!.ranges['Aotus zonalis'][0]));
    // 22 cells of Colombia are A. jorgehernandezi's alone; 3 at the border both maps hold
    expect(unpackRuns(globeData()!.ranges['Aotus jorgehernandezi'][0]).filter((i) => !zc.has(i)).length).toBe(22);
  });

  it('a card with neither picture nor range shows both boxes, saying what is missing (ToLaD#492)', () => {
    const lion = FELIDAE.species.find((s) => s.sci === 'Panthera leo')!;
    const html = renderToStaticMarkup(<SpeciesCard sp={{ ...lion, sci: 'Not a species', common: 'Nothing' }} onClose={() => {}} />);
    expect(html).toContain('<div class="media"><figure class="pic stub">');
    expect(html).toContain('No photo');
    expect(html).toContain('class="globe none"');
    expect(html).toContain('Range not known');
  });

  it('nearly every cat has a globe', () => {
    const cats = FELIDAE.species.filter((s) => !MDD_CATS.includes(s.sci));
    const n = cats.filter((s) => speciesRange(s.sci)).length;
    expect(n).toBeGreaterThan(cats.length * 0.9);
  });
});
