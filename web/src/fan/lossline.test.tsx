// What dates a species' fall since 1500, on its card (ToLaD#507 group 3, research/range-loss-dates.md): one line under the
// change, its first words opening "How we count" at its step. One species of each basis the data gives (pipeline/FORMAT.md
// "Loss dates") shows its own line; a species with no loss, or with no fall, shows none.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { lossWords, shortCite, yearWords } from './cardwords';
import { SpeciesCard } from './FanApp';
import { HistorySpark } from './HistorySpark';
import { CARD_KINDS, packMammals, type MammalData } from './mammals-data';
import { loadMammalsFromFiles } from './mammals-node';
import { METHOD_IDS, WALK } from './Methods';
import { mammaliaClade, type SpeciesRec } from './panthera';

let all: SpeciesRec[];
let data: MammalData;
const sp = (sci: string) => all.find((s) => s.sci === sci)!;
beforeAll(async () => {
  data = await loadMammalsFromFiles();
  all = mammaliaClade().species;
});

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const card = (s: SpeciesRec) => renderToStaticMarkup(<SpeciesCard sp={s} onClose={() => {}} />);
/** The card's loss line: [its basis, its words, the linked words, their anchor], or null. */
function line(s: SpeciesRec): [string, string, string, string] | null {
  const m = card(s).match(/<p class="loss" data-loss="([^"]+)">([\s\S]*?)<\/p>/);
  if (!m) return null;
  const a = m[2].match(/<a href="#[^"]+" class="mlink" data-method="([^"]+)">([^<]*)<\/a>/)!;
  return [m[1], text(m[2]), a[2], a[1]];
}

describe("the card says what dates a species' range loss (ToLaD#507)", () => {
  it('one species of each basis shows its line, linked to the methods page', () => {
    const want: [string, string, string, string][] = [
      // Australia: the fall starts at European settlement (Strahan & Van Dyck's former ranges).
      ['Myrmecobius fasciatus', 'later', 'Range lost since 1788 (Strahan & Van Dyck 2008)', METHOD_IDS.past],
      // IUCN's Extinct / Possibly Extinct codes on its map, which PHYLACINE adds (Faurby et al. 2018): since 1500.
      ['Myrmecophaga tridactyla', 'dated', 'Range lost since 1500 (Faurby et al. 2018)', METHOD_IDS.past],
      // A historic range from records (Hall 1981): bounded by 1500.
      ['Antilocapra americana', 'dated', 'Range lost since 1500 (Hall 1981)', METHOD_IDS.past],
      // The dhole's North America, known only from Late Pleistocene fossils: left out of the 1500 level.
      ['Cuon alpinus', 'prehistoric', 'Range in North America lost by ~11,000 years ago, not counted', METHOD_IDS.past],
      ['Sarcophilus harrisii', 'prehistoric', 'Range in mainland Australia lost ~3,300–3,100 years ago, not counted', METHOD_IDS.past],
      // An island: only the bound, people's arrival.
      ['Lemur catta', 'bound', 'Range lost after people reached Madagascar (~10,500 years ago)', METHOD_IDS.past],
      // A bound that names no land: the moose's Iron Age range.
      ['Alces alces', 'bound', 'Range lost after ~2,800 years ago (Willms 1987)', METHOD_IDS.past],
      ['Bradypus torquatus', 'undated', 'When it lost its range is not known', METHOD_IDS.unknown],
    ];
    for (const [sci, basis, words, to] of want) {
      const s = sp(sci);
      expect(s.loss?.basis, sci).toBe(basis);
      const l = line(s);
      expect(l, sci).not.toBeNull();
      expect(l![0], sci).toBe(basis);
      expect(l![1], sci).toBe(words);
      expect(words.startsWith(l![2]), sci).toBe(true);
      expect(l![3], sci).toBe(to);
    }
  });

  it('a species with no loss shows none; nor does one with no fall (a domestic stock that rose)', () => {
    // No loss to date: its maps differ by taxonomy (#507), the same as today.
    const monkey = sp('Aotus zonalis');
    expect(monkey.loss ?? null).toBeNull();
    expect(line(monkey)).toBeNull();
    // A fossil: no loss record.
    expect(line(sp('Panthera balamoides'))).toBeNull();
    // The domestic horse shares the wild horse's map (its loss record) but its count rose: no fall, no line.
    const horse = sp('Equus caballus');
    expect(horse.loss?.basis).toBe('prehistoric');
    expect(horse.natural!.n).toBeLessThan(horse.alive);
    expect(lossWords(horse)).toBeNull();
    expect(line(horse)).toBeNull();
    // Every living species with a fall and a loss record has a line; every other species none.
    let lines = 0;
    for (const s of all) {
      const fall = !!s.loss && !s.extinct && !!s.natural && s.natural.n >= s.alive * (1 - 1e-6);
      expect(!!lossWords(s), s.sci).toBe(fall);
      if (fall) lines++;
    }
    expect(lines).toBeGreaterThan(600);
  });

  it("the harp seal: its Baltic, lost before 1500, is not counted, so no change, and the card does not call it not people's doing", () => {
    const seal = sp('Phoca groenlandica');
    expect(seal.natural!.n).toBeCloseTo(seal.alive, -1);
    expect(line(seal)![1]).toBe('Range in the Baltic Sea lost ~7,500–2,500 years ago, not counted');
    const html = card(seal);
    expect(text(html)).toContain('the same as today: what it lost before 1500 is not counted');
    expect(text(html)).not.toContain('not by people’s doing');
  });

  it("the chart's note says where the fall starts: 1788 for the numbat, 1500 for a dated one", () => {
    const note = (s: SpeciesRec) =>
      text(renderToStaticMarkup(<HistorySpark h={s.history!} open natural={s.natural} />).match(/data-modelled-note="">([^<]*)</)![1]);
    expect(note(sp('Myrmecobius fasciatus'))).toContain('the natural level held to 1788, then');
    expect(note(sp('Lemur catta'))).toContain('the natural level held to 1500, then');
  });

  it("the methods page's walked quoll is the data's: its fall starts in 1788, from Strahan & Van Dyck", () => {
    const q = sp(WALK.sci);
    expect(q.loss!.start).toBe(WALK.lossStart);
    expect(shortCite(q.loss!.cite)).toBe(WALK.lossCite);
  });

  it("the loss is the card's, in mammals-card.json, not the open's", () => {
    expect(CARD_KINDS.loss).toBe(true);
    const { open, card: c } = packMammals(data);
    expect(JSON.stringify(open.clade.species.cols)).not.toContain('Strahan');
    expect(JSON.stringify(c.species.cols)).toContain('Strahan');
  });

  it('short names and years', () => {
    expect(shortCite('Ray, Hunter & Zigouris 2005, WCS Working Paper 24')).toBe('Ray, Hunter & Zigouris 2005');
    expect(shortCite('Possible Early Holocene presence (cut-marked elephant-bird bones ~10,500 BP, Hansford et al. 2018 Sci. Adv.)')).toBe(
      'Hansford et al. 2018',
    );
    expect(shortCite('Foose & van Strien 1997, Asian Rhinos')).toBe('Foose & van Strien 1997');
    expect(shortCite('PHYLACINE note cites: Smith and Xie. Mammals of China (2008).')).toBe('PHYLACINE');
    expect(shortCite('Queensland Government (DEHP) species profile')).toBe('');
    expect(yearWords(1788)).toBe('1788');
    expect(yearWords(-8500, 2026)).toBe('~10,500 years ago');
    expect(yearWords(-1300, 2026)).toBe('~3,300 years ago');
  });
});
