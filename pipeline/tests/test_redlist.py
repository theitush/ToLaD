"""IUCN Red List status per species (ToLaD#48).

Unit tests of the matching on a synthetic tree, the loader on the pinned Red List archive (skipped
without data/raw), and checks on the built data/mammals output (skipped without a build).
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from tolad_pipeline import redlist as R
from tolad_pipeline.tree import Node

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data" / "mammals"


def rec(cat, year=2020, taxon=1, assessment=2):
    return {"category": cat, "year": year, "taxon": taxon, "assessment": assessment}


def tree(*leaves):
    root = Node("Mammalia")
    for name, t1, kw in leaves:
        root.add(Node(name, t1=t1, **kw))
    return root


def leaf(root, name):
    return next(n for n in root.children if n.name == name)


CTX = {"phy": {"Bettongia penicillata": {"iucn": "CR"}, "Oldus livens": {"iucn": "NT"},
               "Gonus pleistocenus": {"iucn": "EP"}},
       "phy_syn": {}, "ott_syn": {7: ["Bos primigenius", "Bos taurus primigenius"]}}


class Matching(unittest.TestCase):
    def setUp(self):
        self.rl = {"Panthera tigris": rec("EN", 2022, 15955, 214862019), "Bos primigenius": rec("EX", 2023),
                   "Erethizon dorsatum": rec("LC"), "Bettongia penicillata": rec("EX", 2026),
                   "Thylacinus cynocephalus": rec("EX", 2016), "Newus nomen": rec("VU", 2024)}
        self.root = tree(("Panthera tigris", 0.0, {}), ("Bos taurus", 0.0, {"ott": 7}),
                         ("Bos primigenius", 0.0004, {}), ("Erethizon dorsatus", 0.0, {}),
                         ("Bettongia penicillata", 0.0, {}), ("Thylacinus cynocephalus", 0.0001, {}),
                         ("Oldus livens", 0.0, {}), ("Felis haussa", 0.0, {}),
                         ("Gonus pleistocenus", 0.01, {}), ("Smilodon fatalis", 0.01, {"kind": "graft"}),
                         ("Oldus vivus", 0.0, {}))
        self.rep = R.assign(self.root, self.rl, {"Oldus vivus": ["Newus nomen"]}, CTX)

    def rl_of(self, name):
        return leaf(self.root, name).data.get("red_list")

    def test_by_name_with_ids(self):
        s = self.rl_of("Panthera tigris")
        self.assertEqual((s["category"], s["year"], s["taxon"], s["assessment"], s["source"]),
                         ("EN", 2022, 15955, 214862019, R.SRC_IUCN))

    def test_synonym_that_is_another_leaf_is_not_taken(self):
        # cattle are not the aurochs, though Open Tree lists the name as a synonym
        self.assertEqual(self.rl_of("Bos taurus")["category"], "NE")
        self.assertEqual(self.rl_of("Bos primigenius")["category"], "EX")

    def test_bridge_synonym(self):
        s = self.rl_of("Oldus vivus")
        self.assertEqual((s["category"], s["via"]), ("VU", "PHYLACINE/COMBINE synonym"))

    def test_gender_ending_variant(self):
        s = self.rl_of("Erethizon dorsatus")
        self.assertEqual((s["category"], s["via"]), ("LC", "spelling variant"))

    def test_redefined_name_keeps_phylacine(self):
        s = self.rl_of("Bettongia penicillata")
        self.assertEqual((s["category"], s["year"], s["source"]), ("CR", 2016, R.SRC_PHYLACINE))

    def test_phylacine_fallback_and_not_listed(self):
        self.assertEqual(self.rl_of("Oldus livens")["category"], "NT")
        s = self.rl_of("Felis haussa")
        self.assertEqual((s["category"], s["source"], s["year"]), ("NE", R.SRC_NONE, 2026))

    def test_fossils_none_recent_extinctions_kept(self):
        self.assertIsNone(self.rl_of("Gonus pleistocenus"))  # PHYLACINE EP: prehistoric
        self.assertIsNone(self.rl_of("Smilodon fatalis"))
        self.assertEqual(self.rl_of("Thylacinus cynocephalus")["category"], "EX")

    def test_every_living_leaf_has_one(self):
        for n in self.root.children:
            if n.t1 == 0:
                self.assertIn("red_list", n.data, n.name)
        self.assertEqual(self.rep["living_leaves"], 7)

    def test_codes_fit_the_row_word(self):
        self.assertEqual(R.CATEGORIES[0], "")
        self.assertEqual(len(R.CATEGORIES), len(set(R.CATEGORIES)))
        self.assertLess(len(R.CATEGORIES), 256)
        self.assertLess(len(R.SOURCES), 256)


@unittest.skipUnless((RAW / R.ZIP).exists(), "no Red List archive in data/raw")
class Loader(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rl = R.load_redlist(RAW)

    def test_mammals_only_with_category_year_ids(self):
        self.assertGreater(len(self.rl), 5900)
        for nm, r in self.rl.items():
            self.assertIn(r["category"], R.CODE, nm)
            self.assertGreaterEqual(r["year"], 1996, nm)
            self.assertGreater(r["taxon"], 0, nm)
            self.assertGreater(r["assessment"], 0, nm)
        self.assertNotIn("Homo sapiens", self.rl)

    def test_known_assessments(self):
        # (Each record also carries its English name since ToLaD#145.)
        self.assertEqual(self.rl["Panthera tigris"], {**rec("EN", 2022, 15955, 214862019), "common": "Tiger"})
        self.assertEqual(self.rl["Panthera pardus"], {**rec("VU", 2025, 15954, 286153337), "common": "Leopard"})
        self.assertEqual(self.rl["Prionailurus bengalensis"]["category"], "LC")
        self.assertEqual(self.rl["Thylacinus cynocephalus"]["category"], "EX")


@unittest.skipUnless((DATA / "stats.json").exists(), "no build")
class Built(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rep = json.loads((DATA / "stats.json").read_text())["red_list"]

    def test_every_living_leaf_counted(self):
        r = self.rep
        self.assertEqual(sum(r["living_by_category"].values()), r["living_leaves"])
        self.assertEqual(sum(r["living_by_source"].values()), r["living_leaves"])
        self.assertGreater(r["living_by_source"]["iucn-2026-1"], 5000)

    def test_cats(self):
        f = self.rep["felidae"]
        self.assertEqual(f["Panthera tigris"], "EN 2022")
        self.assertEqual(f["Prionailurus bengalensis"], "LC 2023")
        self.assertTrue(f["Felis catus"].startswith("NE"))
