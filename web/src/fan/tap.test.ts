// A species flown to lands on screen (ToLaD#211): in the folded carnivores the fold opens and its anchor moves as the
// camera zooms, so a frame computed before the flight once landed with the species beside the screen. Every one of the
// 325 species (ToLaD#278), flown to from home at both widths (and a sample from zoomed in on the dogs), lands with its column's
// centre at the screen's centre and the column on screen.
import { describe, expect, it } from 'vitest';
import { laneAt, leftAt, type FanBranch, type WidthMode } from './layout';
import { CARNIVORA, type CladeRec } from './panthera';
import { CARNIVORA_TREE, type Split } from './splits';
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

type Inner = { anim: ((t: number) => boolean) | null; applyFold(): void };

/** Run the flight under way to its landing, a frame each 16 ms as the app runs them (the fold at each frame's zoom). */
function run(v: FanView): void {
  const iv = v as unknown as Inner;
  for (let t = performance.now() + 16; iv.anim; t += 16) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
}

/** Fly to b's species (search's pick) from the camera as it is, to the landing. */
function fly(v: FanView, b: FanBranch): void {
  v.flyToSpecies(b.sp);
  run(v);
}

/** The landing as computed: the frame the flight snaps to on landing, the camera settled there (as each frame settles it). */
function land(v: FanView, b: FanBranch): void {
  v.cam = v.speciesCamera(b);
  v.camera.settle();
  (v as unknown as Inner).applyFold();
}

/** Where b's column stands on screen at its tip: [left, centre, right] (px). */
function columnPx(v: FanView, b: FanBranch): [number, number, number] {
  const l = leftAt(b, b.tipY);
  const w = laneAt(b, b.tipY).w;
  return [v.toScreen(l, b.tipY)[0], v.toScreen(l + w / 2, b.tipY)[0], v.toScreen(l + w, b.tipY)[0]];
}

const v = stubView();
const atHome = () => {
  v.cam = v.homeCamera();
  v.camera.settle();
  (v as unknown as Inner).applyFold();
};

describe('a species flown to lands centred on screen (ToLaD#211)', () => {
  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`every species from home, ${mode} widths`, () => {
      v.setMode(mode);
      const off: string[] = [];
      let worst = 0;
      const N = Number(process.env.TAP_N ?? 1e9);
      const t0 = performance.now();
      for (const b of v.fan.branches.slice(0, N)) {
        atHome();
        land(v, b);
        const [l, c, r] = columnPx(v, b);
        worst = Math.max(worst, Math.abs(c - v.w / 2));
        if (Math.abs(c - v.w / 2) > 3 || l < 0 || r > v.w) off.push(`${b.sp.common}: ${l.toFixed(0)}..${r.toFixed(0)} (centre ${c.toFixed(1)})`);
      }
      console.log(`${mode}: ${Math.min(N, v.fan.branches.length)} species in ${(performance.now() - t0).toFixed(0)} ms, worst centre error ${worst.toFixed(2)} px, ${off.length} off`);
      expect(off).toEqual([]);
    });
  }

  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`a sample flown frame by frame, from home and from zoomed in on the dogs (×15), ${mode} widths`, () => {
      v.setMode(mode);
      const off: string[] = [];
      const bs = v.fan.branches.filter((_, i) => i % 23 === 0);
      for (const start of ['home', 'dogs x15']) {
        for (const b of bs) {
          if (start === 'home') atHome();
          else {
            v.cam = v.levelCamera('Canidae', 15)!;
            v.camera.settle();
            (v as unknown as Inner).applyFold();
          }
          fly(v, b);
          const [l, c, r] = columnPx(v, b);
          if (Math.abs(c - v.w / 2) > 3 || l < 0 || r > v.w) off.push(`${start}: ${b.sp.common}: ${l.toFixed(0)}..${r.toFixed(0)} (centre ${c.toFixed(1)})`);
        }
      }
      expect(off).toEqual([]);
    });
  }
});

// The taps themselves (one level deeper, a double-tap one out, ToLaD#258) are levels.test.ts's; #241's and #245's gave way to them.
