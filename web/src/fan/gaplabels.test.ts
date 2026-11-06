// One kind of label on the tree on its side (ToLaD#458): a name in the gap above its own branch, else in its band; a picture only in a band, group's or species'; from the zoom alone, nothing merging on the way in, nothing meeting.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setFlip } from './flip';
import { CLADE_PX } from './gapnames';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';
import type { Steady } from './steady';
import { FanView, groupFace, type CutLabels, type GapMember } from './view';
import { GROUP_D, PIC_D, picBox } from './pics';

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
      const now = cover(home * z);
      // (A cover: runs of strands that do not overlap, never a group with its parts.)
      for (let i = 1; i < now.length; i++) expect(now[i].on).toBeGreaterThan(now[i - 1].on);
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
        expect(m.gap * sx).toBeGreaterThanOrEqual(CLADE_PX);
      }
      const c = C[C.length >> 1];
      const cut = frame(sx, c);
      const seen = new Set<number>();
      for (const s of cut.names) {
        if (!s.v) continue;
        const k = s.v.strands.find((b) => b.tipY <= v.fan.time.y(0.1))!.index;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
        const top = v.toScreen(C[k] - R[k] / 2, 0)[0];
        const m = cover(sx).find((g) => g.on === k)!;
        if (m.tier === 'in') {
          // (Too thin a gap: on its own band.)
          expect(s.box[0]).toBeGreaterThanOrEqual(v.toScreen(m.at - m.band / 2, 0)[0] - 1e-6);
          expect(s.box[2]).toBeLessThanOrEqual(v.toScreen(m.at + m.band / 2, 0)[0] + 1e-6);
          continue;
        }
        expect(s.box[2]).toBeLessThanOrEqual(top + 1e-6);
        expect(top - s.box[0]).toBeLessThanOrEqual(m.gap * sx + 1e-6);
      }
    }
  });

  it('a name for everyone in the cover, by the rule: every part that opened has room', () => {
    for (const z of ZOOMS) for (const m of cover(home * z)) expect(m.tier, String(name(m))).toBeTruthy();
  });

  it('a picture only in a band that holds it, by the zoom alone, and never in a gap', () => {
    for (const z of ZOOMS) {
      const sx = home * z;
      const byKey = new Map(cover(sx).map((m) => [m.lv, m]));
      for (const m of cover(sx)) expect(m.pic).toBe(m.band * sx >= GROUP_D);
      const c = frame(sx, f.rooms().C[f.rooms().C.length >> 1]);
      for (const p of c.pics) {
        const m = byKey.get(p.lv)!;
        expect(m.pic).toBe(true);
        expect(p.x - PIC_D / 2).toBeGreaterThanOrEqual(v.toScreen(m.at - m.band / 2, 0)[0] - 1e-6);
        expect(p.x + PIC_D / 2).toBeLessThanOrEqual(v.toScreen(m.at + m.band / 2, 0)[0] + 1e-6);
      }
    }
    expect(cover(home).some((m) => m.pic)).toBe(true);
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
      return cover(v.levelCamera(taxon)!.sx).find((m) => (m.lv.b ? m.lv.b === b : m.lv.v!.strands.includes(b)))!;
    };
    // (At Primates' frame humans stand in a group with a thin first part, that group's picture a human: a funnel, its band read whole. The same for cat and dog at Carnivora's.)
    for (const [taxon, sci] of [['Primates', 'Homo sapiens'], ['Carnivora', 'Felis catus'], ['Carnivora', 'Canis lupus']]) {
      const m = holder(taxon, sci);
      expect(m.pic, sci).toBe(true);
      expect(m.lv.b?.sp.sci ?? groupFace(m.lv.v!)?.sp.sci, sci).toBe(sci);
    }
    let z = 1;
    while (cover(home * z).find((m) => m.lv.b?.sp.sci === 'Homo sapiens')?.tier == null) z *= Math.SQRT2;
    console.log(`Homo sapiens its own label from x${z.toFixed(0)} of home; Primates' frame x${(v.levelCamera('Primates')!.sx / home).toFixed(0)}`);
    expect(z).toBeLessThan(8192);
  });
});
