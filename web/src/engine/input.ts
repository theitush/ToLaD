// Pointer Events gestures: one-finger/mouse pan, two-finger pinch (zooms about
// the centroid: both axes by the finger distance, or each axis by its own
// spread, see `axisPinch`), wheel zoom (shift: x only, alt: y only),
// double-tap, and fling velocity in log-zoom space. No camera state lives
// here; it only reports deltas.

/** Per-axis pinch dead zone: an axis's spread must change this many px from the pinch's start ... */
export const PINCH_DEAD_PX = 12;
/** ... and by at least this fraction of the furthest the other axis's spread has moved, to zoom that axis. */
export const PINCH_AXIS_RATIO = 0.5;
/** Spreads below this (px) count as this much, so fingers nearly in line along an axis cannot blow up its zoom. */
export const PINCH_MIN_SPREAD = 40;

export interface InputHandlers {
  gestureStart(): void;
  gestureEnd(): void;
  pan(dx: number, dy: number): void;
  zoom(px: number, py: number, fx: number, ft: number): void;
  /**
   * Release velocity: px/ms for pan, log-zoom/ms for zoom, about (px, py).
   * With per-axis pinch, vz is the x (width) zoom and vt the y (time) zoom.
   */
  fling(vx: number, vy: number, vz: number, px: number, py: number, vt?: number): void;
  doubleTap(x: number, y: number): void;
  /** Optional: a single tap (also fires before the second tap of a double-tap). */
  tap?(x: number, y: number): void;
}

interface Sample {
  t: number;
  dx: number;
  dy: number;
  dz: number;
  dt: number;
  px: number;
  py: number;
}

export class Input {
  readonly pointers = new Map<number, { x: number; y: number }>();
  private samples: Sample[] = [];
  private downAt = 0;
  private moved = 0;
  private maxPointers = 0;
  private lastTap = { t: -1e9, x: 0, y: 0 };
  private wheelTimer = 0;
  private wheeling = false;
  /**
   * The two-finger pinch in progress (per-axis mode): its finger pair, the
   * horizontal and vertical spreads (px) when it began, the furthest each has
   * moved since, and which axes it zooms (once on, an axis stays on until the
   * fingers change).
   */
  private pinch: { a: number; b: number; x0: number; y0: number; peakX: number; peakY: number; onX: boolean; onY: boolean } | null = null;

  constructor(
    readonly el: HTMLElement,
    readonly h: InputHandlers,
    /**
     * Per-axis pinch: the fingers' horizontal spread zooms x, their vertical
     * spread zooms y (a sideways pinch zooms width only, an upright one time only,
     * a diagonal one both). Off: the pinch distance zooms both axes.
     */
    readonly axisPinch = false,
  ) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    // Safari's proprietary pinch events would otherwise zoom the page.
    el.addEventListener('gesturestart', prevent as EventListener);
    el.addEventListener('gesturechange', prevent as EventListener);
    el.addEventListener('contextmenu', prevent as EventListener);
  }

  get active(): boolean {
    return this.pointers.size > 0 || this.wheeling;
  }

  destroy(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('gesturestart', prevent as EventListener);
    el.removeEventListener('gesturechange', prevent as EventListener);
    el.removeEventListener('contextmenu', prevent as EventListener);
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    if (this.pointers.size === 0) {
      this.downAt = e.timeStamp;
      this.moved = 0;
      this.maxPointers = 0;
      this.samples.length = 0;
      this.h.gestureStart();
    }
    this.pointers.set(e.pointerId, this.local(e));
    this.pinch = null;
    this.maxPointers = Math.max(this.maxPointers, this.pointers.size);
  };

  private onMove = (e: PointerEvent): void => {
    const old = this.pointers.get(e.pointerId);
    if (!old) return;
    e.preventDefault();
    const p = this.local(e);
    const ids = [...this.pointers.keys()];
    if (ids.length === 1) {
      const dx = p.x - old.x;
      const dy = p.y - old.y;
      this.pointers.set(e.pointerId, p);
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.h.pan(dx, dy);
      this.sample(e.timeStamp, dx, dy, 0, 0, p.x, p.y);
      return;
    }
    const [a, b] = ids;
    if (e.pointerId !== a && e.pointerId !== b) {
      this.pointers.set(e.pointerId, p);
      return;
    }
    const pa0 = this.pointers.get(a)!;
    const pb0 = this.pointers.get(b)!;
    this.pointers.set(e.pointerId, p);
    const pa1 = this.pointers.get(a)!;
    const pb1 = this.pointers.get(b)!;
    const c0x = (pa0.x + pb0.x) / 2;
    const c0y = (pa0.y + pb0.y) / 2;
    const c1x = (pa1.x + pb1.x) / 2;
    const c1y = (pa1.y + pb1.y) / 2;
    const d0 = Math.hypot(pa0.x - pb0.x, pa0.y - pb0.y);
    const d1 = Math.hypot(pa1.x - pb1.x, pa1.y - pb1.y);
    const s = d0 > 4 && d1 > 4 ? d1 / d0 : 1;
    const dx = c1x - c0x;
    const dy = c1y - c0y;
    this.moved += Math.abs(dx) + Math.abs(dy) + Math.abs(d1 - d0);
    this.h.pan(dx, dy);
    if (this.axisPinch) {
      const [fx, ft] = this.axisZoom(a, b, pa0, pb0, pa1, pb1);
      if (fx !== 1 || ft !== 1) this.h.zoom(c1x, c1y, fx, ft);
      this.sample(e.timeStamp, dx, dy, Math.log(fx), Math.log(ft), c1x, c1y);
      return;
    }
    if (s !== 1) this.h.zoom(c1x, c1y, s, s);
    this.sample(e.timeStamp, dx, dy, Math.log(s), Math.log(s), c1x, c1y);
  };

  /**
   * Per-axis pinch: the fingers' horizontal spread zooms x and their vertical
   * spread zooms y, each by its own ratio. Dead zone: an axis zooms only once
   * its spread has moved PINCH_DEAD_PX from where the pinch began and at least
   * PINCH_AXIS_RATIO of the furthest the other spread has moved (and nothing
   * turns on before one spread has moved twice the dead zone), so a mostly
   * sideways pinch zooms x alone (its fingers' vertical jitter is ignored) and
   * a mostly upright one y alone; a diagonal one turns both on. The movement
   * before an axis turns on is dropped, so turning on never jumps.
   */
  private axisZoom(
    a: number,
    b: number,
    pa0: { x: number; y: number },
    pb0: { x: number; y: number },
    pa1: { x: number; y: number },
    pb1: { x: number; y: number },
  ): [number, number] {
    const ux0 = Math.abs(pa0.x - pb0.x);
    const uy0 = Math.abs(pa0.y - pb0.y);
    const ux1 = Math.abs(pa1.x - pb1.x);
    const uy1 = Math.abs(pa1.y - pb1.y);
    let g = this.pinch;
    if (!g || g.a !== a || g.b !== b) g = this.pinch = { a, b, x0: ux0, y0: uy0, peakX: 0, peakY: 0, onX: false, onY: false };
    const mx = Math.abs(ux1 - g.x0);
    const my = Math.abs(uy1 - g.y0);
    g.peakX = Math.max(g.peakX, mx);
    g.peakY = Math.max(g.peakY, my);
    const wasX = g.onX;
    const wasY = g.onY;
    // Nothing is decided until one spread has clearly moved, so early jitter cannot pick an axis.
    if (Math.max(g.peakX, g.peakY) >= 2 * PINCH_DEAD_PX) {
      g.onX ||= mx > PINCH_DEAD_PX && mx >= PINCH_AXIS_RATIO * g.peakY;
      g.onY ||= my > PINCH_DEAD_PX && my >= PINCH_AXIS_RATIO * g.peakX;
    }
    const m = PINCH_MIN_SPREAD;
    const fx = wasX ? Math.max(ux1, m) / Math.max(ux0, m) : 1;
    const ft = wasY ? Math.max(uy1, m) / Math.max(uy0, m) : 1;
    return [fx, ft];
  }

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    if (this.pointers.size > 0) {
      // Lifting one finger of a pinch: drop zoom samples so the fling is a pan.
      this.samples.length = 0;
      return;
    }
    const isTap = this.maxPointers === 1 && this.moved < 12 && e.timeStamp - this.downAt < 300;
    if (isTap) {
      const lt = this.lastTap;
      if (e.timeStamp - lt.t < 320 && Math.hypot(p.x - lt.x, p.y - lt.y) < 40) {
        this.lastTap.t = -1e9;
        this.h.gestureEnd();
        this.h.doubleTap(p.x, p.y);
        return;
      }
      this.lastTap = { t: e.timeStamp, x: p.x, y: p.y };
      this.h.tap?.(p.x, p.y);
    }
    // Fling from the last ~80 ms of movement, if the pointer was still moving.
    const now = e.timeStamp;
    const recent = this.samples.filter((s) => now - s.t < 80);
    if (recent.length >= 2 && now - recent[recent.length - 1].t < 40) {
      const span = Math.max(16, now - recent[0].t);
      let dx = 0;
      let dy = 0;
      let dz = 0;
      let dt = 0;
      for (const s of recent) {
        dx += s.dx;
        dy += s.dy;
        dz += s.dz;
        dt += s.dt;
      }
      const last = recent[recent.length - 1];
      this.h.gestureEnd();
      this.h.fling(dx / span, dy / span, dz / span, last.px, last.py, dt / span);
      return;
    }
    this.h.gestureEnd();
  };

  private sample(t: number, dx: number, dy: number, dz: number, dt: number, px: number, py: number): void {
    this.samples.push({ t, dx, dy, dz, dt, px, py });
    if (this.samples.length > 32) this.samples.shift();
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    let d = e.deltaY || e.deltaX;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= this.el.clientHeight;
    // ctrl+wheel is a trackpad pinch on desktop browsers.
    const z = Math.exp(-d * (e.ctrlKey ? 0.01 : 0.002));
    const fx = e.altKey ? 1 : z; // alt: time axis only
    const ft = e.shiftKey ? 1 : z; // shift: width axis only
    if (!this.wheeling) {
      this.wheeling = true;
      this.h.gestureStart();
    }
    this.h.zoom(p.x, p.y, fx, ft);
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      this.wheeling = false;
      this.h.gestureEnd();
    }, 140);
  };
}

function prevent(e: Event): void {
  e.preventDefault();
}
