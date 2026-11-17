// A chip opens its choices and you pick one (ToLaD#537): a tap opens the menu, the current choice marked; a pick applies
// and closes; a tap outside or Escape closes with no change; the address kept in step, old links still read.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressWith, ChoiceChip, chosenIn, type Choice } from './ChoiceChip';
import { FORK_CHOICES, FORK_NAMING_CHOICES, FOSSIL_CHOICES } from './FanApp';
import { hookHarness } from './hookharness';

type El = ReactElement<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Look = 'thin' | 'peel';
const LOOKS: Choice<Look>[] = [
  { value: 'thin', short: 'thin', label: 'thin: wide stems as lines' },
  { value: 'peel', short: 'peel', label: 'peel: ribbons, the old look' },
];

/** The chip run with its own state (no DOM): its tree as it renders now, and the parts a test taps. */
function chip(props: Partial<Parameters<typeof ChoiceChip<Look>>[0]> = {}) {
  const { render } = hookHarness();
  const onPick = vi.fn();
  const el = () => render(() => ChoiceChip<Look>({ name: 'forks', choices: LOOKS, value: 'thin', onPick, ...props })) as El;
  const kids = () => [el().props.children].flat(2).filter(Boolean) as El[];
  const button = () => kids()[0];
  const layer = () => (kids()[1] ? ([kids()[1].props.children].flat() as El[]) : null);
  const items = () => [layer()![1].props.children].flat() as El[];
  return { el, button, layer, items, onPick, html: () => renderToStaticMarkup(el()) };
}

afterEach(() => vi.unstubAllGlobals());

describe('a chip opens its choices and you pick one (ToLaD#537)', () => {
  it('shows its name and value, closed: a button that says it opens a menu', () => {
    const c = chip();
    const html = c.html();
    expect(html).toContain('forks: thin');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menu"');
  });

  it('opens on a tap: every choice listed, the current one marked', () => {
    const c = chip({ value: 'peel' });
    c.button().props.onClick();
    expect(c.button().props['aria-expanded']).toBe(true);
    const html = c.html();
    expect(html).toContain('role="menu"');
    expect(c.items().map((i) => [i.props.role, i.props.children, i.props['aria-checked']])).toEqual([
      ['menuitemradio', 'thin: wide stems as lines', false],
      ['menuitemradio', 'peel: ribbons, the old look', true],
    ]);
    expect(html).toContain(`aria-controls="${c.layer()![1].props.id}"`);
    // (Each row a full touch target, the menu kept inside a phone's width.)
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app.css'), 'utf8');
    const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    expect(rule('.fan .bar .chip-menu button')).toContain('min-height: 44px');
    expect(rule('.fan .chip-menu')).toContain('max-width: calc(100vw - 16px)');
  });

  it('a pick applies and closes; the current one only closes', () => {
    const c = chip();
    c.button().props.onClick();
    c.items()[1].props.onClick();
    expect(c.onPick).toHaveBeenCalledWith('peel');
    expect(c.layer()).toBeNull();
    c.button().props.onClick();
    c.items()[0].props.onClick();
    expect(c.onPick).toHaveBeenCalledTimes(1);
    expect(c.layer()).toBeNull();
  });

  it('a tap outside (on the scrim over everything else) or Escape closes with no change', () => {
    const c = chip();
    c.button().props.onClick();
    c.layer()![0].props.onPointerDown();
    expect(c.layer()).toBeNull();
    c.button().props.onClick();
    const preventDefault = vi.fn();
    c.el().props.onKeyDown({ key: 'Escape', preventDefault });
    expect(c.layer()).toBeNull();
    expect(preventDefault).toHaveBeenCalled();
    expect(c.onPick).not.toHaveBeenCalled();
  });

  it('keeps the address: the choice in its param, the default left out, the rest of the address kept', () => {
    const replaceState = vi.fn();
    const assign = vi.fn();
    const at = (href: string) => vi.stubGlobal('window', { location: { href, assign }, history: { state: null, replaceState } });
    at('https://theitush.github.io/ToLaD/?flip=0&forks=thin#x');
    const c = chip({ param: 'forks' });
    c.button().props.onClick();
    c.items()[1].props.onClick();
    expect(replaceState).toHaveBeenLastCalledWith(null, '', 'https://theitush.github.io/ToLaD/?flip=0&forks=peel#x');
    expect(c.onPick).toHaveBeenLastCalledWith('peel');
    at('https://theitush.github.io/ToLaD/?forks=peel&width=mass');
    const d = chip({ param: 'forks', value: 'peel' });
    d.button().props.onClick();
    d.items()[0].props.onClick();
    expect(replaceState).toHaveBeenLastCalledWith(null, '', 'https://theitush.github.io/ToLaD/?width=mass');
    expect(assign).not.toHaveBeenCalled();
  });

  it('a data switch reloads at the new address, nothing applied in place', () => {
    const replaceState = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { href: 'https://theitush.github.io/ToLaD/?flip=0', assign }, history: { state: null, replaceState } });
    const { render } = hookHarness();
    const onPick = vi.fn();
    const el = () => render(() => ChoiceChip({ name: 'fossils', param: 'fossils', choices: FOSSIL_CHOICES, value: 'all', onPick, reload: true })) as El;
    el().props.children[0].props.onClick();
    const menu = el().props.children[1].props.children[1] as El;
    expect(renderToStaticMarkup(el())).toContain('every fossil');
    menu.props.children[1].props.onClick();
    expect(assign).toHaveBeenCalledWith('https://theitush.github.io/ToLaD/?flip=0&fossils=old');
    expect(replaceState).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("the bar's chips keep their addresses and old links (ToLaD#537)", () => {
  const base = 'https://theitush.github.io/ToLaD/?width=mass';
  const round = <T extends string>(param: string, list: readonly Choice<T>[]) =>
    list.map((c) => chosenIn(new URL(addressWith(base, param, list, c.value)).search, param, list) ?? list[0].value);

  it('every choice written reads back as itself', () => {
    expect(round('forknames', FORK_NAMING_CHOICES)).toEqual(FORK_NAMING_CHOICES.map((c) => c.value));
    expect(round('forks', FORK_CHOICES)).toEqual(FORK_CHOICES.map((c) => c.value));
    expect(round('fossils', FOSSIL_CHOICES)).toEqual(['all', 'old']);
  });

  it('old links read as before', () => {
    expect(chosenIn('?forknames=fork', 'forknames', FORK_NAMING_CHOICES)).toBe('at fork');
    expect(chosenIn('?forknames=leaders', 'forknames', FORK_NAMING_CHOICES)).toBe('leaders');
    expect(chosenIn('?forknames=off', 'forknames', FORK_NAMING_CHOICES)).toBe('off');
    expect(chosenIn('?forks=thin', 'forks', FORK_CHOICES)).toBe('thin');
    expect(chosenIn('?forks=peel', 'forks', FORK_CHOICES)).toBe('peel');
    expect(chosenIn('?forks=flat', 'forks', FORK_CHOICES)).toBeNull();
    expect(chosenIn('?fossils=old', 'fossils', FOSSIL_CHOICES)).toBe('old');
    // (mammals-data.ts reads `?fossils=` itself: anything but `old` is every fossil, so the default left out agrees.)
    expect(new URL(addressWith(base, 'fossils', FOSSIL_CHOICES, 'all')).searchParams.get('fossils')).toBeNull();
  });

  it('names its choices plainly', () => {
    expect(FOSSIL_CHOICES.map((c) => c.label)).toEqual(['every fossil', 'old: dated tree only']);
    for (const list of [FORK_NAMING_CHOICES, FORK_CHOICES, FOSSIL_CHOICES]) expect(new Set(list.map((c) => c.label)).size).toBe(list.length);
  });
});
