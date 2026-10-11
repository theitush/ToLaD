// Species search (ToLaD#157): the matcher, and a pick flying the fan to the species' column with its card open.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { FELIDAE, type SpeciesRec } from './panthera';
import { fold, matchRank, searchSpecies } from './search';
import { SearchPanel } from './SearchPanel';
import { FanView, type Selection } from './view';

const names = (q: string, all: { common: string; sci: string }[] = FELIDAE.species) => searchSpecies(all, q).map((s) => s.common);

describe('the matcher', () => {
  it('folds accents, case and punctuation', () => {
    expect(fold('Yucatán cave cat')).toBe('yucatan cave cat');
    expect(fold("  Geoffroy's  CAT ")).toBe('geoffroy s cat');
    expect(fold('Black-footed cat')).toBe('black footed cat');
  });

  it('ranks a prefix, then a word start, then inside a word (3 letters or more)', () => {
    expect(matchRank('lion', 'li')).toBe(0);
    expect(matchRank('cave lion', 'li')).toBe(1);
    expect(matchRank('felis silvestris', 'li')).toBe(-1);
    expect(matchRank('felis silvestris', 'lis')).toBe(2);
    expect(matchRank('lion', '')).toBe(-1);
  });

  it('lists prefix matches first, then word starts, then the rest', () => {
    const all = [
      { common: 'Stalion', sci: 'Equus x' },
      { common: 'Cave lion', sci: 'Panthera spelaea' },
      { common: 'Lion', sci: 'Panthera leo' },
      { common: 'Lionfish', sci: 'Pterois' },
    ];
    expect(names('lio', all)).toEqual(['Lion', 'Lionfish', 'Cave lion', 'Stalion']);
    expect(names('li')).toEqual(['Lion', 'Cave lion']);
  });

  it('ignores accents and case both ways', () => {
    expect(names('yucatan')).toEqual(['Yucatán cave cat']);
    expect(names('YUCATÁN')).toEqual(['Yucatán cave cat']);
    expect(names('CAVE')).toEqual(['Cave lion', 'Yucatán cave cat']);
  });

  it('matches scientific names, fossils too', () => {
    expect(names('panthera leo')).toEqual(['Lion']);
    expect(names('spelaea')).toEqual(['Cave lion']);
    expect(names('balam')).toEqual(['Yucatán cave cat']);
    // A genus lists all its species; a common-name prefix ranks with a scientific one.
    expect(names('lynx').slice(0, 4).sort()).toEqual(['Bobcat', 'Canada lynx', 'Eurasian lynx', 'Iberian lynx']);
    expect(names('felis')).toContain('Wildcat');
  });

  it('lists each species once, nothing for an empty query or no match', () => {
    const lion = FELIDAE.species.find((s) => s.common === 'Lion')!;
    expect(searchSpecies([lion, lion], 'lion')).toEqual([lion]);
    expect(names('')).toEqual([]);
    expect(names('   ')).toEqual([]);
    expect(names('zzz')).toEqual([]);
  });
});

describe('the list', () => {
  it('shows each row with its common name, scientific name in italics and an extinct tag for fossils', () => {
    const html = renderToStaticMarkup(createElement(SearchPanel, { species: FELIDAE.species, onPick: () => {}, onClose: () => {}, initial: 'li' }));
    expect(html).toContain('role="listbox"');
    const rows = html.match(/<li [^>]*role="option".*?<\/li>/g)!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Lion</span><i>Panthera leo</i>');
    expect(rows[0]).not.toContain('extinct');
    expect(rows[0]).toContain('aria-selected="true"');
    expect(rows[1]).toContain('Cave lion</span><i>Panthera spelaea</i><span class="ext">extinct</span>');
  });

  it('says so when nothing matches, and lists nothing before typing', () => {
    const none = renderToStaticMarkup(createElement(SearchPanel, { species: FELIDAE.species, onPick: () => {}, onClose: () => {}, initial: 'qqq' }));
    expect(none).toContain('No species by that name');
    const empty = renderToStaticMarkup(createElement(SearchPanel, { species: FELIDAE.species, onPick: () => {}, onClose: () => {} }));
    expect(empty).not.toContain('listbox');
  });
});

/** A FanView on a stub canvas (as events.test.tsx), its animation frames queued for the test to run. */
function stubView(): { v: FanView; frames: (t: number) => void } {
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
  g.cancelAnimationFrame = () => {};
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
  const v = new FanView(canvas as unknown as HTMLCanvasElement, FELIDAE);
  const frames = (t: number) => {
    for (let k = 0; k < 50 && queue.length; k++) {
      const q = queue;
      queue = [];
      for (const cb of q) cb(t);
    }
  };
  frames(performance.now());
  return { v, frames };
}

describe('a pick flies there and opens the card', () => {
  const { v, frames } = stubView();
  const fan = v.fan;
  const sels: (Selection | null)[] = [];
  v.onSelect = (s) => sels.push(s);
  const pick = (sp: SpeciesRec) => {
    sels.length = 0;
    v.cam = v.homeCamera();
    v.camera.settle();
    v.flyToSpecies(sp);
    // Mid-flight: the card waits for the landing.
    frames(performance.now() + 200);
    expect(sels.filter(Boolean)).toEqual([]);
    frames(performance.now() + 5000);
  };

  for (const name of ['Lion', 'Iberian lynx', 'Cave lion', 'Yucatán cave cat', 'Domestic cat']) {
    it(`${name}: its column centred and readable at its tip, its card open there`, () => {
      const sp = FELIDAE.species.find((s) => s.common === name)!;
      const b = fan.branches.find((x) => x.sp === sp)!;
      pick(sp);
      // The column's centre line at its tip, mid-screen across and in the top half (above the card).
      const [x, y] = v.toScreen(b.cx, b.tipY);
      expect(x).toBeGreaterThan(0.3 * v.w);
      expect(x).toBeLessThan(0.7 * v.w);
      expect(y).toBeGreaterThan(120);
      expect(y).toBeLessThan(0.5 * v.h);
      // Readable: wide on screen (zoomed in from home on width), its label on.
      expect(b.width * v.cam.sx).toBeGreaterThan(0.3 * v.w);
      const st = (v as unknown as { labelState: Map<string, { on: boolean }> }).labelState;
      expect([...st].some(([k, s]) => k.startsWith(`${sp.gid}:`) && s.on)).toBe(true);
      // The card: the species at its tip (today, or its last appearance), as a tap there opens it.
      const last = sels[sels.length - 1]!;
      expect(last.sp).toBe(sp);
      expect(last.ageMa).toBe(sp.t1);
      expect(last.startMa).toBe(b.t0);
      expect(v.selected).toBe(sp);
      expect(v.touch?.ageMa).toBe(sp.t1);
    });
  }

  it('width and time are framed apart (#138), each zoomed in from home', () => {
    const h = v.homeCamera();
    const b = fan.branches.find((x) => x.sp.common === 'Lion')!;
    const c = v.speciesCamera(b);
    expect(c.sx).toBeGreaterThan(h.sx);
    expect(c.sy).toBeGreaterThanOrEqual(h.sy);
    expect(c.sx / c.sy).not.toBeCloseTo(h.sx / h.sy, 3);
  });
});
