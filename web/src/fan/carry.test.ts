// ToLaD#255: the labels and the brackets laid out at rest, and while the view moves at most every 150 ms; between,
// carried with the camera. Carried, they stay on what they name; at rest, exactly what a layout gives.
import { describe, expect, it } from 'vitest';
import { wantCutLabels } from './cut';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { carryLabels, FanView, labelGroups, labelSpots, type LabelSpot } from './view';

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

describe.skipIf(wantCutLabels())('labels carried with the camera while it moves, laid out again at rest (ToLaD#255)', () => {
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

describe('a label carried off the side of the screen lets go of its place (ToLaD#255)', () => {
  it('fit 0 once wholly off, kept while any of it is on', () => {
    const spot = (x: number): LabelSpot => ({ key: `s${x}:right`, id: `s${x}`, place: 'right', text: 'x', rank: [1, 1, 0], x, y1: 300, box: [x - 10, 280, x + 10, 300], fit: 1 }) as LabelSpot;
    const spots = [spot(360), spot(340), spot(30)];
    carryLabels(spots, [1, 45, 1, 0], 100, 390);
    expect(spots.map((s) => s.fit)).toEqual([0, 1, 1]);
    carryLabels(spots, [1, -90, 1, 0], 100, 390);
    expect(spots.map((s) => [s.box[0], s.fit])).toEqual([[305, 0], [285, 1], [-25, 0]]);
  });
});

// ToLaD#255: while the view moves the labels are carried (across lod.gen too, at the mammal level), and which show keeps
// to the frame before (hysteresis). At rest none of that counts: the same camera, however reached, gives the same labels
// (spots, the names shown, their "+x" room) as a still view opened there.
describe.skipIf(wantCutLabels())('at rest, the same labels whatever the way there (ToLaD#255)', () => {
  type Shot = { spots: string[]; on: string[] };
  const shot = (v: FanView): Shot => {
    const st = (v as unknown as { labelState: Map<string, { on: boolean }> }).labelState;
    const spots = P(v).labLast!.spots;
    return { spots: spots.map(key), on: spots.filter((s) => st.get(s.key)?.on).map((s) => s.key) };
  };
  /** A gesture of `steps` (zoom factor, pan dx, dy) drawn frame by frame from `from`, ending on `to`, then at rest. */
  const via = (v: FanView, from: FanView['cam'], steps: [number, number, number][], to: FanView['cam']): Shot => {
    v.cam = { ...from };
    v.draw();
    v.draw();
    P(v).gestureStart();
    for (const [z, dx, dy] of steps) {
      v.zoomAbout(195, 422, z);
      v.pan(dx, dy);
      v.draw();
    }
    v.cam = { ...to };
    v.draw();
    P(v).gestureEnd();
    v.draw();
    v.draw();
    return shot(v);
  };
  const ramp = (n: number, z: number, dx: number, dy: number) => Array.from({ length: n }, () => [z, dx, dy] as [number, number, number]);
  const mammals = async () => {
    await loadMammalsFromFiles();
    return stubView(mammaliaClade(), mammaliaTree(), true);
  };
  const cases: [string, () => Promise<FanView>, (v: FanView) => FanView['cam']][] = [
    ['carnivores (folded)', async () => stubView(), (v) => v.homeCamera()],
    ['mammals, home', mammals, (v) => v.homeCamera()],
    ['mammals, Rodentia x3', mammals, (v) => v.levelCamera('Rodentia', 3)!],
  ];
  for (const [name, mk, at] of cases)
    it(name, { timeout: 300_000 }, async () => {
      const v = await mk();
      const to0 = at(v);
      // The camera to reach: the level's own (home), or a little off it, zoomed and panned.
      v.cam = { ...to0 };
      if (!name.includes('home')) {
        v.zoomAbout(195, 422, 1.3);
        v.pan(-30, 12);
      }
      const to = { ...v.cam };
      // A: a slow pinch in and out, a little pan (drawperf's); B: in then out, panning left; C: a still view opened there.
      const slow = Array.from({ length: 90 }, (_, k) => [k < 45 ? 1.01 : 1 / 1.01, k % 2 ? 0.5 : -0.5, 0] as [number, number, number]);
      const a = via(v, to0, slow, to);
      const b = via(v, to0, [...ramp(15, 1.06, -8, -4), ...ramp(6, 1 / 1.04, 3, 2)], to);
      const c = await mk();
      c.cam = { ...to };
      c.draw();
      c.draw();
      const s = shot(c);
      expect(s.on.length).toBeGreaterThan(0);
      expect(a.spots).toEqual(s.spots);
      expect(b.spots).toEqual(s.spots);
      expect(a.on).toEqual(s.on);
      expect(b.on).toEqual(s.on);
    });
});
