// The world layers' switch (ToLaD#189): one small icon in the bar; a tap opens two
// checkboxes (geological periods, ice ages) under it.
import { useState } from 'react';
import type { WorldLayers } from './world';
import type { Measure } from './layout';

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

export function WorldToggle({
  get,
  onMeasure,
}: {
  get: () => { world: WorldLayers; measure: Measure; setMeasure(m: Measure): void; request(): void } | null;
  /** The widths' measure changed (the card says tonnes, ToLaD#276). */
  onMeasure?: (m: Measure) => void;
}) {
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
          {/* What the widths count (ToLaD#276): the individuals alive, or their mass (individuals × adult mass); ?width=mass kept in step. */}
          <label>
            Widths
            <select
              aria-label="What the widths count"
              value={v.measure}
              onChange={(e) => {
                const m = e.target.value as Measure;
                v.setMeasure(m);
                onMeasure?.(m);
                bump((n) => n + 1);
              }}
            >
              <option value="individuals">individuals</option>
              <option value="mass">mass (tonnes)</option>
            </select>
          </label>
        </div>
      )}
    </>
  );
}
