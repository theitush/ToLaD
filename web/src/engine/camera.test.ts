import { describe, expect, it } from 'vitest';
import { Camera } from './camera';
import { DiveDriver } from './dive';
import { frame, toChild, toParent, zoomFrame } from './frame';
import { Layout, type LNode } from './layout';
import { SyntheticTree } from './tree';

const W = 390;
const H = 844;

function setup() {
  const layout = new Layout(new SyntheticTree(1));
  const cam = new Camera(layout, W, H);
  return { layout, cam };
}

function close(a: number, b: number, tol = 1e-9) {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  expect(Math.abs(a - b) / scale).toBeLessThan(tol);
}

describe('frame math', () => {
  it('toChild and toParent are inverse', () => {
    const f = frame(12.5, 300, 800, 700);
    const c = toChild(frame(), f, 0.25, 0.125, 0.375, 0.5);
    const p = toParent(frame(), c, 0.25, 0.125, 0.375, 0.5);
    close(p.ox, f.ox);
    close(p.kx, f.kx);
    close(p.oy, f.oy);
    close(p.kt, f.kt);
  });

  it('child band is nested inside parent band on screen', () => {
    const f = frame(10, 300, 800, 700);
    const c = toChild(frame(), f, 0.25, 0.5, 0.2, 0.5);
    expect(c.ox).toBeCloseTo(10 + 300 * 0.25);
    expect(c.kx).toBeCloseTo(150);
    // T grows upward: child bottom (T=0) is at parent T=0.2
    expect(c.oy).toBeCloseTo(800 - 700 * 0.2);
    expect(c.kt).toBeCloseTo(350);
  });

  it('zoom keeps the focus point fixed, separately per axis', () => {
    const f = frame(10, 300, 800, 700);
    const X = (100 - f.ox) / f.kx;
    const T = (f.oy - 400) / f.kt;
    zoomFrame(f, 100, 400, 3, 0.5);
    close(f.ox + f.kx * X, 100);
    close(f.oy - f.kt * T, 400);
    expect(f.kx).toBe(900);
    expect(f.kt).toBe(350);
  });
});

describe('camera', () => {
  it('starts with the root fitted and anchored near it', () => {
    const { cam, layout } = setup();
    const r = cam.frameOf(layout.root);
    close(r.kx, W * 0.88);
    close(r.kt, H * 0.88);
    expect(cam.anchor.depth).toBeGreaterThanOrEqual(0);
  });

  it('re-anchoring never moves anything on screen', () => {
    const { cam, layout } = setup();
    // Track a handful of nodes near the screen centre.
    let n: LNode = layout.root;
    const tracked: LNode[] = [];
    for (let d = 0; d < 6; d++) {
      tracked.push(n);
      n = layout.children(n)[0];
    }
    for (let i = 0; i < 60; i++) {
      const before = tracked.map((t) => ({ ...cam.frameOf(t) }));
      const anchorBefore = cam.anchor.depth;
      cam.zoomAt(W / 2 + 3, H / 2 - 7, 1.2, 1.1);
      const after = tracked.map((t) => cam.frameOf(t));
      tracked.forEach((_, j) => {
        // predicted: zoom about (px,py)
        close(after[j].ox, W / 2 + 3 + (before[j].ox - (W / 2 + 3)) * 1.2, 1e-9);
        close(after[j].kx, before[j].kx * 1.2, 1e-9);
        close(after[j].oy, H / 2 - 7 + (before[j].oy - (H / 2 - 7)) * 1.1, 1e-9);
        close(after[j].kt, before[j].kt * 1.1, 1e-9);
      });
      expect(cam.anchor.depth).toBeGreaterThanOrEqual(anchorBefore - 1);
    }
    expect(cam.reanchorCount).toBeGreaterThan(0);
  });

  it('keeps the anchor scale screen-sized', () => {
    const { cam, layout } = setup();
    const dive = new DiveDriver(cam, layout, 3);
    for (let i = 0; i < 400; i++) {
      dive.step();
      expect(cam.f.kx).toBeLessThan(1e7);
      expect(cam.f.kt).toBeLessThan(1e7);
    }
    expect(cam.anchor.depth).toBeGreaterThan(10);
  });

  it('pans back to exactly where it was (no drift)', () => {
    const { cam } = setup();
    for (let i = 0; i < 300; i++) cam.zoomAt(W / 2, H / 2, 1.2, 1.12);
    const a = cam.anchor;
    const ref = { ...cam.frameOf(a) };
    for (let i = 0; i < 50; i++) cam.pan(37, -23);
    for (let i = 0; i < 50; i++) cam.pan(-37, 23);
    const back = cam.frameOf(a);
    expect(Math.abs(back.ox - ref.ox)).toBeLessThan(1e-6);
    expect(Math.abs(back.oy - ref.oy)).toBeLessThan(1e-6);
  });

  it('clamps zoom-out at the root', () => {
    const { cam, layout } = setup();
    for (let i = 0; i < 100; i++) cam.zoomAt(W / 2, H / 2, 0.8, 0.8);
    const r = cam.frameOf(layout.root);
    expect(r.kx).toBeGreaterThanOrEqual(W * 0.25 - 1e-6);
    expect(r.kt).toBeGreaterThanOrEqual(H * 0.25 - 1e-6);
  });
});
