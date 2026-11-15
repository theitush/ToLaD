// One tap on a label opens it (ToLaD#465): on the tree on its side, a tap on any group's name lands where that group's parts have names of their own; a second tap never just moves a few px.
// `TAPS_SAY=1` prints what each tap does.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Camera, FanCamera } from './camera';
import { setFlip } from './flip';
import { CLADE_PX } from './gapnames';
import type { FanBranch, FanNode } from './layout';
import { loadMammalsFromFiles } from './mammals-node';
import { mammaliaClade } from './panthera';
import { LABEL_AXIS_X } from './pics';
import { latinOf } from './brackets';
import { mammaliaTree } from './splits';
import type { Steady } from './steady';
import { FanView, groupName, type GapMember } from './view';

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
  steps: unknown[];
  selected: unknown;
  famHits: { box: number[]; v: FanNode }[];
  nameHits: { box: number[]; b: FanBranch }[];
  territories(): never;
  gapCoverAt(T: never, sx: number): GapMember[];
  frameOf(lv: { v: FanNode }): Camera;
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
    P(v).steps = [];
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
   * Where group u stands on screen now (ToLaD#468), px from the top: its room's first edge (the hull of its strands at every time: its first branch), where
   * its frame has it (`frame`) and now (`room`); its first strand on the labels' column (the topmost of its members' lanes there); its territory's edge.
   */
  const topOf = (u: FanNode): { frame: number; room: number; strand: number; edge: number } => {
    const fr = P(v).frameOf({ v: u });
    const T = P(v).territories() as unknown as { t: { index: Map<FanNode, number> } };
    const room = (v.fan.tess.fold as Steady).rooms().roomL[T.t.index.get(u)!];
    const X = (x: number) => v.toScreen(x, 0)[0];
    const ms = P(v)
      .gapCoverAt(P(v).territories(), v.cam.sx)
      .filter((g) => inside(g, u) && g.on >= 0);
    return { frame: (room - fr.cx) * fr.sx + v.w / 2, room: X(room), strand: ms.length ? Math.min(...ms.map((g) => X(g.top))) : NaN, edge: X(fr.cx - (v.w / 2 - LABEL_AXIS_X) / fr.sx) };
  };
  const topSay = (t: ReturnType<typeof topOf>) => `its first branch at ${t.room.toFixed(1)} px (its frame's ${t.frame.toFixed(1)}), its first strand at the column ${t.strand.toFixed(1)} px, its territory's edge ${t.edge.toFixed(1)} px`;

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
    // (Its first branch at the top, where its frame has it, ToLaD#468: the rest of it below, a scroll away.)
    const t = topOf(u);
    say(`  top: ${topSay(t)}`);
    expect(Math.abs(t.room - t.frame), `${line}\n  ${topSay(t)}`).toBeLessThan(1);
    expect(t.room, `${line}\n  ${topSay(t)}`).toBeGreaterThanOrEqual(LABEL_AXIS_X - 1);
  };

  it('every label at home opens with a tap; a double tap comes home', () => {
    stand(home);
    const labels = P(v).famHits.map((h) => h.v);
    expect(labels.length).toBeGreaterThan(3);
    for (const u of labels) {
      stand(home);
      opens(u, 'home');
      v.doubleTap(0, 0);
      run();
      say(`  double tap: ${off(v.cam, home).toFixed(2)} px off home`);
      expect(off(v.cam, home), groupName(v.fan, u)).toBeLessThan(2);
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
          const t = topOf(u);
          say(`${latin}: open after ${k + 1} taps at ${(v.cam.sx / home.sx).toFixed(1)}x, ${topSay(t)}`);
          expect(t.room).toBeGreaterThanOrEqual(LABEL_AXIS_X - 1);
          expect(t.room).toBeLessThan(v.w);
          return;
        }
      }
      throw new Error(`${latin}: not reached in 20 taps`);
    });
  }
});
