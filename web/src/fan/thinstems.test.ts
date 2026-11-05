// A stem wider than it is tall draws as a line (ToLaD#402, `forks: thin`): measured at the draw itself at the frame Ita
// saw it at, the marsupials among the mammals, and through a pinch; `flat` and `peel` keep their cuts; a look only.
import { afterAll, describe, expect, it } from 'vitest';
import type { FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { FORK_MODES, forkMode, setForkMode, stemShare, Steady } from './steady';
import { FanView } from './view';

await loadMammalsFromFiles();

function stubView(): { v: FanView; under: RectBatch } {
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
  const v = new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
  const gl = { under: new RectBatch(), over: new RectBatch(), begin() {}, end() {} };
  gl.begin = () => {
    gl.under.n = 0;
    gl.over.n = 0;
  };
  (v as unknown as { gl: unknown }).gl = gl;
  Object.assign(v, { labelsNow: () => ({ br: null, cut: null }), drawLabels: noop, drawTimeAxis: noop, drawEvents: noop, drawTrunkLabel: noop, drawWidthScale: noop, drawGutter: noop, drawTouch: noop });
  return { v, under: gl.under };
}

type Cam = { screenX(x: number): number; screenY(y: number): number; worldY(y: number): number; settle(): void };
const camOf = (v: FanView) => (v as unknown as { camera: Cam }).camera;
const W = 390;
const H = 844;

/** The stems on screen at this camera: each drawn node's stretch from its split up to its parent's fork, on screen px. */
function stemsOn(v: FanView) {
  v.draw();
  const f = v.fan.tess.fold as Steady;
  const lod = v.lodNow();
  const cam = camOf(v);
  const { sx, sy } = v.cam;
  const c: number[] = [];
  const out: { n: FanNode; x: number; w: number; top: number; bot: number }[] = [];
  for (const n of v.fan.nodes) {
    if (!n.parent || lod?.hidden(n)) continue;
    f.corner(n.parent, sx, sy, c);
    const q = n.parent.kids.indexOf(n);
    const top = cam.screenY(lod?.isMerged(n) ? Math.max(Math.min(...n.strands.map((b) => b.tipY)), v.fan.time.y(0)) : n.y);
    const bot = cam.screenY(n.parent.y - f.forkH(n.parent));
    const w = n.width * sx;
    const x = cam.screenX(c[2 * q]) - w / 2;
    if (x + w < 0 || x > W || bot < 0 || top > H) continue;
    out.push({ n, x, w, top, bot });
  }
  return out;
}

const mark = forkMode();
afterAll(() => setForkMode(mark));

describe('thin stems: at the marsupial frame', () => {
  const { v, under } = stubView();
  const frame = (wx = 1) => {
    const h = v.levelCamera('Metatheria')!;
    v.cam = { ...h, sx: h.sx * wx };
    camOf(v).settle();
  };
  const rowsAt = (py: number, x0: number, x1: number) => {
    const r: number[][] = [];
    for (let k = 0; k < under.n; k++) {
      const o = k * 12;
      const F = under.f;
      if (F[o + 1] > py || F[o + 3] < py) continue;
      // (A corner's flat line, across any stems at its height, is what a line is.)
      if (Math.abs(F[o + 3] - F[o + 1] - 1) < 1e-3) continue;
      const l = Math.min(F[o], F[o] + F[o + 8]);
      const R = Math.max(F[o + 2], F[o + 2] + F[o + 9]);
      if (R < x0 || l > x1) continue;
      r.push([l, R, F[o + 7]]);
    }
    return r;
  };

  it('`thin` is the default, and the button goes through all three', () => {
    expect(mark).toBe('thin');
    expect(FORK_MODES).toEqual(['thin', 'flat', 'peel']);
  });

  for (const wx of [1, 2.5]) {
    it(`no stem wider than tall stands at full width (${wx}x the frame's width)`, () => {
      setForkMode('thin');
      frame(wx);
      const stems = stemsOn(v);
      const wide = stems.filter((s) => s.w > 4 && s.w > s.bot - s.top);
      expect(wide.length).toBeGreaterThan(10);
      for (const s of wide) {
        const py = (Math.max(s.top, 0) + Math.min(s.bot, H)) / 2;
        // Nothing across it at its middle reaches its width (its solid backdrop included): threads and lines.
        const across = rowsAt(py, s.x + 1, s.x + s.w - 1).filter(([, , a]) => a === 1);
        for (const [l, r] of across) {
          expect(r - l, `${s.n.split.taxon ?? s.n.name}: ${s.w.toFixed(1)} px wide, ${(s.bot - s.top).toFixed(1)} tall`).toBeLessThan(s.w);
        }
      }
    });
  }

  it('a line meets its daughters: under a stem gone to a line every daughter has a corner, and each stem line runs from the fork below to its own split', () => {
    setForkMode('thin');
    frame();
    const stems = stemsOn(v);
    const f = v.fan.tess.fold as Steady;
    const { sx, sy } = v.cam;
    const c: number[] = [];
    const st: number[] = [];
    let lines = 0;
    const lod = v.lodNow();
    for (const s of stems) {
      const S = stemShare(s.n.width, (s.bot - s.top) / sy, sx, sy);
      if (S > 0 || lod?.isMerged(s.n)) continue;
      lines++;
      const pc = camOf(v).screenX(f.corner(s.n, sx, sy, c, st));
      expect(Math.abs(pc - (s.x + s.w / 2))).toBeLessThan(1e-6);
      s.n.kids.forEach((_, q) => expect(c[2 * q + 1], 'peel share under a line').toBe(0));
      // Its own line from its parent's corner.
      const p = s.n.parent!;
      f.corner(p, sx, sy, c, st);
      const q = p.kids.indexOf(s.n);
      expect(c[2 * q + 1], "its own peel's share").toBe(0);
      expect(st[2 * q]).toBe(0);
      expect(camOf(v).screenY(st[2 * q + 1])).toBeCloseTo(s.top, 6);
    }
    expect(lines).toBeGreaterThan(5);
  });

  it('`flat` cuts peels alone, `peel` nothing: stems stand whole', () => {
    frame();
    for (const mode of ['flat', 'peel'] as const) {
      setForkMode(mode);
      v.draw();
      const f = v.fan.tess.fold as Steady;
      const { sx, sy } = v.cam;
      for (const n of v.fan.nodes) expect(f.stemAt(v.fan.nodes.indexOf(n), sx, sy)).toBe(1);
    }
    setForkMode('flat');
    const f = v.fan.tess.fold as Steady;
    const cam = camOf(v);
    const cuts: number[] = [];
    for (const b of v.fan.branches) {
      f.strandForks(b.index, v.cam.sx, v.cam.sy, cam.worldY(-20), cam.worldY(H + 20), cuts);
      for (let i = 0; i < cuts.length; i += 3) {
        const onSplit = cuts[i + 1] === b.splitY || b.path.some((s) => s.node.y === cuts[i + 1]);
        expect(onSplit, 'a cut in `flat` ends on a split').toBe(true);
      }
    }
  });
});
