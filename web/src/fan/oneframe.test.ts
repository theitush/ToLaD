// One frame (ToLaD#359, research/scalable-tree.md §4): a tap on a label goes into exactly the cut item it stands for,
// framed by its territory filling the labels' width (runFrame), and there the cut one step finer shows every species
// of it under a label of its own, whole on screen; a double tap goes back out to a frame that holds it. Checked over the
// whole tree by code (no browser): cats and carnivores every item at home and one tap in, the mammals sampled.
import { describe, expect, it } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { FanView } from './view';

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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, folds);
}


type Priv = { anim: ((t: number) => boolean) | null; applyFold(): void };
const P = (v: FanView) => v as unknown as Priv;
function settle(v: FanView): void {
  for (let k = 0; k < 3; k++) v.draw();
}
function run(v: FanView): void {
  const iv = P(v);
  for (let t = performance.now() + 16; iv.anim; t += 16) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
  settle(v);
}
/** The time axis's labels' right edge (view.ts LABEL_AXIS_X): labels keep right of it. */
const AXIS = 72;

/**
 * At the view's frame for strands f..l: every label of them shown whole on screen (right of the axis; a neighbour's
 * may be sliding off the edge, ToLaD#373), and every species of f..l under a shown label that stands for none outside
 * f..l (its next-level labels, all of them).
 */
function frameCheck(v: FanView, f: number, l: number, at: string, bad: string[]): void {
  settle(v);
  const c = v.cutLast!;
  const mine = (run?: readonly number[]) => !!run && run[0] >= f && run[1] <= l;
  for (const s of c.spots) if (mine(s.run) && (s.box[0] < AXIS - 1e-6 || s.box[2] > v.w + 1e-6 || s.box[3] > v.h)) bad.push(`${at}: "${s.text}" cut off at x ${s.box[0].toFixed(1)}–${s.box[2].toFixed(1)}`);
  for (const p of c.pics) if (mine(p.run) && (p.x - p.d / 2 < AXIS - 1e-6 || p.x + p.d / 2 > v.w + 1e-6 || p.y - p.d / 2 < 0)) bad.push(`${at}: ${p.face.sp.common}'s picture cut off at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`);
  const got = new Int32Array(l - f + 1);
  for (const it of c.items) {
    if (it.l < f || it.f > l) continue;
    if (it.f < f || it.l > l) bad.push(`${at}: a label for strands ${it.f}-${it.l} stands for more than the item ${f}-${l}`);
    for (let i = Math.max(f, it.f); i <= Math.min(l, it.l); i++) got[i - f]++;
  }
  const miss = [...got.keys()].filter((i) => got[i] !== 1);
  if (miss.length) bad.push(`${at}: ${miss.length} of its ${l - f + 1} species under no label on screen, e.g. strand ${f + miss[0]}`);
}

/** Tap into each item shown at the view (all, or `sample` of them, spread), check its frame, and a double tap back out; `depth` taps deep. */
function tapEach(v: FanView, at: string, bad: string[], depth: number, sample = Infinity): number {
  settle(v);
  const from = { ...v.cam };
  const items = v.cutLast!.items.filter((it) => it.l > it.f).map((it) => [it.f, it.l] as [number, number]);
  const step = Math.max(1, Math.ceil(items.length / sample));
  let n = 0;
  for (let i = 0; i < items.length; i += step) {
    const [f, l] = items[i];
    v.cam = { ...from };
    settle(v);
    v.tapItem(f, l);
    run(v);
    const here = `${at} > ${f}-${l}`;
    n++;
    // (An item no frame splits, down to one species, its widest: its landing and card, the species' frame, not an item's.)
    if ((v as unknown as { backing: { lv: { b?: unknown } } | null }).backing?.lv.b) continue;
    const inside = { ...v.cam };
    if (Math.abs(Math.log(inside.sx / from.sx)) < 1e-3 && Math.abs(inside.cx - from.cx) * from.sx < 1) {
      bad.push(`${here}: the tap did not move`);
      continue;
    }
    // (A tap into an item whose frame is the view's goes on into its widest daughter: the frame checked is where it landed.)
    const T = (v as unknown as { territories(): { t: { hull(f: number, l: number): [number, number] } } }).territories().t;
    const [a, b] = T.hull(f, l).map((x) => v.toScreen(x, 0)[0]);
    if (a >= AXIS - 1 && b <= v.w + 1) frameCheck(v, f, l, here, bad);
    if (bad.length >= 20) return n;
    // A double tap, right after the tap: out one step, back to the frame the tap was made at (never deeper: the item's
    // own clade's frame is inside it, ToLaD#359).
    v.doubleTap(0, 0);
    run(v);
    const out = v.cam;
    if (!(out.sx < inside.sx * 0.999)) bad.push(`${here}: a double tap did not go out`);
    const off = Math.max(Math.abs(Math.log(out.sx / from.sx)), Math.abs(Math.log(out.sy / from.sy))) + Math.abs(out.cx - from.cx) * from.sx / v.w + Math.abs(out.cy - from.cy) * from.sy / v.h;
    if (off > 1e-2) bad.push(`${here}: the double tap went to x ${(1 / out.sx).toExponential(2)} at ${out.cx.toFixed(1)}, not back to the frame tapped at`);
    if (depth > 1) {
      v.cam = { ...inside };
      n += tapEach(v, here, bad, depth - 1, sample);
    }
  }
  return n;
}

const FANS: [string, () => Promise<FanView>, number, number][] = [
  ['cats', async () => stubView(FELIDAE as CladeRec, FELIDAE_TREE as Split, false), 2, Infinity],
  ['carnivores', async () => stubView(), 2, Infinity],
  [
    'mammals',
    async () => {
      await loadMammalsFromFiles();
      return stubView(mammaliaClade(), mammaliaTree(), true);
    },
    2,
    3,
  ],
];

describe('one frame (ToLaD#359): a label\'s tap frames its item, every next-level label whole on screen', () => {
  for (const [name, mk, depth, sample] of FANS)
    it(name, { timeout: 900_000 }, async () => {
      const v = await mk();
      const bad: string[] = [];
      v.cam = v.homeCamera();
      frameCheck(v, 0, v.fan.root.strands.length - 1, `${name} home`, bad);
      const n = tapEach(v, `${name} home`, bad, depth, sample);
      (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`oneframe ${name}: ${n} taps checked\n`);
      expect(bad).toEqual([]);
      expect(n).toBeGreaterThan(0);
    });
});
