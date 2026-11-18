// The amniotes (ToLaD#539, the bar's "tree: amniotes", `?tree=amniotes`): data/amniotes loads and opens as the page opens it, home
// titled "Amniotes" with the human named on it and its picture whole, taps on the names of the groups the birds are in (their line
// with its fossils first) land inside the birds, a level of their own, and a bird's card and a reptile's say what is known (a bird's
// modelled count; a reptile's unknown, its Latin once, the stubs for its picture and globe; a reptile a published number
// counts, what it counts and its source, ToLaD#578). One process: the level's data is module
// state, so this file loads only these.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Camera, FanCamera } from './camera';
import { SpeciesCard } from './FanApp';
import { setFlip } from './flip';
import type { FanNode } from './layout';
import { mammalData } from './mammals-data';
import { loadMammalsFromFiles, NODE_FOSSILS } from './mammals-node';
import { mammaliaClade } from './panthera';
import { picBox } from './pics';
import { mammaliaTree } from './splits';
import type { Steady } from './steady';
import { chainOf, FanView, groupName, isLevel, levelClade, type CutLabels, type GapMember } from './view';

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
  famHits: { box: number[]; v: FanNode }[];
  territories(): never;
  gapCoverAt(T: never, sx: number): GapMember[];
  picSpots: CutLabels['pics'];
};
const P = (v: FanView) => v as unknown as Priv;

describe('the amniotes (ToLaD#539)', () => {
  let v: FanView;
  let home: Camera;
  beforeAll(async () => {
    await loadMammalsFromFiles('amniotes');
    setFlip(true);
    v = stubView();
    home = v.homeCamera();
  }, 300_000);

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
  const node = (taxon: string) => v.fan.nodes.find((u) => u.split.taxon === taxon)!;

  it('opens: Amniotes, its birds, reptiles and mammals, the classes and the reptiles\' orders its levels', () => {
    const c = mammaliaClade();
    expect(c.sci).toBe('Amniota');
    expect(c.common).toBe('Amniotes');
    // (The look it runs on, ToLaD#279: every fossil, the page's, 40,000 and more; the old look (TOLAD_FOSSILS=old), the living and the phylogeny's fossils, ~31,000.)
    expect(c.species.length).toBeGreaterThan(NODE_FOSSILS === 'all' ? 40_000 : 30_000);
    for (const t of ['Mammalia', 'Aves', 'Squamata', 'Testudines', 'Crocodylia']) {
      expect(isLevel(v.fan, node(t)), t).toBe(true);
      expect(chainOf(v.fan, node(t))[0], t).toBe('Amniotes');
    }
    // (Above the orders no level, as at the mammals: Sauria, Archosauromorpha are fork names. Archosauria is none with every fossil: its
    // split is as old as the stem split round it, spliceTies' one date.)
    for (const t of ['Sauria', 'Archosauromorpha']) expect(isLevel(v.fan, node(t)), t).toBe(false);
    // (The fossils: the synapsids, a stem round the mammals, told by them; the dinosaurs' line by its name.)
    expect(groupName(v.fan, node('Synapsida'))).toBe('Mammals & kin');
    expect(groupName(v.fan, node('Avemetatarsalia'))).toBe('Dinosaurs, pterosaurs & birds');
    expect(chainOf(v.fan, v.fan.branches.find((b) => b.sp.sci === 'Tyrannosaurus rex')!.node)[0]).toBe('Amniotes');
    expect(chainOf(v.fan, v.fan.branches.find((b) => b.sp.sci === 'Passer domesticus')!.node).slice(0, 3)).toEqual(['Amniotes', 'Birds', 'Perching birds']);
    expect(chainOf(v.fan, v.fan.branches.find((b) => b.sp.sci === 'Homo sapiens')!.node).slice(0, 3)).toEqual(['Amniotes', 'Mammals', 'Primates']);
  });

  it('home: the human named, its picture whole on the screen', () => {
    stand(home);
    const hum = v.fan.branches.find((b) => b.sp.sci === 'Homo sapiens')!;
    expect([...v.cutLast!.names, ...v.cutLast!.spots].some((s) => s.b === hum && s.box[2] >= 0 && s.box[0] <= v.w), 'the human named at home').toBe(true);
    const pic = P(v).picSpots.find((q) => q.lv.b === hum);
    // (Its picture: on every fossil, the page's look, the zoom gives it one at home (picRanges); on the old look its room goes to others' (the skinks', the
    // sparrows', the hamsters'...) and it is named alone. Where it has one, whole on the screen.)
    if (NODE_FOSSILS === 'all') expect(pic, 'a picture for the human at home').toBeTruthy();
    if (pic) {
      const box = picBox(pic);
      expect(box[0]).toBeGreaterThanOrEqual(-0.5);
      expect(box[2]).toBeLessThanOrEqual(v.w + 0.5);
    }
    // (No group told by a binomial: a face with no English name tells it by a rank name.)
    const latin = new Set(v.fan.branches.map((b) => b.sp.sci));
    for (const g of P(v).gapCoverAt(P(v).territories(), v.cam.sx)) if (g.lv.v) expect(latin.has(groupName(v.fan, g.lv.v).replace(/ & kin$/, ''))).toBe(false);
  });

  it('from home, taps on the names of the groups the birds are in reach the birds', () => {
    // (With every fossil the birds sit in their line's stems, the dinosaurs': home names the line, "Birds & kin", and each tap on the name
    // of the group holding the house sparrow goes a group deeper, to the birds' own name; a tap on it lands inside the birds.)
    stand(home);
    const sparrow = v.fan.branches.find((b) => b.sp.sci === 'Passer domesticus')!;
    const seen: string[] = [];
    for (let k = 0; k < 6 && !chainOf(v.fan, levelClade(v.fan, v.levelNow())).includes('Birds'); k++) {
      const h = P(v).famHits.find((q) => q.v.strands.includes(sparrow));
      expect(h, `the sparrow's group among the names after ${seen.join(' > ') || 'home'}: ${P(v).famHits.map((q) => groupName(v.fan, q.v)).join(', ')}`).toBeTruthy();
      seen.push(groupName(v.fan, h!.v));
      v.tap((h!.box[0] + h!.box[2]) / 2, (h!.box[1] + h!.box[3]) / 2);
      run();
    }
    expect(seen[0]).toBe('Birds & kin');
    expect(v.cam.sx).toBeGreaterThan(home.sx * 1.2);
    expect(chainOf(v.fan, levelClade(v.fan, v.levelNow())), seen.join(' > ')).toContain('Birds');
  });

  it("a bird's card and a reptile's", () => {
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const card = (sci: string) => {
      const sp = mammaliaClade().species.find((s) => s.sci === sci)!;
      return { sp, html: renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />) };
    };
    const bird = card('Passer domesticus');
    expect(bird.sp.common).toBe('House sparrow');
    expect(bird.sp.countUnknown).toBe(false);
    // (Date-source code 0 is any group's dated tree on this data (META.amniotes): "calibrated", never Upham's alone. The fan's species rows carry the other codes; the root's row code 0.)
    expect(mammalData().clade.dateSource).toBe('calibrated');
    expect(mammaliaClade().species.some((s) => s.dateSource === 'upham-calibrated')).toBe(false);
    expect(text(bird.html)).toMatch(/House sparrow \(Passer domesticus\)/);
    expect(text(bird.html)).toMatch(/alive today/);
    const lizard = card('Varanus salvator');
    expect(lizard.sp.countUnknown).toBe(true);
    // (No English name: its Latin once, as the title.)
    expect(text(lizard.html)).not.toMatch(/Varanus salvator \(Varanus salvator\)/);
    expect(lizard.html).toMatch(/class="sci"[^>]*>Varanus salvator</);
    expect(text(lizard.html)).toMatch(/Unknown/);
    // A reptile with a published count (ToLaD#578): its number as the source gives it, what it counts, its source linked.
    const komodo = card('Varanus komodoensis');
    expect(komodo.sp.countUnknown).toBe(false);
    expect(komodo.sp.count?.counts).toBe('all ages');
    expect(text(komodo.html)).toMatch(/~3\.5k alive today counted/);
    expect(text(komodo.html)).toMatch(/all ages, 2021 \( Jessop et al\. 2021 \)/);
    const leatherback = card('Dermochelys coriacea');
    expect(text(leatherback.html)).toMatch(/alive today published estimate/);
    expect(text(leatherback.html)).toMatch(/adult females, 2020 \( NMFS & USFWS 2020 \)/);
    expect(leatherback.html).toMatch(/href="https:\/\/www\.govinfo\.gov\//);
    const caiman = card('Caiman crocodilus');
    expect(text(caiman.html)).toMatch(/mature individuals, 2019/);
  });
});
