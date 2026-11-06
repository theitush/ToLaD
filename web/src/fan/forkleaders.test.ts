// The fork names on leaders (ToLaD#434, `?forknames=leaders`): at mammals' home, its orders' frames and over a pinch and
// a pan: no name meets another, a fork's horizontal, a picture, a name pill, the gutter or the foot; no leader crosses
// another or runs under a name; each leader's near end is on its fork; a tap lands as a tap on an at-the-fork name.
// Logs what it buys against the names at their forks, the draw's cost, and the largest jump along a steady gesture.
import { afterAll, describe, expect, it } from 'vitest';
import { setGapMode } from './fold';
import { forkLeaders, FORK_H, segMeetsBox, segsCross, setForkLeaders, setForkNames, type Brackets, type ForkLines } from './brackets';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { picBox, setLabelMode } from './pics';
import { mammaliaTree } from './splits';
import { FanView, type CutLabels } from './view';

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
    get: (o, k) => (k in o ? o[k as string] : typeof k === 'string' && /^[a-z]/.test(k) && !['font', 'fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'textBaseline', 'textAlign'].includes(k) ? noop : undefined),
    set: () => true,
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

type Inner = { brackets: Brackets; applyFold(): void; cutLast: CutLabels | null; forkLinesNow(): ForkLines; axisBoxes: number[][] };
const inner = (v: FanView) => v as unknown as Inner;
const frame = (v: FanView) => {
  v.camera.settle();
  inner(v).applyFold();
  v.draw();
};
const meets = (a: readonly number[], b: readonly number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** What is wrong with this frame's names, and how many stand. */
function check(v: FanView, where: string, bad: string[]): { names: number; leaders: number; longest: number } {
  const iv = inner(v);
  const br = iv.brackets;
  const cut = iv.cutLast!;
  const L = iv.forkLinesNow();
  const obstacles = [...cut.spots, ...cut.names].filter((s) => s.fit > 0.3).map((s) => s.box as readonly number[]);
  obstacles.push(...cut.pics.map(picBox));
  obstacles.push(...iv.axisBoxes);
  const boxes: number[][] = [];
  let leaders = 0;
  let longest = 0;
  for (let k = 0; k < br.forkN; k++) {
    const f = br.forks[k];
    const b = [f.x - f.pw / 2, f.y - FORK_H / 2, f.x + f.pw / 2, f.y + FORK_H / 2];
    const name = `${where}: ${br.list[f.i].latin}`;
    if (b[0] < 72 || b[2] > v.w || b[3] > br.forkFoot + 1e-6) bad.push(`${name} off its bounds ${b}`);
    for (const o of obstacles) if (meets(b, o)) bad.push(`${name} on a label ${o}`);
    for (const o of boxes) if (meets(b, o)) bad.push(`${name} on a name ${o}`);
    for (let j = 0; j < L.n; j++) if (L.xy[4 * j] < b[2] && L.xy[4 * j + 1] > b[0] && L.xy[4 * j + 2] > b[1] && L.xy[4 * j + 2] < b[3]) bad.push(`${name} on a fork at ${L.xy[4 * j + 2]}`);
    boxes.push(b);
    if (br.hit(f.x, f.y) !== br.list[f.i]) bad.push(`${name}: a tap on it is not it`);
    if (Number.isNaN(f.ax)) continue;
    leaders++;
    longest = Math.max(longest, Math.hypot(f.x - f.ax, f.y - f.ay));
    const j = L.at.get(br.list[f.i].v);
    if (j !== undefined && (Math.abs(L.xy[4 * j + 2] - f.ay) > 1e-6 || f.ax < L.xy[4 * j] - 1e-6 || f.ax > L.xy[4 * j + 1] + 1e-6)) bad.push(`${name}: its leader's end ${f.ax},${f.ay} is off its fork`);
    for (const o of obstacles) if (segMeetsBox(f.ax, f.ay, f.x, f.y, o[0], o[1], o[2], o[3])) bad.push(`${name}: its leader under a label ${o}`);
  }
  for (let k = 0; k < br.forkN; k++) {
    const f = br.forks[k];
    if (Number.isNaN(f.ax)) continue;
    for (let j = 0; j < br.forkN; j++) {
      if (j === k) continue;
      const g = br.forks[j];
      if (segMeetsBox(f.ax, f.ay, f.x, f.y, g.x - g.pw / 2, g.y - FORK_H / 2, g.x + g.pw / 2, g.y + FORK_H / 2)) bad.push(`${where}: ${br.list[f.i].latin}'s leader under ${br.list[g.i].latin}`);
      if (j > k && !Number.isNaN(g.ax) && segsCross(f.ax, f.ay, f.x, f.y, g.ax, g.ay, g.x, g.y)) bad.push(`${where}: ${br.list[f.i].latin}'s leader crosses ${br.list[g.i].latin}'s`);
    }
  }
  return { names: br.forkN, leaders, longest };
}

const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1] ?? 0;

/** A steady gesture from camera `v.cam`, `steps` frames: the largest jump of a name off its fork from one frame to the next, the jumps past a pill's height, the names that come and go. */
function sweep(v: FanView, where: string, steps: number, step: () => void, bad: string[]): { jump: number; jumps: number; flips: number; ms: number } {
  const br = inner(v).brackets;
  let last = new Map<string, [number, number]>();
  let jump = 0;
  let jumps = 0;
  let flips = 0;
  for (let s = 0; s < steps; s++) {
    step();
    frame(v);
    check(v, `${where} ${s}`, bad);
    const now = new Map<string, [number, number]>();
    for (let k = 0; k < br.forkN; k++) {
      const f = br.forks[k];
      if (!Number.isNaN(f.ax)) now.set(br.list[f.i].latin, [f.x - f.ax, f.y - f.ay]);
    }
    if (s > 0) {
      for (const [n, o] of now) {
        const l = last.get(n);
        if (!l) {
          flips++;
          continue;
        }
        const d = Math.hypot(o[0] - l[0], o[1] - l[1]);
        jump = Math.max(jump, d);
        if (d > FORK_H) jumps++;
      }
      for (const n of last.keys()) if (!now.has(n)) flips++;
    }
    last = now;
  }
  return { jump, jumps, flips, ms: median(v.labelMs.slice(-steps)) };
}

const PLACES: [string, string | null][] = [
  ['home', null],
  ['Rodentia', 'Rodentia'],
  ['Chiroptera', 'Chiroptera'],
  ['Primates', 'Primates'],
  ['Carnivora', 'Carnivora'],
];

describe('fork names on leaders (ToLaD#434)', () => {
  afterAll(() => {
    setForkLeaders(false);
    setForkNames(true);
    setLabelMode('cut');
    setGapMode('groups');
  });
  // (Labels and gaps as the app will ship, Ita 2026-11-06.)
  for (const labels of ['groups'] as const)
    it(`mammals, labels ${labels}, gaps clades`, { timeout: 600_000 }, async () => {
      await loadMammalsFromFiles();
      setLabelMode(labels);
      setGapMode('clades');
      setForkNames(true);
      const v = stubView();
      const bad: string[] = [];
      const camOf = (lv: string | null) => (lv ? v.levelCamera(lv)! : v.homeCamera());
      for (const [where, lv] of PLACES) {
        v.cam = camOf(lv);
        setForkLeaders(false);
        frame(v);
        frame(v);
        const atFork = inner(v).brackets.forkN;
        const atMs = median(Array.from({ length: 9 }, () => (frame(v), v.labelMs[v.labelMs.length - 1])));
        setForkLeaders(true);
        frame(v);
        frame(v);
        const r = check(v, where, bad);
        const leadMs = median(Array.from({ length: 9 }, () => (frame(v), v.labelMs[v.labelMs.length - 1])));
        console.log(`[${labels}] ${where}: names at the fork ${atFork}, on leaders ${r.names} (${r.leaders} with a leader, longest ${r.longest.toFixed(0)} px, ${inner(v).forkLinesNow().n} forks); labelMs at fork ${atMs.toFixed(2)}, leaders ${leadMs.toFixed(2)}`);
      }
      // A steady pinch and pan from each, on leaders.
      for (const [where, lv] of PLACES) {
        for (const on of [false, true]) {
          setForkLeaders(on);
          v.cam = camOf(lv);
          frame(v);
          frame(v);
          const pinch = sweep(v, `${where} pinch`, 80, () => (v.cam = { ...v.cam, sx: v.cam.sx * 1.012, cx: v.cam.cx + 0.3 / v.cam.sx, sy: v.cam.sy * 1.004, ty: v.cam.sy * 1.004 }), on ? bad : []);
          v.cam = camOf(lv);
          frame(v);
          frame(v);
          const pan = sweep(v, `${where} pan`, 80, () => (v.cam = { ...v.cam, cx: v.cam.cx + 2 / v.cam.sx }), on ? bad : []);
          if (on) console.log(`[${labels}] ${where}: pinch: largest jump ${pinch.jump.toFixed(0)} px, ${pinch.jumps} jumps past a pill, ${pinch.flips} come or go, labelMs ${pinch.ms.toFixed(2)}; pan: largest jump ${pan.jump.toFixed(0)} px, ${pan.jumps} jumps, ${pan.flips} come or go`);
          else console.log(`[${labels}] ${where}: at fork pinch labelMs ${pinch.ms.toFixed(2)}`);
        }
      }
      expect(forkLeaders()).toBe(true);
      console.log(`[${labels}] bad: ${bad.length}\n${bad.slice(0, 30).join('\n')}`);
      expect(bad.slice(0, 20)).toEqual([]);
    });
});
