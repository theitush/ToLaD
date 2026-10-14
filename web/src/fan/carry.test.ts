// ToLaD#255: the labels and the brackets laid out at rest, and while the view moves at most every 150 ms; between,
// carried with the camera. Carried, they stay on what they name; at rest, exactly what a layout gives.
import { describe, expect, it } from 'vitest';
import { CARNIVORA, FELIDAE, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, type Split } from './splits';
import { FanView, labelGroups, labelSpots, type LabelSpot } from './view';

function stubView(clade: CladeRec = CARNIVORA, tree: Split = CARNIVORA_TREE, folds = true): FanView {
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, 'curved', tree, folds);
}

type Priv = {
  labLast: { spots: LabelSpot[]; top: number; frames: number } | null;
  gestureStart(): void;
  gestureEnd(): void;
  nameWidth(t: string): number;
  barRect(): number[] | null;
  plusRoom: Map<string, number>;
  names: 'beside';
  brackets: { named(v: unknown): boolean } | null;
};
const P = (v: FanView) => v as unknown as Priv;
/** A layout at the view's camera now (what labelsNow lays out at rest). */
function fresh(v: FanView): LabelSpot[] {
  const p = P(v);
  const L = p.labLast!;
  return labelSpots(v.camera, v.fan, L.top, (t) => p.nameWidth(t), p.barRect()?.[0], p.brackets ?? undefined, (id) => p.plusRoom.get(id) ?? 0, undefined, null, labelGroups(v.fan, v.levelNow()), p.names);
}
const key = (s: LabelSpot) => `${s.key} ${s.x.toFixed(3)} ${s.y1.toFixed(3)} ${s.box.map((q) => q.toFixed(3)).join(',')} ${s.fit.toFixed(3)}`;

const FANS: [string, () => FanView][] = [
  ['carnivores (folded)', () => stubView()],
  ['cats', () => stubView(FELIDAE as CladeRec, FELIDAE_TREE as Split, false)],
];

describe('labels carried with the camera while it moves, laid out again at rest (ToLaD#255)', () => {
  for (const [name, mk] of FANS) {
    it(name, () => {
      const v = mk();
      for (let k = 0; k < 3; k++) v.draw();
      const p = P(v);
      p.gestureStart();
      v.draw();
      const laid = p.labLast!;
      // A drag: the next frames carry the layout (no new one), each name where a layout puts it, within a px.
      let worst = 0;
      let n = 0;
      for (let k = 0; k < 2; k++) {
        v.pan(7, 3);
        v.draw();
        expect(p.labLast, 'carried, not laid out').toBe(laid);
        const now = new Map(fresh(v).map((s) => [s.key, s]));
        for (const s of laid.spots) {
          const f = now.get(s.key);
          if (!f || s.fit < 1 || f.fit < 1 || s.box[1] <= laid.top + 0.5) continue;
          n++;
          worst = Math.max(worst, Math.abs(f.x - s.x), Math.abs(f.y1 - s.y1));
        }
      }
      expect(n).toBeGreaterThan(0);
      expect(worst, 'a carried name off its place').toBeLessThan(1);
      // Laid out again after LABEL_FRAMES carried frames (and LABEL_MS).
      const t = performance.now();
      while (performance.now() - t < 160);
      for (let k = 0; k < 2; k++) v.draw();
      expect(p.labLast).not.toBe(laid);
      // At rest: exactly a layout's.
      p.gestureEnd();
      v.draw();
      // (Its "+x" room counted on the carried frames: one more frame, as the view asks for.)
      v.draw();
      expect(p.labLast!.spots.map(key)).toEqual(fresh(v).map(key));
    });
  }
});
