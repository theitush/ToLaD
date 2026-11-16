// Back on a tab left open (ToLaD#478): a phone's browser drops a background tab's GPU context, sometimes the whole
// page. The view never stays white: it draws again as it stands, its context asked back (meshgl.ts), and if that does not
// come back, the page reloads itself to where it stood (the view's place and its open card, kept in the tab's session
// storage when the page goes hidden). A tab the browser discarded or reloaded comes back there too.

import type { CardKey, FanView, Place, Selection } from './view';

const KEY = 'tolad:back';
/** How long a lost context has, once the page is shown again (or lost while shown), to come back before the page reloads. */
const RESTORE_MS = 2000;
/** A page this soon after its own reload does not reload again: a context that never comes back is not a reload loop. */
const RELOAD_GAP_MS = 60_000;

/** Where the page stood (`href` with its toggles), the card open; `reload` when the page reloaded itself (ms since epoch). */
type Kept = { href: string; place: Place; card: CardKey | null; reload?: number };

let kept: Kept | null | undefined;

/**
 * Where the page stood when it went hidden, if this load is that page coming back: the same address, reloaded (by the
 * browser, Ita or the page), restored from history, or a discarded tab. A fresh visit (a link, the address typed) is not.
 * Read once per load.
 */
export function keptPlace(): Kept | null {
  if (kept !== undefined) return kept;
  kept = null;
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const k = raw ? (JSON.parse(raw) as Kept) : null;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const back = (document as Document & { wasDiscarded?: boolean }).wasDiscarded || nav?.type === 'reload' || nav?.type === 'back_forward';
    if (k && k.href === location.href && back) kept = k;
  } catch {
    /* no session storage */
  }
  return kept;
}

/**
 * Keep `v` drawn through the page going hidden and coming back: hidden, its place (and the card `card()` open) is kept;
 * shown again (a tab switch, or bfcache's `pageshow`), it draws again, and a context still lost after RESTORE_MS reloads
 * the page to the place kept. A context lost while the page is shown waits the same. Returns the unwatch.
 */
export function watchBack(v: FanView, card: () => Selection | null): () => void {
  const lastReload = keptPlace()?.reload ?? 0;
  let wait = 0;
  // (Set once the page reloads itself: its own pagehide keeps no other place over the one kept.)
  let leaving = false;
  const keep = (reload?: number) => {
    if (leaving) return;
    try {
      const sel = card();
      const k: Kept = { href: location.href, place: v.place(), card: sel ? v.cardKey(sel) : null, reload };
      sessionStorage.setItem(KEY, JSON.stringify(k));
    } catch {
      /* no session storage: a reload goes home */
    }
  };
  const check = () => {
    clearTimeout(wait);
    wait = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      if (!v.contextLost) {
        // (Drawn again: the place kept is for a page that does not come back, and this one did.)
        try {
          sessionStorage.removeItem(KEY);
        } catch {
          /* none */
        }
      } else if (Date.now() - lastReload > RELOAD_GAP_MS) {
        const now = Date.now();
        keep(now);
        leaving = true;
        location.reload();
      }
    }, RESTORE_MS);
  };
  const shown = () => {
    v.redraw();
    check();
  };
  const onVisibility = () => (document.visibilityState === 'hidden' ? keep() : shown());
  const onPageShow = (e: PageTransitionEvent) => e.persisted && shown();
  const onHide = () => keep();
  const onLost = () => document.visibilityState === 'visible' && check();
  const canvases = [v.canvas, v.gl?.canvas].filter((c): c is HTMLCanvasElement => !!c);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onHide);
  for (const c of canvases) {
    c.addEventListener('webglcontextlost', onLost);
    c.addEventListener('contextlost', onLost);
  }
  return () => {
    clearTimeout(wait);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onHide);
    for (const c of canvases) {
      c.removeEventListener('webglcontextlost', onLost);
      c.removeEventListener('contextlost', onLost);
    }
  };
}
