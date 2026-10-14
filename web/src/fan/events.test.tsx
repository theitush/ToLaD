// Curated bottlenecks (ToLaD#141): carried from the history files to the fan, marked on their columns
// (world-fixed, over the held fade), and a tap inside a window opens the card's section on it.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EVENT_TINT, eventAt, eventSpans } from './colstyle';
import { SpeciesCard, unshownSentence } from './FanApp';
import { HistorySpark } from './HistorySpark';
import { laneAt, layoutFan, leftAt } from './layout';
import { RectBatch, MeshBatch } from './meshgl';
import { FELIDAE } from './panthera';
import { colEventsY, colSpansY, FanView, type Selection } from './view';

const sp = (common: string) => FELIDAE.species.find((s) => s.common === common)!;

describe('events carried to the web', () => {
  it('the cougar and the cheetah carry their sourced bottlenecks, oldest first', () => {
    // 'Puma': the Red List's English name for Puma concolor (the data's names since ToLaD#145; the hand table said Cougar).
    for (const name of ['Puma', 'Cheetah']) {
      const evs = sp(name).history!.events;
      expect(evs.length, name).toBeGreaterThanOrEqual(1);
      for (const e of evs) {
        expect(e.kind).toBe('bottleneck');
        expect(e.fromYa).toBeGreaterThan(e.toYa);
        expect(e.quote.length).toBeGreaterThan(40);
        expect(e.cite).toMatch(/\(\d{4}\)/);
        expect(e.url).toMatch(/^https:\/\/doi\.org\//);
        expect(e.grade).toMatch(/^[ABCD]$/);
      }
      evs.slice(1).forEach((e, k) => expect(e.fromYa).toBeLessThanOrEqual(evs[k].fromYa));
    }
    const ch = sp('Cheetah').history!.events.find((e) => e.title === 'Late-Pleistocene crash')!;
    expect([ch.fromYa, ch.toYa, ch.region]).toEqual([12589, 11084, 'Africa']);
    expect(ch.quote).toContain('a second 11,084–12,589 years ago in Africa');
  });

  it('species without a history file have none', () => {
    const none = FELIDAE.species.filter((s) => !s.history);
    expect(none.length).toBeGreaterThan(0);
    for (const s of none) expect(eventSpans(s, s.t0)).toEqual([]);
  });
});

describe('marker spans', () => {
  const fan = layoutFan(FELIDAE, 'log');
  const cougar = fan.branches.find((b) => b.sp.common === 'Puma')!;

  it('each species-wide window is a span of its own column, clipped to it, world-fixed', () => {
    // The North American refounding (12-9 kya) is regional (ToLaD#149): not on the column.
    const spans = eventSpans(cougar.sp, cougar.t0);
    expect(spans.map((s) => [s.ago0, s.ago1])).toEqual([[25000, 20000]]);
    const ys = colEventsY(fan, cougar);
    expect(colEventsY(fan, cougar)).toBe(ys); // built once per layout
    for (const s of ys) {
      expect(s.top).toBeCloseTo(fan.time.y(s.ago1 / 1e6), 9);
      expect(s.bot).toBeGreaterThan(s.top);
      expect(s.bot).toBeLessThan(cougar.splitY);
    }
    // Clipped at the species' start: a window older than its column keeps only the column's part.
    const fake = { ...cougar.sp, history: { ...cougar.sp.history!, events: [{ ...cougar.sp.history!.events[0], fromYa: 1e9, toYa: 5e6 }] } };
    expect(eventSpans(fake, cougar.t0)).toEqual([expect.objectContaining({ ago0: cougar.t0 * 1e6, ago1: 5e6 })]);
    expect(eventSpans(fake, 1)).toEqual([]);
  });

  it('a touch finds the window it is in, a thin one within reach, the narrower of two overlapping, else none', () => {
    const ev = cougar.sp.history!.events[0];
    const S = [
      { ago0: 25000, ago1: 20000, k: 0, ev },
      { ago0: 22000, ago1: 21000, k: 1, ev },
      { ago0: 12000, ago1: 9000, k: 2, ev },
    ];
    expect(eventAt(S, 24000)?.k).toBe(0);
    expect(eventAt(S, 21500)?.k).toBe(1);
    expect(eventAt(S, 10000)?.k).toBe(2);
    expect(eventAt(S, 15000)).toBeNull();
    expect(eventAt(S, 12500, 11500, 13500)?.k).toBe(2);
    expect(eventAt(S, 12500, 12400, 12600)).toBeNull();
  });
});

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
  g.cancelAnimationFrame = () => {};
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
  return new FanView(canvas as unknown as HTMLCanvasElement, FELIDAE);
}

describe('the fan: marks and tap', () => {
  const v = stubView();
  const fan = v.fan;
  const b = fan.branches.find((x) => x.sp.common === 'Puma')!;
  // (Its centre line where the view has it: the river's, or a folded or steady layout's, ToLaD#259.)
  const cxAt = (yy: number) => leftAt(b, yy) + laneAt(b, yy).w / 2;
  // Zoomed onto the cougar's column about 16 kyr ago, both windows on screen.
  const home = v.homeCamera();
  const y = fan.time.y(0.016);
  const sx = home.sx * 2 ** 8;
  const sy = home.sy * 2 ** 4;
  v.cam = { cx: cxAt(y), cy: y, sx, sy, ty: sy };
  v.camera.settle();

  it('draws each window as a tint over the column, after (over) the held fade', () => {
    const gl = { under: new RectBatch(), mesh: new MeshBatch(), over: new RectBatch(), begin() {}, end() {} };
    gl.begin = () => {
      gl.under.n = gl.mesh.n = gl.over.n = 0;
    };
    (v as unknown as { gl: unknown }).gl = gl;
    v.draw();
    const tints: number[][] = [];
    for (let i = 0; i < gl.over.n; i++) {
      const r = Array.from(gl.over.f.subarray(i * 12, i * 12 + 12));
      if (Math.abs(r[4] - EVENT_TINT.rgb[0]) < 1e-6 && Math.abs(r[5] - EVENT_TINT.rgb[1]) < 1e-6) tints.push(r);
    }
    // The cougar's tints: those on its column (since ToLaD#172 narrowed its deep past, the cheetah's
    // column and its own windows reach the screen's left edge too).
    const x0 = v.toScreen(cxAt(y) - b.width / 2, y)[0];
    const x1 = v.toScreen(cxAt(y) + b.width / 2, y)[0];
    const mine = tints.filter((r) => r[0] >= x0 - 1 && r[2] <= x1 + 1);
    expect(mine.length).toBeGreaterThan(2);
    // Within the windows on screen.
    const ws = colEventsY(fan, b);
    const sTop = Math.min(...ws.map((w) => v.toScreen(0, w.top)[1]));
    const sBot = Math.max(...ws.map((w) => v.toScreen(0, w.bot)[1]));
    for (const r of mine) {
      expect(r[1]).toBeGreaterThanOrEqual(sTop - 1);
      expect(r[3]).toBeLessThanOrEqual(sBot + 1);
    }
    // Drawn after any held fade on the column (so a held stretch never hides an event).
    expect(colSpansY(fan, b)).toBeDefined();
    (v as unknown as { gl: unknown }).gl = undefined;
  });

  it('a tap inside a species-wide window opens its event; inside a regional one or outside, the card is as before', () => {
    let sel: Selection | null = null;
    v.onSelect = (s) => (sel = s);
    for (const [ago, title] of [
      [22000, 'Last-glacial low'],
      [10500, undefined], // the North American refounding: regional (ToLaD#149)
      [15500, undefined],
    ] as const) {
      const wy = fan.time.y(ago / 1e6);
      // (On the column, a quarter of its width right of its centre line: beside its name, written along that line, a
      // pill whose tap flies. Since ToLaD#288's taller home the regional window at 10,500 years lies under the name.)
      const [px, py] = v.toScreen(cxAt(wy) + laneAt(b, wy).w / 4, wy);
      v.tap(px, py);
      expect(sel!.sp.common).toBe('Puma');
      expect(sel!.event?.ev.title).toBe(title);
    }
  });
});

describe('a picture', () => {
  it("taps on a species' picture go a level deeper each, to its branch, then open its card (ToLaD#230, #258); off it, the column's tap", () => {
    const v = stubView();
    const fan = v.fan;
    const b = fan.branches.find((q) => q.sp.common === 'Cheetah')!;
    let sel: Selection | null = null;
    let opened = 0;
    v.onSelect = (s) => ((sel = s), s && opened++);
    const iv = v as unknown as { anim: ((t: number) => boolean) | null };
    // (One level deeper a tap, ToLaD#258: the cat-like carnivores, the cats, …, the cheetah; there, its card.)
    for (let k = 0; k < 10 && !opened; k++) {
      v.thumbHits = [[200, 300, 25, b]];
      v.tap(215, 318);
      expect(iv.anim).not.toBeNull();
      for (let t = performance.now() + 16; iv.anim; t += 16) if (!iv.anim(t)) iv.anim = null;
    }
    const c = v.speciesCamera(b);
    expect(Math.abs(v.cam.cx - c.cx) * v.cam.sx).toBeLessThan(1);
    expect(Math.abs(v.cam.cy - c.cy) * v.cam.sy).toBeLessThan(1);
    expect(opened).toBe(1);
    expect((sel as Selection | null)?.sp.common).toBe('Cheetah');
    sel = null;
    v.thumbHits = [[200, 300, 25, b]];
    v.tap(240, 300);
    expect((sel as Selection | null)?.sp.common).not.toBe('Cheetah');
  });
});

describe('the card', () => {
  it('a touch in the window shows the section: title, summary, the quote styled as a quote, source linked, grade', () => {
    const c = sp('Cheetah');
    const html = renderToStaticMarkup(<SpeciesCard sp={c} onClose={() => {}} ageMa={0.0118} event={0} />);
    const e = c.history!.events[0];
    expect(html).toContain('data-event="0"');
    expect(html).toContain('Bottleneck · 12,589–11,084 years ago · Africa');
    expect(html).toContain(`<p class="ev-t">${e.title}</p>`);
    expect(html).toMatch(/<blockquote class="ev-q">“Demographic estimators impute/);
    expect(html).toContain(`href="${e.url}"`);
    expect(html).toContain(`grade ${e.grade}`);
    // Without an event the card has no such section.
    expect(renderToStaticMarkup(<SpeciesCard sp={c} onClose={() => {}} ageMa={0.0118} />)).not.toContain('class="event"');
  });

  it('the sparkline shows each window as a labelled band', () => {
    const h = sp('Puma').history!;
    const all = renderToStaticMarkup(<HistorySpark h={h} />);
    expect(all.match(/data-event="/g)?.length).toBe(h.events.length);
    for (const e of h.events) expect(all).toContain(e.title);
    // On one event: its band named, the others' bands kept (fainter) without a name.
    const one = renderToStaticMarkup(<HistorySpark h={h} activeEvent={1} />);
    expect(one.match(/data-event="/g)?.length).toBe(h.events.length);
    expect(one).toContain(h.events[1].title);
    expect(one).not.toContain(h.events[0].title);
  });
});

// ToLaD#149: a mark on a column has to look like what it says. Regional events (a subpopulation) are
// not on the column; a species-wide one the curve doesn't show keeps its tint and says why on the card.
describe('honest marks (ToLaD#149)', () => {
  const lion = sp('Lion');
  const evs = lion.history!.events;
  const kOf = (title: string) => evs.findIndex((e) => e.title === title);

  it('carries scope, shown and why from the data', () => {
    expect(evs.find((e) => e.title === 'Post-glacial decline')).toMatchObject({ scope: 'species', shown: true, why: '' });
    expect(evs.find((e) => e.title === 'Gir founder event')).toMatchObject({ scope: 'regional', region: 'India (Gir)' });
    expect(evs.find((e) => e.title === 'Asiatic lion near-extinction')).toMatchObject({ scope: 'regional', region: 'India (Kathiawar)' });
    const ch = sp('Cheetah').history!.events[0];
    expect(ch).toMatchObject({ scope: 'species', shown: false });
    expect(ch.why).not.toBe('');
  });

  it('regional: no tint or label on the column; a section titled with its region on the card; an outlined band on the sparkline', () => {
    const fan = layoutFan(FELIDAE, 'log');
    const b = fan.branches.find((x) => x.sp.common === 'Lion')!;
    const titles = eventSpans(lion, b.t0).map((s) => s.ev.title);
    expect(titles).toEqual(['Post-glacial decline']);
    expect(colEventsY(fan, b).every((s) => s.ev.scope === 'species')).toBe(true);
    // On the card, touched in 1850 (inside the Asiatic window): listed, titled with the region, that one open.
    const html = renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} ageMa={176e-6} />);
    const gir = kOf('Gir founder event');
    const asia = kOf('Asiatic lion near-extinction');
    expect(html).toContain('Bottleneck in India (Gir) · 4,000–1,000 years ago');
    expect(html).toContain('Bottleneck in India (Kathiawar)');
    expect(html).toMatch(new RegExp(`<details class="event regional" data-event="${asia}" data-regional="" open`));
    expect(html).toMatch(new RegExp(`<details class="event regional" data-event="${gir}" data-regional="">`));
    expect(html).toContain(evs[asia].quote.slice(0, 30));
    // Not the touched section at the top: a regional index passed as the event is ignored there.
    expect(renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} ageMa={176e-6} event={asia} />)).not.toContain('<section class="event"');
    // The sparkline: every event banded, the regional ones outlined.
    const spark = renderToStaticMarkup(<HistorySpark h={lion.history!} />);
    expect(spark.match(/data-event="/g)?.length).toBe(evs.length);
    expect(spark.match(/data-regional=""/g)?.length).toBe(2);
  });

  it('species-wide and shown: tinted, its section has no caveat', () => {
    const k = kOf('Post-glacial decline');
    const html = renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} ageMa={0.015} event={k} />);
    expect(html).toContain(`<section class="event" data-event="${k}"`);
    expect(html).not.toContain('ev-unshown');
  });

  it('species-wide, not shown: still tinted; its section says plainly that our curve does not show it, and why', () => {
    const c = sp('Cheetah');
    const fan = layoutFan(FELIDAE, 'log');
    const b = fan.branches.find((x) => x.sp.common === 'Cheetah')!;
    expect(eventSpans(c, b.t0).map((s) => s.ev.title)).toEqual(['Late-Pleistocene crash']);
    const html = renderToStaticMarkup(<SpeciesCard sp={c} onClose={() => {}} ageMa={0.0118} event={0} />);
    expect(html).toContain(`data-unshown="${c.history!.events[0].why}"`);
    expect(html).toContain('Our population curve doesn’t show this bottleneck: ');
    // Each reason in words.
    expect(unshownSentence('blind spot')).toMatch(/can’t see the last ~20,000 years/);
    expect(unshownSentence('before the data')).toMatch(/no figures from before it/);
    expect(unshownSentence('data too shallow')).toMatch(/too little/);
    expect(unshownSentence('joined across')).toMatch(/straight between them/);
  });
});
