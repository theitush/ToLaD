// A stem wider than it is tall draws as a line (ToLaD#402, `forks: thin`): measured at the draw itself at the frame Ita
// saw it at, the marsupials among the mammals, and through a pinch; `flat` and `peel` keep their cuts; a look only.
import { afterAll, describe, expect, it } from 'vitest';
import { leftAt, type FanBranch, type FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { RectBatch } from './meshgl';
import { CARNIVORA, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, mammaliaTree, type Split } from './splits';
import { FORK_MODES, forkMode, LABEL_PILL, setForkMode, stemShare, Steady, type ForkMode } from './steady';
import { FanView } from './view';

await loadMammalsFromFiles();

function stubView(clade: CladeRec = mammaliaClade(), tree: Split = mammaliaTree()): { v: FanView; under: RectBatch; over: RectBatch } {
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
  const v = new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, true);
  const gl = { under: new RectBatch(), over: new RectBatch(), begin() {}, end() {} };
  gl.begin = () => {
    gl.under.n = 0;
    gl.over.n = 0;
  };
  (v as unknown as { gl: unknown }).gl = gl;
  Object.assign(v, { labelsNow: () => ({ br: null, cut: null }), drawLabels: noop, drawTimeAxis: noop, drawEvents: noop, drawTrunkLabel: noop, drawWidthScale: noop, drawGutter: noop, drawTouch: noop });
  return { v, under: gl.under, over: gl.over };
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

describe('thin stems: a column a user sees as a branch never goes', () => {
  const { v, under, over } = stubView(CARNIVORA, CARNIVORA_TREE);
  v.setMode('linear');
  const fan = () => v.fan;
  const sp = (common: string) => fan().branches.find((b) => b.sp.common === common)!;
  type Camera = typeof v.cam;
  const tapFrame = (b: FanBranch): Camera => (v as unknown as { frameOf(l: { b: FanBranch }): Camera }).frameOf({ b });
  /** designshot's 'bar' scenes: a species' column `ago` years back, `perBar` individuals to the 70 px scale bar. */
  const bar = (common: string, ago: number, perBar: number, sy: number): Camera => {
    const b = sp(common);
    const cy = fan().time.y(ago / 1e6);
    const c = { cx: 0, cy, sx: 70 / perBar / b.unit, sy, ty: sy };
    v.cam = { ...c };
    camOf(v).settle();
    const L = v.model(b).lanes(cy);
    return { ...c, cx: L.left + L.gw };
  };
  const sent = (cam: Camera, mode: ForkMode) => {
    setForkMode(mode);
    v.cam = { ...cam };
    camOf(v).settle();
    v.draw();
    return [under, over].map((r) => Array.from(r.f.subarray(0, r.n * 12)));
  };
  /** What is solid on screen, on a 4 px grid: a filled cell where a rectangle or trapezoid sent to the GPU, at half alpha or more, covers it. */
  const solid = (cam: Camera, mode: ForkMode) => {
    sent(cam, mode);
    const cols = Math.floor(W / 4);
    const rows = Math.floor(H / 4);
    const g = new Uint8Array(cols * rows);
    const F = under.f;
    for (let k = 0; k < under.n; k++) {
      const o = k * 12;
      if (F[o + 7] < 0.5) continue;
      const [y0, y1] = [F[o + 1], F[o + 3]];
      for (let r = Math.max(0, Math.ceil(y0 / 4)); r <= Math.min(rows - 1, Math.floor(y1 / 4)); r++) {
        const t = (r * 4 - y0) / (y1 - y0);
        let [l, R] = [F[o] + t * F[o + 8], F[o + 2] + t * F[o + 9]];
        if (F[o + 10] < F[o + 11]) [l, R] = [Math.max(l, F[o + 10]), Math.min(R, F[o + 11])];
        for (let c = Math.max(0, Math.ceil(l / 4)); c <= Math.min(cols - 1, Math.floor(R / 4)); c++) g[r * cols + c] = 1;
      }
    }
    return g;
  };
  /** The share of the screen `flat` fills and `thin` leaves empty. */
  const lost = (cam: Camera) => {
    const a = solid(cam, 'flat');
    const b = solid(cam, 'thin');
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] && !b[i]) n++;
    return n / a.length;
  };

  const deep: [string, number, number, number][] = [
    ['deep', 300, 4, 3000],
    ['bar-100', 3000, 100, 40],
    ['bar-1e3', 3000, 1e3, 40],
    ['nearnow', 25, 2e3, 900],
  ];
  for (const [name, ago, perBar, sy] of deep) {
    it(`deep on the Lion (${name}): \`thin\` sends the GPU what \`flat\` does`, () => {
      const cam = bar('Lion', ago, perBar, sy);
      expect(sent(cam, 'thin')).toEqual(sent(cam, 'flat'));
      expect(solid(cam, 'thin').reduce((n, c) => n + c, 0)).toBeGreaterThan(0.9 * Math.floor(W / 4) * Math.floor(H / 4));
    });
  }

  // (Each of these went blank, all or most of the screen, while the rule still let a width count up to the screen's.)
  const between: [string, number, number, number][] = [
    ['Lion', 1e6, 1e5, 40],
    ['Lion', 2e6, 1e4, 40],
    ['Lion', 3e6, 1e6, 40],
    ['Grey wolf', 2e6, 1e4, 40],
    ['Grey wolf', 8e6, 1e4, 100],
    ['Grey wolf', 8e6, 1e3, 300],
    ['Northern raccoon', 2e7, 1e5, 100],
  ];
  for (const [common, ago, perBar, sy] of between) {
    it(`in between: ${common} ${ago / 1e6} Ma, ${perBar} to the bar, sy ${sy}: the screen stays lit`, () => {
      expect(lost(bar(common, ago, perBar, sy))).toBeLessThan(0.25);
    });
  }

  it("every species' own column stands at its tap's frame, and with width zoomed further: the screen it fills in `flat` stays lit", () => {
    let frames = 0;
    for (const b of fan().branches) {
      for (const wx of [1, 3, 10]) {
        const f = tapFrame(b);
        const cam = { ...f, sx: f.sx * wx };
        expect(lost(cam), `${b.sp.common} ×${wx}`).toBeLessThan(0.25);
        frames++;
      }
    }
    expect(frames).toBeGreaterThan(100);
  }, 120000);

  it("at the Lion's tap's frame its column is as `flat` draws it, across its width at its mid-height, at every width zoom", () => {
    const b = sp('Lion');
    for (const wx of [1, 3, 10]) {
      const f = tapFrame(b);
      const cf = { ...f, sx: f.sx * wx };
      const flat = solid(cf, 'flat');
      const g = solid(cf, 'thin');
      const cam = camOf(v);
      const y = (b.tipY + (b.splitY - (v.fan.tess.fold as Steady).forkH(b.node))) / 2;
      const c0 = cam.screenX(leftAt(b, y));
      const c1 = c0 + b.width * v.cam.sx;
      const row = Math.round(cam.screenY(y) / 4) * Math.floor(W / 4);
      const [first, last] = [Math.ceil(Math.max(c0, 0) / 4), Math.floor((Math.min(c1, W) - 1) / 4)];
      let lit = 0;
      for (let c = first; c <= last; c++) {
        lit += g[row + c];
        expect(g[row + c], `×${wx}, ${c * 4} px`).toBe(flat[row + c]);
      }
      expect(lit, `×${wx}`).toBeGreaterThan(3);
    }
  });

  it('the cap: a stem as tall as a pill stands however wide, one at half of it is a line once wider than that, and a narrow one goes by its own width', () => {
    const [sx, sy] = [1, 1];
    expect(stemShare(1e6, LABEL_PILL, sx, sy)).toBe(1);
    expect(stemShare(1e6, LABEL_PILL / 2, sx, sy)).toBe(0);
    expect(stemShare(1e6, (3 * LABEL_PILL) / 4, sx, sy)).toBeCloseTo(2 / 3, 9);
    expect(stemShare(6, 3, sx, sy)).toBe(0);
    expect(stemShare(6, 6, sx, sy)).toBe(1);
    // A function of the camera alone, in height and width together: scale both and nothing moves under the cap.
    expect(stemShare(6, 4, 2, 2)).toBe(stemShare(6, 4, 1, 1));
  });
});
