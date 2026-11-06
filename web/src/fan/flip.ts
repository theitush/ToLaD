// The tree on its side (ToLaD#452; the page since ToLaD#455, `?flip=0` the old one): on a phone held upright the branches stack down the tall side and time
// runs across, "now" on the right. The view keeps its own coordinates, a screen whose `w` is the phone's height and `h`
// its width; only its canvases are turned, a quarter turn clockwise (today's top goes right, today's left goes top), and
// the input turned back, so the camera, the cover, the frames and the tap rules do not know.

let flipNow = typeof location !== 'undefined' && new URLSearchParams(location.search).get('flip') !== '0';
export const flipOn = (): boolean => flipNow;
/** (Tests.) */
export function setFlip(on: boolean): void {
  flipNow = on;
}

/** Room kept under the buttons for the chain of groups (the next task, `chain`): one row of text. */
export const CHAIN_ROOM = 30;
/**
 * The chain of groups as it fits the width, outermost name first (ToLaD#452): the outer ones go first, whole, a "…" leading
 * where any went; the innermost always stays whole.
 */
export function chainFit(names: string[], fits: (parts: string[]) => boolean): string[] {
  for (let i = 0; i < names.length - 1; i++) {
    const parts = i ? ['…', ...names.slice(i)] : names;
    if (fits(parts)) return parts;
  }
  return names.slice(-1);
}

/** Where "now" stands: this far from the phone's right edge. */
export const NOW_PX = 14;
/** Where a whole clade's fork stands: this far from the phone's left edge. */
export const FORK_PX = 28;
/** The time axis's band along the phone's foot, past the view's `w`, so frames and labels stand above it: its period strip and a row of ticks. */
export const AXIS_ROOM = 38;
/** The labels' line (Ita: "at 100k years ago fixed"), in Ma. */
export const LABELS_MA = 0.1;

/** A point on the turned canvas, measured from its box's corner on the phone, in the view's coordinates. `W`: the box's width on the phone (the view's h). */
export const toView = (px: number, py: number, W: number): [number, number] => [py, W - px];
/** A view point on the phone, measured from the canvas's box's corner. */
export const toPhone = (x: number, y: number, W: number): [number, number] => [W - y, x];

/** Set a canvas to fill the phone's box under `top`, `w` tall on the phone and `W` wide, drawn turned. */
export function turnCanvas(c: HTMLCanvasElement, W: number, top: number, w: number): void {
  const s = c.style;
  if (!s) return;
  s.left = '0';
  s.top = `${top}px`;
  s.right = 'auto';
  s.bottom = 'auto';
  s.width = `${w}px`;
  s.height = `${W}px`;
  s.transformOrigin = '0 0';
  s.transform = `translateX(${W}px) rotate(90deg)`;
}

/** Draw in the phone's upright coordinates (x across, y down, from the box's corner) from here on, on the view's turned canvas. */
export function upright(ctx: CanvasRenderingContext2D, W: number): void {
  ctx.translate(0, W);
  ctx.rotate(-Math.PI / 2);
}
