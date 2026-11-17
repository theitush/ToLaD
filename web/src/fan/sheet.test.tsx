// The species card as a bottom sheet (ToLaD#509): held to its share of the screen whatever is open, its head (the ×, the
// name) outside its scroll, and closed by the ×, a swipe down and back.
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardShell, SpeciesCard } from './FanApp';
import { hookHarness } from './hookharness';
import { FELIDAE } from './panthera';
import { backEntry, sheetSwipe, SWIPE_CLOSE_SHARE } from './sheet';
import { CARD_SHARE } from './view';

const lion = FELIDAE.species.find((s) => s.common === 'Lion')!;

describe('the card is a sheet held to its share (ToLaD#509)', () => {
  it('keeps the × and the name in a head outside the scroll, the rest (Details too) in the body under it', () => {
    const html = renderToStaticMarkup(<SpeciesCard sp={lion} onClose={() => {}} open />);
    const head = html.slice(html.indexOf('class="head"'), html.indexOf('class="body"'));
    const body = html.slice(html.indexOf('class="body"'));
    expect(head).toContain('aria-label="Close"');
    expect(head).toContain('Lion');
    expect(body).not.toContain('aria-label="Close"');
    expect(body).toContain('<details class="more"');
  });

  it('is held to CARD_SHARE of the screen with Details open: the sheet the one scroll, its lists not scrolling inside it', () => {
    expect(CARD_SHARE).toBeLessThanOrEqual(0.55);
    const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
    const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    expect(rule('.fan .card-sp.sheet')).toMatch(/max-height: calc\(var\(--card-share, [\d.]+\) \* 100dvh/);
    expect(rule('.fan .card-sp.sheet > .body')).toContain('overflow-y: auto');
    expect(css).toMatch(/\.fan \.card-sp\.sheet \.more dl,\s*\.fan \.card-sp\.sheet \.hist-list \{\s*max-height: none;/);
    // (FanApp hands the share to the sheet's foot, so the cap and the room the landings leave (cardRoom) are one figure.)
    expect(readFileSync(new URL('./FanApp.tsx', import.meta.url), 'utf8')).toContain("['--card-share' as string]: CARD_SHARE");
  });
});

type Div = React.ReactElement<{
  onPointerDown: (e: unknown) => void;
  onPointerMove: (e: unknown) => void;
  onPointerUp: (e: unknown) => void;
  children: [React.ReactElement<{ children: [unknown, React.ReactElement<{ onClick: () => void }>, unknown] }>, unknown];
}>;

function shell(onClose: () => void) {
  const { render } = hookHarness();
  const card = SpeciesCard({ sp: lion, onClose }) as React.ReactElement<React.ComponentProps<typeof CardShell>>;
  return () => render(() => CardShell(card.props)) as Div;
}
const ev = (y: number, t: number) => ({ pointerId: 1, clientX: 100, clientY: y, timeStamp: t, target: null, stopPropagation() {} });

describe('the ways out (ToLaD#509)', () => {
  it('the × closes it', () => {
    const onClose = vi.fn();
    shell(onClose)().props.children[0].props.children[1].props.onClick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a swipe down on its head closes it; a tap does not', () => {
    const onClose = vi.fn();
    const el = shell(onClose);
    el().props.onPointerDown(ev(500, 0));
    el().props.onPointerUp(ev(500, 80));
    expect(onClose).not.toHaveBeenCalled();
    el().props.onPointerDown(ev(500, 1000));
    for (let k = 1; k <= 6; k++) el().props.onPointerMove(ev(500 + 25 * k, 1000 + 40 * k));
    el().props.onPointerUp(ev(650, 1260));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the swipe: past a quarter of its height or flicked closes; short springs back; mid-scroll or sideways it does not follow', () => {
    const s = sheetSwipe();
    const go = (top: boolean, pts: [number, number, number][], h = 400) => {
      s.down({ id: 1, x: 100, y: 500, t: 0 }, top);
      let off: number | null = null;
      for (const [x, y, t] of pts) off = s.move({ id: 1, x, y, t });
      const [x, y, t] = pts[pts.length - 1];
      return { off, closes: s.up({ id: 1, x, y, t }, h) };
    };
    expect(
      go(true, [
        [100, 520, 100],
        [100, 500 + SWIPE_CLOSE_SHARE * 400 + 5, 900],
      ]),
    ).toEqual({ off: SWIPE_CLOSE_SHARE * 400 + 5, closes: true });
    expect(
      go(true, [
        [100, 520, 400],
        [100, 560, 800],
      ]),
    ).toEqual({ off: 60, closes: false });
    expect(
      go(true, [
        [100, 530, 20],
        [100, 560, 40],
      ]).closes,
    ).toBe(true); // a flick
    expect(
      go(false, [
        [100, 600, 100],
        [100, 700, 200],
      ]),
    ).toEqual({ off: null, closes: false }); // its content scrolled down: a scroll
    expect(
      go(true, [
        [200, 520, 100],
        [300, 540, 200],
      ]),
    ).toEqual({ off: null, closes: false }); // sideways
  });
});

describe('back closes it (ToLaD#509)', () => {
  afterEach(() => vi.unstubAllGlobals());
  function fakeWindow() {
    const stack: unknown[] = [null];
    let pop: (() => void) | null = null;
    const w = {
      history: {
        get state() {
          return stack[stack.length - 1];
        },
        pushState: (s: unknown) => stack.push(s),
        back: () => {
          stack.pop();
          pop?.();
        },
      },
      addEventListener: (_: string, f: () => void) => (pop = f),
      removeEventListener: () => (pop = null),
    };
    vi.stubGlobal('window', w);
    return { w, stack };
  }

  it('opening adds one entry; back takes it off and closes the card, and the page stays', () => {
    const { w, stack } = fakeWindow();
    const close = vi.fn();
    const undo = backEntry(close);
    expect(stack.length).toBe(2);
    w.history.back();
    expect(close).toHaveBeenCalledTimes(1);
    expect(stack.length).toBe(1);
    undo();
    expect(stack.length).toBe(1);
  });

  it('closed another way (the ×, a swipe, the tree), its entry goes with it and back is the page’s again', () => {
    const { stack } = fakeWindow();
    const close = vi.fn();
    const undo = backEntry(close);
    undo();
    expect(stack.length).toBe(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('a card open over its entry (another species tapped) adds none', () => {
    const { stack } = fakeWindow();
    const undo = backEntry(() => {});
    backEntry(() => {});
    expect(stack.length).toBe(2);
    undo();
  });
});
