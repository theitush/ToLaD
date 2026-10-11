# Which dated mammal tree should the fan use? (ToLaD#145)

The fan's tree comes from Upham et al. 2019's node-dated MCC tree. Its split dates look young next to the literature.
This note checks whether we read the file wrong, benchmarks four candidate sources on 15 nodes, and recommends one.
Measured 2026-10-11. The scripts were one-offs, run on the pinned files plus the downloads listed below.

## 1. Is Upham really this young? Yes. We read the file correctly.

- **The field we read is the right one.** `dated.py` uses TreeAnnotator's `height`, which is the posterior **mean** height of the clade.
  The median (`height_median`) differs by under 5% on every benchmark node; for crown Felidae it is 6.92 instead of 7.21.
  The branch lengths are a different set: they are the target tree's own heights, not a summary.
  For example, Homo–Pan is 5.38 Ma from branch lengths but has a `height` of 4.17.
  Upham's own table `_DATA/divTime_allTable_…_NDexp_MCC_v2_target_95pHPDs_allClades.csv` has both columns: `MCC_height` matches the branch lengths and `heightMean` matches `height`.
  For Felidae those are 7.10 and 7.21; for Carnivora, 40.46 and 40.23.
- **Upham's own comparison has the same young ages.** Their Fig. 4 table, `_DATA/compare_mamPhy_cladeDivTimes_toPlot_reducedNew.csv`, lists crown Carnivora as 40.2 Ma (33.9–47.9).
  Meredith et al. 2011 give 54.7, dos Reis et al. 2012 give 54.2 and Bininda-Emonds et al. 2007 give 63.4.
  Caniformia is 34.5 against 46.5 and 41.8. Whippomorpha is 39.3 against 53.7 and 48.1, and against a fossil minimum of 52.5 (Foley et al. 2016).
  The young ages are a property of the NDexp dating itself, not of how we read it.
- **Upham's other published summary is younger still.** The fossilized-birth-death MCC (`…topoCons_FBDasZhouEtAl_MCC_v2_target.tre`, same commit) puts Carnivora at 34.5 and Felidae at 6.2. It is not a fix.
- **Some Upham ages are younger than the oldest fossils of the same clade.** Fossils give hard minimum ages, so these are contradictions, not just disagreements:
  - Homo–Pan: 4.17 Ma, HPD 2.9–5.4. That whole interval is younger than *Orrorin* (~6 Ma) and *Sahelanthropus* (~7 Ma).
  - Crown Cetacea (whale–dolphin): 17.4 Ma (13.6–21.4). The earliest mysticetes are ~34–36 Ma.
  - Cetacea–hippo: 39.3. *Himalayacetus* is ~52.5 Ma.
  - Crown Panthera: 3.72. *Panthera blytheae* is 4.1–5.95 Ma (Tseng et al. 2014).

  This also hurts the pipeline's stem-rehoming rule. A crown that is dated too young sends real crown fossils to the stem.
- **The MCC topology is weak where species were imputed.** In the MCC, 3,242 of 5,911 internal nodes have posterior < 0.5, and 1,137 have posterior < 0.01.
  One example is the MCC's Mus–Rattus node (606 murids). Its posterior is 1e-4 and it has no HPD. Its height is 26.3 Ma, against the standard calibration of 10.4–14 Ma.

## 2. Candidates

| | Upham et al. 2019 NDexp MCC (now) | Álvarez-Carretero et al. 2022 | TimeTree 5 (Kumar et al. 2022) | OneZoom / Duke et al. 2026 |
|---|---|---|---|---|
| Coverage | 5,911 species. 4,098 have DNA; the other 1,813 are imputed by taxonomy | 4,705 tips = 4,071 binomials (some tips are subspecies). 3,699 match Upham names exactly; 373 are synonyms, new splits or genus-only labels. Carnivora: 222 of Upham's 298, Felidae 34 of 41 | 137k species across all life. Pairwise ages for any two taxa | 7,965 mammal tips (7,633 binomials; includes OTT names the checklists drop) |
| Dating | 31-gene supermatrix, node-dated (17 fossil calibrations, exponential priors) | 72 genomes (15k loci) date the backbone; 182 loci for the 4,705 taxa, sequential Bayesian (MCMCtree) | Median of published studies per node | Median over 334 OpenTree chronograms, the rest interpolated |
| License | CC0 (Dryad) | **CC BY 4.0** (figshare deposit; the GitHub repo's GPL-3.0 covers its code) | **No redistribution** of its data "and its transformations" | CC BY 4.0 |
| Pinned URL | `raw.githubusercontent.com/n8upham/MamPhy_v1/740b7018…/_DATA/MamPhy_fullPosterior_BDvr_Completed_5911sp_topoCons_NDexp_MCC_v2_target.tre` | `raw.githubusercontent.com/sabifo4/mammals_dating/4c564448c0a99f84aa78f34f05dc24b926cdcbf6/02_SeqBayes_S2/03_Generate_final_mammal_tree/4705sp.tree`. Byte-identical to `timetrees/01_step2/4705sp_mammal-time.tree` in figshare doi:10.6084/m9.figshare.14885691 (verified by extracting it from the 465 MB zip) | `https://timetree.org/api/pairwise/<ncbi>/<ncbi>` (CSV), queried per pair. No bulk tree file | `zenodo.org/api/records/19049120/files/birth_model_median_tree.tre/content` (146 MB, all life) |
| sha256 | `480017aa53a786858d455c5881db7f2d1eeea9f8a174d7e4ff498a1c55745d3f` | `c2914c4f99742bdabd58c17d89ebb9b67b34f0d3c1dd8c8caf35ee1a33f85aa8` (515 KB) | n/a | `40663df1a7c3bce19e7abe352b5d9b5a08234dd4599bb5eb9be1dfc5c0684ef7` |
| Format | NEXUS, TreeAnnotator annotations | NEXUS. Ages in units of 100 Myr; `[&95%={lo, hi}]` per node. Also mean / 2.5% / 97.5% Newick files | CSV per query | Newick, ages in Ma, OTT ids in the labels |
| Uncertainty | 95% HPD per node | 95% CI per node | 95% CI per pair | None in the median tree; distributions only in 5–66 GB tarballs |

Upham's FBD MCC (sha256 `08d5a18769feeaf2a229c3ac1274ca776e668452766c846a453493b6b50d335c`) is in the benchmark below as Upham's "other summary".

## 3. Benchmark (Ma)

Each node is the MRCA of the species named in its row. The consensus is a deliberately wide range compiled for this note:

- dos Reis et al. 2012 (DR) and Meredith et al. 2011 (M), as quoted in Upham's Fig. 4 table;
- fossil bounds from Foley et al. 2016 and the minima named in §1;
- for the shallow nodes, the brief's citations (Johnson et al. 2006 and Li et al. 2016 for Felidae; Figueiró et al. 2017 for Panthera) and the standard Mus–Rattus calibration;
- the TimeTree 5 pairwise median, which also went into most ranges. That makes TimeTree's score below partly circular.

95% intervals are in brackets.

| Node (MRCA of) | Consensus | Upham ND (now) | Upham FBD | Álvarez-Carretero 2022 | TimeTree 5 | OneZoom median |
|---|---|---|---|---|---|---|
| Homo–Pan (human, chimp) | 6–8 | **4.17** (2.9–5.4) | 4.16 | 9.08 (8.2–9.8) | 6.45 (6.2–6.7) | 6.74 |
| Crown Panthera (tiger, lion) | 4–6.5 | 3.72 (2.7–4.8) | 3.18 | **10.31** (8.9–11.6) | 5.34 | 6.60 |
| Crown Felidae (lion, cat) | 11–16 | **7.21** (5.2–9.1) | 6.17 | 19.88 (17.8–21.8) | 13.80 (12.0–15.7) | 16.30 |
| Crown Canidae (dog, grey fox, red fox) | 9–14 | 9.18 (7.4–11.2) | 7.87 | **27.00** (24.1–29.8) | 13.90 | **32.34** |
| Crown Ursidae (panda, brown bear) | 17–22 | **10.07** (7.7–12.7) | 8.61 | 23.64 (20.2–26.6) | 19.88 | 18.90 |
| Crown Pinnipedia (harbour seal, sea lion) | 22–27 | **13.84** (10.9–16.7) | 11.85 | 26.37 (24.0–27.6) | 24.59 | 23.65 |
| Caniformia: dog–bear | 42–50 (DR 41.8, M 46.5) | 34.53 (28.6–40.4) | 29.56 | 46.18 (44.3–48.1) | 44.94 | 57.00 |
| Crown Carnivora: dog–cat (= Caniformia–Feliformia) | 50–60 (DR 54.2, M 54.7) | **40.23** (33.9–47.9) | 34.45 | 51.73 (49.7–53.7) | 53.66 | 66.97 |
| Mus–Rattus | 10.4–14 | 26.27 (posterior 1e-4, no HPD) | 16.81 | 11.93 (10.5–13.3) | 13.27 | 21.51 |
| Cetacea–Hippo (Whippomorpha) | ≥52.4, ~52–58 | **39.32** (32.7–46.4) | 34.09 | 48.13 (47.7–49.0) | 53.01 | 51.83 |
| Crown Cetacea (blue whale, bottlenose) | 34–38 | **17.44** (13.6–21.4) | 15.11 | 33.58 (31.4–35.8) | 33.55 | **47.34** |
| Crown Primates (human, ring-tailed lemur) | 65–75 (DR 68.2, M 71.5) | 67.12 (57.6–76.9) | 66.80 | 63.10 (61.8–64.3) | 71.65 | 71.99 |
| Euarchontoglires (human, mouse) | 76–90 (DR 75.7, M 83.3) | 77.00 (67.8–87.3) | 76.75 | 69.81 (68.3–71.4) | 83.51 | 82.57 |
| Crown Placentalia (human, armadillo, elephant) | 85–100 (DR 89.2, M 101.3) | 91.82 (77.4–105.0) | 94.07 | 80.29 (77.6–83.3) | 96.97 | **129.25** |
| Theria (human, kangaroo) | 157–170 | 159.58 (156.3–166.2) | 189.25 | 141.84 (123.3–166.2) | 159.16 | 157.71 |

Bold marks ages that are off by more than a third, or that contradict a fossil minimum.

**Score against the consensus** (15 nodes): how many fall inside the range, and the median factor by which a source misses the geometric midpoint.

| Source | Inside range | Median factor off | Systematic pattern |
|---|---|---|---|
| TimeTree 5 | 14 / 15 | ×1.04 | None (but partly circular, see above) |
| Álvarez-Carretero 2022 | 4 / 15 | ×1.15 | Too old below ~25 Ma (Homo–Pan, Panthera, Felidae, Canidae), right at 25–55 Ma, a bit young at the deepest nodes |
| OneZoom median | 6 / 15 | ×1.22 | Erratic: Canidae 32, Carnivora 67, crown Cetacea 47, Placentalia 129 |
| Per-node geometric mean of Upham ND and A-C | 5 / 15 | ×1.20 | Cancels at shallow nodes, but is too young at the Carnivora level |
| Upham ND (now) | 5 / 15 | ×1.37 | Too young at every node under ~60 Ma; four fossil-minimum contradictions |
| Upham FBD | 3 / 15 | ×1.59 | Younger still |

**A-C against Upham on every clade both trees share.** There are 2,257 clades with an identical species set on the 3,699 shared species. On those clades, the ratio of A-C's age to Upham's depends on Upham's age:

| Upham age | Clades | Median A-C/Upham | IQR |
|---|---|---|---|
| 0–2 Ma | 509 | 1.71 | 1.15–2.56 |
| 2–5 Ma | 656 | 1.55 | 0.87–2.08 |
| 5–10 Ma | 549 | 1.40 | 0.80–1.76 |
| 10–20 Ma | 328 | 1.24 | 0.78–1.57 |
| 20–40 Ma | 146 | 1.08 | 0.86–1.34 |
| 40–70 Ma | 53 | 0.99 | 0.82–1.11 |
| 70–200 Ma | 16 | 0.89 | 0.86–0.93 |

The two sources agree at the ordinal level. Below the family level they disagree by a factor of 1.4–1.7, and the benchmark puts the truth between them: Upham runs about ×0.6 and A-C about ×1.5 at shallow nodes.

## 4. Recommendation

**Use Álvarez-Carretero et al. 2022 for the ages. Keep Upham for the species and the topology A-C lacks.**

- **Licence.** TimeTree would score best, but its terms forbid exactly what ToLaD does, so it stays a spot check.
- **OneZoom** is too erratic for mammals.
- **Upham** is too young at every node under ~60 Ma (about ×0.6–0.75 across Carnivora), and it contradicts fossil minima for hominins, crown cetaceans, whippomorphs and Panthera.
- **A-C** is the only open, species-level, phylogenomically dated mammal tree that lands in the consensus range at the depth the fan is heading for: Carnivora 51.7, Caniformia 46.2, Pinnipedia 26.4, Ursidae 23.6, crown Cetacea 33.6.
  It has real 95% CIs, it is CC BY 4.0, and it is a 515 KB pinned file.
- **The cost** is A-C's own shallow bias. Crown Felidae 19.9 and crown Panthera 10.3 are too old, where Upham's are too young.
  That bias errs in the direction fossils cannot refute, and it does not wrongly push crown fossils to the stem.
  The fan's Panthera dates stay in `overrides.toml` (Figueiró 2017) either way.

**Rule for the next worker** (in `dated.py`; this task does not switch it):

1. **Topology and species.** Keep the Upham MCC topology and species, as the pipeline already matches them.
2. **Match A-C tips to Upham species.**
   - A-C's tips map to Upham species by binomial: 3,699 match exactly, and the pipeline's synonym tables should recover most of the other 373.
   - A species with several subspecies tips counts as all of them.
   - Convert ages from 100 Myr to Ma.
3. **Dated nodes.** If an Upham node's shared species are exactly an A-C clade, the node takes A-C's mean age and 95% CI. 2,257 nodes qualify. Source: `alvarez`.
4. **Other nodes.** Every other node (a conflict, or Upham-only species) is interpolated linearly in Upham's height between two dated nodes:
   - the nearest dated ancestor (`a`);
   - the oldest dated node below it (`d`; a tip counts as 0).

   Use `age = d + (a − d)·(h − h_d)/(h_a − h_d)`, and map the HPD the same way.
   Source: `interpolated (Upham shape)`. Nested identical clades keep this monotone.
5. **Fossils.** The fossil-minimum and stem-rehoming rules apply unchanged on top.
6. **Exceptions.** Hand dates stay in `overrides.toml` with a citation.

The fetch is wired up: `pipeline/tolad_pipeline/fetch.py` source `alvarez` → `data/raw/alvarez/4705sp_mammal-time.tree`, pinned in `sources.lock.json` and listed in `SOURCES.md`.
`make -C pipeline fetch` downloads and verifies it.

**Open question for the switch:** A-C's shallow nodes are too old, about 1.5× Upham's below 10 Ma.

- **The visible change.** The cat fan's crown Felidae moves from 7.2 (Upham) to 19.9 (A-C). The hand tree had 13.8 (TimeTree).
- **A side effect.** At 19.9 Ma the crown is as old as *Pseudaelurus*/*Styriofelis*, so the stem-rehoming rule will treat those fossils differently.
- **A possible fix.** If the shallow ages matter, test a second rule: a per-clade A-C/Upham geometric mean below ~20 Ma.
  It cancels the opposite biases at Homo–Pan, Felidae and Panthera (6.2, 12.0, 6.2). Benchmark it before adopting it.

## 5. The switch: rule A against rule B, scored (2026-10-11, tree145b)

`dated.py` now dates the Upham topology with both trees. A split whose shared species (in both trees: 3,786, matched by
binomial, then by the pipeline's name and synonym index) are exactly an A-C clade is dated (2,289 splits; of nested
Upham splits over the same shared species only the youngest). Every other split (3,360) is interpolated in Upham's
height between its nearest dated ancestor and the oldest dated split below it, as §4 says. Two rules for the dated splits:

- **A (`alvarez`):** A-C's mean age and 95% CI.
- **B (`ensemble`):** the geometric mean of A-C's and Upham's ages; interval the union of their 95% ranges.

Both get the **fossil floor**: a crown whose genus has a dated fossil species is raised to that fossil's first
appearance (source `fossil-floor`), capped just below the crown's parent split so the backbone keeps its order. Only a
fossil of the crown's own genus counts (all the crown's species share the fossil's genus word); a family-level fossil
says nothing about the crown (*Proailurus*, *Pseudaelurus* stay stem). 33 crowns are floored, none of them a benchmark
node (the fossil minima of §1 are hominins, early whales and *P. blytheae*, which overrides.toml already places).

The build scores both rules on the 15 nodes of §3 (`stats.json` → `dated_tree.benchmark`; crown Cetacea is measured
with the North Atlantic right whale, because no rorqual reaches the dated tree: a data bug, #160):

| Node | Consensus | A: alvarez | B: ensemble |
|---|---|---|---|
| Homo–Pan | 6–8 | 9.07 | **6.15** ✓ |
| Crown Panthera | 4–6.5 | 10.31 | **6.19** ✓ |
| Crown Felidae | 11–16 | 19.88 | **11.97** ✓ |
| Crown Canidae | 9–14 | 27.0 | 15.74 |
| Crown Ursidae | 17–22 | 23.64 | 15.43 |
| Crown Pinnipedia | 22–27 | **26.36** ✓ | 19.1 |
| Caniformia | 42–50 | **46.18** ✓ | 39.93 |
| Crown Carnivora | 50–60 | **51.73** ✓ | 45.62 |
| Mus–Rattus | 10.4–14 | **11.61** ✓ | 17.46 |
| Whippomorpha | 52–58 | 48.13 | 43.5 |
| Crown Cetacea | 34–38 | 28.8 | 21.99 |
| Crown Primates | 65–75 | 63.09 | **65.08** ✓ |
| Euarchontoglires | 76–90 | 69.81 | 73.32 |
| Crown Placentalia | 85–100 | 80.28 | **85.86** ✓ |
| Theria | 157–170 | 141.83 | 150.45 |
| **Inside the range** | | 4 / 15 | **5 / 15** |
| **Median factor off** | | **×1.15** | ×1.20 |

(Crown Cetacea is 28.8 under A, not §3's 33.6: in Upham's topology the whale–dolphin split is not an exact A-C clade, so
it is interpolated.)

**Choice: B, `ensemble`** (`dated.AGES`). It has more nodes inside the consensus range, and it is right exactly where the
fan is now: crown Felidae 11.97 Ma (in Johnson 2006 / Li 2016's 11–16), crown Panthera 6.19 (the fan keeps Figueiró's
override there), Homo–Pan 6.15. A is closer on the median, because it is right at 25–55 Ma (Carnivora, Caniformia,
Pinnipedia), where B halves its way back towards Upham's young ages. Neither rule gets Whippomorpha, crown Cetacea or the
deep nodes right.

**The obvious next rule** (not built; scored by hand from the table): B below ~20 Ma, A above (blended smoothly so nested
splits stay ordered) would get Homo–Pan, Panthera, Felidae, Pinnipedia, Caniformia, Carnivora and Mus–Rattus: 7 / 15.

**What moved under the stem-rehoming rule.** Older crowns keep more fossils inside them. Across mammals, grafts that join
a crown's split by taxonomy ("loose") went from 1,832 to 2,039, and fossil stem grafts from 1,339 to 1,179. In the cat
family the crown moved from 7.2 Ma (Upham) to 11.97: the fossil cats with first appearances between those dates now join
the crown split, see research/felidae-dated-tree-diff.md; *Pseudaelurus*, *Styriofelis* and the other early-Miocene
cats stay on the stem (the family's root split is still ~19.5 Ma, a fossil one).
