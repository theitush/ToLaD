import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { plainAgo, plainCount, SpeciesCard } from './FanApp';
import { fmtYear, HistorySpark, popTicks, yearTicks } from './HistorySpark';
import { GRADE_WORD, MODELLED_KINDS, noDataSpans, styleBetween } from './history';
import { FELIDAE, type HistoryRec } from './panthera';
import { population } from './population';
import { RED_LIST, redListOf } from './status';
import { approxCountsIn, formatCount } from '../data/count';

const byName = (common: string) => FELIDAE.species.find((s) => s.common === common)!;

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
        if (p.note) expect(html).toContain(esc(approxCountsIn(p.note)));
        expect(html).toContain(`grade ${p.grade}`);
        expect(html).toContain(p.kind);
      }
      // Sparkline markers: one per point, coloured by grade; the spans between them styled like the edge.
      expect((html.match(/<circle /g) ?? []).length).toBe(h.points.length);
      const pts = h.points.slice().sort((a, b) => a.year - b.year);
      for (let k = 1; k < pts.length; k++) expect(html).toContain(`data-style="${styleBetween(h, pts[k - 1].year, pts[k].year)}"`);
    }
  });

  it('a modelled range-loss trend (format v1.3, ToLaD#73) draws dashed with a hollow start, never like a cited point', () => {
    // As the pipeline ships it for a species with no history file (Lynx lynx): natural held to 1500 CE, then log-linear to today.
    const G = 9.14;
    const h: HistoryRec = {
      use: 'counts',
      component: 'wild',
      scope: '',
      notes: 'Modelled, not counted (grade D).',
      modelled: 'rangeloss',
      G,
      L: G / 2,
      nowYear: 2027,
      points: [
        { year: 1500, n: 707946, lo: 62230, hi: 8035261, grade: 'D', kind: 'rangeloss', baseline: false, cite: 'ToLaD range-loss trend (ToLaD#62)', url: '', note: '' },
        { year: 2027, n: 434510, lo: 45499, hi: 4149540, grade: 'C', kind: 'model', baseline: false, cite: 'ToLaD model', url: '', note: '' },
      ],
      segments: [
        { year0: 1500 - 1000 * G, generations: 1000, startSize: 1.5e5, endSize: 1.5e5, grade: 'D', kind: 'natural' },
        { year0: 1500, generations: 57.6, startSize: 1.5e5, endSize: 9.5e4, grade: 'D', kind: 'rangeloss' },
      ] as HistoryRec['segments'],
    };
    const html = renderToStaticMarkup(<HistorySpark h={h} open />);
    expect(html).toContain('data-style="dashed"');
    expect(html).not.toContain('data-style="dotted"');
    // The trend's start is hollow (the model's), today's count a filled dot.
    expect((html.match(/data-modelled=""/g) ?? []).length).toBe(1);
    expect(html).toContain('data-modelled-note=""');
    expect(html).toContain('Modelled, not counted');
  });

  it('collapsed, the card shows the sparkline but not the list; species without history show neither', () => {
    const lion = renderToStaticMarkup(<SpeciesCard sp={byName('Lion')} onClose={() => {}} />);
    expect(lion).toContain('<svg');
    expect(lion).not.toContain('<li>');
    const plain = FELIDAE.species.find((s) => !s.history)!;
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
        // A modelled point (the range-loss trend's start, ToLaD#62) cites the model's README, not a paper.
        if (!MODELLED_KINDS.has(p.kind)) expect(p.url).toMatch(/^https:\/\/doi\.org\//);
      }
      // the Red List's decline: the earlier level is higher than the latest figure
      expect(pts[0].n).toBeGreaterThan(pts[pts.length - 1].n);
      expect(pts[pts.length - 1].year).toBeGreaterThanOrEqual(2015);
    }
  });

  it('the lynxes show their cited counts, joined to the natural level in 1500 (#94, #110)', () => {
    for (const [c, today] of [['Iberian lynx', 2401], ['Eurasian lynx', 69400], ['Canada lynx', 158000]] as const) {
      const h = byName(c).history!;
      const pts = h.points.slice().sort((a, b) => a.year - b.year);
      expect(Math.abs(pts.at(-1)!.n / today - 1), c).toBeLessThan(0.01); // stored at reduced precision
      expect(pts[0].year, c).toBe(1500);
      expect(MODELLED_KINDS.has(h.segments[0].kind), c).toBe(true);
    }
  });

  it('no living species shows a flat assumed stretch without a "no data" mark', () => {
    // (The wild species with a curated or genomic history; the rest show the constant model, the domestic cat its growth since
    // domestication, a range-loss trend (ToLaD#62) its modelled natural level, dashed as modelled, not held; so does a
    // history file whose first cited point is joined to the natural level in 1500 by that trend, e.g. the lynxes, #94.)
    const living = FELIDAE.species.filter(
      (s) =>
        !s.extinct &&
        s.history?.component === 'wild' &&
        s.history.modelled !== 'rangeloss' &&
        !MODELLED_KINDS.has(s.history.segments[0]?.kind ?? ''),
    );
    expect(living.length).toBeGreaterThanOrEqual(6);
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
      expect(html).toContain(`No data before ${fmtYear(before!.year)}: held at `);
      // A held stretch after the last figure is drawn faint too, never as a plain line.
      expect(html.includes('data-nodata="after"')).toBe(nd.some((s) => s.side === 'after'));
    }
    // With a genomic deep past (ToLaD#60) every Panthera is held at its oldest genomic level, not at
    // today's count (snow leopard, no cited baseline) or the pre-decline level (leopard, 1998).
    for (const c of ['Snow leopard', 'Leopard']) {
      const h = byName(c).history!;
      const nd = noDataSpans(h).find((s) => s.side === 'before')!;
      const p0 = h.points.slice().sort((a, b) => a.year - b.year)[0];
      expect(p0.kind, c).toBe('genomic');
      expect(nd.today, c).toBe(false);
      expect(nd.year, c).toBe(p0.year);
      expect(nd.level, c).toBe(p0.n);
    }
  });

  it('the sparkline has 3–5 round year ticks and one or two population ticks', () => {
    for (const sp of FELIDAE.species.filter((s) => s.history && s.history.points.length > 1)) {
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
    expect(then).toContain('~400k alive 70 years ago');
    expect(then).toContain('58% have descendants alive today');
    expect(then).toContain('~23k alive today');
    expect(then).toContain('Roughly 700 billion lions have ever lived (rough estimate)'); // (its genomic deep past, ToLaD#60/#66)
    const now = face(renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} />));
    expect(now).toContain(`${formatCount(population(lion).aliveAt(0))} alive today`);
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
    for (const sp of FELIDAE.species) {
      for (const ageMa of [undefined, 70e-6, (sp.t0 + sp.t1) / 2]) {
        const html = renderToStaticMarkup(<SpeciesCard sp={sp} ageMa={ageMa} onClose={() => {}} />);
        const f = face(html);
        for (const jargon of ['grade', 'model', 'generation', 'range', 'Myr', 'kyr', '≈', 'lineage', 'curated', ' × 10', 'born in total', 'line ended'])
          expect(f, `${sp.common}: "${jargon}" on the face`).not.toContain(jargon);
        // A few short lines: the face stays tight.
        // (Under 230: every cat now carries its status chip, ToLaD#48, up to "Critically Endangered" long.)
        expect(f.replace(/Population over time[\s\S]*$/, '').length, sp.common).toBeLessThan(230);
        const d = details(html);
        expect(d).toContain('Generation');
        expect(d).toContain(`Data grade${sp.grade}`);
        expect(d).toContain(formatCount(sp.everLo, { tilde: false }));
        expect(d).toContain('Method');
        // Collapsed by default.
        expect(html).not.toMatch(/<details[^>]* open/);
      }
    }
  });

  it('shows the conservation status: the Red List category by its full name, or a prehistoric extinction', () => {
    const want: Record<string, string> = { Tiger: 'Endangered', Lion: 'Vulnerable', Leopard: 'Vulnerable', Jaguar: 'Near Threatened', 'Snow leopard': 'Vulnerable' };
    for (const sp of FELIDAE.species) {
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />);
      const chip = html.match(/<span class="status[^"]*"[^>]*>([^<]*)<\/span>/);
      // (Every cat has a status in the data, ToLaD#48: the living their category, the domestic cat Not Evaluated.)
      expect(chip, sp.common).not.toBeNull();
      if (sp.extinct) {
        expect(chip![1]).toBe('Extinct (prehistoric)');
        expect(RED_LIST[sp.sci]).toBeUndefined();
        expect(sp.redList).toBeNull(); // fossils carry no status in the data
      } else if (sp.sci === 'Felis catus') {
        expect(chip![1]).toBe('Not Evaluated');
        expect(sp.redList?.source).toBe('not-listed');
      } else {
        if (want[sp.common]) expect(chip![1]).toBe(want[sp.common]);
        // the data's status (ToLaD#48), or the curated one where that is the newer assessment
        expect(sp.redList?.source).toBe('iucn-2026-1');
        const s = redListOf(sp)!;
        expect(s.year).toBeGreaterThanOrEqual(2015); // (the Panthera since 2017; a few small cats were last assessed in 2015)
        expect(s.url).toMatch(/^https:\/\/www\.iucnredlist\.org\/species\/\d+\/\d+$/);
        expect(details(html)).toContain(`${s.year} assessment`);
        expect(html).toContain(`href="${s.url}"`);
      }
    }
  });

  it('shows the chip even when the species is in no danger: Least Concern in gray (ToLaD#98)', () => {
    // A stubbed LC status for a small cat (the pipeline's statuses are ToLaD#48).
    const sp = byName('Leopard cat');
    const had = RED_LIST[sp.sci];
    RED_LIST[sp.sci] = { category: 'LC', year: 2022, cite: 'stub', url: 'https://www.iucnredlist.org/species/1/2' };
    try {
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />);
      expect(html).toMatch(/<span class="status iucn-lc"[^>]*>Least Concern<\/span>/);
      expect(details(html)).toContain('IUCN Red List: Least Concern (LC)');
    } finally {
      if (had) RED_LIST[sp.sci] = had;
      else delete RED_LIST[sp.sci];
    }
    // Threatened categories keep their colours.
    expect(renderToStaticMarkup(<SpeciesCard sp={byName('Tiger')} onClose={() => {}} />)).toContain('class="status iucn-en"');
  });

  it('says what the sparkline dots\' colours mean, in plain words', () => {
    for (const sp of FELIDAE.species.filter((s) => s.history && s.history.points.length > 0)) {
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
    expect(plainAgo(70)).toBe('70 years ago');
    expect(plainAgo(11699.48)).toBe('11,700 years ago');
    expect(plainAgo(3.76e6)).toBe('3.8 million years ago');
  });
});

describe('the species card across species', () => {
  it('its keyed children have distinct keys, so switching species shows exactly one sparkline (no stale one kept by React)', () => {
    type El = { key: string | null; props: { children?: unknown } };
    const kids = (el: El) => ([] as unknown[]).concat(el.props.children ?? []).filter((c): c is El => !!c && typeof c === 'object' && 'props' in c);
    for (const sp of FELIDAE.species) {
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
