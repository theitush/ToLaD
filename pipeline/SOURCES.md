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
| COMBINE (Soria et al. 2021, *Ecology* 102:e03344), figshare v4 | Generation length: Pacifici et al. 2013 values, reported and phylogenetically imputed. Population density and adult mass | https://ndownloader.figshare.com/files/27703263 (reported), …/27703266 (imputed) | `14ace2dff03b71c20dc923a9eb293aaadc29934e21c6f11fa30d1b70e5abab92`, `b576cfd9f12b1441eb564bbf7acb65f06e676108aa0651aed9594585e7ff65f9` | CC BY 4.0 |
| PanTHERIA 1.0 WR05 (Jones et al. 2009, *Ecology* 90:2648) | Population density, geographic range area (`26-1_GR_Area_km2`), mass | https://esapubs.org/archive/ecol/E090/184/PanTHERIA_1-0_WR05_Aug2008.txt | `36e64314cae0394a966a63b949504d1975ac5c5629e05e36c1b139b3348f044a` | ESA Ecological Archives data paper. No explicit license; used for derived estimates with attribution |
| Paleobiology Database | Accepted, regular-preservation (no form or ichno taxa) Mammalia species and genera, with first/last appearance (`show=app,parent,class`) | `https://paleobiodb.org/data1.2/taxa/list.json?base_name=Mammalia&rank=species&taxon_status=accepted&pres=regular&show=app,parent,class&vocab=pbdb` (and `rank=genus`) | species `a0102693edd96d8bcbbd506e9d46e2c858f263c927f3c8fbd8087b56462f4bd2`, genera `080aff40f61bd5392dd7b44f4360ae42443d68d3b81a1f9a27b5cefcefea1388` | CC BY 4.0 |
| FAOSTAT QCL (crops and livestock), bulk normalized | World livestock **stocks** (element 5111), latest year (2024): cattle, sheep, goats, pigs, buffalo, horses, asses, camels | https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip | `c5835418c18f9322e7decbd6800f93a216eaae3cdfa31acb08f0518c0c6d6853` | CC BY 4.0 (FAO open data) |
| UN World Population Prospects 2024, medium variant | World population on 1 July 2026 (alive humans) and annual births 2022–2026 | https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Demographic_Indicators_Medium.csv.gz | `286ac36bb1415e2e1ade03acfef0a29f0e4c087e2f78e38c48f50c5df89082bc` | CC BY 3.0 IGO |
| PRB, "How Many People Have Ever Lived on Earth?" (Kaneda, Greenbaum & Haub, Nov 2022) | Table 1 benchmarks: births between benchmarks, 117,020,448,575 total through 2022. The figures are copied into `anchors.py`, and the build checks they still appear in the pinned page | https://www.prb.org/articles/how-many-people-have-ever-lived-on-earth/ | `3e39289adcb6759687d5a71b100a12e472799b57a31cbe1aa1fb8ebaef0ac1b4` | © PRB. Facts cited with attribution |

### Literature constants (no file)

| Constant | Value | Source |
|---|---|---|
| Wild mammal biomass, used for the occupancy calibration | land 20 Mt, marine 40 Mt (wet) | Greenspoon et al. 2023, *PNAS* 120:e2204892120 (doi:10.1073/pnas.2204892120) |
| Mammalia effective duration, used for the ghost-lineage top-down total | T_eff = 1.5e8 yr at modern-equivalent abundance | research/02-population-estimates.md §2.3 (grade C derivation) |
| Allometry forms | density ∝ M^b (Damuth 1981), generation ∝ M^d (Brook & Bowman 2005; Hatton et al. 2019) | Coefficients are refit on COMBINE + PanTHERIA in each build and written to `stats.json` → `fits` |

### Considered, not used

- **Pacifici et al. 2013 on Dryad** (doi:10.5061/dryad.gd0m3): Dryad now refuses scripted downloads (HTTP 401/403). The same generation lengths come in through COMBINE.
- **AnAge** (HAGR): its license terms are unclear, and COMBINE + PanTHERIA already cover longevity and maturity.
- **OneZoom dated tree** (Duke et al. 2026): for all-life scale-out (plan step 5). Upham is the better mammal source.

## Deliberate exclusions and known quirks

- `Tikitherium copei` (PBDB) is excluded. Its Carnian (~230 Ma) age is a ~25 Myr outlier against every other PBDB mammal, and the material has been argued to be a much younger shrew. The reassessment citation still needs checking. See `PBDB_EXCLUDE` in `merge.py`.
- PBDB species with no occurrences or no first/last appearance are skipped. So are names that are not plain binomials (`cf.`, subgenera in the name, and so on).
- Infraspecific Open Tree tips are folded into their species, e.g. *Canis lupus familiaris* → *Canis lupus*. Tips that are not species are dropped.
- Where the synthesis tree does not resolve a family as a node (a "broken" taxon such as Hominidae), the family is placed at the MRCA of the species Upham assigns to it, if that MRCA is tight.
- Fossil first appearances push calibrated ages upward when the PBDB taxonomy puts old fossils inside a crown group. Examples: Cretaceous stagodontids and pediomyids, which OTT files under Didelphimorphia, and the Cretaceous "Soricidae" *Cretasorex*. This follows the brief's rule that a parent is at least as old as the oldest child's first appearance. `stats.json` → `dating.calibrated_raised_by_fossils` counts these.

## License of the built dataset

The files in `data/mammals/` are **CC BY 4.0**. Attribute Open Tree of Life (CC0), Upham et al. 2019 (CC0), PHYLACINE (CC0), COMBINE (CC BY 4.0), PanTHERIA, the Paleobiology Database (CC BY 4.0), FAOSTAT (CC BY 4.0), UN WPP 2024 (CC BY 3.0 IGO) and PRB.
