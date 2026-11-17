// One kind of label on the tree on its side (ToLaD#458): a name in the gap above its own branch, else in its band; a picture only in a band, group's or species'; from the zoom alone, nothing merging on the way in, nothing meeting.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setFlip } from './flip';
import { gapHands, type Guest } from './gaplabels';
import { CLADE_PX } from './gapnames';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';
import type { Steady } from './steady';
import { FanView, groupFace, type CutLabels, type GapMember } from './view';
import { GROUP_D, PIC_D, PIC_S, picBox } from './pics';

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
  g.document = { createElement: () => ({ textContent: '' }) };
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7.5 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle'].includes(k) ? noop : o[k as string]),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
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

type Inner = { territories(): never; gapCoverAt(T: never, sx: number): GapMember[]; labelsNow(): { cut: CutLabels } };

describe('labels in the gaps and in the branches', () => {
  let v: FanView;
  let f: Steady;
  let home: number;
  beforeAll(async () => {
    await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
    f = v.fan.tess.fold as Steady;
    home = v.cam.sx;
  }, 120000);
  afterAll(() => setFlip(false));

  const inner = () => v as unknown as Inner;
  const cover = (sx: number) => inner().gapCoverAt(inner().territories(), sx);
  const frame = (sx: number, cx: number): CutLabels => {
    v.cam = { ...v.cam, sx, cx };
    return inner().labelsNow().cut;
  };
  const ZOOMS = Array.from({ length: 48 }, (_, i) => 2 ** (i / 4));
  const name = (m: GapMember) => (m.lv.b ? m.lv.b.sp.sci : m.k);

  it('only ever splits on the way in', () => {
    let prev: GapMember[] | null = null;
    for (const z of ZOOMS) {
      const all = cover(home * z);
      // (The cut below the titles, ToLaD#483: runs of strands that do not overlap, never a group with its parts. Over it, each title over a run of it, one a gap.)
      const now = all.filter((m) => !m.heads);
      for (let i = 1; i < now.length; i++) expect(now[i].on).toBeGreaterThan(now[i - 1].on);
      const heads = all.filter((m) => m.heads);
      // (A group whose gap is its group's title's stays a head over that title's strand while its name is a guest in its widest part's band, ToLaD#500 (gapCut): no gap of its own, 0.
      // Measured: 1745 shared by two heads before this allowed it.)
      for (let i = 1; i < heads.length; i++) {
        if (heads[i].on === heads[i - 1].on) expect(heads[i].gap).toBe(0);
        else expect(heads[i].on).toBeGreaterThan(heads[i - 1].on);
      }
      for (const h of heads) expect(now.some((m) => m.on === h.on && h.f <= m.f && m.l <= h.l)).toBe(true);
      if (prev) {
        const was = prev;
        expect(now.length).toBeGreaterThanOrEqual(was.length);
        // (Each group was, or was within, one a step out.)
        for (const m of now) expect(was.some((p) => p.f <= m.f && m.l <= p.l), String(name(m))).toBe(true);
      }
      prev = now;
    }
    expect(prev!.length).toBeGreaterThan(cover(home).length * 10);
  });

  it('a title in the gap above its own branch, one a gap', () => {
    const { C, R } = f.rooms();
    for (const z of ZOOMS) {
      const sx = home * z;
      for (const m of cover(sx)) {
        if (m.tier !== 'title') continue;
        expect(m.top).toBeCloseTo(C[m.on] - R[m.on] / 2, 9);
        // (A title its gap cannot hold yet stands in its widest part's band instead, a guest, ToLaD#500: its host one of its parts. Measured: a guest's gap 0 px, its gap its group's title's.)
        if (m.host) expect(m.f <= m.host.f && m.host.l <= m.l && m.host !== m).toBe(true);
        else expect(m.gap * sx).toBeGreaterThanOrEqual(CLADE_PX);
      }
      const c = C[C.length >> 1];
      const cut = frame(sx, c);
      const seen = new Set<number>();
      for (const s of cut.names) {
        // (A fossil group named at its youngest tip (tipLabels, ToLaD#279) is no member of the cover, which names the column: tipnames.test holds it.)
        if (!s.v || s.place === 'tip') continue;
        const m = cover(sx).find((g) => g.lv.v === s.v)!;
        if (m.host) {
          // (A guest title, ToLaD#500: its gap is the title's over it, on the same strand, so it stands in its host's band, beside the host's own label.)
          expect(s.box[0]).toBeGreaterThanOrEqual(v.toScreen(m.host.at - m.host.band / 2, 0)[0] - 1e-6);
          expect(s.box[2]).toBeLessThanOrEqual(v.toScreen(m.host.at + m.host.band / 2, 0)[0] + 1e-6);
          continue;
        }
        const top = v.toScreen(m.top, 0)[0];
        if (m.tier === 'in' || s.box[2] > top + 1e-6) {
          // (Too thin a gap, or its gap a screen away: on its own band.)
          expect(s.box[0]).toBeGreaterThanOrEqual(v.toScreen(m.at - m.band / 2, 0)[0] - 1e-6);
          expect(s.box[2]).toBeLessThanOrEqual(v.toScreen(m.at + m.band / 2, 0)[0] + 1e-6);
          continue;
        }
        // (One title a gap. A name in its band may share its strand with the title in the gap over it, ToLaD#500: a group splits once its widest part's band holds that part's name
        // and the group's; measured at home, Primates in its band under Primates & treeshrews in the gap, both on strand 3491.)
        expect(seen.has(m.on)).toBe(false);
        seen.add(m.on);
        expect(s.box[2]).toBeLessThanOrEqual(top + 1e-6);
        expect(top - s.box[0]).toBeLessThanOrEqual(m.gap * sx + 1e-6);
      }
    }
  });

  it('a name for everyone in the cover, by the rule: every part that opened has room; under a title, where it fits (ToLaD#483)', () => {
    for (const z of ZOOMS) {
      const all = cover(home * z);
      const heads = all.filter((m) => m.heads);
      for (const m of all) if (!m.tier) expect(heads.some((h) => h.f <= m.f && m.l <= h.l), String(name(m))).toBe(true);
    }
  });

  it('pictures by priority and collision (ToLaD#464): full or small, no two ever meeting, wider than a band or not', () => {
    const hair = GROUP_D - PIC_D;
    const boxesMeet = (p: readonly number[], q: readonly number[]) => p[0] < q[2] && p[2] > q[0] && p[1] < q[3] && p[3] > q[1];
    let [full, small, held] = [0, 0, 0];
    for (const z of ZOOMS) {
      const sx = home * z;
      const ms = cover(sx).filter((m) => m.pic);
      for (const m of ms) expect([PIC_D, PIC_S]).toContain(m.pic);
      // (Centres on the bands' centres, apart by both rooms: from the zoom alone.)
      for (let i = 1; i < ms.length; i++) expect((ms[i].at - ms[i - 1].at) * sx).toBeGreaterThanOrEqual((ms[i].pic! + ms[i - 1].pic!) / 2 + hair - 1e-6);
      full += ms.filter((m) => m.pic === PIC_D).length;
      small += ms.filter((m) => m.pic === PIC_S).length;
      // (A title's band is its parts', ToLaD#483, so it holds none of its own: since #500 a group hands its band down part by part, so there are many.)
      held += cover(sx).filter((m) => !m.heads && m.band * sx >= GROUP_D).length;
      // (Drawn, held on screen: still none meeting; the column's apart along it, a fossil's at its own tip (ToLaD#279, tipLabels) meeting none.)
      for (const at of [0.1, 0.5, 0.9]) {
        const all = frame(sx, f.rooms().C[Math.floor(f.rooms().C.length * at)]).pics;
        const ps = all.filter((p) => p.held).sort((p, q) => p.x - q.x);
        for (let i = 1; i < ps.length; i++) expect(ps[i].x - ps[i - 1].x).toBeGreaterThanOrEqual(((ps[i].d ?? PIC_D) + (ps[i - 1].d ?? PIC_D)) / 2 - 1e-6);
        for (const p of all.filter((p) => !p.held)) for (const q of all) if (q !== p) expect(boxesMeet(picBox(p), picBox(q))).toBe(false);
      }
    }
    console.log(`[pics] over ${ZOOMS.length} zooms: ${full} full, ${small} small; bands holding one ${held}`);
    expect(full).toBeGreaterThan(held);
    expect(small).toBeGreaterThan(0);
  });

  it('a picture once shown stays as the view zooms in, until its member splits (a small one may grow)', () => {
    let prev = new Map<unknown, number>();
    for (let z = 1; z < 2 ** 12; z *= 1.05) {
      // (Until its member splits or hands its band down to its parts, ToLaD#483.)
      const now = new Map<unknown, number>(cover(home * z).filter((m) => !m.heads).map((m) => [m.lv.b ?? m.lv.v, m.pic ?? 0]));
      for (const [k, d] of prev) if (now.has(k)) expect(now.get(k)!).toBeGreaterThanOrEqual(d);
      prev = now;
    }
  });

  it('a pan at one zoom changes no picture', () => {
    const { C } = f.rooms();
    for (const z of [1, 4, 16, 64, 256]) {
      const sx = home * z;
      const pics = (cx: number) => new Map(frame(sx, cx).pics.map((p) => [p.lv.b ?? p.lv.v, [p.d ?? PIC_D, Math.round((v.toWorld(p.x, 0)[0] - cx) * sx * 1e3)]]));
      const [a, b] = [C[C.length >> 1], C[C.length >> 1] + 40 / sx];
      const [A, B] = [pics(a), pics(b)];
      let both = 0;
      for (const [k, d] of A)
        if (B.has(k)) {
          expect(B.get(k)![0]).toBe(d[0]);
          both++;
        }
      if (A.size > 2) expect(both).toBeGreaterThan(0);
    }
  });

  it('a picture no older than its branch: a pan into the past leaves it at its branch’s start (Ita, ToLaD#464)', () => {
    const sx = home * 8;
    const { C } = f.rooms();
    const Y = (y: number) => v.toScreen(0, y)[1];
    let stopped = 0;
    const cam = { ...v.cam, sx, cx: C[C.length >> 1] };
    for (const back of [0, 0.25, 0.5, 1, 2, 4]) {
      v.cam = cam;
      const c0 = inner().labelsNow().cut;
      // (Older to the larger y: the past comes in by moving the world's older times on screen, here by `back` screens.)
      expect(Y(v.fan.time.y(1))).toBeGreaterThan(Y(v.fan.time.y(0.1)));
      v.cam = { ...cam, cy: v.toWorld(0, v.h / 2 + back * v.h)[1] };
      const c = inner().labelsNow().cut;
      const col = Y(v.fan.time.y(0.1));
      for (const p of c.pics) {
        const start = Y(p.lv.b ? p.lv.b.splitY : p.lv.v!.yBot);
        const slot = p.y - (p.d ?? PIC_D) / 2 + PIC_D / 2;
        // (Its slot's old edge at its start at the most, unless the column itself stands there.)
        expect(slot, String(p.face.sp.sci)).toBeLessThanOrEqual(Math.max(col, start - PIC_D / 2) + 1e-6);
      }
      stopped += c0.pics.length - c.pics.length;
    }
    expect(stopped).toBeGreaterThan(0);
  });

  it('never a label over another, a picture and pill counted, at any zoom', () => {
    const { C } = f.rooms();
    const bad: string[] = [];
    for (const z of ZOOMS) {
      for (const at of [0.1, 0.5, 0.9]) {
        const c = frame(home * z, C[Math.floor(C.length * at)]);
        const boxes: [string, readonly number[]][] = [...c.names.map((s) => [s.text, s.box] as [string, readonly number[]]), ...c.spots.map((s) => [s.text, s.box] as [string, readonly number[]]), ...c.pics.map((p) => [`pic ${p.face.sp.sci}`, picBox(p)] as [string, readonly number[]])];
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const [p, q] = [boxes[i][1], boxes[j][1]];
            // (A species' own pill on its own picture stands beside it, along time.)
            if (p[0] < q[2] - 1e-6 && p[2] > q[0] + 1e-6 && p[1] < q[3] - 1e-6 && p[3] > q[1] + 1e-6) bad.push(`x${z.toFixed(1)} ${boxes[i][0]} / ${boxes[j][0]}`);
          }
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
  });

  it('a pan at one zoom changes no list and nothing that stays on screen', () => {
    const { C } = f.rooms();
    for (const z of [1, 8, 64, 512]) {
      const sx = home * z;
      const [a, b] = [C[C.length >> 1], C[C.length >> 1] + 60 / sx];
      const list = cover(sx);
      const sig = (c: CutLabels) => new Map([...c.names, ...c.spots].map((s) => [s.key, `${s.text} ${s.plain ?? 'pill'}`]));
      const [A, B] = [sig(frame(sx, a)), sig(frame(sx, b))];
      expect(cover(sx)).toBe(list);
      let both = 0;
      for (const [k, t] of A)
        if (B.has(k)) {
          expect(B.get(k)).toBe(t);
          both++;
        }
      if (A.size > 2) expect(both).toBeGreaterThan(0);
    }
  });

  it('has Homo sapiens as a label of its own, its fossils holding nothing back', () => {
    const holder = (taxon: string, sci: string) => {
      const b = f.strands.find((s) => s.sp.sci === sci)!;
      return cover(v.levelCamera(taxon)!.sx).find((m) => !m.heads && (m.lv.b ? m.lv.b === b : m.lv.v!.strands.includes(b)))!;
    };
    // (At Primates' frame humans stand in a group with a thin first part, that group's picture a human: a funnel, its band read whole. The same for cat and dog at Carnivora's.)
    for (const [taxon, sci] of [['Primates', 'Homo sapiens'], ['Carnivora', 'Felis catus'], ['Carnivora', 'Canis familiaris']]) {
      const m = holder(taxon, sci);
      expect(m.pic, sci).toBe(PIC_D);
      expect(m.lv.b?.sp.sci ?? groupFace(m.lv.v!)?.sp.sci, sci).toBe(sci);
    }
    let z = 1;
    while (cover(home * z).find((m) => m.lv.b?.sp.sci === 'Homo sapiens')?.tier == null) z *= Math.SQRT2;
    expect(z).toBeLessThan(8192);
  });
});

// A highlight outranks a title (ToLaD#500 after #507's data, gapHands' `dear`): a group whose title its gap cannot hold hands its band down once its widest part holds that part's own name, if
// that part holds a highlight, instead of waiting for room for both; nothing else moves, and the highlight's group never hands down later than without it.
describe('a highlight’s band is its own label’s before a title’s', () => {
  type N = { id: string; gap: number; band: number; kids: N[] };
  const n = (id: string, gap: number, band: number, kids: N[] = []): N => ({ id, gap, band, kids });
  const hands = (root: N, dear?: (g: N) => boolean) =>
    gapHands(root, (g) => g.kids, new Map([[root, 9]]), (g) => g.gap, (g) => g.band, (g) => Math.max(g.gap, g.band), CLADE_PX, GROUP_D - PIC_D, new Map<N, Guest<N>>(), (g, p) => g.kids[0] === p, dear);
  it('hands down at the part’s own name, not both names, where the widest part is the highlight’s', () => {
    // (A group, its gap a hair, its parts: a thin first one and a wide second one, the highlight's, 27.9 band units, 12 px a name, 4 a hair: both names need 28. Its parent's title stands in
    // the parent's gap, but over the parent's first part, a thin sister: no title over g's first strand names g, as Primates' lemurs on #507's data.)
    const human = n('human', 0, 27.9);
    const g = n('g', 0.5, 29, [n('thin', 0, 0.9), human]);
    const root = n('root', 30, 40, [n('lemurs', 0, 1.7), g]);
    const was = hands(root).get(g)!;
    const now = hands(root, (q) => q === human).get(g)!;
    expect(was).toBeCloseTo((2 * CLADE_PX + GROUP_D - PIC_D) / 27.9, 9);
    expect(now).toBeCloseTo(CLADE_PX / 27.9, 9);
    // (Where the highlight is not the widest part, no change: its band was never the one a title waits on.)
    expect(hands(root, (q) => q.id === 'thin').get(g)).toBe(was);
    // (And a tree with no highlight is as it was, member by member.)
    const none = hands(root, () => false);
    for (const [q, z] of hands(root)) expect(none.get(q), q.id).toBe(z);
  });
});
