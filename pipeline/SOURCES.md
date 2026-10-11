# Data sources (mammals v0)

All inputs are downloaded by `uv run tolad-fetch` into `data/raw/<source>/`, which is gitignored.
Each source gets its own directory. The downloads are only parsed by `pipeline/tolad_pipeline/`, never executed.
On the first download, `pipeline/sources.lock.json` records each file's URL, retrieval date, size and sha256. Later fetches verify against it, and a mismatch fails the fetch.

Rebuild everything from the raw downloads:

```sh
make -C pipeline          # fetch (verify checksums) + build + decoder round-trip test
# or step by step
cd pipeline && uv run tolad-fetch && uv run python -I -m tolad_pipeline.build && node --test decoder/test/roundtrip.test.mjs
```

Outputs go to `data/mammals/`: `skeleton.tld`, `t/<id>.tld`, `debug_top.json` and `stats.json` (match rates, fits, sizes, spot checks).
The format is described in [FORMAT.md](FORMAT.md).

## Inputs

All files below were retrieved on **2026-10-09**.

| Source | What we use | Pinned URL | sha256 | License |
|---|---|---|---|---|
| Open Tree of Life synthesis **v16.1** (`opentree16.1`, 2025-12-20) | Mammalia subtree (`ott244265`), topology and taxon names | `POST https://api.opentreeoflife.org/v3/tree_of_life/subtree` `{"node_id":"ott244265","format":"newick","label_format":"name_and_id","height_limit":-1}` → `opentree/mammalia_subtree.json`. The build checks `about.json` says `opentree16.1` | `57ea09e8ed94572c68c71ee0564f68a647dacb3055ebf481a2164299041a6823` (subtree), `aa8103ee…b317c` (about) | CC0 |
| Open Tree Taxonomy **3.7.3** (`3.7draft3`) | Ranks, `extinct` flags and synonyms for the ids in the subtree | https://files.opentreeoflife.org/ott/ott3.7.3/ott3.7.3.tgz | `7603aeb68ff45749773b4885811b1280d057f8c178b93bd903849fb7f237dfb3` | CC0 |
| Upham, Esselstyn & Jetz 2019, *PLoS Biol* 17:e3000494 (MamPhy v1) | Node-dated MCC tree, `…Completed_5911sp_topoCons_NDexp_MCC_v2_target.tre`. Node heights come from the TreeAnnotator `height` and `height_95%_HPD` fields. Also the species taxonomy table | `https://raw.githubusercontent.com/n8upham/MamPhy_v1/740b70189c77fc168be17bd6ade204c755bcb19b/_DATA/…` (commit pinned). Same files as Dryad doi:10.5061/dryad.tb03d03 | tree `480017aa53a786858d455c5881db7f2d1eeea9f8a174d7e4ff498a1c55745d3f`, taxonomy `cffe4e02b013c338145d9b091f9da2f8b9d0d365a5b8e05d1efccf26a51b5134` | CC0 (Dryad) |
| PHYLACINE 1.2.1 (Faurby et al. 2018, *Ecology* 99:2626) | Body mass for 5,831 species, including late-Quaternary extinct ones. IUCN status (`EP`/`EX` = extinct → gray). Marine flag. Synonymy table | `https://raw.githubusercontent.com/MegaPast2Future/PHYLACINE_1.2/2fb87f0b994ee82daa6691931f15971535322a2e/Data/{Traits/Trait_data.csv, Taxonomy/Synonymy_table_valid_species_only.csv}` | traits `ab035a8fab3d18673dea1d4a56f741e3ea9f8ba460461c7a1e738621ca315ec7`, synonyms `3a3c624ec31f609f56f0d7f177f2c380c1d1db8b9eb872a11ac46d2044d1c427` | CC0 (Dryad doi:10.5061/dryad.bp26v20) |
| PHYLACINE 1.2.1 range maps (Faurby et al. 2018; present-natural method: Faurby & Svenning 2015, *Diversity Distrib.* 21:1155). Retrieved **2026-10-11** | Current and present-natural range rasters for all 5,831 species (`Data/Ranges/{Current,Present_natural}/<Genus_species>.tif`: 360 × 142 Behrmann equal-area grid, ~96.5 km cells of 9,312 km², 1 = range), and `Data/Ranges/Spatial_metadata.csv` (PHYLACINE's own cell counts and certainty level, used as a cross-check: the raster sums match it for every species). The release asset is an uploaded file, so its bytes are fixed; its `Data/Ranges` tree is identical (git tree `7555039`) to the one at the commit pinned above. Read in place with `zipfile` + `tifffile` (LZW via `imagecodecs`); nothing is extracted | https://github.com/MegaPast2Future/PHYLACINE_1.2/releases/download/v1.2.1/PHYLACINE_1.2.1.zip → `phylacine/PHYLACINE_1.2.1.zip` (106 MB) | `6f37526e6b5871d1a24fac5aa868835735359af902e1f555d1d7dfd1c8075e01` | CC0 |
| COMBINE (Soria et al. 2021, *Ecology* 102:e03344), figshare v4 | Generation length: Pacifici et al. 2013 values, reported and phylogenetically imputed. Population density and adult mass | https://ndownloader.figshare.com/files/27703263 (reported), …/27703266 (imputed) | `14ace2dff03b71c20dc923a9eb293aaadc29934e21c6f11fa30d1b70e5abab92`, `b576cfd9f12b1441eb564bbf7acb65f06e676108aa0651aed9594585e7ff65f9` | CC BY 4.0 |
| The IUCN Red List of Threatened Species, **version 2026-1** (IUCN 2026), as GBIF's Darwin Core checklist (doi:10.15468/0qnb58, published 2026-07-28). Retrieved **2026-10-11** | Every mammal's Red List category (`distribution.txt` threatStatus), the year of its current assessment (its citation in `taxon.txt`) and the IUCN taxon and assessment ids (its iucnredlist.org URL): the `RLST` section, ToLaD#48 (`redlist.py`, FORMAT.md "RLST"). PHYLACINE 1.2's status column (IUCN 2016-3) fills in where the 2026-1 list has no match. The versioned file is fixed (`iucn-latest.zip` next to it moves). Read in place with `zipfile`; only the mammal rows are used. The IUCN website itself refuses scripted reads (HTTP 403) | https://hosted-datasets.gbif.org/datasets/iucn/iucn-2026-1.zip → `redlist/iucn-2026-1.zip` (21 MB) | `2ed2c5f75667fa2dee9dc718406b5ba094fa9312e548934916b16c0c509ccb7d` | CC BY 4.0 (as published on GBIF) |
| PanTHERIA 1.0 WR05 (Jones et al. 2009, *Ecology* 90:2648) | Population density, geographic range area (`26-1_GR_Area_km2`), mass | https://esapubs.org/archive/ecol/E090/184/PanTHERIA_1-0_WR05_Aug2008.txt | `36e64314cae0394a966a63b949504d1975ac5c5629e05e36c1b139b3348f044a` | ESA Ecological Archives data paper. No explicit license; used for derived estimates with attribution |
| Paleobiology Database | Accepted, regular-preservation (no form or ichno taxa) Mammalia species and genera, with first/last appearance (`show=app,parent,class`) | `https://paleobiodb.org/data1.2/taxa/list.json?base_name=Mammalia&rank=species&taxon_status=accepted&pres=regular&show=app,parent,class&vocab=pbdb` (and `rank=genus`) | species `2b305dfbc722e91e272ff03fdef972f3fbaca0fb512b371bbe589d160999e1bc`, genera `49f271f778d1fb4e26b10dd1c1f19c8f64a7d0e377b07c513300c68c5b1760dd` (after the fetcher zeroes PBDB's volatile `elapsed_time` field, see below) | CC BY 4.0 |
| Greenspoon et al. 2023, *PNAS* 120:e2204892120, data and code release v1.0 (Zenodo doi:10.5281/zenodo.7594807) | Census anchors: global population reports for 392 land species (`data/species_w_pop_reports.csv`, mostly IUCN Red List assessments) and the marine species with a report (`data/marine_data/wild_marine_pop_error.csv`). Their per-species model estimates for the other land species (`results/wild_land_mammal_biomass.csv` with masses from `data/all_species_list.csv`). Wild land biomass and individuals per order (`results/results_grouped_by_order.csv`). Dogs 1e9 and cats 6e8 (`data/domesticated_data/pets_rats_mouse.csv`). The zip is only opened with `zipfile` and read as CSV | https://zenodo.org/api/records/7594807/files/mammal_biomass-master.zip/content → `greenspoon/mammal_biomass-master.zip` | `b076b5c6b401196401eda8703ea12f7353ca86e38a03096eaaee0202dfac7a6c` | CC BY 4.0 |
| Zoonomia: Wilder et al. 2023, *Science* 380:eabn5856, "The contribution of historical processes to contemporary extinction risk in placental mammals" (PMC10184782). Retrieved **2026-10-11** | Table S1: genome-wide heterozygosity (heterozygous sites per callable base, length-weighted over 50-kb windows) of one sequenced individual for 209 of its 241 placental species, plus outbred heterozygosity and sample status (wild / captive / domestic). Layer 2 of the estimate stack, a **cross-check only** (ToLaD#63): `stats.json` → `diversity_crosscheck`, never the counts or curves. Europe PMC serves the supplement as a zip it rebuilds per request (new timestamps, new bytes), so `tolad-fetch` keeps only the member `NIHMS1893031-supplement-Table_S1.xlsx` under a fixed name and the lock pins that member (`ZIP_MEMBERS` in `fetch.py`). Read with `openpyxl` | https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10184782/supplementaryFiles → `zoonomia/Wilder2023_Table_S1.xlsx` (146 kB) | `11f6b821452304516bbd66260861bbe8c36c14a9ae71b72575be50502d7bf379` | CC BY 4.0 |
| Bergman et al. 2023, *Nat Commun* 14:7679, "Worldwide Late Pleistocene and Early Holocene population declines in extant megafauna are associated with Homo sapiens expansion rather than climate change" (PMC10667484). Retrieved **2026-10-11** | PSMC Ne histories of one genome of each of 139 extant megafauna species: Supplementary Data 3 (sample, years ago, Ne, in the paper's scaling) and Supplementary Data 1 (each sample's mutation rate per generation and generation time). Layer 3 of the estimate stack, bulk (ToLaD#64, `genomic.py`): the deep past of ~100 species, see `pipeline/history/README.md`, "Bulk genomic deep past". Both files are served as static files by Springer and are byte-stable | https://static-content.springer.com/esm/art%3A10.1038%2Fs41467-023-43426-5/MediaObjects/41467_2023_43426_MOESM4_ESM.csv → `bergman/Bergman2023_SupplementaryData1.csv` (33 kB); …/41467_2023_43426_MOESM6_ESM.txt → `bergman/Bergman2023_SupplementaryData3.txt` (213 kB) | `2cd7dcb6708ae90bfacd7077a5da5c03f48bb5a319d365b9bd9973f049fcacab`; `69e601736635fdf3ce2badfd439a5441156b7438e591bf39344fb3723110a2d3` | CC BY 4.0 |
| Bergeron et al. 2023, *Nature* 615:285-291, "Evolution of the germline mutation rate across vertebrates" (PMC9995274). Retrieved **2026-10-11** | Pedigree (trio) germline mutation rates of 68 vertebrates, Supplementary Tables 1-9; Table 9 gives each species' rate per generation modelled at its generation time and per year. The per-lineage mutation rate of the genetic layers 2 and 3 (ToLaD#74, #75, `mutation.py`): a fit of the 32 mammals' per-year rate on generation time, with per-order offsets; see `pipeline/history/README.md`, "Deep past". Served as a static file by Springer | https://static-content.springer.com/esm/art%3A10.1038%2Fs41586-023-05752-y/MediaObjects/41586_2023_5752_MOESM5_ESM.xlsx → `bergeron/Bergeron2023_SupplementaryTables.xlsx` (886 kB) | `5bb7ed865ad7ef1510473828227f85bab5100ff444563d85501c521fc1775b56` | CC BY 4.0 |
| FAOSTAT QCL (crops and livestock), bulk normalized | World livestock **stocks** (element 5111), latest year (2024): cattle, sheep, goats, pigs, buffalo, horses, asses, camels | https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip | `c5835418c18f9322e7decbd6800f93a216eaae3cdfa31acb08f0518c0c6d6853` | CC BY 4.0 (FAO open data) |
| UN World Population Prospects 2024, medium variant | World population on 1 July 2026 (alive humans) and annual births 2022–2026 | https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Demographic_Indicators_Medium.csv.gz | `286ac36bb1415e2e1ade03acfef0a29f0e4c087e2f78e38c48f50c5df89082bc` | CC BY 3.0 IGO |
| PRB, "How Many People Have Ever Lived on Earth?" (Kaneda, Greenbaum & Haub, Nov 2022) | Table 1 benchmarks: births between benchmarks, 117,020,448,575 total through 2022. The figures are copied into `anchors.py`, and the build checks they still appear in the pinned page | https://www.prb.org/articles/how-many-people-have-ever-lived-on-earth/ | `3e39289adcb6759687d5a71b100a12e472799b57a31cbe1aa1fb8ebaef0ac1b4` | © PRB. Facts cited with attribution |

### Literature constants (no file)

| Constant | Value | Source |
|---|---|---|
| Wild mammal biomass, reported next to the model's totals | land 20 Mt (95% CI 13–38), marine 40 Mt (wet) | Greenspoon et al. 2023, *PNAS* 120:e2204892120 (doi:10.1073/pnas.2204892120) |
| Mammalia effective duration, used for the ghost-lineage top-down total | T_eff = 1.5e8 yr at modern-equivalent abundance | research/02-population-estimates.md §2.3 (grade C derivation) |
| Ne/N for the genetic layers 2 and 3; the flat mutation rate | Ne/N = 0.1, range 0.3–0.05. μ = 1.0e-9 per site per year is now only the fallback (no Bergeron table on disk) and the reference the per-lineage rate's factor is quoted against; the rate itself is per lineage (Bergeron et al. 2023, above) | Frankham 1995, *Genet. Res.* 66:95; Armstrong et al. 2025, *Genome Biol. Evol.* 17:evaf060 (Pantherinae pedigree rates) |
| Allometry forms | density ∝ M^b (Damuth 1981), generation ∝ M^d (Brook & Bowman 2005; Hatton et al. 2019) | Coefficients are refit on COMBINE + PanTHERIA in each build and written to `stats.json` → `fits` |

### Considered, not used

- **Pacifici et al. 2013 on Dryad** (doi:10.5061/dryad.gd0m3): Dryad now refuses scripted downloads (HTTP 401/403). The same generation lengths come in through COMBINE.
- **AnAge** (HAGR): its license terms are unclear, and COMBINE + PanTHERIA already cover longevity and maturity.
- **OneZoom dated tree** (Duke et al. 2026): for all-life scale-out (plan step 5). Upham is the better mammal source.

## Manual overrides

Every hand-made change to what the sources say is in [`overrides.toml`](overrides.toml): versioned, one entry per change, each with a reason and a citation. The build fails if an entry stops matching anything, and lists what it applied in `stats.json` → `overrides`. Current entries:

- **Excluded:** `Tikitherium copei`. PBDB dates it to the Carnian (~230 Ma), but the single molar was re-described as a Neogene shrew: Averianov & Voyta 2024, *J. Mammal. Evol.* 31(1), doi:10.1007/s10914-024-09703-w.
- **Dates:** *Mammuthus subplanifrons* 6.2–3.75 Ma (PBDB's window midpoint gave 13.3 Ma; Sanders 2023), *M. meridionalis* from 2.6 Ma (Lister et al. 2005), *M. primigenius* from 0.6 Ma (Lister 2022), *M. lamarmorae* 0.3–0.04 Ma (Palombo et al. 2024). *Mammuthus* now starts at 6.4 Ma.
- **Placements:** Stagodontidae, Pediomyidae, *Kokopellia* and *Asiatherium* are Cretaceous metatherians outside crown Marsupialia (Williamson, Brusatte & Wilson 2014, *ZooKeys* 465:1–76). OTT and the PBDB graft put them under Didelphimorphia, which dragged the order back to 98 Ma. They now sit on the stem of Metatheria.

## Stem fossils (automatic)

Taxonomy often files a fossil inside a crown group that it predates. The dating rule "a parent is at least as old as its oldest child" then drags the crown node and every extant lineage under it back to the fossil's age. Examples are Cretaceous "didelphimorphs", Paleocene "carnivorans", Eocene equids and the Cretaceous "soricid" *Cretasorex*. These old crowns then soaked up deep-time ghost lineages.

Now a fossil-only subtree older than the upper end of the Upham 95% HPD of an enclosing crown node counts as a stem member. It moves next to that crown, inside a new node that carries the taxon's name (the total group). The crown keeps its molecular age and is renamed "*name* (crown)". This is a rule, not an override. The 2026-10-09 build moves 782 fossil subtrees into 115 total groups, listed in `stats.json` → `stem_rehoming`. Crown nodes not calibrated by Upham can still be raised by fossils.

## Counts calibration

Wild standing populations come from, in order of preference:
1. a global population report from an IUCN assessment, as compiled by Greenspoon et al. 2023 (479 species)
2. Greenspoon's per-species model estimate (≈4,350 land species)
3. density × range × occupancy *k*. *k* is fitted per order group (the nine orders Greenspoon report, plus "Other") as a function of body mass, on the species that have 1 or 2. Marine species use a mass + order fit on the marine census species.

Dogs (1e9) and cats (6e8) come from Greenspoon's pets table and get alive grade C. FAOSTAT livestock stays at grade B. Both are added on top of the wild lineage. Domestic forms with no wild population of their own (cattle, sheep, horse, donkey, dromedary, water buffalo, cat) keep their modelled wild ancestor only up to domestication.

Wild land individuals come to 8.4e10 (Greenspoon: 8.8e10). Land biomass is 34 Mt, inside Greenspoon's 13–38 Mt CI but above their 20 Mt median, because census species use PHYLACINE adult masses. Details are in `stats.json` → `occupancy_calibration`.

Before and after, wild alive (v0 = the previous pipeline on the same raw snapshot):

| Species | v0 | now | Published | Source of published figure |
|---|---|---|---|---|
| Wolf *Canis lupus* | 2.1e4 | 2.2e5 (+1e9 dogs) | 2.2e5 | IUCN (via Greenspoon) |
| Red fox *Vulpes vulpes* | 1.1e6 | 3.1e6 | 3.1e6 | Greenspoon model (no census) |
| African bush elephant *Loxodonta africana* | 3.8e4 | 4.4e5 | 4.4e5 | IUCN |
| House mouse *Mus musculus* | 1.1e8 | 7.0e8 | 7.0e8 (commensal guess 1e9) | Greenspoon model / guess |
| Brown rat *Rattus norvegicus* | 1.7e6 | 9.5e7 | 9.5e7 (commensal guess 1e9) | Greenspoon model / guess |
| White-tailed deer *Odocoileus virginianus* | 1.2e6 | 4.5e7 | 4.5e7 | IUCN |
| Chimpanzee *Pan troglodytes* | 4.8e4 | 4.0e5 | 4.0e5 | IUCN |
| Western gorilla *Gorilla gorilla* | 1.2e4 | 3.2e5 | 3.2e5 | IUCN |
| Blue whale *Balaenoptera musculus* | 5.2e2 | 2.8e4 | 2.8e4 | IUCN |
| Harbour seal *Phoca vitulina* | 4.4e6 | 9.4e5 | 9.4e5 | IUCN |
| Little brown bat *Myotis lucifugus* | 4.2e7 | 1.2e8 | 1.2e8 | Greenspoon model |
| Mexican free-tailed bat *Tadarida brasiliensis* | 2.5e8 | 1.3e8 | 1.3e8 | Greenspoon model |
| Eastern grey kangaroo *Macropus giganteus* | 1.1e6 | 2.2e7 | 2.2e7 | IUCN |
| Wild boar *Sus scrofa* (wild part) | 3e6 | 2.3e7 (+9.6e8 pigs) | 2.3e7 | Greenspoon model |
| Brown bear *Ursus arctos* | 1.0e5 | 2.2e5 | 2.2e5 | IUCN |
| Raccoon *Procyon lotor* | 2.8e7 | 4.0e7 | 4.0e7 | IUCN |

For census species, `stats.json` → `calibration_check` also shows what the occupancy model alone would give. For the wolf that is 2.7e4, so the per-species model error is still about 1 dex. That is why census figures take priority.

## Ghost lineages

The ghost share of Mammalia's ever-lived count is about 95%. The computation is sound: an extant species' band only reaches back to its split from its sister, a few Myr, and PBDB samples only a small fraction of fossil species. By era, the share is about 7% in the last 2.6 Myr, 77% in the Neogene, 99% in the Paleogene and 100% before 66 Ma (`stats.json` → `ghost_lineages.by_era`). Ghosts are kept separate in `GHST`.

They are allocated by crown membership. At time t, the deficit is split over the reconstructed lineages crossing t, weighted by the present-day wild births of each lineage's extant descendants. It is credited to the clade in whose crown that lineage runs. So:
- a crown order collects ghosts only after its own crown split
- deep-time ghosts go to Mammalia, Theria and Placentalia-level nodes
- relict lineages and stem fossils do not soak them up

The old allocation, by lineage rate over any covering band, let old-looking orders such as Didelphimorphia, Macroscelidea and Monotremata outrank Rodentia.

Mammalia's ever-lived total is 8.5e18 (95% range 1e17–1e21). That is just under 02's 1e19 lower bound. 02 assumed about 3e11 wild mammals alive; the Greenspoon-calibrated count is 8.5e10, and T_eff × wild births scales with it.

## Known quirks

- PBDB API responses start with a volatile `"elapsed_time"` field. The fetcher rewrites it to 0 before hashing, so the pinned checksum covers the records only. The lock was re-pinned on 2026-10-09: same records, byte length −4.
- PBDB species with no occurrences or no first/last appearance are skipped. So are names that are not plain binomials (`cf.`, subgenera in the name, and so on).
- Infraspecific Open Tree tips are folded into their species, e.g. *Canis lupus familiaris* → *Canis lupus*. Tips that are not species are dropped.
- Where the synthesis tree does not resolve a family as a node (a "broken" taxon such as Hominidae), the family is placed at the MRCA of the species Upham assigns to it, if that MRCA is tight.
- 1,628 Open Tree tips are treated as living although no extant-species list (Upham, PHYLACINE, Greenspoon/IUCN) recognises them. They are recent splits, synonyms, and some fossils that lack an extinct flag (e.g. *Elephas zulu*). They hold about 6.8e9 modelled individuals. See `stats.json` → `unverified_extant_tips`.

## License of the built dataset

The files in `data/mammals/` are **CC BY 4.0**. Attribute Open Tree of Life (CC0), Upham et al. 2019 (CC0), PHYLACINE (CC0), COMBINE (CC BY 4.0), PanTHERIA, the Paleobiology Database (CC BY 4.0), FAOSTAT (CC BY 4.0), Greenspoon et al. 2023 (CC BY 4.0), the IUCN Red List 2026-1 via GBIF (CC BY 4.0), UN WPP 2024 (CC BY 3.0 IGO) and PRB.
