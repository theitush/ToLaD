// The page's sources (ToLaD#429): a card over the foot, one line per source (sources.ts). Closed by its × or a press outside it.

import { useEffect, useRef } from 'react';
import { ISSUES_URL, SOURCES } from './sources';

export function SourcesPanel({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [onClose]);
  return (
    <div ref={box} className="card-sp sources" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="t">Sources</div>
      <ul className="sources-list">
        {SOURCES.map((s) => (
          <li key={s.name}>
            <a href={s.url} target="_blank" rel="noopener">
              {s.name}
            </a>
            <span className="dim"> {[s.by, s.when].filter(Boolean).join(', ')}</span> · {s.use}
          </li>
        ))}
      </ul>
      <div className="dim sources-end">
        The data stays with its owners. To have something taken down,{' '}
        <a href={ISSUES_URL} target="_blank" rel="noopener">
          open an issue
        </a>
        .
      </div>
    </div>
  );
}
