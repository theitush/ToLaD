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
   the natural baseline; the bulk curves of ToLaD#64 (see "Bulk genomic
   deep past") give ~100 more species one;
3. else the natural baseline, held from the band start to the first cited
   point (HIST segment kind `natural`, 10), then a step to the curve; where
   the leaf has the range-loss trend (both maps, see below) and the first
   cited point is after 1500, it is held to 1500 only, and the trend runs
   from there to the first cited point (ToLaD#71): the history file gains
   the trend's first knot (kind `rangeloss`, grade D) and the span to the
   first point is kind `rangeloss`, not a step. The trend never runs
   upward (ToLaD#93): where the natural level is below the first cited
   point, the natural level is evidently an underestimate there, so the
   knot takes the cited level instead and the span from 1500 to the point
   is a `held` one (grade D, flat); the knot's note says so, and
   `stats.json -> history.trend_held` lists those species;
4. else (no range map) today's level, as above (segment kind `model`).

**Range-loss trend (ToLaD#62, layer 4 of the estimate stack).** A species
with no history file whose natural baseline differs from today's count, and
which has both PHYLACINE maps (current and present-natural), runs at its
natural baseline until 1500 CE and then changes **log-linearly** to today's
count now (`model.rangeloss_record`). The factor `N_nat / N_today` is the
range ratio (natural ÷ current cells). It ships as a modelled HIST record
of two points (the natural level in 1500, kind `rangeloss`, grade D; today's
count, kind `model`) and segments `natural` (held from the band start) then
`rangeloss` (HIST kind 11, grade D); the births pieces follow the same curve
in 25-year steps.

- **Timing, an assumption:** 1500 CE for every species and region, the start
  of the IUCN Red List's "since 1500" window (IUCN 2012, Categories and
  Criteria v3.1), already the step year of the natural baseline. Real range
  loss was mostly later and uneven (19th-20th century land conversion;
  Australia's mammal collapse after 1788), so the trend spreads over five
  centuries a decline that was often concentrated in one or two. No
  per-region start is modelled.
- **Precedence:** a history file replaces it (cited baseline, genomic or
  natural baseline before the first cited point, as below), but keeps the
  trend in the gap from 1500 to its first cited point where its deep past
  ends at the natural level, or at a genomic curve not scaled to that point
  (ToLaD#71; see 3. above and "Joining").
  Species whose two maps agree stay flat at today's count. Extant species
  with no current map (their natural level comes from density x area x
  occupancy, not from a range ratio) keep the #61 step. Extinct species run
  at the natural baseline over their whole band.
- **Report:** `stats.json -> rangeloss` (factor histogram, largest declines,
  rises, showcase).

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
  `today`, in that order of precedence). With a genomic deep past,
  `deep.join` says how it met the next level, and `history.deep_join` sums
  the rules and lists the flagged species (see "Joining" below).
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
  rise with parental age, but less than in proportion. The bulk curves of
  #64 (below) use the same `mu_y`; their sources' own per-year rates
  (`mu / g`) run 0.35x..2.55x of it (median 1.45x), so a per-clade `mu_y`
  is still open (see "Bulk genomic deep past").
- **Ne to census N:** `N = Ne' / 0.1`. The ratio is from Frankham 1995
  (Genet Res 66:95-107): the mean Ne/N over comprehensive estimates is
  0.10-0.11. No felid- or carnivore-specific long-term ratio was found
  (searched again in ToLaD#66: Palstra & Fraser 2012, Ecol Evol 2:2357,
  give 0.10-0.11 after the same corrections; Clarke et al. 2024, Mol Ecol
  e17353, and Waples 2024, Evol Appl 17:e13695, give Ne, or reviews, not a
  felid ratio). `lo` uses Ne/N 0.3
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
- **Joining** (ToLaD#77, decided by Ita 2026-10-11; built in #80, `history.deep_join`).
  Genomic points are older than every cited point (the 20 kyr cutoff ensures
  it), so the baseline is no longer the oldest point. The curve passes through
  every point, so the youngest genomic point is joined to the **next level**
  (the first non-genomic point) by the usual log-linear span, marked
  `interpolated`, grade D (the worse of its two ends), across the blind spot.
  What happens to the genomic level depends on what that next level is:

  - **Cited** (a history file's baseline or first point: any point kind, i.e.
    `census`, `estimate`, `index-scaled`, `reconstruction`, `unverified`)
    dated **1900 or earlier** (`DEEP_JOIN_CITED_MAX_YEAR`): the
    genomic curve is **scaled** (its `n`, `lo`, `hi` and Ne, all by one factor)
    so its youngest point meets the cited level. The PSMC shape is kept; the
    cited count is better evidence of the level than the generic Ne/N = 0.1.
    The join span is then flat. E.g. *Bison bison*: x981 to meet the 1800
    baseline of 42 million.
  - **Modelled** (the natural level in 1500 CE of the range-loss trend, or
    today's modelled count): the genomic curve **keeps its own level** and
    joins the modelled level log-linearly (the #60 rule).
  - **Flag.** Either way, a species whose genomic / next-level ratio (before
    any scaling) is beyond `DEEP_JOIN_FLAG` = 10x either way is flagged: the
    build prints the list, and `stats.json -> history.deep_join` holds the
    counts per rule and the flagged species, worst first.

  Per species, `stats.json -> history.species.<sp>.deep.join` records `rule`
  (`scaled` / `absolute`), `next` (`cited` / `modelled`), `to_kind`,
  `to_year`, `to_n`, `deep_n_raw` (the genomic level at the cutoff as
  converted), `deep_n` (as built), `ratio` (= `deep_n_raw` ÷ `to_n`),
  `factor` (the scale applied, 1 when kept), `flag` and `note`: one sentence
  for the species card, e.g. "Genomic curve scaled x981 to meet the cited 1800
  baseline (42,000,000), keeping its shape; before scaling it was 981x below
  that level (flagged: beyond 10x)." or "Genomic curve kept at its own level;
  the modelled natural level in 1500 CE is 316x lower (flagged: beyond 10x);
  the two are joined log-linearly across PSMC's last 20 kyr." The same
  sentence ships in the tiles as `META.hist[].deep_join` (`pipeline/FORMAT.md`),
  which `file.history(row)` returns; a scaled curve's point notes say so too.

  - **Cited after 1900** (ToLaD#71; the dispatcher's call on #80, 2026-10-11):
    a first cited point after 1900 is mostly a bottleneck or a modern count,
    not a pre-human level (*Bison bonasus* 1924, 66 animals; *Oryx dammah*
    2026, 650; *Ailuropoda* 1976, 2,459), and a million years of deep past
    should not be scaled to it. The genomic curve **keeps its own level** and
    joins the natural level in 1500 CE, and a log-linear trend (kind
    `rangeloss`) then runs from there to the cited point, also where the
    model itself has no range-loss trend (no current range map, as for the
    scimitar oryx, or two maps that agree). Only a leaf with no natural level
    at all joins the cited point itself, unscaled. The
    card sentence says so: "First cited point (1924 census, 66) is after
    1900, so not used as the deep past's level. Genomic curve kept at its own
    level; ...". `deep.join.cited_late` records that point;
    `stats.json -> history.deep_join.cited_late` counts both cases.
    Where the natural level in 1500 is below the cited point, the trend
    would rise (lion 150,000 in 1500 -> 500,000 in 1950), so the cited level
    is held back to 1500 instead and the genomic curve joins that (ToLaD#93;
    the join's ratio and flag are taken against it). The card sentence ends
    "... that point's level, held back to 1500 CE because the modelled
    natural level there (150,002) is below it (evidently an underestimate),
    is 2.1x higher; ..., then that level is held flat to the cited point,
    with no range-loss trend rising to it." In the 2026-10-11 build:
    *Panthera leo*, *Pongo pygmaeus*, *Diceros bicornis*, *Gorilla beringei*.

  Before the oldest genomic point, the oldest genomic level is held back to
  the band start (a `held` segment). It replaces the baseline hold, or
  today's level where there is no baseline.
- **Build effects.** Spans between two genomic points are compiled into
  segments of kind `genomic` (HIST kind 9). The leaf's error is widened by the
  larger of the baseline's range and the genomic range, and its grade is
  capped by the worse of the two. `stats.json -> history.species.<sp>.deep`
  records the points kept and dropped, the span covered, the band start, the
  scale factors and the join.

## Bulk genomic deep past (ToLaD#64, `tolad_pipeline/genomic.py`)

Hand-written `[deep]` tables do not scale past a handful of species, so the
build also reads one published table of PSMC curves and turns each into the
same `[deep]` structure in memory. Nothing is written into these TOMLs.

- **Source.** Bergman et al. 2023, *Nat Commun* 14:7679 (CC BY 4.0): PSMC on
  one genome of each of 139 extant megafauna species (>= 44 kg).
  Supplementary Data 3 lists every trajectory (sample, years ago, Ne, in the
  paper's scaling); Supplementary Data 1 gives each sample's mutation rate
  per generation and generation time (mostly modelled from mass, their
  Supplementary Note 1). Both are pinned by `tolad-fetch` (`bergman/`).
  Zoonomia (Wilder et al. 2023) was checked first: its supplement and its
  code repository hold only the harmonic mean of each curve, not the curve.
- **Per species.** One sample: the reference-genome sample (bare binomial or
  DNA Zoo), else the nominate subspecies (the one their Supplementary Data 2
  uses), else the first by name. PSMC steps are kept as they come (no
  resampling); the first step (from 0, inside the blind spot) and the
  open-ended last one are left out, and at most 30 steps are kept
  (`STEP_CAP`; none of the 118 curves needs merging today, 22-29 steps
  each). `mu` and `g` are the source's, grade D for all (one genome,
  modelled rates). Then the conversion above applies unchanged
  (`DEEP_MU_YEAR`, the leaf's `G`, Ne/N 0.1, the 20 kyr cutoff, steps older
  than the band start dropped).
- **Precedence.** A hand-written `[deep]` wins: the five *Panthera* keep
  theirs (see "Panthera sources"; the jaguar's is this table's own curve,
  written by hand with the ToLaD#66 cross-check). A wild `counts` history file without a `[deep]`
  gets the bulk curve as its `[deep]` (18 files: Bison, Loxodonta, the great
  apes, ...); its cited baseline and points stand as before, and the genomic
  points precede them. Domestic history files (cattle, sheep, horse, ...)
  get none. The 118 species give: 5 hand-written, 18 history files, 7
  domestic files skipped, 88 modelled records.
- **Species with no history file** get a modelled record
  (`META.hist[].modelled = "genomic"`), which replaces the range-loss record
  of ToLaD#62 and keeps its shape after the genomic stretch: the genomic
  points; then, where the leaf has the range-loss trend, the natural level in
  1500 CE (kind `rangeloss`) and the trend to today's count (49 species);
  else straight on to today's count (39). Today's count is the model's
  alive-now, unchanged.
- **The join at the blind spot** follows "Joining" above (#80): the youngest
  genomic point (>= 20 kyr ago) joins the next level by one log-linear span,
  kind `interpolated`, grade D. A history file's cited baseline or first
  point scales the curve to meet it; a modelled record's next level (the 1500
  natural level, or today's modelled count) is modelled, so its curve keeps
  its own level. Every modelled record is therefore `absolute`; scaling
  happens only in history files (bulk or hand-written `[deep]`). Before
  #80 the ratio genomic / next level had a median of 0.86 over the 106 bulk
  curves, but 0.001..316 at the extremes (Bison 0.001 against its 1800
  baseline, now scaled; Addax 316 against a natural baseline scaled from
  today's ~80 animals, kept and flagged).
- **Reports.** `stats.json -> genomic`: the source, coverage and, per curve,
  how it was used. `history.species.<sp>.deep.bulk` marks a bulk curve.

### Panthera sources (2026-10, cross-checked in ToLaD#66)

| species | curve used | mu / gen as published | g | time x / Ne x | G (pipeline) | span kept |
|---|---|---|---|---|---|---|
| lion | Armstrong et al. 2025 Fig. 4, green (species pedigree rate) | 5.42e-9 | 1 | 5.42 / 0.90 | 6.0 | 23 kyr - 3.0 Myr |
| leopard | Armstrong et al. 2025 Fig. 4, green (African, Namibia) | 7.56e-9 | 1 | 7.56 / 0.81 | 9.3 | 27 kyr - 2.8 Myr |
| tiger | Armstrong et al. 2025 Fig. 4, green (Amur) | 7.45e-9 | 1 | 7.45 / 0.93 | 8.0 | 25 kyr - 2.0 Myr |
| snow leopard | Solari et al. 2025 Fig. 3B, Mongolia | 3.62e-9 | 5 | 0.72 / 0.45 | 8.0 | 24 - 630 kyr |
| jaguar | Bergman et al. 2023 Supplementary Data 3 (DNA Zoo jaguar) | 8.41e-9 | 5 | 1.68 / 0.86 | 9.8 | 29 kyr - 3.4 Myr |

**Armstrong et al. 2025 Fig. 4 is plotted in generations.** Its methods set
the generation time to five years, "provided as a g = 1 for this particular
scaling script" (psmcr). Other genomes' PSMC curves line up with the
figure's only when its times are multiplied by ~5: for the lion, five
curves from four groups (best factor x4.4-5.3); for the jaguar, the same
genome in Bergman et al. 2023 (x5.5); for the tiger, x6-9. For the leopard
the Amur curve meets the African one before their split (0.7-3.5 Myr) at
x1.13 when read as g = 1, and fits worse as g = 5. So these tables record
`g = 1`: their times are generations, and Ne does not depend on g. The
snow-leopard panel alone does not show the offset, because its curve rises
steadily over the short span it covers, so time and level trade off.
Before ToLaD#66 the curves were read as g = 5, which made every deep event
five times too recent.

**Cross-check**, after the same rescale: the level of each other curve
against the one used, from the 20 kyr cutoff to the older end, and the
log-residual left after that level (the shape misfit). The charts are in
`.claude/handoff/previews/psmc66-shots/` (local), and each `[deep]` note
has the details.

- **Lion.** The other curves agree: Bergman 2023 x1.25 (residual x1.13),
  Cho et al. 2013 African lion x1.17 and white lion x1.05, Figueiró et al.
  2017 x0.84, and de Manuel et al. 2020's southern lineage x1.17. The one
  that disagrees is de Manuel's northern (Barbary) lion (x0.67, residual
  x2.2), a different lineage with a deep bottleneck.
- **Leopard.** Armstrong's genome is African. The other curves, all Amur
  leopards, agree only before the split (Bergman x1.13 over 0.7-3.5 Myr).
  After it they run x0.30 (Bergman) and x0.23 (Figueiró). Paijmans et al.
  2021's Fig. 3A is not open, so it was not read.
- **Tiger.** The other curves agree within x1.5 in level: Bergman's Amur,
  DNA Zoo and Malayan tigers x1.3-1.5, Cho's Amur and white Bengal tigers
  x1.34 and x1.26, and Figueiró x0.69 (a rough reading). Their features
  still sit ~1.3-2x older. The PSMC of Armstrong et al. 2021 is an EMF in
  its supplement, so it was not read.
- **Snow leopard.** The curve is replaced by Solari et al. 2025: it uses
  the same rate, is wild and deep-covered, and reaches ~0.9 Myr. The old
  curve gave three points (33-81 kyr); this one gives 17. Solari's other
  three populations come out at x0.80-1.03, Cho x0.93, Figueiró x0.82,
  Bergman x0.88 and Armstrong 2025 x0.83 (as published).
- **Jaguar.** The curve is replaced by the Bergman table. Armstrong's
  jaguar panel has two problems: its green curve is the leopard's, and its
  time axis is in generations. Its dark-blue curve, read as g = 1, lands on
  the Bergman table (x0.94, residual x1.20), and that table comes from the
  same genome. Figueiró's Pantanal jaguar disagrees (x0.13, no peak). Its
  level implies a heterozygosity far below the jaguar's measured ~8e-4
  (Solari et al. 2025 Fig. 3A), so it is not used.

Sources: Cho et al. 2013, doi:10.1038/ncomms3433 (Fig. 4b, vector paths
from the PDF; neutral rates per year x g 5); Figueiró et al. 2017,
doi:10.1126/sciadv.1700299 (Fig. 1B, raster from the PDF; mu 1e-8, g 5); de
Manuel et al. 2020, doi:10.1073/pnas.1919423117 (Fig. 3A, rendered from the
PDF; mu 4.5e-9, g 5); Solari et al. 2025, doi:10.1073/pnas.2502584122
(Fig. 3B, raster from the PDF); Bergman et al. 2023 (table). The scripts
were scratch work and are not kept.
