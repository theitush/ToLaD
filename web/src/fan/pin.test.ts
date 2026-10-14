// The groups the view is inside stay pinned at the top of the screen (ToLaD#233): zoomed deep into a species' past
// ("now" and the brackets' stack off the top), the pinned rows name its genus, family and order (every ranked clade it
// sits in whose time reaches the screen), the order on top; tapping each flies to that group, and tapped again there,
// one level out. Folded (carnivores) and unfolded (the cats). At home nothing is pinned (the stack itself shows).
import { describe, expect, it } from 'vitest';
import { laneAt, leftAt, type FanBranch, type FanNode } from './layout';
import { latinOf, rankOf, type Brackets } from './brackets';
import { CARNIVORA, FELIDAE, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, type Split } from './splits';
import { familiar, FanView, isLevel } from './view';

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

type Inner = { anim: ((t: number) => boolean) | null; applyFold(): void; brackets: Brackets | null; tapAt: { v: FanNode | null } | null };

function run(v: FanView): void {
  const iv = v as unknown as Inner;
  for (let t = performance.now() + 16; iv.anim; t += 16) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
}

const settle = (v: FanView) => {
  v.camera.settle();
  (v as unknown as Inner).applyFold();
  for (let k = 0; k < 3; k++) v.draw();
};

/** The ranked clades b sits in, innermost first (genus … order). */
function ranked(b: FanBranch): FanNode[] {
  const out: FanNode[] = [];
  for (let u: FanNode | null = b.node; u; u = u.parent) if (rankOf(latinOf(u.split))) out.push(u);
  return out;
}

/**
 * Deep into b's past: its column centred, the screen spanning a fifth of its genus' time, centred halfway down it
 * ("now" well off the top).
 */
function intoPast(v: FanView, b: FanBranch): void {
  const genus = ranked(b)[0];
  const now = v.fan.time.y(0);
  const y = now + 0.5 * (genus.yBot - now);
  v.cam = v.speciesCamera(b);
  settle(v);
  const sy = v.h / (0.2 * (genus.yBot - now));
  for (let k = 0; k < 4; k++) {
    const cx = leftAt(b, y) + laneAt(b, y).w / 2;
    v.cam = { ...v.cam, cx, cy: y, sy, ty: sy };
    settle(v);
  }
}

const near = (v: FanView, c: { cx: number; cy: number; sx: number; sy: number }) =>
  Math.abs(v.cam.cx - c.cx) * v.cam.sx < 2 && Math.abs(v.cam.cy - c.cy) * v.cam.sy < 2 && Math.abs(Math.log(v.cam.sx / c.sx)) < 0.01;

describe('the groups the view is inside stay pinned at the top (ToLaD#233)', () => {
  for (const [name, mk, picks] of [
    ['carnivores (folded)', () => stubView(), [/brown bear/i, /least weasel|stoat|weasel/i, /grey wolf|gray wolf/i, /^lion$/i, /sea lion/i]],
    ['cats', () => stubView(FELIDAE, FELIDAE_TREE, false), [/^lion$/i, /ocelot/i, /lynx/i]],
  ] as const) {
    it(name, () => {
      const v = mk();
      const br = (v as unknown as Inner).brackets!;
      v.cam = v.homeCamera();
      settle(v);
      expect(br.pins).toEqual([]);
      const log: string[] = [];
      let taps = 0;
      for (const re of picks) {
        const b = v.fan.branches.find((q) => re.test(q.sp.common ?? ''));
        if (!b) {
          log.push(`no species ${re}`);
          continue;
        }
        intoPast(v, b);
        // (The familiar levels only, the innermost three, ToLaD#288.)
        const want = ranked(b).reverse().filter((u) => isLevel(v.fan, u) && familiar(u)).slice(-3).map((u) => latinOf(u.split));
        const got = br.pins.map((p) => br.list[p.i].latin);
        console.log(`${name}: ${b.sp.common} → ${got.join(' › ')}`);
        if (got.join() !== want.join()) log.push(`${b.sp.common}: pinned ${got.join(' › ')}, not ${want.join(' › ')}`);
        expect(br.pinA).toBe(1);
        // Each pinned group, tapped on its label: flies to it (tapped again there, one level out: the test below).
        for (const p of [...br.pins]) {
          intoPast(v, b);
          const q = br.list[p.i];
          const at = br.pins.find((u) => u.i === p.i)!;
          v.tap(at.lx, br.pinY(at.row));
          run(v);
          settle(v);
          taps++;
          if (!near(v, v.cladeCamera(q.v))) log.push(`${b.sp.common}: pinned ${q.latin} tapped, not at its frame`);
          if ((v as unknown as Inner).tapAt?.v !== q.v) log.push(`${b.sp.common}: pinned ${q.latin} tapped, not remembered`);
        }
      }
      expect(log).toEqual([]);
      expect(taps).toBeGreaterThan(5);
    });
  }

  it('a pinned group tapped again once there goes one level out', () => {
    const v = stubView();
    const br = (v as unknown as Inner).brackets!;
    const b = v.fan.branches.find((q) => /brown bear/i.test(q.sp.common ?? ''))!;
    intoPast(v, b);
    const genus = ranked(b)[0];
    const at = br.pins.find((u) => br.list[u.i].v === genus)!;
    v.tap(at.lx, br.pinY(at.row));
    run(v);
    settle(v);
    expect(near(v, v.cladeCamera(genus))).toBe(true);
    // There "now" is on screen: the stack itself shows, nothing pinned; its bracket tapped again climbs (ToLaD#230).
    expect(br.pins.length).toBe(0);
    v.tapClade(genus);
    run(v);
    settle(v);
    expect(near(v, v.cladeCamera(v.outOf(genus)!))).toBe(true);
  });
  it('scrolled down into time the stack hands over to the pinned rows cleanly: never both at once', () => {
    const v = stubView();
    const br = (v as unknown as Inner).brackets!;
    v.cam = v.homeCamera();
    settle(v);
    const both: string[] = [];
    let stack = 0;
    let pinned = 0;
    // Two px of scroll a frame, from home until the pins have shown for a while (one draw a frame, as when dragged).
    for (let k = 0; k < 400 && pinned < 20; k++) {
      v.cam = { ...v.cam, cy: v.cam.cy + 2 / v.cam.sy };
      v.camera.settle();
      (v as unknown as Inner).applyFold();
      v.draw();
      if (br.fit > 0 && br.placed.length) stack++;
      if (br.pinA > 0 && br.pins.length) pinned++;
      if (br.fit > 0 && br.placed.length && br.pinA > 0 && br.pins.length) both.push(`frame ${k}: stack ${br.fit}, pins ${br.pinA}`);
      expect([0, 1]).toContain(br.fit);
    }
    expect(both).toEqual([]);
    expect(stack).toBeGreaterThan(0);
    expect(pinned).toBeGreaterThan(0);
  });
});
