"""Which leaves are drawn living, and with what count (ToLaD#116, #105, #135).

Unit tests of the rules on synthetic trees, and checks on the built data/mammals output (skipped
without a build).
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from tolad_pipeline import anchors
from tolad_pipeline import redlist as R
from tolad_pipeline.merge import EX_WINDOW_MA, LAD_RECENT_EX, assign_bands, drop_unrecognised
from tolad_pipeline.tree import Node, drop_empty

DATA = Path(__file__).resolve().parents[2] / "data" / "mammals"


def tree(spec):
    """{parent: [children]} -> root 'Mammalia'"""
    nodes = {"Mammalia": Node("Mammalia", rank="class")}

    def get(nm):
        if nm not in nodes:
            nodes[nm] = Node(nm, rank="species" if " " in nm else "genus")
        return nodes[nm]
    for par, kids in spec.items():
        for k in kids:
            get(par).add(get(k))
    return nodes["Mammalia"], nodes


class Unrecognised(unittest.TestCase):
    def setUp(self):
        self.root, self.n = tree({"Mammalia": ["Felis", "Lynx", "Puma"],
                                  "Felis": ["Felis chaus", "Felis affinis"],
                                  "Lynx": ["Lynx lynx"], "Puma": ["Puma yaguarondi"]})
        self.n["Lynx lynx"].alt.append("Lynx vulgaris")
        self.n["Lynx"].add(Node("Lynx vulgaris", rank="species"))
        self.n["Lynx"].add(Node("Lynx spelaea", rank="species", extinct=True))  # flagged fossil: kept
        known = {"Felis chaus", "Lynx lynx"}
        self.log = {}
        drop_unrecognised(self.root, lambda nd: nd.name in known, {}, {}, self.log)

    def leaves(self):
        return sorted(x.name for x in self.root.preorder() if x.is_leaf and not x.data.get("empty_higher"))

    def test_unrecognised_living_tips_go(self):
        self.assertEqual(self.leaves(), ["Felis chaus", "Lynx lynx", "Lynx spelaea"])
        self.assertEqual(self.log["unrecognised_tips"]["dropped"], 3)

    def test_synonym_folds_into_its_leaf(self):
        self.assertEqual(self.log["unrecognised_tips"]["folded_into_a_synonym_leaf"], 1)
        self.assertIn("Lynx vulgaris", self.n["Lynx lynx"].alt)

    def test_emptied_genus_is_dropped(self):
        self.assertTrue(self.n["Puma"].data.get("empty_higher"))
        drop_empty(self.root)
        self.assertNotIn(self.n["Puma"], self.root.children)


class BandEnds(unittest.TestCase):
    def band(self, **kw):
        root = Node("Mammalia", age=10.0)
        root.add(Node("Sister alive"))
        x = Node("Gonus specius", **kw)
        root.add(x)
        assign_bands(root, {})
        return x

    def test_graft_with_holocene_lad_ends_before_1500(self):
        x = self.band(kind="graft", extinct=True, fad=0.03, lad=0.0)
        self.assertAlmostEqual(x.t1, EX_WINDOW_MA)
        self.assertGreater(x.t1, 0.0)

    def test_red_list_ex_ends_a_century_ago(self):
        x = self.band(extinct=True, lad=0.0, data={"red_list_ex": True})
        self.assertAlmostEqual(x.t1, LAD_RECENT_EX)
        x = self.band(extinct=True, data={"iucn": "EX"})
        self.assertAlmostEqual(x.t1, LAD_RECENT_EX)

    def test_older_last_appearance_kept(self):
        x = self.band(kind="graft", extinct=True, fad=2.0, lad=1.0)
        self.assertAlmostEqual(x.t1, 1.0)


class RedListExtinct(unittest.TestCase):
    def test_ex_on_the_red_list_is_extinct(self):
        root = Node("Mammalia")
        for nm in ("Chaeropus yirratji", "Panthera tigris", "Bettongia penicillata", "Camelus bactrianus"):
            root.add(Node(nm, rank="species"))
        rl = {"Chaeropus yirratji": {"category": "EX", "year": 2025, "taxon": 1, "assessment": 1},
              "Panthera tigris": {"category": "EN", "year": 2022, "taxon": 2, "assessment": 2},
              "Bettongia penicillata": {"category": "EX", "year": 2026, "taxon": 3, "assessment": 3},
              "Camelus bactrianus": {"category": "CR", "year": 2008, "taxon": 4, "assessment": 4}}
        ctx = {"phy": {}, "phy_syn": {}, "ott_syn": {}, "red_list_src": (rl, {})}
        log = {}
        R.flag_extinct(root, Path("/nonexistent"), ctx, log)
        self.assertEqual(log["red_list_extinct_flags"]["leaves"], ["Chaeropus yirratji"])  # REDEFINED kept
        self.assertTrue(root.children[0].extinct)
        # a domestic form never takes its wild relative's Red List record
        self.assertEqual(R.Matcher(root, rl, {}, ctx)(root.children[3]), (None, None))


class DomesticForms(unittest.TestCase):
    def test_tables_cover_every_form(self):
        for f in anchors.DOMESTIC_FORMS:
            self.assertIn(f, anchors.DOMESTICATION_YEAR)
            if f != "Canis familiaris":  # the dog's stock is the Greenspoon pets table's (ToLaD#175)
                self.assertIn(f, anchors.DOMESTIC_FORM_NO_STOCK)


@unittest.skipUnless((DATA / "stats.json").exists(), "no build")
class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.st = json.loads((DATA / "stats.json").read_text())

    def test_no_living_leaf_is_red_list_ex(self):
        self.assertEqual(self.st["red_list"]["living_in_tree_but_red_list_ex"], [])

    def test_no_unrecognised_felidae(self):
        u = self.st["unrecognised_tips"]
        self.assertIn("Felis affinis", u["felidae"])
        self.assertIn("Puma yaguarondi", u["felidae"])
        self.assertLess(self.st["unverified_extant_tips"]["tips"], 300)
