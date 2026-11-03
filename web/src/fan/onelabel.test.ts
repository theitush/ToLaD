// One cut, one label (ToLaD#358): invariants over the whole tree (nothing culled for the screen), at the rungs of the
// width-zoom ladder from home to where every species has a label of its own, at the cats, the carnivores and the
// mammals. Checked by code, not per clade by eye (Ita: "these things should be done by code").
//   1. every species is counted by exactly one shown label: its name or its "+x";
//   2. no two labels' boxes (a picture's disc, a name pill) overlap;
//   3. every label has a name and a picture (a photo or the placeholder disc), one each, over one x;
//   4. zooming in only splits a label into finer ones: each species' label only narrows, never shows, hides, shows;
//   5. what a mammals frame's labels cost (printed; the cut's walk is on screen only: see cut.test).
import { describe, expect, it } from 'vitest';
import { loadMammalsFromFiles } from './mammals-node';
import { CARNIVORA, FELIDAE, mammaliaClade, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, mammaliaTree, type Split } from './splits';
import { LADDER } from './cut';
import { PIC_D } from './pics';
import { FanView, type CutLabels } from './view';

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

/** Invariants 1–3 at one camera; per species (strand index) its label's strands [f, l]. */
function check(v: FanView, c: CutLabels, at: string, bad: string[]): Int32Array {
  const strands = v.fan.tess.fold ? (v.fan.tess.fold as unknown as { strands: { sp: { sci: string } }[] }).strands : [];
  const n = strands.length;
  const by = new Map(strands.map((b, i) => [b, i]));
  const label = new Int32Array(2 * n).fill(-1);
  const seen = new Uint8Array(n);
  // 3. One picture per name, over the same x, a name's text and a picture's species each.
  if (c.spots.length !== c.pics.length || c.spots.length !== c.items.length) bad.push(`${at}: ${c.spots.length} names, ${c.pics.length} pictures, ${c.items.length} items`);
  c.spots.forEach((s, i) => {
    const p = c.pics[i];
    if (!s.text || !p || !p.face || p.d !== PIC_D || Math.abs(p.x - s.x) > 1e-6) bad.push(`${at}: label ${s.key} "${s.text}" without its picture`);
    // 1. Its name's species (when it names one) and its "+x" species: its item's, each once.
    const it = c.items[i];
    // (Its name names a species when its picture's is not in its "+x"; s.b is where a tap goes, the item's own.)
    const hid = (c.groups.get(s.key) ?? []).flat();
    const sp = [...(hid.includes(p.face) ? [] : [p.face]), ...hid];
    if (sp.length !== it.l - it.f + 1) bad.push(`${at}: "${s.text}" counts ${sp.length} of its ${it.l - it.f + 1} species`);
    for (const b of sp) {
      const k = by.get(b as never)!;
      seen[k]++;
      label[2 * k] = it.f;
      label[2 * k + 1] = it.l;
    }
  });
  const miss = [...seen.keys()].filter((k) => seen[k] !== 1);
  if (miss.length) bad.push(`${at}: ${miss.length} species not counted once, e.g. ${strands[miss[0]].sp.sci} (${seen[miss[0]]})`);
  // 2. No two boxes meet: the pills and the discs, swept left to right.
  const boxes: [number, number, number, number, string][] = [
    ...c.spots.map((s) => [...s.box, `"${s.text}"`] as [number, number, number, number, string]),
    ...c.pics.map((p) => [p.x - p.d / 2, p.y - p.d / 2, p.x + p.d / 2, p.y + p.d / 2, `picture of ${p.face.sp.common}`] as [number, number, number, number, string]),
  ].sort((a, b) => a[0] - b[0]);
  const eps = 1e-6;
  for (let i = 0; i < boxes.length && bad.length < 20; i++)
    for (let j = i + 1; j < boxes.length && boxes[j][0] < boxes[i][2] - eps; j++)
      if (boxes[j][1] < boxes[i][3] - eps && boxes[i][1] < boxes[j][3] - eps) bad.push(`${at}: ${boxes[i][4]} meets ${boxes[j][4]}`);
  return label;
}

const mammals = async () => {
  await loadMammalsFromFiles();
  return stubView(mammaliaClade(), mammaliaTree(), true);
};
/** The fans, and every how many rungs of the ladder each is checked: the mammals every half doubling (a whole-tree cut there is ~0.6 s at species level; every 4th rung passes too, 2.5 min). */
const FANS: [string, () => Promise<FanView>, number][] = [
  ['cats', async () => stubView(FELIDAE as CladeRec, FELIDAE_TREE as Split, false), 1],
  ['carnivores', async () => stubView(), 1],
  ['mammals', mammals, 16],
];

describe('one cut, one label (ToLaD#358): invariants over the whole tree at the zoom ladder', () => {
  for (const [name, mk, every] of FANS)
    it(name, { timeout: 600_000 }, async () => {
      const v = await mk();
      const home = v.homeCamera();
      const bad: string[] = [];
      let prev: Int32Array | null = null;
      let rungs = 0;
      let most = 0;
      let still = 0;
      // (A species' picture is its label's name's: it may go to a richer sister's run and come back as its own clade
      // splits off, the naming rule's honest result, steadylabels' one exemption: how many species, printed.)
      const pic = new Map<string, number>();
      const again = new Set<string>();
      const t0 = performance.now();
      const err = (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr;
      // (From home in, `every` rungs (1/LADDER of a doubling) at a time, to where every species has a label of its own,
      // or none splits further for 4 doublings: a fossil with no room of its own at its tip rides with its neighbour.)
      let c = v.wholeLabels();
      for (let k = 0; k <= 24 * LADDER && still < 4 * LADDER; k += every) {
        v.cam = { ...home, sx: home.sx * Math.pow(2, k / LADDER) };
        const n = c.items.length;
        c = v.wholeLabels();
        still = k && c.items.length === n ? still + every : 0;
        const at = `${name} ${(v.cam.sx / home.sx).toPrecision(4)}x`;
        const label = check(v, c, at, bad);
        rungs++;
        most = Math.max(most, c.spots.length);
        // 4. Each species' label only narrows going in.
        if (prev)
          for (let i = 0; i < label.length; i += 2)
            if (label[i] < prev[i] || label[i + 1] > prev[i + 1]) {
              bad.push(`${at}: species ${i / 2}'s label went from strands ${prev[i]}-${prev[i + 1]} to ${label[i]}-${label[i + 1]}`);
              break;
            }
        prev = label;
        const now = new Set(c.pics.map((p) => p.face.sp.sci));
        for (const [k, st] of pic) if (st === 1 && !now.has(k)) pic.set(k, 2);
        for (const k of now) {
          if (pic.get(k) === 2) again.add(k);
          pic.set(k, 1);
        }
        if (bad.length >= 20 || c.items.every((it) => it.f === it.l)) break;
      }
      const ms = (performance.now() - t0) / rungs;
      const multi = c.items.filter((it) => it.l > it.f).length;
      err.write(`onelabel ${name}: ${rungs} rungs to ${(v.cam.sx / home.sx).toPrecision(4)}x, up to ${most} labels (${multi} still for more than one species), ${ms.toFixed(1)} ms a whole-tree cut; ${again.size} of ${pic.size} species' pictures shown again after they went${again.size ? ` (${[...again].slice(0, 6).join(', ')}${again.size > 6 ? ', ...' : ''})` : ''}\n`);
      expect(bad).toEqual([]);
    });

  it('mammals: a frame on screen (the cut and its labels, the brackets laid out) at home and in', { timeout: 300_000 }, async () => {
    const v = await mammals();
    const home = v.homeCamera();
    const P = v as unknown as { labelMs: number[] };
    const out: string[] = [];
    for (const z of [1, 4, 16, 64]) {
      v.cam = { ...home, sx: home.sx * z };
      v.draw();
      P.labelMs.length = 0;
      for (let i = 0; i < 5; i++) v.draw();
      const ms = [...P.labelMs].sort((a, b) => a - b)[2];
      out.push(`${z}x ${ms.toFixed(2)} ms`);
      expect(v.cutLast!.spots.length).toBeGreaterThan(0);
    }
    (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`onelabel mammals frame labels: ${out.join(', ')}\n`);
  });
});
