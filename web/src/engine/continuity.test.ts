// Random deep-zoom continuity test.
//
// Zooms programmatically into a pseudo-random descendant chain for more than
// 1000 levels. At every step it predicts, analytically, where the tracked node
// (the current chain target and its parent) must land after the pan+zoom, and
// checks that:
//   1. the camera (float64, re-anchoring) puts it exactly there, and
//   2. the scene the GPU would draw (float32 chunk geometry times the
//      per-chunk transform, emulated with Math.fround, or the float64 near
//      path) puts its edges within a small pixel tolerance of that.
// A re-anchor glitch shows up as a jump (teleport), float32 trouble as jitter,
// and a missing chunk/near instance as the node vanishing.

import { describe, expect, it } from 'vitest';
import { Camera } from './camera';
import { DiveDriver } from './dive';
import type { Frame } from './frame';
import { Layout, type LNode } from './layout';
import { SceneBuilder, INST_FLOATS } from './scene';
import { SyntheticTree, TAPER_IN, TAPER_OUT } from './tree';

const W = 390;
const H = 844;
const fr = Math.fround;

interface Edges {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

function edgesOf(f: Frame, n: LNode): Edges {
  return {
    left: f.ox,
    right: f.ox + f.kx,
    bottom: f.oy - f.kt * TAPER_IN,
    top: f.oy - f.kt * (n.alive ? 1 : 1 - TAPER_OUT),
  };
}

/** Where the GPU would draw the node's body edges, or null if the scene does not draw it. */
function drawnEdges(scene: SceneBuilder, n: LNode): Partial<Edges> | null {
  for (const d of scene.draws) {
    const idx = d.chunk.nodes.findIndex((c) => c.id === n.id);
    if (idx < 0) continue;
    const o = (d.chunk.nodeFirst[idx] + 1) * INST_FLOATS; // body is the 2nd trapezoid
    const a = d.chunk.data;
    const X = (v: number) => fr(fr(d.f.ox) + fr(fr(d.f.kx) * v));
    const Y = (v: number) => fr(fr(d.f.oy) - fr(fr(d.f.kt) * v));
    return { left: X(a[o]), right: X(a[o + 1]), bottom: Y(a[o + 6]), top: Y(a[o + 7]) };
  }
  // Near path: screen-space instances, clipped vertically.
  const near = scene.near.data;
  for (let i = 0; i < scene.near.count; i++) {
    if (scene.nearNodes[i].id !== n.id) continue;
    const o = i * INST_FLOATS;
    if (near[o] === near[o + 2] && near[o + 1] === near[o + 3]) return { left: near[o], right: near[o + 1] };
  }
  return null;
}

function relErr(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
}

function runDive(seed: number, minLevels: number, preferAlive: boolean) {
  const layout = new Layout(new SyntheticTree(seed));
  const cam = new Camera(layout, W, H);
  const scene = new SceneBuilder(layout);
  const dive = new DiveDriver(cam, layout, seed * 7919 + 1);
  dive.preferAlive = preferAlive;
  let maxCamErr = 0;
  let maxPxErr = 0;
  let steps = 0;
  let reanchorsAtStart = cam.reanchorCount;
  let checkedScene = 0;
  while (dive.levels < minLevels) {
    const op = dive.plan();
    const tracked = [dive.target, dive.target.parent!].filter(Boolean);
    const before = tracked.map((t) => ({ ...cam.frameOf(t) }));
    dive.apply(op);
    scene.build(cam);
    steps++;
    tracked.forEach((t, j) => {
      const b = before[j];
      // pan, then zoom about (px, py)
      const pred: Frame = {
        ox: op.px + (b.ox + op.dx - op.px) * op.fx,
        kx: b.kx * op.fx,
        oy: op.py + (b.oy + op.dy - op.py) * op.ft,
        kt: b.kt * op.ft,
      };
      const got = cam.frameOf(t);
      const e = Math.max(relErr(pred.ox, got.ox), relErr(pred.kx, got.kx), relErr(pred.oy, got.oy), relErr(pred.kt, got.kt));
      maxCamErr = Math.max(maxCamErr, e);
      if (e > 1e-9) throw new Error(`teleport at step ${steps}, depth ${t.depth}: rel err ${e}`);

      // What the renderer would draw. The target is on screen; once it is a
      // few px in size (right after advancing it can be sub-pixel and LOD-culled)
      // it must be drawn.
      if (j !== 0 || got.kx < 4 || got.kt < 4) return;
      const want = edgesOf(got, t);
      const drawn = drawnEdges(scene, t);
      if (!drawn) throw new Error(`target vanished at step ${steps}, depth ${t.depth}`);
      checkedScene++;
      for (const k of Object.keys(drawn) as (keyof Edges)[]) {
        const w = want[k];
        if (Math.abs(w) > 4 * Math.max(W, H)) continue; // far off screen: irrelevant
        const err = Math.abs(drawn[k]! - w);
        maxPxErr = Math.max(maxPxErr, err);
        if (err > 0.05) throw new Error(`jitter ${err}px on ${k} at step ${steps}, depth ${t.depth}`);
      }
    });
    // Memory stays bounded on long dives.
    if (steps % 200 === 0) layout.prune(cam.anchor);
  }
  return { cam, dive, steps, maxCamErr, maxPxErr, reanchors: cam.reanchorCount - reanchorsAtStart, checkedScene, scene };
}

describe('random deep-zoom continuity', () => {
  for (const [seed, alive] of [
    [1, false],
    [2, false],
    [3, true], // surviving chain: converges on the shared "now" edge
  ] as const) {
    it(`seed ${seed}${alive ? ' (survivors)' : ''}: 1000+ levels with no teleport, jitter or vanishing`, () => {
      const r = runDive(seed, 1050, alive);
      const ex = r.cam.scaleExponents();
      // eslint-disable-next-line no-console
      console.log(
        `seed ${seed}: ${r.steps} steps, ${r.dive.levels} levels, anchor depth ${r.cam.anchor.depth}, ` +
          `zoom 10^${ex.x.toFixed(0)} (x) / 10^${ex.t.toFixed(0)} (t), ${r.reanchors} re-anchors, ` +
          `max camera rel err ${r.maxCamErr.toExponential(2)}, max drawn px err ${r.maxPxErr.toExponential(2)}, ` +
          `chunks resident ${r.scene.chunks.size}`,
      );
      expect(r.dive.levels).toBeGreaterThanOrEqual(1050);
      expect(r.cam.anchor.depth).toBeGreaterThan(1000);
      expect(ex.x).toBeGreaterThan(308); // beyond any float64 global coordinate
      expect(r.reanchors).toBeGreaterThan(1000);
      expect(r.checkedScene).toBeGreaterThan(r.steps * 0.8);
      expect(r.maxCamErr).toBeLessThan(1e-9);
      expect(r.maxPxErr).toBeLessThan(0.05);
    });
  }
});
