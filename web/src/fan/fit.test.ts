// ?fit=fossils (ToLaD#289): at the Hominins and Homo levels the frame is where the fossils lived, so every hominin
// with a picture gets a column a few px wide (its name: todo); off (the default), the frame fits today's humans.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mammaliaClade, type CladeRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaTree, type Split } from './splits';
import { FanView, fossilSpan, levelName } from './view';
import type { FanNode } from './layout';
import { laneAt, leftAt } from './layout';
import { latinOf } from './brackets';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The mammals' pictures (data/mammals/wiki.json; node loads the mammals without them, mammals-node.ts). */
const WIKI = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'mammals', 'wiki.json'), 'utf8')) as Record<string, { img?: string } | null>;


function stubView(clade: CladeRec, tree: Split, folds = true): FanView {
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, 'curved', tree, folds);
}

const settle = (v: FanView) => {
  (v as unknown as { labelState: Map<string, unknown> }).labelState.clear();
  for (let k = 0; k < 3; k++) v.draw();
};

/** At level u framed (cladeCamera): each species with a picture, its widest column (px) over its life, on screen there or not, and whether its group's name shows. */
function measure(v: FanView, u: FanNode) {
  v.cam = v.cladeCamera(u);
  v.camera.settle();
  settle(v);
  const hidden = new Set(v.hiddenGroups.flatMap((g) => (g.lv.b ? [g.lv.b] : g.lv.v.strands)));
  const out: { sci: string; px: number; on: boolean; named: boolean }[] = [];
  for (const b of u.strands) {
    if (!WIKI[b.sp.sci]?.img) continue;
    let px = 0;
    let on = false;
    const hi = Math.min(b.splitY, u.yBot);
    for (let k = 0; k <= 64; k++) {
      const y = b.tipY + ((hi - b.tipY) * k) / 64 - (k === 64 ? 1e-9 : 0);
      const w = laneAt(b, y).w * v.cam.sx;
      if (w <= px) continue;
      px = w;
      const [l, sy] = v.toScreen(leftAt(b, y), y);
      on = l + w > 0 && l < v.w && sy > 0 && sy < v.h;
    }
    out.push({ sci: b.sp.sci, px, on, named: !hidden.has(b) });
  }
  return out;
}

describe('?fit=fossils: the hominins readable (ToLaD#289)', () => {
  let v: FanView;
  beforeAll(async () => {
    vi.stubEnv('TOLAD_FIT', 'fossils');
    await loadMammalsFromFiles();
    v = stubView(mammaliaClade(), mammaliaTree(), true);
  }, 400000);
  afterAll(() => vi.unstubAllEnvs());

  // Measured (hom289c): with the gaps beside a fossil at most half the narrower one's extent (steady.ts LIFE_GAP), the
  // fossils' frame is ~13x narrower than hom289b's and a pictured hominin's column is 3-5 px (Neanderthals ~50 px).
  // Narrower are the regional populations, their cited census 10,000 or fewer (the data, not the layout; ToLaD#302,
  // overrides.toml [[fossil_count]]): H. antecessor, H. naledi, H. georgicus ~1.5 px, H. floresiensis (an island) less.
  // Not every name shows yet: the pills crowd (labels' layout), so names are left todo.
  const SMALL = new Set(['Homo antecessor', 'Homo naledi', 'Homo georgicus', 'Homo floresiensis']);
  it.todo('at Hominins and Homo every hominin with a picture gets its name');
  it('at Hominins and Homo every hominin with a picture gets a column >= 3 px (but the four smallest populations)', () => {
    const by = (latin: string) => v.fan.nodes.find((u) => latinOf(u.split) === latin)!;
    const bad: string[] = [];
    for (const u of [by('Hominini'), by('Homo')])
      for (const r of measure(v, u)) {
        if (r.sci === 'Homo sapiens') continue;
        if (SMALL.has(r.sci) ? !(r.px > 0.05) : !(r.px >= 3)) bad.push(`${levelName(u)} ${r.sci}: ${r.px.toFixed(2)} px`);
      }
    expect(bad).toEqual([]);
  }, 400000);
  it('at Hominins and Homo every hominin with a picture stands on screen, the frame on the fossils (not the humans at now)', () => {
    const by = (latin: string) => v.fan.nodes.find((u) => latinOf(u.split) === latin)!;
    const bad: string[] = [];
    const lines: string[] = [];
    for (const u of [by('Hominini'), by('Homo')]) {
      expect(fossilSpan(u)).not.toBeNull();
      for (const r of measure(v, u)) {
        lines.push(`${levelName(u)} ${r.sci}: ${r.px.toFixed(1)} px${r.on ? '' : ' (off screen)'}${r.named ? '' : ' (name hidden)'}`);
        if (r.sci === 'Homo sapiens') continue;
        if (!r.on) bad.push(lines[lines.length - 1]);
        if (r.sci === 'Homo neanderthalensis' && !(r.px >= 3)) bad.push(lines[lines.length - 1]);
      }
    }
    console.log(lines.join('\n'));
    // (Every hominin fossil with a picture counted: at least the dozen #275 placed.)
    expect(lines.length).toBeGreaterThanOrEqual(12);
    expect(bad).toEqual([]);
  }, 400000);
});
