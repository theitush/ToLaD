// React is only the shell: a canvas, a few toggles and an overlay element.
// The engine owns the camera and every per-frame value; React never sees them.

import { useEffect, useRef, useState } from 'react';
import { DataClient, dataBase } from './data/client';
import { cleanName, displayName, formatAge } from './data/names';
import { TileTreeSource, type RNode } from './data/tile-source';
import { Engine } from './engine/engine';
import { NoWebGLError } from './engine/renderer';

declare global {
  interface Window {
    __tolad?: Engine;
    __toladApp?: AppHooks;
  }
}

/** Test / console hooks (used by scripts/perf.mjs). */
export interface AppHooks {
  source: TileTreeSource | null;
  /** Load tiles as needed, then fly to the first node with this (scientific) name. */
  flyToName(name: string): Promise<boolean>;
}

type Status = 'loading' | 'ready' | 'nowebgl' | 'error';

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [log, setLog] = useState(false);
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).has('debug'));
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [synthetic] = useState(() => new URLSearchParams(location.search).has('synthetic'));

  useEffect(() => {
    if (!hasWebGL2()) {
      setStatus('nowebgl');
      return;
    }
    let engine: Engine | null = null;
    let client: DataClient | null = null;
    let dead = false;
    const start = (make: () => Engine) => {
      try {
        engine = make();
      } catch (e) {
        if (e instanceof NoWebGLError) setStatus('nowebgl');
        else {
          setError(String(e));
          setStatus('error');
        }
        return;
      }
      engineRef.current = engine;
      window.__tolad = engine;
      engine.setDebug(debug);
      engine.setOverlay(debug ? overlayRef.current : null);
      setStatus('ready');
    };
    if (synthetic) {
      start(() => new Engine(canvasRef.current!));
    } else {
      client = new DataClient(dataBase());
      client
        .load(-1)
        .then((skel) => {
          if (dead) return;
          const source = new TileTreeSource(skel, (t) => client!.load(t));
          source.onTile(() => engineRef.current?.dataChanged());
          window.__toladApp = {
            source,
            flyToName: (name) => flyToName(source, () => engineRef.current, name),
          };
          start(
            () =>
              new Engine(canvasRef.current!, {
                source,
                labelOf: (n) => {
                  const r = n.src as RNode;
                  return displayName(r.f.names(r.row)).label;
                },
                formatAge,
              }),
          );
        })
        .catch((e) => {
          if (dead) return;
          setError(`Could not load the mammal data: ${e}`);
          setStatus('error');
        });
    }
    return () => {
      dead = true;
      engine?.destroy();
      client?.destroy();
      engineRef.current = null;
      if (window.__tolad === engine) delete window.__tolad;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setDebug(debug);
    e.setOverlay(debug ? overlayRef.current : null);
  }, [debug, status]);

  if (status === 'nowebgl') return <NoWebGL />;

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
          {synthetic ? 'LUCA' : 'Mammals'}
        </button>
        <button type="button" aria-pressed={debug} onClick={() => setDebug((d) => !d)}>
          debug
        </button>
      </div>
      <div className="legend">
        <span className="dot alive" /> alive <span className="dot dead" /> dead
        {!synthetic && (
          <>
            {' '}
            <span className="dot ghost" /> ghost lineages (estimated)
          </>
        )}
        <br />
        width = births per year · area = individuals ever lived
      </div>
      <pre ref={overlayRef} className="overlay" hidden={!debug} />
      {status === 'loading' && <div className="loading">Loading mammals…</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function NoWebGL() {
  return (
    <div className="nowebgl">
      <div className="card">
        <h1>This browser can’t draw the tree</h1>
        <p>
          ToLaD draws the tree of life with <b>WebGL 2</b>, and your browser didn’t let us create a WebGL context. That usually
          means graphics acceleration is turned off or your graphics driver is blocked.
        </p>
        <ul>
          <li>
            <b>Turn on hardware acceleration.</b> Firefox: Settings → General → Performance → untick “Use recommended performance
            settings” and tick “Use hardware acceleration when available”, then restart. Chrome/Edge: Settings → System → “Use
            graphics acceleration when available”.
          </li>
          <li>
            <b>Try another browser.</b> Recent Chrome, Edge or Safari usually work.
          </li>
          <li>
            Check what your browser supports at{' '}
            <a href="https://get.webgl.org/webgl2/" target="_blank" rel="noreferrer">
              get.webgl.org
            </a>
            .
          </li>
        </ul>
        <button type="button" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    </div>
  );
}

async function flyToName(source: TileTreeSource, engine: () => Engine | null, name: string): Promise<boolean> {
  const want = name.toLowerCase();
  const find = (): number => {
    for (const rec of source.files.values()) {
      const p = rec.p;
      for (let i = 0; i < p.n; i++) {
        if (rec.names(i).some((s) => cleanName(s).toLowerCase() === want)) return p.gid[i];
      }
    }
    return -1;
  };
  let gid = find();
  for (const t of source.meta.tiles as { id: number }[]) {
    if (gid >= 0) break;
    if (source.files.has(t.id)) continue;
    await source.loadTile(t.id);
    gid = find();
  }
  let path = gid >= 0 ? source.pathTo(gid) : null;
  if (path && path[0] !== source.skeleton.p.gid[0]) {
    // An ancestor tile is missing: load the rest, then the path is complete.
    await Promise.all((source.meta.tiles as { id: number }[]).map((t) => source.loadTile(t.id)));
    path = source.pathTo(gid);
  }
  const e = engine();
  if (!path || !e) return false;
  // Make sure every tile on the path is loaded (stubs along the way).
  e.dataChanged();
  return !!e.flyToPath(path.map((g) => `g${g}`));
}
