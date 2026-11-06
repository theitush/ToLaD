// Mammals is the only page (ToLaD#418): the old `?level=` links land on their clade's frame at mammals, at once.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { levelLinkClade } from './FanApp';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { FanView, type Level } from './view';

function stubView(): FanView {
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
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
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
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

interface Priv {
  anim: unknown;
  cam: Camera;
  steps: unknown[];
  frameOf(lv: Level): Camera;
}
const P = (v: FanView) => v as unknown as Priv;

describe('the old level links (ToLaD#418)', () => {
  beforeAll(async () => {
    await loadMammalsFromFiles();
  }, 120_000);

  it('name their clades; mammals, no level and anything else are home', () => {
    expect(levelLinkClade('?level=cats')).toBe('Felidae');
    expect(levelLinkClade('?level=carnivores&gaps=clades')).toBe('Carnivora');
    for (const home of ['', '?level=mammals', '?level=fish', '?gaps=clades']) expect(levelLinkClade(home)).toBeNull();
  });

  it.each([
    ['?level=cats', 'Felidae'],
    ['?level=carnivores', 'Carnivora'],
  ])('%s stands on the clade\'s frame at mammals, with no flight', (search, taxon) => {
    const v = stubView();
    const home = { ...P(v).cam };
    v.goToClade(levelLinkClade(search)!);
    const node = v.fan.nodes.find((n) => n.split.taxon === taxon)!;
    expect(node).toBeTruthy();
    expect(P(v).anim).toBeNull();
    expect(P(v).steps).toEqual([]);
    expect(P(v).cam).toEqual(P(v).frameOf({ v: node }));
    expect(P(v).cam.sx).toBeGreaterThan(home.sx);
    expect(v.levelNow(true).v).toBe(node);
    v.destroy();
  }, 120_000);

  it('a clade the tree does not hold leaves the view at home', () => {
    const v = stubView();
    const home = { ...P(v).cam };
    v.goToClade('Nothing');
    expect(P(v).cam).toEqual(home);
    v.destroy();
  }, 120_000);
});
