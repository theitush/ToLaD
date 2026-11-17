// A species nobody knows the number of (FLAG bit 11, ToLaD#507): Data Deficient, no range map, never counted. Its count
// in the data is a width, the thinnest a living species is drawn at, never a figure: the card says "unknown" and why,
// linked to "What we don't know"; its column is drawn faint, as the chart draws "no data"; search finds it and its tap
// lands as any species'. A range IUCN codes extinct or possibly extinct (bit 12) says so on the status line.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatCount } from '../data/count';
import { COLUMN_DIM, columnSpans } from './colstyle';
import { RANGE_EX_PE_WORDS, SpeciesCard, UNKNOWN_WHY } from './FanApp';
import { NODATA } from './history';
import { laneAt, leftAt } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { METHOD_IDS, MethodsView } from './Methods';
import { mammaliaClade, type SpeciesRec } from './panthera';
import { searchSpecies } from './search';
import { mammaliaTree } from './splits';
import { colSpansY, FanView, type Selection } from './view';

let all: SpeciesRec[];
const sp = (sci: string) => all.find((s) => s.sci === sci)!;
beforeAll(async () => {
  await loadMammalsFromFiles();
  all = mammaliaClade().species;
});

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const card = (s: SpeciesRec, ageMa?: number, mass?: boolean) => renderToStaticMarkup(<SpeciesCard sp={s} ageMa={ageMa} mass={mass} onClose={() => {}} />);
const links = (html: string) => [...html.matchAll(/<a href="#([^"]+)" class="mlink[^"]*" data-method="([^"]+)">([^<]*)<\/a>/g)].map((m) => [m[3], m[2]]);
/** The card's own numbers: none of a flagged species' (its alive is the thinnest width, its ever lived reckoned from it). */
const numbers = (s: SpeciesRec) => [s.alive, s.ever, s.everLo, s.everHi].map((n) => formatCount(n, { tilde: false }).replace(/^~/, ''));

describe('a species whose count nobody knows (ToLaD#507)', () => {
  const UNKNOWN = ['Gerbillus agag', 'Makalata obscura', 'Scotophilus borbonicus', 'Pteropus loochoensis', 'Rhinopoma macinnesi', 'Oryzomys curasoae'];

  it('the data flags them, at the thinnest living count', () => {
    const flagged = all.filter((s) => s.countUnknown);
    expect(flagged.length).toBeGreaterThanOrEqual(UNKNOWN.length);
    for (const s of flagged) expect(s.extinct, s.sci).toBe(false);
    // (The smallest other living count, Peromyscus dickeyi's; a species extinct in the wild counts 0 here.)
    const thinnest = Math.min(...all.filter((s) => !s.extinct && !s.countUnknown && s.alive > 0).map((s) => s.alive));
    for (const n of UNKNOWN) expect(sp(n).alive, n).toBeCloseTo(thinnest, 6);
    // The two bats: also their whole range coded extinct or possibly extinct.
    for (const n of ['Scotophilus borbonicus', 'Pteropus loochoensis']) expect(sp(n).rangeExPe, n).toBe(true);
    expect(sp('Gerbillus agag').rangeExPe).toBe(false);
  });

  it('its card says "unknown" and why, linked to What we don’t know, and no number, today or in the past', () => {
    const ids = new Set([...renderToStaticMarkup(<MethodsView onClose={() => {}} />).matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    expect(ids).toContain(METHOD_IDS.unknown);
    for (const n of UNKNOWN) {
      const s = sp(n);
      const b = s.t0 / 2;
      for (const html of [card(s), card(s, b), card(s, undefined, true)]) {
        const t = text(html);
        expect(t, n).toMatch(new RegExp(`Unknown alive (today|[^:]* ago): ${UNKNOWN_WHY}`));
        expect(links(html), n).toContainEqual([UNKNOWN_WHY, METHOD_IDS.unknown]);
        expect(t, n).toContain('have ever lived: unknown');
        // No figure for it: not "~1 alive", not its ever lived, not a weight, not a share with descendants.
        expect(t, n).not.toMatch(/~\d/);
        for (const x of numbers(s)) expect(t, `${n}: ${x}`).not.toContain(` ${x} `);
        for (const w of ['Weighing', 'have descendants', 'rough estimate', 'Roughly']) expect(t, `${n}: ${w}`).not.toContain(w);
      }
      expect(text(card(s).match(/<details[\s\S]*<\/details>/)![0]), n).toContain('Ever lived' + 'unknown');
    }
  });

  it('the two bats say IUCN codes their range extinct or possibly extinct; a CR species too; the others do not', () => {
    for (const n of ['Scotophilus borbonicus', 'Pteropus loochoensis', 'Peromyscus guardia']) {
      const html = card(sp(n));
      expect(html, n).toContain('data-range-ex');
      expect(text(html), n).toContain(RANGE_EX_PE_WORDS);
      expect(text(html), n).toContain('Its map codes the whole range Extinct or Possibly Extinct');
    }
    expect(sp('Peromyscus guardia').countUnknown).toBe(false);
    for (const n of ['Gerbillus agag', 'Dasyurus hallucatus', 'Panthera leo']) expect(text(card(sp(n))), n).not.toContain(RANGE_EX_PE_WORDS);
  });

  it('an unflagged species’ card is unchanged: its number, where it came from, its ever lived', () => {
    const quoll = sp('Dasyurus hallucatus');
    expect(quoll.countUnknown).toBe(false);
    const t = text(card(quoll));
    expect(t).toContain('~400k alive today modelled');
    expect(t).toContain('have ever lived');
    expect(t).toContain('(rough estimate)');
    expect(t).not.toContain('Unknown');
    expect(t).not.toContain(UNKNOWN_WHY);
    const lion = text(card(sp('Panthera leo'), 70e-6));
    expect(lion).toContain('~400k alive 70 years ago from its history');
    expect(lion).toContain('have descendants alive today');
  });

  it('its column is faint over its whole length, as the chart’s “no data”; a known one is not', () => {
    expect(COLUMN_DIM.unknown).toBeCloseTo(1 - NODATA.opacity, 9);
    const agag = sp('Gerbillus agag');
    const spans = columnSpans(agag, agag.t0);
    expect(spans).toEqual([{ ago0: agag.t0 * 1e6, ago1: 0, style: 'unknown' }]);
    for (const n of ['Dasyurus hallucatus', 'Gerbillus nanus', 'Panthera leo']) expect(columnSpans(sp(n), sp(n).t0).some((s) => s.style === 'unknown'), n).toBe(false);
  });
});

describe('search finds it, and its tap lands as any species’ (ToLaD#507)', () => {
  it('Gerbillus agag: found, its column centred, its card open at its tip, drawn faint', () => {
    const agag = sp('Gerbillus agag');
    expect(searchSpecies(all, 'Gerbillus agag')[0]).toBe(agag);
    const noop = () => {};
    const g = globalThis as Record<string, unknown>;
    g.Path2D = class {
      moveTo() {}
      lineTo() {}
      arc() {}
      bezierCurveTo() {}
      quadraticCurveTo() {}
      closePath() {}
      rect() {}
    };
    g.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    g.window = { devicePixelRatio: 2 };
    let queue: ((t: number) => void)[] = [];
    g.requestAnimationFrame = (cb: (t: number) => void) => (queue.push(cb), queue.length);
    g.cancelAnimationFrame = noop;
    const ctx = new Proxy(
      { measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>,
      { get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]), set: (o, k, v) => ((o[k as string] = v), true) },
    );
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      parentElement: null,
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 }),
      addEventListener: noop,
      removeEventListener: noop,
    };
    const v = new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
    const frames = (t: number) => {
      for (let k = 0; k < 50 && queue.length; k++) {
        const q = queue;
        queue = [];
        for (const cb of q) cb(t);
      }
    };
    frames(performance.now());
    const sels: (Selection | null)[] = [];
    v.onSelect = (s) => sels.push(s);
    const s = v.fan.branches.find((x) => x.sp.sci === 'Gerbillus agag')!.sp;
    const b = v.fan.branches.find((x) => x.sp === s)!;
    v.flyToSpecies(s);
    frames(performance.now() + 5000);
    const [x, y] = v.toScreen(leftAt(b, b.tipY) + laneAt(b, b.tipY).w / 2, b.tipY);
    expect(x).toBeGreaterThan(0.3 * v.w);
    expect(x).toBeLessThan(0.7 * v.w);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(0.5 * v.h);
    const last = sels[sels.length - 1]!;
    expect(last.sp).toBe(s);
    expect(last.ageMa).toBe(s.t1);
    expect(v.selected).toBe(s);
    // Its whole column faint on the tree: one styled span, from its split to now, at the chart's "no data".
    const ys = colSpansY(v.fan, b);
    expect(ys.length).toBe(1);
    expect(ys[0][2]).toBeCloseTo(1 - NODATA.opacity, 9);
  });
});
