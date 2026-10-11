// Issue #54: the species' labels changed text and form and jumped as the camera moved.
// One rule now (labelSpots): the same text in the same pill, moving continuously.
import { describe, expect, it } from 'vitest';
import { FanCamera, type Camera } from './camera';
import { layoutFan, type FanBranch } from './layout';
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
  let prev: LabelSpot[] | null = null;
  let shown = new Map<string, boolean>();
  const flips = new Map<string, number[]>();
  let worst = 0;
  cams.forEach((cam, k) => {
    c.cam = cam;
    const spots = labelSpots(c, c.fan, TOP, measure, BAR_X0);
    for (const s of spots) {
      const form = { text: s.text, w: s.box[2] - s.box[0], h: s.box[3] - s.box[1] };
      // Same text, same form (pill size), at every camera and in every place.
      const f0 = first.get(s.id) ?? (first.set(s.id, form), form);
      expect(form.text).toBe(s.b ? s.b.sp.common : s.v!.name);
      expect(form.text).toBe(f0.text);
      expect(form.w).toBeCloseTo(f0.w, 6);
      expect(form.h).toBeCloseTo(f0.h, 6);
      const p = prev?.find((q) => q.key === s.key);
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
    for (const [key, v] of on) if (shown.has(key) && shown.get(key) !== v) flips.set(key, [...(flips.get(key) ?? []), k]);
    shown = on;
    prev = spots;
  });
  // No blinking: a label that turns on or off stays so for a while.
  for (const [key, ks] of flips) for (let i = 1; i < ks.length; i++) expect(ks[i] - ks[i - 1], `${key} blinks at ${ks[i]}`).toBeGreaterThan(5);
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
    const [px, py] = c.toScreen(lion.colLeft + 0.3 * lion.width, y);
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
