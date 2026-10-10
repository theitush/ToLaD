// The main view: one polytomy (Panthera), OneZoom-style. The time river is
// still available at ?river (and the synthetic spike tree at ?synthetic).

import * as MeshMirror from './mesh';
import { useEffect, useRef, useState } from 'react';
import { formatAge, formatCount } from '../data/names';
import { HistorySpark } from './HistorySpark';
import type { WidthMode } from './layout';
import { PANTHERA, type SpeciesRec } from './panthera';
import { population } from './population';
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
          <SpeciesCard sp={sel.sp} ageMa={sel.ageMa} onClose={() => viewRef.current?.tap(-1e6, -1e6)} />
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

/** A span of years as a duration: "~3.8 Myr", "~117 kyr", "~250 yr". */
export function formatSpan(years: number): string {
  if (years >= 1e6) return `~${(years / 1e6).toPrecision(2)} Myr`;
  if (years >= 1e3) return `~${Math.round(years / 1e3)} kyr`;
  return `~${Math.round(years)} yr`;
}

/**
 * The population at a time (Ma) as the card words it: how many were alive, and
 * the shares with living descendants today and whose line ended.
 */
export function populationAt(sp: SpeciesRec, ageMa: number): { when: string; alive: number; green: number } {
  const p = population(sp);
  const a = Math.min(Math.max(ageMa, sp.t1), sp.extinct ? sp.t0 : Infinity);
  const yrs = a * 1e6;
  const when = yrs < 0.5 ? 'now' : sp.extinct && Math.abs(a - sp.t1) < 1e-9 ? `at its end, ${formatYearsAgo(yrs)}` : formatYearsAgo(yrs);
  const st = p.stepAt(a);
  return { when, alive: st.n, green: st.q };
}

export function SpeciesCard({ sp, onClose, open, ageMa }: { sp: SpeciesRec; onClose: () => void; open?: boolean; ageMa?: number }) {
  const span = `${formatAge(sp.t0)} – ${sp.extinct ? formatAge(sp.t1) : 'now'}`;
  const at = populationAt(sp, ageMa ?? sp.t1);
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  return (
    <div className="card-sp" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="t">
        {sp.common} <i>{sp.sci}</i>
      </div>
      <div>
        <b>{formatCount(at.alive)}</b> alive {at.when}
      </div>
      <div>
        <span className="dot lineage" /> {pct(at.green)} have living descendants today · <span className="dot dead" /> {pct(1 - at.green)} line ended
      </div>
      {at.when !== 'now' && !sp.extinct && (
        <div>
          <span className="dot alive" /> {formatCount(sp.alive)} alive now
        </div>
      )}
      <div className="dim">
        ~{formatCount(sp.ever)} born in total over {formatSpan((sp.t0 - sp.t1) * 1e6)} (model, grade {sp.grade}; range {formatCount(sp.everLo)} – {formatCount(sp.everHi)})
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
