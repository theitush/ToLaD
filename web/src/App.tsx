// React is only the shell: a canvas, two toggles and an overlay element.
// The engine owns the camera and every per-frame value; React never sees them.

import { useEffect, useRef, useState } from 'react';
import { Engine } from './engine/engine';

declare global {
  interface Window {
    __tolad?: Engine;
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [log, setLog] = useState(false);
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).has('debug'));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let engine: Engine;
    try {
      engine = new Engine(canvasRef.current!);
    } catch (e) {
      setError(String(e));
      return;
    }
    engineRef.current = engine;
    window.__tolad = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
      if (window.__tolad === engine) delete window.__tolad;
    };
  }, []);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setDebug(debug);
    e.setOverlay(debug ? overlayRef.current : null);
  }, [debug]);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="stage" />
      <div className="bar">
        <button
          type="button"
          aria-pressed={log}
          onClick={() => {
            const next = !log;
            setLog(next);
            engineRef.current?.setMode(next ? 1 : 0);
          }}
        >
          {log ? 'log widths' : 'linear widths'}
        </button>
        <button type="button" onClick={() => engineRef.current?.resetView()}>
          LUCA
        </button>
        <button type="button" aria-pressed={debug} onClick={() => setDebug((d) => !d)}>
          debug
        </button>
      </div>
      <div className="legend">
        <span className="dot alive" /> alive <span className="dot dead" /> dead · now ↑ · LUCA ↓
      </div>
      <pre ref={overlayRef} className="overlay" hidden={!debug} />
      {error && <div className="error">{error}</div>}
    </div>
  );
}
