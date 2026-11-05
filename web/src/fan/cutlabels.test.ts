// ?labels=cut (ToLaD#333, research/scalable-tree.md §3): names, pictures and "+x" from one cut through the territories.
// No two names meet, no two pictures, no name and picture (a name stands on its picture, the picture over its tip); each stays
// inside its own territory; and what shows depends only on the camera, not the way there.
import { describe, expect, it } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { PIC_D, PIC_ROOM } from './pics';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { FanView, groupCentre, type CutLabels } from './view';

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


const shot = (v: FanView): CutLabels => {
  v.draw();
  return v.cutLast!;
};
const sig = (c: CutLabels) => [...c.spots.map((s) => `${s.key} ${s.text} ${s.box.map((q) => q.toFixed(3)).join(',')}`), ...c.pics.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`)];

function check(c: CutLabels, w: number): void {
  const S = [...c.spots].sort((p, q) => p.x - q.x);
  for (let k = 1; k < S.length; k++) expect(S[k].box[0]).toBeGreaterThanOrEqual(S[k - 1].box[2] - 1e-6);
  const P = [...c.pics].sort((p, q) => p.x - q.x);
  for (let k = 1; k < P.length; k++) expect(P[k].x - PIC_D / 2).toBeGreaterThanOrEqual(P[k - 1].x + PIC_D / 2 - 1e-6);
  // (No name over a picture, ToLaD#373.)
  for (const p of P)
    for (const s of S)
      if (s.box[2] > p.x - PIC_D / 2 && s.box[0] < p.x + PIC_D / 2) expect(s.box[3]).toBeLessThanOrEqual(p.y - PIC_D / 2 + 1e-6);
  // (Each on screen, its picture at least: it stays until wholly off the edge.)
  for (const q of c.pics) expect([q.x, q.x + PIC_ROOM / 2 >= 0 && q.x - PIC_ROOM / 2 <= w]).toEqual([q.x, true]);
}

const mammals = async () => {
  await loadMammalsFromFiles();
  return stubView(mammaliaClade(), mammaliaTree(), true);
};
const FANS: [string, () => Promise<FanView>][] = [
  ['cats', async () => stubView(FELIDAE as CladeRec, FELIDAE_TREE as Split, false)],
  ['carnivores', async () => stubView()],
  ['mammals', mammals],
  // (Widths by mass, ToLaD#338: the same rooms, measured otherwise.)
  [
    'carnivores, widths by mass',
    async () => {
      const v = stubView();
      v.setMeasure('mass');
      return v;
    },
  ],
  [
    'mammals, widths by mass',
    async () => {
      const v = await mammals();
      v.setMeasure('mass');
      return v;
    },
  ],
];

describe('labels from the cut (?labels=cut, ToLaD#333)', () => {
  for (const [name, mk] of FANS)
    it(name, { timeout: 300_000 }, async () => {
      const v = await mk();
      const home = v.homeCamera();
      const cams = [home, ...[2, 5, 13, 40].flatMap((z) => [0.3, 0.6].map((f) => ({ ...home, sx: home.sx * z, cx: home.cx + (f - 0.5) * (v.w / home.sx) })))];
      // (The hoofed mammals and the horses framed, at the mammals: their pictures over their columns, Ita 2026-10-14.)
      for (const t of ['Artiodactyla', 'Perissodactyla', 'Camelidae', 'Equidae']) if (v.fan.nodes.some((u) => u.split.taxon === t)) cams.push(v.levelCamera(t)!);
      const seen: string[][] = [];
      for (const c of cams) {
        v.cam = { ...c };
        const cut = shot(v);
        if (c === home) expect(cut.spots.length).toBeGreaterThan(0);
        check(cut, v.w);
        // Each picture stands over the column of the species it shows at "now", a "+x"'s over the middle of its
        // branches at its foot (ToLaD#368), its territory only bounding it: within half its width of it (the territory
        // holds that column and the picture), where the screen leaves it room.
        for (let i = 0; i < cut.pics.length; i++) {
          const p = cut.pics[i];
          const o = cut.spots[i].over;
          const c = o ? (o[0] + o[1]) / 2 : v.toScreen(groupCentre({ b: p.face }), 0)[0];
          if (c >= 72 + PIC_ROOM / 2 && c <= v.w - PIC_ROOM / 2) expect([p.face.sp.common, Math.abs(p.x - c) <= PIC_ROOM / 2 + 1e-6]).toEqual([p.face.sp.common, true]);
        }
        // With "now" on screen, no label of a living item reaches below the now line (ToLaD#373, Ita: "so that they dont
        // cover the branches"): its name over its picture over its "+x" line, all above it, and every picture in one row.
        const nowY = v.toScreen(0, v.fan.time.y(0))[1];
        const T = (v as unknown as { territories(): { whole(k: number, f: number, l: number): number; youngOf(k: number): number } }).territories();
        const row = (v as unknown as { rowLast: number }).rowLast;
          for (let i = 0; i < cut.spots.length; i++) {
            const it = cut.items[i];
            if (T.youngOf(T.whole(it.head, it.f, it.l)) > v.fan.time.y(0)) continue;
            const s = cut.spots[i];
            const p = cut.pics[i];
            if (p.y + PIC_D / 2 - PIC_ROOM > row + 1e-6) {
              expect([s.text, p.y + PIC_D / 2 + 14]).toEqual([s.text, expect.closeTo(nowY, 6)]);
              if (s.over) expect([s.text, s.over[2] < nowY && s.over[2] > p.y + PIC_D / 2]).toEqual([s.text, true]);
            }
          }
        // One rigid unit (ToLaD#373, Ita: "the name should be attached to the pic and always above it"): each pill
        // centred on its picture, its foot just over it, never under the band's row less the longest pill.
        for (let i = 0; i < cut.spots.length; i++) {
          const s = cut.spots[i];
          const p = cut.pics[i];
          expect([s.text, s.x, s.box[3]]).toEqual([s.text, expect.closeTo(p.x, 6), expect.closeTo(p.y - PIC_D / 2 - 4, 6)]);
          expect([s.text, p.y + PIC_D / 2 - PIC_ROOM >= row - 1e-6]).toEqual([s.text, true]);
        }
        seen.push(sig(cut));
      }
      // The same camera, reached the other way round (from deep in to home), gives the same labels.
      for (let i = cams.length - 1; i >= 0; i--) {
        v.cam = { ...cams[i] };
        expect(sig(shot(v))).toEqual(seen[i]);
      }
      const ms = [...(v as unknown as { labelMs: number[] }).labelMs].sort((p, q) => p - q);
      (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`${name}: labels (brackets' layout included) ${ms[ms.length >> 1].toFixed(3)} ms a frame (median of ${ms.length}), ${seen[0].length} at home\n`);
    });
});
