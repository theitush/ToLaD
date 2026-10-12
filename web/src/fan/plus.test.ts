// ToLaD#197: a pill's "+x" for the pills its neighbours hid. Counted with the cull (plusGroups), each hidden species
// once on the shown pill nearest it; the pill keeps room for it at its top end (labelSpots' `plus`), so it overlaps nothing.
import { describe, expect, it } from 'vitest';
import { cladeCamera } from './brackets';
import { FanCamera, type Camera } from './camera';
import { Fold } from './fold';
import { layoutFan, type Fan, type FanBranch, type FanNode, type WidthMode } from './layout';
import { CARNIVORA, FELIDAE } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE } from './splits';
import { TwigModel } from './twigs';
import { boxGap, labelSpots, plusGroups, resolveLabels, spanOf, type LabelSpot } from './view';

const TOP = 52;
const BAR_X0 = 150;
const measure = (t: string) => 7.5 * t.length;
const plusPx = (n: number) => (n ? 6 * `+${n}`.length + 6 : 0);

function fanOf(level: 'cats' | 'carnivores', mode: WidthMode): Fan {
  const fan = level === 'cats' ? layoutFan(FELIDAE, mode, FELIDAE_TREE) : layoutFan(CARNIVORA, mode, CARNIVORA_TREE);
  if (level === 'carnivores') {
    const f = new Fold(fan);
    f.setAll(0);
    fan.tess.fold = f;
  }
  return fan;
}
function cameraOf(fan: Fan): FanCamera {
  const models = new Map<FanBranch, TwigModel>();
  const c = new FanCamera(fan, (b) => {
    let m = models.get(b);
    if (!m) models.set(b, (m = new TwigModel(b, fan.time, fan.mode)));
    return m;
  });
  c.w = 390;
  c.h = 844;
  c.cam = c.home();
  c.settle();
  return c;
}

/** A few frames at the camera as drawLabels runs them (each frame's pills keeping room for the counts of the one before). */
/** The families named on the brackets (as the app has them, ToLaD#193), or none (each on "now" over its species). */
let named = true;
function settled(c: FanCamera) {
  let prev = new Map<string, boolean>();
  let plusN = new Map<string, number>();
  let res!: { spots: LabelSpot[]; on: Map<string, boolean>; groups: Map<string, FanBranch[]> };
  for (let k = 0; k < 4; k++) {
    const spots = labelSpots(c, c.fan, TOP, measure, BAR_X0, { named: () => named }, (id) => plusPx(plusN.get(id) ?? 0));
    const on = resolveLabels(spots, prev);
    const groups = plusGroups(spots, on);
    res = { spots, on, groups };
    prev = on;
    plusN = new Map();
    for (const s of spots) if (groups.has(s.key)) plusN.set(s.id, groups.get(s.key)!.length);
  }
  return res;
}

/** The species hidden in view: a tip spot there, no spot of theirs shown. */
function hidden({ spots, on }: { spots: LabelSpot[]; on: Map<string, boolean> }): Set<string> {
  const shown = new Set(spots.filter((s) => on.get(s.key)).map((s) => s.id));
  return new Set(spots.filter((s) => s.place === 'tip' && s.b && s.ev === undefined && s.fit > 0 && !shown.has(s.id)).map((s) => s.id));
}

function check(c: FanCamera) {
  const r = settled(c);
  const hid = hidden(r);
  const counted = [...r.groups.values()].flat().map((b) => String(b.sp.gid));
  // Each hidden species once, so the badges add up to the number hidden.
  expect(counted.length).toBe(hid.size);
  expect(new Set(counted)).toEqual(hid);
  // On shown species' tip pills, each with room kept for its badge, and the pills (badges in them) never meeting.
  const shown = r.spots.filter((s) => r.on.get(s.key));
  for (const [key, g] of r.groups) {
    const s = shown.find((q) => q.key === key)!;
    expect(['tip', 'fam']).toContain(s.place);
    expect(s.plus ?? 0).toBeGreaterThanOrEqual(plusPx(g.length));
  }
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(boxGap(shown[i].box, shown[j].box)).toBeGreaterThanOrEqual(-1);
  return { ...r, hid };
}

const zoomAbout = (c: FanCamera, cam: Camera, px: number, f: number): Camera => {
  const wx = cam.cx + (px - c.w / 2) / cam.sx;
  return { ...cam, sx: cam.sx * f, cx: wx - (px - c.w / 2) / (cam.sx * f) };
};

describe('the "+x" badges (ToLaD#197)', () => {
  for (const [level, mode] of [['cats', 'linear'], ['cats', 'log'], ['carnivores', 'linear'], ['carnivores', 'log']] as const) {
    it(`add up to the species hidden, on pills that keep room for them: ${level}, ${mode}`, () => {
      named = mode === 'linear';
      const c = cameraOf(fanOf(level, mode));
      const h = c.cam;
      const home = check(c);
      // At home some pills are hidden (hundreds of carnivores in 390 px).
      expect(home.hid.size).toBeGreaterThan(0);
      for (const f of [1.5, 3, 8]) {
        for (const px of [120, 250, 360]) {
          c.cam = zoomAbout(c, h, px, f);
          c.settle();
          check(c);
        }
      }
    });
  }

  it('none when nothing is hidden', () => {
    const a = { key: 'a:tip', id: 'a', place: 'tip', text: 'A', rank: [0, 1, 0], x: 100, y1: 200, box: [89, 150, 111, 200], fit: 1, b: {} } as unknown as LabelSpot;
    const b = { ...a, key: 'b:tip', id: 'b', x: 200, box: [189, 150, 211, 200] } as LabelSpot;
    const on = resolveLabels([a, b], new Map());
    expect(on.get('a:tip') && on.get('b:tip')).toBe(true);
    expect(plusGroups([a, b], on).size).toBe(0);
    // And with one hidden: on the nearer pill.
    const h = { ...a, key: 'h:tip', id: 'h', x: 120, box: [109, 150, 131, 200] } as LabelSpot;
    const on2 = resolveLabels([a, b, h], new Map());
    expect(on2.get('h:tip')).toBe(false);
    const g = plusGroups([a, b, h], on2);
    expect([...g.keys()]).toEqual(['a:tip']);
    // Zoomed far into a few columns: every pill there shows, and no badge.
    const c = cameraOf(fanOf('cats', 'linear'));
    c.cam = zoomAbout(c, c.cam, 300, 40);
    c.settle();
    const r = check(c);
    if (r.hid.size === 0) expect(r.groups.size).toBe(0);
  });

  // From home and zoomed in, every badge: the tapped pill's species and those it stood for framed (from "now" down to the
  // split where they meet). A few all show; many (more than 390 px has room for) open to several, each with its own "+x".
  it('a tap on one frames the species it stands for, and their pills show', () => {
    named = true;
    for (const level of ['cats', 'carnivores'] as const) {
      const fan = fanOf(level, 'linear');
      const c = cameraOf(fan);
      let n = 0;
      for (const z of [1, 3, 8]) {
        const at = zoomAbout(c, c.home(), 250, z);
        c.cam = at;
        c.settle();
        const r = settled(c);
        for (const [key, g] of r.groups) {
          const own = r.spots.find((s) => s.key === key)!.b ?? g[0];
          const bs = [...new Set([own, ...g])];
          let v: FanNode | null = own.node;
          while (v?.parent && !bs.every((b) => v!.strands.includes(b))) v = v.parent;
          c.cam = cladeCamera(c, fan, { ...v!, yBot: v!.y }, () => spanOf(bs));
          c.settle();
          const after = check(c);
          const shown = new Set(after.spots.filter((s) => after.on.get(s.key)).map((s) => s.id));
          const got = bs.filter((b) => shown.has(String(b.sp.gid))).length;
          expect(got, `${level} ×${z} ${own.sp.common}: ${got} of ${bs.length}`).toBeGreaterThanOrEqual(Math.min(bs.length, 4));
          if (bs.length <= 6) expect(got, `${level} ×${z} ${own.sp.common}`).toBe(bs.length);
          n++;
          c.cam = at;
          c.settle();
        }
      }
      expect(n).toBeGreaterThan(0);
    }
  });
});
