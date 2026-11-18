// The search (ToLaD#157): a magnifier in the top bar opens a field over the bar; typing lists the
// matching species under it (search.ts); picking one flies the fan there and opens its card.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SpeciesRec } from './panthera';
import { foldNames, searchSpecies } from './search';

/** A magnifier drawn in SVG (no icon font). */
export function MagnifierIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="8.5" cy="8.5" r="5.75" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12.8 12.8 L17.5 17.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** The list's id (the field's aria-controls) and each row's. */
const LIST_ID = 'fan-search-list';
const rowId = (k: number) => `${LIST_ID}-${k}`;

/**
 * The list drawn where it shows (ToLaD#564): a row's height and the list's padding (app.css .search-list), the height it
 * shows (eight rows), and the rows drawn past it each way. The rest is the list's padding, so it scrolls to every hit.
 */
export const ROW = 44;
const PAD = 4;
const VIEW = 8 * ROW + 2 * PAD;
const OVER = 6;

/** The rows drawn, [first, end), for the list scrolled to `top` in a view `view` tall, of n. */
export function rowsDrawn(top: number, view: number, n: number): [number, number] {
  const a = Math.max(0, Math.min(n, Math.floor((top - PAD) / ROW) - OVER));
  return [a, Math.max(a, Math.min(n, Math.ceil((top - PAD + view) / ROW) + OVER))];
}

/** Where the list scrolls to show row k from `top` (the least move, as scrollIntoView's "nearest"), of n. */
function scrollFor(k: number, top: number, view: number, n: number): number {
  const y = PAD + k * ROW;
  const t = y + ROW + PAD > top + view ? y + ROW + PAD - view : y - PAD < top ? y - PAD : top;
  return Math.max(0, Math.min(t, 2 * PAD + n * ROW - view));
}

export function SearchPanel({ species, onPick, onClose, initial = '' }: { species: readonly SpeciesRec[]; onPick: (sp: SpeciesRec) => void; onClose: () => void; initial?: string }) {
  const [q, setQ] = useState(initial);
  const [active, setActive] = useState(0);
  // The list's scroll and height, as its scroll events tell them.
  const [top, setTop] = useState(0);
  const [view, setView] = useState(VIEW);
  const hits = useMemo(() => searchSpecies(species, q), [species, q]);
  const listRef = useRef<HTMLUListElement>(null);
  const k = Math.min(active, hits.length - 1);
  const [a, b] = rowsDrawn(top, view, hits.length);

  // The names folded as the panel opens (after its first paint), if the page has not yet at idle (ToLaD#564).
  useEffect(() => {
    const t = setTimeout(() => foldNames(species), 0);
    return () => clearTimeout(t);
  }, [species]);

  /** The list scrolled to `y`: drawn there now, the element scrolled (its scroll event then agrees). */
  const scrollTo = (y: number) => {
    setTop(y);
    if (listRef.current) listRef.current.scrollTop = y;
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      const next = (Math.max(0, k) + d + hits.length) % hits.length;
      setActive(next);
      // The active row kept in view as the arrows move it.
      scrollTo(scrollFor(next, top, view, hits.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (k >= 0 && hits[k]) onPick(hits[k]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="search" role="search" onPointerDown={(e) => e.stopPropagation()}>
      <div className="search-field">
        <MagnifierIcon />
        <input
          type="search"
          autoFocus
          value={q}
          placeholder="Find a species"
          aria-label="Find a species"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={k >= a && k < b ? rowId(k) : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            scrollTo(0);
          }}
          onKeyDown={onKey}
        />
        <button type="button" className="search-x" aria-label="Close search" onClick={onClose}>
          ×
        </button>
      </div>
      {q.trim() !== '' && (
        <ul
          className="search-list"
          id={LIST_ID}
          role="listbox"
          ref={listRef}
          aria-label="Matching species"
          // Only the rows in view drawn (ToLaD#564): the padding stands for the rest, so the list scrolls as if all were there.
          style={hits.length ? { paddingTop: PAD + a * ROW, paddingBottom: PAD + (hits.length - b) * ROW } : undefined}
          onScroll={(e) => {
            setTop(e.currentTarget.scrollTop);
            setView(e.currentTarget.clientHeight || VIEW);
          }}
        >
          {hits.length === 0 ? (
            <li className="search-none">No species by that name</li>
          ) : (
            hits.slice(a, b).map((sp, j) => {
              const i = a + j;
              return (
                <li
                  key={sp.gid}
                  id={rowId(i)}
                  role="option"
                  aria-selected={i === k}
                  aria-setsize={hits.length}
                  aria-posinset={i + 1}
                  className={i === k ? 'on' : undefined}
                  // Keep the field focused (the keyboard up) until the pick.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(sp)}
                >
                  <span className="nm">{sp.common}</span>
                  {sp.sci !== sp.common && <i>{sp.sci}</i>}
                  {sp.extinct && <span className="ext">extinct</span>}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
