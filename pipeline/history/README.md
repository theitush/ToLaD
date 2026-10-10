# Curated population history (flagship species)

One TOML file per species, `<Genus>_<species>.toml`, read by
`tolad_pipeline/history.py` at build time. Every number is a cited figure
from a paper, agency report or dataset: nothing here is invented. A figure
that is widely repeated but cannot be traced to a primary source is kept
only as grade D with `kind = "unverified"`, and the note says where it is
commonly quoted. No bulk Living Planet or IUCN data is copied, only single
figures quoted with a citation, so the build stays CC BY 4.0.

## Schema

```toml
species   = "Loxodonta africana"   # accepted binomial; must match a tree leaf
aliases   = ["..."]                # optional: other names the tree may use
common    = "African savanna elephant"
component = "wild"     # wild | domestic | total (humans)
use       = "counts"   # counts: the curve drives the model's counts
                       # display: shipped in HIST but does not change counts
                       #          (partial scope, e.g. one subspecies, or humans)
scope     = "global, all ages"     # what the counts cover
faostat_item = 866     # domestic only: add FAOSTAT QCL World stocks (1961-)
notes     = "free text"

[baseline]             # optional: the pre-decline level
year  = 1800           # the date the figure describes
n     = 2.0e7          # point estimate (individuals)
lo    = 1.0e7          # range low  (same as n if the source gives none)
hi    = 2.7e7          # range high
grade = "D"            # A | B | C | D
kind  = "reconstruction"
cite  = "Author Year, Journal vol:pages"
url   = "https://doi.org/..."
note  = "how the figure was obtained, caveats"

[[point]]              # one per dated figure, any order (sorted at build)
year  = 1979           # calendar year (negative = BCE)
n     = 1.3e6
lo    = 1.1e6
hi    = 1.8e6
grade = "C"
kind  = "estimate"
cite  = "..."
url   = "..."
note  = "..."

[deep]                 # optional, wild counts only: a genome-based Ne history (see "Deep past")
method = "PSMC"        # PSMC | MSMC | MSMC2 | SMC++
cite   = "Author Year, Journal vol:page, Fig. N (which curve)"
url    = "https://doi.org/..."
mu     = 5.42e-9       # the curve's mutation rate, per site per GENERATION, as published
g      = 5.0           # the curve's generation time, years, as published
grade  = "D"           # C or D only
note   = "how the curve was read (table, or digitising method and its error)"
steps  = [             # [years ago from, years ago to, Ne] as published, young to old
  [19670, 23780, 26800],
  # ...
]
```

**kind** is one of:

| kind | meaning |
|---|---|
| `census` | a count or survey total (aerial count, mark-recapture, national census) |
| `estimate` | an expert or agency estimate of the total (IUCN assessment figure, status report) |
| `index-scaled` | an index (pups, nests, pelts, density) scaled to a total by a factor the cited source gives |
| `reconstruction` | a model back-cast (catch-based stock model, carrying-capacity reasoning) |
| `unverified` | a popular figure with no traceable primary source; always grade D |
| `genomic` | (build only) a point compiled from `[deep]`; not allowed in `[[point]]` |

**grade**: A = direct count or model reconstruction with a stated error,
B = careful estimate with a stated range, C = rough estimate or a range
wider than 3x, D = speculative or unverified.

**baseline** is the level the species held before the recent decline. It is
also a point of the curve (at its `year`), and the build holds it constant
before that year, back to the start of the species' band (unless a `[deep]`
genomic history covers the deep past instead; see "Deep past"). So it raises the
deep-past births rate and "individuals ever" (research/00-synthesis, "Recent
population history"). A wild species with no cited baseline keeps the
model's level before its first point (its natural baseline, see below, or
without one today's count), with a step to the curve at the first point. This keeps a
recorded bottleneck (e.g. ~100 northern elephant seals in 1890) from being
held back over the whole band.

**Natural baseline (ToLaD#61).** Every species with a PHYLACINE range map
also gets a modelled pre-human level: density × present-natural range ×
occupancy, grade D, kind `reconstruction` (`pipeline/FORMAT.md`, "NATB";
`model.natural_level`). The deep past of a wild `counts` species is, in
order of precedence:

1. a cited `[baseline]` here (it wins, whatever the natural baseline says;
   it governs from its year on);
2. a genomic `[deep]` curve (see "Deep past"): its points are all older than
   the cited ones, it joins the first cited point (the baseline, if any)
   log-linearly, and its oldest level is held back to the band start. With
   a `[deep]` the natural baseline is not used at all (it is still reported
   in `stats.json`): the five *Panthera* run on their PSMC curves, not on
   the natural baseline;
3. else the natural baseline, held from the band start to the first cited
   point (HIST segment kind `natural`, 10), then a step to the curve;
4. else (no range map) today's level, as above (segment kind `model`).

A species with no history file runs at its natural baseline until 1500 CE,
then steps to today's count (or, extinct, at the natural baseline over its
whole band). That is a step, not a trend: the range-loss trend between the
two levels is ToLaD#62. Where the natural and current ranges are the same
map, the natural baseline equals today's count and nothing changes.

## How the build uses it (`tolad_pipeline/history.py`)

- **Validation:** the build fails on an unknown key, a missing field, a bad
  grade or kind, `lo <= n <= hi` violated, an `unverified` point not graded
  D, or a species that matches no tree leaf.
- **Curve:** points sorted by year, interpolated log-linearly (`log N` linear
  in years) between points, so the curve passes through every point exactly.
  Spans between two points are marked `interpolated` and carry the worse
  grade of their two ends.
- **Alive now:** the latest point if it is from 2000 or later and graded A-C;
  otherwise the model's alive-now figure stays and is appended to the curve
  as a `model` point, so the curve and the green lane agree.
- **Error and grade:** the leaf's log error is widened by the deep-past
  level's 95% range (the cited baseline, else the natural baseline, else the
  latest point; with a `[deep]`, the wider of that and the oldest genomic
  point's), and its grade is capped by that level's grade (the worse of the two),
  because the deep-past level dominates "ever".
- **Births:** births/yr = `N(t) / L`, with `L = G / 2` the census-pool
  residence time (research/02 §3.1). Before the baseline year the rate is
  `N_baseline / L`; from there to now it follows the curve.
- **Procgen segments:** births per generation = alive × `G` ÷ lifespan =
  `N(t) · G / L` (= `2 N(t)` with `L = G / 2`). Segment boundaries snap to
  whole generations counted back from now; a span whose level changes by more
  than 2x is split into sub-spans of at most ~1.41x each, because procgen
  ramps linearly. For wild species the first segment holds the baseline back
  to the start of the species band; for domestic stocks and humans the
  segments cover the curated span only. Shipped in the tile `HIST` section
  (`pipeline/FORMAT.md`, v1.1).
- **Report:** `data/mammals/stats.json -> history` lists, per species, the
  leaf's alive and ever before (the model alone: natural baseline before
  1500 where it differs, else today's count) and after (with the curve and
  baseline), the deep-past level before and after, and `deep_from`: what
  sets the level at the band start (`genomic`, `baseline`, `natural` or
  `today`, in that order of precedence).
- **Domestic** (`component = "domestic"`): the curve is the domestic stock.
  With `faostat_item`, FAOSTAT World stocks (1961 to the latest year, every 5
  years plus the latest) are added as grade B census points. Before the first
  point the existing growth since domestication (shaped like human births) is
  kept, rescaled to meet the first point.
- **Humans:** `use = "display"`: counts stay PRB + UN WPP.

## Deep past (`[deep]`, layer 3 of the estimate stack)

Before the oldest cited figure the build held one level (the baseline) back
to the start of the species band, millions of years. A `[deep]` table
replaces that flat line with the species' published genome-based
effective-size history (PSMC, MSMC, ...). It is recorded **as published**, in
the source's own scaling. The build does the rescaling and the conversion
(`history.deep_scale`, `history.deep_points`), so every species is treated
the same way by code rather than by hand.

- **Reading the curve.** Use a supplementary table where one exists.
  Otherwise digitise the figure and state how in `note`: the axis
  calibration, how the curve was traced, and the reading error. Each PSMC
  step is one `[from, to, Ne]` row.
- **Rescale** to one per-year mutation rate, `DEEP_MU_YEAR` = 1.0e-9 per site
  per year, and to the pipeline's generation length `G` (= 2L, from COMBINE /
  Pacifici et al. 2013). The rate is the Pantherinae pedigree mean, 5.5e-9 per
  generation at mean parental age 5.5 yr (Armstrong et al. 2025, GBE
  17:evaf060). PSMC infers theta = 4 Ne mu (per generation) and time in units
  of 2 Ne generations. So a curve published with (`mu` per generation, `g`
  years) becomes:

  ```
  t'  = t  * (mu / g) / mu_y           time depends on the per-year rate only
  Ne' = Ne * mu / (mu_y * G)           Ne depends on the per-generation rate mu_y * G
  ```

  The per-year rate is held fixed, so a longer generation means more
  mutations per generation. That is a simplification: per-generation rates
  rise with parental age, but less than in proportion. #64 must choose `mu_y`
  per clade before this is applied to all mammals.
- **Ne to census N:** `N = Ne' / 0.1`. The ratio is from Frankham 1995
  (Genet Res 66:95-107): the mean Ne/N over comprehensive estimates is
  0.10-0.11. No felid-specific long-term ratio was found. `lo` uses Ne/N 0.3
  and the fastest per-year rate (1.5e-9: tiger, 7.45e-9 per generation at
  parental age 5). `hi` uses Ne/N 0.05 and the slowest rate (0.8e-9: leopard,
  7.56e-9 at 9.4). So `lo`..`hi` is about 0.22x..2.5x of `n`, an 11x range.
  Each step becomes one `genomic` point at its log-midpoint in time, graded
  as in the `[deep]` table (C or D).
- **PSMC's blind spots.**
  - PSMC has little resolution in the last ~10-20 kyr, because few segments
    coalesce that recently. Steps younger than `DEEP_BLIND_YR` = 20 kyr (after
    rescaling) are dropped.
  - Population structure, and changes in connectivity, change the
    coalescence rate just as a change in size does. A PSMC peak can be a
    period of subdivision, and a "crash" can be populations merging, not a
    change in numbers.
  - The oldest bins rest on few segments, and a single huge oldest bin is a
    known artefact (Hilgers et al. 2025, Curr Biol 35:927).
  - One genome samples one population's ancestry.

  Hence grade C at best, and D when the curve was digitised or the Ne/N ratio
  is generic. Steps older than the species band start are dropped as well.
- **Joining.** Genomic points are older than every cited point (the 20 kyr
  cutoff ensures it), so the baseline is no longer the oldest point. The curve
  passes through every point. The youngest genomic point is therefore joined
  to the first cited point (the baseline, if any) by the usual log-linear
  span, which is continuous by construction. That span crosses the blind spot,
  so it is marked `interpolated` and carries the worse grade of its two ends
  (D).

  The deep curve is not scaled to meet the baseline. Scaling it would let one
  recent figure, often a grade D guess, set the level of a million years.
  Instead the mismatch is reported in `stats.json -> history.species.<sp>.deep.join`:
  `ratio` = the genomic level at the cutoff ÷ the first cited level.

  Before the oldest genomic point, the oldest genomic level is held back to
  the band start (a `held` segment). It replaces the baseline hold, or
  today's level where there is no baseline.
- **Build effects.** Spans between two genomic points are compiled into
  segments of kind `genomic` (HIST kind 9). The leaf's error is widened by the
  larger of the baseline's range and the genomic range, and its grade is
  capped by the worse of the two. `stats.json -> history.species.<sp>.deep`
  records the points kept and dropped, the span covered, the band start, the
  scale factors and the join.

### Panthera sources (2026-10)

| species | curve used (Armstrong et al. 2025 Fig. 4) | mu / gen as published | g | time x / Ne x | G (pipeline) | span kept |
|---|---|---|---|---|---|---|
| lion | green (species pedigree rate) | 5.42e-9 | 5 | 1.08 / 0.90 | 6.0 | 23 kyr - 1.34 Myr |
| leopard | green | 7.56e-9 | 5 | 1.51 / 0.81 | 9.3 | 20 kyr - 1.87 Myr |
| tiger | green | 7.45e-9 | 5 | 1.49 / 0.93 | 8.0 | 32 kyr - 0.61 Myr |
| snow leopard | green | 3.62e-9 | 5 | 0.72 / 0.45 | 8.0 | 33 - 81 kyr |
| jaguar | dark blue (maximum rate) | 1.0e-8 | 5 | 2.00 / 1.02 | 9.8 | 28 kyr - 0.77 Myr |

One paper covers all five species, each with its own pedigree mutation rate,
so the curves share one pipeline, one PSMC setting and one plotting script.
The paper's jaguar green curve is a copy of the leopard's, so the jaguar's
dark-blue curve is used instead and rescaled here (`Panthera_onca.toml`).

These were not digitised:

- Cho et al. 2013, doi:10.1038/ncomms3433 (neutral rates, g 5);
- Figueiró et al. 2017, doi:10.1126/sciadv.1700299 (mu 1e-8, g 5, all five species);
- de Manuel et al. 2020, doi:10.1073/pnas.1919423117 (mu 4.5e-9);
- Armstrong et al. 2021, doi:10.1093/molbev/msab032 (tiger, mu 3.5e-9);
- Paijmans et al. 2021, doi:10.1016/j.cub.2021.03.084 (leopard; not open in PMC);
- Solari et al. 2025, doi:10.1073/pnas.2502584122 (snow leopard; mu 3.62e-9, g 5).

Cross-checking against them is a follow-up.
