// ?fit=fossils (ToLaD#289, #298): at the Hominins and Homo levels the frame is where and when the fossils lived (from
// the level's start to its youngest fossil group's end, "now" above the screen), so every hominin with a picture gets
// a column a few px wide and its name (ToLaD#297); off (the default), the frame fits today's humans.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { wantCutLabels } from './cut';
import { mammaliaClade, type CladeRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaTree, type Split } from './splits';
import { FanView, fossilSpan, levelName, nextLevels } from './view';
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
  const SMALL = new Set(['Homo antecessor', 'Homo naledi', 'Homo georgicus', 'Homo floresiensis']);
  it('at Hominins and Homo every hominin with a picture gets its name (ToLaD#297)', () => {
    const by = (latin: string) => v.fan.nodes.find((u) => latinOf(u.split) === latin)!;
    const bad: string[] = [];
    for (const u of [by('Hominini'), by('Homo')]) for (const r of measure(v, u)) if (!r.named) bad.push(`${levelName(u)} ${r.sci}`);
    expect(bad).toEqual([]);
  }, 400000);
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
      expect(fossilSpan(v.fan, u)).not.toBeNull();
      // (A level's frame is its fossil groups' era, ToLaD#298: a group with a member alive now (Homo at the Hominins)
      // is no fossil, framed at its own level; its species, younger than the australopiths, may stand above the screen.)
      const living = new Set(nextLevels(v.fan, u).flatMap((g) => (g.v && g.v.strands.some((b) => !b.sp.extinct && b.pop.aliveAt(0) > 0) ? g.v.strands.map((b) => b.sp.sci) : [])));
      for (const r of measure(v, u)) {
        lines.push(`${levelName(u)} ${r.sci}: ${r.px.toFixed(1)} px${r.on ? '' : ' (off screen)'}${r.named ? '' : ' (name hidden)'}`);
        if (r.sci === 'Homo sapiens' || living.has(r.sci)) continue;
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

/** The names shown at rest (resolved afresh), each its text. */
function shownNames(v: FanView): string[] {
  const V = v as unknown as { labLast: { spots: { key: string; text: string }[] }; labelState: Map<string, { on: boolean }> };
  return V.labLast.spots.filter((s) => V.labelState.get(s.key)?.on).map((s) => s.text);
}

for (const fit of ['fossils', 'off'])
  describe(`the hominins' groups and level, fit ${fit} (ToLaD#312, #311)`, () => {
    let v: FanView;
    beforeAll(async () => {
      vi.stubEnv('TOLAD_FIT', fit);
      await loadMammalsFromFiles();
      v = stubView(mammaliaClade(), mammaliaTree(), true);
    }, 400000);
    afterAll(() => vi.unstubAllEnvs());
    const by = (latin: string) => v.fan.nodes.find((u) => latinOf(u.split) === latin)!;

    // A level's pills name distinct real groups: no name twice, no "X ancestors"/"X lineage" made up for an unnamed split
    // inside it, framed and with "now" pushed off the screen's top (where the columns' lineage names show).
    // (Today's labels' own check: under ?labels=cut, fit off, the cut's own tests, cutlabels.test.ts.)
    it.skipIf(wantCutLabels() && fit === 'off')('at Hominins and Homo, framed or panned into the past, each name once and none generated', () => {
      const bad: string[] = [];
      for (const latin of ['Hominini', 'Homo'])
        for (const down of [0, 0.4]) {
          v.cam = v.cladeCamera(by(latin));
          v.camera.settle();
          v.cam = { ...v.cam, cy: v.cam.cy + (down * v.h) / v.cam.sy };
          v.camera.settle();
          settle(v);
          const names = shownNames(v);
          for (const n of names) if (/ (ancestors|lineage)$/.test(n) || names.indexOf(n) !== names.lastIndexOf(n)) bad.push(`${latin} +${down}: ${n}`);
        }
      expect([...new Set(bad)]).toEqual([]);
    }, 400000);

    // A pan of a third of the screen off a level's frame leaves the view at that level (not the Catarrhini's, nor a
    // gibbon's or a fossil genus' line under the centre).
    it('a pan sideways at Hominins and Homo keeps the level', () => {
      const V = v as unknown as { tapAt: unknown; lvAt: unknown };
      const bad: string[] = [];
      for (const latin of ['Hominini', 'Homo'])
        for (const dx of [-130, 130]) {
          v.cam = v.cladeCamera(by(latin));
          v.camera.settle();
          V.tapAt = null;
          V.lvAt = null;
          v.levelNow(true);
          v.cam = { ...v.cam, cx: v.cam.cx + dx / v.cam.sx };
          v.camera.settle();
          const lv = v.levelNow(true);
          const at = lv.v ? latinOf(lv.v.split) : lv.b.sp.sci;
          if (at !== latin) bad.push(`${latin} ${dx}px: ${at}`);
        }
      expect(bad).toEqual([]);
    }, 400000);
  });
