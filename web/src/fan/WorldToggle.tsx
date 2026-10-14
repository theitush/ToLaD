// The world layers' switch (ToLaD#189): one small icon in the bar; a tap opens two
// checkboxes (geological periods, ice ages) under it.
import { useState } from 'react';
import type { WorldLayers } from './world';
import { wantFitFossils } from './steady';
import type { NameMode } from './view';

const ROWS: [keyof WorldLayers, string][] = [
  ['periods', 'Geological periods'],
  ['ice', 'Ice ages'],
];

/** A globe: what the Earth was like. */
function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <ellipse cx="10" cy="10" rx="3.2" ry="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 10 H17 M4.4 6 H15.6 M4.4 14 H15.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function WorldToggle({ get }: { get: () => { world: WorldLayers; names: NameMode; request(): void } | null }) {
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  const v = get();
  return (
    <>
      <button
        type="button"
        className="icon"
        aria-label="The world: periods and ice ages"
        title="The world: periods and ice ages"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <GlobeIcon />
      </button>
      {open && v && (
        <div className="world-menu" role="group" aria-label="The world on the time axis">
          {ROWS.map(([k, label]) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={v.world[k]}
                onChange={(e) => {
                  v.world[k] = e.target.checked;
                  v.request();
                  bump((n) => n + 1);
                }}
              />
              {label}
            </label>
          ))}
          {/* A level whose living members dwarf its fossils (the hominins beside the humans, ToLaD#289) framed on the fossils, the rooms by life; the page opens again with ?fit=fossils on or off. */}
          <label>
            <input
              type="checkbox"
              checked={wantFitFossils()}
              onChange={(e) => {
                const u = new URL(window.location.href);
                if (e.target.checked) u.searchParams.set('fit', 'fossils');
                else u.searchParams.delete('fit');
                window.location.assign(u.toString());
              }}
            />
            Fit fossils
          </label>
          {/* Where the groups' names stand (ToLaD#266): switched in place, the URL's ?names= kept in step. */}
          <label>
            Names
            <select
              aria-label="Where the group names stand"
              value={v.names}
              onChange={(e) => {
                v.names = e.target.value as NameMode;
                try {
                  const u = new URL(window.location.href);
                  if (v.names === 'beside') u.searchParams.delete('names');
                  else u.searchParams.set('names', v.names);
                  window.history.replaceState(null, '', u.toString());
                } catch {
                  /* no URL */
                }
                v.request();
                bump((n) => n + 1);
              }}
            >
              <option value="beside">beside the branch</option>
              <option value="mid">mid-branch</option>
              <option value="gap">between branches</option>
            </select>
          </label>
        </div>
      )}
    </>
  );
}
