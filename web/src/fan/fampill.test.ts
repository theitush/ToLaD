// ToLaD#212: a family with one species pill shown (the rest hidden) shows its family's pill there instead: the family's
// plain name, its commonest living species' picture, and a "+x" for the family's species hidden. Counted with the cull
// (familyPills), the pill laid out for it the next frame, as the "+x" badges are (plus.test.ts).
import { describe, expect, it } from 'vitest';
import { FanCamera, type Camera } from './camera';
import { Steady } from './steady';
import { layoutFan, type Fan, type FanBranch, type FanNode, type WidthMode } from './layout';
import { CARNIVORA, FELIDAE } from './panthera';
import { CARNIVORA_TREE, familyLabel, FELIDAE_TREE } from './splits';
import { TwigModel } from './twigs';
import { boxGap, commonest, families, familyOf, familyPills, labelSpots, plusGroups, resolveLabels, type LabelSpot } from './view';

const TOP = 52;
const BAR_X0 = 150;
const measure = (t: string) => 7.5 * t.length;
const plusPx = (n: number) => (n ? 6 * `+${n}`.length + 6 : 0);

function fanOf(level: 'cats' | 'carnivores', mode: WidthMode): Fan {
  const fan = level === 'cats' ? layoutFan(FELIDAE, mode, FELIDAE_TREE) : layoutFan(CARNIVORA, mode, CARNIVORA_TREE);
  if (level === 'carnivores') {
    const f = new Steady(fan);
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

/** Frames as drawLabels runs them: each laid out with the badges' room and the family pills of the one before. */
function settled(c: FanCamera, named: boolean) {
  let prev = new Map<string, boolean>();
  let plusN = new Map<string, number>();
  let fams = new Map<string, FanNode>();
  let res!: { spots: LabelSpot[]; on: Map<string, boolean>; groups: Map<string, FanBranch[]> };
  for (let k = 0; k < 6; k++) {
    const f = fams;
    const spots = labelSpots(c, c.fan, TOP, measure, BAR_X0, { named: () => named }, (id) => plusPx(plusN.get(id) ?? 0), (id) => f.get(id));
    const on = resolveLabels(spots, prev);
    const groups = plusGroups(spots, on, c.fan);
    res = { spots, on, groups };
    fams = familyPills(c.fan, spots, on);
    prev = on;
    plusN = new Map();
    for (const s of spots) if (groups.has(s.key)) plusN.set(s.id, groups.get(s.key)!.length);
  }
  return res;
}

function check(c: FanCamera, named: boolean) {
  const r = settled(c, named);
  const shown = r.spots.filter((s) => r.on.get(s.key));
  const shownIds = new Set(shown.map((s) => s.id));
  // A family's shown species (any spot of theirs).
  const per = new Map<FanNode, Set<string>>();
  for (const s of shown) {
    const v = s.b && s.ev === undefined ? familyOf(c.fan, s.b) : undefined;
    if (!v) continue;
    if (!per.has(v)) per.set(v, new Set());
    per.get(v)!.add(s.id);
  }
  // Every species pill shown standing for its family: the family's name and its commonest living species' picture,
  // and that family has it as its one species shown; a family with two or more shown shows them as themselves.
  let famTips = 0;
  for (const s of shown) {
    if (s.place !== 'tip' || !s.fam) continue;
    famTips++;
    expect(s.text).toBe(familyLabel(s.fam.split));
    expect(s.pic).toBe(commonest(s.fam));
    expect(per.get(s.fam)?.size).toBe(1);
  }
  for (const [v, ids] of per) {
    if (ids.size < 2) continue;
    for (const s of shown) if (s.b && familyOf(c.fan, s.b) === v) expect(s.fam).toBeUndefined();
  }
  // The badges still add up to the species hidden, each once.
  const hid = new Set(r.spots.filter((s) => s.place === 'tip' && s.b && s.ev === undefined && s.fit > 0 && !shownIds.has(s.id)).map((s) => s.id));
  const counted = [...r.groups.values()].flat().map((b) => String(b.sp.gid));
  expect(counted.length).toBe(hid.size);
  expect(new Set(counted)).toEqual(hid);
  // A family pill's "+x" counts its own family's hidden.
  for (const s of shown) {
    if (!s.fam) continue;
    for (const b of r.groups.get(s.key) ?? []) expect(familyOf(c.fan, b)).toBe(s.fam);
  }
  // No two pills meet.
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(boxGap(shown[i].box, shown[j].box)).toBeGreaterThanOrEqual(-1);
  return { ...r, famTips, hid };
}

const zoomAbout = (c: FanCamera, cam: Camera, px: number, f: number): Camera => {
  const wx = cam.cx + (px - c.w / 2) / cam.sx;
  return { ...cam, sx: cam.sx * f, cx: wx - (px - c.w / 2) / (cam.sx * f) };
};

describe('a family with one species shown: its family pill (ToLaD#212)', () => {
  it("each family's picture is its commonest living species, by the individuals alive today", () => {
    const fan = fanOf('carnivores', 'log');
    const fams = families(fan);
    expect(fams.length).toBeGreaterThan(5);
    for (const { v } of fams) {
      const b = commonest(v);
      expect(b, familyLabel(v.split)!).not.toBeNull();
      expect(b!.sp.extinct).toBe(false);
      for (const o of v.strands) if (!o.sp.extinct) expect(o.pop.aliveAt(0)).toBeLessThanOrEqual(b!.pop.aliveAt(0));
    }
    // From the data, not a list: the dog the commonest of the dogs, the cat of the cats.
    const by = (name: string) => commonest(fams.find((f) => familyLabel(f.v.split) === name)!.v)!.sp.common;
    expect(by('Dogs')).toMatch(/dog/i);
    expect(by('Cats')).toMatch(/cat/i);
  });

  for (const [level, mode, named] of [['carnivores', 'log', true], ['carnivores', 'linear', false], ['cats', 'log', true]] as const) {
    it(`one shown → the family's pill; two or more → themselves; badges add up; no overlaps: ${level}, ${mode}`, () => {
      const c = cameraOf(fanOf(level, mode));
      const h = c.cam;
      let n = check(c, named).famTips;
      for (const f of [1.5, 3, 8]) {
        for (const px of [120, 250, 360]) {
          c.cam = zoomAbout(c, h, px, f);
          c.settle();
          n += check(c, named).famTips;
        }
      }
      // The carnivores' families do it somewhere; the cats are one family (the root's, named by the clade).
      if (level === 'carnivores') expect(n).toBeGreaterThan(0);
    });
  }

  it('the rule on hand-made pills: one shown with its family hidden → swapped; none hidden → itself', () => {
    const fan = fanOf('carnivores', 'log');
    const { v } = families(fan).find((f) => f.v.strands.filter((b) => !b.sp.extinct).length >= 3)!;
    const [a, b, d] = v.strands.filter((x) => !x.sp.extinct);
    const spot = (x: FanBranch, at: number): LabelSpot => ({ key: `${x.sp.gid}:tip`, id: String(x.sp.gid), place: 'tip', b: x, text: x.sp.common, rank: [0, x.width, x.index], x: at, y1: 200, box: [at - 11, 150, at + 11, 200], fit: 1 });
    const sa = spot(a, 100);
    const sb = spot(b, 110);
    const sd = spot(d, 300);
    let on = resolveLabels([sa, sb], new Map());
    expect(on.get(sb.key)).toBe(false);
    expect(familyPills(fan, [sa, sb], on).get(sa.id)).toBe(v);
    on = resolveLabels([sa, sd], new Map());
    expect(familyPills(fan, [sa, sd], on).size).toBe(0);
  });
});
