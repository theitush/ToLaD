"""Tests for layer 2 of the estimate stack, long-term size from genetic diversity
(tolad_pipeline/diversity.py, ToLaD#63).

    cd pipeline && uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from tolad_pipeline import diversity as V
from tolad_pipeline import history as H

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data" / "mammals"


class Level(unittest.TestCase):
    def test_formula(self):
        # het 1e-3, G 10 yr: mu_gen = 1e-8, Ne = 1e-3 / 4e-8 = 25,000; N = Ne / 0.1
        lv = V.level(1e-3, 10.0)
        self.assertAlmostEqual(lv["ne"], 25000.0, places=6)
        self.assertAlmostEqual(lv["N"], 250000.0, places=4)
        # lo uses the high Ne/N (0.3), hi the low one (0.05)
        self.assertAlmostEqual(lv["lo"], 25000.0 / 0.3, places=4)
        self.assertAlmostEqual(lv["hi"], 500000.0, places=4)
        self.assertLess(lv["lo"], lv["N"])
        self.assertLess(lv["N"], lv["hi"])

    def test_shares_layer3_scaling(self):
        """The same mutation rate and Ne/N as the genomic deep past."""
        lv = V.level(4e-3, 1.0)
        self.assertAlmostEqual(lv["ne"], 4e-3 / (4 * H.DEEP_MU_YEAR), places=3)
        self.assertAlmostEqual(lv["N"] * H.DEEP_NE_N, lv["ne"], places=3)

    def test_longer_generations_mean_smaller_ne(self):
        self.assertAlmostEqual(V.level(2e-3, 5.0)["ne"] / V.level(2e-3, 20.0)["ne"], 4.0, places=9)


class Table(unittest.TestCase):
    def setUp(self):
        if not (RAW / V.TABLE).exists():
            self.skipTest("Zoonomia table not fetched")
        self.rows = V.load(RAW)

    def test_rows(self):
        self.assertEqual(len(self.rows), 209)
        by = {r["species"]: r for r in self.rows}
        self.assertAlmostEqual(by["Acinonyx jubatus"]["het"], 0.00033515)
        self.assertEqual(by["Acinonyx jubatus"]["sample"], "wild")
        for r in self.rows:
            self.assertTrue(1e-5 < r["het"] < 0.02, r)


def _stats():
    p = DATA / "stats.json"
    return json.loads(p.read_text()) if p.exists() else None


class Build(unittest.TestCase):
    def setUp(self):
        st = _stats()
        if st is None or "diversity_crosscheck" not in st:
            self.skipTest("no build output with the diversity cross-check")
        self.d = st["diversity_crosscheck"]

    def test_coverage(self):
        c = self.d["coverage"]
        self.assertEqual(c["table_with_het"], 209)
        self.assertGreaterEqual(c["matched_leaves"], 200)
        self.assertEqual(c["matched_leaves"] + len(c["unmatched"]) + len(c["same_leaf_as_an_earlier_row"]),
                         c["table_with_het"])
        self.assertGreaterEqual(c["with_natural"], 190)
        self.assertEqual(self.d["grade"], "D")

    def test_rows_consistent(self):
        rows = self.d["species"]
        self.assertEqual(len({r["leaf"] for r in rows}), len(rows))  # one row per leaf
        for r in rows:
            self.assertLessEqual(r["lo"], r["N"])
            self.assertLessEqual(r["N"], r["hi"])
            self.assertAlmostEqual(r["N"] / V.level(r["het"], r["G"])["N"], 1.0, delta=1e-3)
            if r["natural"]:
                self.assertAlmostEqual(r["dex_vs_natural"], math.log10(r["N"] / r["natural"]), delta=2e-3)

    def test_distribution_adds_up(self):
        for key in ("vs_natural", "vs_today"):
            s = self.d[key]
            self.assertEqual(s["within_10x"] + s["div_higher_10x"] + s["div_lower_10x"], s["n"])
            self.assertEqual(sum(s["histogram_dex"].values()), s["n"])
        flagged = self.d["disagree_natural_10x"]
        self.assertEqual(len(flagged), self.d["vs_natural"]["div_higher_10x"] + self.d["vs_natural"]["div_lower_10x"])
        self.assertTrue(all(abs(f["dex_vs_natural"]) > 1.0 for f in flagged))

    def test_panthera_within_10x(self):
        """Leopard and jaguar: the diversity size sits within 10x of the natural baseline."""
        rows = {r["leaf"]: r for r in self.d["species"]}
        for s in ("Panthera onca", "Panthera pardus"):
            self.assertLess(abs(rows[s]["dex_vs_natural"]), 1.0, s)


if __name__ == "__main__":
    unittest.main()
