"""Fetch a few HYDE 3.2.1 time slices and sum them onto PHYLACINE's grid (ToLaD#515).

HYDE 3.2.1 (Klein Goldewijk et al. 2017, ESSD 9:927; DANS doi:10.17026/dans-25g-gez3, CC0) is one
5.3 GB zip of 5-arc-minute ESRI ASCII grids. Only the members named here are read, over HTTP range
requests (httpzip.py): about 4 variables x 27 slices, ~350 MB compressed, a few minutes.

Matching the grids: each HYDE cell (5', km2 values) is assigned whole to the PHYLACINE cell
(Behrmann on WGS84, 96.5 km, 360 x 142) that contains the HYDE cell's centre, and its km2 are summed.
A PHYLACINE cell holds about 130 HYDE cells at the equator, so the assignment error is under 1%.
HYDE cells south of the PHYLACINE grid's edge (~60 S, Antarctica) are dropped.

Output: hyde_on_phylacine.npz with, per slice, the km2 of cropland, pasture, converted rangeland,
all rangeland and urban area in every PHYLACINE cell, plus the max land km2 and the main country.
"""
import io
import sys
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from httpzip import open_zip  # noqa: E402

BASE = "https://archaeology.datastations.nl/api/access/datafile/5490328"  # HYDE3_2_1-baseline.zip
SUPP = "https://archaeology.datastations.nl/api/access/datafile/5490327"  # general_supplementary.zip
SLICES = ["10000BC", "6000BC", "4000BC", "3000BC", "2000BC", "1000BC", "0AD", "500AD", "1000AD", "1200AD",
          "1400AD", "1500AD", "1600AD", "1700AD", "1750AD", "1800AD", "1830AD", "1850AD", "1870AD", "1890AD",
          "1900AD", "1920AD", "1950AD", "1970AD", "1990AD", "2000AD", "2017AD"]
LU = ["cropland", "pasture", "conv_rangeland", "rangeland"]

# PHYLACINE 1.2.1 grid (ModelTiepoint / ModelPixelScale of every range GeoTIFF)
X0, Y0, DX, DY, NR, NC = -17367529.0, 7348382.0, 96486.27222222222, 96514.95774647887, 142, 360
A, F = 6378137.0, 1 / 298.257223563
E2 = F * (2 - F)
E = np.sqrt(E2)
K0 = np.cos(np.radians(30)) / np.sqrt(1 - E2 * np.sin(np.radians(30)) ** 2)


def behrmann(lon, lat):
    """Ellipsoidal cylindrical equal-area, standard parallel 30 (PHYLACINE's projection)."""
    s = np.sin(np.radians(lat))
    q = (1 - E2) * (s / (1 - E2 * s * s) - 1 / (2 * E) * np.log((1 - E * s) / (1 + E * s)))
    return A * K0 * np.radians(lon), A * q / (2 * K0)


def phy_index():
    """Flat PHYLACINE cell index (row*360+col) of every 5' HYDE cell centre; -1 outside the grid."""
    lat = 90 - (np.arange(2160) + 0.5) / 12
    lon = -180 + (np.arange(4320) + 0.5) / 12
    x, _ = behrmann(lon, np.zeros_like(lon))
    _, y = behrmann(np.zeros_like(lat), lat)
    col = np.floor((x - X0) / DX).astype(int).clip(0, NC - 1)
    row = np.floor((Y0 - y) / DY).astype(int)
    idx = row[:, None] * NC + col[None, :]
    idx[(row < 0) | (row >= NR), :] = -1
    return idx.ravel()


def read_asc(z, name):
    raw = z.read(name)
    lines = raw.split(b"\n", 6)
    hdr = {ln.split()[0].decode().lower(): float(ln.split()[1]) for ln in lines[:6]}
    a = np.fromstring(lines[6], dtype=np.float32, sep=" ")  # noqa: NPY201 (fast whitespace parse)
    assert a.size == 4320 * 2160 and hdr["ncols"] == 4320, (name, a.size, hdr)
    a[a == hdr.get("nodata_value", -9999)] = 0
    return a


def to_phy(a, idx):
    ok = idx >= 0
    return np.bincount(idx[ok], weights=a[ok].astype(np.float64), minlength=NR * NC).astype(np.float32)


def main(out):
    import zipfile_deflate64  # noqa: F401  (HYDE's baseline zip is Deflate64; run with `uv run --with zipfile-deflate64`)

    idx = phy_index()
    res = {}
    zs = open_zip(SUPP)
    maxln = read_asc(zs, "general_files/maxln_cr.asc")
    res["maxln"] = to_phy(maxln, idx)
    iso = read_asc(zs, "general_files/iso_cr.asc").astype(np.int32)
    # main country of each PHYLACINE cell, by land km2
    ok = (idx >= 0) & (iso > 0)
    key = idx[ok].astype(np.int64) * 1000 + iso[ok]
    k, inv = np.unique(key, return_inverse=True)
    w = np.bincount(inv, weights=maxln[ok])
    cell, code = k // 1000, k % 1000
    order = np.lexsort((-w, cell))
    main_iso = np.zeros(NR * NC, np.int32)
    seen = set()
    for i in order:
        if cell[i] not in seen:
            seen.add(cell[i])
            main_iso[cell[i]] = code[i]
    res["iso"] = main_iso
    np.savez_compressed(out, **res)
    z = open_zip(BASE)
    for s in SLICES:
        for v in LU:
            res[f"{v}_{s}"] = to_phy(read_asc(z, f"baseline/asc/{s}_lu/{v}{s}.asc"), idx)
        res[f"uopp_{s}"] = to_phy(read_asc(z, f"baseline/asc/{s}_pop/uopp_{s}.asc"), idx)
        print(s, flush=True)
        np.savez_compressed(out, slices=np.array(SLICES), **res)


if __name__ == "__main__":
    main(sys.argv[1])
