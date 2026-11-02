/** A picture's disc (ToLaD#333): one size, PIC_D, standing PIC_LIFT over its item's youngest tip (view.ts cutLabels). */

/** A disc's place: centre (x, y), diameter d, and `i`, its index among the frame's pictures. */
export interface PicSpot {
  x: number;
  y: number;
  d: number;
  i: number;
}

/** A picture's diameter (px), the same at every zoom. */
export const PIC_D = 50;
/** The discs stand this many px above their tip. */
export const PIC_LIFT = 2;
