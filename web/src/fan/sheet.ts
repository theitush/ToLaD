// The card as a bottom sheet (ToLaD#509): capped at its share of the screen (view.CARD_SHARE; its content scrolls inside
// it under a head that stays, its × in it), and closed by one move from any state: the ×, the browser's back (a phone's
// back gesture), a swipe down, or a tap on the tree. The swipe is the bottom sheet's established one: the sheet follows the
// finger down from its head, or from its content once that is scrolled to its top, and closes when let go past a share of
// its height or flicked; short of that it springs back.

import { useEffect, useRef } from 'react';
import { TAP_SLOP_PX } from './cardtap';

/** Let go further down than this share of its height, the sheet closes (the bottom sheet's usual quarter). */
export const SWIPE_CLOSE_SHARE = 0.25;
/** Or flicked down faster than this (px/ms) as it is let go. */
export const SWIPE_FLICK = 0.5;

export type SheetPointer = { id: number; x: number; y: number; t: number };

/**
 * A swipe down on the sheet: `down` where a pointer goes down, `top` whether a pull down there moves the sheet (its head,
 * or its content scrolled to its top); `move` the sheet's offset down while it follows the finger (null, not following:
 * a scroll, a sideways drag, a tap); `up` whether it closes. Following starts once the finger has gone TAP_SLOP_PX further
 * down than sideways, so a tap stays a tap.
 */
export function sheetSwipe() {
  let at: (SheetPointer & { top: boolean }) | null = null;
  let on = false;
  let prev: SheetPointer | null = null;
  let last: SheetPointer | null = null;
  return {
    down(p: SheetPointer, top: boolean): void {
      // (A second finger: a pinch, not a swipe.)
      if (at) {
        at = null;
        on = false;
        return;
      }
      at = { ...p, top };
      on = false;
      prev = last = p;
    },
    move(p: SheetPointer): number | null {
      if (!at || p.id !== at.id) return null;
      const dy = p.y - at.y;
      if (!on && at.top && dy > TAP_SLOP_PX && dy > Math.abs(p.x - at.x)) on = true;
      if (!on) return null;
      prev = last;
      last = p;
      return Math.max(0, dy);
    },
    up(p: SheetPointer, height: number): boolean {
      if (!at || p.id !== at.id) return false;
      const was = on;
      const dy = p.y - at.y;
      const from = prev && prev !== last ? prev : at;
      const v = p.t > from.t ? (p.y - from.y) / (p.t - from.t) : 0;
      at = null;
      on = false;
      return was && (dy > SWIPE_CLOSE_SHARE * height || (dy > TAP_SLOP_PX && v > SWIPE_FLICK));
    },
    cancel(): void {
      at = null;
      on = false;
    },
    get following(): boolean {
      return on;
    },
  };
}

/** The history entry an open card adds (its state), so its close knows whether back is its to take. */
const ENTRY = 'tolad:card';

function ours(): boolean {
  try {
    return !!(window.history.state as Record<string, unknown> | null)?.[ENTRY];
  } catch {
    return false;
  }
}

/**
 * While a card is `open`, back closes it: opening adds one history entry at the same address (so back.ts, which keeps the
 * page by its address, is untouched), which back takes off, calling `close`. A card closed any other way (the ×, a swipe,
 * the tree) takes its entry off itself, so back after it leaves the page as before. A species tapped while one is open
 * keeps the one entry. The picture alone (Alone.tsx) stacks its own entry over it.
 */
export function useBackCloses(open: boolean, close: () => void): void {
  const shut = useRef(close);
  shut.current = close;
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    try {
      if (!ours()) window.history.pushState({ [ENTRY]: true }, '');
    } catch {
      /* no history: back is not ours */
    }
    const onPop = () => {
      if (!ours()) shut.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (ours()) window.history.back();
    };
  }, [open]);
}
