/**
 * A picture's disc (ToLaD#333, #400): one size on screen, PIC_D, its foot PIC_LIFT over its item's youngest tip. Frames
 * and taps never ask its size: they go by PIC_ROOM, the room a label's cut reserves for it (view.ts cutLabels).
 */

/** A disc's place: centre (x, y), and `i`, its index among the frame's pictures. */
export interface PicSpot {
  x: number;
  y: number;
  i: number;
  /** Its diameter (px) when not PIC_D: a small picture's, PIC_S (ToLaD#464). */
  d?: number;
}

/** A picture's diameter (px), every picture's, the same at every zoom. */
export const PIC_D = 36;
/** A small picture's diameter (px, ToLaD#464, Ita: "put lil pics on the ones that dont fit"): the one other size, for whoever has no room for a full one. */
export const PIC_S = 22;
/** The room (px, wide and tall) a cut reserves for a label's picture: what frames, taps and "does this level's label fit" go by. */
export const PIC_ROOM = 50;
/** Right edge (px) of the time axis's labels: species' labels keep right of it, a frame fills from here to the screen's edge. */
export const LABEL_AXIS_X = 72;
/** The discs stand this many px above their tip: the gap a "+x" label's hairline runs in, above "now" (ToLaD#368, #373). */
export const PIC_LIFT = 14;

/** The box a disc takes on screen [x0, y0, x1, y1]. */
export function picBox(p: { x: number; y: number; d?: number }): number[] {
  const r = (p.d ?? PIC_D) / 2;
  return [p.x - r, p.y - r, p.x + r, p.y + r];
}

/**
 * What the labels name (ToLaD#417; always `groups` in the app, no switch, ToLaD#439): `cut`, an item of the cut with its "+x"; `groups`, the real groups one
 * level down from what the screen holds, each on its own branch. A look only: frames and taps' targets do not change.
 */
export type LabelMode = 'cut' | 'groups';
let labelNow: LabelMode = 'groups';
export const labelMode = (): LabelMode => labelNow;
export function setLabelMode(m: LabelMode): void {
  labelNow = m;
}
/** Group labels' centres stand at least this far apart: a picture and the gap a pill keeps over its picture. (Their pills are narrower.) */
export const GROUP_D = PIC_D + 4;
