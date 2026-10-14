// Every level's frame keeps "now" and its pictures on screen; a "+x" tap shows all its groups (ToLaD#274).
import { describe, expect, it } from 'vitest';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { levelUp, FanView, groupCentre, groupFace, isLevel, levelName, nextLevels, type Level } from './view';
import type { Camera } from './camera';
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
      for (const u of v.fan.nodes) if (isLevel(v.fan, u) && u.strands.length > 1 && (name !== 'mammals' || levelUp(v.fan, u) === v.fan.root || levelName(u) === 'Primates' || (levelUp(v.fan, u) && levelName(levelUp(v.fan, u)!) === 'Primates'))) {
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
