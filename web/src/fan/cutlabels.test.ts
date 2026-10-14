// ?labels=cut (ToLaD#333, research/scalable-tree.md §3): names, pictures and "+x" from one cut through the territories.
// No two names meet, no two pictures, no name and picture (names hang below a tip, pictures stand on it); each stays
// inside its own territory; and what shows depends only on the camera, not the way there.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, 'curved', tree, folds);
}

const was = FanView.labelsCut;
beforeAll(() => {
  FanView.labelsCut = true;
});
afterAll(() => {
  FanView.labelsCut = was;
});

const shot = (v: FanView): CutLabels => {
  v.draw();
  return v.cutLast!;
};
const sig = (c: CutLabels) => [...c.spots.map((s) => `${s.key} ${s.text} ${s.box.map((q) => q.toFixed(3)).join(',')}`), ...c.pics.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`)];

function check(c: CutLabels, w: number): void {
  const S = [...c.spots].sort((p, q) => p.x - q.x);
  for (let k = 1; k < S.length; k++) expect(S[k].box[0]).toBeGreaterThanOrEqual(S[k - 1].box[2] - 1e-6);
  const P = [...c.pics].sort((p, q) => p.x - q.x);
  for (let k = 1; k < P.length; k++) expect(P[k].x - P[k].d / 2).toBeGreaterThanOrEqual(P[k - 1].x + P[k - 1].d / 2 - 1e-6);
  for (const p of P)
    for (const s of S)
      if (s.box[2] > p.x - p.d / 2 && s.box[0] < p.x + p.d / 2) expect(s.box[1]).toBeGreaterThanOrEqual(p.y + p.d / 2 - 1e-6);
  for (const s of S) expect([s.key, s.x, s.box[2] > 0 && s.box[0] < w]).toEqual([s.key, s.x, true]);
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
        // Each picture stands over the column of the species it shows at "now", its territory only bounding it: within
        // half its width of it (the territory holds that column and the picture), where the screen leaves it room.
        for (const p of cut.pics) {
          const c = v.toScreen(groupCentre({ b: p.face }), 0)[0];
          if (c >= 72 + p.d / 2 && c <= v.w - p.d / 2) expect([p.face.sp.common, Math.abs(p.x - c) <= p.d / 2 + 1e-6]).toEqual([p.face.sp.common, true]);
        }
        seen.push(sig(cut));
      }
      // The same camera, reached the other way round (from deep in to home), gives the same labels.
      for (let i = cams.length - 1; i >= 0; i--) {
        v.cam = { ...cams[i] };
        expect(sig(shot(v))).toEqual(seen[i]);
      }
      const ms = [...(v as unknown as { labelLayMs: number[] }).labelLayMs].sort((p, q) => p - q);
      (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`${name}: labels (brackets' layout included) ${ms[ms.length >> 1].toFixed(3)} ms a frame (median of ${ms.length}), ${seen[0].length} at home\n`);
    });
});
