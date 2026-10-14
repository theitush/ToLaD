import { DOUBLE_TAP_MS } from '../engine/input';

/**
 * A double tap on a card (ToLaD#301, #241): what a double tap does on the tree, one level up, the card closed. Two taps
 * on the card itself (its text, its blank), each within TAP_SLOP_PX of where it went down and not a hold, the second
 * within DOUBLE_TAP_MS and 40 px of the first. A tap on one of the card's controls (CARD_CONTROLS) is the control's and
 * counts for neither; nor a drag (the card scrolled, the globe turned) or a cancelled touch.
 */
export const CARD_CONTROLS = 'a, button, summary, input, select, textarea, label, img, canvas, [role="button"]';
/** A touch moved further than this between down and up: a drag, not a tap. */
export const TAP_SLOP_PX = 10;
/** A touch held longer than this: not a tap. */
export const TAP_HOLD_MS = 500;

export type CardPointer = { id: number; x: number; y: number; t: number; ctl: boolean };

/** The card's double-tap state: `down`/`up`/`cancel` from its pointer events; `onUp` on a double tap, with where. */
export function cardTapper(onUp: (x: number, y: number) => void) {
  let downAt: CardPointer | null = null;
  let last: CardPointer | null = null;
  return {
    down(p: CardPointer): void {
      // (A second finger while the first is down: a pinch, not a tap. A first whose up never came, as one lifted off the
      // card, is let go.)
      if (downAt && p.t - downAt.t <= TAP_HOLD_MS) {
        downAt = null;
        last = null;
      } else downAt = p;
    },
    up(p: CardPointer): void {
      const d = downAt;
      downAt = null;
      if (!d || d.id !== p.id) return;
      const tap = !d.ctl && !p.ctl && Math.hypot(p.x - d.x, p.y - d.y) <= TAP_SLOP_PX && p.t - d.t <= TAP_HOLD_MS;
      if (!tap) {
        last = null;
        return;
      }
      if (last && p.t - last.t < DOUBLE_TAP_MS && Math.hypot(p.x - last.x, p.y - last.y) < 40) {
        last = null;
        onUp(p.x, p.y);
        return;
      }
      last = p;
    },
    cancel(): void {
      downAt = null;
      last = null;
    },
  };
}

/** Whether a DOM target is (inside) one of the card's controls. */
export function onControl(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el && typeof el.closest === 'function' && !!el.closest(CARD_CONTROLS);
}
