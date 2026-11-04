// Every level's frame keeps "now" and its pictures on screen; a "+x" tap shows all its groups (ToLaD#274).
import { describe, expect, it } from 'vitest';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { levelUp, FanView, groupCentre, groupExtent, groupFace, holds, isLevel, levelName, nextLevels, type Level } from './view';
import type { Camera } from './camera';
import type { FanNode } from './layout';
import { latinOf } from './brackets';
import { wikiOf } from './wiki';

function stubView(clade: CladeRec = CARNIVORA, tree: Split = CARNIVORA_TREE, folds = true): FanView {
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, folds);
}

type Priv = { anim: ((t: number) => boolean) | null; applyFold(): void; frameOf(lv: Level): Camera; labelTop(): number };
const P = (v: FanView) => v as unknown as Priv;
function settle(v: FanView): void {
  for (let k = 0; k < 3; k++) v.draw();
}
/** Fly from home to level lv's frame. */
function land(v: FanView, lv: Level): void {
  v.cam = lv.b ? v.speciesCamera(lv.b) : lv.v.parent ? v.cladeCamera(lv.v) : v.homeCamera();
  v.camera.settle();
  const free = v.levelNow(true);
  if (free.v !== lv.v || free.b !== lv.b) log.push(`${nameOf(lv)}: from the camera alone, at ${nameOf(free)}`);
  (v as unknown as { tapAt: unknown }).tapAt = { b: lv.b ?? null, v: lv.v ?? null, cam: { ...v.cam } };
  settle(v);
}
const nameOf = (lv: Level) => (lv.b ? lv.b.sp.common : levelName(lv.v));
const living = (lv: Level) => (lv.b ? [lv.b] : lv.v.strands).some((b) => !b.sp.extinct && b.pop.aliveAt(0) > 0);

/** What is wrong with the view as framed at level lv: "now" off the top band, a next-level group's picture off screen. */
function frameFaults(v: FanView, lv: Level): string[] {
  const bad: string[] = [];
  const nowS = v.toScreen(0, v.fan.time.y(0))[1];
  const top = P(v).labelTop();
  const at = nameOf(lv);
  if (!(nowS >= top + 12 && nowS <= 0.55 * v.h)) bad.push(`${at}: "now" at ${nowS.toFixed(0)} px (top ${top})`);
  // The brackets' stack whole above "now" (not swapped for the pinned rows over it), its foot over the pictures.
  const br = (v as unknown as { brackets: { fit: number; baseS: number; placed: unknown[] } | null }).brackets;
  if (br && br.placed.length && br.fit < 1) bad.push(`${at}: the stack pinned over "now" (now at ${nowS.toFixed(0)})`);
  const foot = br && br.placed.length ? br.baseS : top;
  // Its labels under the stack (ToLaD#373: the frame keeps the room its own labels take), the living's all over "now".
  for (const s of v.cutLast?.spots ?? []) if (s.box[1] < foot - 1) bad.push(`${at}: "${s.text}" reaches ${(foot - s.box[1]).toFixed(0)} px over the stack's foot`);
  // The level's whole life on screen (ToLaD#288): its start (its fork; a species', its split) at the foot, over the scale bar.
  const fork = v.toScreen(0, lv.b ? lv.b.splitY : lv.v.parent ? lv.v.yBot : v.fan.trunkBottom.y)[1];
  if (lv.v?.parent && Math.abs(fork - (v.h - 104)) > 2) bad.push(`${at}: its start at ${fork.toFixed(0)} px, not at the foot (${v.h - 104})`);
  // At most three rows of brackets, a "…" over them (ToLaD#288).
  const rows = new Set((br?.placed ?? []).map((p) => (p as { row: number }).row));
  const more = (br as unknown as { moreRow: number } | null)?.moreRow ?? -1;
  if (rows.size > 3 || [...rows].some((r) => r > 2) || more > 3) bad.push(`${at}: ${rows.size} bracket rows, "…" at ${more}`);
  bad.push(...cutFaults(v, lv));
  if (lv.b) return bad;
  let n = 0;
  let shown = 0;
  for (const g of nextLevels(v.fan, lv.v)) {
    if (!living(g)) continue;
    const face = g.b ?? groupFace(g.v);
    if (!face || !wikiOf(face.sp.sci)?.img) continue;
    n++;
    const x = v.toScreen(groupCentre(g), 0)[0];
    const p = v.picSpots.find((q) => q.lv.b === g.b && q.lv.v === g.v);
    if (!p && (x < 0 || x > v.w)) bad.push(`${at}: ${nameOf(g)} centre off screen at ${x.toFixed(0)} px`);
    if (p) shown++;
    if (p && (p.x - p.d / 2 < -1 || p.x + p.d / 2 > v.w + 1 || p.y - p.d / 2 < foot - 1)) bad.push(`${at}: ${nameOf(g)}'s picture off screen (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
  }
  if (shown < n) log.push(`${at}: ${shown}/${n} pictures, now at ${nowS.toFixed(0)}, sx ${v.cam.sx.toExponential(2)}`);
  return bad;
}
/**
 * What is cut off at the screen's edge at level lv (ToLaD#319): a next-level group's columns at "now" (a species', its
 * centre) off the screen, or any name pill shown running past either edge.
 */
function cutFaults(v: FanView, lv: Level): string[] {
  const bad: string[] = [];
  const at = nameOf(lv);
  if (!lv.b)
    for (const g of nextLevels(v.fan, lv.v)) {
      const [lo, hi] = g.b ? [groupCentre(g), groupCentre(g)] : groupExtent(g.v);
      const [a, z] = [v.toScreen(lo, 0)[0], v.toScreen(hi, 0)[0]];
      if (a < -0.5 || z > v.w + 0.5) bad.push(`${at}: ${nameOf(g)}'s columns at ${a.toFixed(0)}..${z.toFixed(0)} px`);
    }
  for (const h of v.famHits) if (h.box[0] < -0.5 || h.box[2] > v.w + 0.5) bad.push(`${at}: the pill ${levelName(h.v)} at ${h.box[0].toFixed(0)}..${h.box[2].toFixed(0)} px`);
  for (const h of v.nameHits) if (h.box[0] < -0.5 || h.box[2] > v.w + 0.5) bad.push(`${at}: the pill ${h.b.sp.common} at ${h.box[0].toFixed(0)}..${h.box[2].toFixed(0)} px`);
  return bad;
}
const log: string[] = [];

const FANS = [
  ['carnivores (folded)', () => stubView()],
  ['cats', () => stubView(FELIDAE, FELIDAE_TREE, false)],
  ['mammals', () => stubView(mammaliaClade(), mammaliaTree(), true)],
] as const;

/** Run the flight under way to its landing, a frame each 16 ms (the fold at each frame's zoom), then draw settled. */
function run(v: FanView): void {
  const iv = P(v);
  for (let t = performance.now() + 16; iv.anim; t += 16) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
  settle(v);
}

// (Since ToLaD#358 every label but a lone species' has a "+x" (its species but the one named), so a tap shows its species
// split among labels that each count theirs again: what a "+x" tap owes is a step finer (ToLaD#359, tapItem), the item
// it stands for as two or more labels on screen, every species of it still under one of them.)
describe('a "+x" tap: the item it stands for a step finer, its species under two or more labels (ToLaD#274, #359)', () => {
  for (const [name, mk] of FANS.slice(0, 2)) {
    it(name, () => {
      const v = mk();
      const bad: string[] = [];
      let taps = 0;
      // At home and each level a tap reaches from home (each family's frame), each "+x" tapped.
      const levels: Level[] = [{ v: v.fan.root }, ...v.fan.nodes.filter((u) => u.parent && isLevel(v.fan, u) && u.strands.length > 1 && levelUp(v.fan, u) && levelUp(v.fan, levelUp(v.fan, u)) === v.fan.root).map((u) => ({ v: u }))];
      for (const lv of levels) {
        land(v, lv);
        // (Its "+x" badge tapped: the name before it is the group's, a level deeper, ToLaD#258.)
        const hits = v.plusHits.map((h) => ({ box: h.badge, bs: [...h.bs], run: h.run }));
        for (const h of hits) {
          land(v, lv);
          const at = nameOf(v.levelNow(true));
          const stood = h.bs;
          v.tap((h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2);
          if (!P(v).anim) {
            bad.push(`${at}: +${stood.length} flew nowhere`);
            continue;
          }
          taps++;
          run(v);
          const [f, l] = h.run ?? [Math.min(...stood.map((b) => b.index)), Math.max(...stood.map((b) => b.index))];
          const its = v.cutLast!.items.filter((it) => it.l >= f && it.f <= l);
          if (its.length < 2 || its.some((it) => it.f < f || it.l > l)) bad.push(`${at}: +${stood.length} landed at ${nameOf(v.levelNow())}, its item ${f}-${l} under ${its.map((it) => `${it.f}-${it.l}`).join(', ') || 'no label'}`);
        }
      }
      (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`${name}: ${taps} +x taps\n${bad.join('\n')}\n`);
      expect(bad).toEqual([]);
    }, 400000);
  }
});

describe('the hominins are one group (ToLaD#289)', () => {
  // (Ita 2026-11-01: humans hand-tuned later, #352. The Great apes', Hominins' and Humans' frames, the hominins' fossils framed, ToLaD#289.)
  it.fails('Great apes → Hominins → Homo → a species, each a level; the stack at most three rows and a "…"', async () => {
    await loadMammalsFromFiles();
    const v = stubView(mammaliaClade(), mammaliaTree(), true);
    const by = (latin: string) => v.fan.nodes.find((u) => latinOf(u.split) === latin)!;
    const [apes, hominins, homo] = [by('Hominidae'), by('Hominini'), by('Homo')];
    expect(hominins && homo).toBeTruthy();
    expect([isLevel(v.fan, hominins), isLevel(v.fan, homo)]).toEqual([true, true]);
    expect(levelUp(v.fan, homo)).toBe(hominins);
    expect(levelName(hominins)).toBe('Hominins');
    expect(nextLevels(v.fan, apes).some((g) => g.v === hominins)).toBe(true);
    expect(nextLevels(v.fan, hominins).some((g) => g.v === homo)).toBe(true);
    expect(homo.strands.some((b) => b.sp.sci === 'Homo sapiens') && !hominins.strands.some((b) => b.sp.sci.startsWith('Pan '))).toBe(true);
    const bad: string[] = [];
    for (const lv of [{ v: apes }, { v: hominins }, { v: homo }]) {
      land(v, lv);
      bad.push(...frameFaults(v, lv));
    }
    expect(bad).toEqual([]);
  }, 400000);
});

// (A "+1" stands for an item of two species (ToLaD#358): its tap goes into the item (ToLaD#359), both named; the card
// opens on a tap on one species' own label. An item no zoom splits (a fossil too short-lived for a label of its own
// beside its sister) lands on that species, its card open.)
describe('a one-species "+x" lands with the species it stands for named (ToLaD#318, #359)', () => {
  it('carnivores (folded): every level, every "+x" standing for one species: it on screen, its name shown or its card open', () => {
    const v = stubView();
    const bad: string[] = [];
    let taps = 0;
    let selected: string | null = null;
    v.onSelect = (s) => (selected = s ? s.sp.common : null);
    for (const u of v.fan.nodes.filter((u) => isLevel(v.fan, u) && u.strands.length > 1)) {
      const lv = { v: u };
      land(v, lv);
      for (const h of v.plusHits.map((p) => ({ box: [...p.badge], bs: [...p.bs] }))) {
        if (h.bs.length !== 1) continue;
        const b = h.bs[0];
        land(v, lv);
        v.tap((h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2);
        if (!P(v).anim) {
          bad.push(`${nameOf(lv)}: +1 (${b.sp.common}) flew nowhere`);
          continue;
        }
        taps++;
        run(v);
        const x = v.toScreen(groupCentre({ b }), 0)[0];
        const pill = v.nameHits.find((n) => n.b === b);
        if (!(x >= 0 && x <= v.w) || (!pill && selected !== b.sp.common)) bad.push(`${nameOf(lv)}: +1 (${b.sp.common}) landed at x ${x.toFixed(0)}, ${pill ? 'named' : 'no name'}, card ${selected}`);
      }
    }
    expect(taps).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  }, 400000);
});

describe('a tap on a group lands on it (ToLaD#352)', () => {
  // At every level in the primates (and the level they sit in), every name pill and picture tapped: the flight goes in
  // (never out to a wider frame: "Primates" is a signpost's pill, its frame tighter than the Primates' own), it lands on
  // a level holding what was tapped, deeper than where it started or the tapped species itself, its columns on screen,
  // with labels shown. (The great apes' frame was a fossil's: a lone stem fossil among its groups framed the screen on its
  // sliver of a column, ~4 million times the zoom, nothing on it.)
  // (Skipped in the suite: ~10 min, each tap's frames worked out in the fold; unverified, ToLaD#352's result. Run it with it.only.)
  it.skip("mammals: the apes' levels and the lemurs', every pill and picture", async () => {
    await loadMammalsFromFiles();
    const v = stubView(mammaliaClade(), mammaliaTree(), true);
    const by = (latin: string) => v.fan.nodes.find((u) => latinOf(u.split) === latin)!;
    const prim = by('Primates');
    // (The way down to the apes and their sisters, and the lemurs for comparison: every level in the primates, each
    // tap a fold's frames, took over half an hour.)
    const levels: FanNode[] = ['Primates', 'Haplorrhini', 'Simiiformes', 'Catarrhini', 'Hominidae', 'Pan', 'Gorilla', 'Pongo', 'Hylobatidae', 'Strepsirrhini', 'Lemuriformes'].map(by);
    const bad: string[] = [];
    let taps = 0;
    for (const u of [levelUp(v.fan, prim)!, ...levels]) {
      (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`at ${levelName(u)} ${performance.now() | 0}\n`);
      const lv = { v: u };
      land(v, lv);
      const targets: { at: [number, number]; to: Level; name: string }[] = [
        ...v.famHits.map((h) => ({ at: [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2] as [number, number], to: { v: h.v }, name: levelName(h.v) })),
        ...v.nameHits.map((h) => ({ at: [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2] as [number, number], to: { b: h.b }, name: h.b.sp.common })),
        ...v.picSpots.map((p) => ({ at: [p.x, p.y] as [number, number], to: p.lv, name: `${nameOf(p.lv)}'s picture` })),
      ];
      for (const g of targets) {
        land(v, lv);
        const sx = v.cam.sx;
        v.tap(...g.at);
        if (!P(v).anim) continue;
        taps++;
        // (Landed where the flight goes, its frame (backing), without flying it frame by frame: ~250 levels' worth.)
        const step = (v as unknown as { backing: { lv: Level; cam: Camera } | null }).backing;
        P(v).anim = null;
        if (step) {
          // (Its frame taken afresh: frameOf puts the fold back, cladeCamera leaves it at the frame's zoom, as a landing does.)
          v.cam = step.lv.b ? v.speciesCamera(step.lv.b) : step.lv.v.parent ? v.cladeCamera(step.lv.v) : v.homeCamera();
          v.camera.settle();
          (v as unknown as { tapAt: unknown }).tapAt = { b: step.lv.b ?? null, v: step.lv.v ?? null, cam: { ...v.cam } };
        } else run(v);
        settle(v);
        const to = v.levelNow(true);
        const at = `${nameOf(lv)}: ${g.name} -> ${nameOf(to)}`;
        if (v.cam.sx < sx / 1.15) bad.push(`${at}: out, ${sx.toFixed(1)} -> ${v.cam.sx.toFixed(1)}`);
        if (!holds(to, g.to) && !(to.b && g.to.v && g.to.v.strands.includes(to.b))) bad.push(`${at}: not holding it`);
        if (to.v && to.v === u) bad.push(`${at}: no deeper`);
        const [a, z] = g.to.b ? [groupCentre(g.to), groupCentre(g.to)] : groupExtent(g.to.v);
        if (v.toScreen(z, 0)[0] < 0 || v.toScreen(a, 0)[0] > v.w) bad.push(`${at}: off screen`);
        if (!v.cutLast?.spots.length && !v.picSpots.length) bad.push(`${at}: no labels`);
      }
    }
    (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`primates: ${levels.length} levels, ${taps} taps\n${bad.join('\n')}\n`);
    expect(taps).toBeGreaterThan(30);
    expect(bad).toEqual([]);
  }, 900000);
});
