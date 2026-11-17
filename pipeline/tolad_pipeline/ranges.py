"""PHYLACINE 1.2.1 range maps: current and present-natural range areas.

Faurby et al. 2018 (Ecology 99:2626) ship one GeoTIFF per species and range
type under Data/Ranges/{Current,Present_natural}/<Genus_species>.tif: a
360 x 142 grid in the Behrmann cylindrical equal-area projection (cell
~96.5 km on a side), 1 = range, 0 = not. "Present natural" is where the
species would live today without human impact (Faurby & Svenning 2015,
Diversity Distrib. 21:1155), and it exists for the Late Quaternary extinct
species too. Equal-area cells make the area cells x cell area.

The release zip is read in place: only members under Data/Ranges/ ending in
.tif are opened, by name, and decoded with tifffile (LZW via imagecodecs).
"""

from __future__ import annotations

import csv
import io
import zipfile
from pathlib import Path

import numpy as np

ZIP_REL = "phylacine/PHYLACINE_1.2.1.zip"
PREFIX = "Data/Ranges/"
# PHYLACINE's own note on why each species' present-natural map differs from its current one
# (Spatial_metadata.csv: Modification, Motivation), read and classed by hand (ToLaD#507)
NOTES_PATH = Path(__file__).resolve().parents[1] / "phylacine_notes.csv"
NOTE_CLASSES = ("people", "taxonomy", "mapping", "placeholder", "unclear")
# the classes whose map difference is not people's doing: no change is drawn from it
NOT_PEOPLE = ("taxonomy", "mapping", "placeholder")
# the classes whose note moves land between species or deletes bad records: today's map is the corrected one
# where the note says only that (today_maps, ToLaD#507)
CORRECTED = ("taxonomy", "mapping")
# PHYLACINE's statuses for species extinct before 1500 or since (no today's map is worked out for them)
EXTINCT_STATUS = ("EX", "EP")
# PHYLACINE's note on a map it gave back the cells IUCN codes Extinct or Possibly Extinct (phylacine_note, verbatim)
EX_PE_NOTE = "coded Extinct or Possibly Extinct by IUCN"
KINDS = {"Current": "cur", "Present_natural": "nat"}
GRID_SHAPE = (142, 360)


def cell_km2_from_scale(scale: tuple[float, ...]) -> float:
    """ModelPixelScaleTag (metres per pixel x, y, z) -> km2 per cell."""
    return scale[0] * scale[1] / 1e6


def _read_tif(data: bytes) -> tuple[np.ndarray, float]:
    import logging

    import tifffile

    # float32 rasters carry a GDAL_NODATA of -3.4e38 that tifffile warns about; we never read it
    logging.getLogger("tifffile").setLevel(logging.ERROR)

    with tifffile.TiffFile(io.BytesIO(data)) as t:
        p = t.pages[0]
        a = p.asarray()
        scale = p.tags["ModelPixelScaleTag"].value
    return a, cell_km2_from_scale(scale)


def count_cells(a: np.ndarray) -> int:
    """Range cells in one raster: value 1 (0 = outside, nodata = huge negative)."""
    return int(np.count_nonzero(a > 0.5))


def load_ranges(raw: Path) -> dict[str, dict]:
    """Binomial ("Genus species") -> {cells_cur, cells_nat, km2_cur, km2_nat}."""
    out: dict[str, dict] = {}
    cell = None
    with zipfile.ZipFile(raw / ZIP_REL) as z:
        for info in z.infolist():
            nm = info.filename
            if not nm.startswith(PREFIX) or not nm.endswith(".tif"):
                continue
            parts = nm[len(PREFIX):].split("/")
            if len(parts) != 2 or parts[0] not in KINDS:
                continue
            a, c = _read_tif(z.read(info))
            if a.shape != GRID_SHAPE:
                raise ValueError(f"{nm}: grid {a.shape}, expected {GRID_SHAPE}")
            if cell is None:
                cell = c
            elif abs(c - cell) > 1e-6 * cell:
                raise ValueError(f"{nm}: cell area {c} km2 differs from {cell}")
            sp = parts[1][:-4].replace("_", " ")
            out.setdefault(sp, {})["cells_" + KINDS[parts[0]]] = count_cells(a)
    assert cell is not None, "no range rasters in the PHYLACINE zip"
    for r in out.values():
        r.setdefault("cells_cur", 0)
        r.setdefault("cells_nat", 0)
        r["km2_cur"] = r["cells_cur"] * cell
        r["km2_nat"] = r["cells_nat"] * cell
    return out


def load_spatial_metadata(raw: Path) -> dict[str, dict]:
    """PHYLACINE's own per-species cell counts (Data/Ranges/Spatial_metadata.csv),
    used to cross-check the raster sums."""
    out = {}
    with zipfile.ZipFile(raw / ZIP_REL) as z:
        nm = next(n for n in z.namelist() if n.endswith(PREFIX + "Spatial_metadata.csv"))
        text = z.read(nm).decode("utf-8-sig")
    for r in csv.DictReader(io.StringIO(text)):
        out[r["Binomial.1.2"].replace("_", " ")] = {
            "cells_cur": int(r["Number.Cells.Current.Range"]),
            "cells_nat": int(r["Number.Cells.Present.Natural.Range"]),
            "certainty": r["Certainty.Level"],
        }
    return out


def load_notes(path: Path = NOTES_PATH) -> dict[str, dict]:
    """Binomial ("Genus species") -> {class, why, phylacine_note, partner, cells_cur, cells_nat}: one row per
    PHYLACINE species whose current and present-natural cells differ (pipeline/phylacine_notes.csv,
    ToLaD#507). `class` is people / taxonomy / mapping / placeholder / unclear; `partner` the other species
    the note moves land to or from, as the note names it ("" for none)."""
    out = {}
    with path.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r["class"] not in NOTE_CLASSES:
                raise ValueError(f"{path.name}: {r['binomial']}: unknown class {r['class']!r}")
            out[r["binomial"]] = {**r, "cells_cur": int(r["cells_cur"]), "cells_nat": int(r["cells_nat"])}
    for k, r in out.items():
        if r["partner"] and r["partner"] not in out:
            raise ValueError(f"{path.name}: {k}: partner {r['partner']!r} has no row")
    return out


def read_cells(raw: Path, species) -> dict[str, dict[str, frozenset]]:
    """Binomial -> {"cur": cells, "nat": cells}: the (row, column) cells of each named species' two rasters."""
    want = {s.replace(" ", "_") for s in species}
    out: dict[str, dict[str, frozenset]] = {}
    with zipfile.ZipFile(raw / ZIP_REL) as z:
        for info in z.infolist():
            nm = info.filename
            if not nm.startswith(PREFIX) or not nm.endswith(".tif"):
                continue
            parts = nm[len(PREFIX):].split("/")
            if len(parts) != 2 or parts[0] not in KINDS or parts[1][:-4] not in want:
                continue
            a, _ = _read_tif(z.read(info))
            cells = frozenset((int(i), int(j)) for i, j in np.argwhere(a > 0.5))
            out.setdefault(parts[1][:-4].replace("_", " "), {})[KINDS[parts[0]]] = cells
    for r in out.values():
        r.setdefault("cur", frozenset())
        r.setdefault("nat", frozenset())
    return out


def _cells(k: int) -> str:
    return f"{k} cell" if k == 1 else f"{k} cells"


def subject_map(cls: str, cur: frozenset, nat: frozenset, partner: dict | None,
                partner_name: str = "") -> tuple[frozenset | None, str]:
    """Today's map for a species whose own note is a taxonomy change or a mapping fix (ToLaD#507): its
    present-natural map, where that map is its current map with land moved to or from the species the note
    names (`partner`: that species' {"cur", "nat"} cells), or with the records the note deletes taken off.
    Cell by cell: every cell it loses must be in the partner's present-natural map, every cell it gains in the
    partner's current map. Else None, and why: the note mixes in something else (PHYLACINE's own range
    expansion or historic range, people's doing), and the species is left as it is."""
    out, add = cur - nat, nat - cur
    if not out and not add:
        return None, "its two maps agree"
    if cls == "mapping":
        if add:
            return None, f"the note deletes records and adds {_cells(len(add))} too"
        return nat, f"the {_cells(len(out))} of the records the note deletes taken off"
    if partner is None:
        return None, ("the note moves no land to or from a species PHYLACINE maps (a merger or an undescribed "
                      f"relative): its {_cells(len(add) + len(out))} changed cannot be told from PHYLACINE's own "
                      "range expansion")
    stray_in, stray_out = add - partner["cur"], out - partner["nat"]
    if stray_in or stray_out:
        return None, (f"{len(stray_in) + len(stray_out)} of its {_cells(len(add) + len(out))} changed are not land "
                      f"moved to or from {partner_name}'s maps (PHYLACINE's own expansion or historic range)")
    return nat, ", ".join(x for x in (f"{_cells(len(out))} given to {partner_name} taken off" if out else "",
                                      f"{_cells(len(add))} taken from {partner_name}'s current map added" if add else "")
                          if x)


def partner_map(cur: frozenset, nat: frozenset, other_nat: frozenset,
                other_name: str = "") -> tuple[frozenset | None, str]:
    """Today's map for the species a taxonomy note takes land from (ToLaD#507): its current map minus the cells
    the note gives to the other species (those its own present-natural map drops and the other's holds).
    None, and why, when its current map holds none of them."""
    given = (cur - nat) & other_nat
    if not given:
        return None, ("it has no current map" if not cur else
                      f"its current map holds none of the land the note gives to {other_name}: its present-natural "
                      f"map keeps all {_cells(len(cur))}" if not cur - nat else
                      f"none of the {_cells(len(cur - nat))} its present-natural map drops is in {other_name}'s")
    return cur - given, f"the {_cells(len(given))} the note gives to {other_name} taken off"


def today_maps(raw: Path, notes: dict[str, dict] | None = None) -> dict[str, dict]:
    """Today's map, worked out cell by cell from the rasters (ToLaD#507), for every living species whose map
    difference PHYLACINE's note puts down to taxonomy or a mapping fix (`subject_map`) and for the species
    such a note names as the other side of the move (`partner_map`). Binomial -> {"cells": today's cells
    (None: left as it is), "cells_map": its PHYLACINE current cells, "role": "note" / "partner", "partner",
    "why"}."""
    notes = load_notes() if notes is None else notes
    subj = {k: r for k, r in notes.items() if r["class"] in CORRECTED and r["iucn"] not in EXTINCT_STATUS}
    cells = read_cells(raw, set(subj) | {r["partner"] for r in subj.values() if r["partner"]})
    out: dict[str, dict] = {}
    for sp, r in sorted(subj.items()):
        p = r["partner"]
        m, why = subject_map(r["class"], cells[sp]["cur"], cells[sp]["nat"], cells[p] if p else None, p)
        out[sp] = {"cells": None if m is None else len(m), "cells_map": len(cells[sp]["cur"]), "role": "note",
                   "partner": p, "why": why}
    for sp, r in sorted(subj.items()):
        p = r["partner"]
        if not p or p in out:
            continue
        m, why = partner_map(cells[p]["cur"], cells[p]["nat"], cells[sp]["nat"], sp)
        out[p] = {"cells": None if m is None else len(m), "cells_map": len(cells[p]["cur"]), "role": "partner",
                  "partner": sp, "why": why}
    return out
