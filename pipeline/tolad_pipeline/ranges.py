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
