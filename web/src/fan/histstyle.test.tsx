import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { plainAgo, plainCount, SpeciesCard } from './FanApp';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bandEdge, CURVE_KINDS, fmtWhen, HistorySpark, isNaturalStart, popTicks, sourceRows, yearTicks } from './HistorySpark';
import { GRADE_WORD, MODELLED_KINDS, noDataSpans, styleBetween } from './history';
import { FELIDAE, NATURAL_META, type HistoryRec } from './panthera';
import { loadClade } from './panthera-extract';
import { population } from './population';
import { RED_LIST, redListOf } from './status';
import { approxCountsIn, formatCount } from '../data/count';

const byName = (common: string) => FELIDAE.species.find((s) => s.common === common)!;

describe('species card history', () => {
  it('lists every point with its year, numbers, grade, kind, citation link and note; the genomic curve as one row', () => {
    for (const common of ['Lion', 'Tiger', 'Snow leopard', 'Leopard', 'Cougar']) {
      const sp = byName(common);
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} open />);
      const h = sp.history!;
      expect(html).toContain('<svg');
      const rows = sourceRows(h.points.slice().sort((a, b) => a.year - b.year), sp.natural);
      expect((html.match(/<li[ >]/g) ?? []).length, common).toBe(rows.length);
      const genomic = h.points.filter((p) => p.kind === 'genomic');
      expect(genomic.length, common).toBeGreaterThan(2); // every one of these has a genomic deep past (ToLaD#60/#64)
      expect(rows.filter((r) => r.kind === 'genomic').length, common).toBe(1);
      expect((html.match(/data-row="genomic"/g) ?? []).length).toBe(1);
      const esc = (t: string) => renderToStaticMarkup(<>{t}</>);
      for (const p of h.points) {
        expect(html).toContain(esc(p.cite));
        if (p.url) expect(html).toContain(`href="${p.url}"`);
        // (A range-loss start that is the natural level is folded into the natural row, which says so itself.)
        if (p.note && p.kind !== 'genomic' && !isNaturalStart(p, sp.natural)) expect(html).toContain(esc(approxCountsIn(p.note)));
        expect(html).toContain(`grade ${p.grade}`);
        if (p.kind !== 'genomic') expect(html).toContain(p.kind);
      }
      // Sparkline markers: a dot per cited figure only, coloured by grade; the reconstructed points (genomic steps,
      // range-loss trend, the model's count) are one guessed curve over a faint band, no dots or bars (Ita, #69).
      const cited = h.points.filter((p) => !CURVE_KINDS.has(p.kind));
      expect((html.match(/<g data-grade=/g) ?? []).length, common).toBe(cited.length);
      expect((html.match(/<circle /g) ?? []).length, common).toBe(cited.length + (html.match(/data-modelled=""/g) ?? []).length);
      expect((html.match(/data-modelled=""/g) ?? []).length, common).toBeLessThanOrEqual(1);
      expect(html).toContain('data-band=""');
      expect(html).toContain('data-curve=""');
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
    // The trend and today's modelled count are one guessed curve over a band: no dots, no bars.
    expect(html).not.toContain('<circle');
    expect((html.match(/data-band=""/g) ?? []).length).toBe(1);
    expect(html).toContain('data-key="reconstructed"');
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

  it('no living species shows a flat assumed stretch without a "no data" mark', () => {
    // (The wild species with a curated or genomic history; the rest show the constant model, the domestic cat its growth since
    // domestication, a range-loss trend (ToLaD#62) its modelled natural level, dashed as modelled, not held.)
    const living = FELIDAE.species.filter((s) => !s.extinct && s.history?.component === 'wild' && s.history.modelled !== 'rangeloss');
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
      expect(html).toContain(`No data before ${fmtWhen(before!.year, h!.nowYear)}: held at `);
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
    // One power of ten inside: two round ticks still, to read the scale by (the lynx, ToLaD#57).
    expect(popTicks(Math.log10(2.5e5), Math.log10(1.3e6))).toEqual([5e5, 1e6]);
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
        // IUCN does not assess domestic forms: NE in the data, "Domesticated" in gray on the card (ToLaD#98)
        expect(chip![1]).toBe('Domesticated');
        expect(html).toContain('class="status domestic"');
        expect(sp.redList?.source).toBe('not-listed');
        expect(html).not.toContain('href=""');
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
    // The leopard cat's own status from the data (ToLaD#48): Least Concern.
    const sp = byName('Leopard cat');
    expect(RED_LIST[sp.sci]).toBeUndefined();
    const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />);
    expect(html).toMatch(/<span class="status iucn-lc"[^>]*>Least Concern<\/span>/);
    expect(details(html)).toContain('IUCN Red List: Least Concern (LC)');
    // A Not Evaluated species has no assessment page: no link on its Status line.
    const ne = { ...sp, redList: { ...sp.redList!, category: 'NE', source: 'not-listed', sourceLabel: 'not listed', cite: 'not listed', url: '' } };
    const neHtml = renderToStaticMarkup(<SpeciesCard sp={ne} onClose={() => {}} />);
    expect(neHtml).toMatch(/<span class="status iucn-ne"[^>]*>Not Evaluated<\/span>/);
    expect(details(neHtml)).toContain('Not Evaluated (NE)');
    expect(neHtml).not.toContain('href=""');
    // Threatened categories keep their colours.
    expect(renderToStaticMarkup(<SpeciesCard sp={byName('Tiger')} onClose={() => {}} />)).toContain('class="status iucn-en"');
  });

  it('says what the sparkline dots\' colours mean, in plain words', () => {
    for (const sp of FELIDAE.species.filter((s) => s.history && s.history.points.length > 0)) {
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />);
      // (only the cited figures' grades: the reconstructed curve has its own key)
      const grades = new Set(sp.history!.points.filter((p) => !CURVE_KINDS.has(p.kind)).map((p) => p.grade));
      for (const g of ['A', 'B', 'C', 'D']) {
        if (grades.has(g as never)) {
          expect(html).toContain(`data-key="${g}"`);
          expect(text(html)).toContain(GRADE_WORD[g]);
        } else expect(html).not.toContain(`data-key="${g}"`);
      }
    }
  });

  it('names the species mid-sentence with its capital and plural (ToLaD#107)', () => {
    const ever = (common: string) => face(renderToStaticMarkup(<SpeciesCard sp={byName(common)} onClose={() => {}} />));
    expect(ever('Eurasian lynx')).toContain('Eurasian lynxes have ever lived');
    expect(ever('Iberian lynx')).toContain('Iberian lynxes have ever lived');
    expect(ever('Snow leopard')).toContain('snow leopards have ever lived');
    expect(ever('Bobcat')).toContain('bobcats have ever lived');
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

describe('the card shows the deep past and the natural level (ToLaD#69)', () => {
  const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/mammals');
  const read = (rel: string) => new Uint8Array(readFileSync(resolve(DATA, rel)));
  const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
  const spark = (sp: { history: HistoryRec | null; natural?: unknown }, open = true) =>
    renderToStaticMarkup(<HistorySpark h={sp.history!} open={open} natural={sp.natural as never} naturalMeta={NATURAL_META} />);

  it('a genomic deep past takes a log-time axis in years ago, with round ticks and "now"', () => {
    const html = spark(byName('Lion'), false);
    expect(html).toContain('data-axis="log"');
    expect(text(html)).toContain('Population over time, years ago');
    const ticks = [...html.matchAll(/<text[^>]*text-anchor="middle"[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]);
    for (const t of ['1k', '10k', '100k', '1M', 'now']) expect(ticks).toContain(t);
    // The last century is not squashed into the corner: 1950 and 2024 are well apart (on a linear axis, under 7 px).
    const xs = [...html.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
    // Only recent history: a linear calendar axis as before.
    expect(spark(byName('Eurasian lynx'), false)).toContain('data-axis="linear"');
  });

  it('the genomic curve is one modelled source row, with its Ne/N ratio and the per-species join rule (ToLaD#80)', () => {
    const lion = byName('Lion');
    const html = spark(lion);
    const row = text(html.match(/<li data-row="genomic">[\s\S]*?<\/li>/)![0]);
    expect(row).toContain('Armstrong et al. 2025');
    expect(row).toContain('Ne/N 0.1');
    expect(row).toContain('genomic curve, modelled');
    expect(row).toContain('million years ago');
    expect(lion.history!.deepJoin).toBeTruthy();
    expect(html).toContain('data-deep-join=""');
    expect(row).toContain('First cited point');
  });

  it('says the deep-past join for a scaled curve (Bison bison) and a kept, flagged one (Addax)', () => {
    const bovids = loadClade(read, 'Bovidae').species;
    const bison = bovids.find((s) => s.sci === 'Bison bison')!;
    const b = text(spark(bison));
    // (The factor follows the data: ~981 at the flat mutation rate, ~1.2k with the per-lineage one, #74/#75.)
    expect(b).toMatch(/Genomic curve scaled x~?[\d.,]+k? to meet the cited 1800 baseline \(~40 million\)/);
    expect(b).toContain('flagged');
    const addax = bovids.find((s) => s.sci === 'Addax nasomaculatus')!;
    const a = spark(addax);
    expect(a).toContain('data-axis="log"');
    expect(text(a)).toContain('Genomic curve kept at its own level');
    expect(text(a)).toContain('flagged: beyond 10x');
    expect((a.match(/data-row="genomic"/g) ?? []).length).toBe(1);
  });

  it('shows the natural (pre-human) level: a faint line and a modelled source row, with its range areas and citation', () => {
    expect(NATURAL_META).toBeTruthy();
    for (const common of ['Lion', 'Eurasian lynx']) {
      const sp = byName(common);
      expect(sp.natural, common).toBeTruthy();
      const html = spark(sp);
      expect(html).toContain('data-natural=""');
      expect(html).toContain('data-key="reconstructed"');
      const row = text(html.match(/<li data-row="natural">[\s\S]*?<\/li>/)![0]);
      expect(row).toContain('Natural (pre-human) baseline');
      expect(row).toContain(`${formatCount(sp.natural!.n)} (${formatCount(sp.natural!.lo)} – ${formatCount(sp.natural!.hi)})`);
      expect(row).toContain('grade D · modelled');
      expect(row).toContain('PHYLACINE');
      expect(row).toContain('km² today');
      expect(html).toContain(`href="${NATURAL_META!.url}"`);
    }
    // The natural level is listed once: a range-loss trend starting at it (the lynx's 1500 point) is not a row of its
    // own but the natural row, in its place in time, which says where the trend starts (ToLaD#123).
    const lynx = byName('Eurasian lynx');
    const lx = text(spark(lynx));
    expect(lx.split(`${formatCount(lynx.natural!.n)} (`).length - 1).toBe(1);
    expect(sourceRows(lynx.history!.points.slice().sort((a, b) => a.year - b.year), lynx.natural).map((r) => r.kind)).toEqual(['natural', 'point']);
    expect(lx).toContain('held to 1500, where the rangeloss trend starts');
    expect(lx).toContain('ToLaD range-loss trend');
    // A living cat with a natural level but no history carries it in its details.
    for (const sp of FELIDAE.species.filter((s) => s.natural && !(s.history && s.history.points.length))) {
      const html = renderToStaticMarkup(<SpeciesCard sp={sp} onClose={() => {}} />);
      expect(html, sp.common).toContain('<dd data-natural="">');
    }
  });
});

describe('the sparkline y axis follows the central values, not the ranges (ToLaD#57, ToLaD#123)', () => {
  const svgOf = (common: string) => {
    const sp = byName(common);
    return renderToStaticMarkup(<HistorySpark h={sp.history!} natural={sp.natural} naturalMeta={NATURAL_META} />);
  };
  const num = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => Number(m[1]));

  it("a 30% fall reads as a slope: the leopard's 1998 -> 2020 estimates drop at least 8 px (3.4 when the ranges set the axis); on every Panthera a 30% fall is at least 4-5", () => {
    const leo = [...svgOf('Leopard').matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="3.2"/g)].map((m) => Number(m[2]));
    expect(leo.length).toBe(2); // 1998 (188k), 2020 (131k)
    expect(leo[1] - leo[0]).toBeGreaterThan(8);
    for (const common of ['Lion', 'Leopard', 'Tiger', 'Snow leopard', 'Jaguar']) {
      const html = svgOf(common);
      // px per decade, from the two y ticks and their labels
      const ys = num(html, /<line x1="31" x2="326" y1="([\d.]+)"/g);
      const vs = [...html.matchAll(/text-anchor="end">([^<]+)</g)].map((m) => m[1]);
      expect(ys.length, common).toBe(2);
      const v = (t: string) => Number(t.replace(/k$/, 'e3').replace(/M$/, 'e6'));
      const perDecade = (ys[0] - ys[1]) / Math.log10(v(vs[1]) / v(vs[0]));
      // (The tiger's own figures span two decades, its fall from 100k to 3k, so its 30% is a little smaller; it was 2.8 px.)
      expect(perDecade * Math.log10(1 / 0.7), common).toBeGreaterThan(common === 'Tiger' ? 4 : 5);
    }
  });

  it('range bars and bands that run past the plot are clipped at its edge, with a marker', () => {
    const leo = svgOf('Leopard');
    // Both estimates' 95% ranges run off the bottom (to 61k and 43k): two bar markers; the bars end at the plot's edges.
    expect((leo.match(/data-clip="bar-bottom"/g) ?? []).length).toBe(2);
    expect(leo).not.toContain('data-clip="bar-top"');
    for (const m of leo.matchAll(/y1="([\d.]+)" y2="([\d.]+)" stroke="[^"]+" stroke-width="2"/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(6);
      expect(Number(m[2])).toBeLessThanOrEqual(90 - 16);
    }
    expect(leo).toMatch(/<g clip-path="url\(#spark-clip[^"]*\)"><polygon/);
    expect(leo).toContain('data-clip="band-top"');
    // The lion's estimates are tight: nothing clipped there.
    expect(svgOf('Lion')).not.toContain('data-clip="bar-');
  });

  it("a single much wider point flares the band near it, not across the whole span (the leopard's 1500)", () => {
    const leo = byName('Leopard');
    const run = leo.history!.points.filter((p) => CURVE_KINDS.has(p.kind)).sort((a, b) => a.year - b.year);
    const X = (y: number) => y; // a linear stand-in axis: 1 px a year
    const hi = bandEdge(run, 'hi', (y) => X(y));
    expect(hi.length).toBe(run.length + 1); // one extra vertex, before the 1500 point
    const [xv, nv] = hi[hi.length - 2];
    const a = run[run.length - 2];
    const b = run[run.length - 1];
    expect(b.year - xv).toBeCloseTo(14, 5); // TAPER px short of it
    // ... on the straight centre line, at the genomic step's width, not the 1500 point's
    const f = (xv - a.year) / (b.year - a.year);
    const centre = Math.log10(a.n) + f * (Math.log10(b.n) - Math.log10(a.n));
    expect(Math.log10(nv) - centre).toBeCloseTo(Math.log10(a.hi / a.n), 6);
    expect(Math.log10(b.hi / b.n)).toBeGreaterThan(Math.log10(a.hi / a.n) + 0.3);
    expect(hi[hi.length - 1][1]).toBe(b.hi); // and the point's own range at the point
  });

  it('the "no data" label clears the natural line (the cougar)', () => {
    for (const common of ['Cougar', 'Leopard', 'Lion', 'Tiger', 'Snow leopard', 'Jaguar']) {
      const html = svgOf(common);
      const lab = /<text x="[\d.]+" y="([\d.-]+)"[^>]*data-nodata-label=""/.exec(html);
      const nat = /y1="([\d.-]+)"[^>]*data-natural=""/.exec(html);
      if (!lab || !nat) continue;
      const base = Number(lab[1]);
      const ny = Number(nat[1]);
      expect(ny > base + 1 || ny < base - 8, common).toBe(true);
    }
  });
});
