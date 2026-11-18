// A species nobody knows the number of (FLAG bit 11, ToLaD#507): Data Deficient, no range map, never counted. Its count
// in the data is a width, the thinnest a living species is drawn at, never a figure: the card says "unknown" and why,
// linked to "What we don't know"; its column is drawn as one thin dashed line, tip to split, at its room's centre
// (ToLaD#565; `?unknown=faint`, the old look: faint, as the chart draws "no data"); search finds it and its tap lands as
// any species'. A range IUCN codes extinct or possibly extinct (bit 12) says so on the status line. (A clade of only
// such species, a dashed line too: amniotes, dashed.test.ts.)
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatCount } from '../data/count';
import { addressWith, chosenIn } from './ChoiceChip';
import { COLUMN_DIM, columnSpans } from './colstyle';
import { DASH_OFF, DASH_ON, DASH_W, setUnknownLook, strandDashes, unknownLook } from './dashed';
import { RANGE_EX_PE_WORDS, SpeciesCard, UNKNOWN_CHOICES, UNKNOWN_WHY } from './FanApp';
import { NODATA } from './history';
import { Batches, SEG_F } from './meshgl';
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

  it('the old look (faint): its column faint over its whole length, as the chart’s “no data”; a known one not', () => {
    expect(COLUMN_DIM.unknown).toBeCloseTo(1 - NODATA.opacity, 9);
    const agag = sp('Gerbillus agag');
    const spans = columnSpans(agag, agag.t0);
    expect(spans).toEqual([{ ago0: agag.t0 * 1e6, ago1: 0, style: 'unknown' }]);
    for (const n of ['Dasyurus hallucatus', 'Gerbillus nanus', 'Panthera leo']) expect(columnSpans(sp(n), sp(n).t0).some((s) => s.style === 'unknown'), n).toBe(false);
  });

  it('the page: dashed by default, `?unknown=faint` the old look (ToLaD#565)', () => {
    expect(unknownLook()).toBe('dashed');
    expect(UNKNOWN_CHOICES.map((c) => c.value)).toEqual(['dashed', 'faint']);
    expect(chosenIn('?unknown=faint', 'unknown', UNKNOWN_CHOICES)).toBe('faint');
    expect(chosenIn('?tree=amniotes', 'unknown', UNKNOWN_CHOICES)).toBe(null);
    expect(addressWith('https://x/?unknown=faint&tree=amniotes', 'unknown', UNKNOWN_CHOICES, 'dashed')).toBe('https://x/?tree=amniotes');
    expect(addressWith('https://x/', 'unknown', UNKNOWN_CHOICES, 'faint')).toBe('https://x/?unknown=faint');
  });
});

describe('search finds it, and its tap lands as any species’ (ToLaD#507)', () => {
  it('Gerbillus agag: found, its column centred, its card open at its tip, drawn as one dashed line (ToLaD#565; faint, the old look)', () => {
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
    const dashes: number[][] = [];
    const ctx = new Proxy(
      { measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }), setLineDash: (d: number[]) => dashes.push(d) } as Record<string, unknown>,
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
    // Its column one dashed line from its tip down to its split (its parent's column has counted species in it: a band).
    expect(strandDashes(v.fan, b)).toEqual([-Infinity, b.splitY, 0]);
    expect(strandDashes(v.fan, v.fan.branches.find((x) => x.sp.sci === 'Gerbillus nanus')!)).toEqual([]);
    // Drawn without the GPU layer: stroked dashed, DASH_ON on, DASH_OFF off.
    dashes.length = 0;
    v.draw();
    expect(dashes).toContainEqual([DASH_ON, DASH_OFF]);
    // On the GPU layer (its batches, as FanGL draws them): its chords dashed, each one centred on its column, none a band.
    const I = v as unknown as { gl: Batches & { end(): void } };
    I.gl = Object.assign(new Batches(), { end() {} });
    const [, yTip] = v.toScreen(0, b.tipY);
    const [, ySplit] = v.toScreen(0, b.splitY);
    const centre = (y: number) => v.toScreen(leftAt(b, v.toWorld(0, y)[1]) + laneAt(b, v.toWorld(0, y)[1]).w / 2, 0)[0];
    // (Its room's centre: its column's, past its fork, and its fork's stem's.)
    const room = centre(Math.max(0, yTip) + 1);
    const chords = () => {
      v.draw();
      const S = I.gl.segs;
      const out: { dash: boolean; l: number; r: number; y0: number; y1: number; dim: number; stem: boolean }[] = [];
      for (let j = 0; j < S.n; j++) {
        const o = SEG_F * j;
        const y0 = S.f[o + 3];
        const y1 = y0 + S.f[o + 7];
        if (y1 < Math.max(0, yTip) + 1 || y0 > Math.min(v.h, ySplit) - 1) continue;
        // (Its own column's stretch: where its centre is at this height.)
        const c = centre((y0 + y1) / 2);
        const dash = S.f[o + 15] > 0.5;
        const l = dash ? S.f[o] - DASH_W / 2 : Math.min(S.f[o], S.f[o + 4]);
        const r = dash ? S.f[o] + DASH_W / 2 : Math.max(S.f[o + 1], S.f[o + 5], S.f[o] + 1);
        if (l <= c + 0.01 && r >= c - 0.01) out.push({ dash, l, r, y0, y1, dim: S.f[o + 14], stem: false });
        else if (dash && Math.abs(S.f[o] - room) < 1e-3 && S.f[o + 12] === 0) out.push({ dash, l, r, y0, y1, dim: 0, stem: true });
      }
      return out;
    };
    const on = chords();
    expect(on.length).toBeGreaterThan(0);
    for (const c of on) expect(c.dash, `chord ${c.y0.toFixed(1)}–${c.y1.toFixed(1)}`).toBe(true);
    // (Exactly centred: its line at its column's middle, DASH_W across.)
    for (const c of on) if (!c.stem) expect(Math.abs((c.l + c.r) / 2 - centre(c.y0))).toBeLessThan(1e-3);
    // Down its whole column on screen, and on down its fork's stem (a thin fork's, its peel too short: drawCorners) to its split.
    const top = Math.min(...on.map((c) => c.y0));
    const bot = Math.max(...on.map((c) => c.y1));
    expect(top).toBeLessThanOrEqual(Math.max(0, yTip) + 2);
    expect(bot).toBeGreaterThanOrEqual(Math.min(v.h, ySplit) - 2);
    // The old look, `?unknown=faint`: a band, faint over its whole column (one styled span, its split to now, the chart's "no data").
    setUnknownLook('faint');
    try {
      const faint = chords();
      expect(faint.length).toBeGreaterThan(0);
      for (const c of faint) expect(c.dash).toBe(false);
      expect(faint.every((c) => c.dim > 0)).toBe(true);
      const ys = colSpansY(v.fan, b);
      expect(ys.length).toBe(1);
      expect(ys[0][2]).toBeCloseTo(1 - NODATA.opacity, 9);
      // (No dashed chord anywhere.)
      const S = I.gl.segs;
      for (let j = 0; j < S.n; j++) expect(S.f[SEG_F * j + 15]).toBe(0);
    } finally {
      setUnknownLook('dashed');
    }
  });
});
