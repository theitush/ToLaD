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


class PhylacineNotes(unittest.TestCase):
    """ToLaD#507: a map difference PHYLACINE's own note does not put down to people draws no change."""

    def _nat(self, cur, nat, cls, n_today=1e4, extinct=False):
        D = _leaf(cur, nat)
        D["phy_range"]["note_class"] = cls
        return M.natural_level(D, n_today, 0.25, extinct, FIT)

    def test_taxonomy_and_placeholder_get_todays_count_people_keep_the_trend(self):
        # Aotus zonalis: its Colombian cells given to A. jorgehernandezi (taxonomy) -> flat
        for cls in ("taxonomy", "mapping"):
            nat = self._nat(42, 20, cls)
            self.assertEqual(nat["N"], 1e4)
            self.assertFalse(nat["scaled"])  # model.py draws a range-loss trend only from a scaled level
            self.assertEqual(nat["method"], M.NATURAL_METHOD_NOTE.format(cls=cls))
            self.assertEqual(nat["sd_extra"], 0.0)
        # Gerbillus agag: no current map, a town as its "natural range" -> today's count, no fitted level
        nat = self._nat(0, 1, "placeholder")
        self.assertEqual((nat["N"], nat["scaled"]), (1e4, False))
        self.assertIsNone(self._nat(0, 1, "placeholder", n_today=0.0))
        # the coyote: spread by people -> the trend stays
        for cls in ("people", "unclear", ""):
            nat = self._nat(2113, 301, cls)
            self.assertTrue(nat["scaled"])
            self.assertAlmostEqual(nat["N"], 1e4 * 301 / 2113)
        # extinct species are not changed by their note
        self.assertEqual(self._nat(0, 300, "placeholder", n_today=0.0, extinct=True)["method"],
                         M.NATURAL_METHOD_FIT)

    def test_notes_file_covers_every_map_difference(self):
        if not (RAW / R.ZIP_REL).exists():
            self.skipTest("no PHYLACINE download")
        meta = R.load_spatial_metadata(RAW)
        notes = R.load_notes()
        diff = {k for k, v in meta.items() if v["cells_cur"] != v["cells_nat"]}
        self.assertEqual(set(notes), diff)
        bad = [k for k, r in notes.items() if (r["cells_cur"], r["cells_nat"])
               != (meta[k]["cells_cur"], meta[k]["cells_nat"])]
        self.assertEqual(bad, [])
        self.assertTrue(all(r["phylacine_note"] and r["why"] for r in notes.values()))
        self.assertEqual(notes["Aotus zonalis"]["class"], "taxonomy")
        self.assertEqual(notes["Canis latrans"]["class"], "people")


def _cells(*xs):
    return frozenset((0, x) for x in xs)


class TodayMaps(unittest.TestCase):
    """ToLaD#507: today's map where PHYLACINE's note moves land between species or deletes bad records."""

    def test_swapped_pair_takes_the_corrected_cells(self):
        # the night monkeys: A's current map holds 2..5, which the note gives to B (B's natural map); B's current
        # map is cell 6 only
        a = {"cur": _cells(0, 1, 2, 3, 4, 5), "nat": _cells(0, 1)}
        b = {"cur": _cells(6), "nat": _cells(2, 3, 4, 5, 6)}
        got_a, _ = R.subject_map("taxonomy", a["cur"], a["nat"], b, "B")
        got_b, why_b = R.subject_map("taxonomy", b["cur"], b["nat"], a, "A")
        self.assertEqual(got_a, _cells(0, 1))
        self.assertEqual(got_b, _cells(2, 3, 4, 5, 6))
        self.assertIn("4 cells taken from A's current map", why_b)
        # as the partner of a note: its current map minus the cells given away (same answer)
        self.assertEqual(R.partner_map(a["cur"], a["nat"], b["nat"], "B")[0], _cells(0, 1))

    def test_mixed_note_is_left_as_it_is(self):
        # B's natural map also adds cell 9, in no current map: PHYLACINE's own historic range, not moved land
        a = {"cur": _cells(0, 1, 2), "nat": _cells(0, 1, 2)}
        got, why = R.subject_map("taxonomy", _cells(6), _cells(2, 6, 9), a, "A")
        self.assertIsNone(got)
        self.assertIn("1 of its 2 cells changed", why)
        # A keeps every current cell in its own natural map: nothing to take off it
        self.assertIsNone(R.partner_map(a["cur"], a["nat"], _cells(2, 6, 9), "B")[0])
        # a merger with no mapped partner, and a mapping fix that adds cells: left too
        self.assertIsNone(R.subject_map("taxonomy", _cells(0), _cells(0, 1), None)[0])
        self.assertIsNone(R.subject_map("mapping", _cells(0, 1), _cells(0, 2), None)[0])

    def test_deleted_records_come_off(self):
        got, why = R.subject_map("mapping", _cells(0, 1, 2, 3), _cells(0, 1), None)
        self.assertEqual(got, _cells(0, 1))
        self.assertIn("2 cells of the records the note deletes", why)

    @unittest.skipUnless((RAW / R.ZIP_REL).exists(), "no PHYLACINE zip in data/raw")
    def test_phylacine_pairs(self):
        t = R.today_maps(RAW)
        cells = {k: (v["cells_map"], v["cells"]) for k, v in t.items()}
        self.assertEqual(cells["Aotus zonalis"], (42, 20))  # the Colombian part given to A. jorgehernandezi
        self.assertEqual(cells["Aotus jorgehernandezi"], (1, 25))
        self.assertEqual(cells["Tupaia palawanensis"], (12, 9))
        self.assertEqual(cells["Tupaia moellendorffi"], (0, 3))
        self.assertEqual(cells["Eudorcas rufifrons"], (326, 304))
        self.assertEqual(cells["Mormopterus acetabulosus"], (4, 2))  # rare migrants' records deleted
        # mixed notes and partners whose current map holds none of the moved land: unchanged
        for sp in ("Rhinopithecus strykeri", "Rhinopithecus bieti", "Lepilemur hollandorum", "Lepilemur seali",
                   "Eupleres major", "Eupleres goudotii", "Cheirogaleus medius", "Eudorcas rufina"):
            self.assertIsNone(cells[sp][1], sp)


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

    def test_phylacine_notes_flat_people_rise(self):
        # ToLaD#507: the night monkeys, the stray-migrant bat and the tree shrews are flat from 1500; the
        # placeholder species are unknown, with no natural level; the coyote, the house mouse and the rats still rise
        flat = {r["leaf"] for r in self.st["natural_baseline"]["phylacine_note_today"]}
        for sp in ("Aotus zonalis", "Aotus jorgehernandezi", "Mormopterus acetabulosus", "Tupaia palawanensis",
                   "Tupaia moellendorffi"):
            self.assertIn(sp, flat)
        unknown = {r["leaf"] for r in self.st["count_unknown"]["list"]}
        self.assertTrue({"Gerbillus agag", "Makalata obscura"} <= unknown)
        self.assertFalse(unknown & flat)
        rises = {r["leaf"] for r in self.st["rangeloss"]["rises_list"]}
        self.assertFalse(rises & (flat | unknown))
        self.assertTrue({"Canis latrans", "Mus musculus", "Rattus norvegicus", "Rattus rattus"} <= rises)

    def test_swapped_pair_counts_on_the_corrected_map(self):
        # ToLaD#507: today's count of the night monkeys stands on PHYLACINE's corrected cells, ours alone
        rows = {r["leaf"]: r for r in self.st["natural_baseline"]["phylacine_note_today"]}
        self.assertEqual(rows["Aotus zonalis"]["cells_cur"], 20)
        self.assertEqual(rows["Aotus jorgehernandezi"]["cells_cur"], 25)
        tm = self.st["phylacine_ranges"]["today_maps"]
        self.assertEqual((tm["Aotus zonalis"]["cells_map"], tm["Aotus zonalis"]["cells"]), (42, 20))
        self.assertEqual(set(self.st["census_anchors"]["species_model_on_old_map"]),
                         {"Aotus zonalis", "Aotus jorgehernandezi"})

    def test_extinct_have_no_current_area(self):
        for r in self.st["natural_baseline"]["showcase"]:
            if r["extinct"]:
                self.assertEqual(r["today"], 0.0)
                self.assertGreater(r["natural"], 0)


if __name__ == "__main__":
    unittest.main()
