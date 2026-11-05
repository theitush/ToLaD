/**
 * A picture's disc (ToLaD#333, #400): one size on screen, PIC_D, its foot PIC_LIFT over its item's youngest tip. Frames
 * and taps never ask its size: they go by PIC_ROOM, the room a label's cut reserves for it (view.ts cutLabels).
 */

/** A disc's place: centre (x, y), and `i`, its index among the frame's pictures. */
export interface PicSpot {
  x: number;
  y: number;
  i: number;
}

/** A picture's diameter (px), every picture's, the same at every zoom. */
export const PIC_D = 36;
/** The room (px, wide and tall) a cut reserves for a label's picture: what frames, taps and "does this level's label fit" go by. */
export const PIC_ROOM = 50;
/** The discs stand this many px above their tip: the gap a "+x" label's hairline runs in, above "now" (ToLaD#368, #373). */
export const PIC_LIFT = 14;

/** The box a disc takes on screen [x0, y0, x1, y1]. */
export function picBox(p: { x: number; y: number }): number[] {
  return [p.x - PIC_D / 2, p.y - PIC_D / 2, p.x + PIC_D / 2, p.y + PIC_D / 2];
}
