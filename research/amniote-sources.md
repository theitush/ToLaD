# The amniote data sources, measured (ToLaD#519)

Checked 2026-11-17 by opening the files. #419 ([tree-sources-2026.md](tree-sources-2026.md) §2) named these sources from their pages; this note counts them. Every number below comes from a script in [`amniote-sources/`](amniote-sources/), run on files under `data/raw/amniotes/<source>/` (gitignored). One row per source, with its licence and citation, is in [amniote-sources.csv](amniote-sources.csv). Licences are recorded, not treated as blockers (Ita, 2026-11-06).

**Lists:** RDB = Reptile Database checklist Oct 2026. Clements = the eBird/Clements v2025 checklist, which is the AvesData 1.7 tip set.
**Matching:** "exact" = genus + epithet equal. "+syn" = also through OTT 3.7.3 synonyms, or through the cross-reference the list ships.

| Need | Birds | Lizards & snakes (+ amphisbaenians) | Turtles | Crocodilians | Tuatara | Extinct amniotes |
|---|---|---|---|---|---|---|
| **List** | Clements 2025: 11,167 species, CC BY (via AvesData) | RDB: 12,293 squamates (7,838 lizards, 4,251 snakes, 204 amphisbaenians); no licence found | RDB: 365 | RDB: 27 | RDB: 1 | PBDB: 4,724 species, 4,394 with a range (CC BY) |
| **Dated tree** | AvesData 1.7: **100%** of the list; 86% placed by data, 14% by taxonomy; CC BY | Title 2024: **57%** (+syn), all placed by DNA; CC0. Runner-up Tonini 2016: 76%, complete but imputed | Colston 2020: **91%** (+syn); CC0. Thomson 2021 is browser-only | Colston 2020: 26 of 27 | Colston / Tonini: 1 of 1 | None complete. Synapsid metatree: 451 of 758 non-mammaliaform synapsids, undated; GPL-3.0 |
| **Fossils that would graft** (family or better: Open Tree synthesis / OTT taxonomy) | 1,273: 70% / 95% | 972: 50% / 95% | 1,068 (stem + crown): 61% / 98% | 630 crocodylomorphs: 22% / 93% | 74: 39% / 88% | 4,394: **21% / 90%** |
| **Counts today** | Callaghan 2021: 81% of the list. 684 species have an independent estimate; the rest are modelled from eBird. CC BY | **No species total measured.** Local densities (TetraDENSITY 2.5, CC BY-NC) for 3.3% of lizards and 1.1% of snakes | densities: 4.9% | densities: 2 of 27 | n/c | none: model only |
| **Lost since 1500** | Red List 2026-1: 164 EX + 5 EW (149 already on the tree). No present-natural ranges | Red List: 31 EX + 2 EW across all reptiles (24 in RDB). No present-natural ranges | ← | ← | ← | n/a |
| **Ranges today** | BirdLife BOTW: by request only, not fetched | GARD 1.7: **80%** (lizards 81%, snakes 78%, amphisbaenians 91%); CC0. Range areas are in the 3.4 MB .dbf; the shapes need an 855 MB download | GARD: 89% | GARD: 24 of 27 | GARD: 1 of 1 | none |
| **Mass** | AVONET: **90%**; CC BY | ReptTraits 1.2: 80% lizards, 80% snakes, 76% amphisbaenians, mostly derived from length; CC BY | 85% | 24 of 27 | 1 of 1 | n/c |
| **Generation length** | Bird et al. 2020: all species, mostly modelled; not fetched | **none.** Only maximum longevity (ReptTraits): 10% lizards, 13% snakes | longevity: 63% | longevity: 25 of 27 | longevity: 1 of 1 | none |
| **Names / pictures** (Wikidata, 200-species sample) | names 95%, pictures 89% | names 33%, pictures 32% (any reptile) | ← | ← | ← | n/c |

**The real size is about 50,100 tips: 30,870 living and 19,231 fossil** (§10). That is the speed target for #502, against the yardstick's 31k.

## The join (recommended)

**Topology.** Use one Open Tree 16.1 synthesis subtree, Amniota (`ott229560`), with 41,371 tips. Our build reads Mammalia (`ott244265`) today; this reads one node higher. The living backbone in it is right:
- Amniota splits into Mammalia and Sauropsida.
- Sauria splits into Lepidosauria and a 19,935-tip node of turtles plus archosaurs (Archelosauria).
- Inside that, crocodilians and birds share a 19,045-tip node.

It has two faults:
- **Archosauria, Crocodylia and Dinosauria are not nodes** ("broken" taxa; Squamata has a node only under its homonym-qualified label).
- **An 85-tip clade of non-avian dinosaurs, *T. rex* among them, sits next to Lepidosauria**, not with the birds.

Its extinct tips are taxonomy-placed, so the build should drop them and graft every fossil from PBDB, as it already does for mammals.

**Dates per subtree.** Each group's tree dates the Open Tree nodes it agrees with (`merge.calibrate`). The rest is interpolated, as `tree.py`/`dated.py` do with Upham for mammals:

| Subtree | Date source | How the tips join Open Tree |
|---|---|---|
| Mammals | Upham 2019 (have) | as today |
| Birds | AvesData 1.7 summary MCC | By OTT id: the release's crosswalk carries an `ott_id` per Clements species, so no name matching is needed |
| Squamates | Title et al. 2024, 6,885 tips | By name + OTT synonyms, 57% of RDB. RDB species not on the tree go onto their genus, as `mdd.py` does for MDD species |
| Turtles, crocodilians, tuatara | Colston et al. 2020 (one posterior draw; the MCC needs the 156 MB set) | By name + synonyms, 91% / 26 of 27 / 1 of 1 |

**Backbone ages.** Five splits sit above the subtrees. Take all five from one source, TimeTree 5's pairwise medians (Kumar et al. 2022), and record them as `[[dated_clade]]` with their intervals:
- Amniota 318.8 Ma (316.7–321.0);
- Sauria 280.7 (276.6–284.8);
- Archelosauria 256.8 (249.0–264.7);
- Archosauria 243.3 (239.6–247.0);
- Lepidosauria 245.0 (236.6–253.4).

TimeTree's Archosauria (243.3) is younger than Benton 2015's hard minimum of 247.1 Ma. The build's existing rule fixes this without a hand value: a node is older than its oldest grafted fossil. Every subtree crown falls below its backbone split, so the pieces nest.

| Split | TimeTree 5 | Benton et al. 2015, hard min / soft max | Fetched trees |
|---|---|---|---|
| Amniota | 318.8 | 318.0 / 332.9 | Upham 319.5 |
| Sauria (lepidosaurs vs turtles + archosaurs) | 280.7 | 255.9 / 295.9 | Colston 276.5 |
| Archelosauria (turtles vs archosaurs) | 256.8 | n/a | Colston 264.0 |
| Archosauria (crocodilians vs birds) | **243.3** | **247.1** / 260.2 | n/a |
| Lepidosauria (tuatara vs squamates) | 245.0 | 238.0 / 252.7 | Tonini 246.9 |
| Crown Squamata (*Gekko* vs *Anolis*) | 200.1 | 168.9 / 209.5 | **Tonini 171.9, Title 213.2** |
| Crown Serpentes | 123.1 | n/a | Tonini 108.3, Title 120.3 |
| Crown Testudines | 197.7 | n/a | **Colston 176.7, Thomson 208** (183–236) |
| Crown Crocodylia | 88.0 | n/a | Colston 93.1 |
| Crown Aves | 107.6 | 66.0 / **86.8** | **AvesData 99.0** |

**Where the ages conflict (bold):**
- Archosauria: TimeTree is younger than the fossil minimum.
- Squamata: Tonini and Title differ by 41 Myr. Title is above Benton's soft maximum.
- Turtles: Colston and Thomson differ by 31 Myr.
- Birds: every molecular age is above Benton's soft maximum; AvesData's own README gives a root range of 72–133 Ma across studies.

**Fossils.** Use the existing graft (`merge.graft_pbdb`) on a PBDB Amniota download, with one general change. Where the synthesis has no node for a fossil's genus, family or order, graft through the OTT taxonomy path. OTT holds the clades that synthesis filters out: ichthyosaurs and sauropterygians are flagged `hidden`/`incertae_sedis`, and OTT has no Synapsida node at all. Measured on all 19,246 graftable amniote fossils:

| Fossils landing in the incertae-sedis bucket | Open Tree synthesis | OTT taxonomy |
|---|---|---|
| All amniotes | 6,394 (33%) | 411 (2%) |
| Extinct-only groups | about 79% | 8% |

## Missing for good

- **Individuals per species for reptiles.** No compilation gives a species total for any squamate.
  - Measured: local densities (individuals per area at one site). TetraDENSITY 2.5 holds 1,172 estimates for 259 lizards, 166 for 48 snakes, 457 for 18 turtles and 6 for 2 crocodilians.
  - Turning those into a species total takes density × range area × occupancy. That is a model.
  - **Without a model, reptile counts stay unknown.** Using our mammal model for them would mean fitting it anew to reptiles. That is Ita's call, so it is not proposed here.
- **Birds: mostly model.** Callaghan 2021's 9,700 totals are an eBird detectability model trained on 684 species with independent estimates (PIF, BTO, BirdLife). Only those 684 are census- or expert-grade. The median 95% interval spans a factor of about 8,000.
  - BirdLife's own population figures (the Red List "number of mature individuals") are expert estimates for most species. They need the IUCN API (token) or a request, and were not measured.
- **Fossil individuals:** model only, as for mammals.
- **Generation length:** none for reptiles. For birds, Bird et al. 2020 is modelled from survival, longevity and age at first breeding.
- **Ranges before people (present-natural):** none found for birds or reptiles. The only post-1500 maps are range parts coded "Extinct"/"Possibly Extinct" in BirdLife and IUCN polygons, where assessors drew them. GARD has none.
- **Dated trees of fossils:** none complete for any extinct group.
- **Reptile common names and pictures:** about a third on Wikidata. The Reptile Database has photos for 7,203 of its 12,687 species, but they are its own and not openly licensed.

## Downloads Ita must run

Rates measured today: Zenodo **0.48 MB/s** (30 MB in 65 s), data.vertlife.org **1.4 MB/s**, GitHub raw 1–2.5 MB/s.

**Sites that refuse scripts:**
- **Dryad:** file listing works, but a download returns 401 from the API (a bearer token is needed) and 403 from the web link.
- **AviList:** Cloudflare 403.
- **figshare:** `ndownloader` returns 403, but `api.figshare.com/v2/file/download/<id>` works.
- **Nature:** pages redirect to a login.

| What | Size | Time at measured rate | Command / how |
|---|---|---|---|
| GARD 1.7 range shapes (needed for the globe) | 854,546,856 B | ~30 min | `curl -C - --retry 20 --retry-delay 10 --retry-all-errors -L -o ~/ToLaD/data/raw/amniotes/gard17/Gard_1_7_ranges.shp https://zenodo.org/api/records/6499637/files/Gard_1_7_ranges.shp/content` (the .dbf/.shx/.prj/.cpg are already there; Zenodo honours ranges, so a rerun resumes) |
| Tonini 2016 full posterior (only if a squamate summary tree is wanted; one draw is already read) | 1,882,223,234 B | ~22 min | `curl -C - --retry 20 --retry-delay 10 --retry-all-errors -L -o ~/ToLaD/data/raw/amniotes/tonini2016/squam_shl_new_Posterior_9755.1000-10000.trees.zip https://data.vertlife.org/squamatetree/squam_shl_new_Posterior_9755.1000-10000.trees.zip` |
| Thomson 2021 turtle MCC (`bd.mcc.median_heights.tre`, 311 KB, + `ReadMe.txt`) | 0.3 MB | browser | https://datadryad.org/dataset/doi:10.5061/dryad.jh9w0vt8w → save to `data/raw/amniotes/thomson2021/` |
| Tonini 2016 methods zip (says which tips had DNA) | 6.5 MB | browser | https://datadryad.org/dataset/doi:10.5061/dryad.db005 (`Squamata_Tree_Methods_Data.zip`) → `data/raw/amniotes/tonini2016/` |
| AVOTREX (610 extinct birds, with placements) | small | browser | https://datadryad.org/dataset/doi:10.5061/dryad.zgmsbcckk → `data/raw/amniotes/avotrex/` |
| BirdLife bird range maps (BOTW) | several GB (not measured) | a request | BirdLife DataZone data-request form (datazone.birdlife.org). A person must ask; the terms are non-commercial, with no redistribution of the polygons |
| IUCN reptile range maps (optional; GARD covers 80%) | n/c | an account | iucnredlist.org → Spatial data download, "Reptiles" |

## Recommended build order (small steps for workers)

This is a recommendation; each step is checkable on its own.

1. **Fetch and pin** the fetched sources in `fetch.py` and `sources.lock.json`:
   - AvesData 1.7 summary MCC + Clements 2025 crosswalk;
   - RDB 2026-10;
   - Title 2024 time-calibrated tree;
   - Colston 2020 (one named draw);
   - the PBDB Amniota species and genera;
   - the Open Tree Amniota subtree;
   - the OTT Amniota cut (`ott_amniota.py`).
2. **Birds alive:** an Amniota Open Tree subtree with Aves dated by AvesData, joined on OTT ids, with Clements as the list. Check: 11,167 species and a 99 Ma crown.
3. **Squamates + tuatara alive:** dated by Title 2024 with RDB as the list. The roughly 5,200 RDB species not on the tree go onto their genus (the `mdd.py` mechanism).
4. **Turtles + crocodilians alive:** dated by Colston 2020; swap to Thomson 2021 for turtles once Ita downloads it.
5. **Backbone:** the five TimeTree splits as cited `[[dated_clade]]` entries, with fossils setting minima.
6. **Fossils:**
   - PBDB Amniota through `graft_pbdb`, with the OTT-taxonomy path for missing nodes (bucket 33% → 2%);
   - drop the synthesis's extinct tips;
   - AVOTREX for the 610 recently extinct birds once downloaded.
7. **Traits:** AVONET mass (birds), ReptTraits mass (reptiles), Bird 2020 generation length (birds, once its SI is fetched). Reptiles have no generation length: show it as missing.
8. **Ranges:** GARD `.dbf` areas now; GARD shapes onto the globe grid after Ita's download; birds wait for BirdLife.
9. **Counts:**
   - Birds: Callaghan totals, graded as model except its 684 training species.
   - Reptiles: **DECIDE (Ita)**, either no count or a new reptile fit of the mammal model. Not proposed here.
10. **Names and pictures:** `wiki.py` over the new species.
11. **Speed:** #502 against about 50k tips (§10) before the page ships.

---

## Details per need

### 1. Lists and crosswalks (`birds_lists.py`, `reptiles.py`)

IOC's own cross-reference (`IOC_15.2_vs_other_lists.xlsx`) aligns four bird lists row by row. AviList is counted from that file because its own site refuses scripts.

| Bird list | Species | In AvesData exact | After the IOC-row crosswalk |
|---|---|---|---|
| Clements v2025 | 11,167 | 11,167 (100%) | 100% |
| AviList v2025 | 11,131 | 11,109 (99.8%) | 99.9% |
| IOC 15.2 | 11,227 (163 marked extinct, † or ††) | 11,097 (98.8%) | 99.3% |
| HBW/BirdLife v10 | 11,185 | 10,331 (92.4%) | 96.9% |

The AvesData crosswalk also maps every Clements species to the Howard & Moore v4, BirdLife and IOC v14.1 names (the IOC concept matches for 10,695), and to OTT.

**RDB Oct 2026:** 12,687 species:
- lizards 7,838;
- snakes 4,251;
- amphisbaenians 204;
- turtles 365;
- crocodilians 27;
- tuatara 1;
- one with no order.

The checklist (733 KB xlsx) has no synonyms, so the "+syn" step uses OTT 3.7.3's.

### 2. Dated trees (`birds_tree.py`, `reptiles.py`, `backbone_ages.py`)

| Tree | File, size | Tips | Of the list: exact / +syn | Notes |
|---|---|---|---|---|
| AvesData 1.7 (McTavish et al. 2025) | `summary_dated_clements.nex`, 2.1 MB (`mcc_dated_clements.nex` 1.8 MB) | 11,167 | 100% | 9,603 placed by data, 1,564 by taxonomy. By input trees per tip: 6,899 have ≥5, 1,196 have 1, 37 have 0 |
| Title et al. 2024 | `squamates_Title_Science2024_ultrametric_constrained.tre`, 297 KB, from the authors' repo | 6,885 | 53.3% / 57.4% of 12,293 | All with DNA. The repo's "imputed" trees use placeholder tips (`Ficimia_xzx3`), so they are unusable for names |
| Tonini et al. 2016 | one posterior draw, read by range from the vertlife zip | 9,755 | 70.2% / 75.8% | Complete by imputation; the file does not mark which tips had DNA. 1,124 tips are not RDB names |
| Zheng & Wiens 2016 | journal SI | 4,162 (paper) | n/c | Not fetched |
| Colston et al. 2020 | Zenodo, 10,000 trees, 156 MB; draw 1 read by range | 386 | turtles 91.0%, crocodilians 26/27, tuatara 1/1 | CC0. Its ML tree (26 KB) is also fetched |
| Thomson et al. 2021 | Dryad, `bd.mcc.median_heights.tre` 311 KB | 288 | n/c | 279 of 348 species with data (paper); 22 fossil calibrations. Download refused |
| BirdTree (Jetz 2012) | n/c | 9,993 | n/c | Older taxonomy; runner-up only |

### 3. Open Tree 16.1, Amniota (`opentree_amniota.py`)

41,371 tips:
- Aves 18,885;
- Squamata 11,633;
- Mammalia 9,016;
- Testudines 882;
- non-avian dinosaurs 294;
- pterosaurs 62;
- Crocodylia 45;
- Rhynchocephalia 3;
- 544 tips with non-standard labels.

Only 14,695 of the bird tips are binomials; the rest are subspecies and similar. Roughly 700 tips carry OTT's `extinct` flag. The build keeps only listed species (`drop_unrecognised`), so the tip count is not the size.

### 4. Fossils (`fossils.py`)

**Data:** PBDB `taxa/list` for Amniota (species, accepted, regular preservation): the query `fetch.py` makes for Mammalia. That is 11.5 MB, with a 6 MB genus list beside it. Each species is assigned its group through per-group PBDB lists.

**Ladder:** `merge.graft_pbdb`'s, run against the synthesis subtree and against OTT. On mammals it reproduces the real build to within about 20%:
- under a genus: 1,246 here vs 1,043 in the build;
- under a family: 3,803 vs 4,346;
- under an order: 3,564 vs 3,017;
- in the bucket: 2,549 vs 2,618.

| Group | PBDB species | extant | graftable | synth: leaf / genus / family / order / bucket | OTT: leaf / genus / family / bucket | first appearance, Ma (median; range) |
|---|---|---|---|---|---|---|
| Birds | 3,577 | 1,832 | 1,273 | 325 / 331 / 235 / 135 / 247 | 861 / 252 / 100 / 19 | 14.4; 0–158 (56 Mesozoic) |
| Lizards & snakes | 1,663 | 635 | 972 | 30 / 147 / 306 / 489 / 0 | 675 / 194 / 52 / 0 | 53.5; 0–256 |
| Turtles (crown) | 1,399 | 400 | 932 | 186 / 234 / 217 / 294 / 1 | 593 / 238 / 86 / 0 | 52.0; 0–230 |
| Stem turtles | 143 | 0 | 136 | 10 / 1 / 4 / 0 / 121 | 95 / 22 / 15 / 4 | 137.8 |
| Crocodilians (crown) | 292 | 31 | 236 | 0 / 46 / 92 / 0 / 98 | 116 / 87 / 16 / 0 | 35.8; 0–167 |
| Other crocodylomorphs | 411 | 1 | 394 | all bucket | 215 / 109 / 42 / 28 | 121.8 |
| Rhynchocephalians | 83 | 2 | 74 | 1 / 1 / 27 / 3 / 42 | 45 / 9 / 11 / 8 | 183.6 |
| Non-avian dinosaurs | 1,893 | 97* | 1,717 | 247 / 105 / 355 / 30 / 980 | 1,176 / 105 / 214 / 214 | 108.2; 0–244 |
| Pterosaurs | 277 | 1 | 255 | 62 / 20 / 66 / 0 / 107 | 199 / 8 / 30 / 0 | 118.8 |
| Marine reptiles (ichthyosaurs, sauropterygians, thalattosaurs) | 506 | 0 | 467 | all bucket | 208 / 179 / 61 / 8 | 187.9 |
| Non-mammal synapsids | 828 | 1 | 786 | all bucket | 465 / 195 / 59 / 35 | 257.0; 59–318 |
| Other archosaurs | 178 | 0 | 168 | 12 / 9 / 4 / 0 / 143 | 107 / 33 / 16 / 12 | 221.3 |
| Parareptiles | 115 | 0 | 112 | all bucket | 76 / 16 / 11 / 9 | 255.9 |
| Choristoderes | 33 | 0 | 32 | all bucket | 22 / 4 / 2 / 0 | 114.8 |
| Other amniotes | 340 | 0 | 327 | 1 / 0 / 10 / 1 / 315 | 211 / 26 / 21 / 25 | 245.7 |
| Mammals (for scale) | 16,364 | 2,472 | 11,365 | 203 / 1,246 / 3,803 / 3,564 / 2,549 | 6,856 / 3,633 / 679 / 49 | 25.0 |

\* The 97 "extant" non-avian dinosaurs are living birds that PBDB's `Aves` base name does not reach. That is a PBDB grouping quirk; they would be skipped as living.

**Published trees that place fossils:**
- **Synapsids:** [Lloyd's synapsid metatree](https://github.com/graemetlloyd/ProjectCalfFace) (GPL-3.0), the basis of Hellert et al. 2023.
  - Its most-parsimonious trees (`Trees/MPTs.tre`, 35 MB) have 1,560 species tips: 1,511 are PBDB synapsids, of which 451 are non-mammaliaform (59.5% of PBDB's 758).
  - The trees are undated. Hellert's time-calibrated metatree has 1,888 species; the paper says its data are "in the Supplementary Information", which was not fetched (Nature redirects to a login).
- **Dinosaurs:**
  - Lloyd et al. 2008 supertree: 440 species, about 70% of the valid species then (abstract).
  - Benson et al. 2014: composite trees of 614–622 Mesozoic dinosaurs and birds (PLoS SI).
  - Lloyd et al. 2016 dates: not opened.
- **Pterosaurs and marine reptiles:** only clade matrices (for example Andres et al. 2014; ichthyosaur and plesiosaur matrices). None was opened.
- **Recently extinct birds:** AVOTREX (Sayol et al. 2024): 610 species from the last 130,000 years, with an R package that grafts them onto BirdTree (Dryad).

### 5. Counts today (`birds_traits_counts.py`, `densities.py`)

**Callaghan et al. 2021.** The per-species estimate is `Tables/all_species_summary_table.csv`, 1.16 MB, inside `Tables.zip` (1.05 MB) on Zenodo 4723365. Its 248 MB `Data.zip` and 8.7 GB `eBird data.zip` are not needed.
- Coverage: 9,700 species; 8,864 Clements 2025 names exact, 9,074 after OTT synonyms (81.3%).
- Columns: lower and upper 95% CI, `Range adjusted` (6,969), `Training species` (684).
- The estimates sum to 50.5 billion.

**Reptiles.** TetraDENSITY 2.5 (15 MB CSV) is the largest density compilation found. It is site densities, not totals. The Novosolov and Buckley lizard compilations it draws on were not opened separately.

### 6. Since 1500 (`redlist_amniotes.py`)

**Red List 2026-1** (the GBIF copy the mammal build already pins):

| | Assessed | EX + EW | Matched to the list |
|---|---|---|---|
| Birds | 11,185 (the BirdLife taxonomy) | 164 + 5 | 92.5% of Clements by exact name |
| Reptiles | 10,371 | 31 + 2 | 79.0% of RDB |

The GBIF copy has no extinction dates. IOC marks 163 species † or ††. Nothing like PHYLACINE's present-natural ranges was found for either class.

### 7. Ranges (`gard.py`)

**GARD 1.7:** 10,914 species. The `.dbf` has `binomial`, `group`, `family` and `area`; `area` has a median of 19,302, presumably km². So the count model's range area A needs only the 3.4 MB attribute table. The globe needs the 855 MB shapes.

**BirdLife and IUCN maps** are polygons with presence codes (extant / possibly extinct / extinct). Our globe reads PHYLACINE's equal-area grid, so both would be rasterised onto it.

### 8. Mass and life history (`birds_traits_counts.py`, `reptile_traits.py`)

**AVONET**, eBird-taxonomy sheet: every one of its 10,661 species has a mass.
- Sources: Dunning 8,515, newer literature 690, from a split 509, inferred 454, EltonTraits genus average 283; 752 values are flagged as inferred.
- Joined to Clements 2025 by name, then Avibase id, then older name: 10,072 (90.2%).

**ReptTraits 1.2:** 12,060 species, of which 319 are not RDB 2026-10 names. Per-value sources for maximum mass:
- 6,561 cite Slavenko or Meiri, whose masses are largely computed from maximum length;
- 471 cite Feldman et al. 2016's length–mass equations.

Maximum longevity is the only life-history field near generation length.

### 9. Names and pictures (`wikidata_sample.py`)

Method: 200 random species per class (seed 519), asked by taxon name (P225) the way step 1 of `wiki.py` asks. Its later steps (OTT id, aliases, the English taxobox image) would add some.

| | Item | Picture (P18) | English name | English article |
|---|---|---|---|---|
| Birds | 197 | 177 | 190 | 187 |
| Reptiles | 192 | 64 | 66 | 171 |

### 10. The real size

| Group | Living (list) | Fossils that would graft (PBDB, extinct with a range) | Total |
|---|---|---|---|
| Mammals (current build) | 7,017 | 11,350 | 18,367 |
| Birds | 11,167 | 1,273 | 12,440 |
| Lizards, snakes, amphisbaenians | 12,293 | 972 | 13,265 |
| Turtles (crown + stem) | 365 | 1,068 | 1,433 |
| Crocodilians + crocodylomorphs | 27 | 630 | 657 |
| Tuatara + rhynchocephalians | 1 | 74 | 75 |
| Non-avian dinosaurs | 0 | 1,717 | 1,717 |
| Pterosaurs | 0 | 255 | 255 |
| Marine reptiles | 0 | 467 | 467 |
| Non-mammal synapsids | 0 | 786 | 786 |
| Other (archosaurs, parareptiles, choristoderes, rest) | 0 | 639 | 639 |
| **All amniotes** | **30,870** | **19,231** | **50,101** |

About 38% of the tips are fossils.

**This is an upper bound by a few hundred.** Some extinct records are already tips: Clements carries 149 birds lost since 1500. Recognising more fossils (AVOTREX; the non-binomial PBDB names) would add a few hundred.

## Not measured

- Tonini's data-placed tip count (the methods zip is browser-only).
- Thomson 2021's tree and Hellert's dated metatree (both need a browser).
- Zheng & Wiens 2016, Lloyd 2016, the pterosaur and marine-reptile matrices.
- BirdLife's population and range data (request only).
- Bird et al. 2020's values.
- Turtle checklist ranges (TTWG 2021).
- Sea-turtle nesting counts.
- Tuatara census.

Literature searches were short: a source missing here was not found, not shown not to exist.
