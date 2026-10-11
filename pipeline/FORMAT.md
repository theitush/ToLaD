# ToLaD tile format, version 1.6

Binary columnar format for the river data. The decoder is `pipeline/decoder/tolad-decoder.js`; the round-trip test is `pipeline/decoder/test/roundtrip.test.mjs`. The writer is `pipeline/tolad_pipeline/tiles.py`.

**Versioning:** the `version` field in the header is bumped on any incompatible change. Decoders must reject unknown versions. Additive changes (new sections) keep the version, and decoders must skip sections they do not know. Minor revisions: **1.0** the base format; **1.1** adds the optional `HIST` section (curated population history) and the `hist*` META keys; **1.2** adds the `NATB` section (natural, pre-human baseline), the skeleton `META.natural` key and the HIST kind 10 `natural` (kind 9 `genomic` came with the optional `[deep]` history, no new section). **1.3** adds HIST kind 11 `rangeloss` (modelled range-loss records); **1.4** adds the `RLST` section (IUCN Red List status per species row) and the skeleton `META.red_list` key; **1.5** adds `events` to a history file's `META.hist` entry (curated bottlenecks, ToLaD#141; no new section); **1.6** adds the dated tree's JSON sidecars `dated/<id>.json` (ToLaD#145, "Dated tree" below; the `.tld` files are unchanged). The header `version` stays 1, and a 1.0 decoder reads 1.1 to 1.6 files unchanged (it skips `HIST`, `NATB` and `RLST`).

## Files

```
data/mammals/
  skeleton.tld      top of the tree (kind 0) + global tables in META
  t/<id>.tld        subtree tiles (kind 1), loaded on zoom
  dated/<id>.json   the dated tree over each file's species rows (1.6; `skeleton.json` for the skeleton)
  debug_top.json    human-readable dump of the skeleton rows (unquantized), one node per line
  stats.json        build report (counts, match rates, fits, sizes, spot checks)
```

Load `skeleton.tld` first. It holds the tables that tile rows index into: `methods` and `sources`, plus the tile manifest. A **stub** row is a node whose children live in another tile. Its own row carries all the aggregates needed to draw the unloaded subtree as one band: width (`EVER`, `PPK_`/`PROF`), age span (`T0__`, `T1__`), alive fraction (`ALIV`/`EVER`), ghost share (`GHST`), grade, and tip count (`NTIP`). The representative name is in `META.stub_rep`. Row 0 of the referenced tile is the same node again with identical values, minus the STUB flag. Layout is stable under lazy loading (03 §3.3) because a node's children are laid out only from the children's own rows.

## Container

Little-endian throughout.

| Offset | Type | Field |
|---|---|---|
| 0 | 4 bytes | magic `TLAD` |
| 4 | u16 | format version (= 1) |
| 6 | u16 | kind: 0 = skeleton, 1 = tile |
| 8 | u32 | `n`, the number of rows (nodes) |
| 12 | u32 | `s`, the number of sections |
| 16 | 16 × s | section table: `u32 id` (fourcc, ASCII, little-endian), `u32 offset`, `u32 byteLength`, `u32 count` |

Every section starts at an offset that is a multiple of 8, so the typed-array views are zero-copy.

## Rows

Rows are nodes in **preorder**. `CHLD[i]` is the number of children present *in this file*; it is 0 for stubs and leaves. Parents are rebuilt with a stack (see the decoder). A tile's row 0 is its root.

## Sections (per row unless noted)

| id | type | content |
|---|---|---|
| `CHLD` | u16[n] | number of children in this file |
| `T0__` | u16[n] | band start age (oldest), AGE code |
| `T1__` | u16[n] | band end age, AGE code. 0 = reaches the present (alive) |
| `EVER` | u16[n] | individuals ever born on this band, including descendants and ghosts (LOG16) |
| `ALIV` | u16[n] | individuals alive now (LOG16; 0 = none) |
| `GHST` | u16[n] | the part of `EVER` that is ghost lineages, i.e. unsampled extinct side branches (LOG16) |
| `LOHI` | u8[2n] | `lo, hi` interleaved: the 95% range of EVER is `EVER / 10^(lo/20)` to `EVER × 10^(hi/20)` |
| `FLAG` | u16[n] | bit field, see below |
| `METH` | u16[n] | index into `skeleton.META.methods`, the method chain text |
| `SRCM` | u16[n] | bit mask into `skeleton.META.sources` (bit i = sources[i]) |
| `PPK_` | u16[n] | births/yr profile peak (LOG16) |
| `PROF` | u8[16n] | births/yr profile, 16 codes per row (see Profile) |
| `NTIP` | u32[n] | species tips in the *full* subtree, including unloaded parts |
| `GID_` | u32[n] | global preorder id over the whole tree; stable within a build |
| `OTT_` | u32[n] | Open Tree Taxonomy id (0 = none) |
| `PBDB` | u32[n] | PBDB `taxon_no` (0 = none) |
| `STUB` | u32[2k] | `(row index, tile id)` pairs for the k stubs in this file |
| `NAME` | u32[n+1] offsets, then UTF-8 bytes | `"Primary name|alt1|alt2…"`. The offsets are relative to the start of the byte blob. An unnamed MRCA node has an empty primary name. Alt names come from collapsed unary ("knuckle") ancestors, nearest first |
| `META` | UTF-8 JSON | see below |
| `HIST` | blob, count = species (v1.1, optional) | curated population history of species rows, see below |
| `RLST` | u32[3n] (v1.4) | IUCN Red List status, 3 words per row: `category | source << 8 | year << 16`, IUCN taxon id, assessment id. All 0 = none (internal nodes, fossils). See "RLST" below |
| `NATB` | u16[5n] (v1.2) | natural (pre-human) baseline, 5 LOG16 codes per row: `n, lo, hi, km2_natural, km2_current`. All 0 = none (internal nodes, species without a PHYLACINE map). See "NATB" below |

### Quantization

- **AGE** (u16): `0` → 0 Ma. Otherwise `age_Ma = 10^((q − 1)/6000 − 6)`. That covers 1 year to ~8e4 Ma at a relative step of 0.038%.
- **LOG16** (u16): `0` → 0. Otherwise `x = 10^((q − 1)/1000 − 8)`, a relative step of 0.23%.
- **LOHI** (u8): dex × 20.
- **Profile:** `peak = LOG16(PPK_)`. Each code `c` maps to `rate = peak × 10^(−c/20)`, and `c = 255` means 0.

### Profile (births-rate through time)

16 bins per node over its own band `[t1, t0]`. The bin edges are log-spaced toward the young end:

```
edge_k = t1 + (t0 − t1) · (1000^(k/16) − 1) / 999,   k = 0..16
```

Bin 0 is the youngest (ends at `t1`) and bin 15 the oldest (starts at `t0`). Each value is the **mean births per year** within the bin, so `Σ rate_k · (edge_{k+1} − edge_k) · 1e6 ≈ EVER` (up to quantization). The band **width** at time t is the births rate there (00-synthesis decision: width = births per unit time, so area = individuals ever lived). Draw it as a step function, or interpolate in log-rate. The log spacing gives sub-century resolution near the present for young bands (e.g. *Homo sapiens*), while still covering 200 Myr for Mammalia.

### FLAG bits

| bits | meaning |
|---|---|
| 0–1 | grade: 0 = A, 1 = B, 2 = C, 3 = D (02 grades) |
| 2 | extinct: `T1 > 0`, no living descendant (draw gray) |
| 3 | `topology_confidence = taxonomic`: a PBDB graft or a group created from PBDB taxonomy |
| 4–5 | date source: 0 = Upham-calibrated, 1 = interpolated, 2 = fossil range or fossil-constrained, 3 = anchored |
| 6 | species tip (in the full tree) |
| 7 | stub: children are in tile `STUB[...]` |
| 8 | anchored count: humans, an IUCN census figure, a domestic stock (FAOSTAT livestock, dogs, cats), or a curated history (`HIST`) |
| 9 | PBDB fossil species graft |
| 10 | created taxonomic group (genus, family or order from PBDB, or the "incertae sedis" bucket) |

### META

Every file has `META.stub_rep` (representative names, aligned with the `STUB` pairs). Tiles also have `tile`, `root_gid` and `root_name`. The skeleton adds:

- `version`, `dataset`, `license`, `built`, `units`, and `quant` (the constants above, for cross-checking)
- `grades`, `date_sources`
- `sources`: `[{key, label}]` for `SRCM` bits
- `methods`: method-chain strings for `METH`
- `tiles`: `[{id, file, nodes, root_gid, root_name, bytes}]`
- `total_nodes`: rows across all files, not counting stub duplicates
- `mock_individuals`: `[{mock: true, name: "MOCK …", species, species_gid, tile (−1 = skeleton), index, born, died, alive, note}]`. These are **placeholders**, clearly labelled. Real individual records come in a later phase.

v1.1 adds, in the skeleton:

- `hist_sources`: `[{cite, url}]`, the citation table that HIST points index into
- `hist_kinds`: the HIST kind names, by code (see below)
- `hist_index`: `[{species, gid, tile (−1 = skeleton), row}]`, where each curated species' HIST entry lives

and, in every file that has a `HIST` section, `META.hist`: `[{species, common, component, use, scope, file, notes, point_notes, modelled}]`, aligned with the HIST species headers (`point_notes` aligned with that species' points). `modelled` is null for a curated history file. v1.3: `modelled = "rangeloss"` marks a modelled range-loss record (see NATB); its META entry carries only `species`, `component`, `use` and `modelled` (the shared notes, cite and timing are in skeleton `META.natural.trend`), and it is **not** listed in `hist_index` (find it with `file.history(row)`). `modelled = "genomic"` (ToLaD#64) marks a modelled record whose deep past is a bulk PSMC curve (Bergman et al. 2023; `pipeline/history/README.md`, "Bulk genomic deep past"): `genomic` points, then the range-loss start point (kind `rangeloss`, 1500 CE) where the leaf has that trend, then today's count (kind `model`). Its META entry is as short as a range-loss one, but it **is** listed in `hist_index`; the source's cite and url are in `META.hist_sources` like any point's. Any record with a genomic deep past (modelled or a history file) also carries `deep_join` (ToLaD#80): one plain sentence saying how the genomic curve meets the next level across PSMC's blind spot, for the species card: scaled to a cited level dated 1900 or earlier (with the factor), or kept at its own level against a modelled one or a cited one after 1900 (with the ratio; ToLaD#71), and flagged when the two were more than 10x apart (`pipeline/history/README.md`, "Deep past", "Joining"). Absent when there is no deep past. v1.5 (ToLaD#141): a history file's entry may carry `events`, its curated `[[event]]` list oldest first: `{kind ("bottleneck"), from_ya, to_ya (years before present, from_ya > to_ya >= 0), title (the fan's label), summary, quote (verbatim from the source), cite, url, grade (A-D), region ("" = the whole species)}` (`pipeline/history/README.md`, "Events"). The fan marks each window on the species' column and the card quotes it. Absent when there are none.

### HIST (v1.1): curated population history

Present only in files that hold a curated species row (`pipeline/history/*.toml`, see its README for the curation rules). The section `count` is the number of species `s`. Layout, little-endian, read with a DataView:

| part | size | fields |
|---|---|---|
| preamble | 16 B | `u32 s`, `u32 p` (points), `u32 g` (segments), `u32` reserved |
| species headers | 24 B × s | `u32 row`, `u32 point0`, `u32 seg0`, `u16 npts`, `u16 nseg`, `f32 G` (generation length, yr), `f32 L` (= G/2, yr) |
| points | 16 B × p | `i32 year` (calendar, negative = BCE), `u16 n`, `u16 lo`, `u16 hi` (LOG16, individuals alive), `u8 grade` (0–3 = A–D), `u8 kind`, `u16 cite` (index into skeleton `META.hist_sources`), `u16 flags` (bit 0 = the pre-decline baseline) |
| segments | 16 B × g | `f32 year0` (calendar year the segment starts), `f32 generations`, `u16 startSize`, `u16 endSize` (LOG16, births per generation), `u8 grade`, `u8 kind`, `u16` reserved |

A species' points are `point0 … point0+npts−1` (sorted by year) and its segments `seg0 … seg0+nseg−1` (oldest first, contiguous, the last one ending now).

**Kinds** (`META.hist_kinds`): 0 `census`, 1 `estimate`, 2 `index-scaled`, 3 `reconstruction`, 4 `unverified` (always grade D), 5 `model` (a point: the pipeline's own alive-now, added when the curve has no recent graded point; a segment: today's level held before the first point of a wild species with no known baseline), 6 `interpolated` (a span between two points), 7 `held` (a level held flat after the last point, or before the first point of a display-only species), 8 `baseline` (the pre-decline level held back to the band start), 9 `genomic` (a point compiled from a genome-based Ne history, see `pipeline/history/README.md`, "Deep past"; a segment: the curve between two such points), 10 `natural` (v1.2, a segment only: the natural baseline from `NATB`, grade D, held from the band start to the first point of a wild species with no cited baseline and no genomic deep past), 11 `rangeloss` (v1.3: the modelled range-loss trend of a species with no history file, see NATB; a point: the natural level in 1500 CE where the trend starts; a segment: the log-linear change from it to today's count; always grade D). With a deep past, the first segment holds the oldest genomic level back to the band start (kind `held`).

**Curve:** log-linear between points (so it passes through every point), flat outside them. **Segments** are the curve compiled for procgen's `Segment` (births per generation, linear ramps): births per generation = alive × G ÷ lifespan = `N(t) · G / L`. Boundaries are whole generations counted back from now. A span changing by more than 2× is split at log-even levels into sub-spans of at most ~1.41×. For wild species the first segment holds the baseline back to the start of the species band (with no cited baseline: the natural baseline, kind `natural`, or without one today's level, kind `model`; then a step to the curve at the first point); for domestic stocks and humans the segments cover the curated span only. Each segment's grade is the worse of its two end points.

**Counts:** for `use = "counts"` species the curve replaces the leaf's births: rate = `N(t) / L`, the cited baseline (or, with none, the natural baseline, or without that today's level) held from the band start, so `EVER` and the profiles use the pre-decline level, not today's count. `ALIV` is the latest point if it is from 2000 or later and graded A–C. With a genomic deep past (`[deep]`) the oldest genomic level is held from the band start instead and the natural baseline is not used. The leaf's error is widened by the deep-past level's range (cited or natural baseline, else the latest point; with a deep past, the wider of that and the genomic range) and its grade is capped by that level's grade (the natural baseline is D). Parents re-sum as usual. `use = "display"` species (humans; partial-scope files) ship the HIST entry only.

### NATB (v1.2): natural (pre-human) baseline

Layer 1 of the estimate stack (ToLaD#61): how many individuals of a species would be alive with no human
impact. Per row, five LOG16 codes:

| code | meaning |
|---|---|
| `n` | natural baseline, individuals alive |
| `lo`, `hi` | its 95% range (the model's error, see below) |
| `km2_natural` | PHYLACINE 1.2.1 present-natural range area, km² (equal-area cells × 9,312 km²) |
| `km2_current` | PHYLACINE current range area, km² (0 for extinct species) |

It is always modelled: skeleton `META.natural` carries `grade` (`"D"`), `kind` (`"reconstruction"`),
`step_year` (1500), the method strings, `cite` and `url`. Show it as modelled, never as a count.

`N_nat` = density × present-natural range × occupancy, the same occupancy and area scale as today's count:

- **Extant species with a current range map:** `N_nat = N_today × natural cells / current cells`. For a
  modelled species `N_today = k · D · A`, so this is `k · D · A_nat`. For a census (or Greenspoon-estimate)
  species the census fixes the species' own occupancy `k_i = N_today / (D · A)`, which then applies to the
  natural range. A curated species whose alive-now comes from its history file uses that curated count as
  `N_today`. Where the two maps are the same (4,824 of 5,831 PHYLACINE species), `N_nat = N_today`.
  Error: today's (census 0.25 dex, Greenspoon estimate 0.5, model density + range + occupancy residual),
  plus 0.2 dex where the natural range differs from the current one.
- **No current range** (Late Quaternary extinct species, species extinct in the wild):
  `N_nat = D · A_nat · k`, with `D` observed (COMBINE / PanTHERIA) or allometric, `A_nat` mapped from the
  PHYLACINE grid onto PanTHERIA's range-area scale (the grid inflates small ranges; the fit is in `stats.json`
  → `fits`), and `k` the fitted group occupancy. Error: density, area-fit residual and occupancy residual.

**Where it drives the counts:** an extinct species runs at `N_nat` over its whole band. An extant species
whose natural baseline differs from today's count runs at `N_nat` until 1500 CE (IUCN's "since 1500"
window), then (v1.3, ToLaD#62) changes log-linearly to today's count now, if it has both range maps (with no
current map it still steps at 1500). That trend ships as a HIST record (`META.hist[].modelled = "rangeloss"`,
two points, segments `natural` then kind 11 `rangeloss`, grade D) for every such species without a history
file; skeleton `META.natural.trend` gives its shape, years, kind, cite and the timing assumption (one date,
1500 CE, for every species and region). Show it as modelled, never as a count.
Its leaf error is widened by the 0.2 dex and its grade capped at D. A domestic form with no wild population
runs its wild ancestor at `N_nat` up to domestication. Curated species (`HIST`): a cited baseline wins; with
none, the natural baseline is held before the first cited point (segment kind 10 `natural`; with a genomic deep past, the genomic curve instead, see "HIST"). `ALIV` is
always today's count. Report: `stats.json` → `natural_baseline` and `phylacine_ranges`.

### RLST (v1.4): IUCN Red List status

ToLaD#48. Per row, three u32 words:

| word | bits | meaning |
|---|---|---|
| 0 | 0–7 | category code, an index into skeleton `META.red_list.categories`: `["", "LC", "NT", "VU", "EN", "CR", "EW", "EX", "DD", "NE"]` (0 = none) |
| 0 | 8–15 | source, an index into `META.red_list.sources` (`{key, label, vintage, cite, url, license}`) |
| 0 | 16–31 | year of the species' current assessment (its citation's year); for a source with no assessment, the source's vintage |
| 1 | | IUCN taxon id (0 = none) |
| 2 | | IUCN assessment id (0 = none). The assessment's page is `META.red_list.url` with `{taxon}` and `{assessment}` filled in, `https://www.iucnredlist.org/species/<taxon>/<assessment>` |

Sources, in order (`pipeline/tolad_pipeline/redlist.py`):

0. `iucn-2026-1`: the IUCN Red List of Threatened Species version 2026-1, GBIF's Darwin Core checklist
   (doi:10.15468/0qnb58, CC BY 4.0). A leaf matches by its own name, then its alt names and Open Tree
   synonyms, then PHYLACINE 1.2's synonymy (IUCN 2016-3 names) and COMBINE's IUCN 2020 binomials, then a
   Latin gender-ending variant. A synonym that is another leaf's own name is never taken.
1. `phylacine-1.2`: PHYLACINE 1.2's status column (IUCN Red List 2016-3), year 2016, for a living leaf the
   2026-1 list does not have, and for the few names the list has re-pointed at a different, extinct taxon
   (`redlist.REDEFINED`).
2. `not-listed`: neither has it (a domestic form, a recent split, an Open Tree tip no species list
   recognises): category `NE`, Not Evaluated, year 2026.

Every living species row (`T1 = 0`) has a status. A fossil has none; a species that ended after 1500 CE
carries the Red List's `EX` or `EW` where the list has it. Report: `stats.json` → `red_list`.

## Dated tree (v1.6)

ToLaD#145. The rows' own topology is Open Tree's, dated with Upham ages only where a clade is
concordant and interpolated elsewhere. The dated tree is a proper dated phylogeny of the species rows,
built by rule (`pipeline/tolad_pipeline/dated.py`): Upham et al. 2019's node-dated MCC tree (topology,
node heights, 95% HPDs) over the species matched to its tips; then the hand values in
`overrides.toml` (`[[dated_clade]]`, `[[dated_fossil]]`); then every other species row the data
defines grafted on (a fossil with a first or last appearance, a living species a Red List knows or a
curated history covers; a name no species list knows is left out). A graft hangs from the Upham node
that is the common ancestor of the matched species under its Open Tree parent: older than that node (or
on a total group's stem), it branches off the node's stem at its band start; younger, it joins that
node's split (`loose`: where inside is not known). A fossil-only subtree keeps the merged tree's shape
and ages. Extinct tips Upham placed with no genetic data are grafted like any fossil.

The sidecars are JSON, one per data file, read at build time by the fan (they are not served):
`dated/<tile id>.json` for a tile, `dated/skeleton.json` for the skeleton. Each has

- `tile`: the file's tile id (−1: the skeleton); rows below index that file's rows.
- `nodes`: the dated tree induced on the file's species rows, in preorder. A split is
  `[parent, age, lo, hi, source]` (Ma; `lo`–`hi` its 95% interval, equal to `age` when there is none;
  `source` an index into `sources`); a species is `[parent, row]`. `parent` is an index into `nodes`
  (−1 for the root). Absent when the file has no dated species.
- `names`: `{node index: name}`, the Open Tree clade name of a split whose species are exactly that
  clade's matched species (the outermost such name; " (crown)" dropped).
- `loose`: `{node index: k}`, the number of daughters of that split grafted by taxonomy only.
- `notes`: `{node index: k}`, a split from `overrides.toml`: `k` indexes the skeleton's `overrides`.
- `common`: `{row: name}`, the species' English common name (IUCN Red List 2026-1's preferred English
  vernacular name; a `[[dated_fossil]]` entry's `common`).
- `gen`: `{row: [years, how]}`, the species' generation length as the model uses it; `how` indexes
  `gen_how`: `COMBINE reported`, `COMBINE imputed` (Soria et al. 2021, Pacifici et al. 2013's values),
  or `allometric` (the model's mass fit, for fossils and species COMBINE lacks).

`skeleton.json` adds the shared tables: `sources` (`upham`, `upham-imputed`: a split that joins a tip
Upham placed with no genetic data, `fossil`: a graft's first appearance or a fossil subtree's
fossil-range age, `interpolated`: an Open Tree node's interpolated age, `override`), `upham` (the
citation), `gen_how`, `common_source`, and `overrides`: `[{name, cite, reason}]`.
Report: `stats.json` → `dated_tree`.

## Semantics of the counts

See research/02 §3 and `pipeline/tolad_pipeline/model.py`. In short:

- **Species bands:** `rate = N_alive / L`, with `L = generation length / 2`. `N_alive` is the census figure where an IUCN population report exists (Greenspoon et al. 2023 compilation), else Greenspoon's per-species model estimate, else `k · density · range area` with `k` fitted per order group and body mass. The range area is PanTHERIA's, else the PHYLACINE current range mapped onto PanTHERIA's scale (`log10 A = a + b log10 A_phy`, never above the map; ToLaD#67), else the nearest clade mean. A living species that IUCN lists as CR or EW and whose PHYLACINE current range is empty (possibly extinct) is capped at 50, IUCN's CR criterion D (ToLaD#68); `stats.json -> count_flags` lists those and the other unmapped or doubtful counts. Fossils use their PBDB first/last appearance (or a dated entry in `overrides.toml`); their body mass and range are imputed from relatives. Humans use PRB + UN WPP. Domestic stocks are added on top of the wild lineage and grow like human births since domestication: FAOSTAT livestock, plus Greenspoon's dog and cat numbers. Domestic forms with no wild population (cattle, sheep, cat, ...) have no wild band after domestication. Before 1500 CE (extinct species: over the whole band) the rate uses the natural baseline (`NATB`) where a PHYLACINE map gives one.
- **Internal bands:** the sum of the children, plus a *lineage fill* for any part of the band with no child (the stem before the first split, or gaps in fossil fans), plus *ghost lineages*. Ghosts are the 02 §2.3 top-down Mammalia total (wild births now × T_eff) minus what the sampled tree explains. At each time t they are split over the reconstructed lineages crossing t, weighted by the present-day wild births of each lineage's descendants. They are credited to the clade in whose crown the lineage runs, so a crown clade only collects ghosts after its own crown split. `GHST` lets the renderer draw them in a distinct style.
- **Total groups:** when fossils predate a clade's molecular crown age (above the Upham 95% HPD), they move onto its stem. They sit in a node that carries the clade's name, next to the crown node, which is renamed "*name* (crown)". Such nodes have the `taxonomic` flag and date source 2.
- **Uncertainty:** each leaf gets a log-normal error from its inputs. Sums use Fenton–Wilkinson, plus a shared systematic term: 0.6 dex for modelled species, 0.3 dex for species with a census or a Greenspoon estimate. Grade = the worse of the method cap and the 95% half-width (A ≤ 0.5 dex, B ≤ 1, C ≤ 2, D above).
