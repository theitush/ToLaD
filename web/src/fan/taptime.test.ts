// A tap lands at once (ToLaD#359): a tap's own work, before its flight starts, is a few cuts of the item it goes into,
// never a search over cuts of the whole tree. Timed at the mammals (~6,000 species), each tap from the frame it is made at.
import { describe, expect, it } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { FanView } from './view';

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
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}
function settle(v: FanView): void {
  for (let k = 0; k < 3; k++) v.draw();
}
type Priv = { anim: ((t: number) => boolean) | null; applyFold(): void };
/** The flight under way flown to its landing. */
function land(v: FanView): void {
  const iv = v as unknown as Priv;
  for (let t = performance.now() + 16; iv.anim; t += 16) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
}
const say = (s: string) => (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(s + '\n');

type Spot = { text: string; run?: [number, number] };
/**
 * A tap's own work at most, in refolds of the tree (each the fold set at a new zoom and a cut of the screen there, timed
 * on the same machine as the taps, so a busy one does not fail it): a handful, its frame's search and its next split's
 * (~50 ms at the mammals on an idle machine); a search over whole-tree cuts took seconds (the wombats from the
 * kangaroos and kin: 12–29 s, ~100 cuts of the whole tree).
 */
const REFOLDS = 16;

describe('a tap lands at once (ToLaD#359): its own work before the flight', () => {
  it('mammals: the wombats from the kangaroos and kin, the marsupials from home, down to the spectral tarsier', { timeout: 300_000 }, async () => {
    await loadMammalsFromFiles();
    const v = stubView();
    const node = (t: string) => v.fan.nodes.find((u) => u.split.taxon === t)!;
    /** The label standing for clade t (its strands and at most a few sisters riding with it). */
    const of = (t: string) => (s: Spot) => {
      const u = node(t);
      const [f, l] = [u.strands[0].index, u.strands[u.strands.length - 1].index];
      return !!s.run && s.run[0] <= f && s.run[1] >= l && s.run[1] - s.run[0] < 2 * (l - f + 1) + 4;
    };
    const tarsier = v.fan.nodes[0].strands.find((b) => b.sp.common === 'Spectral tarsier')!.index;
    // (One refold of the tree and a cut of the screen there, its median over a few zooms: the unit.)
    const V = v as unknown as { labelsAt(cam: typeof v.cam): unknown };
    const home = v.homeCamera();
    const unit = [3, 5, 7, 9, 11]
      .map((k) => {
        const t0 = performance.now();
        V.labelsAt({ ...home, sx: home.sx * Math.pow(2, k + 0.37) });
        return performance.now() - t0;
      })
      .sort((p, q) => p - q)[2];
    say(`taptime: one refold and cut ${unit.toFixed(1)} ms`);
    const bad: string[] = [];
    /** Tap the label `pick` at the view's frame, its own work timed; then its flight flown. */
    const tap = (name: string, pick: (s: Spot) => boolean): boolean => {
      v.camera.settle();
      settle(v);
      const s = v.cutLast!.spots.find(pick);
      if (!s?.run) {
        bad.push(`${name}: no such label among ${v.cutLast!.spots.map((s) => s.text).join(', ')}`);
        return false;
      }
      const t0 = performance.now();
      v.tapItem(...s.run);
      const ms = performance.now() - t0;
      say(`taptime ${name} ("${s.text}", strands ${s.run[0]}-${s.run[1]}): ${ms.toFixed(0)} ms, ${(ms / unit).toFixed(1)} refolds`);
      if (ms > REFOLDS * unit) bad.push(`${name}: ${ms.toFixed(0)} ms, ${(ms / unit).toFixed(1)} refolds`);
      land(v);
      return true;
    };
    // The wombats from the kangaroos and kin (Ita, 2026-11-03: seconds); a marsupials' and a primates' frame from home.
    v.cam = v.cladeCamera(node('Diprotodontia'));
    tap('kangaroos & kin > wombats', of('Vombatidae'));
    v.cam = v.homeCamera();
    tap('home > marsupials', of('Metatheria'));
    // Down to the spectral tarsier from the primates, every tap on the label holding it (its "+1" among them).
    v.cam = v.cladeCamera(node('Primates'));
    for (let k = 0; k < 8 && !(v as unknown as { backing: { lv: { b?: unknown } } | null }).backing?.lv.b; k++)
      if (!tap(`primates, tap ${k + 1} to the spectral tarsier`, (s) => !!s.run && s.run[0] <= tarsier && s.run[1] >= tarsier)) break;
    expect(bad).toEqual([]);
  });
});
