// A chip in the bar that opens its choices (ToLaD#537): it shows its name and current value; a tap opens a small menu
// under it, every choice listed and the current one marked; a tap on one applies it, a tap outside or Escape closes it
// with no change. One component for every choice the bar offers: a chip is its choices, the address's `?param=` it
// keeps in step, and what a pick does in place (or `reload`, a data switch). Fork names, forks and fossils use it;
// fossil order (ToLaD#538) and mammals or amniotes (ToLaD#539) will.
import { useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';

export type Choice<T extends string> = {
  value: T;
  /** On the chip after its name, as `forks: thin`. */
  short: string;
  /** In the menu: plain enough to tell the choices apart. */
  label: string;
  /** In the address, `?param=q` (the value when not given). */
  q?: string;
};

const qOf = <T extends string>(c: Choice<T>): string => c.q ?? c.value;

/** The choice an address names for `param` (`?param=q`), or null: none named, or one this chip does not have (old links keep working as long as their `q` stays). */
export function chosenIn<T extends string>(search: string, param: string, choices: readonly Choice<T>[]): T | null {
  const q = new URLSearchParams(search).get(param);
  return choices.find((c) => qOf(c) === q)?.value ?? null;
}

/** The address with `param` naming this choice; the first choice is the default and leaves it out. Other params and the hash kept. */
export function addressWith<T extends string>(href: string, param: string, choices: readonly Choice<T>[], v: T): string {
  const u = new URL(href);
  const c = choices.find((x) => x.value === v);
  if (!c || c === choices[0]) u.searchParams.delete(param);
  else u.searchParams.set(param, qOf(c));
  return u.toString();
}

/** A small chevron: the chip opens. */
function Chevron() {
  return (
    <svg className="chev" width="8" height="8" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d="M2 3.6 L5 6.6 L8 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChoiceChip<T extends string>({
  name,
  title,
  choices,
  value,
  param,
  onPick,
  reload = false,
}: {
  /** The chip's name, before its value: `forks`. */
  name: string;
  title?: string;
  choices: readonly Choice<T>[];
  value: T;
  /** The address's `?param=` kept in step with the choice. */
  param?: string;
  /** Apply a new choice in place (not called for the current one). */
  onPick?: (v: T) => void;
  /** A data switch: the page reloads at the new address. */
  reload?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = `chip-${(param ?? name).replace(/\W+/g, '-')}`;
  const cur = choices.find((c) => c.value === value) ?? choices[0];

  // Open: the menu under the chip, its right edge on the chip's (fixed: the bar's chips scroll sideways in a row that
  // would clip it, ToLaD#538), kept on the screen (shifted in from an edge, as a popover's "shift"), and the current
  // choice focused, so the arrows and Enter work from the keyboard (no ring after a tap: focus-visible).
  useLayoutEffect(() => {
    const m = menu.current;
    const b = root.current;
    if (!open || !m || !b) return;
    const c = b.getBoundingClientRect();
    m.style.top = `${c.bottom + 6}px`;
    m.style.right = `${document.documentElement.clientWidth - c.right}px`;
    m.style.minWidth = `${c.width}px`;
    m.style.transform = '';
    const r = m.getBoundingClientRect();
    const pad = 8;
    const dx = r.left < pad ? pad - r.left : r.right > window.innerWidth - pad ? window.innerWidth - pad - r.right : 0;
    if (dx) m.style.transform = `translateX(${dx}px)`;
    m.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) root.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus();
  };
  const pick = (v: T) => {
    close(true);
    if (v === value) return;
    if (param && typeof window !== 'undefined') {
      try {
        const to = addressWith(window.location.href, param, choices, v);
        if (reload) return window.location.assign(to);
        window.history.replaceState(window.history.state, '', to);
      } catch {
        /* not in the address */
      }
    }
    onPick?.(v);
  };
  const onKeyDown = (e: RKeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      close(e.key === 'Escape');
      return;
    }
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'ArrowDown' ? (at + 1) % items.length : e.key === 'ArrowUp' ? (at - 1 + items.length) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to].focus();
  };

  return (
    <span className="chip" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {`${name}: ${cur.short}`}
        <Chevron />
      </button>
      {open && (
        <>
          {/* A tap anywhere else closes the menu and does nothing more (the tree under it does not see it). */}
          <div className="chip-scrim" aria-hidden="true" onPointerDown={() => close(false)} />
          <div className="chip-menu" role="menu" id={id} aria-label={name} ref={menu}>
            {choices.map((c) => (
              <button
                key={c.value}
                type="button"
                role="menuitemradio"
                aria-checked={c.value === cur.value}
                tabIndex={-1}
                onClick={() => pick(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
