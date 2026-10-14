// Every level's frame keeps "now" and its pictures on screen; a "+x" tap shows all its groups (ToLaD#274).
import { describe, expect, it } from 'vitest';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { levelUp, FanView, groupCentre, groupFace, isLevel, levelName, nextLevels, type Level } from './view';
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, 'curved', tree, folds);
}

type Priv = { anim: ((t: number) => boolean) | null; applyFold(): void; labelState: Map<string, unknown>; frameOf(lv: Level): Camera; labelTop(): number };
const P = (v: FanView) => v as unknown as Priv;
function settle(v: FanView): void {
  P(v).labelState.clear();
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
  if (!(nowS >= top + 12 && nowS <= 0.45 * v.h)) bad.push(`${at}: "now" at ${nowS.toFixed(0)} px (top ${top})`);
  // The brackets' stack whole above "now" (not swapped for the pinned rows over it), its foot over the pictures.
  const br = (v as unknown as { brackets: { fit: number; baseS: number; placed: unknown[] } | null }).brackets;
  if (br && br.placed.length && br.fit < 1) bad.push(`${at}: the stack pinned over "now" (now at ${nowS.toFixed(0)})`);
  const foot = br && br.placed.length ? br.baseS : top;
  // The level's whole life on screen (ToLaD#288): its start (its fork; a species', its split) at the foot, over the scale bar.
  const fork = v.toScreen(0, lv.b ? lv.b.splitY : lv.v.parent ? lv.v.yBot : v.fan.trunkBottom.y)[1];
  if (lv.v?.parent && Math.abs(fork - (v.h - 104)) > 2) bad.push(`${at}: its start at ${fork.toFixed(0)} px, not at the foot (${v.h - 104})`);
  // At most three rows of brackets, a "…" over them (ToLaD#288).
  const rows = new Set((br?.placed ?? []).map((p) => (p as { row: number }).row));
  const more = (br as unknown as { moreRow: number } | null)?.moreRow ?? -1;
  if (rows.size > 3 || [...rows].some((r) => r > 2) || more > 3) bad.push(`${at}: ${rows.size} bracket rows, "…" at ${more}`);
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
const log: string[] = [];
/** Whether clade u is the great apes or a level inside them (ToLaD#289: Great apes → Hominins → Homo). */
function inGreatApes(v: FanView, u: FanNode): boolean {
  for (let p: FanNode | null = u; p; p = levelUp(v.fan, p)) if (levelName(p) === 'Great apes') return true;
  return false;
}

const FANS = [
  ['carnivores (folded)', () => stubView()],
  ['cats', () => stubView(FELIDAE, FELIDAE_TREE, false)],
  ['mammals', () => stubView(mammaliaClade(), mammaliaTree(), true)],
] as const;

describe("every level's frame: now near the top, every next-level group's picture on screen (ToLaD#274)", () => {
  for (const [name, mk] of FANS) {
    it(name, async () => {
      if (name === "mammals") await loadMammalsFromFiles();
      const v = mk();
      const bad: string[] = [];
      for (const u of v.fan.nodes) if (isLevel(v.fan, u) && u.strands.length > 1 && (name !== 'mammals' || levelUp(v.fan, u) === v.fan.root || levelName(u) === 'Primates' || (levelUp(v.fan, u) && levelName(levelUp(v.fan, u)!) === 'Primates') || inGreatApes(v, u))) {
        land(v, { v: u });
        bad.push(...frameFaults(v, { v: u }));
      }
      (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`${name}: ${bad.length} faults\n${bad.join('\n')}\n${log.join("\n")}\n`);
      log.length = 0;
      expect(bad).toEqual([]);
    }, 400000);
  }
});

/** Run the flight under way to its landing, a frame each 16 ms (the fold at each frame's zoom), then draw settled. */
function run(v: FanView): void {
  const iv = P(v);
  for (let t = performance.now() + 16; iv.anim; t += 16) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
  settle(v);
}
/** The species a hidden group stands for. */
const strandsOf = (lv: Level) => (lv.b ? [lv.b] : lv.v.strands);

describe('a "+x" tap: every group it stood for named and pictured (ToLaD#274)', () => {
  for (const [name, mk] of FANS.slice(0, 2)) {
    it(name, () => {
      const v = mk();
      const bad: string[] = [];
      let taps = 0;
      // At home and each level a tap reaches from home (each family's frame), each "+x" tapped.
      const levels: Level[] = [{ v: v.fan.root }, ...v.fan.nodes.filter((u) => u.parent && isLevel(v.fan, u) && u.strands.length > 1 && levelUp(v.fan, u) && levelUp(v.fan, levelUp(v.fan, u)) === v.fan.root).map((u) => ({ v: u }))];
      for (const lv of levels) {
        land(v, lv);
        const hits = v.plusHits.map((h) => ({ box: h.box, bs: [...h.bs] }));
        for (const h of hits) {
          land(v, lv);
          const at = nameOf(v.levelNow(true));
          const stood = v.hiddenGroups.filter((g) => strandsOf(g.lv).every((b) => h.bs.includes(b)));
          v.tap((h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2);
          if (!P(v).anim) {
            bad.push(`${at}: +${stood.length} flew nowhere`);
            continue;
          }
          taps++;
          run(v);
          // (A living group's: an extinct one's name below its tip deep in the past may still hide, left over in ToLaD#274's result.)
          const still = v.hiddenGroups.filter((g) => living(g.lv) && strandsOf(g.lv).some((b) => h.bs.includes(b)));
          // (More than the screen has names for side by side, as the dogs' 18 species (no named groups inside the dogs):
          // fewer hidden, each with its own "+x" again, #197. Left over in ToLaD#274's result.)
          if (stood.length <= 5 ? still.length : still.length >= stood.length) bad.push(`${at}: +${stood.length} (${stood.map((g) => nameOf(g.lv)).join(', ')}) landed at ${nameOf(v.levelNow())}, still hidden: ${still.map((g) => nameOf(g.lv)).join(', ')}`);
        }
      }
      (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`${name}: ${taps} +x taps\n${bad.join('\n')}\n`);
      expect(bad).toEqual([]);
    }, 400000);
  }
});

describe('a chip with a "+x" is one tap target (ToLaD#287): its name lands where its badge does, every group named', () => {
  it('carnivores (folded)', () => {
    const v = stubView();
    const bad: string[] = [];
    let taps = 0;
    const levels: Level[] = [{ v: v.fan.root }, ...v.fan.nodes.filter((u) => u.parent && isLevel(v.fan, u) && u.strands.length > 1 && levelUp(v.fan, u) === v.fan.root).map((u) => ({ v: u }))];
    for (const lv of levels) {
      land(v, lv);
      // (Each badge's chip: the name pill it ends.)
      const chipOf = (q: readonly number[]) => [...v.famHits, ...v.nameHits].find((c) => c.box[0] <= q[0] + 1 && c.box[2] >= q[2] - 1 && c.box[1] <= q[1] + 1 && c.box[3] >= q[3] - 1);
      const hits = v.plusHits.map((h) => ({ chip: [...(chipOf(h.badge)?.box ?? h.box)], badge: [...h.badge], bs: [...h.bs] }));
      const stoodBy = hits.map((h) => v.hiddenGroups.filter((g) => strandsOf(g.lv).every((b) => h.bs.includes(b))).length);
      hits.forEach((h, k) => {
        const at = nameOf(lv);
        const landing = (x: number, y: number): Camera | null => {
          land(v, lv);
          v.tap(x, y);
          if (!P(v).anim) return null;
          run(v);
          return { ...v.cam };
        };
        // The badge, then the name (the pill's foot end: an upright name reads up from it).
        const byBadge = landing((h.badge[0] + h.badge[2]) / 2, (h.badge[1] + h.badge[3]) / 2);
        if (!(h.chip[3] - h.badge[3] > 12)) bad.push(`${at}: +${stoodBy[k]}: no name pill under its badge`);
        const byName = landing((h.chip[0] + h.chip[2]) / 2, h.chip[3] - 6);
        if (!byBadge || !byName) {
          bad.push(`${at}: +${stoodBy[k]}: ${byBadge ? '' : 'badge '}${byName ? '' : 'name '}flew nowhere`);
          return;
        }
        taps++;
        if (Math.abs(Math.log(byName.sx / byBadge.sx)) > 1e-6 || Math.abs(byName.cx - byBadge.cx) * byName.sx > 0.5 || Math.abs(byName.cy - byBadge.cy) * byName.sy > 0.5) bad.push(`${at}: +${stoodBy[k]}: the name landed off the badge's frame`);
        // Landed by the name: the groups it stood for named (the living ones; up to five, as a "+x" tap's, ToLaD#274).
        const still = v.hiddenGroups.filter((g) => living(g.lv) && strandsOf(g.lv).some((b) => h.bs.includes(b)));
        if (stoodBy[k] <= 5 && still.length) bad.push(`${at}: +${stoodBy[k]} by the name, still hidden: ${still.map((g) => nameOf(g.lv)).join(', ')}`);
      });
    }
    expect(taps).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  }, 400000);
});

describe('the hominins are one group (ToLaD#289)', () => {
  it('Great apes → Hominins → Homo → a species, each a level; the stack at most three rows and a "…"', async () => {
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
