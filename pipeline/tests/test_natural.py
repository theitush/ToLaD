"""Tests for the natural (pre-human) baseline: PHYLACINE range areas
(tolad_pipeline/ranges.py) and model.natural_level (ToLaD#61).

    cd pipeline && uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

import numpy as np

from tolad_pipeline import model as M
from tolad_pipeline import ranges as R

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data" / "mammals"
# PHYLACINE's Behrmann grid: ModelPixelScaleTag of every range raster
SCALE = (96486.27222222222, 96514.95774647887, 0.0)
CELL_KM2 = SCALE[0] * SCALE[1] / 1e6


class Areas(unittest.TestCase):
    def test_cell_area(self):
        self.assertAlmostEqual(R.cell_km2_from_scale(SCALE), 9312.4, delta=0.1)
        # 142 x 360 equal-area cells: the Earth's surface (5.1e8 km2) from 90 N down to ~60 S
        # (the grid stops short of Antarctica), ~93% of it
        self.assertAlmostEqual(142 * 360 * CELL_KM2 / 5.1e8, 0.933, delta=0.01)

    def test_count_cells_ignores_nodata_and_zero(self):
        a = np.zeros(R.GRID_SHAPE)
        a[0, :5] = 1.0
        a[1, 0] = -1.7e308  # GDAL nodata
        a[2, 0] = -3.4e38
        self.assertEqual(R.count_cells(a), 5)

    @unittest.skipUnless((RAW / R.ZIP_REL).exists(), "no PHYLACINE zip in data/raw")
    def test_raster_sums_match_phylacine_metadata(self):
        got = R.load_ranges(RAW)
        meta = R.load_spatial_metadata(RAW)
        self.assertEqual(len(got), 5831)
        self.assertEqual(set(got), set(meta))
        bad = [k for k in got if (got[k]["cells_cur"], got[k]["cells_nat"])
               != (meta[k]["cells_cur"], meta[k]["cells_nat"])]
        self.assertEqual(bad, [])
        lion = got["Panthera leo"]
        self.assertEqual((lion["cells_cur"], lion["cells_nat"]), (496, 3166))
        self.assertAlmostEqual(lion["km2_nat"], 3166 * CELL_KM2, delta=1.0)
        # Late Quaternary extinct species: present-natural range, no current range
        mam = got["Mammuthus primigenius"]
        self.assertEqual(mam["cells_cur"], 0)
        self.assertGreater(mam["cells_nat"], 1000)
        # the natural range of a species with no recorded change is its current range
        # (certainty level 0; 80 of them differ by a few cells, e.g. IUCN "extinct" polygons)
        lvl0 = [k for k in got if meta[k]["certainty"].startswith("0)")]
        self.assertGreater(len(lvl0), 4500)
        same = sum(1 for k in lvl0 if got[k]["cells_cur"] == got[k]["cells_nat"])
        self.assertGreater(same / len(lvl0), 0.95)


FIT = {"a": -2.3, "b": 1.33, "sd": 0.58}


def _leaf(cur, nat, ld=1.0, lk=-0.5, sd_density=0.5, k_sd=0.6):
    return {"phy_range": {"name": "Testus exemplaris", "cells_cur": cur, "cells_nat": nat,
                          "km2_cur": cur * CELL_KM2, "km2_nat": nat * CELL_KM2, "certainty": ""},
            "log_density": ld, "log_k": lk, "sd_density": sd_density, "k_sd": k_sd}


class NaturalLevel(unittest.TestCase):
    def test_no_map(self):
        self.assertIsNone(M.natural_level({}, 1e4, 0.25, False, FIT))
        self.assertIsNone(M.natural_level(_leaf(10, 0), 1e4, 0.25, False, FIT))

    def test_same_range_is_todays_count(self):
        nat = M.natural_level(_leaf(100, 100), 1e4, 0.25, False, FIT)
        self.assertEqual(nat["N"], 1e4)
        self.assertAlmostEqual(nat["sd"], 0.25)
        self.assertEqual((nat["grade"], nat["kind"]), ("D", "reconstruction"))
        self.assertTrue(nat["scaled"])

    def test_scaled_by_range_ratio(self):
        nat = M.natural_level(_leaf(100, 600), 1e4, 0.25, False, FIT)
        self.assertAlmostEqual(nat["N"], 6e4)
        self.assertAlmostEqual(nat["sd"], math.hypot(0.25, M.SD_NAT_RANGE))
        h = 1.96 * nat["sd"]
        self.assertAlmostEqual(math.log10(nat["hi"] / nat["N"]), h)
        self.assertAlmostEqual(math.log10(nat["N"] / nat["lo"]), h)
        self.assertEqual(nat["method"], M.NATURAL_METHOD_SCALED)

    def test_extinct_uses_density_area_occupancy(self):
        D = _leaf(0, 300)
        nat = M.natural_level(D, 0.0, 0.0, True, FIT)
        la = FIT["a"] + FIT["b"] * math.log10(300 * CELL_KM2)
        self.assertAlmostEqual(math.log10(nat["N"]), D["log_density"] + la + D["log_k"])
        self.assertAlmostEqual(nat["sd"], math.sqrt(0.5 ** 2 + FIT["sd"] ** 2 + 0.6 ** 2))
        self.assertEqual(nat["method"], M.NATURAL_METHOD_FIT)
        # an extinct species with a leftover current map still uses the density route
        self.assertEqual(M.natural_level(_leaf(5, 300), 1e3, 0.25, True, FIT)["method"], M.NATURAL_METHOD_FIT)


def _stats():
    p = DATA / "stats.json"
    return json.loads(p.read_text()) if p.exists() else None


class Build(unittest.TestCase):
    def setUp(self):
        self.st = _stats()
        if self.st is None or "natural_baseline" not in self.st:
            self.skipTest("no build output with a natural baseline")

    def test_coverage(self):
        nb = self.st["natural_baseline"]
        self.assertGreater(nb["extant"], 5000)
        self.assertGreater(nb["extinct"], 150)
        self.assertGreater(self.st["phylacine_ranges"]["maps_used"], 5400)

    def test_panthera(self):
        rows = {r["leaf"]: r for r in self.st["natural_baseline"]["showcase"]}
        for sp in ("Panthera leo", "Panthera tigris", "Panthera pardus", "Panthera onca", "Panthera uncia"):
            r = rows[sp]
            self.assertAlmostEqual(r["natural"] / r["today"], r["area_ratio"], delta=1e-6 * r["area_ratio"])
            self.assertLessEqual(r["lo"], r["natural"])
            self.assertGreaterEqual(r["hi"], r["natural"])
        self.assertGreater(rows["Panthera leo"]["area_ratio"], 3)  # lions lost most of their range
        self.assertEqual(rows["Panthera uncia"]["area_ratio"], 1.0)

    def test_extinct_have_no_current_area(self):
        for r in self.st["natural_baseline"]["showcase"]:
            if r["extinct"]:
                self.assertEqual(r["today"], 0.0)
                self.assertGreater(r["natural"], 0)


if __name__ == "__main__":
    unittest.main()
