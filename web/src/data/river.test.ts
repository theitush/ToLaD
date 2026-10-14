// Real-data tests: tile decoding against debug_top.json, the births-rate width
// integrating to EVER (area = individuals ever lived), children nesting inside
// their parent, and layout stability when a tile arrives.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Camera } from '../engine/camera';
import { Layout, RIVER_S, type LNode } from '../engine/layout';
import { decodeFile, profileEdges } from './tolad-decoder.js';
import { processBuffer, rateSamples, S, type ProcessedFile } from './river';
import { TileTreeSource } from './tile-source';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', '..', 'data', 'mammals');
const bytes = (p: string) => new Uint8Array(readFileSync(join(DATA, p)));
const load = (tile: number): ProcessedFile => processBuffer(bytes(tile < 0 ? 'skeleton.tld' : `t/${tile}.tld`), tile);
const dump = JSON.parse(readFileSync(join(DATA, 'debug_top.json'), 'utf8'));
const skel = load(-1);

const closeLog = (a: number, b: number, dex: number) => (a === 0 || b === 0 ? a === b : Math.abs(Math.log10(a) - Math.log10(b)) <= dex);

describe('tile loading and decoding', () => {
  it('skeleton rows match debug_top.json', () => {
    expect(skel.n).toBe(dump.nodes.length);
    for (let i = 0; i < skel.n; i++) {
      const j = dump.nodes[i];
      expect(skel.gid[i]).toBe(j.gid);
      expect(skel.nameBlob.slice(skel.nameOff[i], skel.nameOff[i + 1]).split('|')[0]).toBe(j.name);
      const pr = skel.parent[i];
      expect(pr < 0 ? null : skel.gid[pr]).toBe(j.parent_gid);
      expect(skel.stubTile[i] < 0 ? null : skel.stubTile[i]).toBe(j.stub_tile);
      expect(closeLog(skel.age0[i], j.t0_Ma, 0.001)).toBe(true);
      expect(closeLog(skel.age1[i], j.t1_Ma, 0.001)).toBe(true);
      expect(closeLog(skel.ever[i], j.ever, 0.002)).toBe(true);
      expect(closeLog(skel.alive[i], j.alive, 0.002)).toBe(true);
      expect(closeLog(skel.ghost[i], j.ghost, 0.002)).toBe(true);
    }
    expect(skel.meta.tiles.length).toBe(dump.tiles.length);
    expect(skel.meta.mock_individuals.length).toBe(dump.mock_individuals.length);
  });

  it('every tile decodes; its root equals the stub row that points to it', () => {
    const src = new TileTreeSource(skel);
    for (const t of skel.meta.tiles) {
      const p = load(t.id);
      expect(p.gid[0]).toBe(t.root_gid);
      expect(p.n).toBe(t.nodes);
      const h = src.home.get(p.gid[0]);
      expect(h, `stub for tile ${t.id}`).toBeTruthy();
      const s = h!.f.p;
      const r = h!.row;
      expect(s.stubTile[r]).toBe(t.id);
      expect(p.ever[0]).toBe(s.ever[r]);
      expect(p.age0[0]).toBe(s.age0[r]);
      expect(p.age1[0]).toBe(s.age1[r]);
      // Identical sample times: children of the tile root are placed against the stub's polyline.
      for (let k = 0; k < S; k++) expect(p.sT[k]).toBe(s.sT[r * S + k]);
      src.add(p);
    }
    expect(src.home.size).toBe(skel.meta.total_nodes);
  });
});

describe('births-rate width (area = individuals ever lived)', () => {
  it('each band integrates to EVER and follows its 16-bin profile', () => {
    for (const file of ['skeleton.tld', 't/5.tld', 't/0.tld']) {
      const f = decodeFile(bytes(file));
      const { T, R, scale } = rateSamples(f);
      let nearOne = 0;
      for (let i = 0; i < f.n; i++) {
        const span = (f.t0(i) - f.t1(i)) * 1e6;
        let area = 0;
        for (let k = 1; k < S; k++) area += ((R[i * S + k] + R[i * S + k - 1]) / 2) * (T[i * S + k] - T[i * S + k - 1]) * span;
        expect(Math.abs(area / f.ever(i) - 1)).toBeLessThan(1e-9);
        if (Math.abs(Math.log(scale[i])) < Math.log(1.25)) nearOne++;
        // Shape: the width at the middle of the widest old bin is within a factor 2 of that bin's mean rate.
        const prof = f.profile(i);
        const e = profileEdges(f.t0(i), f.t1(i));
        const mid = (e[15] + e[16]) / 2;
        const Tm = (f.t0(i) - mid) / (f.t0(i) - f.t1(i));
        let k = 0;
        while (k < S - 2 && Tm > T[i * S + k + 1]) k++;
        const u = (Tm - T[i * S + k]) / (T[i * S + k + 1] - T[i * S + k]);
        const w = R[i * S + k] + (R[i * S + k + 1] - R[i * S + k]) * u;
        if (prof[15] > 0) expect(closeLog(w, prof[15], Math.log10(2))).toBe(true);
      }
      // The scale that makes the area exact is a small correction, not a reshaping.
      expect(nearOne / f.n).toBeGreaterThan(0.9);
    }
  });

  it('the root band drawn by the layout has area = EVER; children never exceed theirs', () => {
    // The whole tree, every tile loaded: which nodes the skeleton holds is where the pipeline's greedy tile cut
    // happens to fall, and the MDD tree (#278) moved it so the skeleton is 2,368 fossils and 14 living nodes
    // (main's: 1,539 and 832), so a skeleton-only median measured the cut, not the layout (0.60 vs 0.76).
    const src = new TileTreeSource(skel);
    for (const t of skel.meta.tiles) src.add(load(t.id));
    const L = new Layout(src);
    const root = L.root;
    L.ensureShape(root);
    const rmax = Math.max(...Array.from(rateSamples(decodeFile(bytes('skeleton.tld'))).R.subarray(0, S)));
    const span = (skel.age0[0] - skel.age1[0]) * 1e6;
    // Width in rate units = (R-L) * xs * rmax.
    const area = (n: LNode, unit: number) => {
      const T = n.rv!.T;
      const o = n.rv!.o;
      let a = 0;
      for (let k = 1; k < RIVER_S; k++) {
        const w0 = (n.R![k - 1] - n.L![k - 1]) * unit;
        const w1 = (n.R![k] - n.L![k]) * unit;
        a += ((w0 + w1) / 2) * (T[o + k] - T[o + k - 1]);
      }
      return a;
    };
    expect(Math.abs((area(root, root.cxs * rmax) * span) / skel.ever[0] - 1)).toBeLessThan(1e-6);
    // Children: absolute width unit = parent unit * child xs, time unit = parent span * ts.
    let ratios: number[] = [];
    const walk = (n: LNode, unit: number, tspan: number) => {
      for (const c of L.children(n)) {
        const cu = unit * L.xs(c);
        const ct = tspan * c.ts;
        const h = src.home.get(Number(c.id.slice(1)))!;
        const r = (area(c, cu) * ct) / h.f.p.ever[h.row];
        ratios.push(r);
        expect(r).toBeLessThan(1 + 1e-6);
        walk(c, cu, ct);
      }
    };
    walk(root, root.cxs * rmax, span);
    ratios = ratios.sort((a, b) => a - b);
    // Coarse profiles of siblings can add up to more than the parent at some times; then they are squeezed to fit.
    // Over the whole tree the median is 0.696 on the tree before MDD and 0.699 with it (#278: unchanged); the floor
    // of 0.7 was set on the skeleton alone, whose living clades sat higher (0.80), so the whole tree's floor is 0.65.
    expect(ratios.length).toBeGreaterThan(20000);
    expect(ratios[Math.floor(ratios.length / 2)]).toBeGreaterThan(0.65);
  });
});

describe('nesting and layout stability', () => {
  function frames(cam: Camera, nodes: LNode[]) {
    return nodes.map((n) => ({ ...cam.frameOf(n) }));
  }
  function collect(L: Layout, n: LNode, out: LNode[], depth: number) {
    out.push(n);
    if (depth > 0) for (const c of L.children(n)) collect(L, c, out, depth - 1);
  }
  function checkNesting(L: Layout, n: LNode): number {
    let checked = 0;
    const e: [number, number] = [0, 1];
    for (const c of L.children(n)) {
      L.ensureShape(c);
      for (let k = 0; k < RIVER_S; k++) {
        const Tc = c.rv!.T[c.rv!.o + k];
        const Tp = c.t0 + c.ts * Tc;
        L.edgesAt(n, Tp, e);
        const x0 = L.x0(c);
        const xs = L.xs(c);
        const l = x0 + xs * c.L![k];
        const r = x0 + xs * c.R![k];
        // Inside the parent band at the child's own sample times (parent units).
        expect(l).toBeGreaterThanOrEqual(e[0] - 1e-9);
        expect(r).toBeLessThanOrEqual(e[1] + 1e-9);
        checked++;
      }
      checked += checkNesting(L, c);
    }
    return checked;
  }

  it('children nest inside their parent band, in both width modes', () => {
    const src = new TileTreeSource(skel);
    src.add(load(5));
    const L = new Layout(src);
    for (const m of [0, 1, 0.5]) {
      L.setMix(m);
      expect(checkNesting(L, L.root)).toBeGreaterThan(1000);
    }
  });

  it('already placed nodes do not move when a tile loads', async () => {
    const src = new TileTreeSource(skel, async (t) => load(t));
    const L = new Layout(src);
    const cam = new Camera(L, 390, 844);
    const before: LNode[] = [];
    collect(L, L.root, before, 40);
    const eutheria = before.find((n) => n.id === `g${skel.meta.tiles[0].root_gid}`)!;
    expect(eutheria).toBeTruthy();
    expect(L.children(eutheria).length).toBe(0);
    expect(src.pending(eutheria.src as never)).toBe(true);
    const f0 = frames(cam, before);
    for (const m of [0, 1]) {
      L.setMix(m);
      const fm = frames(cam, before);
      await src.loadTile(0);
      await src.loadTile(11);
      L.invalidate();
      const fm2 = frames(cam, before);
      expect(fm2).toEqual(fm);
    }
    L.setMix(0);
    expect(frames(cam, before)).toEqual(f0);
    // The stub now has children, laid out inside it.
    const kids = L.children(eutheria);
    expect(kids.length).toBeGreaterThan(0);
    expect(checkNesting(L, eutheria)).toBeGreaterThan(10);
  });
});
