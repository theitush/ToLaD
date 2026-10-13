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

    it(`a double-tap on a column frames it centred, and the next keeps the finger on it, ${mode} widths`, () => {
      v.setMode(mode);
      const off: string[] = [];
      for (const b0 of v.fan.branches.filter((_, i) => i % 29 === 4)) {
        atHome();
        const wy = b0.tipY + 0.3 * (b0.splitY - b0.tipY);
        const [x, y] = v.toScreen(leftAt(b0, wy) + laneAt(b0, wy).w / 2, wy);
        const b = v.hitBranch(x, y)!;
        v.doubleTap(x, y);
        run(v);
        const span = () => [leftAt(b, wy), leftAt(b, wy) + laneAt(b, wy).w].map((u) => v.toScreen(u, wy)[0]);
        const [l, r] = span();
        if (Math.abs((l + r) / 2 - v.w / 2) > 3 || l < 0 || r > v.w) off.push(`framed ${b.sp.common}: ${l.toFixed(0)}..${r.toFixed(0)}`);
        // Again, off-centre on it: 16× wider, the column still under the finger.
        const fx = l + 0.3 * (r - l);
        v.doubleTap(fx, y);
        run(v);
        const [l2, r2] = span();
        if (!(l2 <= fx && fx <= r2)) off.push(`×16 ${b.sp.common}: ${l2.toFixed(0)}..${r2.toFixed(0)}, finger at ${fx.toFixed(0)}`);
      }
      expect(off).toEqual([]);
    });
  }
});

// ToLaD#230: a tap on a species' name pill flies to its branch (no card); tapped again once there, one level out (the
// clade it sits in), and again to the clade above that; a pan in between starts over. Folded carnivores and the cats.
describe("a tap on a species' pill flies to its branch, again one level out (ToLaD#230)", () => {
  type Tapped = { tapAt: { b: FanBranch | null; v: { name: string } | null } | null };
  for (const [name, mk] of [
    ['carnivores (folded)', () => stubView()],
    ['cats', () => stubView(FELIDAE, FELIDAE_TREE, false)],
  ] as const) {
    it(name, () => {
      const v = mk();
      let opened = 0;
      v.onSelect = (s) => void (s && opened++);
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
      let climbed = 0;
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
          // Again: the clade it sits in; again: the one above.
          let want: FanNode | null = v.cladeOf(b);
          for (let level = 0; level < 2 && want; level++) {
            if (!tapPill(b)) break;
            const at = (v as unknown as Tapped).tapAt;
            if (at?.v !== want || !near(v.cladeCamera(want))) log.push(`${start}: ${b.sp.common}: tap ${level + 2} at ${at?.v?.name}, not ${want.name}`);
            else climbed++;
            want = v.outOf(want);
          }
          // A pan, and the pill tapped again flies back to the species.
          v.pan(40, 0);
          settled();
          if (tapPill(b) && !near(v.speciesCamera(b))) log.push(`${start}: ${b.sp.common}: after a pan, not back at its species frame`);
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
      console.log(`${name}: ${pills} pills tapped, ${climbed} climbs, ${brs} brackets and ${fams} family pills tapped twice`);
      if (name !== 'cats') expect(fams).toBeGreaterThan(0);
      expect(brs).toBeGreaterThan(0);
      expect(log).toEqual([]);
      expect(climbed).toBeGreaterThan(0);
      expect(opened).toBe(0);
    });
  }
});
