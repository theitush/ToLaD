import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FanCamera } from './camera';
import { SpeciesCard } from './FanApp';
import { popTicks, yearTicks } from './HistorySpark';
import { dotAlphas, EDGE_DASH, edgeMarks, historySpans, styleBetween, toScreenSpans, type ScreenSpan, type SpanStyle } from './history';
import { layoutFan, leftAt, strandAt } from './layout';
import { PANTHERA } from './panthera';
import { population } from './population';
import { formatCount } from '../data/names';
import { TwigModel } from './twigs';

const byName = (common: string) => PANTHERA.species.find((s) => s.common === common)!;

describe('edge marks', () => {
  // A slanted edge from y = 0 to 800 (screen), three spans.
  const ys = Array.from({ length: 81 }, (_, k) => k * 10);
  const xs = ys.map((y) => 100 + y * 0.25);
  const spans: ScreenSpan[] = [
    { y0: 0, y1: 200, style: 'solid' },
    { y0: 500, y1: 200, style: 'dashed' },
    { y0: 500, y1: 800, style: 'dotted' },
  ];
  const styleAt = (y: number): SpanStyle => spans.find((s) => y >= Math.min(s.y0, s.y1) && y <= Math.max(s.y0, s.y1))!.style;

  it('every mark lies on the edge, inside a span of its own style; solid spans get none', () => {
    const marks = edgeMarks(xs, ys, spans, 3.3, -10, 900);
    expect(marks.length).toBeGreaterThan(50);
    for (const m of marks) {
      expect(styleAt((m.y0 + m.y1) / 2)).toBe(m.style);
      expect(m.x0).toBeCloseTo(100 + m.y0 * 0.25, 9);
      expect(m.x1).toBeCloseTo(100 + m.y1 * 0.25, 9);
      expect(m.y1 - m.y0).toBeLessThanOrEqual(EDGE_DASH[m.style].on + 1e-9);
    }
    // The pattern's duty cycle fills its span.
    for (const st of ['dashed', 'dotted'] as const) {
      const on = marks.filter((m) => m.style === st).reduce((a, m) => a + m.y1 - m.y0, 0);
      expect(on / 300).toBeCloseTo(EDGE_DASH[st].on / EDGE_DASH[st].period, 1);
    }
  });

  it('the pattern is fixed to its anchor: panning moves the dashes with the branch', () => {
    const a = edgeMarks(xs, ys, spans, 0, 0, 800).map((m) => m.y0);
    const shifted = edgeMarks(
      xs,
      ys.map((y) => y + 13),
      spans.map((s) => ({ ...s, y0: s.y0 + 13, y1: s.y1 + 13 })),
      13,
      0,
      900,
    ).map((m) => m.y0 - 13);
    for (const y of a.filter((y) => y > 1 && y < 790)) expect(shifted.some((z) => Math.abs(z - y) < 1e-9)).toBe(true);
  });

  it('a dot crowding the one above it waits, and fades in as they spread', () => {
    expect(dotAlphas([0, 4, 100])).toEqual([1, 0, 1]);
    const a = dotAlphas([100, 15, 0]);
    expect(a[0]).toBe(1);
    expect(a[2]).toBe(1);
    expect(a[1]).toBeGreaterThan(0);
    expect(a[1]).toBeLessThan(1);
    expect(dotAlphas([0, 40, 100])).toEqual([1, 1, 1]);
  });

  for (const common of ['Lion', 'Tiger']) {
    it(`${common}: span styles land on the drawn edge at the heights of their years (last 300 years, 390 px)`, () => {
      const f = layoutFan(PANTHERA, 'linear');
      const b = f.branches.find((x) => x.sp.common === common)!;
      const h = b.sp.history!;
      const c = new FanCamera(f, (x) => new TwigModel(x, f.time, 'linear'));
      c.w = 390;
      c.h = 844;
      const yOld = f.time.y(300e-6);
      const yNow = f.time.y(0);
      const sy = (0.9 * c.h) / (yOld - yNow);
      c.cam = { cx: leftAt(b, yOld), cy: (yOld + yNow) / 2, sx: 200 / strandAt(b, 300e-6, 'linear').w, sy, ty: sy };
      c.settle();
      // The branch's outer (gray, right) edge on screen, as view.ts draws it.
      const xs: number[] = [];
      const ys: number[] = [];
      for (let k = 0; k <= 400; k++) {
        const y = yNow + ((yOld - yNow) * k) / 400;
        const [px, py] = c.toScreen(leftAt(b, y) + strandAt(b, f.time.ageAt(y), 'linear').w, y);
        xs.push(px);
        ys.push(py);
      }
      const spans = historySpans(h);
      const toY = (ago: number) => c.toScreen(0, f.time.y(ago / 1e6))[1];
      const marks = edgeMarks(xs, ys, toScreenSpans(spans, toY), toY(0), 0, c.h);
      expect(marks.length).toBeGreaterThan(20);
      const seen = new Set<string>();
      for (const m of marks) {
        // Back from screen to years before present, to the history's own span there.
        const ago = f.time.ageAt(c.toWorld(0, (m.y0 + m.y1) / 2)[1]) * 1e6;
        const s = spans.find((x) => ago <= x.ago0 + 0.05 && ago >= x.ago1 - 0.05)!;
        expect(s.style).toBe(m.style);
        seen.add(m.style);
      }
      // Lion: grade D unverified before 2002 (dotted), interpolated C after (dashed).
      // Tiger: dotted before 2010, dashed 2010–2018, solid (held B) after: no marks there.
      expect(seen).toEqual(new Set(['dotted', 'dashed']));
      if (common === 'Tiger') {
        const held = spans.find((x) => x.style === 'solid')!;
        for (const m of marks) expect(Math.max(m.y0, m.y1) <= toY(held.ago0) + 1e-6 && Math.min(m.y0, m.y1) >= toY(held.ago1) - 1e-6).toBe(false);
      }
    });
  }
});

describe('species card history', () => {
  it('lists every point with its year, numbers, grade, kind, citation link and note', () => {
    for (const common of ['Lion', 'Tiger', 'Snow leopard', 'Leopard']) {
      const sp = byName(common);
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} open />);
      const h = sp.history!;
      expect(html).toContain('<svg');
      expect((html.match(/<li>/g) ?? []).length).toBe(h.points.length);
      const esc = (t: string) => renderToStaticMarkup(<>{t}</>);
      for (const p of h.points) {
        expect(html).toContain(esc(p.cite));
        if (p.url) expect(html).toContain(`href="${p.url}"`);
        if (p.note) expect(html).toContain(esc(p.note));
        expect(html).toContain(`grade ${p.grade}`);
        expect(html).toContain(p.kind);
      }
      // Sparkline markers: one per point, coloured by grade; the spans between them styled like the edge.
      expect((html.match(/<circle /g) ?? []).length).toBe(h.points.length);
      const pts = h.points.slice().sort((a, b) => a.year - b.year);
      for (let k = 1; k < pts.length; k++) expect(html).toContain(`data-style="${styleBetween(h, pts[k - 1].year, pts[k].year)}"`);
    }
  });

  it('collapsed, the card shows the sparkline but not the list; species without history show neither', () => {
    const lion = renderToStaticMarkup(<SpeciesCard sp={byName('Lion')} onClose={() => {}} />);
    expect(lion).toContain('<svg');
    expect(lion).not.toContain('<li>');
    const plain = PANTHERA.species.find((s) => !s.history)!;
    const html = renderToStaticMarkup(<SpeciesCard sp={plain} onClose={() => {}} />);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('class="hist');
  });

  it('the sparkline has 3–5 round year ticks and one or two population ticks', () => {
    for (const sp of PANTHERA.species.filter((s) => s.history && s.history.points.length > 1)) {
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />);
      const xs = html.match(/data-tick="x"/g) ?? [];
      const held = html.includes('>now</text>');
      expect(xs.length + (held ? 1 : 0)).toBeGreaterThanOrEqual(3);
      expect(xs.length).toBeLessThanOrEqual(5);
      const ys = html.match(/data-tick="y"/g) ?? [];
      expect(ys.length).toBeGreaterThanOrEqual(1);
      expect(ys.length).toBeLessThanOrEqual(2);
    }
    expect(yearTicks(1750, 2024)).toEqual([1800, 1900, 2000]);
    expect(popTicks(Math.log10(3000), Math.log10(2e6))).toEqual([1e4, 1e6]);
  });
});

describe('the species card: the population at the time touched', () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");
  it('shows those alive then and the shares, and "ever" only as an honest secondary line', () => {
    const lion = byName('Lion');
    const then = text(renderToStaticMarkup(<SpeciesCard sp={lion} ageMa={70e-6} onClose={() => {}} />));
    expect(then).toContain('alive 70 years ago');
    expect(then).toMatch(/\d+% have living descendants today/);
    expect(then).toContain(`${formatCount(lion.alive)} alive now`);
    expect(then).toContain(`~${formatCount(lion.ever)} born in total over ~3.8 Myr (model, grade ${lion.grade}`);
    // Never "ever" as a bare headline number.
    expect(then).not.toContain('ever lived');
    const now = text(renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} />));
    expect(now).toContain(`${formatCount(population(lion).aliveAt(0))} alive now`);
    expect(now).toContain('100% have living descendants today');
    const cave = text(renderToStaticMarkup(<SpeciesCard sp={byName('Cave lion')} ageMa={0.05} onClose={() => {}} />));
    expect(cave).toContain('alive 50.0 thousand years ago');
    expect(cave).toContain('0% have living descendants today');
  });
});
