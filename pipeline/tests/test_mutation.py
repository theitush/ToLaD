"""Tests for the per-lineage mutation rate of the genetic layers (tolad_pipeline/mutation.py, ToLaD#74, #75).

    cd pipeline && uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from tolad_pipeline import history as H
from tolad_pipeline import mutation as M
from tolad_pipeline.tree import Node

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data" / "mammals"

# a toy fit: mu_y = 1e-8 x G^-1 (rate per generation constant), a +0.1 dex offset for Rodentia
TOY = {"a": -8.0, "b": -1.0, "rms_dex": 0.1, "n": 10, "r": -0.9, "band_dex": 0.2,
       "offsets": {"Rodentia": {"dex": 0.1, "n": 2, "species": []}}, "orders_without_offset": []}


def _leaf(*lineage: str) -> Node:
    nd = None
    for name in lineage:
        c = Node(name)
        if nd is not None:
            nd.add(c)
        nd = c
    return nd


class Rate(unittest.TestCase):
    def test_flat_without_table(self):
        r = M.rate(None, 10.0)
        self.assertEqual((r["mu"], r["lo"], r["hi"]), (H.DEEP_MU_YEAR, H.DEEP_MU_YEAR_LO, H.DEEP_MU_YEAR_HI))
        self.assertEqual(r["vs_flat"], 1.0)

    def test_generation_time_effect(self):
        self.assertAlmostEqual(M.rate(TOY, 10.0)["mu"], 1e-9)
        self.assertAlmostEqual(M.rate(TOY, 1.0)["mu"], 1e-8)
        r = M.rate(TOY, 10.0, "Rodentia")
        self.assertAlmostEqual(r["mu"], 10 ** -8.9)
        self.assertAlmostEqual(r["hi"] / r["mu"], 10 ** 0.2)
        self.assertAlmostEqual(r["mu"] / r["lo"], 10 ** 0.2)

    def test_clade_is_nearest_ancestor_with_an_offset(self):
        leaf = _leaf("Mammalia", "Rodentia", "Muridae", "Mus musculus")
        self.assertEqual(M.clade_of(leaf, TOY), "Rodentia")
        self.assertIsNone(M.clade_of(_leaf("Mammalia", "Primates", "Homo sapiens"), TOY))
        self.assertIsNone(M.clade_of(leaf, None))

    def test_deep_points_use_the_lineage_rate(self):
        """Doubling the per-year rate halves the rescaled times and Ne (ToLaD#75)."""
        deep = {"method": "PSMC", "cite": "c", "url": "u", "mu": 1e-8, "g": 5.0, "grade": "D", "note": "",
                "steps": [[1e5, 2e5, 1e4], [2e5, 4e5, 2e4]]}
        flat, _ = H.deep_points(deep, 10.0)
        fast, _ = H.deep_points(deep, 10.0, mu={"mu": 2e-9, "lo": 1e-9, "hi": 4e-9})
        for a, b in zip(flat, fast):
            self.assertAlmostEqual(a["ago"] / b["ago"], 2.0)
            self.assertAlmostEqual(a["ne"] / b["ne"], 2.0)
            self.assertAlmostEqual(b["n"] / b["lo"], 2.0 * H.DEEP_NE_N_HI / H.DEEP_NE_N)
            self.assertAlmostEqual(b["hi"] / b["n"], 2.0 * H.DEEP_NE_N / H.DEEP_NE_N_LO)


class Table(unittest.TestCase):
    def setUp(self):
        if not (RAW / M.TABLE).exists():
            self.skipTest("Bergeron table not fetched")
        self.rows = M.load(RAW)
        self.m = M.fit(self.rows)

    def test_rows(self):
        self.assertEqual(len(self.rows), 32)
        by = {r["species"]: r for r in self.rows}
        self.assertAlmostEqual(by["Panthera tigris"]["mu_y"], 1.0119e-9, delta=1e-13)
        self.assertEqual(by["Homo sapiens"]["order"], "Primates")
        self.assertEqual(by["Orcinus orca"]["order"], "Artiodactyla")

    def test_fit(self):
        m = self.m
        self.assertLess(m["b"], -0.6)  # per-year rate falls with generation time
        self.assertGreater(m["b"], -1.0)  # but per generation it still rises a little
        self.assertLess(m["rms_dex"], 0.2)
        self.assertEqual(set(m["offsets"]), {"Artiodactyla", "Carnivora", "Perissodactyla", "Primates", "Rodentia"})
        # great apes nearer 0.4-0.5e-9 per year (the symptom of #74), pantherines near the flat 1e-9
        self.assertTrue(0.3e-9 < M.rate(m, 25.0, "Primates")["mu"] < 0.6e-9)
        self.assertTrue(0.8e-9 < M.rate(m, 8.0, "Carnivora")["mu"] < 1.25e-9)


class Build(unittest.TestCase):
    def setUp(self):
        p = DATA / "stats.json"
        st = json.loads(p.read_text()) if p.exists() else None
        if st is None or "mutation_rate" not in st.get("history", {}):
            self.skipTest("no build output with the mutation-rate report")
        self.h = st["history"]

    def test_every_deep_past_reports_its_rate(self):
        mr = self.h["mutation_rate"]
        for sp, s in self.h["species"].items():
            if not s.get("deep"):
                continue
            mu = s["deep"]["mu"]
            self.assertIn(sp, mr["deep_species"])
            self.assertAlmostEqual(mu["vs_flat"], mu["mu_year"] / H.DEEP_MU_YEAR, places=6)
            self.assertLess(mu["lo"], mu["mu_year"])
            self.assertLess(mu["mu_year"], mu["hi"])
            self.assertTrue(0.1 < mu["vs_flat"] < 10, sp)


if __name__ == "__main__":
    unittest.main()
