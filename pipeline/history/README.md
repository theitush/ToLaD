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

[[event]]              # optional, any number: a dated event in the species' past (see "Events")
kind    = "bottleneck"                 # only kind for now
from_ya = 25000                        # window start, years before present (older end)
to_ya   = 10000                        # window end, years before present (younger end)
title   = "North American refounding"  # 2-5 words, at most 40 characters: the label on the fan
summary = "One or two plain sentences: what happened, where, roughly how small."
quote   = "Verbatim sentence(s) copied from the source."
cite    = "Authors (year). Title. Journal vol:pages"
url     = "https://doi.org/..."
grade   = "C"                          # A | B | C | D, as for points
region  = "North America"              # optional: when it concerns part of the species
```

### Events (`[[event]]`, ToLaD#141)

Population bottlenecks are what the site is for, so each one with evidence is
marked: the fan tints its window on the species' column and names it beside
the column (where there is room), and a tap inside the window opens the card's
section on it: the title, the summary, the source's own words quoted, the
source linked and the grade. The card's population chart shows the window as a
labelled band.

- **Evidence:** every event is backed by a source that was actually read, and
  `quote` is copied from it verbatim (whitespace is normalised, nothing else).
  The window is the source's dating; where the curve in this file does not show
  the dip (PSMC's blind spot under ~20 kyr, or no figure there), the file's
  `notes` say so, and the mark stands on the source alone.
- **Validation** (`history._check_event`): the build fails on an unknown key, a
  missing field, a kind other than `bottleneck`, not `from_ya > to_ya >= 0`, an
  empty `title`, `summary`, `quote` or `cite`, a title over 40 characters, a
  non-http(s) `url`, or a grade outside A-D.
- **Build:** the events ride in the species' `META.hist` entry, oldest first
  (`pipeline/FORMAT.md` v1.5); they do not change any count. Report:
  `stats.json -> history.species[<sp>].events`.
- **Scope** (ToLaD#149): `scope = "species"` (the default: the whole species;
  tinted on its column) or `"regional"` (a subpopulation named by `region`,
  e.g. the Gir lions: on the card and its sparkline only, since the column is
  the whole species and cannot narrow for a few % of it), with `scope_why`,
  one line saying why. Every event sets both.
- **The check** (`history.event_fall`, ToLaD#149): a species-wide event must
  sit where the drawn column (the segments) falls by at least `EVENT_FALL` =
  1.5x, from its level at the window's old end to its lowest inside the window
  (the pipeline's "worth telling the reader" ratio, as `BLIND_AGAINST`). Each
  event gets `fall`, `shown` and, when not shown, `why` (blind spot, joined
  across, before the data, data rises / too shallow, not drawn), in
  `stats.json`; `shown`, `scope` and `why` ship in META (FORMAT v1.7). `make audit`
  lists unshown species-wide events as class `event`, and
  `tests/test_history.py` holds the list of the ones the curve cannot resolve
  (the card says so; the fan still tints them).

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
   the cited ones, it is scaled as a whole to meet its anchor, the higher of
   the first cited point (the baseline, if any) and the natural level ("The
   genome gives the shape" below), and held flat to it, and its oldest level
   is held back to the band start. Apart from such an anchor, with a `[deep]`
   the natural baseline is not used (it is still reported in `stats.json`): the five *Panthera* run on their PSMC curves, not on
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
  ends at the natural level (ToLaD#71; see 3. above). A genomic deep past
  anchored on its first cited count gets no trend; one anchored on the
  natural level (it is above that count) gets the trend down to it, with or
  without both maps (ToLaD#143, "The genome gives the shape").
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
  the scale factors and lists the flagged species (see "The genome gives
  the shape" below).
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
- **Rescale** to the lineage's per-year mutation rate `mu_y` (ToLaD#74,
  #75; `mutation.py`) and to the pipeline's generation length `G` (= 2L,
  from COMBINE / Pacifici et al. 2013). PSMC infers theta = 4 Ne mu (per
  generation) and time in units of 2 Ne generations. So a curve published
  with (`mu` per generation, `g` years) becomes:

  ```
  t'  = t  * (mu / g) / mu_y           time depends on the per-year rate only
  Ne' = Ne * mu / (mu_y * G)           Ne depends on the per-generation rate mu_y * G
  ```

  **The per-year rate, per lineage.** Per-year rates fall with generation
  time (short-lived mammals copy their germline more often per year), so
  one rate for all mammals is wrong by up to ~3x either way. `mu_y` comes
  from the pedigree (trio) rates of Bergeron et al. 2023 (Nature
  615:285-291, Supplementary Table 9, CC BY 4.0; pinned in
  `pipeline/SOURCES.md`): the 32 mammals with a rate per generation
  modelled at their generation time, divided by it. Over them

  ```
  log10 mu_y = a + b log10 G + offset[order]
  ```

  with a = -8.30, b = -0.77 (so the rate per generation rises as
  G^0.23), r = -0.94 and a residual scatter of 0.12 dex. The **per-clade
  table** is the order offset, the mean residual of the order's pedigree
  species, for orders with at least two of them:

  | order | offset (dex) | pedigree species |
  |---|---|---|
  | Artiodactyla (incl. whales, pig, alpaca) | -0.002 | 11 |
  | Carnivora | +0.002 | 8 |
  | Primates | -0.004 | 6 |
  | Perissodactyla | -0.147 | 2 |
  | Rodentia | +0.111 | 2 |

  Every other order takes the mammal-wide fit (offset 0). The rate is
  evaluated at the pipeline's own `G`: 5.0e-9 per year at G = 1 yr, 1.4e-9
  at 5, 8.4e-10 at 10, 4.9e-10 at 20 (great apes ~0.4e-9, as their
  pedigrees say). Pantherines (G 6-10) get 0.85-1.25e-9, close to the
  Pantherinae pedigree mean of 1.0e-9 the build used before for every
  mammal (Armstrong et al. 2025, GBE 17:evaf060: 5.5e-9 per generation at
  mean parental age 5.5 yr). That flat rate, `DEEP_MU_YEAR`, stays as the
  fallback when the table is not on disk and as the reference the factor
  is quoted against: `history.species.<sp>.deep.mu` gives each species'
  `G`, `mu_year`, `lo` / `hi`, its clade and `vs_flat` (= mu_y / 1e-9; the
  curve's times and Ne both scale by 1 / vs_flat), and
  `history.mutation_rate` has the fit and the factor for every curve
  (0.35x..1.70x over the 111 used today, median 0.88x). The power law is
  extrapolated below G = 0.7 yr, the shortest generation in the table.
- **Ne to census N:** `N = Ne' / 0.1`. The ratio is from Frankham 1995
  (Genet Res 66:95-107): the mean Ne/N over comprehensive estimates is
  0.10-0.11. No felid- or carnivore-specific long-term ratio was found
  (searched again in ToLaD#66: Palstra & Fraser 2012, Ecol Evol 2:2357,
  give 0.10-0.11 after the same corrections; Clarke et al. 2024, Mol Ecol
  e17353, and Waples 2024, Evol Appl 17:e13695, give Ne, or reviews, not a
  felid ratio). `lo` uses Ne/N 0.3
  and the fastest per-year rate, `hi` Ne/N 0.05 and the slowest: the rate
  fit's 95% prediction band, `mu_y` x/ 10^0.24 (x/ 1.74). So `lo`..`hi` is
  about 0.19x..3.5x of `n`, an 18x range.
  Each step becomes one `genomic` point at its log-midpoint in time, graded
  as in the `[deep]` table (C or D).
- **PSMC's blind spots.**
  - PSMC has little resolution in the last ~10-20 kyr, because few segments
    coalesce that recently. Steps younger than `DEEP_BLIND_YR` = 20 kyr (after
    rescaling) are dropped, **unless a cited source dates a decline there**
    (ToLaD#143, below).
  - **The blind-spot rule** (ToLaD#143). Dropping the blind steps and joining
    straight across them drew the opposite of the evidence where the next
    level is higher: the lion and leopard columns rose through 20-10 kya,
    where Figueiró et al. 2017 date the big cats' strongest post-glacial
    decline and the dropped steps themselves fall 3.5-3.8x. The rule:
    - **Kept where a source dates a decline there.** A `[deep.blind]` table
      (`cite`, `url`, `quote`, `window` = [from, to] years before present as
      the source dates it, reaching into the last 20 kyr; optional `note`)
      keeps the blind steps the window dates, older than the next point and
      than 1500 CE, as `genomic` points graded D whose notes quote the
      source: a step is kept when its span overlaps the window, at its
      log-midpoint clamped into the window. So the step overlapping the
      window's young edge is kept (it is the genome's level when the dated
      decline ends; without it the curve would stop part-way down), dated
      at that edge when its midpoint is younger, and the curve is scaled to
      meet the next level there; steps wholly younger than the window stay dropped,
      since the source dates nothing there. Lion: its 16-21, 12-15 and
      4.6-10.5 kyr steps are kept, the last dated at 10 kya (midpoint 6.9);
      its 3.5-4.1 kyr step is dropped. Leopard: its 12-23 and 9.4-10.9 kyr
      steps are kept (the second's midpoint, 10.1 kya, is inside the
      window); its 6.9-7.7 kyr step is dropped. Under the #77 rule the join
      then rose again to the next level (lion 41k at 10 kya to 500k, an
      hourglass at 10 kya no source dates); since the genome gives only the
      shape ("The genome gives the shape" below), the whole curve, decline
      included, is scaled to meet its anchor and is flat after it.
      Lion and leopard have one
      (Figueiró et al. 2017: "a second round of decline (most notably for
      the lion and leopard) between 10,000 and 20,000 years ago, following
      the last glacial maximum").
      A file whose deep past is the bulk curve (no hand-written `[deep]`)
      may hold a blind-only `[deep]`, just its `[deep.blind]` table; it
      applies to the bulk curve the same way (ToLaD#149). The cheetah has
      one (Dobrynin et al. 2015: "a second 11,084–12,589 years ago in
      Africa"): its 8.6-11.6 and 11.6-15.1 kyr steps are kept, dated at the
      window's young and old edges; their fall through the window, 1.2x, is
      the genome's own.
    - **Else dropped, and a contradiction is said, not drawn.** Where no
      source backs them, the steps stay out (one genome's weakest bins are
      not drawn as fact; across the 109 genomic curves they swing 0.03x-44x
      from the youngest resolved step, mostly unexplained). But when their
      duration-weighted log-mean level (`history.blind_mean`) is beyond
      `BLIND_AGAINST` = 1.5x from the youngest resolved step either way,
      the flat span from that step to the next level runs against them:
      flagged `deep.join.blind.against`, said in the card's sentence, and
      listed by `make audit` under `deep` (49 species in the 2026-10-11
      build, up from 17 when the join could slope with them).
    - Why this rule: it draws what a cited source and the genome agree on,
      and only that; a decline evidenced twice is shown, an unexplained
      wiggle in PSMC's weakest bins is not, and where the straight join and
      the genome disagree the reader is told. Keeping every blind step
      (tried) added 189 grade-D points and moved the genomic level away from
      the independent next level as often as towards it (33 closer, 35
      further of 68), and averaging them into one level (tried) could not
      show the leopard's fall, which sits at 7-11 kya in the build's time
      scale.
    - `stats.json -> history.species.<sp>.deep`: `points` (resolved),
      `kept_blind`, `dropped_blind`, `youngest_blind_yr_ago`;
      `deep.join.blind`: `kept`, `steps`, `vs_resolved` (youngest kept, or
      the dropped mean, ÷ the youngest resolved step), `against`, the
      source's `cite` / `url` / `window`; `history.deep_join.blind` lists
      the species kept and against.
  - Population structure, and changes in connectivity, change the
    coalescence rate just as a change in size does. A PSMC peak can be a
    period of subdivision, and a "crash" can be populations merging, not a
    change in numbers.
  - The oldest bins rest on few segments, and a single huge oldest bin is a
    known artefact (Hilgers et al. 2025, Curr Biol 35:927).
  - One genome samples one population's ancestry.

  Hence grade C at best, and D when the curve was digitised or the Ne/N ratio
  is generic. Steps older than the species band start are dropped as well.
- **The genome gives the shape, the anchor gives the number** (ToLaD#143,
  decided by Ita 2026-10-11: "use the genome estimates to scale the number
  estimates if we have them"; `history.deep_join`). It replaces the #77/#80
  join (a cited level dated 1900 or earlier scaled the curve, a modelled or
  later one kept the genome's own level and was joined log-linearly) and
  #71's 1900 cutoff. Kept like that, the absolute level made the lion and
  leopard fall through the dated 20-10 kya decline and then climb 12x and
  4.7x back to a modelled or post-1900 level, an hourglass at 10 kya that no
  source dates. Now:

  - **Shape.** The genomic curve (PSMC, plus the `[deep.blind]` steps kept
    inside a cited window) gives the relative change over time only.
  - **Number.** The whole curve (`n`, `lo`, `hi` and Ne, all by one factor)
    is scaled so its youngest point meets the **anchor**. The genome's young
    end (>= ~10-20 kya) is pre-modern, so it must meet a pre-modern level:
    the anchor is the **higher** of (a) the first cited count (a history
    file's baseline or first point, any point kind, any year) and (b) the
    modelled natural level (the level before range loss, `natural.N`; any
    living leaf with one, with or without both maps).
    - **(a) >= (b)** (the lion: 500,000 in 1950 against a natural 150,000;
      the tiger): the curve meets the count, flat between (`next` cited).
      So does a first count dated 1500 or earlier, itself pre-modern.
    - **(b) > (a)**, a count taken after a crash or a recovery from one (the
      wisent's 1924 census of 66, the giant panda's 1976 census, the
      scimitar oryx's 650 in 2026, Pere David's deer's captive-bred 2,420):
      the curve meets the natural level in 1500 CE, flat between, and the
      range-loss trend runs from there down to the count, the ordinary
      non-genomic path (#71; `model.rangeloss_start(leaf, any_natural=True)`)
      (`next` natural; `below` holds the count).
    - **No cited count** (the bulk curves' modelled records): the modelled
      level, i.e. the natural level in 1500 CE where the range-loss trend
      starts, the natural baseline, or today's modelled count (`next`
      modelled). Genomic points are older than every cited point (the 20
      kyr cutoff ensures it).
  - **No join.** The two meet: the span from the genome's young end to the
    anchor is flat (kind `interpolated`, grade D, as before).
  - **Flag.** A factor beyond `DEEP_JOIN_FLAG` = 10x either way stays
    flagged: the build prints the list, `make audit` lists it under `deep`,
    the card's sentence says so, and `stats.json -> history.deep_join`
    holds `by_next` (cited / natural / modelled), the factor spread
    (`factor`: min, p10, p25, median, p75, p90, max, `beyond_flag` up /
    down) and the flagged species, worst first.

  In the 2026-10-12 build (108 genomic species: 12 anchored on a cited
  count, 14 on the natural level above their first count, 82 on a modelled
  level), the factor has median 1.23, p10-p90 0.13-64, and 35 are beyond 10x
  (25 up, 10 down); within 2x: 29. Before the natural anchor (scaled to the
  first count of any year: 26 cited, 82 modelled) it had median 1.13, p10-p90
  0.062-53, 37 beyond 10x (23 up, 14 down): a crash set the whole deep
  past's level (*Bison bonasus* x0.0031 to 66, *Oryx dammah* x0.0039 to
  650, *Ailuropoda* x0.022, *Elaphurus* x0.037). Now the wisent is x326 to
  its natural level (6,967,269, flagged; the trend then falls 1.1e5x to the
  1924 census), the panda x0.13 (15,127), the oryx x1.4 (225,560), Pere
  David's deer x2.3 (151,250). The leopard (natural 398,802 above its 1998
  baseline of 188,000, x4.7, was x2.2) and the cougar (natural 1,019,752
  above its 2023 estimate of 776,691, x27, was x21) also move to the natural
  anchor; the lion is unchanged.

  Per species, `stats.json -> history.species.<sp>.deep.join` records `rule`
  (always `scaled`), `next` (`cited` / `natural` / `modelled`), `below`
  (the first cited count `{year, n, kind}` when the natural level above it
  is the anchor, else null), `to_kind`, `to_year`, `to_n` (the anchor),
  `deep_n_raw` (the genomic level at its young end as converted), `deep_n`
  (as built, = `to_n`), `ratio` (= `deep_n_raw` ÷ `to_n`), `factor` (= 1 /
  `ratio`), `flag` and `note`: one sentence for the species card,
  e.g. "The genome gives the shape, not the number: its curve is scaled ×12
  to meet the cited 1950 baseline (500,000), then held flat to it (flagged:
  beyond 10×)." or "... scaled ×0.5 to meet the modelled natural level in
  1500 CE (40,000; no cited count), then held flat to it." or "... scaled
  ×326 to meet the modelled natural level in 1500 CE (6,967,269), which is
  above the first cited count (1924 census, 66), taken after the decline,
  then held flat to 1500; the range-loss trend runs from there down to the
  count (flagged: beyond 10×)." Where the blind
  spot matters (ToLaD#143), the sentence starts with it: "PSMC's 3 steps in
  its blind spot (the last 20 kyr, where it resolves little) are kept, grade
  D, because Figueiró et al. 2017, ... dates a decline there: from the
  youngest resolved step (~23 kya) to the youngest kept (~10.0 kya, the
  young edge of the window it dates) the genomic level falls 3.5x.", or
  "PSMC's 3 steps in its blind spot (the last 20 kyr) average 1.7x below its
  youngest resolved step (~25 kya) but are not drawn: PSMC resolves little
  there and no source in this file dates a change, so the curve stays flat
  from that step instead (flagged)." The same sentence ships in the tiles as
  `META.hist[].deep_join` (`pipeline/FORMAT.md`), which `file.history(row)`
  returns; each scaled point's note says so too.

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
  (the lineage's `mu_y`, the leaf's `G`, Ne/N 0.1, the 20 kyr cutoff, steps older
  than the band start dropped).
- **Precedence.** A hand-written `[deep]` wins: the five *Panthera* keep
  theirs (see "Panthera sources"; the jaguar's is this table's own curve,
  written by hand with the ToLaD#66 cross-check). A wild `counts` history file without a `[deep]`
  gets the bulk curve as its `[deep]` (18 files: Bison, Loxodonta, the great
  apes, ...); its cited baseline and points stand as before, and the genomic
  points precede them. The 118 species give (before ToLaD#76): 5
  hand-written, 18 history files, 7 domestic files skipped, 88 modelled
  records.
- **Domestic forms (ToLaD#76).** A PSMC curve only covers the time before
  its ~20 kyr blind spot, so even a domestic genome's curve is the past of
  wild animals, older than any domestication. The rule: **a genome's curve
  goes on a leaf only as the deep past of the wild population living on
  that leaf today** (the model's wild alive-now > 0).
  - A leaf with a domestic history file *and* a wild population today gets
    a modelled wild record **beside** the domestic file
    (`stats.json -> genomic.species.<sp>.beside`): the wild boar beside the
    pig (`Sus_scrofa.toml`, the sample is a wild boar), the African wild ass
    beside the donkey (domestic donkey genome) and the wild water buffalo
    beside the domestic buffalo (domestic genome); the bezoar beside the
    goat file already worked this way. The wild record sets the wild
    births pieces, the domestic file the domestic ones; the leaf's alive is
    the wild count plus the domestic file's last count.
  - A leaf whose domestic form has no wild population of its own (cattle,
    sheep, horse, dromedary) gets none: its wild lineage runs only to
    domestication, modelled.
  - Domestic forms the tree carries as species of their own, with the wild
    ancestor on another leaf (`anchors.DOMESTIC_FORMS`: llama -> guanaco,
    alpaca -> vicuna, domestic yak -> wild yak, Bactrian camel -> wild
    Bactrian camel, zebu -> aurochs) get none, though the model counts them
    as wild species: their curve is the ancestor's past, and the ancestor
    carries its own genome's (the aurochs is extinct).
  - **HIST holds one record per row**, so where a leaf carries a wild and a
    domestic record, the wild one is the row's record (the species' own
    past over its whole band, as for the wolf and its dogs) and the
    domestic one is in `stats.json` only (`history.species["<sp>
    (domestic)"]` where the names clash; `hist_row` says which is shown).
- **Species with no history file** get a modelled record
  (`META.hist[].modelled = "genomic"`), which replaces the range-loss record
  of ToLaD#62 and keeps its shape after the genomic stretch: the genomic
  points; then, where the leaf has the range-loss trend, the natural level in
  1500 CE (kind `rangeloss`) and the trend to today's count (49 species);
  else straight on to today's count (39). Today's count is the model's
  alive-now, unchanged.
- **Meeting the anchor** follows "The genome gives the shape" above
  (#143; a bulk curve's blind steps are dropped unless its history
  file has a blind-only `[deep]`, #149): the whole curve is scaled so its youngest point (>= 20 kyr ago)
  meets the next level, a history file's cited baseline or first point, else
  a modelled record's 1500 natural level or today's modelled count, and the
  span between them is flat. Before #143 a modelled next level kept the
  genome's own level; the ratio genomic / next level had a median of 0.86
  over the 106 bulk curves, but 0.001..316 at the extremes (Bison 0.001
  against its 1800 baseline; Addax 316 against a natural baseline scaled
  from today's ~80 animals): those are now the scale factors' extremes,
  flagged.
- **Reports.** `stats.json -> genomic`: the source, coverage and, per curve,
  how it was used. `history.species.<sp>.deep.bulk` marks a bulk curve.

### Panthera sources (2026-10, cross-checked in ToLaD#66)

| species | curve used | mu / gen as published | g | time x / Ne x | G (pipeline) | span kept |
|---|---|---|---|---|---|---|
| lion | Armstrong et al. 2025 Fig. 4, green (species pedigree rate) | 5.42e-9 | 1 | 4.33 / 0.72 | 6.0 | 23 kyr - 3.3 Myr |
| leopard | Armstrong et al. 2025 Fig. 4, green (African, Namibia) | 7.56e-9 | 1 | 8.50 / 0.91 | 9.3 | 31 kyr - 3.1 Myr |
| tiger | Armstrong et al. 2025 Fig. 4, green (Amur) | 7.45e-9 | 1 | 7.44 / 0.93 | 8.0 | 25 kyr - 2.0 Myr |
| snow leopard | Solari et al. 2025 Fig. 3B, Mongolia | 3.62e-9 | 5 | 0.72 / 0.45 | 8.0 | 24 - 630 kyr |
| jaguar | Bergman et al. 2023 Supplementary Data 3 (DNA Zoo jaguar) | 8.41e-9 | 5 | 1.97 / 1.00 | 9.8 | 22 kyr - 3.2 Myr |

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
