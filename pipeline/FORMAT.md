# ToLaD tile format, version 1

Binary columnar format for the river data. The decoder is `pipeline/decoder/tolad-decoder.js`; the round-trip test is `pipeline/decoder/test/roundtrip.test.mjs`. The writer is `pipeline/tolad_pipeline/tiles.py`.

**Versioning:** the `version` field in the header is bumped on any incompatible change. Decoders must reject unknown versions. Additive changes (new sections) keep the version, and decoders must skip sections they do not know.

## Files

```
data/mammals/
  skeleton.tld      top of the tree (kind 0) + global tables in META
  t/<id>.tld        subtree tiles (kind 1), loaded on zoom
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
| 8 | anchored count (humans, FAOSTAT livestock) |
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

## Semantics of the counts

See research/02 §3 and `pipeline/tolad_pipeline/model.py`. In short:

- **Species bands:** `rate = N_alive / L`, with `N_alive = k_occ · density · range area` and `L = generation length / 2`. Fossils use their PBDB first/last appearance and their body mass and range are imputed from relatives. Anchors replace or add to this: humans use PRB + UN WPP; livestock adds the FAOSTAT stock on top of the wild lineage, growing like human births since domestication.
- **Internal bands:** the sum of the children, plus a *lineage fill* for any part of the band with no child (the stem before the first split, or gaps in fossil fans), plus *ghost lineages*. Ghosts are the 02 §2.3 top-down Mammalia total (births now × T_eff) minus what the sampled tree explains. At each time they are split among the clades alive then, in proportion to lineage rate. `GHST` lets the renderer draw them in a distinct style.
- **Uncertainty:** each leaf gets a log-normal error from its inputs. Sums use Fenton–Wilkinson, plus a shared 0.6 dex systematic term. Grade = the worse of the method cap and the 95% half-width (A ≤ 0.5 dex, B ≤ 1, C ≤ 2, D above).
