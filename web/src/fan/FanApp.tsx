// The main view: one polytomy (Panthera), OneZoom-style. The time river is
// still available at ?river (and the synthetic spike tree at ?synthetic).

import * as MeshMirror from './mesh';
import { useEffect, useRef, useState } from 'react';
import { formatAge, formatCount } from '../data/names';
import { HistorySpark } from './HistorySpark';
import type { WidthMode } from './layout';
import { PANTHERA, type SpeciesRec } from './panthera';
import { FanView, fmtInt, formatYearsAgo, type IndInfo, type Selection } from './view';

declare global {
  interface Window {
    __fan?: FanView;
    /** The mesh's CPU mirror, for scripts/glcheck.mjs (GPU and CPU decisions compared). */
    __fanMesh?: typeof MeshMirror;
  }
}

export function FanApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<FanView | null>(null);
  const [mode, setMode] = useState<WidthMode>('linear');
  const [sel, setSel] = useState<Selection | null>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = new FanView(canvasRef.current!, PANTHERA);
    v.onSelect = setSel;
    v.scaleEl = scaleRef.current;
    v.barEl = barRef.current;
    viewRef.current = v;
    window.__fan = v;
    window.__fanMesh = MeshMirror;
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
      <div className="bar" ref={barRef}>
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
      <div className="foot">
        <div className="wscale" ref={scaleRef} aria-label="width scale">
          <span className="wbar" />
          <span className="wlab" />
        </div>
      {sel ? (
        sel.ind ? (
          <IndCard sp={sel.sp} ind={sel.ind} onClose={() => viewRef.current?.tap(-1e6, -1e6)} />
        ) : (
          <SpeciesCard sp={sel.sp} onClose={() => viewRef.current?.tap(-1e6, -1e6)} />
        )
      ) : (
        <div className="legend">
          <span className="li"><span className="dot alive" /> alive now</span> <span className="li"><span className="dot lineage" /> has living descendants</span>{' '}
          <span className="li"><span className="dot dead" /> line ended</span>
          <br />
          <span className="dim">Width is how many were alive at the time. Tap or zoom a branch.</span>
        </div>
      )}
      </div>
    </div>
  );
}

export function SpeciesCard({ sp, onClose, open }: { sp: SpeciesRec; onClose: () => void; open?: boolean }) {
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
      {sp.history && sp.history.points.length > 0 && <HistorySpark key={sp.gid} h={sp.history} open={open} />}
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
