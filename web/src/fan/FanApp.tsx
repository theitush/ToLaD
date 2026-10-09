// The main view: one polytomy (Panthera), OneZoom-style. The time river is
// still available at ?river (and the synthetic spike tree at ?synthetic).

import { useEffect, useRef, useState } from 'react';
import { formatAge, formatCount } from '../data/names';
import type { WidthMode } from './layout';
import { PANTHERA, type SpeciesRec } from './panthera';
import { FanView, fmtInt, formatYearsAgo, type IndInfo, type Selection } from './view';

declare global {
  interface Window {
    __fan?: FanView;
  }
}

export function FanApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<FanView | null>(null);
  const [mode, setMode] = useState<WidthMode>('log');
  const [sel, setSel] = useState<Selection | null>(null);

  useEffect(() => {
    const v = new FanView(canvasRef.current!, PANTHERA);
    v.onSelect = setSel;
    viewRef.current = v;
    window.__fan = v;
    v.request();
    return () => {
      v.destroy();
      viewRef.current = null;
      if (window.__fan === v) delete window.__fan;
    };
  }, []);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="stage" />
      <div className="bar">
        <button
          type="button"
          aria-pressed={mode === 'linear'}
          onClick={() => {
            const next = mode === 'log' ? 'linear' : 'log';
            setMode(next);
            viewRef.current?.setMode(next);
          }}
        >
          {mode === 'log' ? 'log widths' : 'linear widths'}
        </button>
        <button type="button" onClick={() => viewRef.current?.resetView()}>
          Big cats
        </button>
      </div>
      {sel ? (
        sel.ind ? (
          <IndCard sp={sel.sp} ind={sel.ind} onClose={() => viewRef.current?.tap(-1e6, -1e6)} />
        ) : (
          <SpeciesCard sp={sel.sp} onClose={() => viewRef.current?.tap(-1e6, -1e6)} />
        )
      ) : (
        <div className="legend">
          <span className="dot alive" /> alive <span className="dot dead" /> dead
          <br />
          width = individuals ever lived · tap or zoom a leaf
        </div>
      )}
    </div>
  );
}

function SpeciesCard({ sp, onClose }: { sp: SpeciesRec; onClose: () => void }) {
  const span = `${formatAge(sp.t0)} – ${sp.extinct ? formatAge(sp.t1) : 'now'}`;
  return (
    <div className="card-sp" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="t">
        {sp.common} <i>{sp.sci}</i>
      </div>
      <div>
        <span className="dot alive" /> <b>{formatCount(sp.alive)}</b> alive now
      </div>
      <div>
        <span className="dot dead" /> <b>{formatCount(sp.ever)}</b> ever lived{' '}
        <span className="dim">
          (range {formatCount(sp.everLo)} – {formatCount(sp.everHi)})
        </span>
      </div>
      <div className="dim">
        grade {sp.grade} · {span}
        {sp.extinct && <> · extinct ~{formatAge(sp.t1)}</>}
      </div>
      <div className="dim">
        generation ≈ {sp.genYears} y ({sp.genSource})
      </div>
    </div>
  );
}

function IndCard({ sp, ind, onClose }: { sp: SpeciesRec; ind: IndInfo; onClose: () => void }) {
  return (
    <div className="card-sp" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="t">
        <span className={`dot ${ind.alive ? 'alive' : 'dead'}`} /> <span className="mono">{ind.handle}</span>
      </div>
      <div>
        {ind.sex} {sp.common.toLowerCase()} · {ind.alive ? 'alive now' : 'dead'} · born ~{formatYearsAgo(ind.bornYearsAgo)}
      </div>
      <div className="dim">
        lived {ind.lifespan.toFixed(1)} y · generation {fmtInt(ind.g + 1)} of {fmtInt(ind.G)} · {ind.children} children
      </div>
      <div className="dim">
        parents:{' '}
        {ind.parents.length === 0
          ? 'none (founding generation)'
          : ind.parents.map((p, k) => (
              <span key={k} className="mono">
                {k ? ' + ' : ''}
                {p.handle}
              </span>
            ))}
      </div>
    </div>
  );
}
