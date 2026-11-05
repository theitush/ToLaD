// One picture size (ToLaD#400, Ita: "just one size"): every disc a frame draws is PIC_D across, whichever tier its
// label is; a name alone's pill stays a pill across; and the disc stands at the foot of the room frames and taps go by.
// Measured at the draw itself, at mammals and the carnivores, home and through a zoom.
import { describe, expect, it, vi } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, mammaliaClade, type CladeRec } from './panthera';
import { PIC_D, PIC_ROOM } from './pics';
import { CARNIVORA_TREE, mammaliaTree, type Split } from './splits';
import { FanView } from './view';
import { drawPic } from './wiki';

vi.mock('./wiki', async (orig) => {
  const w = await orig<typeof import('./wiki')>();
  return { ...w, drawPic: vi.fn(w.drawPic) };
});

/** The pills' roundRects a frame draws (radius a pill's): [x, y, w, h]. */
const pills: number[][] = [];

function stubView(clade: CladeRec, tree: Split): FanView {
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
    {
      measureText: (t: string) => ({ width: t.length * 7.5 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      roundRect: (x: number, y: number, w: number, h: number, r: number) => {
        if (r === 11) pills.push([x, y, w, h]);
      },
    } as Record<string, unknown>,
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
  return new FanView(canvas as unknown as HTMLCanvasElement, clade, tree, true);
}

const applyFold = (v: FanView) => (v as unknown as { applyFold(): void }).applyFold();

describe('every picture on screen one size (ToLaD#400)', () => {
  const FANS: [string, () => Promise<FanView>][] = [
    ['the carnivores', async () => stubView(CARNIVORA, CARNIVORA_TREE)],
    [
      'the mammals',
      async () => {
        await loadMammalsFromFiles();
        return stubView(mammaliaClade(), mammaliaTree());
      },
    ],
  ];

  it.each(FANS)('%s: one diameter, for both tiers, drawn', { timeout: 120_000 }, async (_name, mk) => {
    const v = await mk();
    const home = v.homeCamera();
    const bad: string[] = [];
    let names = 0;
    for (let i = 0; i <= 64; i += 4) {
      const k = Math.pow(2, i / 8);
      v.cam = { ...home, sx: home.sx * k };
      applyFold(v);
      vi.mocked(drawPic).mockClear();
      pills.length = 0;
      v.draw();
      const c = v.cutLast!;
      names += c.names.length;
      const at = `zoom ${k.toFixed(2)}`;
      const sizes = new Set(vi.mocked(drawPic).mock.calls.map((a) => a[4]));
      if (sizes.size > 1 || (sizes.size === 1 && !sizes.has(PIC_D))) bad.push(`${at}: discs of ${[...sizes]} px`);
      // A disc for every label the frame drew.
      const shown = c.names.filter((s) => s.fit >= 0.01 && s.box[2] >= 0 && s.box[0] <= v.w && s.box[3] >= 0 && s.box[1] <= v.h).length;
      if (vi.mocked(drawPic).mock.calls.length !== c.pics.length + shown) bad.push(`${at}: ${vi.mocked(drawPic).mock.calls.length} discs for ${c.pics.length} pictures and ${shown} names`);
      // Every disc at its room's foot, the room never above the band's row.
      for (const p of c.pics) if (p.y + PIC_D / 2 - PIC_ROOM < v.rowLast - 1e-6) bad.push(`${at}: ${p.face.sp.sci}'s room above the row`);
      for (const s of c.names) {
        // Its box the disc's width, the pill a pill across, drawn so, the same gap over the disc as a picture's.
        if (Math.abs(s.box[2] - s.box[0] - PIC_D) > 1e-6) bad.push(`${at}: ${s.text}'s box is ${s.box[2] - s.box[0]} wide`);
        if (s.fit >= 0.01 && s.box[2] >= 0 && s.box[0] <= v.w && s.box[3] >= 0 && s.box[1] <= v.h && !pills.some(([x, , w]) => Math.abs(x - (s.x - 11)) < 1e-6 && w === 22)) bad.push(`${at}: ${s.text}'s pill is not 22 across`);
        if (Math.abs(s.y1 - (s.disc!.y - PIC_D / 2 - 4)) > 1e-6) bad.push(`${at}: ${s.text}'s pill is not 4 px over its disc`);
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
    expect(names).toBeGreaterThan(0);
  });
});
