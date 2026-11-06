# OneZoom, measured by hand (ToLaD#419)

**Verdict: no. OneZoom is not a newer or more complete database than what we have, and it does not hold all we need.** It is built on the same Open Tree 16.1 and Open Tree Taxonomy 3.7.3 we already use, so it adds dates and forced forks to the same tree, not new data. For mammals, 53% of its forks are made by rule or at random, it holds 5,598 of MDD's 6,904 species, and its dates land 6 of 15 on our benchmark, with Carnivora at 67 and Placentalia at 129 Ma. It has no fossils, because the build removes taxa flagged extinct. Its real value is at the far end: it is the only fully dated, open-licence tree of all life we found (2.29M tips), and its labels mark every invented fork, so we could use it above amniotes with those forks collapsed. Even so, at most 3.4% of its nodes across all life carry a real date.

Checked 2026-11-06 on the two median trees in [Zenodo 19049120](https://zenodo.org/records/19049120), checksums verified against the record's md5.

| Need | OneZoom gives | We have or can get | Better? |
|---|---|---|---|
| Newer data | Open Tree 16.1, OTT 3.7.3 | Same two | Same |
| Mammal species | 5,598 of 6,904 | MDD 6,904 grafted in | Ours |
| Mammal families as forks | 137/139 exact | Ours 120/141, PHYLACINE 133/135 | OneZoom, against taxonomy only (see below) |
| Mammal relationships | 47% from Open Tree, 53% by rule | Upham, Álvarez-Carretero | Ours |
| Mammal dates | 6/15, ×1.22, 33% real | 5/15, ×1.20, Álvarez + Upham | No gain |
| Fork names | 940 mammal forks; 10 of 21 bat families | 689 forks; 10 of 21 | No gain; MDD names fix it (`famnames`) |
| Birds | 10,857 of 11,167, one family off | [AvesData 1.7](https://github.com/McTavishLab/AvesData): all 11,167, its own dated tree | AvesData |
| Reptiles | 9,779 of 12,687 by exact name | Tonini, Title (not scored here) | Not measured |
| Dated tree of all life | Yes, 2.29M tips, CC BY 4.0, 3.4% of nodes have a date source | Open Tree has no dates | **OneZoom** |
| Fossils, ranges, counts, mass, generations | None | `pipeline/` sources | Ours |
| Popularity | Live API; a dump on request | Nothing like it | **OneZoom**, licence open |
| Pictures | Harvested from EoL, per-image licences | Wikidata | Ours |

## 1. How current

- **Zenodo:** one version only, v1.0.0, 2026-03-20, CC BY 4.0. Preprint: [Duke et al. 2026](https://doi.org/10.64898/2026.03.05.709771). Whether it is peer-reviewed yet: not checked.
- **Under it:** the README asks for `opentree16.1` and `ott3.7.3`. Those are the versions in `data/raw/opentree/about.json` (2025-12-20) and `data/raw/ott/`. Not one new species or source tree comes from OneZoom's base.
- **Newer build or plan:** none found. [dated-complete-tree](https://github.com/OneZoom/dated-complete-tree) was last pushed 2026-08-28 with no new tree. Its date cache says 2026-07-14 (the README says 19 February). [tree-build](https://github.com/OneZoom/tree-build) sets `ot_version: "v16.1"`, last pushed 2026-09-08. `onezoom.org/data_sources` still says Open Tree 13.4, which is out of date.
- **Bigger picture:** Open Tree 16.1 lists 2,385,875 tips. OneZoom has 2,294,776 after removing extinct taxa and subspecies and pruning birds and turtles (`strip_birds`, `strip_turtles`).

## 2. Mammals

### 2.1 Species, against MDD v2.5

MDD v2.5 stays the latest, per [tree-sources-2026.md](tree-sources-2026.md).

| Step | MDD species found |
|---|---|
| Exact name | 5,310 |
| + MDD nominal names | 5,446 |
| + OTT synonyms | 5,598 |
| **Missing** | **1,306** (1,247 living, 59 extinct) |

- **Missing by order:** Rodentia 558, Chiroptera 314, Eulipotyphla 155, Primates 60, Artiodactyla 54, Carnivora 43. 452 were described in 2005 or later.
- **Extinct species:** 53 of MDD's 113 have an exact tip (thylacine included), because OTT did not flag them. That is not fossil data.
- **Of the 7,965 tips,** 6,558 map to an MDD species and 1,407 do not:

| Extra tips | Count | Examples |
|---|---|---|
| Binomials in an MDD genus, not recognised by MDD | 817 | `Pseudocheirus albertsi`, `Pseudocheirus dahli` |
| Unnamed samples (sp., cf., phylogroups, environmental) | 459 | `Dendrolagus sp. ME-2003`, `Leporidae environmental sample` |
| Binomials in a genus MDD does not use | 120 | `Petropseudes dahli`, `Schoinobates volans` |
| Odd three-word names | 7 | `Dasyurus viverrinus/maculatus mixed DNA library` |
| Placeholders the build made up (`ott0000`) | 4 | `Pteromuridae sp.`, `Amphiptera sp.` |

Of the 6,558 matched tips, 960 are second or later tips of one species (602 species have more than one). So 7,965 overstates the species count a lot, and a build would need cleaning like the pipeline's own.

### 2.2 Shape: the [survey's method](tree-sources-2026.md#12-trees-scored-against-mdd-v25)

My scorer reproduces the survey's Upham row exactly (5,037 / 5,146, 121/136, .985, 18 bats, 23/25), so these numbers compare. Scores use exact + nominal names.

| Tree | Tips | MDD exact / +nominal | Families exact | F≥.9 | F≥.7 | Mean F | Bat families exact (of 21) | Orders exact | Ages in range | Licence |
|---|---|---|---|---|---|---|---|---|---|---|
| **OneZoom birth model** | 7,965 | 5,310 / 5,446 | **137/139** | 139 | 139 | .999 | **20** | 25/25 | 6/15, ×1.22 | CC BY 4.0 |
| **OneZoom EQS-LS** | 7,965 | 5,310 / 5,446 | 137/139 | 139 | 139 | .999 | 20 | 25/25 | 6/15, ×1.22 | CC BY 4.0 |
| Upham ND MCC | 5,912 | 5,037 / 5,146 | 121/136 | 128 | 134 | .985 | 18 | 23/25 | 5/15, ×1.37 | CC0 |
| Ours, live tree | 18,366 with fossils | 6,301 / 6,404 by primary name | 120/141 | 135 | 139 | .985 | 17 | 24/26 | 5/15, ×1.20 | CC BY 4.0 |
| Open Tree 16.1 (survey) | 9,367 | 5,319 / 5,455 | 134/139 | | | .999 | 19 | 25/25 | no dates | CC0 |
| PHYLACINE complete (survey) | 5,831 | 4,873 / 4,979 | 133/135 | | | .999 | 21 | 25/25 | 6/15, ×1.14 | CC0 |

**This F does not measure truth.** The build moves species into their named genus and family (`fix_polyphyly`), so forks matching taxonomy are what the method produces. That is why it beats plain Open Tree (134) on the same base. The same caution applies to PHYLACINE in the survey. The test below is the one that tells them apart.

**Non-exact in OneZoom:** only Rhinonycteridae (.95: *Rhinonicteris aurantia* sits outside) and Dipodidae (.98). Using OTT synonyms as well adds false alarms: one Cricetidae tip matches *Mus musculus* by synonym, while the real *Mus musculus* tip sits in Muridae. I did not count those as misplacements.

**Ours, worst:** Chaeropodidae .40 (2 tips), Balaenidae .67, Heteromyidae .79, Iniidae .80, Lorisidae .85, Ziphiidae .88.

**All bats** (F of the best single fork; "name" means the family's name is on a fork in the OneZoom file):

| Family | Species in MDD | OneZoom | Upham | Ours | Name in file |
|---|---|---|---|---|---|
| Craseonycteridae | 1 | one species | one species | one species | no |
| Cistugidae | 2 | 1 | 1 | 1 | no |
| Emballonuridae | 55 | 1 | 1 | 1 | yes |
| Furipteridae | 2 | 1 | 1 | 1 | yes |
| Hipposideridae | 94 | 1 | 1 | **.96** | yes |
| Megadermatidae | 7 | 1 | **.89** | **.91** | yes |
| Miniopteridae | 41 | 1 | 1 | 1 | no |
| Molossidae | 133 | 1 | 1 | 1 | yes |
| Mormoopidae | 18 | 1 | **.88** | **.94** | yes |
| Mystacinidae | 2 | 1 | 1 | 1 | no |
| Myzopodidae | 2 | 1 | 1 | 1 | no |
| Natalidae | 11 | 1 | 1 | 1 | yes |
| Noctilionidae | 2 | 1 | 1 | 1 | no |
| Nycteridae | 14 | 1 | 1 | 1 | no |
| Phyllostomidae | 231 | 1 | 1 | 1 | yes |
| Pteropodidae | 203 | 1 | 1 | 1 | yes |
| Rhinolophidae | 118 | 1 | 1 | 1 | no |
| Rhinonycteridae | 9 | **.95** | 1 | 1 | no |
| Rhinopomatidae | 6 | 1 | 1 | 1 | no |
| Thyropteridae | 5 | 1 | 1 | 1 | no |
| Vespertilionidae | 558 | 1 | **.996** | **.997** | yes |

Values below 1 are in bold, rounded. Species counts are MDD's; matched tips are fewer. So our tree already has a fork for each bat family at F .91 or better. The 10-of-21 problem is one of naming, not shape, and OneZoom would not solve it: its file also names just 10 bat families, a different ten.

### 2.3 How much is real

Every invented fork is labelled. The build's own code sets `mrcaimp` when it inserts a taxon into a backbone at a random place, and `mrcapoly` when it breaks a polytomy at random (`tree_fixing.py`, seeded `rng`).

| Fork type | Mammals (7,964) | All life (2,294,775) |
|---|---|---|
| Named taxon, from Open Tree | 940 | 121,222 |
| `mrcaott…`, from Open Tree | 2,780 | 123,903 |
| `mrcaimp`, inserted by rule | 2,792 | 1,084,174 |
| `mrcapoly`, random polytomy break | 1,452 | 965,476 |
| **Invented** | **53%** | **89%** |

Inside MDD family crowns 54% of forks are invented: Soricidae 96%, Didelphidae 77%, Muridae 62%, Rhinolophidae 61%, Vespertilionidae 56%, all bats 49%.

**Do the forks agree with trees built from data?** Share of a tree's clades also present in a reference, on shared species:

| Tree against reference | Shared species | All clades | From Open Tree | Invented |
|---|---|---|---|---|
| OneZoom vs Álvarez-Carretero | 3,465 | 46.6% | **58.7%** | **18.4%** |
| Upham vs Álvarez-Carretero | 3,377 | 59.7% | | |
| Ours vs Álvarez-Carretero | 3,495 | 58.6% | | |
| OneZoom vs Upham | 4,978 | 29.7% | 46.0% | 7.7% |

So OneZoom's Open Tree forks are about as good as Upham against the same reference, and the invented half is mostly noise. Upham and ours are not pure data either: Upham imputes 1,813 species by taxonomy and we graft MDD species at their genus. Both are flagged. OneZoom's are flagged as well, so collapsing them is possible.

### 2.4 Names on forks

- **In the file:** tips carry OTT ids. Forks carry `Name_ottN` (940), `mrcaottAottB` (2,780), or the two invented labels.
- **MDD names:** 89 of 169 MDD families and 15 of 27 orders appear on a fork. Of the 141 families with 2+ tips, 87 are named, 74 of those on the best fork, 72 on an exact one. Ours: 79 of the same 141.
- **So:** it would not name forks much better than us. Names from MDD on best forks (`famnames`) beat either.

### 2.5 Dates

The 15 nodes from [dated-tree-sources.md](dated-tree-sources.md), §3. This reproduces #145's result exactly. "Sources" counts the chronogram dates for that node in OneZoom's cache.

| Node | Range | Birth | EQS-LS | Sources | Source median |
|---|---|---|---|---|---|
| Homo–Pan | 6–8 | 6.74 ✓ | 6.74 ✓ | 10 | 6.74 |
| Crown Panthera | 4–6.5 | 6.60 | 6.60 | 7 | 6.60 |
| Crown Felidae | 11–16 | 16.30 | 16.30 | 7 | 16.30 |
| Crown Canidae | 9–14 | **32.34** | **36.45** | 0 | none |
| Crown Ursidae | 17–22 | 18.90 ✓ | 18.90 ✓ | 7 | 18.90 |
| Crown Pinnipedia | 22–27 | 23.65 ✓ | 23.65 ✓ | 10 | 23.65 |
| Caniformia | 42–50 | 57.00 | 57.00 | 13 | 57.00 |
| Crown Carnivora | 50–60 | 66.97 | 66.97 | 0 | none |
| Mus–Rattus | 10.4–14 | 21.51 | 21.63 | 0 | none (an invented fork) |
| Whippomorpha | 52–58 | 51.83 | 51.83 | 0 | none |
| Crown Cetacea | 34–38 | **47.34** | **47.34** | 1 | **35.86**, in range, not used |
| Crown Primates | 65–75 | 71.99 ✓ | 71.99 ✓ | 0 | none |
| Euarchontoglires | 76–90 | 82.57 ✓ | 82.57 ✓ | 15 | 82.57 |
| Crown Placentalia | 85–100 | **129.25** | **129.25** | 1 | **88.64**, in range, not used |
| Theria | 157–170 | 157.71 ✓ | 157.71 ✓ | 6 | 157.71 |

**Total: 6/15, ×1.22 on both trees.** EQS-LS is not a fix.

Two things to note:
- The date cleaning seems to throw out good dates. Cetacea and Placentalia had sources in range; the tree has values far outside it. The cause is inferred from the build order (`dq_date_removal` before interpolation), and the cache is a later copy than the one used for the tree. Not traced further.
- Sources within one node spread very widely: Ursidae 9.3–48, Caniformia 36.5–65.4, Felidae 7–24.9. A median of these is not a calibrated date.

**Share with a real date** (the node has a source and its age equals the source median, ±0.5% or 0.01 Ma):

- 2,604 of 7,964 mammal forks (**32.7%**); 2,994 (37.6%) have a source. EQS-LS: the same to within 3.
- For scale, our live tree has 2,264 splits on the Álvarez + Upham ensemble, 1,387 on Upham-imputed and 2,710 interpolated.

**On shared clades,** OneZoom's age divided by the reference's:

| Reference | Fork type | n | Median | IQR | Off by over ×2 |
|---|---|---|---|---|---|
| Álvarez-Carretero | Real date | 1,148 | 0.93 | 0.68–1.27 | 19% |
| Álvarez-Carretero | Interpolated | 465 | 1.26 | 0.83–1.97 | 33% |
| Upham | Real date | 1,088 | 1.25 | 0.94–1.89 | 25% |
| Upham | Interpolated | 392 | 1.68 | 1.07–2.99 | 47% |

**Odd clade ages** (OneZoom / Upham / Álvarez-Carretero): Camelidae 55.1 / 8.5 / 25.3; Monotremata 97.6 / 50.5 / 66.5; Didelphidae 67.6 / 42.7 / 38.2.

**Branches are clean.** No zero or negative branches and no tip-depth spread, on either tree. 4 branches under 0.01 Ma and 444 under 0.1 Ma on the birth tree. Median terminal branch 2.24 Ma (Upham 1.76, Álvarez-Carretero 3.09). Crown Mammalia 183.2 Ma.

## 3. Next clade up

**Synapsida beyond mammals: none, confirmed.** Mammalia's parent is `Amniota_ott229560`, with a 140 Ma stem and `Sauria` (22,536 tips) as its only sister. No `Synapsida`, `Therapsida`, `Cynodontia`, `Mammaliaformes` or `Dinosauria` fork exists. Amniota has 30,501 tips.

| Group | Tips | Against | Species found | Families exact | Mean F | Invented forks | Real date |
|---|---|---|---|---|---|---|---|
| Birds | 10,931 | Clements 2025 (11,167; 251 families) | 10,857 with OTT crosswalk | 212/213 | 1.00 | 12.5% | 72.7% |
| AvesData 1.7 MCC | 11,167 | same | 11,167 | 213/214 | 1.00 | about 15% by taxonomy, per the survey | own dating |
| Reptiles | 11,605 | Reptile Database Oct 2026 (12,687; 94 families) | 9,779 exact name only | 62/81 | .987 | Lepidosaurs 57.6%, turtles 3.7% | Lepidosaurs 33.9%, turtles 51.4% |

- **Birds are OneZoom's strongest group,** because the build keeps only the species in `OTT_crosswalk_2024.csv`, the file name AvesData uses for its Clements 2024 crosswalk. Against AvesData itself, data forks agree 81.3% and invented ones 9.7%. Ages: median ratio 1.08, IQR 0.99–1.27, 7% off by over ×2. AvesData is newer (Clements 2025) and complete, so for birds take it instead.
- **Reptiles:** 2,908 missing is an upper bound, because no synonyms were used here. 1,826 tips are extra (340 are sp./cf.). Worst families: Cyclocoridae .67, Micrelapidae .86, Cylindrophiidae .87, Xenodermidae .88. Comparing it with Tonini or Title: not measured.
- **Family names on forks:** birds 67 of 213, reptiles 40 of 81.

**Bird dates** (Ma). Stiller 2024 gives these three in the part of its text I read (the first 100,000 characters of 187,675); other nodes were "not stated" there:

| Node | OneZoom | AvesData 1.7 | [Stiller 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11111414/) |
|---|---|---|---|
| Crown birds (ostrich–raven) | 96.1 | 99.0 | not read |
| Galloanserae–Neoaves | 88.4 | 84.0 | not read |
| Galloanserae | 72.4 | 71.8 | not read |
| Mirandornithes–other Neoaves | 70.4 | 72.5 | 67.4 (66.2–68.9) |
| Columbaves–rest | 70.2 | 67.8 | 66.5 (65.2–67.9) |
| Psittacopasserae | 60.7 | 56.2 | not read |
| Crown Passeriformes | 52.4 | 51.9 | 50.7 (48.3–53.0) |

OneZoom misses the Stiller intervals on 2 of 3, AvesData on 1 of 3. Kuhl 2021 was not compared.

## 4. All of life

"Date source" is the upper bound: the fork has a date in the cache. 77,046 of the cache's 77,492 appear in the file (the preprint says 76,953 were used).

| Group | Tips | Invented forks | With a date source |
|---|---|---|---|
| **All** | **2,294,776** | **89.3%** | **3.36%** |
| Birds | 10,931 | 12.5% | 80.2% |
| Testudines | 326 | 3.7% | 52.3% |
| Mammals | 7,965 | 53.3% | 37.6% |
| Lepidosaurs | 11,222 | 57.6% | 36.7% |
| Chondrichthyes | 1,653 | 57.9% | 32.5% |
| Ray-finned fish | 37,421 | 61.1% | 29.9% |
| Amphibians | 9,835 | 53.4% | 19.7% |
| Land plants | 417,174 | 84.5% | 8.44% |
| Insects | 984,719 | 91.6% | 0.98% |
| of which beetles | 286,850 | 92.5% | 0.23% |
| Other arthropods | 198,502 | 90.4% | 0.46% |
| Molluscs | 88,048 | 92.1% | 0.24% |
| Nematodes | 19,802 | 89.7% | 0.48% |
| Fungi | 247,148 | 96.8% | 0.16% |
| SAR | 51,095 | 92.5% | 0.15% |
| Bacteria | 77,634 | 93.6% | 0.04% |
| Archaea | 1,507 | 84.8% | 0.40% |

- **Thin:** dates outside vertebrates and plants are nearly all interpolated, so an insect or fungus date says little. Bacteria have 41,248 sp./environmental tips out of 77,634, and Archaea 1,507 tips.
- **Placeholders:** 1,719 tips across the tree are made-up species (`…sp._ott0000`).
- **Not a good name:** the `Vertebrata_ott…` fork in the file is a 249-tip homonym, not vertebrates. Crocodylia, Arachnida, Crustacea and Magnoliophyta are not forks.
- **Not compared to a checklist:** how complete each group is against COL. Not measured.

## 5. What else OneZoom carries

| Item | How to get it | Licence | Usable? |
|---|---|---|---|
| Tree | Zenodo | CC BY 4.0 | Yes |
| Tree distributions | Zenodo tarballs, 5–66 GB | CC BY 4.0 | Over our size limit; not fetched |
| Code: dated-complete-tree | GitHub | BSD-3 | Yes |
| Code: tree-build (harvests Wikidata, Commons) | GitHub | MIT | Yes, as a method |
| Code: OZtree (the site) | GitHub | OneZoom licence, non-commercial | Not for us to embed |
| Popularity (Wikipedia pageviews + page size, spread along the tree) | [API](https://www.onezoom.org/popularity) answered with `key=0`: limited to 5 taxa in, 100 out | No data licence found | Maybe. Ask before bulk use |
| Common names, IUCN, ids, images | [Database dump on request](https://www.onezoom.org/developer/), not a public file; site API | Mixed. No data licence found | Not as a pipeline input until they answer |
| Pictures | EoL harvest plus Commons, each with its own licence, some share-alike | Per image | Not ours as a set. We already get pictures from Wikidata |

We did not request the dump, or read the OneZoom licence PDF in full, or read the site's terms page: the URL I tried returned the About page.

## 6. What it can't give us

The pipeline also loads the sources below (`pipeline/SOURCES.md`). OneZoom has none of them:

- **Fossils:** PBDB (species and ages, attachment). OneZoom removes extinct taxa on purpose, and its dates use no fossils directly.
- **Ranges:** PHYLACINE current and present-natural maps.
- **Individuals and history:** Greenspoon, PanTHERIA, Red List counts, Bergman PSMC, Zoonomia, FAOSTAT, UN WPP, PRB.
- **Traits:** PHYLACINE and COMBINE mass, COMBINE generations, Bergeron mutation rates.
- **Date uncertainty:** the median trees carry no intervals. Upham and Álvarez-Carretero do.

## 7. Not measured

- Newer MDD: none, so v2.5 was used.
- Tree distributions: too large. So how much invented forks vary across draws: not measured, only that birth and EQS-LS differ slightly (Aves holds 10,931 and 10,924 tips; not traced).
- Reptile trees and Kuhl 2021.
- Group coverage against COL.
- Ours is scored on each leaf's primary name, so its match count (6,404) understates it: `stats.json` counts 7,015 living leaves.
- Scripts were throwaway, in my session scratchpad: a Newick parser, the survey's F scoring (validated on Upham), and clade comparison by hashing shared species sets.
