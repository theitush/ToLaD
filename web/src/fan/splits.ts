// The cat family Felidae, dated: a small curated table (the dataset's tiles
// carry internal nodes, but their ages are interpolated and their topology is
// not a dated phylogeny's). Each split is one date where a parent population
// divides into its daughters (a clean split: one date, a sharp Y; the gradual
// version is #50). Daughters are listed left to right; a daughter is a species
// (scientific name) or a nested split. A split may have more than two
// daughters where the source dates them as one event (a polytomy).
//
// The 38 living species of the IUCN/SSC Cat Specialist Group's 2017 revision
// that the dataset holds (the Sunda leopard cat, Chinese mountain cat and
// African wildcat are not separate leaves there, and its extra Leopardus /
// Prionailurus / Lynx rows are subspecies or synonyms, left out), plus the
// Panthera fossils.
//
// Outside Panthera: TimeTree 5 (Kumar et al. 2022, Mol. Biol. Evol.
// 39:msac174), the pairwise divergence time of a species on each side of the
// split from its synthesis tree (the "adjusted" age, consistent across the
// tree; the interval is that pair's 95% CI over the n studies it summarises).
// So the topology there is TimeTree's, which differs from Johnson et al. 2006 /
// Li et al. 2016 in a few places, named in the notes. Confidence: medium for
// n >= 5 studies, low below.
//
// Panthera's living five: Figueiró et al. 2017, Sci. Adv. 3:e1700299, the
// genome-wide species tree {(tiger, snow leopard), [jaguar, (lion, leopard)]}
// (64% of windows). Node ages and 95% HPDs are read from Fig. 1A's labels (the
// only place the paper gives them; the figure is 313 px wide, so the last digit
// is ±0.02; research/panthera-split-dates.md). The paper treats them as
// relative ages under two soft calibrations.
// Fossils: the cave lion from its nuclear genome; the three without genomes
// branch off the lineage the literature assigns them to, at their first
// appearance.

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
  note?: string;
  /** Daughters, left to right: species (scientific names) or splits. */
  kids: (string | Split)[];
}

const FIGUEIRO = 'Figueiró et al. 2017, Sci. Adv. 3:e1700299';

export const PANTHERA_TREE: Split = {
  name: 'Big cat ancestors',
  ageMa: 4.58,
  lo: 3.37,
  hi: 5.84,
  cite: `${FIGUEIRO}, Fig. 1A (node age averaged over species-tree windows, 95% HPD; read from the figure)`,
  confidence: 'high',
  note: 'tiger + snow leopard vs lion + leopard + jaguar',
  kids: [
    {
      name: 'Tiger + snow leopard ancestors',
      ageMa: 3.47,
      lo: 2.55,
      hi: 4.43,
      cite: `${FIGUEIRO}, Fig. 1A (95% HPD; read from the figure)`,
      confidence: 'high',
      kids: [
        {
          name: 'Tiger ancestors',
          ageMa: 2.58,
          lo: 2.16,
          hi: 2.58,
          cite: 'Mazák, Christiansen & Kitchener 2011, PLoS ONE 6:e25483 (P. zdanskyi the most primitive member of the tiger lineage, 2.55–2.16 Ma); date = its first appearance in the dataset (PBDB)',
          confidence: 'medium',
          note: 'several later studies treat P. zdanskyi as a synonym of P. palaeosinensis',
          kids: ['Panthera tigris', 'Panthera zdanskyi'],
        },
        'Panthera uncia',
      ],
    },
    {
      name: 'Lion + leopard + jaguar ancestors',
      ageMa: 3.65,
      lo: 2.69,
      hi: 4.66,
      cite: `${FIGUEIRO}, Fig. 1A (95% HPD; read from the figure)`,
      confidence: 'high',
      kids: [
        {
          name: 'Jaguar ancestors',
          ageMa: 2.0,
          lo: 1.5,
          hi: 2.7,
          cite: 'Hemmer 1971 (P. gombaszoegensis as the jaguar\'s ancestor, "P. onca gombaszoegensis"); first appearance ~1.9–2.0 Ma (O\'Regan 2002, secondary; records from ~1.5 Ma to a doubtful >2.7 Ma)',
          confidence: 'low',
          note: 'contested: Chatar, Michaud & Fischer 2022 (Pap. Palaeontol. 8:e1464), the first phylogenetic analysis of the species, "places this taxon closer to P. tigris than to P. onca". The dataset\'s first appearance (3.96 Ma) sits on the old crown date and is not used',
          kids: [
            {
              name: 'Jaguar ancestors',
              ageMa: 0.129,
              lo: 0.0117,
              hi: 0.129,
              cite: 'Stinnesbeck et al. 2020, Hist. Biol. 32:930–939 (P. balamoides, compared with P. onca); date = its first appearance in the dataset',
              confidence: 'low',
              note: 'contested: Blaine et al. 2019 and Ruiz-Ramoni et al. 2019 argue it is a short-faced bear (Arctotherium)',
              kids: ['Panthera onca', 'Panthera balamoides'],
            },
            'Panthera gombaszoegensis',
          ],
        },
        {
          name: 'Lion + leopard ancestors',
          ageMa: 2.57,
          lo: 1.89,
          hi: 3.28,
          cite: `${FIGUEIRO}, Fig. 1A (95% HPD; read from the figure)`,
          confidence: 'high',
          kids: [
            {
              name: 'Lion ancestors',
              ageMa: 0.5,
              lo: 0.392,
              hi: 0.578,
              cite: 'de Manuel et al. 2020, PNAS 117:10927–10934 (nuclear genomes: 470 ka, 392–529 ka, SI Table S3; X-chromosome PSMC 495 ka, 460–578 ka); the mitogenomes give 1.89 Ma (Barnett et al. 2016, Open Quaternary 2:4)',
              confidence: 'high',
              kids: ['Panthera leo', 'Panthera spelaea'],
            },
            'Panthera pardus',
          ],
        },
      ],
    },
  ],
};

const TT = 'TimeTree 5 (Kumar et al. 2022, Mol. Biol. Evol. 39:msac174)';
/** A TimeTree split: the pair's adjusted age, its CI and how many studies it summarises. */
const tt = (pair: string, n: number, ageMa: number, lo: number, hi: number): Pick<Split, 'ageMa' | 'lo' | 'hi' | 'cite' | 'confidence'> => ({
  ageMa,
  lo: lo > 0 ? lo : ageMa,
  hi: hi > 0 ? hi : ageMa,
  cite: `${TT}: ${pair}, ${n} ${n === 1 ? 'study' : 'studies'}${lo > 0 ? ' (95% CI)' : ' (no interval)'}`,
  confidence: n >= 5 ? 'medium' : 'low',
});

export const FELIDAE_TREE: Split = {
  name: 'Cat ancestors',
  ...tt('lion–domestic cat', 19, 13.8, 11.95, 15.66),
  note: 'Pantherinae vs Felinae. Figueiró et al. 2017 (Fig. 1A) date the same split 12.06 Ma (9.02–15)',
  kids: [
    {
      name: 'Pantherine ancestors',
      ...tt('clouded leopard–lion', 14, 9.29, 8.17, 10.4),
      note: 'clouded leopards vs Panthera',
      kids: [
        {
          name: 'Clouded leopard ancestors',
          ...tt('clouded leopard–Sunda clouded leopard', 1, 2.15, 0, 0),
          kids: ['Neofelis nebulosa', 'Neofelis diardi'],
        },
        PANTHERA_TREE,
      ],
    },
    {
      name: 'Small cat ancestors',
      ...tt('marbled cat–caracal and marbled cat–domestic cat', 7, 11.86, 9.04, 14.37),
      note: 'Felinae: the bay cat, caracal and other lineages part at one date in TimeTree (Johnson et al. 2006 date them 9.4 and 8.5 Ma, in that order)',
      kids: [
        {
          name: 'Bay cat lineage',
          ...tt('marbled cat–Asian golden cat', 6, 6.31, 5.7, 6.93),
          kids: [
            'Pardofelis marmorata',
            {
              name: 'Golden cat ancestors',
              ...tt('bay cat–Asian golden cat', 6, 5.57, 4.4, 6.74),
              kids: ['Catopuma badia', 'Catopuma temminckii'],
            },
          ],
        },
        {
          name: 'Caracal lineage',
          ...tt('serval–caracal', 5, 7.44, 5.35, 9.53),
          kids: [
            'Leptailurus serval',
            {
              name: 'Caracal ancestors',
              ageMa: 2.06,
              lo: 1.19,
              hi: 2.93,
              cite: 'Wikipedia "Caracal" (Phylogeny): the caracal and the African golden cat "diverged between 2.93 and 1.19 million years ago" (uncited there; the lineage dates around it are Johnson et al. 2006); date = the interval\'s middle. TimeTree has no pair for the golden cat',
              confidence: 'low',
              kids: ['Caracal caracal', 'Profelis aurata'],
            },
          ],
        },
        {
          name: 'Ocelot + lynx + puma + domestic cat ancestors',
          ...tt('ocelot–domestic cat', 7, 10.65, 8.73, 12.57),
          kids: [
            {
              name: 'Ocelot lineage',
              ...tt('Andean mountain cat–ocelot', 7, 4.57, 3.65, 5.49),
              note: 'TimeTree puts the Andean mountain cat first; Johnson et al. 2006 pair it with the pampas cat',
              kids: [
                'Leopardus jacobita',
                {
                  name: 'Ocelot + tiger cat ancestors',
                  ...tt("ocelot–Geoffroy's cat", 4, 4.46, 3.02, 5.89),
                  kids: [
                    {
                      name: 'Ocelot + margay ancestors',
                      ...tt('ocelot–margay', 7, 2.05, 1.35, 2.76),
                      kids: ['Leopardus pardalis', 'Leopardus wiedii'],
                    },
                    {
                      name: 'Pampas cat + tiger cat ancestors',
                      ...tt("pampas cat–Geoffroy's cat", 4, 3.46, 2.33, 4.59),
                      kids: [
                        'Leopardus colocolo',
                        {
                          name: 'Tiger cat ancestors',
                          ...tt("oncilla–Geoffroy's cat", 7, 2.37, 1.19, 3.55),
                          note: 'gene flow among these four is common (Trigo et al. 2013), so the split is blurred',
                          kids: [
                            {
                              name: 'Oncilla ancestors',
                              ...tt('oncilla–southern tiger cat', 1, 1.46, 0, 0),
                              kids: ['Leopardus tigrinus', 'Leopardus guttulus'],
                            },
                            {
                              name: "Geoffroy's cat + kodkod ancestors",
                              ...tt("Geoffroy's cat–kodkod", 5, 1.58, 1.43, 1.73),
                              kids: ['Leopardus geoffroyi', 'Leopardus guigna'],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              name: 'Lynx + puma + domestic cat ancestors',
              ...tt('Eurasian lynx–domestic cat, cougar–domestic cat', 15, 10.32, 7.65, 12.68),
              note: 'the lynx, puma and leopard cat + domestic cat lineages part at one date in TimeTree (a fast radiation; Johnson et al. 2006 order them lynx 7.2, puma 6.7, then the rest 6.2 Ma; Li et al. 2016 find conflicting gene trees here)',
              kids: [
                {
                  name: 'Lynx ancestors',
                  ...tt('bobcat–Eurasian lynx', 7, 6.1, 4.58, 7.62),
                  kids: [
                    'Lynx rufus',
                    {
                      name: 'Northern lynx ancestors',
                      ...tt('Iberian lynx–Eurasian lynx', 7, 2.68, 1.96, 3.4),
                      note: 'TimeTree pairs the Eurasian lynx with the Canada lynx; genome studies (Abascal et al. 2016) with the Iberian lynx',
                      kids: [
                        'Lynx pardinus',
                        {
                          name: 'Eurasian + Canada lynx ancestors',
                          ...tt('Canada lynx–Eurasian lynx', 5, 2.48, 2.0, 2.95),
                          kids: ['Lynx lynx', 'Lynx canadensis'],
                        },
                      ],
                    },
                  ],
                },
                {
                  name: 'Puma lineage',
                  ...tt('cheetah–cougar', 9, 5.66, 4.65, 6.67),
                  kids: [
                    'Acinonyx jubatus',
                    {
                      name: 'Cougar + jaguarundi ancestors',
                      ...tt('cougar–jaguarundi', 7, 5.21, 3.52, 6.89),
                      kids: ['Puma concolor', 'Puma yagouaroundi'],
                    },
                  ],
                },
                {
                  name: 'Leopard cat + domestic cat ancestors',
                  ...tt("Pallas's cat–domestic cat", 7, 8.88, 6.67, 11.09),
                  note: "TimeTree puts Pallas's cat outside the leopard cats + Felis; Johnson et al. 2006 and Li et al. 2016 put it with the leopard cats",
                  kids: [
                    'Otocolobus manul',
                    {
                      name: 'Leopard cat + wildcat ancestors',
                      ...tt('leopard cat–domestic cat', 7, 8.31, 6.66, 9.95),
                      kids: [
                        {
                          name: 'Leopard cat lineage',
                          ...tt('rusty-spotted cat–leopard cat', 4, 5.95, 3.77, 8.13),
                          kids: [
                            'Prionailurus rubiginosus',
                            {
                              name: 'Flat-headed + leopard cat ancestors',
                              ...tt('flat-headed cat–leopard cat', 7, 5.76, 3.89, 7.63),
                              kids: [
                                'Prionailurus planiceps',
                                {
                                  name: 'Leopard cat + fishing cat ancestors',
                                  ...tt('leopard cat–fishing cat', 7, 3.29, 2.36, 4.21),
                                  kids: ['Prionailurus bengalensis', 'Prionailurus viverrinus'],
                                },
                              ],
                            },
                          ],
                        },
                        {
                          name: 'Wildcat lineage',
                          ...tt('jungle cat–domestic cat', 8, 4.44, 3.43, 5.45),
                          kids: [
                            'Felis chaus',
                            {
                              name: 'Black-footed cat + wildcat ancestors',
                              ...tt('black-footed cat–domestic cat', 4, 3.17, 2.38, 3.96),
                              kids: [
                                'Felis nigripes',
                                {
                                  name: 'Sand cat + wildcat ancestors',
                                  ...tt('sand cat–domestic cat', 7, 3.01, 2.45, 3.57),
                                  kids: [
                                    'Felis margarita',
                                    {
                                      name: 'Wildcat ancestors',
                                      ageMa: 0.0095,
                                      lo: 0.0095,
                                      hi: 0.0115,
                                      cite: 'Domestication: Driscoll et al. 2007, Science 317:519–523 (domestic cats descend from the Near Eastern wildcat, F. silvestris lybica); the earliest tamed cat, buried with a person on Cyprus ~9,500 years ago (Vigne et al. 2004, Science 304:259)',
                                      confidence: 'medium',
                                      note: "the dataset's wildcat is the species in the broad sense (European + African wildcats); the domestic cat is its tamed form, so it parts at domestication, not at a speciation",
                                      kids: ['Felis silvestris', 'Felis catus'],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

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
