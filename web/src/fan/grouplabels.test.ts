// Labels cover the screen (ToLaD#417, #440, `?labels=groups`), at mammals, checked by code at every frame of the sweeps, under
// `clades` and the default gaps: every strand on screen falls under exactly one label's group; no split that could have
// happened and didn't; no two meet, none off screen, none with a "+x" or a leader; every picture's centre on its own branch
// at "now"; a group of several branches has the hairline from its first to its last under its picture (ToLaD#431);
// a tap lands on its group's frame, also above an order; a second tap and a double tap go by the level rules.
import { afterAll, describe, expect, it } from 'vitest';
import { groupName, labelParts, LABEL_BOTTOM_PX, levelName, FanView, isLevel, nextLevels, type CutLabels, type Level } from './view';
import { latinOf } from './brackets';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { GROUP_D, PIC_D, PIC_LIFT, setLabelMode } from './pics';
import { coverOf, fits, keepOnScreen, placeSlots, type Slot } from './slide';
import { mammaliaTree } from './splits';
import { setGapMode, type GapMode } from './fold';
import type { FanBranch, FanNode } from './layout';

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

type Inner = {
  applyFold(): void;
  anim: ((t: number) => boolean) | null;
  backing: { lv: Level; cam: unknown } | null;
  frameOf(lv: Level): { cx: number; cy: number; sx: number; sy: number; ty: number };
  offBy(a: unknown, c: unknown): number;
};
const inner = (v: FanView) => v as unknown as Inner;
const frame = (v: FanView): CutLabels => {
  v.camera.settle();
  inner(v).applyFold();
  v.draw();
  return v.cutLast!;
};
const nameOfLv = (lv: Level) => (lv.v ? levelName(lv.v) : lv.b!.sp.common);

/** The cover (ToLaD#440): every strand on screen under exactly one label, but for a group giving way at an edge; the labels of the one list. */
let farthest = 0;
function coverCheck(v: FanView, c: CutLabels, at: string, bad: string[]): void {
  const now = v.fan.time.y(0);
  const list = v.coverLast!.list;
  const inList = new Set(list.map((g) => g.lv.v ?? g.lv.b!));
  const under = new Map<FanBranch, number>();
  for (const p of c.pics) {
    if (!inList.has(p.lv.v ?? p.lv.b!)) bad.push(`${at}: ${nameOfLv(p.lv)} is not on this zoom's list`);
    for (const s of p.lv.v ? p.lv.v.strands : [p.lv.b!]) under.set(s, (under.get(s) ?? 0) + 1);
  }
  for (const s of v.fan.branches) {
    const y = Math.max(s.tipY, now);
    const m = v.model(s).lanes(y);
    const x = v.toScreen(m.left + m.w / 2, 0)[0];
    // (On screen: its tip, above the row the lowest picture fits on.)
    if (x < 0 || x > v.w || v.toScreen(0, y)[1] >= v.h - LABEL_BOTTOM_PX + 30) continue;
    const n = under.get(s) ?? 0;
    if (n > 1) bad.push(`${at}: ${s.sp.sci} under ${n} labels`);
    if (!n) {
      const off = Math.min(x, v.w - x);
      farthest = Math.max(farthest, off);
      if (off > GROUP_D + PIC_D / 2 + 1e-6) bad.push(`${at}: ${s.sp.sci} at ${x.toFixed(1)} has no label`);
    }
  }
}

/** The list at this sx: the strands each in exactly one group, in order; no split left that would have fitted. */
function listCheck(v: FanView, at: string, bad: string[]): void {
  const list = v.coverLast!.list;
  const sx = v.coverLast!.sx;
  for (let i = 1; i < list.length; i++) if (list[i].f !== list[i - 1].l + 1) bad.push(`${at}: ${nameOfLv(list[i - 1].lv)} and ${nameOfLv(list[i].lv)} leave a gap or overlap`);
  if (list[0].f !== 0 || list[list.length - 1].l !== v.fan.branches.length - 1) bad.push(`${at}: the list does not span the tree`);
  const win = (g: { a: number; b: number }): Slot => ({ lo: g.a * sx, hi: g.b * sx, at: 0 });
  const now = v.fan.time.y(0);
  list.forEach((g, i) => {
    if (!g.lv.v) return;
    const ps = labelParts(g.lv.v).map((lv) => {
      const st = lv.v ? lv.v.strands : [lv.b!];
      const young = Math.min(...st.map((s) => Math.max(s.tipY, now)));
      const on = st.filter((s) => Math.max(s.tipY, now) <= young + 1e-9).map((s) => v.model(s).lanes(young));
      return { f: Math.min(...st.map((s) => s.index)), a: Math.min(...on.map((m) => m.left)), b: Math.max(...on.map((m) => m.left + m.w)) };
    });
    ps.sort((p, q) => p.f - q.f);
    if (fits([...list.slice(Math.max(0, i - 3), i).map(win), ...ps.map(win), ...list.slice(i + 1, i + 4).map(win)], GROUP_D) && fits([...list.slice(0, i).map(win), ...ps.map(win), ...list.slice(i + 1).map(win)], GROUP_D)) bad.push(`${at}: ${nameOfLv(g.lv)} could split`);
  });
}

/** One frame's invariants; returns its labels' names. */
function check(v: FanView, c: CutLabels, at: string, bad: string[]): string[] {
  coverCheck(v, c, at, bad);
  const now = v.fan.time.y(0);
  const pics = [...c.pics].sort((p, q) => p.x - q.x);
  for (let i = 0; i < pics.length; i++) {
    const p = pics[i];
    const s = c.spots[p.i];
    if (p.x - PIC_D / 2 < -1e-6 || p.x + PIC_D / 2 > v.w + 1e-6) bad.push(`${at}: ${nameOfLv(p.lv)} off screen at ${p.x.toFixed(1)}`);
    if (i && p.x - pics[i - 1].x < GROUP_D - 1e-6) bad.push(`${at}: ${nameOfLv(p.lv)} meets ${nameOfLv(pics[i - 1].lv)}`);
    if (/\+\d/.test(s.text) || s.plus) bad.push(`${at}: ${s.text} has a "+x"`);
    if (s.box[0] > p.x || s.box[2] < p.x || s.box[3] > p.y) bad.push(`${at}: ${s.text}'s pill is not over its picture`);
    // Its centre on its own branch, at the row it stands on.
    const strands = p.lv.v ? p.lv.v.strands : [p.lv.b!];
    const young = Math.min(...strands.map((b) => Math.max(b.tipY, now)));
    const on = strands.filter((b) => Math.max(b.tipY, now) <= young + 1e-9).map((b) => v.model(b).lanes(young));
    const a = v.toScreen(Math.min(...on.map((m) => m.left)), 0)[0];
    const b = v.toScreen(Math.max(...on.map((m) => m.left + m.w)), 0)[0];
    // (Its centre on its branch; a branch nearer the screen's edge than a picture's half: the picture whole against that edge, the branch under it.)
    const pinned = Math.abs(p.x - PIC_D / 2) < 1e-6 ? b >= 0 : Math.abs(p.x - (v.w - PIC_D / 2)) < 1e-6 ? a <= v.w : false;
    if ((p.x < a - 1e-6 || p.x > b + 1e-6) && !pinned) bad.push(`${at}: ${nameOfLv(p.lv)} at ${p.x.toFixed(1)} is off its branch ${a.toFixed(1)}..${b.toFixed(1)}`);
    // Its hairline: in the gap under its picture, from the first to the last of its branches at that row; one branch, none.
    const foot = p.y + PIC_D / 2 + PIC_LIFT / 2;
    const wy = Math.max(v.toWorld(0, foot)[1], young);
    const row = strands.filter((b) => Math.max(b.tipY, now) <= wy + 1e-9);
    const mids = row.map((b) => {
      const m = v.model(b).lanes(wy);
      return v.toScreen(m.left + m.w / 2, 0)[0];
    });
    // (Its ends on the outer edges of its end branches, ToLaD#433.)
    const m0 = v.toScreen(Math.min(...row.map((b) => v.model(b).lanes(wy).left)), 0)[0];
    const m1 = v.toScreen(Math.max(...row.map((b) => v.model(b).lanes(wy).left + v.model(b).lanes(wy).w)), 0)[0];
    if (row.length < 2 || Math.max(...mids) <= Math.min(...mids)) {
      if (s.over) bad.push(`${at}: ${nameOfLv(p.lv)}, one branch at its foot, has a line`);
    } else if (!s.over) bad.push(`${at}: ${nameOfLv(p.lv)}, ${row.length} branches, has no line`);
    else if (Math.abs(s.over[0] - m0) > 0.01 || Math.abs(s.over[1] - m1) > 0.01 || Math.abs(s.over[2] - foot) > 0.01) bad.push(`${at}: ${nameOfLv(p.lv)}'s line ${s.over.map((n) => n.toFixed(1))} is not its branches ${m0.toFixed(1)}..${m1.toFixed(1)} at ${foot.toFixed(1)}`);
  }
  // (Each line inside its own branches: two neighbours' never overlap, ToLaD#433.)
  const lines = pics.map((p) => c.spots[p.i]).filter((s) => s.over).sort((s, q) => s.over![0] - q.over![0]);
  for (let i = 1; i < lines.length; i++) if (lines[i].over![0] < lines[i - 1].over![1] - 1e-6) bad.push(`${at}: ${lines[i - 1].text}'s line runs to ${lines[i - 1].over![1].toFixed(2)}, into ${lines[i].text}'s from ${lines[i].over![0].toFixed(2)}`);
  return pics.map((p) => nameOfLv(p.lv));
}

afterAll(() => {
  setLabelMode('cut');
  setGapMode('groups');
});

describe('placing on branches (slide.ts)', () => {
  const S = (lo: number, hi: number): Slot => ({ lo, hi, at: (lo + hi) / 2 });
  it('a set fits only if a sweep over its windows does', () => {
    expect(fits([S(100, 200), S(150, 150)], 40)).toBe(true);
    expect(fits([S(100, 200), S(150, 150), S(160, 160)], 40)).toBe(false);
  });
  it('a cover splits only what fits, and blocks only itself', () => {
    type G = { w: [number, number]; kids: G[]; n: number };
    const g = (lo: number, hi: number, n: number, kids: G[] = []): G => ({ w: [lo, hi], kids, n });
    // (A tight pair inside the first group holds up only it.)
    const tight = g(0, 10, 9, [g(0, 1, 5), g(2, 3, 4)]);
    const wide = g(100, 300, 8, [g(100, 150, 4), g(200, 300, 4)]);
    const list = coverOf(g(0, 300, 20, [tight, wide]), (q) => q.w, (q) => q.kids, (p, q) => p.n - q.n, 40);
    expect(list).toEqual([tight, wide.kids[0], wide.kids[1]]);
  });
  it('a group going off an edge gives way, nobody else', () => {
    const k = keepOnScreen([[-100, 5], [20, 30], [100, 200], [370, 500]], 18, 372, 40);
    expect(k.first).toBe(1);
    expect(k.slots.length).toBe(3);
  });
  it('moves continuously with the windows', () => {
    let last: Float64Array | null = null;
    for (let t = 0; t <= 200; t++) {
      const slots = [S(100 + t / 10, 300), S(180, 220 + t / 10), S(240 - t / 20, 260)];
      const xs = placeSlots(slots, [0, 1, 2], 30);
      expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(30 - 1e-9);
      expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(30 - 1e-9);
      if (last) for (let i = 0; i < 3; i++) expect(Math.abs(xs[i] - last[i])).toBeLessThan(1);
      last = xs;
    }
  });
});

describe('labels cover the screen (?labels=groups, ToLaD#417, #440)', () => {
  for (const gaps of ['groups', 'clades'] as GapMode[])
    it(`mammals, gaps ${gaps}`, { timeout: 600_000 }, async () => {
      await loadMammalsFromFiles();
      setGapMode(gaps);
      setLabelMode('groups');
      const v = stubView();
      const bad: string[] = [];
      const iv = inner(v);
      // Home, its orders' frames and one step down from each, as a tap on a label goes.
      v.cam = v.homeCamera();
      const names = check(v, frame(v), 'home', bad);
      console.log(`[${gaps}] home: ${names.length}: ${names.join(', ')}`);
      {
        const named = v.fan.nodes.filter((u) => isLevel(v.fan, u) && u.parent && u.strands.length >= 20 && levelName(u) === latinOf(u.split)).sort((p, q) => q.strands.length - p.strands.length);
        const kin = named.filter((u) => groupName(v.fan, u) !== levelName(u));
        console.log(`[${gaps}] ${named.length} big levels with Latin only, ${kin.length} told by a part: ${named.slice(0, 40).map((u) => `${levelName(u)} = ${groupName(v.fan, u)}`).join(' | ')}`);
      }
      expect(names.length).toBeGreaterThanOrEqual(1);
      const frames: string[] = [];
          let framed = 0;
      let sum = 0;
      const visit = (u: FanNode, depth: number) => {
        v.cam = { ...iv.frameOf({ v: u }) };
        const c = frame(v);
        const at = levelName(u);
        const here = check(v, c, at, bad);
        sum += here.length;
        framed++;
        if (depth <= 1) frames.push(`${at}: ${here.length}: ${here.join(', ')}`);
        if (depth < 2) for (const g of nextLevels(v.fan, u)) if (g.v && g.v.strands.length >= 8) visit(g.v, depth + 1);
      };
      for (const g of nextLevels(v.fan, v.fan.root)) if (g.v && g.v.strands.length >= 30) visit(g.v, 0);
      console.log(`[${gaps}] ${framed} frames\n` + frames.slice(0, 30).join('\n'));
      console.log(`[${gaps}] GROUP_D ${GROUP_D}: home ${names.length}, ${sum} labels over ${framed} frames, ${(sum / framed).toFixed(2)} each`);
      expect(bad.slice(0, 20)).toEqual([]);

      // A tap on a label, its picture or its name, lands on its group's own frame.
      v.cam = v.homeCamera();
      const home = frame(v);
      for (const p of home.pics) {
        const s = home.spots[p.i];
        for (const [x, y] of [
          [p.x, p.y],
          [s.x, (s.box[1] + s.box[3]) / 2],
        ]) {
          v.cam = v.homeCamera();
          frame(v);
          v.tap(x, y);
          const it = nameOfLv(p.lv);
          expect(iv.backing?.lv.v ?? iv.backing?.lv.b, it).toBe(p.lv.v ?? p.lv.b);
          for (let t = performance.now() + 16; iv.anim; t += 16) {
            if (!iv.anim(t)) iv.anim = null;
            iv.applyFold();
          }
          frame(v);
          expect(iv.offBy(iv.frameOf(p.lv), v.cam), `${it}: its own frame`).toBeLessThanOrEqual(2);
        }
      }

      // A group above an order: a tap on its label lands on its own frame; a tap from there goes in, a double tap back out.
      const stood = new Set<string>();
      for (const name of ['Metatheria', 'Afrotheria']) {
        const u = v.fan.nodes.find((q) => latinOf(q.split) === name)!;
        expect(isLevel(v.fan, u), `${name} stays no level`).toBe(false);
        v.cam = { ...iv.frameOf({ v: u }) };
        const c = frame(v);
        const names = check(v, c, `${name}'s frame`, bad);
        console.log(`[${gaps}] ${name}'s frame: ${names.join(', ')}`);
        expect(names.length).toBeGreaterThanOrEqual(1);
        const land = () => {
          for (let t = performance.now() + 16; iv.anim; t += 16) {
            if (!iv.anim(t)) iv.anim = null;
            iv.applyFold();
          }
          return frame(v);
        };
        const p = c.pics[0];
        v.tap(p.x, p.y);
        expect(iv.backing?.lv.v ?? iv.backing?.lv.b, `${name}: second tap`).toBe(p.lv.v ?? p.lv.b);
        land();
        expect(iv.offBy(iv.frameOf(p.lv), v.cam), `${name}: second tap's frame`).toBeLessThanOrEqual(2);
        const fromIn = { ...v.cam };
        v.doubleTap(195, 400);
        land();
        expect(v.cam.sx, `${name}: double tap goes out`).toBeLessThan(fromIn.sx + 1e-9);
        stood.add(`${name}: ${nameOfLv(p.lv)} then out (level ${v.levelNow(true).v ? levelName(v.levelNow(true).v!) : '-'})`);
        // (From there double taps go on out, by the levels, to home at the last.)
        for (let i = 0; i < 12 && iv.offBy(v.homeCamera(), v.cam) > 2; i++) {
          const was = v.cam.sx;
          v.doubleTap(195, 400);
          land();
          expect(v.cam.sx, `${name}: double tap ${i} never zooms in`).toBeLessThanOrEqual(was + 1e-9);
        }
        expect(iv.offBy(v.homeCamera(), v.cam), `${name}: double taps reach home`).toBeLessThanOrEqual(2);
        // (A label at its own frame: a tap goes on a level deeper, it doesn't sit.)
        if (name === 'Afrotheria') {
          const own = v.fan.nodes.filter((q) => isLevel(v.fan, q) && q.parent && q.strands.length >= 8).find((q) => {
            v.cam = { ...iv.frameOf({ v: q }) };
            return frame(v).pics.some((r) => r.lv.v === q);
          });
          console.log(`[${gaps}] a label at its own frame: ${own ? levelName(own) : 'none'}`);
          if (own) {
            const pic = v.cutLast!.pics.find((r) => r.lv.v === own)!;
            v.tap(pic.x, pic.y);
            land();
            expect(iv.offBy(iv.frameOf({ v: own }), v.cam), 'a tap on it moves').toBeGreaterThan(2);
          }
        }
      }
      console.log(`[${gaps}] taps above orders: ${[...stood].join(' | ')}`);
      // The screens named in the report.
      for (const t of ['Rodentia', 'Chiroptera', 'Primates', 'Carnivora', 'Felidae']) {
        const u = v.fan.nodes.find((q) => q.split.taxon === t)!;
        v.cam = { ...iv.frameOf({ v: u }) };
        const names = check(v, frame(v), `${t}'s frame`, bad);
        console.log(`[${gaps}] screen ${t}: ${names.length}: ${names.join(', ')}`);
      }

      // A steady pinch, about the middle of each of the big orders: the set changes rarely, nothing jumps.
      for (const t of ['Rodentia', 'Chiroptera', 'Carnivora', 'Primates']) {
        const u = v.fan.nodes.find((q) => q.split.taxon === t)!;
        const to = iv.frameOf({ v: u });
        const a = v.homeCamera();
        const N = 240;
        let [changes, jumps, was] = [0, 0, ''];
        let last = new Map<string, number>();
        let most = 0;
        let shift = 0;
        let back = 0;
        let had = new Set<string>();
        const gone = new Set<string>();
        for (let i = 0; i <= N; i++) {
          const f = i / N;
          const sx = a.sx * (to.sx / a.sx) ** f;
          // (The world point under the frame's centre closes in as the zoom grows, as a pinch about it does.)
          const k = (1 / sx - 1 / to.sx) / (1 / a.sx - 1 / to.sx || 1);
          v.cam = { ...a, sx, sy: a.sy * (to.sy / a.sy) ** f, cx: to.cx + (a.cx - to.cx) * k, cy: to.cy + (a.cy - to.cy) * k, ty: a.ty * (to.ty / a.ty) ** f };
          const c = frame(v);
          const seen = check(v, c, `${t} pinch ${i}`, bad);
          if (i % 40 === 0) console.log(`[${gaps}] ${t} pinch ${i}/${N}, zoom ${(sx / a.sx).toFixed(1)}: ${seen.length}: ${seen.join(', ')}`);
          const now = c.spots.map((s) => s.key).join();
          const moved = now !== was && i > 0;
          if (moved) changes++;
          was = now;
          const pos = new Map(c.spots.map((s) => [s.key, s.x]));
          for (const [key, x] of pos) {
            const x0 = last.get(key);
            // (Each frame's zoom moves a branch by the zoom's share of its distance from the screen's centre.)
            if (x0 !== undefined) {
              if (moved) shift = Math.max(shift, Math.abs(x - x0));
              else most = Math.max(most, Math.abs(x - x0));
              if (!moved && Math.abs(x - x0) > 24) jumps++;
            }
          }
          last = pos;
          // (Flicker: a group back on after leaving, at the one level.)
          for (const key of pos.keys()) if (!had.has(key) && gone.has(key)) back++;
          for (const key of had) if (!pos.has(key)) gone.add(key);
          had = new Set(pos.keys());
        }
        console.log(`[${gaps}] pinch home -> ${t}: ${N} steps, ${changes} set changes, ${back} back after leaving; largest step ${most.toFixed(1)} px, at a set change ${shift.toFixed(1)} px`);
        expect(jumps).toBe(0);
        expect(changes).toBeLessThanOrEqual(N / 4);
      }
      // What a frame's labels cost, per mode (ms, labelMs, this machine with a stub canvas): at home, and over a pinch.
      const mean = (a: number[]) => a.reduce((n, x) => n + x, 0) / a.length;
      for (const mode of ['cut', 'groups'] as const) {
        setLabelMode(mode);
        const home = v.homeCamera();
        const run = (cams: (typeof home)[]) => {
          v.labelMs.length = 0;
          for (const c of cams) {
            v.cam = { ...c };
            frame(v);
          }
          return mean(v.labelMs.slice(1));
        };
        const rest = run(Array.from({ length: 40 }, () => home));
        const pinch = run(Array.from({ length: 40 }, (_, i) => ({ ...home, sx: home.sx * 1.04 ** i })));
        console.log(`[${gaps}] labelMs ${mode}: home ${rest.toFixed(2)}, pinch ${pinch.toFixed(2)}`);
      }
      setLabelMode('groups');
      expect(bad.slice(0, 20)).toEqual([]);
    });
});

describe('a pan keeps the cover (ToLaD#431, #440)', () => {
  for (const gaps of ['groups', 'clades'] as GapMode[])
    it(`mammals, gaps ${gaps}`, { timeout: 600_000 }, async () => {
      await loadMammalsFromFiles();
      setGapMode(gaps);
      setLabelMode('groups');
      const v = stubView();
      const home = v.homeCamera();
      const bad: string[] = [];
      // From the tree's one end to its other, in steps of a thumb's nudge, at home's zoom and a little in.
      for (const zoom of [1, 1.2, 1.5, 2.5]) {
        const a = { ...home, sx: home.sx * zoom };
        let [frames, changes, jumps, back, step, shift, was] = [0, 0, 0, 0, 0, 0, ''];
        let last = new Map<string, number>();
        const gone = new Set<string>();
        for (let d = -1000; d <= 1000; d += 10) {
          v.cam = { ...a, cx: a.cx + d / a.sx };
          const c = frame(v);
          const at = `zoom ${zoom}, pan ${d}`;
          check(v, c, at, bad);
          frames++;
          // A pan is smooth: the set changes rarely, and a label slides.
          const key = c.spots.map((s) => s.key).join();
          const moved = was !== '' && key !== was;
          if (moved) changes++;
          was = key;
          const pos = new Map(c.spots.map((s) => [s.key, s.x]));
          for (const [k, x] of pos) {
            const x0 = last.get(k);
            if (x0 === undefined) {
              if (gone.has(k)) back++;
              continue;
            }
            if (moved) shift = Math.max(shift, Math.abs(x - x0));
            else {
              step = Math.max(step, Math.abs(x - x0));
              if (Math.abs(x - x0) > 24) jumps++;
            }
          }
          for (const k of last.keys()) if (!pos.has(k)) gone.add(k);
          last = pos;
        }
        console.log(`[${gaps}] pan, zoom ${zoom}: ${frames} frames, ${changes} set changes, ${back} back after leaving; largest step ${step.toFixed(1)} px, at a set change ${shift.toFixed(1)} px`);
        expect(jumps).toBe(0);
      }
      expect(bad.slice(0, 20)).toEqual([]);
    });
});

describe('a pan never changes the cut (ToLaD#440: "zooming changes the levels but moving around the graphs shouldnt")', () => {
  for (const gaps of ['groups', 'clades'] as GapMode[])
    it(`mammals, gaps ${gaps}`, { timeout: 600_000 }, async () => {
      await loadMammalsFromFiles();
      setGapMode(gaps);
      setLabelMode('groups');
      const v = stubView();
      const home = v.homeCamera();
      const bad: string[] = [];
      for (const zoom of [1, 1.5, 2, 2.5, 4, 8, 16]) {
        const a = { ...home, sx: home.sx * zoom };
        const span = (v.w * zoom) / 2 + v.w;
        let key = '';
        const used = new Map<FanBranch, Level>();
        let [frames, absent] = [0, 0];
        for (let d = -span; d <= span; d += Math.max(10, span / 100)) {
          v.cam = { ...a, cx: a.cx + d / a.sx };
          const c = frame(v);
          coverCheck(v, c, `zoom ${zoom}, pan ${d.toFixed(0)}`, bad);
          frames++;
          const list = v.coverLast!.list.map((g) => g.k).join();
          if (key && list !== key) bad.push(`zoom ${zoom}, pan ${d.toFixed(0)}: the list changed`);
          key = list;
          for (const p of c.pics) for (const s of p.lv.v ? p.lv.v.strands : [p.lv.b!]) {
            const was = used.get(s);
            if (was && (was.v ?? was.b) !== (p.lv.v ?? p.lv.b)) bad.push(`zoom ${zoom}: ${s.sp.sci} under ${nameOfLv(was)} and ${nameOfLv(p.lv)}`);
            used.set(s, p.lv);
          }
          absent += v.coverLast!.list.filter((g) => v.toScreen(g.b, 0)[0] >= 0 && v.toScreen(g.a, 0)[0] <= v.w).length - c.pics.length;
        }
        listCheck(v, `zoom ${zoom}`, bad);
        console.log(`[${gaps}] pan at zoom ${zoom}: list of ${v.coverLast!.list.length}, ${frames} frames, ${absent} labels absent at edges (farthest strand so far ${farthest.toFixed(1)} px from its edge)`);
      }
      // Monotonic: as the zoom grows a group only splits.
      let merges = 0;
      let last: { f: number; l: number }[] = [];
      const zooms = Array.from({ length: 120 }, (_, i) => 1.05 ** i);
      v.cam = { ...home };
      v.labelMs.length = 0;
      for (const z of zooms) {
        v.cam = { ...home, sx: home.sx * z };
        frame(v);
        const list = v.coverLast!.list;
        // (Both lists run over the strands in order: a group merged if it runs past the one its first strand was in.)
        let j = 0;
        for (const g of list) {
          while (j < last.length && last[j].l < g.f) j++;
          if (j < last.length && g.l > last[j].l) merges++;
        }
        last = list;
      }
      const t0 = v.labelMs.reduce((n, x) => n + x, 0);
      console.log(`[${gaps}] monotonic over zoom 1..${zooms[119].toFixed(0)}: ${merges} merges, labelMs ${(t0 / zooms.length).toFixed(1)} a frame, most ${Math.max(...v.labelMs).toFixed(1)}`);
      expect(bad.slice(0, 20)).toEqual([]);
    });
});
