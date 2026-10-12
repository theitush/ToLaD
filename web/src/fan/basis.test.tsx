import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SpeciesCard } from './FanApp';
import { basisRows, GENOME_NOTE } from './HistorySpark';
import { basisSpans, joinFlagged, type Basis } from './history';
import { layoutFan } from './layout';
import { FELIDAE } from './panthera';

// ToLaD#164 (with #119): what each stretch of a species' curve rests on (count, genome, model, a
// flagged join, held), said in the card's text. The rough look on the fan and the sparkline was
// dropped (#171); held (no-data) stretches keep #55's fade.

const fan = layoutFan(FELIDAE, 'log');
const byName = (common: string) => fan.branches.find((b) => b.sp.common === common)!;
const sp = (common: string) => byName(common).sp;
/** The bases in order, oldest first. */
const order = (common: string) => basisSpans(sp(common).history!).map((s) => s.basis);
/** The basis at an age (years before present). */
const basisAt = (common: string, ago: number): Basis | undefined => basisSpans(sp(common).history!).find((s) => ago <= s.ago0 && ago >= s.ago1)?.basis;

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
    expect(html).toContain(`Where these numbers come from: ${rows.join('; ')}.`);
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/solid|dashed/i); // (the text; data-style attributes aside)
    expect(html).toContain('reconstructed guess'); // the sparkline's key as before #164
    for (const r of rows) expect(html).toContain(r);
    expect(basisRows(sp('Sand cat').history!)).toEqual([expect.stringMatching(/^model .* – now$/)]);
  });
});
