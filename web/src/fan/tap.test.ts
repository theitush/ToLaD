// A species flown to lands on screen (ToLaD#211): in the folded carnivores the fold opens and its anchor moves as the
// camera zooms, so a frame computed before the flight once landed with the species beside the screen. Every one of the
// 292 species, flown to from home at both widths (and a sample from zoomed in on the dogs), lands with its column's
// centre at the screen's centre and the column on screen.
import { describe, expect, it } from 'vitest';
import { laneAt, leftAt, type FanBranch, type FanNode, type WidthMode } from './layout';
import { latinOf, type Brackets } from './brackets';
import { CARNIVORA, FELIDAE, type CladeRec } from './panthera';
import { CARNIVORA_TREE, FELIDAE_TREE, type Split } from './splits';
import { FanView } from './view';

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

type Inner = { anim: ((t: number) => boolean) | null; applyFold(): void };

/** Run the flight under way to its landing, a frame each 16 ms as the app runs them (the fold at each frame's zoom). */
function run(v: FanView): void {
  const iv = v as unknown as Inner;
  for (let t = performance.now() + 16; iv.anim; t += 16) {
    if (!iv.anim(t)) iv.anim = null;
    iv.applyFold();
  }
}

/** Fly to b's species (search's pick) from the camera as it is, to the landing. */
function fly(v: FanView, b: FanBranch): void {
  v.flyToSpecies(b.sp);
  run(v);
}

/** The landing as computed: the frame the flight snaps to on landing, the camera settled there (as each frame settles it). */
function land(v: FanView, b: FanBranch): void {
  v.cam = v.speciesCamera(b);
  v.camera.settle();
  (v as unknown as Inner).applyFold();
}

/** Where b's column stands on screen at its tip: [left, centre, right] (px). */
function columnPx(v: FanView, b: FanBranch): [number, number, number] {
  const l = leftAt(b, b.tipY);
  const w = laneAt(b, b.tipY).w;
  return [v.toScreen(l, b.tipY)[0], v.toScreen(l + w / 2, b.tipY)[0], v.toScreen(l + w, b.tipY)[0]];
}

const v = stubView();
const atHome = () => {
  v.cam = v.homeCamera();
  v.camera.settle();
  (v as unknown as Inner).applyFold();
};

describe('a species flown to lands centred on screen (ToLaD#211)', () => {
  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`every species from home, ${mode} widths`, () => {
      v.setMode(mode);
      const off: string[] = [];
      let worst = 0;
      const N = Number(process.env.TAP_N ?? 1e9);
      const t0 = performance.now();
      for (const b of v.fan.branches.slice(0, N)) {
        atHome();
        land(v, b);
        const [l, c, r] = columnPx(v, b);
        worst = Math.max(worst, Math.abs(c - v.w / 2));
        if (Math.abs(c - v.w / 2) > 3 || l < 0 || r > v.w) off.push(`${b.sp.common}: ${l.toFixed(0)}..${r.toFixed(0)} (centre ${c.toFixed(1)})`);
      }
      console.log(`${mode}: ${Math.min(N, v.fan.branches.length)} species in ${(performance.now() - t0).toFixed(0)} ms, worst centre error ${worst.toFixed(2)} px, ${off.length} off`);
      expect(off).toEqual([]);
    });
  }

  for (const mode of ['log', 'linear'] as WidthMode[]) {
    it(`a sample flown frame by frame, from home and from zoomed in on the dogs (×15), ${mode} widths`, () => {
      v.setMode(mode);
      const off: string[] = [];
      const bs = v.fan.branches.filter((_, i) => i % 23 === 0);
      for (const start of ['home', 'dogs x15']) {
        for (const b of bs) {
          if (start === 'home') atHome();
          else {
            v.cam = v.levelCamera('Canidae', 15)!;
            v.camera.settle();
            (v as unknown as Inner).applyFold();
          }
          fly(v, b);
          const [l, c, r] = columnPx(v, b);
          if (Math.abs(c - v.w / 2) > 3 || l < 0 || r > v.w) off.push(`${start}: ${b.sp.common}: ${l.toFixed(0)}..${r.toFixed(0)} (centre ${c.toFixed(1)})`);
        }
      }
      expect(off).toEqual([]);
    });
  }
});

// ToLaD#230, #241: a tap on a species' name pill flies to its branch and opens its card. A double-tap then steps back
// one frame at a time: the clade it sits in, each clade above, home; at home it does nothing. Zoomed deep into a
// species (after a pinch), the first step is that species' frame. Brackets and family pills fly to their clade, and
// tapped again there one level out. Folded carnivores and the cats.
describe("a tap on a species' pill flies to it with its card; a double-tap steps back (ToLaD#230, #241)", () => {
  for (const [name, mk] of [
    ['carnivores (folded)', () => stubView()],
    ['cats', () => stubView(FELIDAE, FELIDAE_TREE, false)],
  ] as const) {
    it(name, () => {
      const v = mk();
      let card: string | null = null;
      v.onSelect = (s) => void (card = s ? s.sp.common : null);
      // (Drawn as settled: the labels' fades done, as they are a quarter second after a landing.)
      const settled = () => {
        (v as unknown as { labelState: Map<string, unknown> }).labelState.clear();
        for (let k = 0; k < 3; k++) v.draw();
      };
      const home = () => {
        v.cam = v.homeCamera();
        v.camera.settle();
        (v as unknown as Inner).applyFold();
        settled();
      };
      /** Tap b's pill where it was last drawn, fly to the landing, draw there (a few frames, as the app settles). */
      const tapPill = (b: FanBranch): boolean => {
        const h = v.nameHits.find((q) => q.b === b);
        if (!h) return false;
        v.tap((h.box[0] + h.box[2]) / 2, h.box[3] - 10);
        run(v);
        settled();
        return true;
      };
      const near = (c: { cx: number; cy: number; sx: number; sy: number }) =>
        Math.abs(v.cam.cx - c.cx) * v.cam.sx < 2 && Math.abs(v.cam.cy - c.cy) * v.cam.sy < 2 && Math.abs(Math.log(v.cam.sx / c.sx)) < 0.01;
      const log: string[] = [];
      const atHome = () => (v as unknown as { atHome(): boolean }).atHome();
      let steps = 0;
      let homes = 0;
      let pills = 0;
      const starts: [string, () => void][] = [['home', home]];
      for (const [lv, z] of name === 'cats' ? ([['Pantherinae', 1], ['Felinae', 6]] as const) : ([['Felidae', 1], ['Canidae', 15], ['Mustelidae', 4]] as const)) {
        starts.push([`${lv} x${z}`, () => {
          v.cam = v.levelCamera(lv, z)!;
          v.camera.settle();
          (v as unknown as Inner).applyFold();
          settled();
        }]);
      }
      home();
      const pill0 = v.nameHits[0];
      expect(v.tapWaits((pill0.box[0] + pill0.box[2]) / 2, pill0.box[3] - 10)).toBe(true);
      const col = v.fan.branches.map((b) => v.toScreen(leftAt(b, b.tipY + 0.5 * (b.splitY - b.tipY)) + laneAt(b, b.tipY).w / 2, b.tipY + 0.5 * (b.splitY - b.tipY)));
      const onCol = col.find(([x, y]) => x > 20 && x < v.w - 20 && y > 300 && y < v.h - 160 && v.hitBranch(x, y));
      expect(onCol && v.tapWaits(...onCol)).toBe(false);
      for (const [start, go] of starts) {
        go();
        // Every species whose pill shows there: tap it, then again and again while its pill shows.
        const bs = v.nameHits.map((q) => q.b);
        if (!bs.length) log.push(`${start}: no pills`);
        for (const b of bs) {
          go();
          pills++;
          expect(tapPill(b)).toBe(true);
          const [l, c, r] = columnPx(v, b);
          if (Math.abs(c - v.w / 2) > 3 || l < 0 || r > v.w) log.push(`${start}: ${b.sp.common}: column ${l.toFixed(0)}..${r.toFixed(0)}`);
          if (!near(v.speciesCamera(b))) log.push(`${start}: ${b.sp.common}: not at its species frame`);
          if (card !== b.sp.common) log.push(`${start}: ${b.sp.common}: card ${card}, not its own`);
          // A tap on its column there waits out the double-tap window (it would clash with a step back); its pill's too.
          // (Unless its frame is home's, within 4 px and 2 %, as the domestic dog's: there a double-tap does nothing.)
          const ym = b.tipY + 0.4 * (b.splitY - b.tipY);
          if (!v.tapWaits(...v.toScreen(leftAt(b, ym) + laneAt(b, ym).w / 2, ym)) && !atHome()) log.push(`${start}: ${b.sp.common}: a column tap at its frame does not wait`);
          // A lone tap on its column opens its card and flies nowhere.
          v.tap(...v.toScreen(leftAt(b, ym) + laneAt(b, ym).w / 2, ym));
          if (card !== b.sp.common || (v as unknown as Inner).anim) log.push(`${start}: ${b.sp.common}: a column tap: card ${card}${(v as unknown as Inner).anim ? ', and a flight' : ''}`);
          // Pinched in deep (×6 both ways about the centre), the card closed: a double-tap goes back to its frame.
          v.tap(-1e6, -1e6);
          // (A frame at a time, as a pinch: folded, the fold opens and its anchor follows the camera as it zooms.)
          for (let k = 0; k < 24; k++) {
            v.zoom(v.w / 2, v.h / 2, Math.pow(6, 1 / 24), Math.pow(6, 1 / 24));
            v.draw();
          }
          settled();
          const mid = (v as unknown as { centreLine(): FanBranch | null }).centreLine();
          const [pl, , pr] = columnPx(v, b);
          v.doubleTap(10, 400);
          run(v);
          settled();
          if (!near(v.speciesCamera(b)))
            log.push(`${start}: ${b.sp.common}: pinched in (its tip ${pl.toFixed(0)}..${pr.toFixed(0)}, centre ${mid?.sp.common}), a double-tap is not back at its frame${mid && near(v.speciesCamera(mid)) ? " (at the centre one's)" : ''}`);
          // A double-tap at a time: out along b's ladder (its species frame, then its ranked clades, home), one frame or
          // more out each time (frames within BACK_SLACK of the one it is at are passed), never back in, home at last.
          const ladder: [string, () => { cx: number; cy: number; sx: number; sy: number }][] = [[b.sp.common, () => v.speciesCamera(b)]];
          for (let q: FanNode | null = v.cladeOf(b); q && q.parent; q = v.outOf(q)) {
            const c = q;
            ladder.push([c.name, () => v.cladeCamera(c)]);
          }
          ladder.push(['home', () => v.homeCamera()]);
          let at = 0;
          for (let k = 0; at < ladder.length - 1 && k < 12; k++) {
            v.doubleTap(10, 400);
            if (card) log.push(`${start}: ${b.sp.common}: card open after a double-tap`);
            // (Nothing: home, or a frame within 4 px and 2 % of it, as the small cats' is.)
            if (!(v as unknown as Inner).anim) {
              if (atHome()) at = ladder.length - 1;
              else log.push(`${start}: ${b.sp.common}: double-tap ${k + 1} did nothing, from ${ladder[at][0]}`);
              break;
            }
            const to = (v as unknown as { backing: { to: string } | null }).backing?.to;
            run(v);
            settled();
            const i = ladder.findIndex(([n], j) => j > at && n === to);
            // (The frame computed with the fold put back after, as the view does: computing one moves the fold.)
            const keep = v.fan.tess.fold?.keep();
            const landed = i >= 0 && near(ladder[i][1]());
            keep?.();
            if (!landed) {
              log.push(`${start}: ${b.sp.common}: double-tap ${k + 1} went to ${to}${i < 0 ? ', off its ladder' : ' but landed off its frame'} (from ${ladder[at][0]})`);
              break;
            }
            at = i;
            steps++;
          }
          if (at === ladder.length - 1) {
            // Home: a double-tap does nothing.
            v.doubleTap(10, 400);
            if ((v as unknown as Inner).anim) log.push(`${start}: ${b.sp.common}: a double-tap at home flew`);
            homes++;
          }
        }
      }
      // A clade's bracket: tapped, its clade; tapped again there, the clade above.
      home();
      const brk = (v as unknown as { brackets: Brackets | null }).brackets;
      const clades = brk ? brk.list.filter((q) => q.rank === 'genus' || q.rank === 'subfamily') : [];
      let brs = 0;
      // Where on its row a bracket is tapped: off the pills drawn over its line (a tap there is the pill's).
      const bracketAt = (latin: string): [number, number] | null => {
        const br = brk!;
        const p = br.placed.find((u) => br.list[u.i].latin === latin);
        if (!p) return null;
        const y = br.rowY(p.row);
        const pills = [...v.nameHits, ...v.famHits].map((h) => h.box);
        for (let x = p.a + 1; x < p.b; x += 2) {
          if (pills.some((b) => x >= b[0] - 8 && x <= b[2] + 8 && y >= b[1] - 8 && y <= b[3] + 8)) continue;
          if (br.hit(x, y)?.latin === latin) return [x, y];
        }
        return null;
      };
      for (const q of clades) {
        home();
        let p = bracketAt(q.latin);
        if (!p) continue;
        v.tap(...p);
        run(v);
        settled();
        if (!near(v.cladeCamera(q.v))) log.push(`bracket ${q.latin}: not at its frame`);
        p = bracketAt(q.latin);
        if (!p) continue;
        v.tap(...p);
        run(v);
        settled();
        const up = v.outOf(q.v)!;
        if (!near(v.cladeCamera(up))) log.push(`bracket ${q.latin} again: not at ${up.name}'s frame`);
        brs++;
      }
      // A family's pill: tapped, its family; tapped again there (its pill, or its bracket if the pill has gone), the clade above.
      home();
      let fams = 0;
      for (const f of v.famHits.map((h) => h.v)) {
        home();
        // (On its name, the pill's bottom end: its top end may hold a "+x".)
        const h = v.famHits.find((u) => u.v === f)!;
        v.tap((h.box[0] + h.box[2]) / 2, h.box[3] - 10);
        run(v);
        settled();
        if (!near(v.cladeCamera(f))) log.push(`family pill ${f.name}: not at its frame`);
        const h2 = v.famHits.find((u) => u.v === f);
        const p = h2 ? ([(h2.box[0] + h2.box[2]) / 2, h2.box[3] - 10] as [number, number]) : bracketAt(latinOf(f.split));
        if (!p) continue;
        v.tap(...p);
        run(v);
        settled();
        const up = v.outOf(f)!;
        if (!near(v.cladeCamera(up))) log.push(`family ${f.name} again: not at ${up.name}'s frame`);
        fams++;
      }
      console.log(`${name}: ${pills} pills tapped, ${steps} steps back (${homes} chains home), ${brs} brackets and ${fams} family pills tapped twice`);
      if (name !== 'cats') expect(fams).toBeGreaterThan(0);
      expect(brs).toBeGreaterThan(0);
      expect(log).toEqual([]);
      expect(homes).toBe(pills);
      expect(steps).toBeGreaterThanOrEqual(pills);
    });
  }
});
