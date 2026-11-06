// Labels are the real groups one level down (ToLaD#417, `?labels=groups`), at mammals, checked by code at every level
// on the way down, under `clades` and the default gaps: every label names a group of nextLevels(L), L the smallest named
// level holding what is on screen; no two meet, none off screen or left of the axis, none with a "+x" or a leader; every
// picture's centre on its own branch at "now"; a tap lands on its group's frame; a steady pinch changes the set rarely
// and moves a label smoothly.
import { afterAll, describe, expect, it } from 'vitest';
import { groupName, levelName, FanView, isLevel, nextLevels, type CutLabels, type Level } from './view';
import { latinOf } from './brackets';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { GROUP_D, LABEL_AXIS_X, PIC_D, setLabelMode } from './pics';
import { chooseSlots, placeSlots, type Slot } from './slide';
import { mammaliaTree } from './splits';
import { setGapMode, type GapMode } from './fold';
import type { FanNode } from './layout';

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
const levelOf = (v: FanView) => (v.groupsOf ? v.fan.nodes.indexOf(v.groupsOf) : -1);
const nameOfLv = (lv: Level) => (lv.v ? levelName(lv.v) : lv.b!.sp.common);

/** One frame's invariants; returns its labels' names. */
function check(v: FanView, c: CutLabels, at: string, bad: string[]): string[] {
  const L = v.groupsOf;
  if (!c.pics.length) return [];
  if (!L) {
    bad.push(`${at}: labels with no level`);
    return [];
  }
  const groups = new Set(nextLevels(v.fan, L).map((g) => g.v ?? g.b));
  const now = v.fan.time.y(0);
  const pics = [...c.pics].sort((p, q) => p.x - q.x);
  for (let i = 0; i < pics.length; i++) {
    const p = pics[i];
    const s = c.spots[p.i];
    if (!groups.has(p.lv.v ?? p.lv.b!)) bad.push(`${at}: ${nameOfLv(p.lv)} is no group of ${levelName(L)}`);
    if (p.x - PIC_D / 2 < LABEL_AXIS_X - 1e-6 || p.x + PIC_D / 2 > v.w + 1e-6) bad.push(`${at}: ${nameOfLv(p.lv)} off screen at ${p.x.toFixed(1)}`);
    if (i && p.x - pics[i - 1].x < GROUP_D - 1e-6) bad.push(`${at}: ${nameOfLv(p.lv)} meets ${nameOfLv(pics[i - 1].lv)}`);
    if (/\+\d/.test(s.text) || s.over || s.plus) bad.push(`${at}: ${s.text} has a "+x" or a leader`);
    if (s.box[0] > p.x || s.box[2] < p.x || s.box[3] > p.y) bad.push(`${at}: ${s.text}'s pill is not over its picture`);
    // Its centre on its own branch, at the row it stands on.
    const strands = p.lv.v ? p.lv.v.strands : [p.lv.b!];
    const young = Math.min(...strands.map((b) => Math.max(b.tipY, now)));
    const on = strands.filter((b) => Math.max(b.tipY, now) <= young + 1e-9).map((b) => v.model(b).lanes(young));
    const a = v.toScreen(Math.min(...on.map((m) => m.left)), 0)[0];
    const b = v.toScreen(Math.max(...on.map((m) => m.left + m.w)), 0)[0];
    // (Its centre on its branch; a branch nearer the screen's edge than a picture's half: the picture whole against that edge, the branch under it.)
    const pinned = Math.abs(p.x - (LABEL_AXIS_X + PIC_D / 2)) < 1e-6 ? b >= LABEL_AXIS_X : Math.abs(p.x - (v.w - PIC_D / 2)) < 1e-6 ? a <= v.w : false;
    if ((p.x < a - 1e-6 || p.x > b + 1e-6) && !pinned) bad.push(`${at}: ${nameOfLv(p.lv)} at ${p.x.toFixed(1)} is off its branch ${a.toFixed(1)}..${b.toFixed(1)}`);
  }
  return pics.map((p) => nameOfLv(p.lv));
}

afterAll(() => {
  setLabelMode('cut');
  setGapMode('groups');
});

describe('placing on branches (slide.ts)', () => {
  const S = (lo: number, hi: number): Slot => ({ lo, hi, at: (lo + hi) / 2 });
  it('a wide branch makes way for a narrow one, a heavier one first', () => {
    const slots = [S(100, 200), S(150, 150), S(160, 160)];
    const on = chooseSlots(slots, [1, 0, 2], 40);
    expect(on).toEqual([0, 1]);
    const xs = placeSlots(slots, on, 40);
    expect(xs[1]).toBe(150);
    expect(xs[0]).toBeLessThanOrEqual(110);
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

describe('labels are the groups one level down (?labels=groups, ToLaD#417)', () => {
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
      console.log(`[${gaps}] home (L ${v.groupsOf && levelName(v.groupsOf)}): ${names.length}: ${names.join(', ')}`);
      expect(v.groupsOf).toBe(v.fan.root);
      {
        const named = v.fan.nodes.filter((u) => isLevel(v.fan, u) && u.parent && u.strands.length >= 20 && levelName(u) === latinOf(u.split)).sort((p, q) => q.strands.length - p.strands.length);
        const kin = named.filter((u) => groupName(v.fan, u) !== levelName(u));
        console.log(`[${gaps}] ${named.length} big levels with Latin only, ${kin.length} told by a part: ${named.slice(0, 40).map((u) => `${levelName(u)} = ${groupName(v.fan, u)}`).join(' | ')}`);
      }
      expect(names.length).toBeGreaterThanOrEqual(4);
      const frames: string[] = [];
      let notOwn = 0;
      let framed = 0;
      let sum = 0;
      let [total, edgeL, edgeR, crowded] = [0, 0, 0, 0];
      const visit = (u: FanNode, depth: number) => {
        v.cam = { ...iv.frameOf({ v: u }) };
        const c = frame(v);
        const at = levelName(u);
        const here = check(v, c, at, bad);
        sum += here.length;
        framed++;
        if (v.groupsOf !== u) {
          notOwn++;
          if (notOwn <= 12) console.log(`[${gaps}] ${at} (${u.strands.length} species) framed: L ${v.groupsOf && levelName(v.groupsOf)}`);
        }
        // (Each group here without a label, by why: its branch nearer the screen's edge than a picture's half.)
        const shown = new Set(c.pics.map((p) => p.lv.v ?? p.lv.b!));
        for (const g of nextLevels(v.fan, u)) {
          total++;
          if (shown.has(g.v ?? g.b!)) continue;
          const st = g.v ? g.v.strands : [g.b!];
          const m = st.map((b) => v.model(b).lanes(Math.max(b.tipY, v.fan.time.y(0))));
          const x0 = v.toScreen(Math.min(...m.map((q) => q.left)), 0)[0];
          const x1 = v.toScreen(Math.max(...m.map((q) => q.left + q.w)), 0)[0];
          if (x1 < LABEL_AXIS_X + PIC_D / 2) {
            edgeL++;
            if (edgeL <= 8) console.log(`[${gaps}] ${at}: ${nameOfLv(g)} at ${x0.toFixed(1)}..${x1.toFixed(1)}`);
          } else if (x0 > v.w - PIC_D / 2) edgeR++;
          else crowded++;
        }
        if (depth <= 1) frames.push(`${at}: ${here.length}/${nextLevels(v.fan, u).length}: ${here.slice(0, 7).join(', ')}`);
        if (depth < 2) for (const g of nextLevels(v.fan, u)) if (g.v && g.v.strands.length >= 8) visit(g.v, depth + 1);
      };
      for (const g of nextLevels(v.fan, v.fan.root)) if (g.v && g.v.strands.length >= 30) visit(g.v, 0);
      console.log(`[${gaps}] ${framed} frames, ${notOwn} whose L is not the group framed; ${total} groups: ${edgeL} left of a picture's half from the axis, ${edgeR} from the right edge, ${crowded} crowded out\n` + frames.slice(0, 30).join('\n'));
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

      // A steady pinch, about the middle of each of the big orders: the set changes rarely, nothing jumps.
      for (const t of ['Rodentia', 'Chiroptera', 'Carnivora']) {
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
        const levels = new Set<unknown>();
        for (let i = 0; i <= N; i++) {
          const f = i / N;
          const sx = a.sx * (to.sx / a.sx) ** f;
          // (The world point under the frame's centre closes in as the zoom grows, as a pinch about it does.)
          const k = (1 / sx - 1 / to.sx) / (1 / a.sx - 1 / to.sx || 1);
          v.cam = { ...a, sx, sy: a.sy * (to.sy / a.sy) ** f, cx: to.cx + (a.cx - to.cx) * k, cy: to.cy + (a.cy - to.cy) * k, ty: a.ty * (to.ty / a.ty) ** f };
          const c = frame(v);
          check(v, c, `${t} pinch ${i}`, bad);
          const now = c.spots.map((s) => s.key).join();
          const moved = now !== was && i > 0;
          if (moved) changes++;
          was = now;
          levels.add(v.groupsOf);
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
          for (const key of pos.keys()) if (!had.has(key) && gone.has(`${String(levelOf(v))}:${key}`)) back++;
          for (const key of had) if (!pos.has(key)) gone.add(`${String(levelOf(v))}:${key}`);
          had = new Set(pos.keys());
        }
        console.log(`[${gaps}] pinch home -> ${t}: ${N} steps, ${changes} set changes, ${levels.size} levels, ${back} back after leaving; largest step ${most.toFixed(1)} px, at a set change ${shift.toFixed(1)} px`);
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
