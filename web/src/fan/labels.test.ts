// Issue #54: the species' labels changed text and form and jumped as the camera moved.
// One rule now (labelSpots): the same text in the same pill, moving continuously.
import { describe, expect, it } from 'vitest';
import { FanCamera, type Camera } from './camera';
import { columnsAt, laneAt, layoutFan, leftAt, type FanBranch } from './layout';
import { FELIDAE } from './panthera';
import { TwigModel } from './twigs';
import { boxGap, labelSpots, resolveLabels, type LabelSpot } from './view';

const TOP = 52;
/** The buttons' left edge (px). */
const BAR_X0 = 150;
const measure = (t: string) => 7.5 * t.length;

function camera(): FanCamera {
  const fan = layoutFan(FELIDAE, 'linear');
  const models = new Map<FanBranch, TwigModel>();
  const model = (b: FanBranch) => {
    let m = models.get(b);
    if (!m) models.set(b, (m = new TwigModel(b, fan.time, 'linear')));
    return m;
  };
  const c = new FanCamera(fan, model);
  c.w = 390;
  c.h = 844;
  c.cam = c.home();
  return c;
}

/** Zoom by f about screen point (px, py), that point staying put. */
function zoomed(c: FanCamera, cam: Camera, px: number, py: number, f: number): Camera {
  const wx = cam.cx + (px - c.w / 2) / cam.sx;
  const wy = cam.cy + (py - c.h / 2) / cam.sy;
  const sx = cam.sx * f;
  const sy = cam.sy * f;
  return { cx: wx - (px - c.w / 2) / sx, cy: wy - (py - c.h / 2) / sy, sx, sy, ty: sy };
}

const onScreen = (c: FanCamera, s: LabelSpot) => s.fit > 0 && s.box[2] > 0 && s.box[0] < c.w && s.box[3] > 0 && s.box[1] < c.h;

/** Runs the camera through `cams`; checks every spot against the frame before it (moves at most `bound(step)` px). */
function sweep(c: FanCamera, cams: Camera[], bound: number) {
  const first = new Map<string, { text: string; w: number; h: number }>();
  let prev: Map<string, LabelSpot> | null = null;
  let shown = new Map<string, boolean>();
  const flips = new Map<string, number[]>();
  let wasNamed = new Set<string>();
  let worst = 0;
  cams.forEach((cam, k) => {
    c.cam = cam;
    const spots = labelSpots(c, c.fan, TOP, measure, BAR_X0);
    for (const s of spots) {
      const form = { text: s.text, w: s.box[2] - s.box[0], h: s.box[3] - s.box[1] };
      // Same text, same form (pill size), at every camera and in every place.
      const f0 = first.get(s.id) ?? (first.set(s.id, form), form);
      // (An event's label, ToLaD#141, carries its title.)
      expect(form.text).toBe(s.ev !== undefined ? s.b!.sp.history!.events[s.ev].title : s.b ? s.b.sp.common : s.v!.name);
      expect(form.text).toBe(f0.text);
      expect(form.w).toBeCloseTo(f0.w, 6);
      expect(form.h).toBeCloseTo(f0.h, 6);
      const p = prev?.get(s.key);
      if (p && onScreen(c, s) && onScreen(c, p)) {
        const d = Math.max(Math.abs(s.x - p.x), Math.abs(s.y1 - p.y1));
        worst = Math.max(worst, d);
        // Beside a branch a label follows its edge, which can lean (a peel) or widen fast (a boom on the log time axis): faster than the camera.
        expect(d, `${s.key} moved`).toBeLessThanOrEqual(s.place === 'tip' ? bound : 6 * bound);
      }
    }
    const on = resolveLabels(spots, shown);
    // One place per name, and no two shown labels meet.
    const boxes = spots.filter((s) => on.get(s.key));
    expect(new Set(boxes.map((s) => s.id)).size).toBe(boxes.length);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(boxGap(boxes[i].box, boxes[j].box)).toBeGreaterThanOrEqual(-1);
    // Per name (shown anywhere or not): moving from one place to another is a cross-fade, not a blink.
    const named = new Set(spots.filter((q) => on.get(q.key)).map((q) => q.id));
    for (const id of new Set(spots.map((q) => q.id))) if (k > 0 && wasNamed.has(id) !== named.has(id)) flips.set(id, [...(flips.get(id) ?? []), k]);
    wasNamed = named;
    shown = on;
    prev = new Map(spots.map((q) => [q.key, q]));
  });
  // No flicker: a name that turns on or off stays so for a while. A label pushed off for a few frames by
  // a wider one sliding past (beside a booming column it moves faster than the camera) is the one
  // exception, and it is rare; none blinks twice. (Four in the width-alone sweep on the lion since the
  // Felidae data lost its 28 unrecognised tips, ToLaD#116: jaguarundi, kodkod, margay, golden cat, 3 frames each.)
  let short = 0;
  for (const [key, ks] of flips) {
    let mine = 0;
    for (let i = 1; i < ks.length; i++) if (ks[i] - ks[i - 1] <= 5) mine++;
    expect(mine, `${key} blinks at ${ks}`).toBeLessThanOrEqual(1);
    short += mine;
  }
  expect(short, [...flips].map(([k, v]) => `${k}:${v}`).join(' ')).toBeLessThanOrEqual(4);
  return worst;
}

describe('species labels (#54)', () => {
  it('pan down from home past "now": same text and form, continuous motion', () => {
    const c = camera();
    const h = c.home();
    for (const z of [1, 2.2]) {
      const cams: Camera[] = [];
      // 2 px a step, from "now" low on the screen to it far above the top.
      for (let k = 0; k < 700; k++) cams.push({ ...h, sx: h.sx * z, sy: h.sy * z, ty: h.sy * z, cy: h.cy - 300 / (h.sy * z) + (2 * k) / (h.sy * z) });
      expect(sweep(c, cams, 2.01)).toBeGreaterThan(0.5);
    }
  });

  it('pan across: labels slide along their columns without jumps', () => {
    const c = camera();
    const h = c.home();
    const z = 6;
    const cams: Camera[] = [];
    for (let k = 0; k < 600; k++) cams.push({ ...h, sx: h.sx * z, sy: h.sy * z, ty: h.sy * z, cx: h.cx - 600 / (h.sx * z) + (2 * k) / (h.sx * z), cy: h.cy + 200 / (h.sy * z) });
    sweep(c, cams, 2.01);
  });

  it('zoom in on the lion, from home to its individuals', () => {
    const c = camera();
    const lion = c.fan.branches.find((b) => b.sp.common === 'Lion')!;
    let cam = c.home();
    c.cam = cam;
    const y = c.fan.time.y(300 / 1e6);
    // Into its lane at that time, not its column: since ToLaD#143 the deep past is scaled to the 1950 level
    // (x12), so the column (its widest, ~50 kya) is ~4x the lane 300 years ago, and 0.3 of the column missed it.
    const [px, py] = c.toScreen(leftAt(lion, y) + 0.3 * laneAt(lion, y).w, y);
    const f = 1.02;
    const cams: Camera[] = [];
    while (cam.sx < c.home().sx * 3e4) {
      cams.push(cam);
      cam = zoomed(c, cam, px, py, f);
    }
    expect(cams.length).toBeGreaterThan(300);
    // A point on screen moves (f − 1) × its distance from the zoom's centre.
    const worst = sweep(c, cams, (f - 1) * Math.hypot(c.w, c.h) + 1);
    expect(worst).toBeGreaterThan(0);
    // The lion's label stays on screen all the way in.
    c.cam = cams[cams.length - 1];
    const s = labelSpots(c, c.fan, TOP, measure, BAR_X0).find((q) => q.b === lion && q.fit > 0)!;
    expect(onScreen(c, s)).toBe(true);
    expect(s.box[1]).toBeGreaterThanOrEqual(TOP - 0.01);
  });
});

describe('labels when width and time zoom separately (#138)', () => {
  /** Zoom width by fx and time by ft about screen point (px, py), that point staying put. */
  const zoomedAxes = (c: FanCamera, cam: Camera, px: number, py: number, fx: number, ft: number): Camera => {
    const wx = cam.cx + (px - c.w / 2) / cam.sx;
    const wy = cam.cy + (py - c.h / 2) / cam.sy;
    const sx = cam.sx * fx;
    const sy = cam.sy * ft;
    return { cx: wx - (px - c.w / 2) / sx, cy: wy - (py - c.h / 2) / sy, sx, sy, ty: sy };
  };
  for (const [name, fx, ft] of [
    ['width alone', 1.02, 1],
    ['time alone', 1, 1.02],
  ] as const) {
    it(`${name}, on the lion from home: labels move continuously and keep clear of each other`, () => {
      const c = camera();
      const lion = c.fan.branches.find((b) => b.sp.common === 'Lion')!;
      let cam = c.home();
      c.cam = cam;
      const [px, py] = c.toScreen(lion.colLeft + 0.3 * lion.width, c.fan.time.y(300 / 1e6));
      const cams: Camera[] = [];
      for (let k = 0; k < 250; k++) {
        cams.push(cam);
        cam = zoomedAxes(c, cam, px, py, fx, ft);
      }
      sweep(c, cams, 0.02 * Math.hypot(c.w, c.h) + 1);
      c.cam = cams[cams.length - 1];
      const spots = labelSpots(c, c.fan, TOP, measure, BAR_X0);
      for (const q of spots) expect(q.box.every(Number.isFinite)).toBe(true);
      if (fx === 1) return; // time alone at home width: the columns stay too close for a label beside them
      // Width alone: the lion's label is still placed, on screen, below the buttons.
      const s = spots.find((q) => q.b === lion && q.fit > 0)!;
      expect(s && onScreen(c, s)).toBe(true);
      expect(s.box[1]).toBeGreaterThanOrEqual(TOP - 0.01);
    });
  }
});

describe('labels on "now", else beside their branch (#97)', () => {
  it('at home: every label shown stands on the "now" line, at its column; no lineages', () => {
    const c = camera();
    const nowS = c.toScreen(0, c.yNow)[1];
    const spots = labelSpots(c, c.fan, TOP, measure, BAR_X0);
    const on = resolveLabels(spots, new Map());
    const shown = spots.filter((s) => on.get(s.key));
    // (Packed close (#99): the linear home is the domestic cat beside a narrow bundle of the wild cats.)
    expect(shown.length).toBeGreaterThanOrEqual(2);
    for (const s of shown) {
      expect(s.place).toBe('tip');
      expect(s.b).toBeDefined();
      expect(s.y1).toBeGreaterThanOrEqual(nowS - 4 - 1e-6);
      expect(s.box[1]).toBeGreaterThanOrEqual(6 - 1e-6);
    }
  });

  it('in the deep past: labels beside their branches, clear of every column', () => {
    const c = camera();
    const h = c.home();
    let n = 0;
    for (const z of [3, 8]) {
      for (const ago of [6, 10.5]) {
        // (Centred on the columns there: packed close (#99), the wild cats are a narrow bundle off the home centre.)
        const cs = columnsAt(c.fan, c.fan.time.y(ago));
        const cx = (Math.min(...cs.map((q) => q[0])) + Math.max(...cs.map((q) => q[1]))) / 2;
        c.cam = { ...h, sx: h.sx * z, sy: h.sy * z, ty: h.sy * z, cx, cy: c.fan.time.y(ago) };
        const spots = labelSpots(c, c.fan, TOP, measure, BAR_X0);
        const on = resolveLabels(spots, new Map());
        for (const s of spots.filter((q) => on.get(q.key))) {
          expect(s.place).not.toBe('tip');
          if (s.place === 'in') continue;
          n++;
          // Its own column too: the pill is LABEL_GAP past its widest reach along the pill.
          for (let y = s.box[1]; y <= s.box[3]; y += 2) {
            for (const [a, b] of columnsAt(c.fan, c.toWorld(0, y)[1])) {
              const xa = c.toScreen(a, 0)[0];
              const xb = c.toScreen(b, 0)[0];
              expect(Math.max(xa - s.box[2], s.box[0] - xb), `${s.key} at y ${y.toFixed(0)}`).toBeGreaterThanOrEqual(-1.5);
            }
          }
        }
      }
    }
    expect(n).toBeGreaterThan(2);
  });
});
