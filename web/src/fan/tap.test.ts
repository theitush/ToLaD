// A species flown to lands on screen (ToLaD#211): in the folded carnivores the fold opens and its anchor moves as the
// camera zooms, so a frame computed before the flight once landed with the species beside the screen. Every one of the
// 292 species, flown to from home at both widths (and a sample from zoomed in on the dogs), lands with its column's
// centre at the screen's centre and the column on screen.
import { describe, expect, it } from 'vitest';
import { laneAt, leftAt, segAt, type FanBranch, type FanNode, type WidthMode } from './layout';
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

/** A double-tap on nothing (empty space): a step back (ToLaD#245; on a branch, it would fly into that branch). */
const NOWHERE: [number, number] = [-1e4, -1e4];

// ToLaD#230, #241: a tap on a species' name pill flies to its branch and opens its card. A double-tap (on nothing) then steps back
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
      // (At home a column tap waits too: a double-tap there flies into it, ToLaD#245.)
      expect(onCol && v.tapWaits(...onCol)).toBe(true);
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
          v.doubleTap(...NOWHERE);
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
            v.doubleTap(...NOWHERE);
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
            v.doubleTap(...NOWHERE);
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
      // (Every pill's chain home, folded: ~40 s alone, near the 120 s default with the whole suite running beside it.)
    }, 300_000);
  }
});

// ToLaD#245: a double-tap on a branch goes into it: a species' column (above its split) → its species frame, no card;
// an ancestral stretch (below its split) → that lineage's clade frame. On the branch the view is in (the selected
// species, or the one framed), or on empty space: one step back, as #241. At home on empty space: nothing.
describe('a double-tap on a branch goes into it; on the one the view is in, or on nothing, one step back (ToLaD#245)', () => {
  for (const [name, mk, startAt] of [
    ['carnivores (folded)', () => stubView(), ['Canidae', 15]],
    ['cats', () => stubView(FELIDAE, FELIDAE_TREE, false), ['Pantherinae', 1]],
  ] as const) {
    it(name, () => {
      const v = mk();
      type Priv = {
        anim: unknown;
        applyFold(): void;
        backing: { to: string } | null;
        backStep(): { to: string } | null;
        tapKind(x: number, y: number): string | null;
        intoAt(x: number, y: number): unknown;
        pillAt(x: number, y: number): unknown;
        picAt(x: number, y: number): unknown;
        brackets: Brackets | null;
        centreLine(): FanBranch | null;
        labelState: Map<string, unknown>;
      };
      const iv = v as unknown as Priv;
      let card: string | null = null;
      v.onSelect = (s) => void (card = s ? s.sp.common : null);
      const settled = () => {
        iv.labelState.clear();
        for (let k = 0; k < 3; k++) v.draw();
      };
      const goTo = (c: ReturnType<FanView['homeCamera']>) => {
        v.cam = c;
        v.camera.settle();
        iv.applyFold();
        settled();
      };
      const near = (c: { cx: number; cy: number; sx: number; sy: number }) =>
        Math.abs(v.cam.cx - c.cx) * v.cam.sx < 2 && Math.abs(v.cam.cy - c.cy) * v.cam.sy < 2 && Math.abs(Math.log(v.cam.sx / c.sx)) < 0.01;
      const onScreen = ([x, y]: [number, number]) => x > 12 && x < v.w - 12 && y > 120 && y < v.h - 160;
      const bare = (p: [number, number]) => !iv.pillAt(...p) && !iv.picAt(...p) && !iv.brackets?.hit(...p) && !iv.brackets?.pinHit(...p);
      /** A point on b's own column (above its split) at fraction f of the way down from its tip, if on screen and bare. */
      const colPt = (b: FanBranch, f: number): [number, number] | null => {
        const y = b.tipY + f * (b.splitY - b.tipY);
        const p = v.toScreen(leftAt(b, y) + laneAt(b, y).w / 2, y) as [number, number];
        return onScreen(p) && bare(p) && v.hitBranch(...p) === b ? p : null;
      };
      /** On-screen species columns, farthest from the screen's centre first: [b, point]. */
      const columns = () =>
        v.fan.branches
          .map((b) => [b, colPt(b, 0.5) ?? colPt(b, 0.3) ?? colPt(b, 0.7)] as const)
          .filter((q): q is readonly [FanBranch, [number, number]] => !!q[1])
          .sort((a, b) => Math.abs(b[1][0] - v.w / 2) - Math.abs(a[1][0] - v.w / 2));
      /** An on-screen point on nothing (no column, pill, picture or bracket), if any. */
      const emptyPt = (): [number, number] | null => {
        for (let y = 130; y < v.h - 160; y += 9) for (let x = 14; x < v.w - 14; x += 7) if (!iv.tapKind(x, y) && !iv.intoAt(x, y)) return [x, y];
        return null;
      };
      const log: string[] = [];
      const home = () => goTo(v.homeCamera());

      // Home: a double-tap on a far species' column flies into its frame, no card (its first tap held: it waits).
      home();
      const [far, pFar] = columns()[0];
      expect(v.tapWaits(...pFar)).toBe(true);
      v.doubleTap(...pFar);
      expect(iv.anim).toBeTruthy();
      run(v);
      settled();
      if (!near(v.speciesCamera(far))) log.push(`home: double-tap on ${far.sp.common}'s column: not at its frame`);
      if (card) log.push(`home: double-tap on ${far.sp.common}'s column: a card (${card})`);
      // There, a double-tap on its own column (the branch the view is in): one step back, as #241, not into it again.
      const own = colPt(far, 0.5) ?? colPt(far, 0.3);
      if (!own) log.push(`${far.sp.common}'s frame: its column not on screen`);
      else {
        const want = iv.backStep()?.to;
        v.doubleTap(...own);
        if (!want || iv.backing?.to !== want || !iv.anim) log.push(`${far.sp.common}'s frame: double-tap on its column went to ${iv.backing?.to} (back is ${want})`);
        run(v);
        settled();
        if (near(v.speciesCamera(far))) log.push(`${far.sp.common}'s frame: double-tap on its column stayed`);
      }

      // Home: a double-tap on an ancestral stretch (a column below its split) flies to that lineage's clade frame.
      home();
      let anc = 0;
      for (const b of v.fan.branches) {
        const yb = v.fan.trunkBottom.y;
        if (b.splitY >= yb) continue;
        const wy = b.splitY + 0.25 * (yb - b.splitY);
        /** The lineage under b's strand at wy, if bare and on screen there (below the split of the strand hit). */
        const under = () => {
          const p = v.toScreen(leftAt(b, wy) + laneAt(b, wy).w / 2, wy) as [number, number];
          const hb = onScreen(p) && bare(p) ? v.hitBranch(...p) : null;
          const y = Math.min(yb, v.toWorld(...p)[1]);
          const q = hb && y >= hb.splitY ? segAt(hb, y).node : null;
          return q && q.parent && q.strands.length >= 2 ? { p, hb: hb!, q } : null;
        };
        if (!under()) continue;
        // (Home again, as the tap will be: the fold at home after a flight there is not the same to the pixel.)
        home();
        const u = under();
        if (!u) continue;
        v.doubleTap(...u.p);
        run(v);
        settled();
        if (!near(v.cladeCamera(u.q))) log.push(`home: double-tap on ${u.q.name}'s stretch (${u.hb.sp.common}): not at its frame`);
        // Its strands' tips on screen.
        const tips = u.q.strands.flatMap((s) => columnPx(v, s));
        if (Math.min(...tips) < -2 || Math.max(...tips) > v.w + 2) log.push(`home: double-tap on ${u.q.name}'s stretch: tips ${Math.min(...tips).toFixed(0)}..${Math.max(...tips).toFixed(0)}`);
        home();
        if (++anc >= 6) break;
      }

      // Zoomed in: a double-tap on another species' column flies into it; on the selected species' column (its card
      // open), one step back; on nothing, one step back.
      const start = () => goTo(v.levelCamera(startAt[0], startAt[1])!);
      start();
      const mid = iv.centreLine();
      const cols = columns().filter(([b]) => b !== mid);
      let into = 0;
      let sel = 0;
      for (const [b, p] of cols.slice(0, 4)) {
        start();
        v.tap(...NOWHERE);
        v.doubleTap(...p);
        run(v);
        settled();
        if (!near(v.speciesCamera(b))) log.push(`${startAt[0]}: double-tap on ${b.sp.common}'s column: not at its frame`);
        else into++;
        start();
        v.tap(...p);
        if (card !== b.sp.common) log.push(`${startAt[0]}: a tap on ${b.sp.common}'s column: card ${card}`);
        const want = iv.backStep()?.to;
        v.doubleTap(...p);
        if (!want || iv.backing?.to !== want) log.push(`${startAt[0]}: double-tap on selected ${b.sp.common}: to ${iv.backing?.to}, back is ${want}`);
        else sel++;
        if (card) log.push(`${startAt[0]}: double-tap on selected ${b.sp.common}: card still open`);
        run(v);
      }
      start();
      const e = emptyPt();
      if (e) {
        const want = iv.backStep()?.to;
        v.doubleTap(...e);
        if (!want || iv.backing?.to !== want) log.push(`${startAt[0]}: double-tap on nothing at ${e}: to ${iv.backing?.to}, back is ${want}`);
        run(v);
      }
      // Home, on nothing: nothing (and a tap there does not wait).
      home();
      const eh = emptyPt();
      if (eh) {
        expect(v.tapWaits(...eh)).toBe(false);
        v.doubleTap(...eh);
        if (iv.anim) log.push(`home: double-tap on nothing at ${eh} flew`);
      }
      v.doubleTap(...NOWHERE);
      if (iv.anim) log.push('home: double-tap on nothing flew');
      console.log(`${name}: into ${far.sp.common}; ${anc} ancestral stretches; ${into} columns into, ${sel} selected back; empty ${e ?? 'none'} zoomed, ${eh ?? 'none'} home`);
      expect(log).toEqual([]);
      expect(anc).toBeGreaterThan(0);
      expect(into).toBeGreaterThan(0);
      expect(sel).toBeGreaterThan(0);
    });
  }
});
