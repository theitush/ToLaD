// The clades' brackets above "now" (ToLaD#193): nested right, never overlapping at any zoom, labelled only where the
// label fits; a tap's flight frames the clade centred, "now" at the top and its stem's start just below.
import { describe, expect, it } from 'vitest';
import { bracketRows, Brackets, cladeCamera, clades, latinOf, layoutBrackets, rankOf, ROW_H, type Placed } from './brackets';
import { FanCamera } from './camera';
import { Fold } from './fold';
import { layoutFan, type Fan, type FanBranch, type WidthMode } from './layout';
import { CARNIVORA, FELIDAE } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE } from './splits';
import { TwigModel } from './twigs';
import { familySpan } from './view';

const W = 390;
const AXIS = 72;
const measure = (_f: string, t: string) => 6 * t.length;

const fans = new Map<string, Fan>();
function fanOf(level: 'cats' | 'carnivores', mode: WidthMode, fold: boolean): Fan {
  const key = `${level}:${mode}:${fold}`;
  let fan = fans.get(key);
  if (!fan) {
    fan = level === 'cats' ? layoutFan(FELIDAE, mode, FELIDAE_TREE) : layoutFan(CARNIVORA, mode, CARNIVORA_TREE);
    if (fold) {
      const f = new Fold(fan);
      f.setAll(0);
      fan.tess.fold = f;
    }
    fans.set(key, fan);
  }
  return fan;
}
function cameraOf(fan: Fan): FanCamera {
  const models = new Map<FanBranch, TwigModel>();
  const c = new FanCamera(fan, (b) => {
    let m = models.get(b);
    if (!m) models.set(b, (m = new TwigModel(b, fan.time, fan.mode)));
    return m;
  });
  c.w = W;
  c.h = 844;
  c.cam = c.home();
  return c;
}

describe('the clades', () => {
  it('ranks by the Latin ending, cleaned of a disambiguation', () => {
    expect(rankOf('Felidae')).toBe('family');
    expect(rankOf('Pantherinae')).toBe('subfamily');
    expect(rankOf('Feliformia')).toBe('suborder');
    expect(rankOf('Carnivora')).toBe('order');
    expect(rankOf('Panthera')).toBe('genus');
    expect(rankOf('')).toBeNull();
    expect(latinOf({ taxon: 'Prionodon (genus in Opisthokonta)' } as never)).toBe('Prionodon');
  });

  it('nest as the tree does: Panthera ⊂ Pantherinae ⊂ Felidae (⊂ Feliformia ⊂ Carnivora), each inside its parent', () => {
    for (const level of ['cats', 'carnivores'] as const) {
      const list = clades(fanOf(level, 'log', false));
      const chain = (latin: string) => {
        const out: string[] = [];
        for (let i = list.findIndex((q) => q.latin === latin); i >= 0; i = list[i].parent) out.push(list[i].latin);
        return out;
      };
      expect(chain('Panthera')).toEqual(level === 'cats' ? ['Panthera', 'Pantherinae', 'Felidae'] : ['Panthera', 'Pantherinae', 'Felidae', 'Feliformia', 'Carnivora']);
      list.forEach((q, i) => {
        if (q.parent < 0) return;
        expect(q.parent).toBeLessThan(i);
        const ps = new Set(list[q.parent].strands);
        expect(q.strands.every((k) => ps.has(k))).toBe(true);
      });
      // Plain English where there is a name.
      expect(list.find((q) => q.latin === 'Pantherinae')?.en).toBe('Big cats');
    }
  });

  it('a shown bracket stands above every shown bracket inside it', () => {
    // A family of three: 0 ⊃ 1 ⊃ 2 and 0 ⊃ 3, the middle one too narrow to show.
    const row = bracketRows([0, 10, 10, 60], [100, 12, 50, 90], [-1, 0, 1, 0]);
    expect(row[1]).toBe(-1);
    expect(row[2]).toBe(0);
    expect(row[3]).toBe(0);
    expect(row[0]).toBe(1);
  });
});

/** The stack laid out at width zoom `z` × home (the fold at that zoom), the camera's centre moved by `pan` screens. */
function stackAt(fan: Fan, z: number, pan: number): { placed: Placed[]; br: Brackets } {
  const c = cameraOf(fan);
  const sx = c.cam.sx * z;
  fan.tess.fold?.setScale(sx, W);
  const cx = c.cam.cx + (pan * W) / sx;
  const br = new Brackets('n', 'l');
  const cam = { w: W, cam: { sx }, toScreen: (x: number): [number, number] => [W / 2 + (x - cx) * sx, 0] };
  return { placed: br.layout(cam, fan, 300, AXIS, 1, measure), br };
}

describe('the stack', () => {
  const ZOOMS = [1, 1.4, 2, 3, 5, 8, 14, 30, 80];
  const PANS = [-0.6, 0, 0.45];
  for (const [level, mode, fold] of [['cats', 'linear', false], ['cats', 'log', false], ['carnivores', 'linear', true], ['carnivores', 'log', true]] as const) {
    it(`${level}, ${mode} widths${fold ? ', folded' : ''}: no two brackets meet, nesting reads bottom-up, labels only where they fit`, () => {
      const fan = fanOf(level, mode, fold);
      let labelled = 0;
      for (const z of ZOOMS)
        for (const pan of PANS) {
          const { placed, br } = stackAt(fan, z, pan);
          const at = new Map(placed.map((p) => [p.i, p]));
          for (const p of placed) {
            // Its parent (if shown) a row higher, and spanning it.
            for (let k = br.list[p.i].parent; k >= 0; k = br.list[k].parent) {
              const q = at.get(k);
              if (!q) continue;
              expect(q.row).toBeGreaterThan(p.row);
              expect(q.a).toBeLessThanOrEqual(p.a + 1e-6);
              expect(q.b).toBeGreaterThanOrEqual(p.b - 1e-6);
              break;
            }
            // No other in its row meets it.
            for (const q of placed) if (q !== p && q.row === p.row) expect(Math.min(p.b, q.b) - Math.max(p.a, q.a), `${br.list[p.i].latin}/${br.list[q.i].latin} z${z}`).toBeLessThanOrEqual(0);
            // A label inside its bracket's part on screen, right of the axis, with room both sides.
            if (p.form !== 'tick') {
              labelled++;
              expect(p.lx - p.lw / 2).toBeGreaterThanOrEqual(Math.max(p.a, AXIS) + 4);
              expect(p.lx + p.lw / 2).toBeLessThanOrEqual(Math.min(p.b, W) - 4);
            } else expect(p.lw).toBe(0);
          }
          // The band a pill stands on covers each bracket's row.
          for (const p of placed) if (p.b > 1 && p.a < W - 1) expect(br.band(Math.max(0, p.a + 1), Math.min(W, p.b - 1))).toBeGreaterThanOrEqual((p.row + 1) * ROW_H);
        }
      expect(labelled).toBeGreaterThan(5);
    });
  }

  it('a tap takes the bracket under it, or the nearest within a few px, in its row', () => {
    const br = new Brackets('n', 'l');
    const fan = fanOf('cats', 'log', false);
    br.list = clades(fan);
    br.nowS = 300;
    br.placed = [
      { i: 0, a: 10, b: 300, row: 1, form: 'tick', lx: 0, lw: 0 },
      { i: 1, a: 100, b: 102, row: 0, form: 'tick', lx: 0, lw: 0 },
      { i: 2, a: 103, b: 105, row: 0, form: 'tick', lx: 0, lw: 0 },
    ];
    expect(br.hit(104, br.rowY(0))?.v).toBe(br.list[2].v);
    expect(br.hit(102.4, br.rowY(0))?.v).toBe(br.list[1].v);
    expect(br.hit(150, br.rowY(0))).toBeNull();
    expect(br.hit(150, br.rowY(1))?.v).toBe(br.list[0].v);
  });

  it('labels follow the room: the full name, then the name alone, then a tick', () => {
    const w = (): [number, number] => [80, 40];
    const [full, name, tick] = layoutBrackets([100, 200, 300], [200, 260, 320], [-1, -1, -1], w, 0, W);
    expect([full.form, name.form, tick.form]).toEqual(['full', 'name', 'tick']);
  });
});

describe('a tap on a bracket', () => {
  for (const [level, latin, fold, mode] of [
    ['carnivores', 'Felidae', true, 'log'],
    ['carnivores', 'Canidae', true, 'log'],
    ['carnivores', 'Canidae', true, 'linear'],
    ['carnivores', 'Pantherinae', true, 'linear'],
    ['cats', 'Panthera', false, 'log'],
    ['cats', 'Pantherinae', false, 'linear'],
  ] as const) {
    it(`${latin} (${level}, ${mode}): centred, across most of the screen, "now" at the top and its stem's start just below`, () => {
      const fan = fanOf(level, mode, fold);
      const c = cameraOf(fan);
      const v = fan.nodes.find((n) => latinOf(n.split) === latin)!;
      c.cam = cladeCamera(c, fan, v, familySpan);
      const want = c.cam.sx;
      c.settle();
      expect(c.cam.sx / want, 'capped').toBeCloseTo(1, 3);
      const [a, b] = familySpan(v).map((x) => c.toScreen(x, 0)[0]);
      // Centred in the room right of the time axis, across most of the screen.
      expect(Math.abs((a + b) / 2 - (58 + W - 14) / 2)).toBeLessThan(12);
      expect(b - a).toBeGreaterThan(0.75 * W);
      // "now" near the top (under the labels' room), the stem's start low on the screen, above the legend.
      const nowS = c.toScreen(0, fan.time.y(0))[1];
      const stemS = c.toScreen(0, v.yBot)[1];
      expect(nowS).toBeGreaterThan(60);
      expect(nowS).toBeLessThan(0.2 * c.h);
      expect(stemS).toBeGreaterThan(0.75 * c.h);
      expect(stemS).toBeLessThan(c.h - 104);
    });
  }
});
