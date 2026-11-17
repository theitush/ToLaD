"""Tests for today's counts of near-extinct species (ToLaD#68, #72) and the PHYLACINE
current-range area for species without a PanTHERIA range (ToLaD#67).

    cd pipeline && uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from tolad_pipeline import history as H
from tolad_pipeline import model as M
from tolad_pipeline import tiles as T
from tolad_pipeline.tree import Node

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "mammals"
FIT = {"a": -2.29, "b": 1.33, "sd": 0.58}
CELL_KM2 = 9312.37


class PhylacineArea(unittest.TestCase):
    def test_small_ranges_shrink_onto_pantheria_scale(self):
        km2 = 3 * CELL_KM2  # the ferret's three cells
        got = M.phylacine_area(km2, FIT)
        self.assertAlmostEqual(got, FIT["a"] + FIT["b"] * math.log10(km2))
        self.assertLess(got, math.log10(km2) - 0.5)

    def test_never_above_the_map(self):
        for km2 in (1e7, 5e7, 3.4e8):
            self.assertEqual(M.phylacine_area(km2, FIT), math.log10(km2))


def _node(iucn, cur, nat=10, extinct=False, mapped=True):
    n = Node(name="Testus exemplaris")
    n.extinct = extinct
    n.data["iucn"] = iucn
    if mapped:
        n.data["phy_range"] = {"cells_cur": cur, "cells_nat": nat}
    return n


class NearExtinct(unittest.TestCase):
    def test_rule(self):
        self.assertTrue(M.near_extinct(_node("CR", 0)))
        self.assertTrue(M.near_extinct(_node("EW", 0)))
        self.assertFalse(M.near_extinct(_node("CR", 1)))  # a mapped current range: modelled as usual
        self.assertFalse(M.near_extinct(_node("EN", 0)))  # unmapped but not CR/EW: flagged only
        self.assertFalse(M.near_extinct(_node("DD", 0)))
        self.assertFalse(M.near_extinct(_node("CR", 0, extinct=True)))
        self.assertFalse(M.near_extinct(_node("CR", 0, mapped=False)))  # no map at all: nothing to read

    def test_cap_is_cr_criterion_d(self):
        self.assertEqual(M.NEAR_EXTINCT_CAP, 50.0)
        self.assertIn("criterion D", M.NEAR_EXTINCT_METHOD)


def _leaf(name, red_list, cur, alive, mapped=True):
    n = Node(name=name, t0=1.0, t1=0.0)
    n.data.update({"red_list": {"category": red_list}, "alive": alive, "L": 2.0, "meth": ["M:phylacine", "N:x"],
                   "src": {M.SRC["greenspoon-data"], M.SRC["phylacine"]}, "grade_cap": 2, "grade": 3})
    if mapped:
        n.data["phy_range"] = {"cells_cur": cur, "cells_nat": 3, "note_class": "placeholder"}
    return n


class CountUnknown(unittest.TestCase):
    """ToLaD#507: a living species with no current map, Data Deficient, and counted by nobody."""

    def test_rule(self):
        dd = _leaf("Gerbillus agag", "DD", 0, 3e6)
        self.assertTrue(M.count_unknown(dd, {}, set()))
        # a census species with no map is not flagged; nor is one a history file counts
        self.assertFalse(M.count_unknown(dd, {id(dd): 500.0}, set()))
        self.assertFalse(M.count_unknown(dd, {}, {"Gerbillus agag"}))
        self.assertFalse(M.count_unknown(_leaf("A b", "LC", 0, 1e5), {}, set()))  # not Data Deficient
        self.assertFalse(M.count_unknown(_leaf("A c", "DD", 4, 1e5), {}, set()))  # a current map
        self.assertFalse(M.count_unknown(_leaf("A d", "DD", 0, 1e5, mapped=False), {}, set()))  # not in PHYLACINE

    def test_drawn_at_the_thinnest(self):
        root = Node("Mammalia", t0=2.0)
        unknown, thin, big = _leaf("U u", "DD", 0, 3e6), _leaf("T t", "VU", 2, 11.0), _leaf("B b", "LC", 9, 1e7)
        unknown.data["natural"] = {"N": 9e6}
        for n in (unknown, thin, big):
            root.add(n)
        rep = M.mark_unknown(root, {id(unknown)})
        D = unknown.data
        self.assertEqual((D["alive"], D["count_unknown"]["thinnest"]), (11.0, "T t"))
        self.assertEqual(D["pieces"], [(1.0, 0.0, 11.0 / 2.0)])  # the whole band at the thinnest
        self.assertNotIn("natural", D)
        self.assertEqual(D["meth"][0], "M:phylacine")
        self.assertTrue(D["meth"][-1].startswith("N:unknown"))
        self.assertNotIn(M.SRC["greenspoon-data"], D["src"])
        self.assertEqual((rep["thinnest"], rep["was_total"]), ({"leaf": "T t", "N": 11.0}, 3e6))
        self.assertEqual(big.data["alive"], 1e7)
        # FLAG bit 11 on its row
        self.assertTrue(T.node_flags(unknown, False) & T.F_COUNT_UNKNOWN)
        self.assertFalse(T.node_flags(thin, False) & T.F_COUNT_UNKNOWN)


# cited today's counts added for ToLaD#68/#72 (pipeline/history/), wild only
CITED = {"Mustela nigripes": 496, "Equus ferus": 1360, "Elaphurus davidianus": 2420, "Canis rufus": 37,
         "Oryx dammah": 650}


class Files(unittest.TestCase):
    def test_cited_files(self):
        recs = {r["species"]: r for r in H.load_all()}
        for sp, n in CITED.items():
            r = recs[sp]
            self.assertEqual((r["component"], r["use"]), ("wild", "counts"))
            last = max(r["points"], key=lambda p: p["year"])
            self.assertEqual(last["n"], n)
            self.assertGreaterEqual(last["year"], H.ALIVE_MIN_YEAR)  # replaces the model's alive-now
            self.assertIn(last["grade"], "ABC")
            self.assertTrue(last["url"].startswith("https://"))


def _stats():
    p = DATA / "stats.json"
    return json.loads(p.read_text()) if p.exists() else None


class Build(unittest.TestCase):
    def setUp(self):
        self.st = _stats()
        if self.st is None or "count_flags" not in self.st:
            self.skipTest("no build output with count_flags")

    def test_no_mapped_species_on_a_clade_mean(self):
        used = self.st["count_flags"]["area_method_with_current_map"]
        self.assertEqual([k for k in used if k.endswith(" mean")], [])
        self.assertGreater(used[M.METHOD_A_PHYLACINE], 100)

    def test_cited_today(self):
        hist = self.st["history"]["species"]
        for sp, n in CITED.items():
            self.assertAlmostEqual(hist[sp]["alive_after"], n, delta=1e-6 * n)
            self.assertEqual(hist[sp]["alive_from"], "history")

    def test_flags(self):
        f = self.st["count_flags"]
        rows = f["no_current_range"]
        self.assertGreater(len(rows), 20)
        for r in rows:
            if r["iucn"] in M.NEAR_EXTINCT_STATUS and r["today_from"] != "history file":
                self.assertLessEqual(r["today"], M.NEAR_EXTINCT_CAP, r["leaf"])
        nil = {r["leaf"]: r for r in rows}["Nilopegamys plumbeus"]
        self.assertEqual((nil["today"], nil["action"]), (50.0, "capped: possibly extinct"))
        for r in f["cr_modelled_above_10k"]:
            self.assertGreater(r["today"], M.CHECK_CR_ABOVE)

    def test_unknown_counts(self):
        # ToLaD#507: the placeholder species and the two bats whose range IUCN codes extinct are unknown, drawn at
        # the thinnest a living species is; no census or history species among them
        u = self.st["count_unknown"]
        rows = {r["leaf"]: r for r in u["list"]}
        must = {"Eudorcas rufina", "Gerbillus agag", "Gerbillus burtoni", "Makalata obscura", "Rhinopoma macinnesi",
                "Oryzomys curasoae", "Pteropus loochoensis", "Scotophilus borbonicus"}
        self.assertTrue(must <= set(rows), must - set(rows))
        self.assertTrue(rows["Pteropus loochoensis"]["range_ex_pe"] and rows["Scotophilus borbonicus"]["range_ex_pe"])
        flags = {r["leaf"]: r for r in self.st["count_flags"]["no_current_range"]}
        for sp in rows:
            self.assertEqual((flags[sp]["today"], flags[sp]["today_from"]), (u["thinnest"]["N"], "unknown"), sp)
        self.assertNotIn(u["thinnest"]["leaf"], rows)
        self.assertEqual(flags["Gazella marica"]["today_from"], "census")  # a census species with no map
        self.assertEqual(flags["Oryx dammah"]["today_from"], "history file")

    def test_largest_declines_have_counts(self):
        # every one of the ten largest modelled declines ends at a census, an estimate or a history file
        names = [r["leaf"] for r in self.st["rangeloss"]["largest_declines"]]
        self.assertNotIn("Mustela nigripes", names)
        self.assertNotIn("Equus ferus", names)

    def test_greenspoon_land_total(self):
        t = self.st["occupancy_calibration"]["land_total"]
        # within 0.07 dex (17%) of Greenspoon's land total; their 95% CI on land biomass spans 13-38 Mt
        # (+-0.23 dex). The fit is per species and not held to the total: dropping the unrecognised Open Tree
        # tips (ToLaD#116, ~6e9 double-counted individuals) moved it from 0.017 to 0.052 dex below
        self.assertLess(abs(math.log10(t["individuals"] / t["greenspoon_individuals"])), 0.07)
        self.assertLess(t["biomass_Mt"], 38)  # Greenspoon's 95% CI for wild land biomass is 13-38 Mt


if __name__ == "__main__":
    unittest.main()
