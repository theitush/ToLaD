"""The living species our backbone lacks, from the Mammal Diversity Database (ToLaD#278).

Unit tests of the matching and grafting rules on a synthetic tree, and checks on the built
data/mammals output (skipped without a build).
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from tolad_pipeline import mdd
from tolad_pipeline.tree import Node

DATA = Path(__file__).resolve().parents[2] / "data" / "mammals"


def tree(spec):
    nodes = {"Mammalia": Node("Mammalia", rank="class")}

    def get(nm):
        if nm not in nodes:
            nodes[nm] = Node(nm, rank="species" if " " in nm else "genus")
        return nodes[nm]
    for par, kids in spec.items():
        for k in kids:
            get(par).add(get(k))
    return nodes["Mammalia"], nodes


def row(name, genus=None, family="Cheirogaleidae", order="Primates", syn=(), extinct=False, domestic=False):
    return {"name": name, "id": 1, "genus": genus or name.split()[0], "family": family, "order": order,
            "common": f"{name} (en)", "extinct": extinct, "domestic": domestic, "iucn": "LC", "year": "2020",
            "syn": set(syn)}


class Match(unittest.TestCase):
    def setUp(self):
        self.root, self.n = tree({"Mammalia": ["Cheirogaleidae"],
                                  "Cheirogaleidae": ["Mirza", "Microcebus", "Phaner"],
                                  "Mirza": ["Mirza coquereli"],
                                  "Microcebus": ["Microcebus murinus", "Microcebus rufus"],
                                  "Phaner": ["Phaner furcifer"]})
        self.rows = [
            row("Mirza coquereli"),
            row("Mirza zaza", syn={"Mirza coquereli"}),  # a split: its nominal names include the parent's
            row("Microcebus murinus"), row("Microcebus rufus"), row("Microcebus berthae"),
            row("Phaner pallescens", syn={"Phaner furcifer"}),  # our old name for it
            row("Allocebus trichotis", genus="Allocebus"),  # a genus we lack
        ]

    def test_split_daughter_does_not_claim_the_parent(self):
        hit, how = mdd.match(self.root, self.rows, {})
        self.assertIs(hit["Mirza coquereli"], self.n["Mirza coquereli"])
        self.assertNotIn("Mirza zaza", hit)
        self.assertIs(hit["Phaner pallescens"], self.n["Phaner furcifer"])
        self.assertEqual(how["Phaner pallescens"], "MDD synonym")

    def test_epithet_in_another_gender_is_the_same_species(self):
        # MDD's Euroscaptor malayanus is our E. malayana: matched, not grafted beside it as a second mole
        root, n = tree({"Mammalia": ["Euroscaptor"], "Euroscaptor": ["Euroscaptor malayana", "Euroscaptor klossi"]})
        rows = [row("Euroscaptor malayanus", family="Talpidae"), row("Euroscaptor klossi", family="Talpidae"),
                row("Euroscaptor kuznetsovi", family="Talpidae")]
        hit, how = mdd.match(root, rows, {})
        self.assertIs(hit["Euroscaptor malayanus"], n["Euroscaptor malayana"])
        self.assertEqual(how["Euroscaptor malayanus"], "epithet gender")
        self.assertNotIn("Euroscaptor kuznetsovi", hit)  # another species, not an ending away from klossi

    def test_grafts_on_the_genus(self):
        log = {}
        new = {n.name: n for n in mdd.graft(self.root, self.rows, {}, log)}
        self.assertEqual(set(new), {"Mirza zaza", "Microcebus berthae", "Allocebus trichotis"})
        # several genus-mates: their common ancestor
        self.assertIs(new["Microcebus berthae"].parent, self.n["Microcebus"])
        # one genus-mate: a new split above it, inside the old parent
        w = new["Mirza zaza"].parent
        self.assertIn(self.n["Mirza coquereli"], w.children)
        self.assertIs(w.parent, self.n["Mirza"])
        self.assertEqual(w.data["created_from"], "MDD")
        # no genus-mate: a new genus under its family-mates
        g = new["Allocebus trichotis"].parent
        self.assertEqual((g.name, g.rank), ("Allocebus", "genus"))
        self.assertIs(g.parent, self.n["Cheirogaleidae"])
        for nd in new.values():
            self.assertFalse(nd.extinct)
            self.assertEqual(nd.kind, "tree")
            self.assertTrue(nd.data["mdd"])
            self.assertEqual(nd.data["common_mdd"], f"{nd.name} (en)")
        self.assertEqual(log["mdd"]["grafted"], 3)
        self.assertIn("Phaner pallescens", self.n["Phaner furcifer"].alt)

    def test_extinct_and_domestic_are_not_grafted(self):
        rows = self.rows + [row("Microcebus extinctus", extinct=True), row("Microcebus domesticus", domestic=True)]
        names = {n.name for n in mdd.graft(self.root, rows, {}, {})}
        self.assertNotIn("Microcebus extinctus", names)
        self.assertNotIn("Microcebus domesticus", names)

    def test_kept_tip_carries_its_mdd_status(self):
        # an Open Tree tip only MDD knows (kept by #116's rescue) carries MDD's IUCN category, so the count
        # model's CR/EW cap applies to it as to a graft
        self.n["Microcebus rufus"].data["mdd_rescued"] = True
        rows = [dict(r, iucn="CR") if r["name"] == "Microcebus rufus" else r for r in self.rows]
        mdd.graft(self.root, rows, {}, {})
        self.assertEqual(self.n["Microcebus rufus"].data["mdd_iucn"], "CR")

    def test_recogniser(self):
        known = mdd.recogniser(self.rows)
        self.assertTrue(known("Microcebus berthae", set()))
        self.assertFalse(known("Phaner furcifer", set()))  # a synonym is not a species (#116)
        self.assertFalse(known("Felis affinis", set()))


@unittest.skipUnless((DATA / "stats.json").exists(), "no build")
class Built(unittest.TestCase):
    def test_mdd_grafts(self):
        s = json.loads((DATA / "stats.json").read_text())["mdd"]
        self.assertGreater(s["living_matched"], 5000)
        self.assertGreater(s["grafted"], 300)
        # every genus-median estimate names its taxon and how many species it is the median of
        for sp, e in s["genus_median_estimates"]["species"].items():
            self.assertIn(e["level"], ("genus", "family", "order"))
            self.assertGreaterEqual(e["of"], 1)

    def test_cr_guesses_held(self):
        # a CR/EW species (by MDD's IUCN category) counted by its genus median, grafted or a kept Open Tree tip
        # (Lepilemur grewcocki), is held to 250
        rows = mdd.load(DATA.parents[1] / "data" / "raw")
        if not rows:
            self.skipTest("no MDD raw file")
        cr = {r["name"] for r in rows if r["iucn"] in ("CR", "EW")}
        est = json.loads((DATA / "stats.json").read_text())["mdd"]["genus_median_estimates"]["species"]
        held = [sp for sp in est if sp in cr]
        self.assertIn("Lepilemur grewcocki", held)
        for sp in held:
            self.assertLessEqual(est[sp]["N"], 250, sp)

    def test_mdd_species_inside_their_genus(self):
        # an MDD species joins its genus-mates' dated crown, never the stem by its merged band start
        # (Canis lycaon hung at 14 Ma, Mus species at 40 Ma)
        g = json.loads((DATA / "stats.json").read_text())["dated_tree"]["grafts"]
        self.assertGreater(g.get("MDD species: joins its genus crown (loose)", 0), 1000)


if __name__ == "__main__":
    unittest.main()
