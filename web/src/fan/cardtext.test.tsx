// The species card's numbers in the methods page's words, each linked to its step (ToLaD#508): six species' cards
// checked against the data, and a link opening "How we count" at its section.
import type { MouseEvent, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { aliveSource, useMethodsPage } from './cardwords';
import { SpeciesCard } from './FanApp';
import { hookHarness } from './hookharness';
import { loadMammalsFromFiles } from './mammals-node';
import { METHOD_IDS, MethodLink, Methods, MethodsView, OpenMethods, WORD_IDS } from './Methods';
import { mammaliaClade, type SpeciesRec } from './panthera';

let all: SpeciesRec[];
const sp = (sci: string) => all.find((s) => s.sci === sci)!;
beforeAll(async () => {
  await loadMammalsFromFiles();
  all = mammaliaClade().species;
});

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const card = (s: SpeciesRec, ageMa?: number) => renderToStaticMarkup(<SpeciesCard sp={s} ageMa={ageMa} onClose={() => {}} />);
const face = (html: string) => text(html.replace(/<figure[\s\S]*?<\/figure>/g, '').replace(/<details[\s\S]*<\/details>/, '').replace(/<ol class="hist-list"[\s\S]*<\/ol>/, ''));
const details = (html: string) => text(html.match(/<details[\s\S]*<\/details>/)![0]);
/** Every link to the page: [its words, its anchor]. */
const links = (html: string) => [...html.matchAll(/<a href="#([^"]+)" class="mlink[^"]*" data-method="([^"]+)">([^<]*)<\/a>/g)].map((m) => [m[3], m[2]]);
const PAGE_IDS = () => new Set([...renderToStaticMarkup(<MethodsView onClose={() => {}} />).matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

describe("the species card's words and their links (ToLaD#508)", () => {
  it('six species: each word says where its number came from, true for that species, and links to its step', () => {
    const ids = PAGE_IDS();
    // The lion: today's count is its history's latest figure (IUCN's 2024 estimate), not a census of its own.
    const lion = sp('Panthera leo');
    expect(aliveSource(lion)).toBe('published');
    // A Greenspoon species, the methods page's own: no census, his model and ours met in the middle.
    const quoll = sp('Dasyurus hallucatus');
    expect(aliveSource(quoll)).toBe('modelled');
    // Modelled, a natural level on its chart (the range-loss trend).
    const fox = sp('Vulpes vulpes');
    expect(aliveSource(fox)).toBe('modelled');
    expect(fox.natural!.n).toBeGreaterThan(fox.alive * 1.2);
    // Made flat by #507: its natural level is today's, its maps differing for taxonomy; today's count on PHYLACINE's
    // corrected map, Colombia given to A. jorgehernandezi (#507 group 1: 171k -> 5.0k), at its field density (Svensson
    // et al. 2010, 17/km², not COMBINE's 1.5: 5.0k -> 55k).
    const monkey = sp('Aotus zonalis');
    expect(monkey.natural!.n).toBe(monkey.alive);
    // Domestic: its history's latest figure (Greenspoon's pet cats).
    const cat = sp('Felis catus');
    expect(aliveSource(cat)).toBe('published');
    // A fossil (PBDB), no map: modelled from relatives.
    const fossil = sp('Panthera balamoides');
    expect(fossil.extinct).toBe(true);
    const want: [SpeciesRec, string, [string, string][]][] = [
      [lion, '~23k alive today published estimate', [['published estimate', METHOD_IDS.histories]]],
      [quoll, '~400k alive today modelled', [['modelled', METHOD_IDS.alive]]],
      [fox, '~1.9 million alive today modelled', [['modelled', METHOD_IDS.alive]]],
      [monkey, '~50k alive today modelled', [['modelled', METHOD_IDS.alive], ['Natural level', METHOD_IDS.past]]],
      [cat, '~600 million alive today published estimate', [['published estimate', METHOD_IDS.histories]]],
      [fossil, 'alive at the end, 11,700 years ago modelled', [['modelled', METHOD_IDS.fossils], ['Lived', METHOD_IDS.fossils]]],
    ];
    for (const [s, line, own] of want) {
      const html = card(s);
      const l = links(html);
      expect(face(html), s.sci).toContain(line);
      for (const k of own) expect(l, `${s.sci}: ${k}`).toContainEqual(k);
      // Every card: the ever-lived, grade, generation, status and method words linked; every link lands on the page.
      for (const k of [['(rough estimate)', METHOD_IDS.ever], ['Data grade', METHOD_IDS.grades], ['Generation', WORD_IDS.generation], ['Status', WORD_IDS.status], ['How we count, step by step', METHOD_IDS.alive]])
        expect(l, `${s.sci}: ${k}`).toContainEqual(k);
      for (const [, to] of l) expect(ids, `${s.sci} -> ${to}`).toContain(to);
      // Words methods508 found wrong are gone: "lifespan", "no human impact", a generation "from its curated history".
      for (const w of ['lifespan', 'no human impact', 'curated history']) expect(text(html), `${s.sci}: ${w}`).not.toContain(w);
    }
    // The lion in the past: its history's figure, the share with descendants modelled.
    const then = card(lion, 70e-6);
    expect(face(then)).toContain('~400k alive 70 years ago from its history');
    expect(face(then)).toContain('58% have descendants alive today modelled');
    expect(links(then)).toContainEqual(['from its history', METHOD_IDS.histories]);
    expect(links(then)).toContainEqual(['modelled', METHOD_IDS.descendants]);
    // The flat night monkey says why it does not change; the fox's level is on its chart, linked to step 2.
    expect(details(card(monkey))).toContain('the same as today');
    expect(details(card(monkey))).toContain('not by people’s doing, so no change is drawn');
    const foxOpen = renderToStaticMarkup(<SpeciesCard sp={fox} open onClose={() => {}} />);
    expect(links(foxOpen)).toContainEqual(['Natural level', METHOD_IDS.past]);
    expect(links(foxOpen)).toContainEqual(['How to read this chart', WORD_IDS.chart]);
    // The domestic cat: its generation from its body size, its births the stock's own; no wild ancestor named by guess.
    expect(details(card(cat))).toContain('(from body size)');
    expect(details(card(cat))).toContain("(the domestic stock's own births)");
    expect(text(card(sp('Canis familiaris')))).not.toContain('wildcat');
    // The quoll's generation is COMBINE's, not "curated history" (its modelled trend's G is the model's).
    expect(details(card(quoll))).toContain('about 2 years (COMBINE reported)');
  });

  it('a census species says "counted"; one whose history hides it says it does not know', () => {
    const census = all.find((s) => s.anchored && !s.history && !s.extinct)!;
    expect(aliveSource(census)).toBe('counted');
    expect(face(card(census))).toContain('alive today counted');
    expect(aliveSource(sp('Homo sapiens'))).toBe('counted');
    // A modelled genomic deep past sets the anchored flag too: a census and a model look the same there.
    const genomic = all.find((s) => s.history?.modelled === 'genomic' && !s.extinct)!;
    expect(aliveSource(genomic)).toBeNull();
    expect(face(card(genomic))).toContain('alive today counted or modelled');
  });

  it('a fossil placed by name says so, with its fossils\' date range (ToLaD#279)', () => {
    // (The old look, TOLAD_FOSSILS=old, draws no fossil placed by name: none says so.)
    if (process.env.TOLAD_FOSSILS === 'old') return void expect(all.filter((s) => s.placed)).toEqual([]);
    // On its genus: a species of Pseudaelurus beside it under its split.
    const graft = sp('Pseudaelurus validus');
    expect(graft.placed).toBe('genus');
    expect(face(card(graft))).toContain('Fossils from 17 million to 14 million years ago. Placed on its genus by name; no family tree data.');
    // On its family (or a group above it): no genus-mate under its split.
    const alone = all.find((s) => s.placed === 'family')!;
    expect(face(card(alone))).toContain('Placed on its family by name; no family tree data.');
    // A fossil a phylogeny or an override places, and a living species: no such line.
    for (const s of [sp('Panthera balamoides'), sp('Panthera leo')]) {
      expect(s.placed).toBeUndefined();
      expect(face(card(s))).not.toContain('by name');
    }
    // About every fossil is placed by name, and only fossils say so.
    expect(all.filter((s) => s.extinct && s.placed).length).toBeGreaterThan(11000);
    expect(all.filter((s) => !s.extinct && s.placed)).toEqual([]);
  });

  it('a link opens the page at its section, and the page closes back to the card', () => {
    // The link calls the page's opener with its anchor.
    const opened: string[] = [];
    const { render } = hookHarness(new Map([[OpenMethods, (at: string) => opened.push(at)]]));
    const a = render(() => MethodLink({ to: METHOD_IDS.ever, children: '(rough estimate)' })) as ReactElement<{ href: string; onClick: (e: MouseEvent) => void }>;
    expect(a.props.href).toBe('#m-ever');
    let prevented = false;
    a.props.onClick({ preventDefault: () => (prevented = true) } as unknown as MouseEvent);
    expect(opened).toEqual(['m-ever']);
    expect(prevented).toBe(true);
    // FanApp's page: none, then the page at that anchor, then none again once closed.
    const page = hookHarness();
    const run = () => page.render(() => useMethodsPage()) as [ReactElement<{ at?: string; onClose: () => void }> | null, (at: string) => void];
    const [none, open] = run();
    expect(none).toBeNull();
    open(METHOD_IDS.ever);
    const [shown] = run();
    expect(shown!.type).toBe(Methods);
    expect(shown!.props.at).toBe('m-ever');
    expect(renderToStaticMarkup(<MethodsView onClose={() => {}} at={shown!.props.at} />)).toContain('id="m-ever"');
    shown!.props.onClose();
    expect(run()[0]).toBeNull();
  });
});
