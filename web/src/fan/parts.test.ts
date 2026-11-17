// A group opens part by part (ToLaD#500, Ita: "nah im saying colinns sequirel money doesnt show the pic even at the zoom!"): a part gets its own label once it has room, its group's name a title
// over the rest; so the squirrel monkeys are named with their pictures at Saimirinae's frame, a tap lands with the whole group on one screen, and nothing meets. PARTS_SAY=1 prints the counts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { latinOf } from './brackets';
import { setFlip } from './flip';
import type { FanNode } from './layout';
import { mammaliaClade } from './panthera';
import { mammaliaTree } from './splits';
import { loadMammalsFromFiles } from './mammals-node';
import { picBox } from './pics';
import type { Steady } from './steady';
import { CLADE_PX } from './gapnames';
import { FanView, type CutLabels, type GapMember, type Level } from './view';

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
  g.window = { devicePixelRatio: 2 };
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
    getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 }),
    addEventListener: noop,
    removeEventListener: noop,
  };
  return new FanView(canvas as unknown as HTMLCanvasElement, mammaliaClade(), mammaliaTree(), true);
}

type Ladder = { root: GapMember; parts(g: GapMember): GapMember[]; opens: Map<GapMember, number>; hands: Map<GapMember, number> };
type Inner = { landOf(lv: Level): Camera; labelsNow(): { cut: CutLabels }; territories(): unknown; gapLadder: Ladder };
const env = (globalThis as { process?: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const say = (s: string) => env?.env.PARTS_SAY && env.stderr.write(s + '\n');

describe('a group opens part by part', () => {
  let v: FanView;
  let home: Camera;
  beforeAll(async () => {
    await loadMammalsFromFiles();
    setFlip(true);
    v = stubView();
    home = { ...v.cam };
  }, 120000);
  afterAll(() => setFlip(false));

  const I = () => v as unknown as Inner;
  const set = (c: Camera): CutLabels => {
    (v.fan.tess.fold as Steady).setScale(c.sx, v.w);
    v.cam = { ...c };
    return I().labelsNow().cut;
  };
  const clade = (latin: string) => v.fan.nodes.find((q) => latinOf(q.split) === latin)!;
  const sp = (sci: string) => v.fan.branches.find((b) => b.sp.sci === sci)!;
  /** The smallest clade holding all these species. */
  const holding = (...scis: string[]): FanNode => {
    const ks = scis.map((s) => sp(s).index);
    let best: FanNode | null = null;
    for (const q of v.fan.nodes) {
      const ix = q.strands.map((b) => b.index);
      if (ks.every((k) => ix.includes(k)) && (!best || q.strands.length < best.strands.length)) best = q;
    }
    return best!;
  };
  const land = (u: FanNode | null): CutLabels => set(u ? I().landOf({ v: u }) : home);
  /** Every pair of labels that meet: names, pills and pictures. */
  const meeting = (c: CutLabels, tag: string): string[] => {
    const boxes: [string, readonly number[]][] = [...[...c.names, ...c.spots].map((s) => [s.text, s.box] as [string, readonly number[]]), ...c.pics.map((p) => [`pic ${p.face.sp.sci}`, picBox(p)] as [string, readonly number[]])];
    const bad: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i][1], boxes[j][1]];
        if (p[0] < q[2] - 1e-6 && p[2] > q[0] + 1e-6 && p[1] < q[3] - 1e-6 && p[3] > q[1] + 1e-6) bad.push(`${tag}: ${boxes[i][0]} / ${boxes[j][0]}`);
      }
    return bad;
  };
  /** Every pair of names reading the same, side by side in one band (a slot apart or less across, ToLaD#500: guest titles and their band's own label). */
  const twice = (c: CutLabels, tag: string): string[] => {
    const ns = [...c.names, ...c.spots];
    const bad: string[] = [];
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++) {
        const [p, q] = [ns[i].box, ns[j].box];
        if (ns[i].text === ns[j].text && Math.abs(p[0] + p[2] - q[0] - q[2]) / 2 <= 2 * CLADE_PX + 4 && p[1] < q[3] + 4 * CLADE_PX && p[3] > q[1] - 4 * CLADE_PX) bad.push(`${tag}: ${ns[i].text} twice`);
      }
    return bad;
  };
  const labelled = (c: CutLabels, sci: string) => ({ name: [...c.names, ...c.spots].some((s) => s.b?.sp.sci === sci), pic: c.pics.some((p) => p.lv.b?.sp.sci === sci) });
  /** Zoom by f about species sci's band on the column (Ita's pinch about Collins'). */
  const zoomAbout = (sci: string, f: number) => {
    const b = sp(sci);
    const [px, py] = v.toScreen(v.speciesCamera(b).cx, b.tipY);
    v.zoom(px, py, f, 1);
    return I().labelsNow().cut;
  };

  it('at Saimirinae’s frame, the Golden-backed, Guianan, Collins’ and Ecuadorian squirrel monkeys each have their name and picture', () => {
    const c = land(clade('Saimirinae'));
    for (const sci of ['Saimiri ustus', 'Saimiri sciureus', 'Saimiri collinsi', 'Saimiri macrodon']) expect(labelled(c, sci), sci).toEqual({ name: true, pic: true });
    expect(meeting(c, 'Saimirinae')).toEqual([]);
  });

  it('at Ita’s zoom (3.4x Saimirinae’s frame about Collins’), every squirrel monkey on screen 100 px wide or more has its name and picture', () => {
    const u = clade('Saimirinae');
    land(u);
    const c = zoomAbout('Saimiri collinsi', 3.4);
    const { C, R } = (v.fan.tess.fold as Steady).rooms();
    const X = (x: number) => v.toScreen(x, 0)[0];
    const wide = u.strands.filter((b) => R[b.index] * v.cam.sx >= 100 && X(C[b.index] + R[b.index] / 2) > 0 && X(C[b.index] - R[b.index] / 2) < v.w);
    say(`Ita’s zoom: ${wide.map((b) => `${b.sp.sci} ${(R[b.index] * v.cam.sx).toFixed(0)} px`).join(', ')}`);
    expect(wide.length).toBeGreaterThan(1);
    for (const b of wide) expect(labelled(c, b.sp.sci), b.sp.sci).toEqual({ name: true, pic: true });
    expect(meeting(c, 'Ita’s zoom')).toEqual([]);
  });

  // (The rule, ToLaD#500: a group splits once its widest part's band holds that part's name and its group's side by side, its group's title a guest there, unless its gap holds it first. Its ancestors' guests riding down with it may hold it back further: counted here.)
  it('tree-wide, a group splits no later than 2x after its widest part holds its name and its group\'s (counted before: when every part had room)', () => {
    land(null);
    const L = I().gapLadder;
    const room = (g: GapMember) => (g.on < 0 ? 0 : Math.max(g.gap, g.band));
    let [groups, late2Before, late5Before, late2, late5] = [0, 0, 0, 0, 0];
    const late: string[] = [];
    const stack = [L.root];
    while (stack.length) {
      const g = stack.pop()!;
      const ps = L.parts(g);
      stack.push(...ps);
      const rs = ps.map(room).filter((r) => r > 0);
      if (rs.length < 2) continue;
      groups++;
      // (The second-thinnest part's room: from this zoom all parts but one have the text's px.)
      const second = (2 * CLADE_PX + 4) / Math.max(...ps.map((p) => (p.on < 0 ? 0 : p.band)));
      const [was, now] = [L.opens.get(g)!, L.hands.get(g)!];
      if (was > 2 * second) late2Before++;
      if (was > 5 * second) late5Before++;
      if (now > 2 * second) {
        late2++;
        if (late.length < 5) late.push(g.lv.b?.sp.sci ?? latinOf(g.lv.v!.split));
      }
      if (now > 5 * second) late5++;
    }
    // (Measured 2026-11-16: before 3,719 >2x and 2,493 >5x of 6,245; now 785 and 18, held by their parent or by guests riding down; 2026-11-17, 846 and 21, a first part's title a guest till its group opens, gapHands' `same`;
    // 2026-11-17, one guest a band: 0 and 0 of 6,245 (before 3,719 and 2,491), each part handing down once its widest part holds its own name and one title, no stack of guests holding it.)
    say(`late splits: ${late2} >2x, ${late5} >5x of ${groups} (before ${late2Before}, ${late5Before}); first: ${late.join(', ')}`);
    expect(late2 * 4).toBeLessThan(late2Before);
    expect(late5 * 100).toBeLessThan(late5Before);
  });

  it('a tap on Small cats, and on “Guianan squirrel monkey & kin”, lands with the whole group on one screen', () => {
    for (const u of [clade('Felinae'), holding('Saimiri sciureus', 'Saimiri vanzolinii')]) {
      const c = land(u);
      const T = I().territories() as { t: { index: Map<FanNode, number> } };
      const { roomL, roomW } = (v.fan.tess.fold as Steady).rooms();
      const j = T.t.index.get(u)!;
      const [a, b] = [v.toScreen(roomL[j], 0)[0], v.toScreen(roomL[j] + roomW[j], 0)[0]];
      say(`${latinOf(u.split) || u.strands[0].sp.sci}: room ${a.toFixed(1)}..${b.toFixed(1)} px of ${v.w}`);
      expect(a, 'its top on screen').toBeGreaterThanOrEqual(-0.5);
      expect(b, 'its foot on screen').toBeLessThanOrEqual(v.w + 0.5);
      expect(meeting(c, latinOf(u.split))).toEqual([]);
    }
  });

  it('no two labels meet, and no band shows a name twice, across a sweep of frames; a label once shown stays as the view zooms in, until its member splits', () => {
    const bad: string[] = [];
    for (const [latin, sci] of [
      ['Saimirinae', 'Saimiri collinsi'],
      ['Felinae', 'Felis silvestris'],
      ['Carnivora', 'Ursus arctos'],
      ['Rodentia', 'Mus musculus'],
    ]) {
      bad.push(...twice(land(clade(latin)), `${latin} landing`));
      v.zoom(...v.toScreen(v.speciesCamera(sp(sci)).cx, sp(sci).tipY), 0.5, 1);
      for (let k = 0; k < 12; k++) {
        const c = zoomAbout(sci, 1.3);
        bad.push(...meeting(c, `${latin} ${k}`), ...twice(c, `${latin} ${k}`));
      }
    }
    expect(bad).toEqual([]);
  });
});
