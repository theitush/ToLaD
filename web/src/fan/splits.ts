// The fan's dated tree of splits, from the data (ToLaD#145): the pipeline's dated
// tree (pipeline/FORMAT.md, "Dated tree"; tolad_pipeline/dated.py) induced on the
// clade's species. Its topology is Upham et al. 2019's node-dated MCC tree; a split
// whose species are a clade of Álvarez-Carretero et al. 2022 too is dated by the
// geometric mean of the two trees' ages (they err in opposite directions below
// ~25 Ma: research/dated-tree-sources.md), the rest interpolated in Upham's shape and
// no crown younger than a fossil of its genus. Every other dated species (fossils,
// living species Upham lacks) is grafted on by a rule, and the few hand values in ONE table, pipeline/overrides.toml
// (Panthera's living five from Figueiró et al. 2017, the domestic cat at
// domestication, the placement of four Panthera fossils), each cited there. No split
// is typed here: pointing the fan at another clade needs no hand table.
//
// Each split is one date where a parent population divides into its daughters (a
// clean split: one date, a sharp Y; gradual designs were tried in #50 and dropped, #171). Daughters are
// listed left to right; a daughter is a species (scientific name) or a nested split.
// A split may have more than two daughters (a polytomy: Upham dates them as one
// event, or fossils join it by taxonomy only).

import raw from 'virtual:panthera-data';
import carnivora from 'virtual:carnivora-data';
import { mammalData } from './mammals-data';
import type { DatedSplit, RawClade } from './panthera-extract';

export type Confidence = 'high' | 'medium' | 'low';

export interface Split {
  /** Short name for the lineage below the split (the card's title). */
  name: string;
  /** Date of the split, Ma, and its range. */
  ageMa: number;
  lo: number;
  hi: number;
  cite: string;
  confidence: Confidence;
  /** The Latin taxon the data names the split by (DatedSplit.name), '' if none: a family ends in -idae. */
  taxon?: string;
  /** Where the date comes from (DatedSplit.source): an interpolated or fossil date is not as solid as a dated clade's. */
  source?: string;
  note?: string;
  /** Daughters, left to right: species (scientific names) or splits. */
  kids: (string | Split)[];
}

/** The species under a dated split, left to right. */
function datedSpecies(t: DatedSplit): string[] {
  return t.kids.flatMap((k) => (typeof k === 'string' ? [k] : datedSpecies(k)));
}

/**
 * The Red List's Title Case English name in the fan's sentence case: words after the first lowercased, except a
 * possessive or a word from a place or people (Pallas's, Asian, Iberian, Chinese): "Asian Golden Cat" -> "Asian golden cat".
 */
export function sentenceCase(name: string): string {
  return name
    .split(' ')
    .map((w, i) => (i === 0 || /'s$|(an|ese|ish|ic)$/.test(w) || !/^[A-Z][a-z-]+$/.test(w) ? w : w.toLowerCase()))
    .join(' ');
}

/** Four significant digits (a domestication date is 0.0095 Ma). */
const r3 = (x: number) => Number(x.toPrecision(4));

/** The two dated trees' citations (DatedMeta). */
export interface Cites {
  upham: string;
  alvarez: string;
}

/** Upper-case the first letter ("small cat" -> "Small cat"). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The genus of a binomial. */
const genus = (sci: string) => sci.split(' ')[0];

/** What naming a split needs from the whole tree: each genus's species count, the species already naming a split above. */
interface Naming {
  perGenus: Map<string, number>;
  above: ReadonlySet<string>;
}

/**
 * A split's title, from the data (ToLaD#145), in order:
 * (a) the smallest named taxon holding exactly its species: a genus ("Lynx ancestors"; every species of
 *     the genus the tree draws, and no other), else the taxon the data names the split by, in its English
 *     form where the data gives one ("Small cat ancestors", overrides.toml [[dated_name]]), else Latin;
 * (b) else "<best-known species> lineage": its living species with the most individuals alive, passing
 *     over one that already titles a split above it (so nested splits on one line read apart); when
 *     every one does (a species and its fossil or tamed offshoot), "<that species> ancestors";
 * (c) short: under ~24 characters where a species' name allows (the next best-known one whose name
 *     fits), never a list of species.
 */
export function splitTitle(
  t: DatedSplit,
  sp: string[],
  label: (sci: string) => string,
  extinct: (sci: string) => boolean,
  alive: (sci: string) => number,
  naming: Naming,
): { name: string; best: string | null } {
  const g = genus(sp[0]);
  if (sp.length >= 2 && sp.every((s) => genus(s) === g) && naming.perGenus.get(g) === sp.length) return { name: `${g} ancestors`, best: null };
  if (t.name) return { name: `${cap(t.nameEn || t.name)} ancestors`, best: null };
  const living = sp.filter((s) => !extinct(s));
  const pool = living.length ? living : sp;
  const order = [...pool].sort((a, b) => alive(b) - alive(a));
  const fresh = order.filter((s) => !naming.above.has(s));
  const best = fresh.find((s) => label(s).length + ' lineage'.length <= 24) ?? fresh[0];
  if (best) return { name: `${cap(label(best))} lineage`, best };
  // every living species here already titles a split above (a species and its fossil or tamed offshoot): its ancestors
  return { name: `${cap(label(order[0]))} ancestors`, best: null };
}

/**
 * A dated split as the fan's Split. `common` names a species (its English name, or
 * null); `cites` are the dated trees' citations, `extinct` tells fossils apart, `alive`
 * counts a species' individuals alive today (the split's best-known species).
 */
export function splitFrom(
  t: DatedSplit,
  common: (sci: string) => string | null,
  extinct: (sci: string) => boolean,
  cites: Cites,
  alive: (sci: string) => number = () => 0,
  naming?: Naming,
): Split {
  const { upham, alvarez } = cites;
  const sp = datedSpecies(t);
  const label = (s: string) => common(s) ?? s;
  const daughters = t.kids.map((k) => (typeof k === 'string' ? label(k) : `the ${k.name || 'lineage'} of ${datedSpecies(k).length} species`));
  if (!naming) {
    const perGenus = new Map<string, number>();
    for (const s of sp) perGenus.set(genus(s), (perGenus.get(genus(s)) ?? 0) + 1);
    naming = { perGenus, above: new Set() };
  }
  const { name, best } = splitTitle(t, sp, label, extinct, alive, naming);
  const below: Naming = best ? { ...naming, above: new Set([...naming.above, best]) } : naming;
  let cite: string;
  let confidence: Confidence;
  const notes: string[] = [];
  switch (t.source) {
    case 'override':
      cite = t.override ? t.override.cite : 'pipeline/overrides.toml';
      confidence = 'medium';
      if (t.override) notes.push(t.override.reason);
      break;
    case 'ensemble':
      cite = `The geometric mean of ${alvarez} and ${upham}: below ~25 Ma the first runs old and the second young (research/dated-tree-sources.md). Range: the union of their 95% intervals`;
      confidence = 'medium';
      break;
    case 'alvarez':
      cite = alvarez;
      confidence = 'medium';
      break;
    case 'upham':
      cite = upham;
      confidence = 'medium';
      break;
    case 'upham-interp':
      cite = `Not a clade of both dated trees: its age is interpolated in the shape of ${upham}, between the dated splits around it`;
      confidence = 'low';
      break;
    case 'fossil-floor':
      cite = 'Fossil minimum: raised to the first appearance (Paleobiology Database) of a fossil species of this genus, since a crown is no younger than its oldest fossil';
      confidence = 'low';
      break;
    case 'upham-imputed':
      cite = `${upham}. A daughter here was placed with no genetic data (imputed under taxonomic constraints), so the date is weak`;
      confidence = 'low';
      break;
    case 'fossil':
      cite = 'Fossil record (Paleobiology Database first appearance, or the fossils\' own range): a fossil lineage branches off at its first appearance, by rule, not a dated split';
      confidence = 'low';
      break;
    default:
      cite = 'No dated node: an Open Tree node, its age interpolated between the dated splits around it';
      confidence = 'low';
  }
  if (t.loose > 0)
    notes.push(`${t.loose} ${t.loose === 1 ? 'daughter here is a fossil lineage' : 'daughters here are fossil lineages'} placed in this clade by taxonomy only: where ${t.loose === 1 ? 'it branches' : 'they branch'} off inside it is not known`);
  if (t.kids.length > 2) notes.push(`${t.kids.length} daughters part at one date: ${daughters.join('; ')}`);
  return {
    name,
    ageMa: r3(t.age),
    lo: r3(Math.min(t.lo, t.age)),
    hi: r3(Math.max(t.hi, t.age)),
    cite,
    confidence,
    source: t.source,
    taxon: t.name,
    ...(notes.length ? { note: notes.join('. ') } : {}),
    kids: t.kids.map((k) => (typeof k === 'string' ? k : splitFrom(k, common, extinct, cites, alive, below))),
  };
}

/** A clade's dated tree, from the data: any clade, no hand table. */
export function treeOf(raw: RawClade): Split {
  const bySci = new Map(raw.species.map((s) => [s.sci, s]));
  if (!raw.dated) throw new Error('data/mammals has no dated tree (format 1.6): rebuild it with `make -C pipeline build`');
  return splitFrom(
    raw.dated,
    (s) => {
      const c = bySci.get(s)?.common;
      return c ? sentenceCase(c) : null;
    },
    (s) => !!bySci.get(s)?.extinct,
    { upham: raw.datedMeta?.upham || 'Upham et al. 2019', alvarez: raw.datedMeta?.alvarez || 'Álvarez-Carretero et al. 2022' },
    (s) => bySci.get(s)?.alive ?? 0,
  );
}

/** The cat family's dated tree, from the data. */
export const FELIDAE_TREE: Split = treeOf(raw);

/** The order the cats sit in (ToLaD#146): cats, dogs, bears, seals, weasels and the rest. */
export const CARNIVORA_TREE: Split = treeOf(carnivora);

let mammTree: Split | null = null;
/** Every mammal's dated tree (ToLaD#247), built when the level is first shown (after loadMammals, mammals-data.ts). */
export function mammaliaTree(): Split {
  return (mammTree ??= nameOrders(treeOf(mammalData().clade)));
}

/**
 * The plain English name of a family ("Dogs" for Canidae): the level a reader knows the order by. A rule (a split whose
 * taxon ends in -idae is a family) and this small name map; a family not in it keeps its Latin name. Subfamilies and
 * genera get no label of their own here: the species and the split cards name them.
 */
export const FAMILY_EN: Record<string, string> = {
  Felidae: 'Cats',
  Canidae: 'Dogs',
  Ursidae: 'Bears',
  Phocidae: 'Seals',
  Otariidae: 'Sea lions',
  Odobenidae: 'Walrus',
  Mustelidae: 'Weasels',
  Mephitidae: 'Skunks',
  Procyonidae: 'Raccoons',
  Ailuridae: 'Red panda',
  Hyaenidae: 'Hyenas',
  Herpestidae: 'Mongooses',
  Viverridae: 'Civets',
  Eupleridae: 'Malagasy carnivores',
  Prionodontidae: 'Linsangs',
  Nandiniidae: 'Palm civet',
  // (Primates, ToLaD#275.)
  Galagidae: 'Galagos',
  Lorisidae: 'Lorises',
  Lemuridae: 'True lemurs',
  Indriidae: 'Indris & sifakas',
  Cheirogaleidae: 'Mouse & dwarf lemurs',
  Lepilemuridae: 'Sportive lemurs',
  Daubentoniidae: 'Aye-aye',
  Tarsiidae: 'Tarsiers',
  Pitheciidae: 'Titis, sakis & uakaris',
  Cebidae: 'Capuchins & squirrel monkeys',
  Aotidae: 'Night monkeys',
  Callitrichidae: 'Marmosets & tamarins',
  Atelidae: 'Spider & howler monkeys',
  Cercopithecidae: 'Old World monkeys',
  Hylobatidae: 'Gibbons',
  Hominidae: 'Great apes',
};

/**
 * The mammal orders (ToLaD#247), by the taxon the data names their split (an order whose split the data does not name
 * is not here: its families stand as branches of their own). Their plain English names label them at the mammal level.
 */
export const ORDER_EN: Record<string, string> = {
  Prototheria: 'Monotremes',
  Didelphimorphia: 'Opossums',
  Paucituberculata: 'Shrew opossums',
  Diprotodontia: 'Kangaroos & kin',
  Dasyuromorphia: 'Marsupial carnivores',
  Notoryctes: 'Marsupial moles',
  Peramelidae: 'Bandicoots',
  Afrosoricida: 'Tenrecs & golden moles',
  Macroscelidea: 'Elephant shrews',
  Hyracoidea: 'Hyraxes',
  Sirenia: 'Sea cows',
  Cingulata: 'Armadillos',
  Pholidota: 'Pangolins',
  Proboscidea: 'Elephants',
  Pilosa: 'Sloths & anteaters',
  Scandentia: 'Treeshrews',
  Dermoptera: 'Colugos',
  Primates: 'Primates',
  Lagomorpha: 'Rabbits & hares',
  Rodentia: 'Rodents',
  Eulipotyphla: 'Shrews & moles',
  Chiroptera: 'Bats',
  Carnivora: 'Carnivores',
  Perissodactyla: 'Horses & rhinos',
  Artiodactyla: 'Hoofed mammals & whales',
};
export const ORDER_TAXA: ReadonlySet<string> = new Set(Object.keys(ORDER_EN));

/**
 * The orders whose crown the dated tree leaves unnamed (ToLaD#247), each by two of its species (Upham et al. 2019's `ord`
 * field): their last common split is the order's, and is named for it (nameOrders), so it folds and is labelled as the
 * others. (Peramelemorphia is not one clade in the tree, its bandicoots, Peramelidae, are; Microbiotheria and
 * Tubulidentata are one species each.)
 */
export const ORDER_CROWNS: Record<string, [string, string]> = {
  Dasyuromorphia: ['Myrmecobius fasciatus', 'Antechinus mimetes'],
};

/** Name the unnamed orders' splits (ORDER_CROWNS) in tree t: the last split over both species, if it has no taxon. */
export function nameOrders(t: Split): Split {
  const path = (sp: string): Split[] | null => {
    const go = (s: Split): Split[] | null => {
      for (const k of s.kids) {
        if (k === sp) return [s];
        if (typeof k !== 'string') {
          const p = go(k);
          if (p) return [s, ...p];
        }
      }
      return null;
    };
    return go(t);
  };
  for (const [name, [a, b]] of Object.entries(ORDER_CROWNS)) {
    const pa = path(a);
    const pb = path(b);
    if (!pa || !pb) continue;
    let k = 0;
    while (k < pa.length && pa[k] === pb[k]) k++;
    const v = pa[k - 1];
    if (v && v !== t && !v.taxon) v.taxon = name;
  }
  return t;
}

/** A taxon without Open Tree's homonym note ("Pholidota (order in Opisthokonta)" -> "Pholidota"). */
export const taxonKey = (x: string) => x.replace(/ \(.*\)$/, '');

/** A split's family (or order) label, or null when it founds neither (FAMILY_EN, ORDER_EN). */
export function familyLabel(t: Split): string | null {
  const x = taxonKey(t.taxon ?? '');
  // (An order, ORDER_EN, labels like a family at the mammal level: ToLaD#247.)
  return /idae$/.test(x) ? (FAMILY_EN[x] ?? x) : (ORDER_EN[x] ?? null);
}

/** Every split in the tree, parents before their daughters. */
export function allSplits(t: Split = FELIDAE_TREE): Split[] {
  const out: Split[] = [t];
  for (const k of t.kids) if (typeof k !== 'string') out.push(...allSplits(k));
  return out;
}

/** The species under a split, left to right. */
export function speciesUnder(t: Split): string[] {
  return t.kids.flatMap((k) => (typeof k === 'string' ? [k] : speciesUnder(k)));
}
