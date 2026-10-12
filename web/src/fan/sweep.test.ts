// Texture at every zoom (#100), branch-outs as lines (#101): a zoom sweep.
//
// From the home view in, about the places Ita looks at (the Felidae base, the
// Panthera splits, the lion, the domestic cat's peel off the wildcat), in both
// designs (curved, straight) and both width scales: each frame draws every
// branch's mesh as view.ts does (drawTwigs), shades it through the CPU mirror
// of the shader (mesh.ts shadeMesh) and walks every column down the screen,
// row by row. A row of a column with nothing of the mesh over it is a hole:
// the texture gone there. SWEEP=1 prints the whole table.
import { describe, expect, it } from 'vitest';
import { FanCamera } from './camera';
import { laneAt, layoutFan, leftAt, STEM_BOTTOM_MA, type EdgeStyle, type Fan, type FanBranch, type WidthMode } from './layout';
import { FELIDAE } from './panthera';
import { shadeMesh, unpackInst, type MeshInst } from './mesh';
import { MeshBatch, rgb01 } from './meshgl';
import { drawTwigs, kLogAt, LINEAGE, LIVING, TEX_HAIR_PX, TWIG_GRAY, TwigModel, type TwigView } from './twigs';

const PAL = [LIVING, LINEAGE, TWIG_GRAY].map(rgb01);
const W = 390;
const H = 844;
const ROW = 4;

(globalThis as { Path2D?: unknown }).Path2D = class {
  moveTo() {}
  lineTo() {}
  arc() {}
  bezierCurveTo() {}
};
const CTX = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;

export interface Hole {
  sp: string;
  py: number;
  wPx: number;
}

/** One frame: every column's rows (on screen, with width), and those with no mesh over them. */
export function sweepFrame(f: Fan, c: FanCamera): { rows: number; holes: Hole[] } {
  const yBottom = f.time.y(STEM_BOTTOM_MA);
  let rows = 0;
  const holes: Hole[] = [];
  for (const b of f.branches) {
    const m = new TwigModel(b, f.time, f.mode);
    const v: TwigView = {
      mesh: new MeshBatch(),
      ctx: CTX,
      w: c.w,
      h: c.h,
      sx: c.cam.sx,
      sy: c.cam.sy,
      toScreen: (x, y) => c.toScreen(x, y),
      toWorld: (x, y) => c.toWorld(x, y),
      yNow: c.yNow,
    };
    drawTwigs(v, b, m, null);
    const insts: MeshInst[] = [];
    for (let k = 0; k < v.mesh!.n; k++) insts.push(unpackInst(v.mesh!.f, v.mesh!.u, k));
    const nowPx = c.toScreen(0, c.yNow)[1];
    for (let py = ROW / 2 + 0.5; py < c.h; py += ROW) {
      const [, y] = c.toWorld(0, py);
      // (Not the tip's own last px, where the last generation ends a hair short of it.)
      if (y < b.tipY || y > yBottom || py < c.toScreen(0, b.tipY)[1] + 2) continue;
      const L = laneAt(b, y);
      const wPx = L.w * c.cam.sx;
      // (A column of under two individuals has its one line somewhere in it, not in every row's
      // piece of it on screen: the domestic cat's founders in log widths, under one alive, ~9 kya.)
      if (!(wPx > 0) || m.totalSlots(y) < 2) continue;
      // (A hairline column, its widest under TEX_HAIR_PX[1] px on screen, is a plain lane by design (its texture fading in up to there): level of detail, ToLaD#146.)
      if (b.width * c.cam.sx < TEX_HAIR_PX[1]) continue;
      const colL = c.toScreen(leftAt(b, y), y)[0];
      const colR = colL + Math.max(0.6, wPx);
      // (At least a px of it on screen; cut by the screen's edge, at least 10 px across the column
      // on screen, so wider than the texture's gaps between its lines.)
      if (colR < 1 || colL > c.w - 1) continue;
      const on = Math.min(c.w, colR) - Math.max(0, colL);
      if (on < colR - colL) {
        const sl = (c.toScreen(leftAt(b, c.toWorld(0, py + 1)[1]), 0)[0] - c.toScreen(leftAt(b, c.toWorld(0, py - 1)[1]), 0)[0]) / 2;
        if (on / Math.sqrt(1 + sl * sl) < 10) continue;
      }
      rows++;
      const kLog = kLogAt(v, f.time, y);
      let best = 0;
      for (let px = Math.max(0, Math.floor(colL)) + 0.5; px < Math.min(c.w, colR + 1) && best < 0.05; px++) {
        for (const x of insts) {
          if (px < x.x0 || px >= x.x1 || py < x.y0 || py >= x.y1) continue;
          best = Math.max(best, shadeMesh(x, px, py, kLog, nowPx, PAL)[3]);
        }
      }
      if (best < 0.05) holes.push({ sp: b.sp.common, py, wPx });
    }
  }
  return { rows, holes };
}

/** A camera on world (wx, wy) at 2^k times the home view's width zoom and 2^(k·r) its time zoom. */
export function camAt(f: Fan, wx: number, wy: number, k: number, r: number): FanCamera {
  const c = new FanCamera(f, (x) => new TwigModel(x, f.time, f.mode));
  c.w = W;
  c.h = H;
  const h = c.home();
  c.cam = { cx: wx, cy: wy, sx: h.sx * 2 ** k, sy: h.sy * 2 ** (k * r), ty: h.sy * 2 ** (k * r) };
  c.settle(W / 2, H / 2, wx, wy);
  return c;
}

/** Where to zoom: a branch's column centre `ago` years back. */
function focus(f: Fan, sp: string, ago: number): [number, number] {
  const b = f.branches.find((x) => x.sp.common === sp) as FanBranch;
  const y = f.time.y(ago * 1e-6);
  return [leftAt(b, y) + laneAt(b, y).w / 2, y];
}

const FOCI: [string, string, number][] = [
  // ('Mainland leopard cat': the Red List's name, ToLaD#145.)
  ['Felidae base', 'Mainland leopard cat', 1.2e7],
  ['Panthera splits', 'Lion', 2.5e6],
  ['lion', 'Lion', 3000],
  ['domestic cat peel', 'Domestic cat', 1e4],
];

function sweep(edge: EdgeStyle, mode: WidthMode, ks: number[], rs: number[]) {
  const f = layoutFan(FELIDAE, mode, undefined, edge);
  const out: { focus: string; k: number; r: number; rows: number; holes: Hole[] }[] = [];
  for (const [name, sp, ago] of FOCI) {
    const [wx, wy] = focus(f, sp, ago);
    for (const r of rs) for (const k of ks) out.push({ focus: name, k, r, ...sweepFrame(f, camAt(f, wx, wy, k, r)) });
  }
  return out;
}

const FULL = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SWEEP;

describe('the texture at every zoom: a sweep finds no column without it', () => {
  for (const edge of ['curved', 'straight'] as const) {
    for (const mode of ['linear', 'log'] as const) {
      it(`${edge}, ${mode} widths`, () => {
        const ks = FULL ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20] : [0, 2, 5, 9, 14];
        const res = sweep(edge, mode, ks, FULL ? [0.5, 1] : [1]);
        const bad = res.filter((x) => x.holes.length > 0);
        if (FULL || bad.length) {
          for (const x of res) {
            const by = new Map<string, Hole[]>();
            for (const h of x.holes) by.set(h.sp, [...(by.get(h.sp) ?? []), h]);
            const tag = [...by].map(([sp, hs]) => `${sp} ${hs.length} (py ${hs[0].py}…${hs[hs.length - 1].py}, ${Math.min(...hs.map((h) => h.wPx)).toPrecision(2)}–${Math.max(...hs.map((h) => h.wPx)).toPrecision(2)} px)`).join('; ');
            console.log(`${edge} ${mode} ${x.focus} k=${x.k} r=${x.r}: ${x.rows} rows, ${x.holes.length} holes${tag ? ': ' + tag : ''}`);
          }
        }
        expect(bad.map((x) => `${x.focus} k=${x.k}: ${x.holes.length}`)).toEqual([]);
      }, 600_000);
    }
  }
});
