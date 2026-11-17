// Under a group's title, its parts' labels where they fit (ToLaD#483, Ita: "theres enough room for the asiatic bear name and pic under the american bear and kin title.. we should avoid them when they
// fit"): at a sample of landings, the title and its parts' names and pictures both, and no two labels meeting. TITLEPARTS_SAY=1 prints the counts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { latinOf } from './brackets';
import { setFlip } from './flip';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';
import type { Steady } from './steady';
import { FanView, type CutLabels, type Level } from './view';
import { picBox } from './pics';

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
    getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

type Inner = { landOf(lv: Level): Camera; labelsNow(): { cut: CutLabels } };
const env = (globalThis as { process?: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const say = (s: string) => env?.env.TITLEPARTS_SAY && env.stderr.write(s + '\n');

describe('under a title, its parts labelled where they fit', () => {
  let v: FanView;
  let home: Camera;
  beforeAll(async () => {
    await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
    home = { ...v.cam };
  }, 120000);
  afterAll(() => setFlip(false));

  const at = (latin: string | null): CutLabels => {
    const c = latin ? (v as unknown as Inner).landOf({ v: v.fan.nodes.find((q) => latinOf(q.split) === latin)! }) : home;
    (v.fan.tess.fold as Steady).setScale(c.sx, v.w);
    v.cam = { ...c };
    return (v as unknown as Inner).labelsNow().cut;
  };
  const LANDINGS = [null, 'Carnivora', 'Ursidae', 'Primates', 'Rodentia', 'Chiroptera'];

  it('at each landing, no two labels meet; the labelled species counted', () => {
    const bad: string[] = [];
    for (const latin of LANDINGS) {
      const c = at(latin);
      const boxes: [string, readonly number[]][] = [
        ...[...c.names, ...c.spots].map((s) => [s.text, s.box] as [string, readonly number[]]),
        ...c.pics.map((p) => [`pic ${p.face.sp.sci}`, picBox(p)] as [string, readonly number[]]),
      ];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [p, q] = [boxes[i][1], boxes[j][1]];
          if (p[0] < q[2] - 1e-6 && p[2] > q[0] + 1e-6 && p[1] < q[3] - 1e-6 && p[3] > q[1] + 1e-6) bad.push(`${latin ?? 'home'}: ${boxes[i][0]} / ${boxes[j][0]}`);
        }
      const named = [...c.names, ...c.spots];
      const species = new Set([...named.filter((s) => s.b).map((s) => s.b!), ...c.pics.filter((p) => p.lv.b).map((p) => p.lv.b!)]);
      say(
        `${latin ?? 'home'}: names ${named.length} (species ${named.filter((s) => s.b).length}, groups ${named.filter((s) => !s.b).length}), pictures ${c.pics.length}, species labelled ${species.size}: ${named.map((s) => s.text).join(' | ')}`,
      );
    }
    expect(bad).toEqual([]);
  });

  // (Its group, "American black bear & kin", opens part by part, ToLaD#500: the bears' landing is where they fit the screen, its gap there too tight for its title, which stands once that holds it.)
  it('at the bears, the Asiatic black bear has its name and picture', () => {
    const c = at('Ursidae');
    const named = [...c.names, ...c.spots].some((s) => s.b?.sp.sci === 'Ursus thibetanus');
    expect(named, 'its name').toBe(true);
    expect(c.pics.some((p) => p.lv.b?.sp.sci === 'Ursus thibetanus'), 'its picture').toBe(true);
  });
});
