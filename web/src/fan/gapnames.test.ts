// The names on the tree on its side (ToLaD#455): a gap holds the titles of the clades starting under it, as many as its height holds; a species' in its own branch; a slide changes neither which show nor where they stand on the world.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setFlip } from './flip';
import { CLADE_PX, fitShare, GapNames, SPECIES_PX, type WrittenName } from './gapnames';
import { laneAt, leftAt } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import type { Steady } from './steady';
import { latinOf } from './brackets';
import { FanView, groupName, levelText } from './view';

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
    getBoundingClientRect: () => ({ width: 844, height: 390, left: 0, top: 0, right: 844, bottom: 390 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

describe('names on the gaps and in the branches', () => {
  let v: FanView;
  let f: Steady;
  let g: GapNames;
  const W = 844;
  const H = 390;
  beforeAll(async () => {
    await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
    f = v.fan.tess.fold as Steady;
    g = new GapNames(v.fan, f, (u) => groupName(v.fan, u), (b) => levelText(b) || b.sp.sci, (_, t) => t.length * 7.5);
  }, 120000);
  afterAll(() => setFlip(false));

  const camAt = (sx: number, cx: number) => ({ ...v.cam, sx, cx });
  const gapOf = (k: number) => {
    const { C, R } = f.rooms();
    return C[k] - R[k] / 2 - (C[k - 1] + R[k - 1] / 2);
  };
  const medianRoom = () => {
    const { R } = f.rooms();
    return [...R].sort((a, b) => a - b)[R.length >> 1];
  };

  it('finds every species that fits on screen, where the rooms stand out of order too', () => {
    const { C, R } = f.rooms();
    let k0 = 1;
    while (k0 < C.length - 1 && C[k0] >= C[k0 - 1]) k0++;
    const c = camAt((SPECIES_PX * 1.5) / medianRoom(), C[k0]);
    const got = new Set(g.place(c, W, H, []).map((m) => m.k));
    let n = 0;
    for (let k = 0; k < C.length; k++) {
      const x = (C[k] - c.cx) * c.sx + W / 2;
      if (x < 0 || x > W || R[k] * c.sx < SPECIES_PX * 1.01) continue;
      const b = f.strands[k];
      const long = (b.splitY - f.forkH(b.path[0].node) - Math.max(b.tipY, g.yNow)) * c.sy;
      const y = (Math.max(b.tipY, g.yNow) - c.cy) * c.sy + H / 2;
      // (Standing clear of the screen's ends along time, and with room along its life.)
      if (y < 0 || y > H || long < (levelText(b) || b.sp.sci).length * 7.5 + SPECIES_PX + 1) continue;
      expect(got.has(k), String(k)).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });

  it('titles named clades only, none repeating its parent', () => {
    const named = new GapNames(v.fan, f, (u) => (u.parent ? (latinOf(u.split) ? groupName(v.fan, u) : '') : 'root'), () => '', () => 10);
    let n = 0;
    for (let i = 0; i < f.strands.length; i++)
      for (const u of named.headsOf(i)) {
        n++;
        expect(!u.parent || !!latinOf(u.split)).toBe(true);
      }
    expect(n).toBeGreaterThan(0);
    const blank = new GapNames(v.fan, f, () => '', () => '', () => 10);
    expect(f.strands.every((_, i) => blank.headsOf(i).length === 0)).toBe(true);
  });

  it('writes a gap taller than the text, and not one shorter', () => {
    // The widest gap headed by a clade.
    let k = -1;
    const { C } = f.rooms();
    for (let i = 1; i < C.length; i++) if (g.headsOf(i).length > 1 && (k < 0 || gapOf(i) > gapOf(k))) k = i;
    const [u, u2] = g.headsOf(k);
    const at = (px: number) => g.place(camAt(px / gapOf(k), C[k]), W, H, []).filter((m) => m.v === u);
    const stack = (px: number) => g.place(camAt(px / gapOf(k), C[k]), W, H, []).filter((m) => m.v === u || m.v === u2);
    expect(stack(CLADE_PX * 2).map((m) => m.v)).toEqual([u]);
    expect(at(CLADE_PX * 2).map((m) => m.text)).toEqual([groupName(v.fan, u)]);
    expect(at(CLADE_PX * 0.9)).toEqual([]);
    // (Taller, two lines: the outermost over the next, no overlap.)
    const two = stack(CLADE_PX * 2.5);
    expect(two.map((m) => m.v)).toEqual([u, u2]);
    expect(two[0].box[2]).toBeLessThanOrEqual(two[1].box[0]);
    expect(fitShare(CLADE_PX * 0.9, CLADE_PX)).toBe(0);
    expect(fitShare(CLADE_PX * 2, CLADE_PX)).toBe(1);
  });

  it('titles every clade once, in the gap above its first strand, outermost first', () => {
    const seen = new Set<unknown>();
    f.strands.forEach((_, k) => {
      const list = g.headsOf(k);
      list.forEach((u, i) => {
        expect(seen.has(u)).toBe(false);
        seen.add(u);
        expect(u.strands[0]).toBe(f.strands[k]);
        // (Each next the first daughter of the one above it.)
        if (i) expect(u.parent).toBe(list[i - 1]);
      });
    });
    expect(seen.size).toBe(v.fan.nodes.length);
    // (A gap's first title: a daughter of a fork the strand above it is under too, the lower one.)
    for (let k = 1; k < f.strands.length; k++) for (const u of g.headsOf(k).slice(0, 1)) expect(u.parent!.strands).toContain(f.strands[k - 1]);
  });

  it('writes a species in its own branch', () => {
    const { C, R } = f.rooms();
    const names = g.place(camAt((SPECIES_PX * 3) / medianRoom(), C[C.length >> 1]), W, H, []).filter((m) => m.k !== undefined);
    expect(names.length).toBeGreaterThan(0);
    for (const m of names) {
      const b = f.strands[m.k!];
      expect(m.text).toBe(levelText(b) || b.sp.sci);
      const mid = leftAt(b, b.tipY) + laneAt(b, b.tipY).w / 2;
      expect(Math.abs(mid - C[m.k!])).toBeLessThan(R[m.k!]);
    }
  });

  it('never writes a name over another', () => {
    const { C } = f.rooms();
    const list = g.place(camAt((SPECIES_PX * 1.5) / medianRoom(), C[C.length >> 1]), W, H, []);
    expect(list.length).toBeGreaterThan(0);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [p, q] = [list[i].box, list[j].box];
        expect(p[0] < q[2] - 1e-6 && p[2] > q[0] + 1e-6 && p[1] < q[3] && p[3] > q[1]).toBe(false);
      }
  });

  it('changes neither which names show nor where they stand on the world in a slide at one zoom', () => {
    const { C } = f.rooms();
    const sx = (CLADE_PX * 1.5) / medianRoom();
    const a = camAt(sx, C[C.length >> 1]);
    const b = { ...a, cx: a.cx + 100 / sx };
    const key = (m: WrittenName) => (m.v ? `c${m.text}` : `s${m.k}`);
    const world = (m: WrittenName, c: typeof a) => (m.box[0] + m.box[2]) / 2 / sx + c.cx - W / 2 / sx;
    const list = (c: typeof a) => new Map(g.place(c, W, H, []).map((m) => [key(m), m]));
    const A = list(a);
    const B = list(b);
    let both = 0;
    // (On screen in both: nothing here covers, so all of them must be in both, at one world x and one place along time.)
    for (const [k, m] of A) {
      if ((world(m, a) - b.cx) * sx + W / 2 < 2 * CLADE_PX) continue;
      const o = B.get(k);
      expect(o, k).toBeDefined();
      expect(world(o!, b)).toBeCloseTo(world(m, a), 6);
      expect(o!.box[1]).toBeCloseTo(m.box[1], 6);
      both++;
    }
    expect(both).toBeGreaterThan(0);
  });

  it('keeps out of what covers it', () => {
    const { C } = f.rooms();
    const c = camAt((SPECIES_PX * 1.5) / medianRoom(), C[C.length >> 1]);
    const first = g.place(c, W, H, [])[0];
    expect(first).toBeDefined();
    const key = (m: WrittenName) => `${m.text} ${m.box[0]}`;
    expect(g.place(c, W, H, [first.box]).map(key)).not.toContain(key(first));
  });
});
