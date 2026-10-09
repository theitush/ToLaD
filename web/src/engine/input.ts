// Pointer Events gestures: one-finger/mouse pan, two-finger pinch (zooms both
// axes about the centroid), wheel zoom, double-tap, and fling velocity in
// log-zoom space. No camera state lives here; it only reports deltas.

export interface InputHandlers {
  gestureStart(): void;
  gestureEnd(): void;
  pan(dx: number, dy: number): void;
  zoom(px: number, py: number, fx: number, ft: number): void;
  /** Release velocity: px/ms for pan, log-zoom/ms for zoom, about (px, py). */
  fling(vx: number, vy: number, vz: number, px: number, py: number): void;
  doubleTap(x: number, y: number): void;
}

interface Sample {
  t: number;
  dx: number;
  dy: number;
  dz: number;
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

  constructor(
    readonly el: HTMLElement,
    readonly h: InputHandlers,
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
      this.sample(e.timeStamp, dx, dy, 0, p.x, p.y);
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
    if (s !== 1) this.h.zoom(c1x, c1y, s, s);
    this.sample(e.timeStamp, dx, dy, Math.log(s), c1x, c1y);
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
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
    }
    // Fling from the last ~80 ms of movement, if the pointer was still moving.
    const now = e.timeStamp;
    const recent = this.samples.filter((s) => now - s.t < 80);
    if (recent.length >= 2 && now - recent[recent.length - 1].t < 40) {
      const span = Math.max(16, now - recent[0].t);
      let dx = 0;
      let dy = 0;
      let dz = 0;
      for (const s of recent) {
        dx += s.dx;
        dy += s.dy;
        dz += s.dz;
      }
      const last = recent[recent.length - 1];
      this.h.gestureEnd();
      this.h.fling(dx / span, dy / span, dz / span, last.px, last.py);
      return;
    }
    this.h.gestureEnd();
  };

  private sample(t: number, dx: number, dy: number, dz: number, px: number, py: number): void {
    this.samples.push({ t, dx, dy, dz, px, py });
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
