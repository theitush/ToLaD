import * as React from 'react';
import type { ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hookHarness } from './hookharness';
import { METHOD_IDS, Methods, MethodsView, WALK, WORD_IDS } from './Methods';
import { loadAll } from './panthera-extract';
import { SourcesPanel } from './SourcesPanel';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'mammals');

describe('"How we count" (ToLaD#508)', () => {
  it('renders every step and every card word under its stable id, with the two maps and the grades', () => {
    const html = renderToStaticMarkup(<MethodsView onClose={() => {}} />);
    for (const id of [...Object.values(METHOD_IDS), ...Object.values(WORD_IDS)]) expect(html, id).toContain(`id="${id}"`);
    expect(Object.values(METHOD_IDS)).toEqual(['m-alive', 'm-1500', 'm-histories', 'm-ever', 'm-descendants', 'm-grades', 'm-fossils', 'm-unknown', 'm-words']);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('data-maps=""');
    expect(html.match(/<figcaption>/g)).toHaveLength(2);
    expect(html).toContain('Without people');
    for (const g of ['counted', 'estimated', 'rough', 'guess']) expect(html).toContain(g);
    // Plain words: none of the jargon the brief rules out.
    for (const w of ['dex', 'occupancy', 'present-natural']) expect(html.toLowerCase()).not.toContain(w);
  });

  it('the Sources panel opens it, and its × closes it', () => {
    const { render } = hookHarness();
    type El = ReactElement<{ className?: string; onClick?: () => void; onClose?: () => void; children?: React.ReactNode }>;
    const panel = () => render(() => SourcesPanel({ onClose: () => {} })) as El;
    const kids = (e: El) => React.Children.toArray(e.props.children) as El[];
    expect(kids(panel()).some((k) => k.type === Methods)).toBe(false);
    const link = kids(panel()).find((k) => k.props.className === 'methods-link')!;
    expect(renderToStaticMarkup(link)).toContain('How we count');
    link.props.onClick!(); // no history here: it simply opens
    const page = kids(panel()).find((k) => k.type === Methods)!;
    expect(page).toBeTruthy();
    page.props.onClose!();
    expect(kids(panel()).some((k) => k.type === Methods)).toBe(false);
  });

  it("the walked species' numbers are the data's (data/mammals)", () => {
    const sp = loadAll((rel) => readFileSync(join(DATA, rel))).species.find((s) => s.sci === WALK.sci)!;
    const near = (a: number, b: number, tol = 0.02) => expect(Math.abs(Math.log(a / b)), `${a} vs ${b}`).toBeLessThan(tol);
    near(sp.alive, WALK.alive);
    near(sp.natural!.n, WALK.nat);
    near(sp.natural!.lo, WALK.natLo);
    near(sp.natural!.hi, WALK.natHi);
    near(sp.natural!.km2Current, WALK.km2Now);
    near(sp.natural!.km2Natural, WALK.km2Nat);
    near(sp.gen!.years, WALK.genYears);
    near(sp.t0, WALK.startMa);
    near(sp.ever, WALK.ever);
    near(sp.everLo, WALK.everLo);
    near(sp.everHi, WALK.everHi);
    expect(sp.grade).toBe(WALK.grade);
    // Combined in the middle: the geometric mean of Greenspoon's and ours.
    near(Math.sqrt(WALK.greenspoon * WALK.ours), WALK.alive);
  });
});
