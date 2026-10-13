"""Every species' range cells for the card's globe (ToLaD#267): `data/mammals/ranges.json`.

Its own step over the built data, like `make wiki` (`make globe`): reads the species rows of the
dated tree (wiki.species_rows), matches each to a PHYLACINE 1.2.1 range raster (ranges.py) by its
name, then PHYLACINE's synonymy table, then its Open Tree synonyms (the order model.resolve_traits
uses), and writes the matched species' current and present-natural cells. Nothing else under
data/mammals is touched.

The grid is PHYLACINE's: 360 x 142 cells, Behrmann cylindrical equal-area (standard parallels
30 deg), row 0 at the north. Columns are 1 deg of longitude from -180; a row's edges are at
latitude asin(y / Y_POLE) (the sphere's equal-area formula on the ellipsoid's y, so authalic
latitude: within 0.13 deg of geodetic, ~1/7 of a cell). The file carries those edges (`lat`).

Packing, per species and kind: the raster's range cells as flat indices (row * 360 + col),
run-length coded as [gap, length, gap, length, ...], each gap counted from the end of the run
before (from 0 for the first). `ranges[name] = [current, present_natural]`; an empty list is no
cells (an extinct species has only its present-natural range).
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np

from . import ranges
from .load import load_phylacine
from .wiki import species_rows, synonyms

ROWS, COLS = ranges.GRID_SHAPE
# The grid's geotransform (ModelTiepointTag / ModelPixelScaleTag, identical in every raster).
Y_TOP = 7348382.0
CELL_Y = 96514.95774647887
CELL_X = 96486.27222222222
X_LEFT = -17367529.0
# y at the pole: the grid's top edge (the rasters start at the pole).
Y_POLE = Y_TOP


def pack(mask: np.ndarray) -> list[int]:
    """A boolean raster (ROWS x COLS) -> run-length cells [gap, len, gap, len, ...] over flat indices."""
    flat = np.asarray(mask, dtype=bool).ravel()
    if not flat.any():
        return []
    d = np.diff(np.concatenate(([0], flat.astype(np.int8), [0])))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    out: list[int] = []
    prev = 0
    for s, e in zip(starts.tolist(), ends.tolist()):
        out += [s - prev, e - s]
        prev = e
    return out


def unpack(runs: list[int], n: int = ROWS * COLS) -> np.ndarray:
    """The inverse of pack: a boolean raster (ROWS x COLS)."""
    flat = np.zeros(n, dtype=bool)
    i = 0
    for k in range(0, len(runs), 2):
        i += runs[k]
        flat[i:i + runs[k + 1]] = True
        i += runs[k + 1]
    return flat.reshape(ROWS, COLS)


def row_edges() -> list[float]:
    """Latitude of each row's edges, north to south (ROWS + 1 values, degrees, 3 decimals)."""
    out = []
    for r in range(ROWS + 1):
        y = Y_TOP - r * CELL_Y
        out.append(round(math.degrees(math.asin(max(-1.0, min(1.0, y / Y_POLE)))), 3))
    return out


def load_masks(raw: Path) -> dict[str, dict[str, np.ndarray]]:
    """PHYLACINE binomial -> {"cur"|"nat": boolean raster}."""
    out: dict[str, dict[str, np.ndarray]] = {}
    with zipfile.ZipFile(raw / ranges.ZIP_REL) as z:
        for info in z.infolist():
            nm = info.filename
            if not nm.startswith(ranges.PREFIX) or not nm.endswith(".tif"):
                continue
            parts = nm[len(ranges.PREFIX):].split("/")
            if len(parts) != 2 or parts[0] not in ranges.KINDS:
                continue
            a, _ = ranges._read_tif(z.read(info))
            if a.shape != ranges.GRID_SHAPE:
                raise ValueError(f"{nm}: grid {a.shape}, expected {ranges.GRID_SHAPE}")
            sp = parts[1][:-4].replace("_", " ")
            out.setdefault(sp, {})[ranges.KINDS[parts[0]]] = a > 0.5
    return out


def match(names: dict[str, int], have: set[str], phy_syn: dict[str, str], ott_syn: dict[int, list[str]]) -> dict[str, str]:
    """Our species name -> the PHYLACINE binomial whose maps it gets (name, PHYLACINE synonym, OTT synonym)."""
    out: dict[str, str] = {}
    for name, ott in names.items():
        cands = [name] + ott_syn.get(ott, [])
        for c in cands:
            hit = c if c in have else phy_syn.get(c) if phy_syn.get(c) in have else None
            if hit:
                out[name] = hit
                break
    return out


def build(raw: Path, mammals: Path) -> tuple[dict, dict]:
    species = species_rows(mammals)
    masks = load_masks(raw)
    _, phy_syn = load_phylacine(raw)
    ott_syn = synonyms({u for u in species.values() if u}, raw)
    m = match(species, set(masks), phy_syn, ott_syn)
    empty = np.zeros(ranges.GRID_SHAPE, dtype=bool)
    out = {
        "grid": {"rows": ROWS, "cols": COLS, "lon0": -180, "lat": row_edges()},
        "ranges": {n: [pack(masks[p].get("cur", empty)), pack(masks[p].get("nat", empty))] for n, p in sorted(m.items())},
    }
    stats = {"species": len(species), "matched": len(m), "maps": len(masks),
             "maps_shared": len(m) - len(set(m.values()))}
    return out, stats


def write(out: dict, path: Path) -> int:
    text = json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n"
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, default=root / "data" / "raw")
    ap.add_argument("--mammals", type=Path, default=root / "data" / "mammals")
    a = ap.parse_args(argv)
    out, stats = build(a.raw, a.mammals)
    n = write(out, a.mammals / "ranges.json")
    import gzip

    gz = len(gzip.compress((a.mammals / "ranges.json").read_bytes(), 9))
    print(f"[globe] {stats['matched']}/{stats['species']} species matched to {stats['maps']} PHYLACINE maps "
          f"({stats['maps_shared']} shared); ranges.json {n / 1e6:.2f} MB, gzip {gz / 1e6:.2f} MB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
