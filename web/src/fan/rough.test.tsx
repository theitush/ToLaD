import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { columnSpans, COLUMN_TINT, ROUGH_DEFAULT, ROUGH_LOOKS } from './colstyle';
import { SpeciesCard } from './FanApp';
import { basisRows, GENOME_NOTE } from './HistorySpark';
import { basisSpans, joinFlagged, noDataSpans, type Basis } from './history';
import { layoutFan } from './layout';
import { FELIDAE } from './panthera';

// ToLaD#164 (with #119): stretches resting on the genome, a model or a flagged join are drawn rough;
// counted ones solid; held (no-data) ones keep #55's fade.

const fan = layoutFan(FELIDAE, 'log');
const byName = (common: string) => fan.branches.find((b) => b.sp.common === common)!;
const sp = (common: string) => byName(common).sp;
/** The bases in order, oldest first. */
const order = (common: string) => basisSpans(sp(common).history!).map((s) => s.basis);
/** The basis at an age (years before present). */
const basisAt = (common: string, ago: number): Basis | undefined => basisSpans(sp(common).history!).find((s) => ago <= s.ago0 && ago >= s.ago1)?.basis;
const styleAt = (common: string, ago: number) => {
  const b = byName(common);
  return columnSpans(b.sp, b.t0).find((s) => ago <= s.ago0 && ago >= s.ago1)?.style ?? 'count';
};

describe('stretch classification (ToLaD#164)', () => {
  it('leopard: held, then the genome (blind steps included), the join and range-loss trend as model, counts since 1998, held after 2020', () => {
    expect(order('Leopard')).toEqual(['held', 'genome', 'model', 'count', 'held']);
    expect(joinFlagged(sp('Leopard').history!)).toBe(false);
    // The dip and rise near a million years ago Ita asked about: genome.
    expect(basisAt('Leopard', 1e6)).toBe('genome');
    // The [deep.blind] steps it keeps (~10–14 kya): genome too.
    expect(basisAt('Leopard', 12_000)).toBe('genome');
    // Held flat to 1500 and the range-loss trend after it: model.
    expect(basisAt('Leopard', 3000)).toBe('model');
    expect(basisAt('Leopard', 300)).toBe('model');
    // Between the 1998 reconstruction and the 2020 estimate: counted.
    expect(basisAt('Leopard', 2026.77 - 2010)).toBe('count');
  });

  it('lion: its genome join is flagged (scaled beyond 10x), the cited counts since 1950 are counted', () => {
    expect(order('Lion')).toEqual(['held', 'genome', 'flagged', 'count']);
    expect(joinFlagged(sp('Lion').history!)).toBe(true);
    expect(basisAt('Lion', 50_000)).toBe('genome');
    expect(basisAt('Lion', 5000)).toBe('flagged');
    expect(basisAt('Lion', 2026.77 - 1990)).toBe('count');
  });

  it('tiger: blind-spot steps not drawn flag its flat join; counted from 1900', () => {
    expect(order('Tiger')).toEqual(['held', 'genome', 'flagged', 'count', 'held']);
    expect(basisAt('Tiger', 500_000)).toBe('genome');
    expect(basisAt('Tiger', 10_000)).toBe('flagged');
    expect(basisAt('Tiger', 2026.77 - 1950)).toBe('count');
  });

  it('a model-only small cat (the sand cat): model throughout, no count, no genome', () => {
    const h = sp('Sand cat').history!;
    expect(h.modelled).toBe('rangeloss');
    expect(order('Sand cat')).toEqual(['model']);
    // Every range-loss-only cat: model throughout.
    for (const b of fan.branches.filter((x) => x.sp.history?.modelled === 'rangeloss')) expect(order(b.sp.common), b.sp.common).toEqual(['model']);
  });

  it('spans tile the history: oldest first, contiguous, never empty', () => {
    for (const b of fan.branches.filter((x) => x.sp.history)) {
      const sp = basisSpans(b.sp.history!);
      for (let k = 0; k < sp.length; k++) {
        expect(sp[k].ago0, b.sp.common).toBeGreaterThan(sp[k].ago1);
        if (k) expect(Math.abs(sp[k].ago0 - sp[k - 1].ago1), b.sp.common).toBeLessThan(1);
        if (k) expect(sp[k].basis, b.sp.common).not.toBe(sp[k - 1].basis);
      }
    }
  });
});

describe('the column style per span (ToLaD#164)', () => {
  it('leopard: rough from its split (younger than its genome curve) to 1998, counted (unstyled) 1998–2020, held after', () => {
    const b = byName('Leopard');
    expect(columnSpans(b.sp, b.t0).map((s) => s.style)).toEqual(['rough', 'held']);
    expect(styleAt('Leopard', 1e6)).toBe('rough');
    expect(styleAt('Leopard', 3000)).toBe('rough');
    expect(styleAt('Leopard', 2026.77 - 2010)).toBe('count');
    expect(styleAt('Leopard', 2)).toBe('held');
  });

  it('lion: rough to 1950, counted to now; tiger: rough to 1900; sand cat rough whole; a cat with no history held whole', () => {
    expect(styleAt('Lion', 20_000)).toBe('rough');
    expect(styleAt('Lion', 2026.77 - 1990)).toBe('count');
    expect(styleAt('Lion', 1)).toBe('count');
    expect(styleAt('Tiger', 300_000)).toBe('rough');
    expect(styleAt('Tiger', 2026.77 - 1950)).toBe('count');
    const sand = byName('Sand cat');
    expect(columnSpans(sand.sp, sand.t0)).toEqual([{ ago0: sand.t0 * 1e6, ago1: 0, style: 'rough' }]);
    const plain = fan.branches.find((x) => !x.sp.extinct && !x.sp.history)!;
    expect(columnSpans(plain.sp, plain.t0).map((s) => s.style)).toEqual(['held']);
  });

  it('every living cat: rough spans never overlap held ones, and cover every genome, model or flagged stretch outside them', () => {
    for (const b of fan.branches.filter((x) => !x.sp.extinct && x.sp.history && x.sp.births)) {
      const spans = columnSpans(b.sp, b.t0);
      for (let k = 1; k < spans.length; k++) expect(spans[k].ago0, b.sp.common).toBeLessThanOrEqual(spans[k - 1].ago1 + 1e-6);
      const held = spans.filter((s) => s.style === 'held');
      for (const s of basisSpans(b.sp.history!)) {
        if (s.basis === 'count' || s.basis === 'held') continue;
        const mid = Math.min((s.ago0 + s.ago1) / 2, b.t0 * 1e6 - 1);
        if (held.some((h) => mid <= h.ago0 && mid >= h.ago1)) continue;
        expect(spans.some((x) => x.style === 'rough' && mid <= x.ago0 && mid >= x.ago1), `${b.sp.common} ${s.basis} at ${mid}`).toBe(true);
      }
      // No-data stretches are unchanged by #164: still the noDataSpans ones.
      expect(held.length, b.sp.common).toBe(noDataSpans(b.sp.history!).filter((s) => s.side === 'after' || b.t0 * 1e6 > b.sp.history!.nowYear - s.year).length);
    }
  });

  it('the rough look is lighter than the held fade and keeps the stretch readable', () => {
    expect(ROUGH_DEFAULT in ROUGH_LOOKS).toBe(true);
    expect(COLUMN_TINT.rough.a).toBeLessThan(COLUMN_TINT.held.a);
    expect(COLUMN_TINT.rough.a).toBeGreaterThan(0.15);
  });
});

describe('the card (ToLaD#164)', () => {
  it('says the genome sentence where the curve has a genome stretch, and only there', () => {
    expect(GENOME_NOTE).toBe('Wiggles in the genome curve can come from a population that split into regions and rejoined, not only from changes in numbers.');
    for (const common of ['Leopard', 'Lion', 'Tiger']) expect(renderToStaticMarkup(<SpeciesCard sp={sp(common)} onClose={() => {}} />), common).toContain(GENOME_NOTE);
    expect(renderToStaticMarkup(<SpeciesCard sp={sp('Sand cat')} onClose={() => {}} />)).not.toContain('Wiggles in the genome');
  });

  it('the details list which stretches are genome, model or counted', () => {
    const rows = basisRows(sp('Leopard').history!);
    expect(rows.map((r) => r.split(' ')[0])).toEqual(['genome', 'model', 'counted']);
    expect(rows[2]).toBe('counted 1998 – 2020');
    const lion = basisRows(sp('Lion').history!);
    expect(lion.map((r) => r.replace(/ [~\d].*/, ''))).toEqual(['genome', 'flagged join', 'counted']);
    expect(lion[2]).toMatch(/– now$/);
    const html = renderToStaticMarkup(<SpeciesCard sp={sp('Leopard')} onClose={() => {}} open />);
    expect(html).toContain('data-basis-note=""');
    for (const r of rows) expect(html).toContain(r);
    expect(basisRows(sp('Sand cat').history!)).toEqual([expect.stringMatching(/^model .* – now$/)]);
  });
});
