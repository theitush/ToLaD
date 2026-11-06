# What we can get and what we still need: sources by need (ToLaD#419)

Checked 2026-11-06. **have** = in the pipeline. **get** = open licence, can fetch. **lic!** = exists, licence blocks or is unclear. **none** = none found. **n/c** = not checked today.

| Need | Mammals | Amniotes (added on top) | All life | OneZoom ([measured](onezoom.md)) |
|---|---|---|---|---|
| Tree shape | **have** Open Tree 16.1 + Upham; **get** PHYLACINE (all 21 bat families) | **get** birds AvesData 1.7 (11,167 tips, CC BY); reptiles Tonini 2016 / Title 2024 (CC0) | **get** Open Tree 16.1 (CC0); GTDB r232 **lic!** (share-alike) | Same Open Tree 16.1; 53% of mammal forks and 89% of all forks made by rule |
| Dates | **have** Álvarez-Carretero + Upham ensemble; nothing newer found | **get** AvesData dated MCC; Tonini, Title | weak: mostly interpolated. Fish **get**, plants **lic!** | 6/15, ×1.22 on mammals; a date source on 33% of mammal forks, 3.4% of all nodes. The only fully dated open tree of all life |
| Current species list | **have** MDD v2.5 (6,904) | **get** Clements via AvesData; AviList **lic!** (licence not found); Reptile Database **lic!** (no licence found) | **get** COL 26.10 (CC BY) | 5,598 of MDD's 6,904; birds 10,857 of 11,167; reptiles 9,779 of 12,687 by exact name |
| Extinct species + ages | **have** PBDB (17,269 species names) | **get** PBDB (Amniota 30,207) | **get** PBDB (Metazoa 192,262), COL (170,758 extinct) | None |
| Where fossils attach | taxonomy graft only; **none** published Mammalia-wide | **get?** Hellert 2023 synapsids (file n/c); dinosaurs n/c; else taxonomy graft | taxonomy graft only | None |
| Group names | **have** MDD ranks, Open Tree Taxonomy | **get** AvesData/Clements; Reptile Database **lic!** | **get** COL, Open Tree Taxonomy | 940 mammal forks named; 10 of 21 bat families |
| Common names | **have** MDD, Wikidata | **get** Wikidata; Clements n/c | **get** Wikidata (CC0) | Database dump on request only |
| Ranges now | **have** PHYLACINE rasters; **get** MDD-taxonomy maps (v1.3) | **get** reptiles GARD 1.7 (CC0); birds BirdLife **lic!** | patchy, n/c | None |
| Ranges past | **have** PHYLACINE present-natural (one past state) | n/c | n/c | None |
| Population now | **have** Greenspoon, COMBINE, PanTHERIA, Red List | **get** birds Callaghan 2021 (CC BY); reptiles **none** | group totals only ([02](02-population-estimates.md)) | None |
| Population through time | **have** partly (hand curves, Bergman PSMC) | n/c | n/c | None |
| Mass / traits | **have** PHYLACINE, COMBINE | n/c (AVONET, reptile sets) | n/c | None |
| Pictures | **have** Wikidata | **get** Wikidata | **get** Wikidata | Harvested from EoL, licensed per image; on request |

## What this says

1. **Nothing newer beats our mammal list.** MDD v2.5 (2026-07-28) is still the latest. Three tree searches found no mammal-wide dated tree newer than Álvarez-Carretero 2022. Finding none is not proof that none exists.
2. **PHYLACINE is the one mammal tree that beats Upham on families, and we already hold the file.** It has all 21 bat families exact and 133 of 135 families exact, against Upham's 18 and 121. Its dates are not the fix (see §1.2).
3. **I found no published tree that joins living and fossil mammals at species level across Mammalia.** The nearest are clade-sized or backbone-only (§1.3).
4. **Birds are the easy part of the amniote page.** AvesData is complete, dated, CC BY and updated each year.
5. **TimeTree cannot serve; Catalogue of Life serves only as a list.** The terms say: "Redistribution of TimeTree data and its transformations are not permitted." COL is CC BY but has no tree dates. Both agree with `01-tree-data.md`.
6. **Individuals per species is missing for good outside census work.** Every source gives a modelled or local figure, or a group total.

## 1. Mammals

### 1.1 Lists

| Source | Version | Numbers | Licence | Note |
|---|---|---|---|---|
| [MDD](https://zenodo.org/records/21654811) | v2.5, 2026-07-28 | 6,904 species, 113 extinct, 17 domestic, 1,363 genera, 169 families (counted) | CC BY 4.0 on Zenodo; the site footer says "All rights reserved", so cite Zenodo | Also holds common names, type locality, country/continent, IUCN status |
| [Hesperomys](https://hesperomys.com/) | live; [repo](https://github.com/JelleZijlstra/hesperomys) pushed 2026-10-06 | n/c (script-rendered site) | repo has no licence | No bulk file found; n/c beyond that |
| COL 26.10 | 2026-10-14 | 170,758 extinct accepted species overall; per-group counts not measured (API too slow) | CC BY | Successor to the 2026-09 figures in `01` |

### 1.2 Trees, scored against MDD v2.5

Method: names matched exactly on genus + species, with subspecies folded. "+nominal" also uses MDD's `nominalNames`. For each MDD family with 2+ matched tips, F is the best single clade's harmonic mean of precision and recall, over matched tips only. Ages are from the 15 nodes in [dated-tree-sources.md](dated-tree-sources.md), §3.

| Tree | Tips | MDD exact / +nominal (of 6,904) | Imputed marked? | Families exact | Mean F | Bat families exact (of 21) | Orders exact | Ages in range | Licence |
|---|---|---|---|---|---|---|---|---|---|
| Upham 2019 ND MCC (now) | 5,912 | 5,037 / 5,146 | yes: 1,813 imputed, 4,098 sampled (`samp` column) | 121/136 | .985 | 18 (Megadermatidae .89, Mormoopidae .88, Vespertilionidae ~1.00) | 23/25 | 5/15, ×1.37 | CC0 |
| Upham DNA-only ND MCC | 4,100 | 3,544 / n/c | all sampled | 120/129 | .992 | 20 (Mormoopidae .86) | 23/25 | n/c | CC0 |
| Upham FBD MCC | 5,988 (76 fossils) | 5,037 / 5,146 | as Upham | 121/136 | .985 | 18 | 23/25 | 3/15, ×1.59 | CC0 |
| Álvarez-Carretero 2022 (now) | 4,705 (4,071 binomials) | 3,431 / 3,526 | sampled only | 124/129 | .994 | **21** | 25/25 | 4/15, ×1.15 | CC BY 4.0 |
| Open Tree 16.1 (now) | 9,367 (7,886 binomials; 960 polytomy nodes) | 5,319 / 5,455 | taxonomy-only tips not marked in the tree | 134/139 | .999 | 19 (Rhinonycteridae .93, Vespertilionidae .99) | 25/25 | no dates | CC0 |
| **PHYLACINE 1.2.1 complete** | 5,831 | 4,873 / 4,979 | by file: the small tree holds the 4,253 well-placed | 133/135 | .999 | **21** (two draws of 1,000) | 25/25 | 6/15, ×1.14 | CC0 |
| PHYLACINE small | 4,253 | 3,633 / n/c | all placed | 134/134 | 1.000 | **21** | 25/25 | n/c | CC0 |
| Hedges 2015 (TTOL, smoothed) | 5,364 | 4,415 / 4,533 | n/c | 124/129 | .997 | 18 | 25/25 | **8/15, ×1.10** | n/c; from the TimeTree authors, treat as **lic!** |
| Bininda-Emonds 2007 | 4,510 (530 polytomy nodes) | 3,471 / 3,601 | n/c | 98/121 | .958 | 18 (Cistugidae absent) | 22/24 | 1/15, ×1.29 | n/c |

How to read this:

- **PHYLACINE's perfect families may be partly built in.** The 5,831-tip tree places species without DNA by taxonomy, so high family scores are what that method would produce. I did not re-read the method paper today. F measures agreement with taxonomy, not correct relationships.
- **PHYLACINE's ages lean on one source.** Its deep nodes sit on the Meredith 2011 values in our benchmark (Carnivora 54.7, Primates 71.5, Placentalia 101.4), so its 6/15 is partly circular. It also gives Theria 190, Felidae 9.4 and Panthera 3.8. The same caution applies to Hedges' 8/15, because TimeTree helped set the benchmark ranges.
- **PHYLACINE has no summary tree.** It ships 1,000 posterior draws, so a build would need a summary tree or one chosen draw. It has 352 late-Quaternary extinct species (`EP` 270, `EX` 82).
- **Álvarez-Carretero's weak spot is rodents.** Cricetidae F .72 (503 tips), Heteromyidae .76, Lorisidae .74.
- **Most species are on some tree, but not all.** Across Upham, Álvarez-Carretero, Open Tree, PHYLACINE and Hedges, 5,708 of 6,904 match by name. **1,196 are on no tree** (Rodentia 513, Chiroptera 301, Eulipotyphla 130, Primates 52, Artiodactyla 49, Carnivora 38). 416 of those were described in 2005 or later. The rest may be name changes that these matches miss, so 1,196 is an upper bound. The pipeline grafts these on their genus (`mdd.py`, #278).

**Bats.** No current whole-order species tree better than the above turned up:

| Paper | Scope | Status |
|---|---|---|
| [Foley 2024, *Cell Genomics*](https://par.nsf.gov/servlets/purl/10491975) | *Myotis* only, not the order | Corrects the brief |
| [Amador 2018](https://ri.conicet.gov.ar/handle/11336/55671) | 804 terminals, 9 markers | No tree file found; not scored |
| [Hao 2024](https://onlinelibrary.wiley.com/doi/abs/10.1111/1749-4877.12772) | All 21 families, family level only | Not species level |
| [Guan 2025](https://link.springer.com/article/10.1007/s11427-024-2847-5) | 187 species, 13 families | Partial |
| [Agnarsson 2011](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3038382/) | 648 taxa, cytochrome b | Old, single gene |

Shi & Rabosky 2015: n/c.

Other newer work: [Foley 2023 Zoonomia](https://zenodo.org/records/7958013) has 241 placentals (CC BY 4.0). It could date a backbone only. Its dating archive is 256 MB and was not fetched.

### 1.3 Published trees with living and fossil mammals

| Tree | What it holds | Status |
|---|---|---|
| PHYLACINE | Living + late-Quaternary extinct only | CC0; have the file |
| [Upham FBD](https://github.com/n8upham/MamPhy_v1) | 76 fossil tips (`X_Haldanodon`, `X_Morganucodon`…), backbone only; the 136-taxon backbone tree also has 76 `X_` tips | CC0 (Dryad deposit); fetched and counted |
| [Lloyd & Slater 2021](https://datadryad.org/dataset/doi:10.5061/dryad.vq83bk3qf) | Cetacea: 400+ living and extinct species, dated | Zip about 319 MB, not fetched; licence n/c |
| [Hellert 2023](https://link.springer.com/10.1038/s41559-023-02200-y) | Synapsids, 1,888 species, Carboniferous to Eocene (includes Mesozoic and some early mammals) | See §2; file n/c |
| Slater 2013, Silvestro 2019 | n/c: searches did not surface them | Open |

So the taxonomy-plus-first-appearance graft stays necessary for most fossil mammals. These trees could replace it clade by clade.

### 1.4 Other rows

Ranges: [MDD-taxonomy maps](https://zenodo.org/records/10974868) (v1.3 taxonomy, CC BY 4.0, per-order `.rds`) are worth comparing with PHYLACINE; not opened. Population, mass and pictures stay as in `pipeline/SOURCES.md`.

**Licence flags in what we already use:**

- **Red List:** GBIF's copy declares CC BY 4.0 (read today), but [05](05-population-time-series.md) says IUCN's own terms bar redistribution. We rely on the GBIF label. This needs a decision.
- **PanTHERIA:** no explicit licence (`SOURCES.md`).
- **Open Tree API:** returned an internal connection error today (`could not connect to localhost:1984`). `tolad-fetch` uses it, though the pinned file is already held.

## 2. Next clade up

**Synapsida beyond mammals (fossil only).** PBDB species names, unfiltered: Synapsida 18,658 extinct, Mammalia 17,269, so **about 1,389 non-mammal synapsids**. Hellert's earlier [abstract](https://par.nsf.gov/biblio/10405930) counts about 1,600 non-mammaliaform species and 2,128 in all, more than PBDB, and the [published paper](https://link.springer.com/10.1038/s41559-023-02200-y) gives 1,888 from 269 matrices with names linked to PBDB. This is the best candidate. Its data statement could not be opened (publisher redirect), so availability and licence are **n/c**. Brocklehurst's supertree is older; n/c.

**Amniotes.**

| Need | Birds | Reptiles | Extinct amniotes |
|---|---|---|---|
| List | [AviList v2025](https://www.avilist.org/): 11,131 species, 252 families, 46 orders; licence not found, site refuses scripts. Clements via AvesData. IOC n/c | [Reptile Database](https://www.reptile-database.org/data/): 12,650 species (June 2026), checklist xlsx 1 Oct 2026; no licence found | PBDB: Dinosauria 5,025 (with 1,931 Aves, so about 3,094 non-avian), Squamata 1,265, Testudines 1,581, Crocodylomorpha 903, Pterosauria 391, Plesiosauria 372, Ichthyosauria 301 |
| Tree + dates | **[AvesData 1.7](https://github.com/McTavishLab/AvesData)** (McTavish 2025): 11,167 tips on Clements 2025 (`summary_dated_clements.nex`; `mcc_dated_clements.nex` is 1.8 MB), CC BY, updated yearly. Cornell's release says about 15% are placed by taxonomy; `phylo_only` files hold the rest. BirdTree (Jetz 2012): no licence stated, citation required. Stiller 2024: 363 species, 218 families, backbone only. Kuhl 2021: family level. Wu 2024: n/c | [Tonini 2016](https://datadryad.org/dataset/doi:10.5061/dryad.db005): CC0, 4.6 GB (over limit, tips n/c). [Title 2024](https://datadryad.org/dataset/doi:10.5061/dryad.p5hqbzkvb): CC0, one 2 GB archive (over limit); 5,400 loci across 1,018 species, full tips n/c. Zheng & Wiens 2016, Thomson 2021 (turtles), crocodilians: n/c | Lloyd 2008, Benson 2014: n/c. [Lloyd 2016](https://eprints.whiterose.ac.uk/id/eprint/110088/1/Lloyd_etal_2016a.pdf) dates Mesozoic dinosaurs; not scored. No complete tree found |
| Ranges | BirdLife: 11,000+ species; a [mirror](https://sciencebase.gov/catalog/item/553a7618e4b0a658d792c968) says non-commercial; own terms not read | [GARD 1.7](https://zenodo.org/records/6499637): 10,914 species, CC0, 858 MB | none |
| Population | [Callaghan 2021](https://zenodo.org/records/4723365): 9,700 species, CC BY 4.0, data 237 MB (over limit) | none found | none, modelled only |

**To build the amniote page:**

1. Crosswalks: Clements to AviList if we choose AviList, and Reptile Database to the tree's names.
2. A join: birds, squamates, turtles and crocodilians onto an amniote backbone with agreed ages.
3. PBDB's other 12,938 extinct amniote species (30,207 less Mammalia) through the existing graft (`merge.py`).
4. The same count model, with Callaghan as the bird anchor.

**Missing for good:** individuals per species for all fossils, which can only be modelled. For reptiles I found no abundance dataset. Past ranges outside mammals were not searched.

## 3. All life, broad strokes

Numbers marked `01` or `02` come from those notes and were not re-opened today.

| Group | Best tree | Best list | Fossils (PBDB extinct species) | Individuals alive | Gap |
|---|---|---|---|---|---|
| Bacteria, Archaea | [GTDB r232](https://data.gtdb.ecogenomic.org/releases/latest/) (2026-04-15): latest, CC BY-SA, no time axis | GTDB; NCBI | n/c | 4–6e30 cells (Whitman 1998) | Dates near guesswork; share-alike |
| Viruses | none; [ICTV MSL41](https://ictv.global/msl) (still current) is taxonomy | ICTV, 17,554 species (`01`), CC BY | none | particles, `02` | Not one clade |
| Plants | Smith & Brown 2018, 353,185 tips (`01`); [repo](https://github.com/FePhyFoFum/big_seed_plant_trees) **has no licence**, last pushed 2018 | COL | Plantae 16,163 | n/c | Licence to ask; old |
| Fungi, protists | Open Tree, mostly taxonomy | COL | n/c | n/c | Very large |
| Insects, arthropods | Open Tree, mostly taxonomy | COL | Arthropoda 52,974 | Insects about 1e19, soil arthropods about 1e19, ants at least 2e16 (`02`) | Very large: little time-scaled tree |
| Molluscs | Open Tree | COL | Mollusca 57,285 | n/c | Large; tree tips n/c |
| Fish | [Fish Tree of Life](https://fishtreeoflife.org/): CC0, maintained (repo pushed 2026-11-03); tips n/c | n/c | in Chordata 44,589 | about 1e23 ever (`02`) | Small |
| Amphibians | n/c | n/c | n/c | n/c | n/c |
| Birds, reptiles, mammals | §1, §2 | §1, §2 | §1, §2 | §1, §2 | Smallest |
| Whole tree | [Open Tree 16.1](https://files.opentreeoflife.org/synthesis/): newest listed; CC0 | [COL 26.10](https://api.checklistbank.org/dataset/3LR): CC BY. [GBIF Backbone](https://api.gbif.org/v1/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c): frozen, published 2023-08-28 | Metazoa 192,262 | [Bar-On 2018](https://pubmed.ncbi.nlm.nih.gov/29784790/) gives **biomass, not individuals**; code MIT | OneZoom row from `ozdeep` |

## 4. Not measured

- Per-group COL counts (each API call took tens of seconds).
- Tips and family scores for Tonini, Title, BirdTree, the Fish Tree, Thomson, Zheng & Wiens, and any reptile tree. No bird tree has family scores either, because there was no AviList file to score against.
- OneZoom: left to `ozdeep`.
- PBDB counts are unfiltered names; the pipeline's filtered fetch of Mammalia returns 16,602 records against 17,269 + 3,837 here.
- Files over 200 MB, not fetched: Title (2 GB), Tonini (4.6 GB), GARD (858 MB), Zoonomia dating (256 MB), Callaghan data (237 MB), Lloyd & Slater (319 MB).
- The scoring scripts were one-offs and are not in the repo; the method is in §1.2.
- Literature searches are shallow: a missing paper here means the search did not find it, not that it does not exist.
