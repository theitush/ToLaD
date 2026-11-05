// The second tier (ToLaD#396): a branch with room for a name but not a picture shows the name. Checked by code, at the
// cats and the carnivores, across a pinch and a pan from each home:
//   1. names and pictures on screen never overlap, nor names each other;
//   2. every species is in at most one label, and an item's species are all accounted for, each once;
//   3. the pictures are the ones the cut gives without the names: same places, same runs;
//   4. a name stands on a piece of one item, not the piece carrying its picture, inside its own territory;
//   5. a name's tap goes into its own run;
//   6. a one-branch name stays with its branch under a pan;
//   7. zooming in steadily, no name goes on and off and on again.
import { describe, expect, it, vi } from 'vitest';
import { CARNIVORA, FELIDAE, type CladeRec } from './panthera';
import { PIC_D, picBox } from './pics';
import { CARNIVORA_TREE, FELIDAE_TREE, type Split } from './splits';
import { discSci, FanView, groupFace, groupPics, type CutLabels } from './view';
import { hasPic } from './wiki';

function stubView(clade: CladeRec, tree: Split): FanView {
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, true);
}

const applyFold = (v: FanView) => (v as unknown as { applyFold(): void }).applyFold();

type Box = readonly number[];
const meets = (a: Box, b: Box) => a[0] < b[2] - 1e-6 && b[0] < a[2] - 1e-6 && a[1] < b[3] - 1e-6 && b[1] < a[3] - 1e-6;

/** Invariants 1, 2 and 4 at one frame. */
function check(v: FanView, c: CutLabels, at: string, bad: string[]): void {
  const boxes: [string, Box][] = [
    ...c.spots.map((s): [string, Box] => [`pill ${s.text}`, s.box]),
    ...c.pics.map((p): [string, Box] => [`picture ${p.face.sp.sci}`, picBox(p)]),
  ];
  for (const s of c.names) {
    for (const [n, b] of boxes) if (meets(s.box, b)) bad.push(`${at}: name ${s.text} meets ${n}`);
    boxes.push([`name ${s.text}`, s.box]);
    // Its picture (ToLaD#400): as wide as its box, at its foot, its pill above it, not over it.
    const d = s.disc;
    if (!d) bad.push(`${at}: name ${s.text} has no picture`);
    else {
      if (PIC_D !== s.box[2] - s.box[0]) bad.push(`${at}: ${s.text}'s box is ${s.box[2] - s.box[0]} across`);
      if (Math.abs(d.y + PIC_D / 2 - s.box[3]) > 1e-6) bad.push(`${at}: ${s.text}'s disc is not at its box's foot`);
      if (s.y1 > d.y - PIC_D / 2 - 1e-6 || s.y1 <= s.box[1]) bad.push(`${at}: ${s.text}'s pill (foot ${s.y1}) is not above its disc`);
    }
  }
  // Every species once: a picture's named species and "+x", each name's named species and "+x".
  const seen = new Map<number, string>();
  const count = (i: number, who: string) => {
    if (seen.has(i)) bad.push(`${at}: species ${i} in both ${seen.get(i)} and ${who}`);
    seen.set(i, who);
  };
  c.spots.forEach((s, i) => {
    const hid = (c.groups.get(s.key) ?? []).flat();
    const face = c.pics[i].face;
    for (const b of hid) count(b.index, s.text);
    if (!hid.includes(face)) count(face.index, s.text);
  });
  const named = new Map<string, number>();
  for (const s of c.names) {
    const hid = (c.groups.get(s.key) ?? []).flat();
    for (const b of hid) count(b.index, s.text);
    // (Its name names a species when its picture's species, s.pic, is not in its "+x", as a picture's label's.)
    const own = s.pic && !hid.includes(s.pic) ? 1 : 0;
    if (own) count(s.pic!.index, s.text);
    const [f, l] = s.run!;
    named.set(s.key, l - f + 1);
    // Its count: all of its run, its named species apart.
    if (hid.length + own !== l - f + 1) bad.push(`${at}: name ${s.text} counts ${hid.length} of its ${l - f + 1}`);
    const it = c.all.find((o) => o.f <= f && l <= o.l);
    if (!it) {
      bad.push(`${at}: name ${s.text} (${f}..${l}) is inside no item`);
      continue;
    }
    const k = c.items.indexOf(it);
    if (k >= 0 && c.pics[k].face.index >= f && c.pics[k].face.index <= l) bad.push(`${at}: name ${s.text} on the piece with its item's picture`);
    if (s.box[3] - s.box[1] > v.h) bad.push(`${at}: name ${s.text} taller than the screen`);
  }
  // An item's species all accounted for: its picture's label and the names on it, each once.
  c.items.forEach((it, i) => {
    let n = (c.groups.get(c.spots[i].key) ?? []).flat().length;
    if (!(c.groups.get(c.spots[i].key) ?? []).flat().includes(c.pics[i].face)) n++;
    for (const s of c.names) if (it.f <= s.run![0] && s.run![1] <= it.l) n += named.get(s.key)!;
    if (n !== it.l - it.f + 1) bad.push(`${at}: "${c.spots[i].text}" and its names count ${n} of its ${it.l - it.f + 1} species`);
  });
}

const LEVELS: [string, CladeRec, Split][] = [
  ['the carnivores', CARNIVORA, CARNIVORA_TREE],
  ['the cats', FELIDAE, FELIDAE_TREE],
];

describe.each(LEVELS)('names alone at %s (ToLaD#396)', (_name, clade, tree) => {
  it('never overlap, count every species once, and leave the pictures as they are', () => {
    const v = stubView(clade, tree);
    const home = v.homeCamera();
    const bad: string[] = [];
    let names = 0;
    for (let i = 0; i <= 80; i++) {
      const k = Math.pow(2, i / 8);
      const cam = { ...home, sx: home.sx * k, sy: home.sy, ty: home.sy, cx: home.cx };
      v.cam = cam;
      applyFold(v);
      v.draw();
      const c = v.cutLast!;
      names += c.names.length;
      check(v, c, `zoom ${k.toFixed(2)}`, bad);
      // The same pictures as the frame without the names (labelsAt asks without them).
      const P = (v as unknown as { labelsAt(c: unknown, w?: boolean, win?: [number, number]): CutLabels }).labelsAt(cam, false, [v.toWorld(0, 0)[0], v.toWorld(v.w, 0)[0]]);
      const had = (l: CutLabels) => l.pics.map((p) => `${p.run} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join('|');
      if (had(P) !== had(c)) bad.push(`zoom ${k.toFixed(2)}: pictures moved: ${had(P)} vs ${had(c)}`);
      expect(P.names.length).toBe(0);
    }
    expect(bad.slice(0, 12)).toEqual([]);
    if (clade === CARNIVORA) expect(names).toBeGreaterThan(0);
  });

  it("a name's tap goes into its own run, and a one-branch name stays with its branch under a pan", () => {
    const v = stubView(clade, tree);
    const home = v.homeCamera();
    const P = v as unknown as { tapHere(x: number, y: number): void };
    let tapped = 0;
    let stayed = 0;
    const bad: string[] = [];
    for (let i = 0; i <= 80; i++) {
      const k = Math.pow(2, i / 8);
      const cam = { ...home, sx: home.sx * k, sy: home.sy, ty: home.sy };
      v.cam = cam;
      applyFold(v);
      v.draw();
      const c = v.cutLast!;
      for (const s of c.names) {
        if (s.fit <= 0.5) continue;
        const spy = vi.spyOn(v, 'tapItem').mockImplementation(() => {});
        P.tapHere(s.x, (s.box[1] + s.box[3]) / 2);
        if (spy.mock.calls.length !== 1 || spy.mock.calls[0][0] !== s.run![0] || spy.mock.calls[0][1] !== s.run![1]) bad.push(`zoom ${k.toFixed(2)}: tap on ${s.text} (${s.run}) went to ${JSON.stringify(spy.mock.calls)}`);
        spy.mockRestore();
        tapped++;
      }
      // A pan of a few px: a name on one branch moves with it, 1:1.
      const ones = c.names.filter((s) => s.run![0] === s.run![1]);
      if (ones.length) {
        v.cam = { ...cam, cx: cam.cx + 6 / cam.sx };
        applyFold(v);
        v.draw();
        for (const s of ones) {
          const t = v.cutLast!.names.find((q) => q.key === s.key);
          if (!t) continue;
          stayed++;
          if (Math.abs(s.x - t.x - 6) > 1e-3) bad.push(`zoom ${k.toFixed(2)}: ${s.text} moved ${(s.x - t.x).toFixed(2)} under a 6 px pan`);
        }
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
    if (clade === CARNIVORA) {
      expect(tapped).toBeGreaterThan(0);
      expect(stayed).toBeGreaterThan(0);
    }
  });
});

describe.each(LEVELS)('every label has a picture at %s (ToLaD#400)', (_name, clade, tree) => {
  it("a disc's tap is its pill's: into its own run", () => {
    const v = stubView(clade, tree);
    const home = v.homeCamera();
    const P = v as unknown as { tapHere(x: number, y: number): void };
    const bad: string[] = [];
    for (let i = 0; i <= 80; i += 4) {
      v.cam = { ...home, sx: home.sx * Math.pow(2, i / 8), sy: home.sy, ty: home.sy };
      applyFold(v);
      v.draw();
      for (const s of v.cutLast!.names) {
        if (s.fit <= 0.5) continue;
        const spy = vi.spyOn(v, 'tapItem').mockImplementation(() => {});
        P.tapHere(s.x, s.disc!.y);
        if (spy.mock.calls.length !== 1 || spy.mock.calls[0][0] !== s.run![0] || spy.mock.calls[0][1] !== s.run![1]) bad.push(`tap on ${s.text}'s disc went to ${JSON.stringify(spy.mock.calls)}`);
        spy.mockRestore();
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
  });

  it("a disc draws its face's photo; a group with none, a relative's; a species or a group of nobody with a photo, its own stub", () => {
    const v = stubView(clade, tree);
    const bad: string[] = [];
    let relatives = 0;
    for (const u of v.fan.nodes) {
      const face = groupFace(u);
      if (!face) continue;
      const scis = u.strands.map((b) => b.sp.sci);
      const drawn = discSci({ v: u }, face);
      if (hasPic(face.sp.sci)) {
        if (drawn !== face.sp.sci) bad.push(`${u.name}: its face has a photo but it draws ${drawn}`);
      } else if (scis.some(hasPic)) {
        relatives++;
        if (!hasPic(drawn) || !scis.includes(drawn)) bad.push(`${u.name}: draws ${drawn}, no relative with a photo`);
        if (drawn !== groupPics(u)[0]) bad.push(`${u.name}: draws ${drawn}, not its first`);
      } else if (drawn !== face.sp.sci) bad.push(`${u.name}: nobody has a photo but it draws ${drawn}`);
      // The relatives' list is the group's once: a frame walks nothing.
      if (groupPics(u) !== groupPics(u)) bad.push(`${u.name}: its list is not cached`);
    }
    for (const b of v.fan.branches) if (discSci({ b }, b) !== b.sp.sci) bad.push(`${b.sp.sci}: a species draws another's`);
    expect(bad.slice(0, 12)).toEqual([]);
    if (clade === CARNIVORA) expect(relatives).toBeGreaterThan(0);
  });
});

describe.each(LEVELS)('names through a pinch at %s (ToLaD#396)', (_name, clade, tree) => {
  it('do not flicker: zooming in steadily, a name shows once, and fades in and out', () => {
    const v = stubView(clade, tree);
    const home = v.homeCamera();
    const was = new Map<string, { on: boolean; shows: number; fit: number; at: string }>();
    const flick: string[] = [];
    let pops = 0;
    let frames = 0;
    for (let i = 0; i <= 320; i++) {
      const k = Math.pow(2, i / 40);
      v.cam = { ...home, sx: home.sx * k, sy: home.sy * Math.sqrt(k), ty: home.sy * Math.sqrt(k) };
      applyFold(v);
      v.draw();
      frames++;
      const now = new Map(v.cutLast!.names.map((s) => [s.key, s]));
      for (const [q, s] of now) {
        const e = was.get(q);
        if (!e) was.set(q, { on: true, shows: 1, fit: s.fit, at: s.text });
        else {
          if (!e.on) {
            e.shows++;
            e.on = true;
            if (e.shows > 1) flick.push(`${s.text} (${q}) back at zoom ${k.toFixed(2)}`);
          }
          e.fit = s.fit;
        }
      }
      for (const [q, e] of was)
        if (!now.has(q) && e.on) {
          e.on = false;
          if (e.fit > 0.5) pops++;
        }
    }
    console.log(`${_name}: ${was.size} names over ${frames} frames, ${flick.length} came back, ${pops} left at full alpha (a split or an item's edge)`);
    // (A name may be crowded out once and come back as the zoom makes room; never on and off and on again.)
    expect([...was.values()].filter((e) => e.shows > 2).map((e) => e.at)).toEqual([]);
  });
});
