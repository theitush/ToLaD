// The search (ToLaD#157): a magnifier in the top bar opens a field over the bar; typing lists the
// matching species under it (search.ts); picking one flies the fan there and opens its card.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SpeciesRec } from './panthera';
import { searchSpecies } from './search';

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

export function SearchPanel({ species, onPick, onClose, initial = '' }: { species: readonly SpeciesRec[]; onPick: (sp: SpeciesRec) => void; onClose: () => void; initial?: string }) {
  const [q, setQ] = useState(initial);
  const [active, setActive] = useState(0);
  const hits = useMemo(() => searchSpecies(species, q), [species, q]);
  const listRef = useRef<HTMLUListElement>(null);
  const k = Math.min(active, hits.length - 1);

  // The active row kept in view as the arrows move it.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`#${rowId(k)}`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [k]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((Math.max(0, k) + d + hits.length) % hits.length);
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
          aria-activedescendant={k >= 0 && hits.length ? rowId(k) : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        <button type="button" className="search-x" aria-label="Close search" onClick={onClose}>
          ×
        </button>
      </div>
      {q.trim() !== '' && (
        <ul className="search-list" id={LIST_ID} role="listbox" ref={listRef} aria-label="Matching species">
          {hits.length === 0 ? (
            <li className="search-none">No species by that name</li>
          ) : (
            hits.map((sp, i) => (
              <li
                key={sp.gid}
                id={rowId(i)}
                role="option"
                aria-selected={i === k}
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
            ))
          )}
        </ul>
      )}
    </div>
  );
}
