// The chain of groups under the buttons (ToLaD#452): its names, how it fits, and that it follows the view with a write only on a change.
import { beforeAll, describe, expect, it } from 'vitest';
import { chainFit } from './flip';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { chainOf, FanView } from './view';

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
  g.document = { createElement: () => ({ textContent: '' }) };
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
    getBoundingClientRect: () => ({ width: 844, height: 390, left: 0, top: 0, right: 844, bottom: 390 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

/** The element's stand-in: what the chain last held, and how many changes of group wrote it. */
function fakeChain() {
  const el = {
    scrollWidth: 0,
    clientWidth: 1e6,
    text: '',
    writes: 0,
    replaceChildren(outer: string, last: { textContent: string }) {
      el.text = outer + last.textContent;
      el.writes++;
    },
  };
  return el;
}

describe('the chain of groups (ToLaD#452)', () => {
  beforeAll(async () => {
    await loadMammalsFromFiles();
  }, 120_000);

  it('drops the outer names first, whole; the innermost always stays', () => {
    const names = ['Mammals', 'Carnivores', 'Cat-like carnivores', 'Cats'];
    const fit = (room: number) => chainFit(names, (p) => p.join(' › ').length <= room);
    expect(fit(100)).toEqual(names);
    expect(fit(35)).toEqual(['…', 'Cat-like carnivores', 'Cats']);
    expect(fit(5)).toEqual(['Cats']);
    expect(chainFit(['Mammals'], () => false)).toEqual(['Mammals']);
  });

  it('follows the view: home, a clade, in a pinch, with a write only when the group changes', () => {
    const v = stubView();
    const el = fakeChain();
    v.chainEl = el as unknown as HTMLElement;
    const felidae = v.fan.nodes.find((n) => n.split.taxon === 'Felidae')!;
    expect(chainOf(v.fan, felidae)).toEqual(['Mammals', 'Carnivores', 'Cat-like carnivores', 'Cats']);
    expect(chainOf(v.fan, v.fan.root)).toEqual(['Mammals']);

    const frame = v as unknown as { chainFrame(): void; chainT: number };
    frame.chainFrame();
    expect(el.text).toBe('Mammals');
    v.goToClade('Felidae');
    frame.chainFrame();
    expect(el.text).toBe('Mammals › Carnivores › Cat-like carnivores › Cats');
    const writes = el.writes;
    for (let k = 0; k < 50; k++) frame.chainFrame();
    expect(el.writes).toBe(writes);

    // Under the fingers: out to home, the chain with it, each pass held to LEVEL_MS.
    v.gestureStart();
    v.cam = v.homeCamera();
    frame.chainT = 0;
    const t0 = performance.now();
    frame.chainFrame();
    console.log(`the chain's level under a finger: ${(performance.now() - t0).toFixed(2)} ms`);
    expect(el.text).toBe('Mammals');
    const inner = v.fan.nodes.find((n) => n.split.taxon === 'Carnivora')!;
    v.goToClade('Carnivora');
    v.gestureStart();
    frame.chainFrame();
    expect(el.text).toBe('Mammals');
    frame.chainT = 0;
    frame.chainFrame();
    expect(el.text).toBe(chainOf(v.fan, inner).join(' › '));
  });
});
