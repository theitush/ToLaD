"""When each species lost its range, from cited evidence (ToLaD#507 group 3, research in ToLaD#515).

The tree draws a living species whose PHYLACINE present-natural map is bigger than its current one falling
log-linearly from its natural level to today's count (model.rangeloss_record). `range_loss_dates.csv` (this
directory's copy of `research/range-loss-dates.csv`, ToLaD#515, columns `binomial, basis, earliest_year,
latest_year, source, citation, confidence, dated_share`; how each of the 682 was classed is in
`research/range-loss-dates.md`) says what dates each loss. Nothing here is modelled: every year is the source's.

Each species gets one basis (BASES):

- `later`: a source documents the loss starting after 1500 (Australia 1788, the fur trade, Cape settlement,
  Rodrigues settled 1691 ...). The level holds at the natural level to that year, and the same fall is drawn
  from it to today's count.
- `dated`: the loss is dated 1500 -> today (IUCN's Extinct / Possibly Extinct codes, historic-range sources
  bounded by 1500, and three with only an end year). The drawing is unchanged. ToLaD#594: the codes are read on
  IUCN 2026's own maps for all 682 (research/range-loss-dates/iucn_codes.py): a species that nothing else dated, or
  only an island bound, is `dated` when the 2026 codes cover at least half its lost cells (the island rule's majority);
  PHYLACINE's 78, dated by the 2016-3 maps, cite IUCN 2026 where the 2026 maps still code at least half of theirs.
- `prehistoric`: part of the loss is dated before 1500 (PREHISTORIC: the place the evidence names). Those cells,
  worked out from the rasters, are left out of the level held to 1500 (model.natural_level).
- `bound`: only a lower bound: people's arrival on the island that holds most of the lost cells, or (the moose)
  the Iron Age range the map was taken from. The drawing is unchanged; the source says the bound.
- `undated`: nothing dates it (`none`, and the four maps built from fossils). The drawing is unchanged.
"""

from __future__ import annotations

import csv
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "range_loss_dates.csv"
BASES = ("later", "dated", "prehistoric", "bound", "undated")
DEFAULT_START = 1500  # model.NATURAL_STEP_YEAR, IUCN's "since 1500" window

# The part of a `prehistoric` species' loss that the evidence dates before 1500: the place, and the lost cells
# (present-natural, not current) whose centres lie in its box(es) (lon_min, lon_max, lat_min, lat_max; degrees).
PREHISTORIC = {
    # mainland extinction ~3,200 BP (Brown 2006; White et al. 2018): every lost cell north of Bass Strait
    "Sarcophilus harrisii": ("mainland Australia", [(110.0, 155.0, -39.3, -10.0)]),
    # the mid-Holocene Baltic breeding population (Stora & Ericson 2004)
    "Pagophilus groenlandicus": ("the Baltic Sea", [(9.0, 31.0, 52.5, 67.0)]),
    # the mainland lineage, abundant in early Maori middens (ca 1280-1450 AD) and absent from later sites
    # (ca 1450-1792 AD) (Collins et al. 2014 Proc. R. Soc. B 281:20140097): mainland New Zealand, Stewart Island too
    "Phocarctos hookeri": ("mainland New Zealand", [(165.0, 179.9, -48.0, -33.0)]),
    # known in North America only from Late Pleistocene fossils (Kurten & Anderson 1980)
    "Cuon alpinus": ("North America", [(-170.0, -50.0, 7.0, 75.0)]),
    # horses died out in the Americas in the Late Pleistocene (Guthrie 2003)
    "Equus ferus": ("the Americas", [(-170.0, -30.0, -60.0, 75.0)]),
}
# a `prehistoric` row whose evidence gives only a start older than 1500, not which cells went before it: a bound
BOUND_ONLY = {"Alces alces": "its Iron Age range"}
# the island a lower bound names, where the source text does not say it after "first human arrival: "
PLACE = {"Rodrigues had no people": "Rodrigues", "Historically widespread in NZ": "New Zealand"}


def _year(s: str) -> int | None:
    return int(s) if s.strip() else None


def load(path: Path = PATH) -> dict[str, dict]:
    """Binomial (PHYLACINE's) -> {basis (BASES), start (the fall's first year), place, src (key into the
    sources table: the full citation), row (the CSV row)}."""
    out = {}
    with path.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            out[r["binomial"]] = classify(r)
    return out


def classify(r: dict) -> dict:
    b, y0 = r["basis"], _year(r["earliest_year"])
    place = ""
    if r["source"].startswith("first human arrival: "):
        place = r["source"][len("first human arrival: "):]
    for k, v in PLACE.items():
        if r["source"].startswith(k):
            place = v
    if y0 is not None and y0 > DEFAULT_START and b in ("historic", "island"):
        basis = "later"
    elif b in ("iucn_codes", "historic"):
        basis = "dated"
    elif b == "prehistoric" and r["binomial"] in PREHISTORIC:
        basis, place = "prehistoric", PREHISTORIC[r["binomial"]][0]
    elif b == "prehistoric" and r["binomial"] in BOUND_ONLY:
        basis, place = "bound", BOUND_ONLY[r["binomial"]]
    elif b in ("island", "fossil") and place:
        basis = "bound"
    elif b in ("none", "fossil"):
        basis = "undated"
    else:
        raise ValueError(f"{PATH.name}: {r['binomial']}: basis {b!r} not classed")
    return {"basis": basis, "start": y0 if basis == "later" else DEFAULT_START, "place": place,
            "src": " ".join(r["citation"].split()) if r["citation"] else "", "row": r}


def sources(dates: dict[str, dict]) -> list[dict]:
    """The citation table, one entry per distinct (citation, window, place): {cite, from, to, place}. `from`
    and `to` are the source's years (negative = BCE; None = no bound); `place` the island or region a bound or
    a prehistoric part names ("" for none). Species point into it by index (`key`)."""
    out: dict[tuple, int] = {}
    for sp in sorted(dates):
        d = dates[sp]
        if not d["src"]:
            continue
        k = (d["src"], _year(d["row"]["earliest_year"]), _year(d["row"]["latest_year"]), d["place"])
        d["key"] = out.setdefault(k, len(out))
    return [{"cite": c, "from": a, "to": b, "place": p} for (c, a, b, p) in out]


def _cell_lonlat(cell: tuple[int, int], edges: list[float]) -> tuple[float, float]:
    r, c = cell
    return -180.0 + c + 0.5, (edges[r] + edges[r + 1]) / 2


def prehistoric_cells(raw: Path, dates: dict[str, dict]) -> dict[str, dict]:
    """Binomial -> {place, cells}: the lost cells (present-natural, not current) the evidence dates before 1500,
    cell by cell from the rasters, for every `prehistoric` species."""
    from . import ranges
    from .globe import row_edges
    want = [sp for sp, d in dates.items() if d["basis"] == "prehistoric"]
    cells = ranges.read_cells(raw, want)
    edges = row_edges()
    out = {}
    for sp in want:
        place, boxes = PREHISTORIC[sp]
        lost = cells[sp]["nat"] - cells[sp]["cur"]
        pre = frozenset(c for c in lost if any(x0 <= lon <= x1 and y0 <= lat <= y1
                                               for lon, lat in [_cell_lonlat(c, edges)]
                                               for x0, x1, y0, y1 in boxes))
        out[sp] = {"place": place, "cells": pre, "lost": len(lost)}
    return out
