// Issue #54: the species' labels changed text and form and jumped as the camera moved.
// One rule now (labelSpots): the same text in the same pill, moving continuously.
import { describe, expect, it } from 'vitest';
import { FanCamera, type Camera } from './camera';
import { layoutFan, leftAt, type FanBranch } from './layout';
import { PANTHERA } from './panthera';
import { TwigModel } from './twigs';
import { labelSpots, resolveLabels, type LabelSpot } from './view';

const TOP = 52;
const measure = (t: string) => 7.5 * t.length;

function camera(): FanCamera {
  const fan = layoutFan(PANTHERA, 'linear');
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

/** Runs the camera through `cams`; checks every label against the frame before it (moves at most `bound(step)` px). */
function sweep(c: FanCamera, cams: Camera[], bound: number) {
  const first = new Map<number, { text: string; w: number; h: number }>();
  let prev: LabelSpot[] | null = null;
  let shown = new Map<number, boolean>();
  const flips = new Map<number, number[]>();
  let worst = 0;
  cams.forEach((cam, k) => {
    c.cam = cam;
    const spots = labelSpots(c, c.fan, TOP, measure);
    for (const s of spots) {
      const gid = s.b.sp.gid;
      const form = { text: s.text, w: s.box[2] - s.box[0], h: s.box[3] - s.box[1] };
      // Same text, same form (pill size), at every camera.
      const f0 = first.get(gid) ?? (first.set(gid, form), form);
      expect(form.text).toBe(s.b.sp.common);
      expect(form.text).toBe(f0.text);
      expect(form.w).toBeCloseTo(f0.w, 6);
      expect(form.h).toBeCloseTo(f0.h, 6);
      const p = prev?.find((q) => q.b === s.b);
      if (p && onScreen(c, s) && onScreen(c, p)) {
        const d = Math.max(Math.abs(s.x - p.x), Math.abs(s.y1 - p.y1));
        worst = Math.max(worst, d);
        expect(d).toBeLessThanOrEqual(bound);
        // The fades are over 22–30 px of motion (the axis, the legend) or a few px of column width.
        expect(Math.abs(s.fit - p.fit)).toBeLessThanOrEqual(bound / 20 + 0.02);
      }
    }
    const on = resolveLabels(spots, shown);
    for (const [gid, v] of on) if (shown.has(gid) && shown.get(gid) !== v) flips.set(gid, [...(flips.get(gid) ?? []), k]);
    shown = on;
    prev = spots;
  });
  // No blinking: a label that turns on or off stays so for a while.
  // (In the gapless band neighbouring labels sit closer: a label may yield and return after 3 frames; see the report.)
  for (const ks of flips.values()) for (let i = 1; i < ks.length; i++) expect(ks[i] - ks[i - 1]).toBeGreaterThan(2);
  return worst;
}

describe('species labels (#54)', () => {
  it('pan down from home past "now": same text and form, continuous motion', () => {
    const c = camera();
    const h = c.home();
    for (const z of [1, 2.2]) {
      const cams: Camera[] = [];
      // 2 px a step, from "now" low on the screen to it far above the top. (A label pinned under the top
      // line slides along its column's slanting edge as the time under it changes: a little more than the pan.)
      for (let k = 0; k < 700; k++) cams.push({ ...h, sx: h.sx * z, sy: h.sy * z, ty: h.sy * z, cy: h.cy - 300 / (h.sy * z) + (2 * k) / (h.sy * z) });
      expect(sweep(c, cams, 6.01)).toBeGreaterThan(0.5);
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
    const [px, py] = c.toScreen(leftAt(lion, y) + 0.3 * lion.width, y);
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
    const s = labelSpots(c, c.fan, TOP, measure).find((q) => q.b === lion)!;
    expect(onScreen(c, s)).toBe(true);
    expect(s.box[1]).toBeGreaterThanOrEqual(TOP - 0.01);
  });
});
