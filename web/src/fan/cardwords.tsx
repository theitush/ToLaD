// The species card's words and "How we count" (ToLaD#508, Methods.tsx): where its count today came from, as far as the
// data says, and the page FanApp holds for the card's links (Methods.tsx MethodLink). A tap on one opens the page at its
// section, over everything; back or its × closes it, and the card under it is as it was (same species, same scroll,
// Details as they were): the page is FanApp's, not the card's.

import { useState, type ReactNode } from 'react';
import { useAlone } from './Alone';
import { CURVE_KINDS } from './HistorySpark';
import { METHOD_IDS, MethodLink, Methods } from './Methods';
import type { SpeciesRec } from './panthera';

/**
 * The page and its opener, for FanApp: the page while open (else null), and open(at). Open adds one history entry at
 * the same address (useAlone), so back closes the page and leaves the card's own entry (sheet.ts) and the page's alone.
 */
export function useMethodsPage(): [ReactNode, (at: string) => void] {
  const [shown, show, close] = useAlone();
  const [at, setAt] = useState<string>();
  const open = (id: string) => {
    setAt(id);
    show();
  };
  return [shown ? <Methods onClose={close} at={at} /> : null, open];
}

/**
 * Where a living species' count today came from, as far as the data says (the methods page's step 1 and 3):
 * - 'counted': a census (an IUCN population report; humans: the UN's), or a history's latest figure that is a census;
 * - 'published': its history's latest figure, a published estimate (the chart's sources);
 * - 'modelled': no count: Greenspoon's model and ours met in the middle, or ours alone. Which of the two, the data does
 *   not say (the pipeline's `today_from` stays in the build);
 * - null: the data does not say. FLAG bit 8 is set by a history that drives the counts, a modelled genomic one too, so
 *   for those (and a history ending on the model's count) a census and a model look the same.
 */
export type AliveSource = 'counted' | 'published' | 'modelled' | null;

export function aliveSource(sp: SpeciesRec): AliveSource {
  if (sp.extinct) return null;
  // A reptile's published count (ToLaD#578): a survey or census is counted, an assessment's or an index's figure published.
  if (sp.count) return sp.count.kind === 'census' ? 'counted' : 'published';
  const h = sp.history;
  const file = !!h && !h.modelled;
  if (file && h!.use === 'counts') {
    const last = h!.points.reduce<(typeof h.points)[number] | null>((a, p) => (!a || p.year >= a.year ? p : a), null);
    if (!last || CURVE_KINDS.has(last.kind)) return null;
    return last.kind === 'census' ? 'counted' : 'published';
  }
  if (!sp.anchored) return 'modelled';
  // (Anchored with no history driving the counts: a census, or humans.)
  return !h || h.modelled === 'rangeloss' || h.use !== 'counts' ? 'counted' : null;
}

/** The card's few words for each source. */
export const SOURCE_WORD: Record<Exclude<AliveSource, null>, string> = {
  counted: 'counted',
  published: 'published estimate',
  modelled: 'modelled',
};

/**
 * What a reptile's published count counts, its year and source (ToLaD#578): the number is the source's own, not turned
 * into all ages, so the card says "mature individuals, 2019 (Isberg et al. 2019)" under it, the source linked. Null:
 * no such count (every mammal and bird).
 */
export function countWords(sp: SpeciesRec): { what: string; cite: string; url: string } | null {
  const c = sp.count;
  if (!c || sp.extinct) return null;
  return { what: `${c.counts}, ${c.year}`, cite: c.short || shortCite(c.cite) || 'source', url: c.url };
}

/** The card's line under today's count of a reptile with a published one: what it counts, its year, its source. */
export function CountLine({ sp }: { sp: SpeciesRec }) {
  const w = countWords(sp);
  if (!w) return null;
  return (
    <p className="sub" data-count-src>
      {w.what} (
      <a href={w.url} target="_blank" rel="noreferrer">
        {w.cite}
      </a>
      )
    </p>
  );
}

/** Where a species' count today is explained: its history (step 3) when it has one of its own, else step 1. */
export function aliveStep(sp: SpeciesRec): string {
  return sp.history && !sp.history.modelled ? METHOD_IDS.histories : METHOD_IDS.alive;
}

/**
 * A citation's short name for the card (ToLaD#507): its first author and year ("Strahan & Van Dyck 2008", "Ray, Hunter &
 * Zigouris 2005", "Faurby et al. 2018"); IUCN's own maps by their year ("IUCN 2026", ToLaD#594); a citation that names
 * none is PHYLACINE's note's own ("PHYLACINE"), else ''. The whole citation is in the chart's sources.
 */
export function shortCite(cite: string): string {
  const iucn = cite.match(/^IUCN (\d{4})(?!\d)/);
  if (iucn) return `IUCN ${iucn[1]}`;
  const m = cite.match(AUTHOR_YEAR);
  if (m) return m[0].replace(/,(?= \d)/, '');
  return /^PHYLACINE note/.test(cite) ? 'PHYLACINE' : '';
}
// A surname has a small letter (so "BP" is none), a particle may lead it ("Van Dyck", "van Strien").
const SURNAME = "(?:(?:[Dd]e|[Vv]an|[Vv]on|[Dd]a) )?[A-Z][\\p{L}'’-]*\\p{Ll}[\\p{L}'’-]*";
const AUTHOR_YEAR = new RegExp(`${SURNAME}(?:(?:, | & | and )${SURNAME})*(?: et al\\.)?,? (?:1[5-9]\\d\\d|20\\d\\d)(?!\\d)`, 'u');

/** A source's year in the card's words: a year from 1000 CE as it is ("1788"), an older one as years ago, rounded ("~10,500 years ago"). */
export function yearWords(y: number, now = new Date().getFullYear()): string {
  if (y >= 1000) return String(y);
  const ago = now - y;
  const r = ago < 1e4 ? Math.round(ago / 100) * 100 : Math.round(ago / 500) * 500;
  return `~${r.toLocaleString('en-US')} years ago`;
}

/** A source's window in words: "by ~11,000 years ago", "after 1280", "~7,500–2,500 years ago", "1280–1850". */
function spanWords(from: number | null, to: number | null): string {
  if (from === null && to === null) return 'before 1500';
  if (from === null) return `by ${yearWords(to!)}`;
  if (to === null) return `after ${yearWords(from)}`;
  const [a, b] = [yearWords(from), yearWords(to)];
  if (a === b) return a;
  const ago = / years ago$/;
  return ago.test(a) && ago.test(b) ? `${a.replace(ago, '')}–${b.replace(/^~/, '')}` : ago.test(a) || ago.test(b) ? `${a} to ${b}` : `${a}–${b}`;
}

/**
 * What dates a living species' fall since 1500, in a few words (ToLaD#507 group 3, research/range-loss-dates.md): the
 * words linked to the methods page, the rest, and the page's section. Null: no line, the species has no loss the data
 * dates, or no fall (a domestic stock's rise). The five bases (pipeline/FORMAT.md "Loss dates"):
 * - later: "Range lost since 1788 (Strahan & Van Dyck 2008)": the fall starts at the documented start;
 * - dated: "Range lost since 1500 (Hall 1981)": the source is bounded by 1500; "Range lost since 1500 (IUCN 2026)": IUCN's
 *   maps code the lost part Extinct or Possibly Extinct (ToLaD#594);
 * - prehistoric: "Range in mainland Australia lost ~3,300–3,100 years ago, not counted": left out of the 1500 level;
 * - bound: "Range lost after people reached Madagascar (~10,500 years ago)": only a lower bound; a bound that names no
 *   land (the moose's Iron Age range) says its year and source;
 * - undated: "When it lost its range is not known".
 */
export function lossWords(sp: SpeciesRec): { link: string; rest: string; to: string } | null {
  const l = sp.loss;
  const nat = sp.natural;
  if (!l || sp.extinct || !nat || nat.n < sp.alive * (1 - 1e-6)) return null;
  const cite = shortCite(l.cite);
  const by = cite ? ` (${cite})` : '';
  switch (l.basis) {
    case 'later':
    case 'dated':
      return { link: 'Range lost', rest: ` since ${l.start}${by}`, to: METHOD_IDS.past };
    case 'prehistoric':
      return { link: l.place ? `Range in ${l.place} lost` : 'Part of its range lost', rest: ` ${spanWords(l.from, l.to)}, not counted`, to: METHOD_IDS.past };
    case 'bound':
      if (l.from === null) break;
      return /^\p{Lu}/u.test(l.place)
        ? { link: 'Range lost', rest: ` after people reached ${l.place} (${yearWords(l.from)})`, to: METHOD_IDS.past }
        : { link: 'Range lost', rest: ` after ${yearWords(l.from)}${by}`, to: METHOD_IDS.past };
  }
  return { link: 'When it lost its range', rest: ' is not known', to: METHOD_IDS.unknown };
}

/** The card's line under the change since 1500 (lossWords), its first words opening the methods page; nothing when it has none. */
export function LossLine({ sp }: { sp: SpeciesRec }) {
  const w = lossWords(sp);
  if (!w) return null;
  return (
    <p className="loss" data-loss={sp.loss!.basis}>
      <MethodLink to={w.to}>{w.link}</MethodLink>
      {w.rest}
    </p>
  );
}
