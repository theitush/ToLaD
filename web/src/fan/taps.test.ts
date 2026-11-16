// One tap on a label opens it (ToLaD#465): on the tree on its side, a tap on any group's name lands where that group's parts have names of their own; a second tap never just moves a few px. Every tap that lands on a group lands with its first branch at the top (ToLaD#468).
// `TAPS_SAY=1` prints what each tap does.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Camera, FanCamera } from './camera';
import { setFlip } from './flip';
import { CLADE_PX } from './gapnames';
import { laneAt, leftAt, type FanBranch, type FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { picBox } from './pics';
import { latinOf } from './brackets';
import { mammaliaTree } from './splits';
import type { Steady } from './steady';
import { chainOf, FanView, groupName, levelClade, type CutLabels, type GapMember } from './view';

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
    // (The view on its side, as on a phone 390 x 844 under the bar, the chain and the time axis: no DOM here, so turnStage takes this as it is.)
    getBoundingClientRect: () => ({ width: 700, height: 390, left: 0, top: 0, right: 700, bottom: 390 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

type Priv = {
  anim: ((t: number) => boolean) | null;
  applyFold(): void;
  camera: FanCamera;
  landOf(lv: { v: FanNode }): Camera;
  selected: unknown;
  famHits: { box: number[]; v: FanNode }[];
  nameHits: { box: number[]; b: FanBranch }[];
  territories(): never;
  gapCoverAt(T: never, sx: number): GapMember[];
  frameOf(lv: { v: FanNode }): Camera;
  picSpots: CutLabels['pics'];
};
const P = (v: FanView) => v as unknown as Priv;
const proc = (globalThis as unknown as { process: { env: Record<string, string>; stderr: { write(s: string): void } } }).process;
const say = (s: string) => proc.env.TAPS_SAY && proc.stderr.write(s + '\n');

describe('one tap on a label opens it (ToLaD#465)', () => {
  let v: FanView;
  let home: Camera;
  beforeAll(async () => {
    await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
    home = v.homeCamera();
  }, 300_000);
  afterAll(() => setFlip(false));

  const run = () => {
    const iv = P(v);
    for (let t = performance.now() + 16, k = 0; iv.anim && k < 2000; t += 16, k++) {
      if (!iv.anim(t)) iv.anim = null;
      iv.applyFold();
    }
    for (let k = 0; k < 3; k++) v.draw();
  };
  const stand = (c: Camera) => {
    P(v).anim = null;
    (v.fan.tess.fold as Steady).setScale(c.sx, v.w);
    v.cam = { ...c, ty: c.sy };
    P(v).camera.settle();
    for (let k = 0; k < 3; k++) v.draw();
  };
  /** The cover's members with a name on screen now. */
  const shown = (): GapMember[] => {
    const X = (x: number) => v.toScreen(x, 0)[0];
    return P(v)
      .gapCoverAt(P(v).territories(), v.cam.sx)
      .filter((g) => (g.tier === 'title' ? X(g.top) >= -CLADE_PX && X(g.top) <= v.w + CLADE_PX : g.tier && X(g.at + g.band / 2) >= 0 && X(g.at - g.band / 2) <= v.w));
  };
  const nameOf = (g: GapMember) => (g.lv.b ? g.lv.b.sp.common || g.lv.b.sp.sci : groupName(v.fan, g.lv.v!));
  const inside = (g: GapMember, u: FanNode) => g.f >= u.strands[0].index && g.l <= u.strands[u.strands.length - 1].index;
  const off = (a: Camera, b: Camera) => Math.max(Math.abs(a.cx - b.cx) * a.sx, Math.abs(Math.log(a.sx / b.sx)) * v.w);
  const tapBox = (box: number[]) => v.tap((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
  /**
   * Where group u stands on screen now (ToLaD#468), px from the screen's top (on the tree on its side, the header's foot: the chain of groups stands over the view): its room's first edge (the hull
   * of its strands at every time: its first branch); the top of all of it there, its parts' labels on screen above that edge (its first part's title, a picture wider than its band) or the edge
   * itself; and the end of what is drawn before it (the strands outside it, above it, on screen).
   */
  const topOf = (u: FanNode): { room: number; top: number; before: number } => {
    const T = P(v).territories() as unknown as { t: { index: Map<FanNode, number>; strands: FanBranch[] } };
    const { roomL, C, R } = (v.fan.tess.fold as Steady).rooms();
    const X = (x: number) => v.toScreen(x, 0)[0];
    const [uf, ul] = [u.strands[0].index, u.strands[u.strands.length - 1].index];
    const mine = (q: { v?: FanNode; b?: FanBranch }) => (q.b ? q.b.index >= uf && q.b.index <= ul : !!q.v && q.v.strands[0].index >= uf && q.v.strands[q.v.strands.length - 1].index <= ul);
    const room = X(roomL[T.t.index.get(u)!]);
    let top = room;
    for (const q of [...v.cutLast!.names, ...v.cutLast!.spots]) if (mine(q) && q.box[2] >= 0 && q.box[0] <= v.w) top = Math.min(top, q.box[0]);
    for (const q of P(v).picSpots) {
      const box = picBox(q);
      if (mine(q.lv) && box[2] >= 0 && box[0] <= v.w) top = Math.min(top, box[0]);
    }
    // (What is drawn of each strand before it whose room reaches the screen, row by row down the screen: its own column, where it lives, younger than its split.)
    let before = -Infinity;
    const strands = T.t.strands;
    for (let i = 0; i < uf; i++) {
      if (X(C[i] + R[i] / 2) <= 0) continue;
      const b = strands[i];
      for (let y = 0; y <= v.h; y += 2) {
        const wy = v.toWorld(0, y)[1];
        const lw = wy < b.splitY ? laneAt(b, wy).w : 0;
        if (lw > 0) before = Math.max(before, X(leftAt(b, wy) + lw));
      }
    }
    return { room, top, before };
  };
  const topSay = (t: ReturnType<typeof topOf>) => `its first branch at ${t.room.toFixed(1)} px, its top (a title, a picture or that) at ${t.top.toFixed(1)} px, what is before it to ${t.before.toFixed(1)} px`;
  /** Group u at the top (ToLaD#468): the top of it at the screen's top, its first branch under only its labels' room, nothing of anything before it on screen. */
  const atTop = (u: FanNode, line: string): void => {
    const t = topOf(u);
    say(`  top: ${topSay(t)}`);
    expect(Math.abs(t.top), `${line}\n  ${topSay(t)}`).toBeLessThan(1);
    expect(t.room, `${line}\n  ${topSay(t)}`).toBeLessThan(v.w);
    // (Nothing drawn before it on screen; where its first part's title stands above its first edge, in its gap on the labels' column, a strand before it can reach into that room at another
    // time (the one before the cats, 4 px, from the lion), never past it.)
    expect(t.before, `${line}\n  ${topSay(t)}`).toBeLessThan(t.top < t.room - 1 ? t.room : 1);
  };

  /**
   * A tap on group u's name: it opens (the cover splits it: its name gone, two or more of its parts in the cover), one of them or more named on screen, and it moved more than a few
   * px. (Two or more on screen where its first part is not a lane far wider than the screen: with the humans' or the dogs' first, its title stands at that lane's top, a screen or
   * more away from the others, and a title off screen is not moved into its band, gapLabels; open, ToLaD#465.)
   */
  const opens = (u: FanNode, where: string): void => {
    const h = P(v).famHits.find((q) => q.v === u)!;
    const was = { ...v.cam };
    const before = shown().map(nameOf);
    tapBox(h.box);
    run();
    const now = shown();
    const parts = now.filter((g) => inside(g, u));
    const line = `${where}: ${groupName(v.fan, u)} at ${(was.sx / home.sx).toFixed(1)}x -> ${(v.cam.sx / home.sx).toFixed(1)}x, moved ${off(v.cam, was).toFixed(0)} px\n  before: ${before.join(', ')}\n  after: ${now.map(nameOf).join(', ')}`;
    say(line);
    expect(now.some((g) => g.lv.v === u), line).toBe(false);
    expect(P(v).gapCoverAt(P(v).territories(), v.cam.sx).filter((g) => inside(g, u)).length, line).toBeGreaterThanOrEqual(2);
    expect(parts.length, line).toBeGreaterThanOrEqual(1);
    expect(off(v.cam, was), line).toBeGreaterThan(12);
    // (Its first branch at the top, ToLaD#468: the rest of it below, a scroll away.)
    atTop(u, line);
  };

  // (A double tap goes one level up from where the tap landed, ToLaD#472: Vesper bats & kin lands in Yangochiroptera, a double tap there goes to the bats, not home.)
  it('every label at home opens with a tap; a double tap goes one level up, landing as a tap there lands', () => {
    stand(home);
    const labels = P(v).famHits.map((h) => h.v);
    expect(labels.length).toBeGreaterThan(3);
    for (const u of labels) {
      stand(home);
      opens(u, 'home');
      const up = v.levelsAbove(v.levelNow(true))[0] ?? v.fan.root;
      const want = up.parent ? P(v).landOf({ v: up }) : home;
      v.doubleTap(0, 0);
      run();
      say(`  double tap: at ${chainOf(v.fan, levelClade(v.fan, v.levelNow(true))).join(' › ')}, ${off(v.cam, want).toFixed(2)} px off its landing`);
      expect(chainOf(v.fan, levelClade(v.fan, v.levelNow(true))), groupName(v.fan, u)).toEqual(chainOf(v.fan, up));
      expect(off(v.cam, want), groupName(v.fan, u)).toBeLessThan(2);
    }
  });

  // Down to a species by its labels, from home, each tap on the one holding it: each opens what it names; the last, the species' card.
  for (const sci of ['Ptilocercus lowii', 'Tupaia belangeri', 'Homo sapiens', 'Gorilla gorilla', 'Panthera leo', 'Canis lupus']) {
    it(`taps down to ${sci}`, () => {
      const b = v.fan.branches.find((q) => q.sp.sci === sci)!;
      expect(b, sci).toBeDefined();
      stand(home);
      for (let k = 0; k < 40; k++) {
        const sp = P(v).nameHits.find((q) => q.b === b);
        if (sp) {
          tapBox(sp.box);
          run();
          if (!P(v).selected) {
            tapBox(P(v).nameHits.find((q) => q.b === b)!.box);
            run();
          }
          say(`${sci}: card after ${k} group taps`);
          expect(P(v).selected, sci).toBeTruthy();
          return;
        }
        // (Its label off screen, a fat lane's title a screen away: panned to, as anyone would.)
        if (!P(v).famHits.some((q) => q.v.strands.includes(b))) {
          const m = P(v)
            .gapCoverAt(P(v).territories(), v.cam.sx)
            .find((g) => g.lv.v?.strands.includes(b));
          if (m) stand({ ...v.cam, cx: m.top + (v.w / 2 - v.w / 3) / v.cam.sx });
        }
        const h = P(v).famHits.find((q) => q.v.strands.includes(b));
        expect(h, `${sci}: no label holds it at ${(v.cam.sx / home.sx).toFixed(1)}x: ${shown().map(nameOf).join(', ')}`).toBeDefined();
        opens(h!.v, sci);
      }
      throw new Error(`${sci}: no card in 40 taps`);
    });
  }

  // Down to a group by its labels, from home (ToLaD#468): each tap on the label holding it, the last on its own; where its first strand lands, and the zoom.
  for (const latin of ['Primates', 'Carnivora', 'Rodentia', 'Hominidae']) {
    it(`a tap opens ${latin} with its first branch at the top`, () => {
      const u = v.fan.nodes.find((q) => latinOf(q.split) === latin)!;
      expect(u, latin).toBeDefined();
      const up = new Set<FanNode>();
      for (let p = u.parent; p; p = p.parent) up.add(p);
      stand(home);
      for (let k = 0; k < 20; k++) {
        // (Its label off screen, a fat lane's title a screen away: panned to, as anyone would.)
        if (!P(v).famHits.some((q) => q.v === u || up.has(q.v))) {
          const m = P(v)
            .gapCoverAt(P(v).territories(), v.cam.sx)
            .find((g) => g.lv.v === u || (g.lv.v && up.has(g.lv.v)));
          if (m) stand({ ...v.cam, cx: m.top + (v.w / 2 - v.w / 3) / v.cam.sx });
        }
        const h = P(v).famHits.find((q) => q.v === u) ?? P(v).famHits.find((q) => up.has(q.v));
        expect(h, `${latin}: no label holds it at ${(v.cam.sx / home.sx).toFixed(1)}x: ${shown().map(nameOf).join(', ')}`).toBeDefined();
        opens(h!.v, latin);
        // (Open: the cover's members on it all inside it, its parts.)
        const [uf, ul] = [u.strands[0].index, u.strands[u.strands.length - 1].index];
        if (!P(v).gapCoverAt(P(v).territories(), v.cam.sx).some((g) => g.f <= uf && g.l >= ul)) {
          // (The tap that opened it at the top, opens(); it, its first branch on screen.)
          const t = topOf(u);
          say(`${latin}: open after ${k + 1} taps at ${(v.cam.sx / home.sx).toFixed(1)}x, ${topSay(t)}`);
          expect(t.room).toBeGreaterThanOrEqual(-1);
          expect(t.room).toBeLessThan(v.w);
          return;
        }
      }
      throw new Error(`${latin}: not reached in 20 taps`);
    });
  }
});
