"""The lost cells of the 682 species the tree draws falling since 1500 (ToLaD#515).

The 682: living (IUCN LC/NT/VU/EN/CR/DD), classed `people` in pipeline/phylacine_notes.csv, and with
more PHYLACINE present-natural cells than current cells. Lost cells = present-natural minus current.

Writes lost_cells.json: per species, the order/family, IUCN category, PHYLACINE's full note
(Certainty.Level, Modification, Motivation from Data/Ranges/Spatial_metadata.csv), and the flat
indices (row*360+col) of its current and lost cells, plus the lon/lat of every grid cell centre.
Run from pipeline/: `uv run python ../research/range-loss-dates/lost_cells.py OUT.json`.
"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import tifffile

sys.path.insert(0, str(Path(__file__).parent))
from hyde_fetch import NC, NR, X0, Y0, DX, DY, behrmann  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ZIP = ROOT / "data/raw/phylacine/PHYLACINE_1.2.1.zip"
NOTES = ROOT / "pipeline/phylacine_notes.csv"
LIVING = ("LC", "NT", "VU", "EN", "CR", "DD")


def cell_lonlat():
    xs = X0 + (np.arange(NC) + 0.5) * DX
    ys = Y0 - (np.arange(NR) + 0.5) * DY
    lat_t = np.linspace(-90, 90, 180001)
    _, y_t = behrmann(np.zeros_like(lat_t), lat_t)
    lats = np.interp(ys, y_t, lat_t)
    lon_scale = behrmann(1.0, 0.0)[0]  # metres per degree of longitude
    lons = xs / lon_scale
    return lons, lats


def main(out):
    notes = {r["binomial"]: r for r in csv.DictReader(open(NOTES))}
    sel = sorted(b for b, r in notes.items() if r["class"] == "people" and r["iucn"] in LIVING
                 and int(r["cells_nat"]) > int(r["cells_cur"]))
    z = zipfile.ZipFile(ZIP)
    meta = {r["Binomial.1.2"].replace("_", " "): r
            for r in csv.DictReader(io.TextIOWrapper(z.open("Data/Ranges/Spatial_metadata.csv"), "utf-8"))}

    def grid(kind, b):
        with tifffile.TiffFile(io.BytesIO(z.read(f"Data/Ranges/{kind}/{b.replace(' ', '_')}.tif"))) as t:
            return (t.pages[0].asarray() > 0.5).ravel()

    res = {}
    for b in sel:
        cur, nat = grid("Current", b), grid("Present_natural", b)
        m = meta[b]
        res[b] = {"order": m["Order.1.2"], "family": m["Family.1.2"], "iucn": notes[b]["iucn"],
                  "certainty": m["Certainty.Level"], "modification": m["Modification"],
                  "motivation": m["Motivation"], "cur": np.flatnonzero(cur).tolist(),
                  "lost": np.flatnonzero(nat & ~cur).tolist()}
    lons, lats = cell_lonlat()
    json.dump({"lons": lons.round(3).tolist(), "lats": lats.round(3).tolist(), "species": res}, open(out, "w"))
    print(len(res), "species")


if __name__ == "__main__":
    main(sys.argv[1])
