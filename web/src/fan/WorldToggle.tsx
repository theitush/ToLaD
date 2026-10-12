// The world layers' switch (ToLaD#189): one small icon in the bar; a tap opens three
// checkboxes (geological periods, ice ages, big events) under it.
import { useState } from 'react';
import type { WorldLayers } from './world';

const ROWS: [keyof WorldLayers, string][] = [
  ['periods', 'Geological periods'],
  ['ice', 'Ice ages'],
  ['events', 'Big events'],
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

export function WorldToggle({ get }: { get: () => { world: WorldLayers; request(): void } | null }) {
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  const v = get();
  return (
    <>
      <button
        type="button"
        className="icon"
        aria-label="The world: periods, ice ages, events"
        title="The world: periods, ice ages, events"
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
        </div>
      )}
    </>
  );
}
