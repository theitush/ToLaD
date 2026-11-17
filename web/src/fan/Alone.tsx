// The card's picture, range map or globe alone, full screen (ToLaD#506). A tap on one in the card opens it here, as big as
// the screen allows on a plain dark backdrop: no card, no tree, no top bar. A tap closes it, and so does the browser's back
// (a phone's back gesture): opening it adds one history entry at the same address, which back takes off, so back never
// leaves the species or the page (back.ts keeps the page by its address, which this leaves alone). The card under it is
// not touched, so it comes back as it was: same scroll, same species, the tree unmoved. A drag (the globe turned) is not
// a tap, and nor is a tap on the credit, a link that stays at the bottom.

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TAP_HOLD_MS, TAP_SLOP_PX } from './cardtap';

/** The history entry an open view adds (its state), so a close knows whether back is its to take. */
const ENTRY = 'tolad:alone';

/**
 * Whether one is open, and the opener and closer. Open adds the history entry; back (the entry taken off) closes it;
 * a close of its own goes back, so the entry goes with it. Without history (tests, a sandbox refusing it), it simply
 * opens and closes.
 */
export function useAlone(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onPop = () => setOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open]);
  const show = () => {
    try {
      window.history.pushState({ [ENTRY]: true }, '');
    } catch {
      /* no history: back is not ours */
    }
    setOpen(true);
  };
  const close = () => {
    let ours = false;
    try {
      ours = !!(window.history.state as Record<string, unknown> | null)?.[ENTRY];
    } catch {
      /* no history */
    }
    if (ours) window.history.back();
    else setOpen(false);
  };
  return [open, show, close];
}

export type AlonePointer = { id: number; x: number; y: number; t: number; link: boolean };

/**
 * A tap on the view: down and up of one pointer, never further than TAP_SLOP_PX from where it went down (a drag
 * turning the globe is not one), not a hold, not on the credit's link, and no second finger meanwhile.
 */
export function aloneTapper(onTap: () => void) {
  let downAt: AlonePointer | null = null;
  let far = false;
  return {
    down(p: AlonePointer): void {
      // (A second finger while the first is down: a pinch, not a tap. A first whose up never came is let go.)
      far = !!downAt && p.t - downAt.t <= TAP_HOLD_MS;
      downAt = far ? null : p;
    },
    move(p: AlonePointer): void {
      if (downAt && downAt.id === p.id && Math.hypot(p.x - downAt.x, p.y - downAt.y) > TAP_SLOP_PX) far = true;
    },
    up(p: AlonePointer): void {
      const d = downAt;
      downAt = null;
      if (!d || d.id !== p.id || far || d.link || p.link) return;
      if (Math.hypot(p.x - d.x, p.y - d.y) <= TAP_SLOP_PX && p.t - d.t <= TAP_HOLD_MS) onTap();
    },
    cancel(): void {
      downAt = null;
    },
  };
}

/** The full-screen view itself: `children` (the picture, map or globe) filling the screen, `credit` small under it. */
export function AloneView({ credit, onClose, children }: { credit: ReactNode; onClose: () => void; children: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  const tapper = useRef<ReturnType<typeof aloneTapper> | null>(null);
  tapper.current ??= aloneTapper(() => close.current());
  const pt = (e: RPointerEvent) => {
    const el = e.target as Element | null;
    return { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, link: !!el?.closest?.('a') };
  };
  // (Its pointer events stop here: React carries a portal's events up to the card, whose double tap they are not.)
  return (
    <div
      className="alone"
      onPointerDown={(e) => {
        e.stopPropagation();
        tapper.current!.down(pt(e));
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        tapper.current!.move(pt(e));
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        tapper.current!.up(pt(e));
      }}
      onPointerCancel={(e) => {
        e.stopPropagation();
        tapper.current!.cancel();
      }}
    >
      <div className="alone-it">{children}</div>
      <div className="alone-credit">{credit}</div>
    </div>
  );
}

/** The view, over everything on the page (a portal into the body, above the tree, the card and the top bar). */
export function Alone(props: { credit: ReactNode; onClose: () => void; children: ReactNode }) {
  if (typeof document === 'undefined') return <AloneView {...props} />;
  return createPortal(<AloneView {...props} />, document.body);
}

/**
 * A picture alone: the card's thumbnail at once (already loaded), the larger Commons one (`big`, bigSrcOf) over it once it
 * arrives; if that fails, the thumbnail stays.
 */
export function AloneImg({ src, big }: { src: string; big: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>(big === src ? 'failed' : 'loading');
  return (
    <>
      <img src={src} alt="" decoding="async" referrerPolicy="no-referrer" />
      {state !== 'failed' && (
        <img
          className={`big ${state}`}
          src={big}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setState('ok')}
          onError={() => setState('failed')}
        />
      )}
    </>
  );
}
