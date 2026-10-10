import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { plainAgo, plainCount, roughCount, SpeciesCard } from './FanApp';
import { popTicks, yearTicks } from './HistorySpark';
import { GRADE_WORD, noDataSpans, styleBetween } from './history';
import { PANTHERA } from './panthera';
import { population } from './population';
import { RED_LIST } from './status';
import { formatCount } from '../data/names';

const byName = (common: string) => PANTHERA.species.find((s) => s.common === common)!;

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

  it('the leopard and the jaguar have dated, cited history that drives their counts (ToLaD#51)', () => {
    for (const common of ['Leopard', 'Jaguar']) {
      const h = byName(common).history;
      expect(h, common).toBeTruthy();
      expect(h!.use).toBe('counts');
      const pts = h!.points.slice().sort((a, b) => a.year - b.year);
      expect(pts.length).toBeGreaterThanOrEqual(2);
      for (const p of pts) {
        expect(p.cite.length).toBeGreaterThan(20);
        expect(p.url).toMatch(/^https:\/\/doi\.org\//);
      }
      // the Red List's decline: the earlier level is higher than the latest figure
      expect(pts[0].n).toBeGreaterThan(pts[pts.length - 1].n);
      expect(pts[pts.length - 1].year).toBeGreaterThanOrEqual(2015);
    }
  });

  it('no living species shows a flat assumed stretch without a "no data" mark', () => {
    const living = PANTHERA.species.filter((s) => !s.extinct);
    expect(living.length).toBe(5);
    for (const sp of living) {
      const h = sp.history;
      expect(h, `${sp.common} has a history`).toBeTruthy();
      const nd = noDataSpans(h!);
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} open />);
      // Every species' curve is held back to its start before the first figure: marked and labelled.
      const before = nd.find((s) => s.side === 'before');
      expect(before, sp.common).toBeTruthy();
      expect(html).toContain('data-nodata="before"');
      expect(html).toContain('>no data</text>');
      expect(html).toContain(`No data before ${before!.year}: held at `);
      // A held stretch after the last figure is drawn faint too, never as a plain line.
      expect(html.includes('data-nodata="after"')).toBe(nd.some((s) => s.side === 'after'));
    }
    // The snow leopard has no level before its first figure: held at today's count.
    const snow = noDataSpans(byName('Snow leopard').history!).find((s) => s.side === 'before')!;
    expect(snow.today).toBe(true);
    expect(snow.level).toBeCloseTo(byName('Snow leopard').alive, -2);
    // The leopard is held at its pre-decline (1998) level.
    const leo = noDataSpans(byName('Leopard').history!).find((s) => s.side === 'before')!;
    expect(leo.today).toBe(false);
    expect(leo.year).toBe(1998);
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
  const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
  /** The card's face: everything outside the collapsed details and the sources list. */
  const face = (html: string) => text(html.replace(/<details[\s\S]*<\/details>/, '').replace(/<ol class="hist-list"[\s\S]*<\/ol>/, ''));
  const details = (html: string) => text(html.match(/<details[\s\S]*<\/details>/)![0]);

  it('says, in plain words, how many were alive then, how many have descendants today, how many now and roughly how many ever', () => {
    const lion = byName('Lion');
    const then = face(renderToStaticMarkup(<SpeciesCard sp={lion} ageMa={70e-6} onClose={() => {}} />));
    expect(then).toContain('Lion (Panthera leo)');
    expect(then).toContain('352,000 alive 70 years ago');
    expect(then).toContain('56% have descendants alive today');
    expect(then).toContain('23,500 alive today');
    expect(then).toContain('Roughly 600 billion lions have ever lived (rough estimate)');
    const now = face(renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} />));
    expect(now).toContain(`${plainCount(population(lion).aliveAt(0))} alive today`);
    // At now, "alive today" once and no trivial "100% have descendants".
    expect(now.match(/alive today/g)!.length).toBe(1);
    expect(now).not.toContain('have descendants');
    const cave = face(renderToStaticMarkup(<SpeciesCard sp={byName('Cave lion')} ageMa={0.05} onClose={() => {}} />));
    expect(cave).toContain('alive 50,000 years ago');
    expect(cave).toContain('Died out 11,700 years ago');
    expect(cave).toContain('cave lions have ever lived');
    expect(cave).not.toContain('have descendants');
  });

  it('has no jargon on its face: the method, grade, range and generation length are tucked into the details', () => {
    for (const sp of PANTHERA.species) {
      for (const ageMa of [undefined, 70e-6, (sp.t0 + sp.t1) / 2]) {
        const html = renderToStaticMarkup(<SpeciesCard sp={sp} ageMa={ageMa} onClose={() => {}} />);
        const f = face(html);
        for (const jargon of ['grade', 'model', 'generation', 'range', 'Myr', 'kyr', '≈', 'lineage', 'curated', ' × 10', 'born in total', 'line ended'])
          expect(f, `${sp.common}: "${jargon}" on the face`).not.toContain(jargon);
        // A few short lines: the face stays tight.
        expect(f.replace(/Population over time[\s\S]*$/, '').length, sp.common).toBeLessThan(200);
        const d = details(html);
        expect(d).toContain('Generation');
        expect(d).toContain(`Data grade${sp.grade}`);
        expect(d).toContain(formatCount(sp.everLo));
        expect(d).toContain('Method');
        // Collapsed by default.
        expect(html).not.toMatch(/<details[^>]* open/);
      }
    }
  });

  it('shows the conservation status: the Red List category by its full name, or a prehistoric extinction', () => {
    const want: Record<string, string> = { Tiger: 'Endangered', Lion: 'Vulnerable', Leopard: 'Vulnerable', Jaguar: 'Near Threatened', 'Snow leopard': 'Vulnerable' };
    for (const sp of PANTHERA.species) {
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />);
      const chip = html.match(/<span class="status[^"]*"[^>]*>([^<]*)<\/span>/);
      expect(chip, sp.common).not.toBeNull();
      if (sp.extinct) {
        expect(chip![1]).toBe('Extinct (prehistoric)');
        expect(RED_LIST[sp.sci]).toBeUndefined();
      } else {
        expect(chip![1]).toBe(want[sp.common]);
        const s = RED_LIST[sp.sci];
        expect(s.year).toBeGreaterThanOrEqual(2017);
        expect(s.url).toMatch(/^https:\/\/www\.iucnredlist\.org\/species\/\d+\/\d+$/);
        expect(details(html)).toContain(`${s.year} assessment`);
        expect(html).toContain(`href="${s.url}"`);
      }
    }
  });

  it('says what the sparkline dots\' colours mean, in plain words', () => {
    for (const sp of PANTHERA.species.filter((s) => s.history && s.history.points.length > 0)) {
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />);
      const grades = new Set(sp.history!.points.map((p) => p.grade));
      for (const g of ['A', 'B', 'C', 'D']) {
        if (grades.has(g as never)) {
          expect(html).toContain(`data-key="${g}"`);
          expect(text(html)).toContain(GRADE_WORD[g]);
        } else expect(html).not.toContain(`data-key="${g}"`);
      }
    }
  });

  it('rounds in words', () => {
    expect(plainCount(351822)).toBe('352,000');
    expect(plainCount(1.234e6)).toBe('1.23 million');
    expect(roughCount(6.28e11)).toBe('600 billion');
    expect(roughCount(1.4e11)).toBe('140 billion');
    expect(roughCount(5.81e9)).toBe('6 billion');
    expect(plainAgo(70)).toBe('70 years ago');
    expect(plainAgo(11699.48)).toBe('11,700 years ago');
    expect(plainAgo(3.76e6)).toBe('3.8 million years ago');
  });
});

describe('the species card across species', () => {
  it('its keyed children have distinct keys, so switching species shows exactly one sparkline (no stale one kept by React)', () => {
    type El = { key: string | null; props: { children?: unknown } };
    const kids = (el: El) => ([] as unknown[]).concat(el.props.children ?? []).filter((c): c is El => !!c && typeof c === 'object' && 'props' in c);
    for (const sp of PANTHERA.species) {
      const card = SpeciesCard({ sp, onClose: () => {} }) as unknown as El;
      const keys = kids(card)
        .map((c) => c.key)
        .filter((k) => k !== null);
      expect(new Set(keys).size, sp.common).toBe(keys.length);
      // One sparkline at most.
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />);
      expect((html.match(/class="hist"/g) ?? []).length).toBe(sp.history && sp.history.points.length ? 1 : 0);
    }
  });
});
