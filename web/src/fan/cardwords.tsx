// The species card's words and "How we count" (ToLaD#508, Methods.tsx): where its count today came from, as far as the
// data says, and the page FanApp holds for the card's links (Methods.tsx MethodLink). A tap on one opens the page at its
// section, over everything; back or its × closes it, and the card under it is as it was (same species, same scroll,
// Details as they were): the page is FanApp's, not the card's.

import { useState, type ReactNode } from 'react';
import { useAlone } from './Alone';
import { CURVE_KINDS } from './HistorySpark';
import { METHOD_IDS, Methods } from './Methods';
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

/** Where a species' count today is explained: its history (step 3) when it has one of its own, else step 1. */
export function aliveStep(sp: SpeciesRec): string {
  return sp.history && !sp.history.modelled ? METHOD_IDS.histories : METHOD_IDS.alive;
}
