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
```

**kind** is one of:

| kind | meaning |
|---|---|
| `census` | a count or survey total (aerial count, mark-recapture, national census) |
| `estimate` | an expert or agency estimate of the total (IUCN assessment figure, status report) |
| `index-scaled` | an index (pups, nests, pelts, density) scaled to a total by a factor the cited source gives |
| `reconstruction` | a model back-cast (catch-based stock model, carrying-capacity reasoning) |
| `unverified` | a popular figure with no traceable primary source; always grade D |

**grade**: A = direct count or model reconstruction with a stated error,
B = careful estimate with a stated range, C = rough estimate or a range
wider than 3x, D = speculative or unverified.

**baseline** is the level the species held before the recent decline. It is
also a point of the curve (at its `year`), and the build holds it constant
before that year, back to the start of the species' band. So it raises the
deep-past births rate and "individuals ever" (research/00-synthesis, "Recent
population history"). Species with no decline story have no baseline, and
the first point's level is held back instead.

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
- **Error and grade:** the leaf's log error is widened by the baseline's (or
  first point's) 95% range, and its grade is capped by that point's grade,
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
  leaf's alive and ever before (today's count held over the whole band) and
  after (with the curve and baseline).
- **Domestic** (`component = "domestic"`): the curve is the domestic stock.
  With `faostat_item`, FAOSTAT World stocks (1961 to the latest year, every 5
  years plus the latest) are added as grade B census points. Before the first
  point the existing growth since domestication (shaped like human births) is
  kept, rescaled to meet the first point.
- **Humans:** `use = "display"`: counts stay PRB + UN WPP.
