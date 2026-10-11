"""Bulk genomic deep past (layer 3, ToLaD#64): pipeline/tolad_pipeline/genomic.py."""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from tolad_pipeline import genomic as GN
from tolad_pipeline import history as H

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data" / "mammals"
PANTHERA = {"Panthera leo", "Panthera tigris", "Panthera pardus", "Panthera onca", "Panthera uncia"}


def _built():
    st, dbg = DATA / "stats.json", DATA / "debug_top.json"
    if not st.exists() or not dbg.exists():
        return None, None
    s = json.loads(st.read_text())
    if "genomic" not in s:
        return None, None
    return s, {h["species"]: h for h in json.loads(dbg.read_text())["history"]}


class Unit(unittest.TestCase):
    def test_cap_steps_keeps_span_and_merges_closest(self):
        steps = [[10.0 * 2 ** i, 10.0 * 2 ** (i + 1), 1000.0 * (1 + (i % 2) * 0.01 + i)] for i in range(40)]
        out = GN.cap_steps(steps, 30)
        self.assertEqual(len(out), 30)
        self.assertEqual(out[0][0], steps[0][0])
        self.assertEqual(out[-1][1], steps[-1][1])
        for a, b in zip(out, out[1:]):
            self.assertEqual(a[1], b[0])
        # a merged step's Ne is the time-weighted harmonic mean, so between its parts
        two = GN.cap_steps([[1.0, 2.0, 100.0], [2.0, 4.0, 400.0], [4.0, 8.0, 5000.0]], 2)
        self.assertEqual(two[0][:2], [1.0, 4.0])
        self.assertAlmostEqual(two[0][2], 3.0 / (1 / 100 + 2 / 400))
        self.assertEqual(GN.cap_steps(steps[:5], 30), steps[:5])

    def test_pick_one_sample(self):
        self.assertEqual(GN._pick(["Ursus_arctos_horribilis", "Ursus_arctos_dnaZoo"], "Ursus arctos"),
                         "Ursus_arctos_dnaZoo")
        self.assertEqual(GN._pick(["Gorilla_gorilla_diehli", "Gorilla_gorilla_gorilla"], "Gorilla gorilla"),
                         "Gorilla_gorilla_gorilla")
        self.assertEqual(GN._pick(["Alces_alces_shirasi", "Alces_alces_gigas"], "Alces alces"), "Alces_alces_gigas")


class Source(unittest.TestCase):
    def setUp(self):
        if not (RAW / GN.SD1).exists() or not (RAW / GN.SD3).exists():
            self.skipTest("Bergman et al. 2023 not fetched (tolad-fetch --only bergman)")
        self.c = GN.load(RAW)

    def test_curves_are_valid_deep_tables(self):
        self.assertGreaterEqual(len(self.c), 110)
        self.assertNotIn("Homo sapiens", self.c)
        self.assertTrue(PANTHERA <= set(self.c))
        for sp, c in self.c.items():
            d = H._check_deep(c["deep"], sp)  # the same schema a hand-written [deep] passes
            self.assertLessEqual(len(d["steps"]), GN.STEP_CAP, sp)
            self.assertEqual(d["grade"], "D", sp)
            self.assertTrue(3e-9 <= d["mu"] <= 2e-8 and 1 <= d["g"] <= 40, (sp, d["mu"], d["g"]))


class Build(unittest.TestCase):
    def setUp(self):
        self.st, self.dbg = _built()
        if self.st is None:
            self.skipTest("no build output with the bulk genomic deep past")
        self.g, self.h = self.st["genomic"], self.st["history"]["species"]

    def test_coverage(self):
        self.assertGreaterEqual(self.g["used"], 100)
        rows = self.g["species"]
        # ToLaD#66: the jaguar takes the Bergman table by hand, the snow leopard Solari et al. 2025
        cites = {"Panthera onca": "Bergman", "Panthera uncia": "Solari"}
        for sp in PANTHERA:
            self.assertEqual(rows[sp]["how"], "hand-written [deep] wins", sp)
            self.assertFalse(self.h[sp]["deep"]["bulk"], sp)
            self.assertIn(cites.get(sp, "Armstrong"), self.h[sp]["deep"]["cite"], sp)
        used = [r["leaf"] for r in rows.values() if r["used"]]
        for leaf in used:
            d = self.h[leaf]["deep"]
            self.assertTrue(d["bulk"], leaf)
            self.assertEqual(self.h[leaf]["deep_from"], "genomic", leaf)
            self.assertIn("Bergman", d["cite"], leaf)

    def test_modelled_records(self):
        recs = {sp: s for sp, s in self.h.items() if s["modelled"] == "genomic"}
        self.assertGreaterEqual(len(recs), 80)
        n_rl = 0
        for sp, s in recs.items():
            h = self.dbg[sp]
            kinds = [p["kind"] for p in h["points"]]
            n = s["deep"]["points"]
            self.assertEqual(kinds[:n], ["genomic"] * n, sp)
            # then the natural level in 1500 (range-loss trend) or straight to today's count
            self.assertIn(kinds[n:], (["rangeloss", "model"], ["model"]), sp)
            self.assertEqual(h["points"][-1]["year"], round(H.NOW_YEAR), sp)
            # the genome sets the past, not today: alive stays the model's
            self.assertAlmostEqual(s["alive_after"], s["alive_before"], delta=1e-6 * s["alive_before"], msg=sp)
            segk = [x["kind"] for x in h["segments"]]
            self.assertEqual(segk[0], "held", sp)
            self.assertIn("genomic", segk, sp)
            # the join across PSMC's blind spot: log-linear, kind interpolated, grade D
            join = [x for x in h["segments"] if x["kind"] == "interpolated"]
            self.assertTrue(join and all(x["grade"] == "D" for x in join), sp)
            if "rangeloss" in kinds:
                n_rl += 1
                self.assertEqual(segk[-1], "rangeloss", sp)
                self.assertEqual(h["points"][n]["year"], 1500, sp)
        self.assertGreater(n_rl, 30)

    def test_join_is_continuous(self):
        # the last genomic point and the next level meet with no step: the segment levels at the
        # two points equal the point values (N * G / L births per generation)
        for sp, s in self.h.items():
            if not (s.get("deep") or {}).get("bulk"):
                continue
            h = self.dbg[sp]
            j = s["deep"]["join"]
            bpg = h["G"] / h["L"]
            y_last = next(p["year"] for p in reversed(h["points"]) if p["kind"] == "genomic")
            seg = min(h["segments"], key=lambda x: abs(x["year0"] - y_last))
            self.assertLess(abs(math.log(seg["start"] / bpg / j["deep_n"])), math.log(1.5), sp)


if __name__ == "__main__":
    unittest.main()
