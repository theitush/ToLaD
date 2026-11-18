// A count nobody has, drawn as one thin dashed line (ToLaD#565) on the amniotes (ToLaD#539: every reptile, the birds
// Callaghan 2021 lacks, every fossil): a merged clade (lod.ts) none of whose species has a count is one dashed line, at its
// centre, from its top down to where it joins a column with a count in it; a clade with any counted species is the band
// it was; a lone such species is a dashed line down to its split. `?unknown=faint`, the old look: bands, no dash
// anywhere. Drawn as FanGL draws: its batches, the chords as SEG_VS takes them. (The mammals' own, one species:
// unknown.test.tsx.) One process: the level's data is module state, so this file loads only the amniotes. (Each frame
// test ~5 s alone; 300 s, as the load's, for a machine shared with other runs.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Camera, FanCamera } from './camera';
import { allUnknown, cladeDashes, DASH_SKIP, DASH_SPACE, setUnknownLook, strandDashes } from './dashed';
import { setFlip } from './flip';
import type { FanBranch, FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { Batches, expandChords, RectBatch, SEG_F } from './meshgl';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import type { Steady } from './steady';
import { CHORD_STYLE, FanView } from './view';

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
  g.window = { devicePixelRatio: 2, setTimeout: () => 0, addEventListener: noop, removeEventListener: noop };
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
    // (On its side, as on a phone 390 x 844.)
    getBoundingClientRect: () => ({ width: 700, height: 390, left: 0, top: 0, right: 700, bottom: 390 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

type Priv = {
  anim: ((t: number) => boolean) | null;
  camera: FanCamera;
  gl: Batches & { end(): void };
  drawMerged(v: FanNode, top?: number): void;
  drawStrand(b: FanBranch): void;
};
const P = (v: FanView) => v as unknown as Priv;

/** What one column sent this frame: its chords, dashed or band, each with its rows on screen. */
interface Sent {
  dash: { y0: number; y1: number; c: number }[];
  band: { y0: number; y1: number }[];
}

describe('a count nobody has, one dashed line, on the amniotes (ToLaD#565)', () => {
  let v: FanView;
  let home: Camera;
  const merged = new Map<FanNode, Sent>();
  const strands = new Map<FanBranch, Sent>();
  beforeAll(async () => {
    await loadMammalsFromFiles('amniotes');
    setFlip(true);
    v = stubView();
    home = v.homeCamera();
    P(v).gl = Object.assign(new Batches(), { end() {} });
    // (Each column's chords: those it sends to the batch while it is drawn.)
    const sent = (from: number): Sent => {
      const S = P(v).gl.segs;
      const out: Sent = { dash: [], band: [] };
      if (!S) return out;
      for (let j = from; j < S.n; j++) {
        const o = SEG_F * j;
        const y0 = S.f[o + 3];
        const y1 = y0 + S.f[o + 7];
        if (S.f[o + 15] > 0.5) out.dash.push({ y0, y1, c: S.f[o] });
        else out.band.push({ y0, y1 });
      }
      return out;
    };
    const I = P(v);
    const dm = I.drawMerged.bind(v);
    I.drawMerged = (u, top) => {
      const n = I.gl.segs?.n ?? 0;
      dm(u, top);
      merged.set(u, sent(n));
    };
    const ds = I.drawStrand.bind(v);
    I.drawStrand = (b) => {
      const n = I.gl.segs?.n ?? 0;
      ds(b);
      strands.set(b, sent(n));
    };
  }, 300_000);
  afterAll(() => {
    setFlip(false);
    setUnknownLook('dashed');
  });

  const stand = (c: Camera) => {
    P(v).anim = null;
    (v.fan.tess.fold as Steady).setScale(c.sx, v.w);
    v.cam = { ...c, ty: c.sy };
    P(v).camera.settle();
    for (let k = 0; k < 3; k++) v.draw();
    merged.clear();
    strands.clear();
    v.draw();
  };
  const node = (taxon: string) => v.fan.nodes.find((u) => u.split.taxon === taxon)!;
  const sy = (y: number) => P(v).camera.screenY(y);

  /** Every column drawn this frame as the rule has it: no count in its column, a dashed line (or nothing: another's holds it); a count, its band. */
  const holds = (what: string) => {
    let lines = 0;
    let bands = 0;
    for (const [u, s] of merged) {
      const all = allUnknown(v.fan, u);
      if (!all) {
        // (A clade with a counted species in it: the band it was, all down.)
        expect(s.dash.length, `${what}: ${u.name} has counts, no dash`).toBe(0);
        if (s.band.length) bands++;
        continue;
      }
      // Its own column, from its top down to its parent's split: dashed, never a band.
      const foot = sy(u.yBot);
      for (const c of s.band) expect((c.y0 + c.y1) / 2, `${what}: ${u.name}, a band chord in its own column`).toBeGreaterThan(foot);
      if (s.dash.some((c) => (c.y0 + c.y1) / 2 < foot)) lines++;
      // Below, in a parent column with no count either: the line its first strand's holder draws, at that column's centre; else a band.
      const D = cladeDashes(v.fan, u);
      for (const c of s.band) {
        const y = P(v).camera.worldY((c.y0 + c.y1) / 2);
        for (let k = 0; k < D.length; k += 3) if (y > D[k] && y < D[k + 1]) throw new Error(`${what}: ${u.name}, a band chord where it has no count (${y})`);
      }
    }
    return { lines, bands };
  };

  it('the rule: a clade none of whose species has a count is one dashed line; one with a count stays a band', () => {
    const f = v.fan;
    // (The lizards and snakes, the turtles: every one without a count. The birds with a count, Aves: not; nor Amniota, nor Dinosauria (birds in it).)
    for (const t of ['Squamata', 'Testudines', 'Crocodylia']) expect(allUnknown(f, node(t)), t).toBe(true);
    for (const t of ['Aves', 'Mammalia', 'Amniota', 'Dinosauria', 'Archosauria']) expect(allUnknown(f, node(t)), t).toBe(false);
    // A merged Squamata: its line from its top down to its foot, its parents with no counts on down at their centres, held by their first strand.
    const sq = node('Squamata');
    const D = cladeDashes(f, sq);
    expect(D.slice(0, 3)).toEqual([-Infinity, sq.yBot, 0]);
    for (let k = 3, u = sq.parent!; k < D.length; k += 3, u = u.parent!) {
      expect(allUnknown(f, u)).toBe(true);
      expect(D.slice(k, k + 3)).toEqual([u.y, u.yBot, u.strands[0] === sq.strands[0] ? (u.width - sq.width) / 2 : DASH_SKIP]);
    }
    // A lizard: its own column, then the same for its parents.
    const liz = f.branches.find((b) => b.sp.sci === 'Lacerta agilis')!;
    expect(liz.sp.countUnknown).toBe(true);
    expect(strandDashes(f, liz).slice(0, 3)).toEqual([-Infinity, liz.splitY, 0]);
    // A bird with a count, a mammal: none.
    for (const n of ['Passer domesticus', 'Homo sapiens']) expect(strandDashes(f, f.branches.find((b) => b.sp.sci === n)!), n).toEqual([]);
  }, 300_000);

  it('home: the reptiles\' merged clades dashed lines, the birds\' and mammals\' bands', () => {
    stand(home);
    const { lines, bands } = holds('home');
    expect(lines).toBeGreaterThan(0);
    expect(bands).toBeGreaterThan(0);
    // (Some all-unknown clade drawn: the lizards' and snakes' line, or one of its own.)
    const lizards = [...merged.keys()].filter((u) => allUnknown(v.fan, u) && u.strands.some((b) => b.sp.sci === 'Lacerta agilis'));
    expect(lizards.length).toBe(1);
    expect(merged.get(lizards[0])!.dash.length).toBeGreaterThan(0);
  }, 300_000);

  it('the lizards and snakes framed: their clades and lone species dashed lines, none a band', () => {
    stand(v.levelCamera('Squamata')!);
    const { lines } = holds('Squamata');
    expect(lines).toBeGreaterThan(0);
    // A lone species: no band chord in its own column (its tip down to its split), a dashed line there.
    let lone = 0;
    for (const [b, s] of strands) {
      if (!b.sp.countUnknown) continue;
      const split = sy(b.splitY);
      for (const c of s.band) expect((c.y0 + c.y1) / 2, `${b.sp.sci}: a band chord in its own column`).toBeGreaterThan(split);
      if (s.dash.length) lone++;
    }
    expect(lone + merged.size).toBeGreaterThan(0);
  }, 300_000);

  it('no two dashed lines closer than DASH_SPACE on screen: lines packed closer are their clade\'s one line, parting as the view zooms in', () => {
    const near: string[] = [];
    let parted = 0;
    for (const t of ['home', 'Squamata', 'Scincidae', 'Lacertidae']) {
      stand(t === 'home' ? home : v.levelCamera(t)!);
      const S = P(v).gl.segs;
      let worst = Infinity;
      let lines = 0;
      for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const y = fy * v.h;
        const xs: number[] = [];
        for (let j = 0; j < S.n; j++) {
          const o = SEG_F * j;
          if (!(S.f[o + 15] > 0.5) || S.f[o + 3] > y || S.f[o + 3] + S.f[o + 7] < y) continue;
          const u = (y - S.f[o + 3]) / S.f[o + 7];
          xs.push(S.f[o] + (S.f[o + 4] - S.f[o]) * u);
        }
        xs.sort((a, b) => a - b);
        // (One line drawn by more than one chord at a row's height (a chord's end on it) is one line.)
        const X = xs.filter((x, k) => k === 0 || x - xs[k - 1] > 1e-3);
        lines = Math.max(lines, X.length);
        for (let k = 1; k < X.length; k++) worst = Math.min(worst, X[k] - X[k - 1]);
      }
      near.push(`${t}: ${lines} lines a row at most, the closest ${worst.toFixed(2)} px`);
      expect(worst, t).toBeGreaterThanOrEqual(DASH_SPACE - 0.05);
      if (t !== 'home') parted = Math.max(parted, lines);
    }
    console.log(near.join('\n'));
    // (Zoomed in, the lizards' and snakes' lines part: more than one line a row.)
    expect(parted).toBeGreaterThan(1);
  }, 300_000);

  it('the dashed chords as SEG_VS spreads them (expandChords) are the trapezoids drawn on the CPU (a batch that takes no chords)', () => {
    const gl = P(v).gl;
    const under = new RectBatch();
    const over = new RectBatch();
    const cpu = { under, over, begin: () => void (under.n = over.n = 0), end() {} } as unknown as Priv['gl'];
    const spread = new RectBatch();
    try {
      for (const c of [home, v.levelCamera('Squamata')!, v.levelCamera('Lacertidae')!]) {
        stand(c);
        // (Drawn until the frame holds still: the columns' paths are made a few a frame after a move, twigs.ts pathFrame.)
        for (let k = 0, n = -1; k < 12 && gl.segs.n !== n; k++) {
          n = gl.segs.n;
          v.draw();
        }
        let dashed = 0;
        for (let j = 0; j < gl.segs.n; j++) if (gl.segs.f[SEG_F * j + 15] > 0.5) dashed++;
        expect(dashed).toBeGreaterThan(0);
        expandChords(gl, v.w, CHORD_STYLE, spread);
        P(v).gl = cpu;
        v.draw();
        P(v).gl = gl;
        expect(spread.n).toBe(under.n);
        // (Positions to float32's rounding of the chords' ends, colours to a step of 255, as chords.test holds the bands.)
        for (let i = 0; i < 12 * under.n; i++) {
          const k = i % 12;
          const tol = k >= 4 && k <= 6 ? 1 / 255 + 1e-6 : k === 7 ? 1e-4 : 1e-3 + 1e-6 * Math.abs(under.f[i]);
          if (!(Math.abs(under.f[i] - spread.f[i]) <= tol)) expect([i, under.f[i]]).toEqual([i, spread.f[i]]);
        }
      }
    } finally {
      P(v).gl = gl;
    }
  }, 300_000);

  it('`?unknown=faint`, the old look: bands, no dash anywhere', () => {
    setUnknownLook('faint');
    try {
      for (const c of [home, v.levelCamera('Squamata')!]) {
        stand(c);
        const S = P(v).gl.segs;
        for (let j = 0; j < S.n; j++) expect(S.f[SEG_F * j + 15]).toBe(0);
      }
      // (The lizards' clade at home: a band again.)
      stand(home);
      const liz = [...merged.entries()].find(([u]) => u.strands.some((b) => b.sp.sci === 'Lacerta agilis'))!;
      expect(liz[1].band.length).toBeGreaterThan(0);
      expect(liz[1].dash.length).toBe(0);
    } finally {
      setUnknownLook('dashed');
    }
  }, 300_000);
});
