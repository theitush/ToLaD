// ?frame=cut (ToLaD#333, research/scalable-tree.md §4, plan step 3): a level, a bracket's tap and a "+x" tap frame their
// territory whole in the labels' width of the screen (across it, or at the zoom its groups first hold their pictures), so every label shown there stands whole on screen, with no padding;
// a "+x" lands with the species it counted on screen. With ?labels=cut (the cut's labels).
import { describe, expect, it } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, mammaliaTree, type Split } from './splits';
import { FanView, fossilSpan, isLevel, levelName, nextLevels } from './view';
import { setLabelMode, PIC_D, PIC_ROOM } from './pics';
import type { FanNode } from './layout';
import { setGapMode } from './fold';

// (Written for the cut's labels and the groups' gaps, modes still in the modules: the app's defaults since ToLaD#439 are `groups` and `clades`.)
setLabelMode('cut');
setGapMode('groups');


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
/**
 * The labels (names, "+x", pictures) of strands lo..hi, what the frame is of, not whole on screen. A neighbour's may be
 * past the edge: a label of one branch stays with its branch (ToLaD#373).
 */
function cutOff(v: FanView, at: string, lo: number, hi: number): string[] {
  const c = v.cutLast!;
  const bad: string[] = [];
  const mine = (run?: readonly number[]) => !!run && run[1] >= lo && run[0] <= hi;
  for (const s of c.spots) if (mine(s.run) && (s.box[0] < -1e-6 || s.box[2] > v.w + 1e-6 || s.box[3] > v.h)) bad.push(`${at}: "${s.text}" at x ${s.box[0].toFixed(1)}–${s.box[2].toFixed(1)}`);
  for (const p of c.pics) if (mine(p.run) && (p.x - PIC_D / 2 < -1e-6 || p.x + PIC_D / 2 > v.w + 1e-6)) bad.push(`${at}: ${p.face.sp.common}'s picture at x ${p.x.toFixed(1)}`);
  return bad;
}
/** Clade u's territory on screen, its strands lo..hi's. */
function onScreen(v: FanView, lo: number, hi: number): [number, number] {
  const T = (v as unknown as { territories(): { t: { span(j: number): [number, number] } } }).territories().t;
  return [v.toScreen(T.span(~lo)[0], 0)[0], v.toScreen(T.span(~hi)[1], 0)[0]];
}
const levelsOf = (v: FanView): FanNode[] => v.fan.nodes.filter((u) => u.parent && u.split.taxon && isLevel(v.fan, u) && u.strands.length > 1);

describe('?frame=cut: a level framed by its territory, every label whole (ToLaD#333)', () => {
  it('every carnivore level, by name and by a bracket\'s tap; the primates, bats, hominins and marsupials at the mammals', async () => {
    const bad: string[] = [];
    let n = 0;
    const walk = (v: FanView, us: FanNode[]) => {
      for (const u of us)
        for (const [how, cam] of [
          ['level', () => v.levelCamera(u.split.taxon!)!],
          ['bracket', () => v.cladeCamera(u)],
        ] as const) {
          v.cam = cam();
          v.camera.settle();
          settle(v);
          const at = `${levelName(u)} (${how})`;
          // (Its territory (the hull its columns stand in, rooms by life; a level framed on its fossils, where they lived,
          // ToLaD#289) whole in the labels' width, LABEL_AXIS_X to the edge: across it, or at the zoom its narrowest group's
          // territory first holds a label (PIC_ROOM), ToLaD#262.)
          const T = (v as unknown as { territories(): { t: { span(j: number): [number, number]; index: Map<FanNode, number> } } }).territories().t;
          const fs = fossilSpan(v.fan, u);
          const [a, b] = (fs ?? T.span(T.index.get(u)!)).map((x) => v.toScreen(x, 0)[0]);
          const groups = nextLevels(v.fan, u).map((g) => (g.b ? T.span(~g.b.index) : T.span(T.index.get(g.v)!)));
          const fit = Math.min(...groups.map(([p, q]) => (q - p) * v.cam.sx));
          const whole = a >= 72 - 0.5 && b <= v.w + 0.5;
          if (!whole || !(Math.abs(a - 72) <= 0.5 && Math.abs(b - v.w) <= 0.5) && !(!fs && Math.abs(fit - PIC_ROOM) <= 0.5))
            bad.push(`${at}: framed at ${a.toFixed(1)}–${b.toFixed(1)}, its narrowest group ${fit.toFixed(1)} px`);
          if (!v.cutLast!.spots.length) bad.push(`${at}: no labels`);
          const [lo, hi] = [u.strands[0].index, u.strands[u.strands.length - 1].index];
          bad.push(...cutOff(v, at, lo, hi));
          n++;
        }
    };
    const c = stubView();
    walk(c, levelsOf(c));
    await loadMammalsFromFiles();
    const m = stubView(mammaliaClade(), mammaliaTree(), true);
    walk(
      m,
      ['Primates', 'Chiroptera', 'Hominini', 'Metatheria', 'Peramelemorphia'].map((t) => m.fan.nodes.find((u) => u.split.taxon === t)!),
    );
    expect(n).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  }, 400000);
});

describe('?frame=cut: a "+x" tap flies to its group, its species across the screen, every label whole (ToLaD#333)', () => {
  it('carnivores (folded): home and every level, every "+x"', () => {
    const v = stubView();
    const bad: string[] = [];
    let taps = 0;
    const frames: [string, () => void][] = [
      ['home', () => (v.cam = v.homeCamera())],
      ...levelsOf(v).map((u): [string, () => void] => [levelName(u), () => (v.cam = v.levelCamera(u.split.taxon!)!)]),
    ];
    for (const [at, go] of frames) {
      const land = () => {
        go();
        v.camera.settle();
        settle(v);
      };
      land();
      for (const h of v.plusHits.map((p) => ({ badge: [...p.badge], bs: [...p.bs], run: p.run }))) {
        if (h.bs.length < 2) continue;
        land();
        v.tap((h.badge[0] + h.badge[2]) / 2, (h.badge[1] + h.badge[3]) / 2);
        if (!P(v).anim) {
          bad.push(`${at}: +${h.bs.length} flew nowhere`);
          continue;
        }
        run(v);
        taps++;
        // (Into its item (ToLaD#359, tapItem): its species across the screen, or, where that frame does not split it, its
        // next split, two or more of its labels on screen.)
        const ix = h.bs.map((b) => b.index);
        const [lo, hi] = h.run ?? [Math.min(...ix), Math.max(...ix)];
        const [a, b] = onScreen(v, lo, hi);
        const split = v.cutLast!.items.filter((it) => it.f >= lo && it.l <= hi).length;
        if ((a < 72 - 0.5 || b > v.w + 0.5) && split < 2) bad.push(`${at}: +${h.bs.length} landed with its species at ${a.toFixed(1)}–${b.toFixed(1)}, ${split} of its labels`);
        bad.push(...cutOff(v, `${at} → +${h.bs.length}`, lo, hi));
      }
    }
    expect(taps).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  }, 400000);
});
