# 01: Tree topology and dates, data sources

Research date: 2026-10-09. Counts marked **(measured)** come from files I downloaded or from live API calls on that date. The other figures come from official pages or papers.

## TL;DR

- **Topology backbone: Open Tree of Life synthesis v16.1** (CC0). It has 2,385,875 tips and was built in Dec 2025 from OTT 3.7.3. It covers cellular life only, because viruses are filtered out. It is also **almost extant-only**: only 1,024 of its tips are flagged extinct **(measured)**.
- **Dates for extant life: OneZoom's "fully-dated complete tree"** (Duke et al., bioRxiv 2026). It gives 2.29M extant species with every node dated: 334 OpenTree chronograms supply about 77k node ages and the rest are interpolated. The data is CC BY 4.0 on Zenodo (146 MB Newick median tree) and the code is BSD-3. It is the single most useful find for ToLaD.
- **Extinct life: Paleobiology Database (PBDB)** (CC BY 4.0). It has about 217k extinct species-rank names and 1.73M occurrences **(measured)**, with a first/last appearance interval per taxon from the API (`show=app`). We have to graft it onto OpenTree ourselves; no one ships a merged "living + fossil" tree. **Catalogue of Life** (171.6k extinct species, CC BY) is the cross-check and naming layer.
- **Viruses: ICTV MSL41** (CC BY 4.0). It has 10 realms and 17,554 species. Viruses are polyphyletic and don't fit under LUCA. Render them as a separate "virosphere" forest of independently rooted realms.
- **Bacteria/Archaea:** OpenTree has about 118k prokaryote tips taken from NCBI/SILVA taxonomy, mostly unresolved. **GTDB R232** (Apr 2026; about 143k+ species clusters, a resolved genome tree) is much better, but it is **CC BY-SA** (share-alike) and its branch lengths are substitutions, not time.
- **Avoid TimeTree for bulk data.** Its terms forbid redistribution of the data "and its transformations".
- **Size:** OneZoom ships the *entire* 2.2M-leaf topology as a 4.46 MB bracket string, which gzips to **675 KB**. Names and metadata are loaded lazily. A full ToLaD corpus of about 2.6M tips and about 5M nodes, with dates, counts and names, comes to roughly **40–80 MB brotli on a CDN in chunked tiles**. A session needs only a 1–2 MB initial download plus 50–300 KB per tile.

---

## 1. Comparison table

| Source | What it gives | Size (current) | Extinct coverage | Dates? | Access / format | License | Role in ToLaD |
|---|---|---|---|---|---|---|---|
| **Open Tree synth v16.1** | Supertree of 2,064 trees from 1,931 studies, plus taxonomy for the unresolved rest | 2,385,875 tips; 30 MB Newick (IDs only), 82 MB with names; 40 MB tgz; 517 MB full output **(measured)** | Very poor: 1,024 extinct tips. Taxonomy-only extinct taxa are pruned. T. rex and the mammoth are present; Smilodon and Archaeopteryx are not | No (topology only) | files.opentreeoflife.org, REST API v3 (`/tree_of_life/about`, `induced_subtree`, `mrca`, `tnrs`) | CC0 | **Primary topology** |
| **Open Tree Taxonomy (OTT) 3.7.3** | Merged taxonomy (NCBI, GBIF, SILVA, IRMNG, WoRMS, Index Fungorum…) | 4,529,570 taxa, of which 313,300 are extinct-flagged; 106 MB tgz, 417 MB TSV **(measured)** | Flags `extinct` / `extinct_inherited`, mostly from GBIF (133k) and WoRMS (52k). Extinct species have rank "no rank" | No | TSV | CC0 (Open Tree data) | ID hub (crosswalk to NCBI, GBIF, IRMNG, WoRMS IDs) |
| **OneZoom dated-complete-tree** | OpenTree 16.1 with polytomies resolved and all nodes dated (median plus distributions) | 2,294,776 tips; 146 MB median Newick; distributions up to 66 GB | Excluded (extant only) | **Yes**: 76,953 nodes from 334 chronograms, the rest interpolated (EQS-LS or birth model). Root 4,247 Ma | Zenodo 19049120, GitHub OneZoom/dated-complete-tree | Data CC BY 4.0, code BSD-3 | **Primary dates for extant life** |
| **NCBI Taxonomy** | Taxonomy of sequenced organisms, updated daily | About 2.1M species-level names across the three cellular domains (GenomeNet mirror, Sept 2025); 76 MB taxdump, 155 MB new_taxdump **(measured)** | Minimal (fossil taxa only if sequenced, e.g. mammoth) | No | FTP taxdump | Public domain | Includes **viruses**; Lifemap uses it |
| **Catalogue of Life (COL)** | Expert global checklist; monthly releases, annual checklist | Base 2026-09-11: 2,269,433 species, **171,616 extinct species**, 28k extinct genera. XR 2026-09-25: 2,504,374 species, 177k extinct **(measured, ChecklistBank API)** | Good at the names level (takes in PBDB and fossil GSDs) | No | ColDP / DwC-A / TextTree; ChecklistBank API | CC BY 4.0 | Names, synonymy, extinct flags, also virus realms |
| **GBIF Backbone** | Legacy GBIF taxonomy | About 7M names | Includes PBDB-derived names | No | DwC-A | CC BY 4.0 | **Frozen since 2023.** GBIF now defaults to COL XR. Don't build on it |
| **ITIS** | US-focused taxonomy | About 1M names | Weak | No | SQL/ DwC dumps | Public domain | Not needed |
| **Wikidata** | Taxon items, vernacular names in every language, images, links | 3,851,524 taxon items; 119,043 "fossil taxon" items **(measured, SPARQL)** | Partial (fossil taxon class, P842 Fossilworks/PBDB ID) | Some items have start/end time statements | SPARQL, JSON dumps | CC0 | **Labels, i18n names, images, PBDB↔OTT ID bridge** |
| **TimeTree 5** | Divergence times built from about 4,000 studies | 137,306 species | Few | Yes | Web, API, per-query Newick | **No redistribution** ("data and its transformations") | Spot-check only, or ask info@timetree.org for permission |
| **Upham et al. 2019 (VertLife)** | Mammal posterior trees (10k), node-dated | 5,911 extant species | No | Yes | Dryad / vertlife.org | CC0 (Dryad) | Mammals-first: high-quality dates |
| **PHYLACINE 1.2.1** | Mammal tree including **late-Quaternary extinct** species | 5,831 species (about 350 extinct since about 130 ka) | Recent extinctions only | Yes | Dryad / GitHub | CC0 | Mammals-first: recent extinctions (gray leaves) |
| **Jetz et al. 2012 (BirdTree)** | Bird posterior trees | 9,993 species | No | Yes | birdtree.org | Check (academic) | Birds (already inside OneZoom's chronogram set) |
| **Smith & Brown 2018** | Seed-plant megaphylogeny (ALLMB) | 353,185 tips | No | Yes | GitHub FePhyFoFum/big_seed_plant_trees | Open (check repo) | Plants (already inside OpenTree chronograms) |
| **GTDB R232** (Apr 2026) | Genome phylogeny of Bacteria (bac120) and Archaea (ar53) | R226: 732k genomes, 143,614 species clusters; R232 is larger; bac120.tree is 9 MB **(listed)** | N/A | No (substitutions/site) | data.gtdb.ecogenomic.org/releases/latest | **CC BY-SA 4.0** | Optional upgrade for prokaryote topology |
| **PBDB** | Fossil occurrences plus taxonomy with first/last appearance | 401k taxon names (all ranks); 249k species names, of which 217k are extinct; 1.73M occurrences **(measured)**. Mammalia: 17k extinct species | **Best open source** | Yes, per taxon: `fea/fla` (first appearance, early/late bound) and `lea/lla` (last). E.g. T. rex 83.6–66 Ma | REST `data1.2/taxa/list.json?base_name=…&show=app,parent` | CC BY 4.0 | **Extinct grafting plus stratigraphic ranges** |
| **ICTV MSL41** (2026) | Official virus taxonomy | 10 realms, 427 families, 4,149 genera, 17,554 species | N/A | No | XLSX (MSL), VMR; Zenodo archive | CC BY 4.0 | **Virus forest** |
| **Lifemap** (NCBI) | Zoomable "map" of NCBI taxonomy, rebuilt weekly | About 1.1M+ taxa displayed | Minimal | No | lifemap-back (GPL-3) builds PostGIS, then raster and vector tiles | Code GPL-3 / MIT | Reference architecture only |

## 2. Source notes

### Open Tree of Life
- Current release (live API, `POST api.opentreeoflife.org/v3/tree_of_life/about`): `synth_id opentree16.1`, created 2025-12-20, `taxonomy_version 3.7draft3` (files labelled ott3.7.3), root "cellular organisms" ott93302, **2,385,875 tips**, 1,931 studies, 2,064 trees.
- Files at https://files.opentreeoflife.org/synthesis/opentree16.1/:
  - `opentree16.1_tree.tgz` (40 MB): `labelled_supertree/labelled_supertree.tre` (30 MB, `ott123`/`mrcaottXottY` labels) and `labelled_supertree_ottnames.tre` (82 MB)
  - `annotations.json` (58 MB): per-node support and conflict
  - `grafted_solution`
- Filtered flags: barren, environmental, hidden, hybrid, inconsistent, major_rank_conflict, merged, not_otu, **viral**, was_container.
- **Extinct handling (measured):** OTT has 313k extinct-flagged taxa, but the synthesis keeps an extinct taxon only if a source *phylogeny* includes it. That leaves 1,024 extinct tips (Mammalia 235, Aves 125). Fossil-only taxa from the taxonomy are dropped. Treat OpenTree as an extant tree and graft fossils ourselves.
- Prokaryote coverage in the tree (measured): Bacteria 116,427 tips, Archaea 2,080. Most of these are taxonomy polytomies.
- Clade tip counts in v16.1 (measured): Eukaryota 2.27M, Metazoa 1.49M, Insecta 988k, Embryophyta 422k, Fungi 276k, Chordata 94k, Aves about 19k, Mammalia 9,328.
- Docs: https://github.com/OpenTreeOfLife/germinator/wiki/Synthetic-tree-API-v3 . Chronogram extraction: https://github.com/OpenTreeOfLife/chronosynth

### OneZoom
- Repos (github.com/OneZoom):
  - **OZtree**: viewer and server (web2py and MySQL). Custom license; check before reusing code.
  - **tree-build** (MIT): DVC pipeline that downloads OpenTree (`ot_version: v16.1`), EOL, Wikidata and Wikipedia pageviews (for popularity). Outputs `completetree_*.js`, `cut_position_map_*.js`, `dates_*.js` and SQL tables (ordered_nodes and ordered_leaves).
  - **dated-complete-tree** (BSD-3): resolves polytomies and dates every node. `interpolate_newick.py` is a stand-alone date interpolator like `phylocom bladj`. The repo includes a cached `node_ages.json` (20 MB, chronograms from 19 Feb 2026). Paper: doi:10.64898/2026.03.05.709771. Data: doi:10.5281/zenodo.19049120 (CC BY 4.0).
- **Client data format (measured):**
  - `completetree_29194525.js` is a 4.46 MB string over a 4-symbol alphabet `(){}`, one character per node boundary; it gzips to **675 KB** (xz 577 KB). It encodes the full bifurcating topology of about 2.2M leaves.
  - `cut_position_map` (2.1 MB, 428 KB gz) gives jump offsets so subtrees can be found without parsing.
  - `dates_*.js` is 94 KB gz (dates for higher nodes only).
  - Names, images and IUCN status are fetched per node from the server by node index.
- OneZoom's main site shows extant life only. Gray leaves there mean IUCN EX/EW (recent extinctions). Fossils are listed as an "open challenge" in their 2020 preprint.
- Backbone dates come from Betts 2018 (archaea), Strassert 2021 (eukaryotes) and *The Ancestor's Tale*.

### Lifemap
- Lifemap-ToL/lifemap-back (GPL-3) works like this. A weekly NCBI taxdump is laid out with a fractal, space-filling algorithm. Points, lines and polygons go into PostGIS. A modified mod_tile produces raster tiles, a bbox server produces vector tiles, and Solr handles search. pylifemap and LifemapR (MIT) are the client tools.
- **Lesson:** a "map tiles" architecture scales, but it needs a server. ToLaD can precompute *static* vector-like tiles instead (see §5).

### PBDB (fossils)
- API: `https://paleobiodb.org/data1.2/taxa/list.json?base_name=Mammalia&rank=species&extant=no&show=app,parent,class`. It returns `oid`, `par` (parent), `ext`, `noc` (number of occurrences), `fea/fla/lea/lla`, and `tei/tli` (stage names).
- Bulk: `taxa/list.csv?all_records&show=full,app,...`. Zenodo weekly snapshots also exist (e.g. records 21621227 and 21341326, 2026).
- Coverage is uneven. Vertebrates and marine invertebrates are good; insects, plants and microbes are thin. Parent links give a *taxonomic* tree, not a phylogeny.
- PBDB species can be placed as a fan under their genus or family node, with time ranges from first and last appearance. That is the standard "taxonomy + FAD/LAD" approach (e.g. `paleotree::dateTaxonTreePBDB`, `strap` for timescaling).

### Viruses
- ICTV MSL41 (ratified Feb 2026): 10 realms (Riboviria, Duplodnaviria, Varidnaviria, Monodnaviria, Adnaviria, Ribozyviria, Singelaviria, …), 17,554 species. It is CC BY 4.0. MSL and VMR spreadsheets are at https://ictv.global/msl and archived on Zenodo. NCBI Taxonomy (node 10239) and COL also carry it.
- Realms are defined as having *independent origins*, so viruses are not one clade. Suggested ToLaD treatment:
  - Make a "virosphere" sibling forest drawn beside the cellular tree, with each realm as its own root. The root age is unknown (possibly pre-LUCA, up to about 4 Ga); draw it with a fuzzy, dashed base.
  - Optionally link families to their host clades in the UI.
  - Topology below realm level is taxonomy only, since ICTV has no dated phylogeny.

### Bacteria and Archaea
- OpenTree's prokaryote subtree is largely taxonomic.
- GTDB R232 (released 15 Apr 2026) offers `bac120.tree` (9 MB) and `ar53.tree`: a resolved tree of representative genomes with GTDB taxonomy. Its CC BY-SA 4.0 license means any *derived* dataset we redistribute would have to be CC BY-SA too. That is acceptable for an open project but must be documented.
- Dates have to come from a small set of calibrations: LUCA about 4.2 Ga (Moody et al. 2024), Betts 2018, and so on, plus interpolation (`interpolate_newick.py`). Expect very low confidence.

## 3. Recommended stack

1. **Topology: OpenTree synth 16.1** plus the OneZoom **dated-complete-tree median tree** (CC BY 4.0). This gives a resolved, fully dated tree of 2.29M extant species. Re-run the BSD code ourselves when OpenTree releases v17.
2. **Extinct grafting: PBDB** (CC BY). Match names to OTT via COL, Wikidata (P842 Fossilworks ID, GBIF/IRMNG IDs in OTT `sourceinfo`), or exact name plus parent-genus checks.
   - Place each fossil species as a child of the deepest matching OTT node (genus, then family, then order).
   - Set its branch to start at its first appearance and end at its last appearance (alive = green only if extant).
   - Constrain the parent node age to at least the oldest first appearance among its fossil children.
   - Fix the dating afterwards with the interpolator, treating fossil ages as minimum bounds.
3. **Names, vernaculars, images: Wikidata** (CC0), plus OneZoom-style popularity from Wikipedia pageviews, which is useful for LOD and label priority.
4. **Checklist and extinct flags: COL Base** (CC BY), to dedupe synonyms and as a second source for extinct flags.
5. **Prokaryotes:** v1 uses OpenTree. v2 optionally swaps in the GTDB subtree (mind CC BY-SA).
6. **Viruses: ICTV MSL41** as a separate forest.
7. **Mammals-first fallback:**
   - OpenTree Mammalia (9.3k tips) with Upham 2019 dates (CC0) and PHYLACINE for recent extinctions (CC0)
   - plus PBDB extinct mammals (about 17k species with first/last appearances)
   - roughly 27k tips in total, a dataset of about 0.5–1 MB brotli that can ship as one file.
8. **Do not use** for bulk data: TimeTree (no redistribution) or the GBIF Backbone (frozen).

Overall license of the combined dataset: **CC BY 4.0** (attributing OpenTree, Duke et al./OneZoom, PBDB, COL and ICTV). It becomes **CC BY-SA** if GTDB is included.

## 4. Gaps and risks

- **No merged living+fossil phylogeny exists.** Fossil placement will mostly be taxonomic: large polytomies under genera and families, with stem ages guessed from first appearances. In the UI this shows up as fan-shaped "comb" clades. Mark those nodes `topology_confidence=taxonomic`.
- **Fossil record bias.** PBDB is strong for marine invertebrates and vertebrates, sparse for insects, soft-bodied taxa and microbes, and has nothing for unpreserved lineages. The count of extinct species is about 0.2M, while estimates of species that ever lived are at least 10^8–10^9. The "dead" side will be hugely under-represented unless we add procedural "ghost lineages" (estimated unknown diversity) as a visually distinct category.
- **Dates are mostly interpolated.** Only about 3% of OpenTree nodes have a chronogram date. Prokaryote and protist dates are near-guesswork. Carry a per-node `date_source` (calibrated / interpolated / fossil-bounded) and show uncertainty.
- **Name matching across sources** (OTT↔PBDB↔COL↔ICTV) is the main engineering cost. Homonyms across kingdoms are common, so always match with the parent/higher-taxon context.
- **Prokaryote "species"** are fuzzy (GTDB clusters vs. NCBI names). Horizontal gene transfer makes a single tree a simplification, so flag this in the UI.
- **Viruses** don't fit the LUCA metaphor; their root placement is a design decision.
- **Licenses:** GTDB share-alike. OZtree code has a custom license, but tree-build is MIT and dated-complete-tree is BSD, so those are fine. Check the Smith & Brown and BirdTree terms if we use them directly.
- **"Individuals ever lived" (branch width)** is not in any of these sources. It must be modeled per clade (abundance × generations × duration); see 02-population-estimates.md. Pure tip counts can serve as a placeholder.
- **Upstream churn.** OpenTree releases roughly yearly and OTT IDs are mostly stable (`forwards.tsv` handles retired IDs). PBDB and COL change weekly to monthly, so pin snapshot versions in the build.

## 5. Precomputed static dataset: size and pruning

**Node budget:**
- about 2.29M extant species (dated tree)
- plus about 0.2M PBDB extinct species
- plus about 17.5k virus species

That is about 2.5–2.6M tips. A binary tree has about 5.1M nodes. Keeping polytomies (collapsing the arbitrary resolution) gives about 2.9–3.5M nodes.

**Encoding** (per-node columns, OneZoom-inspired):

| Field | Encoding | Raw for about 5M nodes | Compressed (brotli/gzip est.) |
|---|---|---|---|
| Topology | Balanced-parens / OneZoom bracket string (about 2 bits per node) | 1.3–5 MB | **0.7 MB** (OneZoom measured 675 KB gz for 2.2M leaves) |
| Age (start) | uint16, log-scaled Ma | 10 MB | 4–6 MB |
| End age / alive flag | uint16 (0 = extant) | 10 MB, sparse for extant tips | 1–2 MB |
| Width (individuals, log) | uint8 or uint16 | 5–10 MB | 2–4 MB |
| Name | Front-coded strings, average about 22 bytes | about 60 MB | 15–20 MB |
| IDs (OTT/PBDB) | Varint deltas | about 15 MB | 5–8 MB |
| **Total** | | about 110 MB | **about 30–45 MB** (plus vernaculars and i18n) |

**Delivery:**
- **Skeleton file:** the top about 30–50k nodes, chosen by width, popularity and rank (all orders and families), with names, ages and aggregate widths. That is **under 1–2 MB**, cached by a service worker; first paint needs only this file.
- **Subtree tiles:** cut the tree into tiles of 5–20k nodes. Each holds a topology slice, columns and names, at **50–300 KB** brotli. A manifest maps node to tile. Prefetch tiles along the zoom path.
- Every unloaded subtree has a precomputed aggregate (width, age span, alive fraction, representative name and image). The renderer draws it as a single wedge until its tile arrives, so zooming never blocks.
- Optionally precompute the layout (angle and radius extents per node) at build time. Otherwise compute it on the client per tile; it is O(n) per tile.

**Pruning and simplification steps at build time:**
1. Keep tips at species rank only. Drop infraspecific taxa (those become ToLaD's procedural mesh), "barren", "environmental"/"uncultured", hybrids and `not_otu`.
2. Collapse unary "knuckle" nodes, keeping the label on the surviving node.
3. Keep or rebuild polytomies from the dated tree, and mark which splits are arbitrary.
4. Optionally drop `incertae_sedis` duplicates.
5. Merge PBDB, dedupe synonyms against COL, and drop PBDB names with zero occurrences or flagged as nomina dubia.
6. Mammals-first mode: export only the Mammalia (plus outgroup backbone) tiles, so the same pipeline produces the small dataset.

## 6. Links

- Open Tree synthesis files: https://files.opentreeoflife.org/synthesis/opentree16.1/ · OTT: https://files.opentreeoflife.org/ott/ott3.7.3/ · API: https://api.opentreeoflife.org/v3/ · About: https://tree.opentreeoflife.org/about/synthesis-release
- OneZoom: https://github.com/OneZoom/tree-build · https://github.com/OneZoom/dated-complete-tree · https://github.com/OneZoom/OZtree · Data: https://doi.org/10.5281/zenodo.19049120 · Preprint: https://doi.org/10.64898/2026.03.05.709771 · https://www.onezoom.org/data_sources
- Lifemap: https://github.com/Lifemap-ToL/lifemap-back · https://lifemap-ncbi.univ-lyon1.fr · pylifemap preprint: https://doi.org/10.64898/2025.12.16.694609
- NCBI Taxonomy dumps: https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/
- Catalogue of Life: https://www.catalogueoflife.org/data/download · ChecklistBank API: https://api.checklistbank.org/
- GBIF backbone to COL XR migration: https://data-blog.gbif.org/post/catalogue-of-life-taxonomic-backbone/
- Wikidata SPARQL: https://query.wikidata.org/
- TimeTree: https://timetree.org (terms: personal research/teaching, no redistribution)
- PBDB API: https://paleobiodb.org/data1.2/ · License (CC BY): https://creativecommons.org/2013/12/19/paleobiology-database-now-cc-by/
- GTDB: https://data.gtdb.ecogenomic.org/releases/latest/ · License: https://gtdb.ecogenomic.org/licenses · Stats R226: https://gtdb.ecogenomic.org/stats/r226
- ICTV MSL41: https://ictv.global/node/3419 · https://ictv.global/msl
- Upham 2019 mammals: https://vertlife.org/data/mammals/ · https://doi.org/10.5061/dryad.tb03d03
- PHYLACINE 1.2: https://doi.org/10.5061/dryad.bp26v20 · https://zenodo.org/record/3690867
- BirdTree (Jetz 2012): https://birdtree.org
- Smith & Brown 2018 seed plants: https://github.com/FePhyFoFum/big_seed_plant_trees
