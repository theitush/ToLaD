// Engine: glues tree, layout, camera, scene builder, renderer and input.
// Plain TS, framework-agnostic. Renders only when something changes.

import { Camera } from './camera';
import { DiveDriver } from './dive';
import { copyFrame, frame, toChild, toParent, type Frame } from './frame';
import { Input } from './input';
import { LabelPlacer } from './labels';
import { Layout, type LNode } from './layout';
import { link, Renderer } from './renderer';
import { INST_FLOATS, SceneBuilder } from './scene';
import { RollingStats, summarize } from './stats';
import { GlyphAtlas, TextBatch, TextRenderer } from './text';
import { SyntheticTree, type TreeSource } from './tree';

export interface EngineOptions {
  /** Data source; the synthetic infinite tree if omitted. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source?: TreeSource<any> | null;
  /** Node label text ('' = none). Enables SDF labels. */
  labelOf?: ((n: LNode) => string) | null;
  /** Age formatter for the time axis (enables it when the source has ages). */
  formatAge?: ((ageMa: number, stepYears: number) => string) | null;
  /** Start in log widths. */
  log?: boolean;
  /** Max device pixel ratio for the backing store (fill rate is the mobile limit). */
  dprCap?: number;
  /** Resolution scale used during gestures when frames are slow. */
  gestureScale?: number;
  seed?: number;
}

interface Flight {
  node: LNode;
  f0: Frame;
  f1: Frame;
  t0: number;
  dur: number;
}

interface FrameRecord {
  t: number;
  interval: number;
  cpu: number;
  instances: number;
  depth: number;
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

export class Engine {
  readonly layout: Layout;
  readonly cam: Camera;
  readonly scene: SceneBuilder;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly opts: Required<EngineOptions>;

  debug = false;
  /** Diagnostics: gl.finish() every frame so the cpu figure includes GPU time. */
  syncGpu = false;
  private overlayEl: HTMLElement | null = null;
  private raf = 0;
  private lastNow = 0;
  private continuous = false;
  private cssW = 1;
  private cssH = 1;
  private resScale = 1;
  private pxScale = 1;
  private frameNo = 0;
  private lastOverlay = 0;
  private ro: ResizeObserver;

  private interval = new RollingStats(120);
  private cpu = new RollingStats(120);
  private recording: FrameRecord[] | null = null;

  /** Width-mode animation: 0 = linear, 1 = log. */
  modeTarget = 0;
  private modeAnim: { from: number; to: number; t0: number; dur: number; pivot: LNode } | null = null;
  private flight: Flight | null = null;
  private inertia: { vx: number; vy: number; vz: number; px: number; py: number } | null = null;
  private dive: { driver: DiveDriver; until: number; resolve: () => void } | null = null;
  private debugBuf = { data: new Float32Array(INST_FLOATS * 64), count: 0 };
  private text: TextRenderer | null = null;
  private textBatch: TextBatch | null = null;
  labels: LabelPlacer | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: EngineOptions = {},
  ) {
    this.opts = { dprCap: 2, gestureScale: 0.75, seed: 1, source: null, labelOf: null, formatAge: null, log: false, ...options };
    this.layout = new Layout(this.opts.source ?? new SyntheticTree(this.opts.seed));
    if (this.opts.log) {
      this.layout.setMix(1);
      this.modeTarget = 1;
    }
    this.cssW = Math.max(1, canvas.clientWidth);
    this.cssH = Math.max(1, canvas.clientHeight);
    this.cam = new Camera(this.layout, this.cssW, this.cssH);
    this.scene = new SceneBuilder(this.layout);
    this.renderer = new Renderer(canvas);
    this.scene.onEvict = (c) => this.renderer.release(c);
    if (this.opts.labelOf || this.opts.formatAge) {
      const atlas = new GlyphAtlas();
      this.text = new TextRenderer(this.renderer.gl, atlas, link);
      this.textBatch = new TextBatch(atlas);
      const cache = new Map<string, string>();
      const labelOf = this.opts.labelOf;
      this.labels = new LabelPlacer(this.layout, {
        budget: 36,
        labelOf: (n) => {
          if (!labelOf) return '';
          let t = cache.get(n.id);
          if (t === undefined) {
            t = labelOf(n);
            cache.set(n.id, t);
          }
          return t;
        },
        formatAge: this.opts.formatAge ?? ((a) => `${a} Ma`),
      });
    }
    this.input = new Input(canvas, {
      gestureStart: () => {
        this.flight = null;
        this.inertia = null;
        this.continuous = false;
        this.requestFrame();
      },
      gestureEnd: () => this.requestFrame(),
      pan: (dx, dy) => {
        this.cam.pan(dx, dy);
        this.requestFrame();
      },
      zoom: (px, py, fx, ft) => {
        this.cam.zoomAt(px, py, fx, ft);
        this.requestFrame();
      },
      fling: (vx, vy, vz, px, py) => {
        if (Math.hypot(vx, vy) > 0.05 || Math.abs(vz) > 0.0003) {
          this.inertia = { vx, vy, vz, px, py };
        }
        this.requestFrame();
      },
      doubleTap: (x, y) => this.fitAt(x, y),
    });
    this.ro = new ResizeObserver(() => this.requestFrame());
    this.ro.observe(canvas);
    this.requestFrame();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.input.destroy();
  }

  /** New data arrived (a tile): chunks rebuild and pending stubs gain children. */
  dataChanged(): void {
    this.layout.dataChanged();
    this.requestFrame();
  }

  /** Fly to the node with these ids from the root down (ids of LNodes, root first). */
  flyToPath(ids: string[]): LNode | null {
    let n = this.layout.root;
    for (const id of ids.slice(1)) {
      const next = this.layout.children(n).find((c) => c.id === id);
      if (!next) return null;
      n = next;
    }
    this.flyTo(n);
    return n;
  }

  setOverlay(el: HTMLElement | null): void {
    this.overlayEl = el;
    this.lastOverlay = 0;
    this.requestFrame();
  }

  setDebug(on: boolean): void {
    this.debug = on;
    this.requestFrame();
  }

  requestFrame(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  /** Animate between linear (0) and log (1) widths. */
  setMode(target: number): void {
    this.modeTarget = target;
    this.modeAnim = { from: this.layout.mix, to: target, t0: performance.now(), dur: 700, pivot: this.scene.top ?? this.cam.anchor };
    this.requestFrame();
  }

  resetView(): void {
    this.flyTo(this.layout.root);
  }

  /** Double-tap: fit the smallest clade under the point that is at least 24 px on both axes. */
  fitAt(x: number, y: number): void {
    const L = this.layout;
    let n = this.cam.anchor;
    const f = copyFrame(frame(), this.cam.f);
    const inside = (g: Frame) => x >= g.ox && x <= g.ox + g.kx && y <= g.oy && y >= g.oy - g.kt;
    while (n.parent && !inside(f)) {
      toParent(f, f, L.x0(n), L.xs(n), n.t0, n.ts);
      n = n.parent;
    }
    const fc = frame();
    for (;;) {
      let next: LNode | null = null;
      for (const c of L.children(n)) {
        toChild(fc, f, L.x0(c), L.xs(c), c.t0, c.ts);
        if (inside(fc) && fc.kx >= 24 && fc.kt >= 24) {
          next = c;
          break;
        }
      }
      if (!next) break;
      toChild(f, f, L.x0(next), L.xs(next), next.t0, next.ts);
      n = next;
    }
    // Already fitted? Then go up one level.
    const fit = this.cam.fitFrame();
    if (n.parent && Math.abs(Math.log(f.kx / fit.kx)) < 0.1 && Math.abs(Math.log(f.kt / fit.kt)) < 0.1) n = n.parent;
    this.flyTo(n);
  }

  flyTo(node: LNode): void {
    const f0 = this.cam.frameOf(node);
    const f1 = this.cam.fitFrame();
    const zoom = Math.abs(Math.log10(f1.kx / f0.kx)) + Math.abs(Math.log10(f1.kt / f0.kt));
    const dur = Math.min(1400, 380 + 160 * zoom);
    this.inertia = null;
    this.flight = { node, f0: { ...f0 }, f1, t0: performance.now(), dur };
    this.requestFrame();
  }

  private stepFlight(now: number): boolean {
    const fl = this.flight!;
    const u = Math.min(1, (now - fl.t0) / fl.dur);
    const s = ease(u);
    const { W, H } = this.cam;
    const axis = (o0: number, k0: number, o1: number, k1: number, half: number, sign: number) => {
      // Interpolate log-scale linearly; move the centre so the target converges smoothly.
      const k = Math.exp(Math.log(k0) + (Math.log(k1) - Math.log(k0)) * s);
      const c0 = (sign * (half - o0)) / k0;
      const c1 = (sign * (half - o1)) / k1;
      const w = Math.abs(1 / k0 - 1 / k1) > 1e-12 * (1 / k0) ? (1 / k0 - 1 / k) / (1 / k0 - 1 / k1) : s;
      const c = c0 + (c1 - c0) * w;
      return { o: half - sign * k * c, k };
    };
    const ax = axis(fl.f0.ox, fl.f0.kx, fl.f1.ox, fl.f1.kx, W / 2, 1);
    const at = axis(fl.f0.oy, fl.f0.kt, fl.f1.oy, fl.f1.kt, H / 2, -1);
    this.cam.setFrameIn(fl.node, { ox: ax.o, kx: ax.k, oy: at.o, kt: at.k });
    if (u >= 1) this.flight = null;
    return u < 1;
  }

  private stepMode(now: number): boolean {
    const m = this.modeAnim!;
    const u = Math.min(1, (now - m.t0) / m.dur);
    const mix = m.from + (m.to - m.from) * ease(u);
    // Keep the pivot (the node covering the view) fixed on screen while shares change.
    const pf = { ...this.cam.frameOf(m.pivot) };
    this.layout.setMix(mix);
    this.cam.setFrameIn(m.pivot, pf);
    if (u >= 1) this.modeAnim = null;
    return u < 1;
  }

  private stepInertia(dt: number): boolean {
    const v = this.inertia!;
    this.cam.pan(v.vx * dt, v.vy * dt);
    v.px += v.vx * dt;
    v.py += v.vy * dt;
    if (v.vz !== 0) {
      const z = Math.exp(v.vz * dt);
      this.cam.zoomAt(v.px, v.py, z, z);
    }
    const decay = Math.exp(-dt / 325);
    v.vx *= decay;
    v.vy *= decay;
    v.vz *= decay;
    if (Math.hypot(v.vx, v.vy) < 0.01 && Math.abs(v.vz) < 0.00003) {
      this.inertia = null;
      return false;
    }
    return true;
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const t0 = performance.now();
    const dt = this.lastNow ? Math.min(50, Math.max(0, now - this.lastNow)) : 16;
    const wasContinuous = this.continuous;
    const interval = now - this.lastNow;
    this.lastNow = now;

    let animating = false;
    if (this.modeAnim) animating = this.stepMode(now) || animating;
    if (this.flight) animating = this.stepFlight(now) || animating;
    if (this.inertia) animating = this.stepInertia(dt) || animating;
    if (this.dive) {
      const d = this.dive;
      d.driver.step();
      if (d.driver.levels >= d.until || d.driver.done) {
        this.dive = null;
        d.resolve();
      } else animating = true;
    }
    const interacting = this.input.active || animating;

    // Size: cap DPR, and drop resolution during slow gestures.
    const cw = Math.max(1, this.canvas.clientWidth);
    const ch = Math.max(1, this.canvas.clientHeight);
    if (cw !== this.cssW || ch !== this.cssH) {
      this.cssW = cw;
      this.cssH = ch;
      this.cam.setViewport(cw, ch);
    }
    const slow = this.interval.count > 20 && this.interval.summary().p95 > 20;
    this.resScale = interacting && slow ? this.opts.gestureScale : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.dprCap) * this.resScale;
    const fbW = Math.max(1, Math.round(cw * dpr));
    const fbH = Math.max(1, Math.round(ch * dpr));
    if (this.canvas.width !== fbW || this.canvas.height !== fbH) {
      this.canvas.width = fbW;
      this.canvas.height = fbH;
    }
    this.pxScale = fbW / cw;

    this.cam.normalize();
    this.scene.build(this.cam);
    this.renderer.render(this.scene, this.pxScale, this.debug ? this.buildDebug() : null);
    if (this.labels && this.text && this.textBatch) {
      this.labels.build(this.scene, this.cam, this.textBatch, !!this.opts.formatAge);
      this.text.draw(this.textBatch, cw, ch);
    }
    if (this.syncGpu) this.renderer.gl.finish();
    this.frameNo++;
    if (this.frameNo % 120 === 0) this.layout.prune(this.cam.anchor);

    const cpu = performance.now() - t0;
    this.cpu.push(cpu);
    if (wasContinuous) {
      this.interval.push(interval);
      this.adaptLod();
    }
    if (this.recording)
      this.recording.push({ t: now, interval: wasContinuous ? interval : NaN, cpu, instances: this.scene.stats.instances, depth: this.cam.anchor.depth });
    if (this.overlayEl && now - this.lastOverlay > 250) {
      this.lastOverlay = now;
      this.updateOverlay();
    }
    this.continuous = interacting;
    if (interacting) this.requestFrame();
    else if (this.overlayEl) {
      // One more overlay refresh after settling.
      this.updateOverlay();
    }
  };

  /** OneZoom-style adaptive detail: raise the LOD threshold when frames are slow. */
  private adaptLod(): void {
    if (this.interval.count < 30 || this.frameNo % 30 !== 0) return;
    const { p95 } = this.interval.summary();
    const s = this.scene;
    if (p95 > 22) s.minPx = Math.min(6, s.minPx * 1.3);
    else if (p95 < 15) s.minPx = Math.max(1.5, s.minPx / 1.15);
  }

  private buildDebug(): { data: Float32Array; count: number } {
    const b = this.debugBuf;
    const need = this.scene.draws.length * INST_FLOATS;
    if (b.data.length < need) b.data = new Float32Array(need * 2);
    let n = 0;
    const W = this.cam.W;
    const H = this.cam.H;
    const cl = (v: number, hi: number) => Math.min(hi + 4, Math.max(-4, v));
    for (const d of this.scene.draws) {
      const f = d.f;
      const x0 = cl(f.ox, W);
      const x1 = cl(f.ox + f.kx, W);
      const yb = cl(f.oy, H);
      const yt = cl(f.oy - f.kt, H);
      const o = n * INST_FLOATS;
      b.data.set([x0, x1, x0, x1, x0, x0, yb, yt, 0, 2, x1, x1], o);
      n++;
    }
    b.count = n;
    return b;
  }

  /** Snapshot for the debug overlay and test harness. */
  info() {
    const ex = this.cam.scaleExponents();
    const a = this.cam.anchor;
    return {
      anchorId: a.id,
      anchorDepth: a.depth,
      topDepth: this.scene.stats.topDepth,
      xExp: ex.x,
      tExp: ex.t,
      interval: this.interval.summary(),
      cpu: this.cpu.summary(),
      instances: this.scene.stats.instances,
      draws: this.scene.stats.draws,
      chunks: this.scene.stats.chunksResident,
      nodes: this.layout.nodesCreated,
      minPx: this.scene.minPx,
      resScale: this.resScale,
      fb: [this.canvas.width, this.canvas.height],
      mix: this.layout.mix,
    };
  }

  private updateOverlay(): void {
    const el = this.overlayEl;
    if (!el) return;
    const i = this.info();
    const f = (v: number) => v.toFixed(1);
    el.textContent =
      `anchor ${i.anchorId}\n` +
      `depth ${i.anchorDepth}  (top ${i.topDepth})\n` +
      `zoom x 10^${i.xExp.toFixed(1)}  t 10^${i.tExp.toFixed(1)}\n` +
      `frame ${f(i.interval.avg)} / p95 ${f(i.interval.p95)} ms\n` +
      `cpu   ${f(i.cpu.avg)} / p95 ${f(i.cpu.p95)} ms\n` +
      `inst ${i.instances}  draws ${i.draws}  chunks ${i.chunks}\n` +
      `fb ${i.fb[0]}x${i.fb[1]} @${i.resScale}  lod ${i.minPx.toFixed(2)}px  ${i.mix < 0.5 ? 'linear' : 'log'}`;
  }

  // ---- test / perf hooks -------------------------------------------------

  /** Animate a dive along a random chain until `levels` more levels are reached. */
  diveAnimated(levels: number, seed = 1, preferAlive = true): Promise<void> {
    this.flight = null;
    this.inertia = null;
    return new Promise((resolve) => {
      const driver = new DiveDriver(this.cam, this.layout, seed);
      driver.preferAlive = preferAlive;
      this.dive = { driver, until: levels, resolve };
      this.requestFrame();
    });
  }

  /** Dive without rendering (fast): jump `levels` deeper. */
  diveInstant(levels: number, seed = 1, preferAlive = true): void {
    const driver = new DiveDriver(this.cam, this.layout, seed);
    driver.preferAlive = preferAlive;
    let steps = 0;
    while (driver.levels < levels && !driver.done) {
      driver.step();
      if (++steps % 500 === 0) this.layout.prune(this.cam.anchor);
    }
    this.requestFrame();
  }

  startRecording(): void {
    this.recording = [];
  }

  stopRecording(): FrameRecord[] {
    const r = this.recording ?? [];
    this.recording = null;
    return r;
  }

  static summarize = summarize;
}
