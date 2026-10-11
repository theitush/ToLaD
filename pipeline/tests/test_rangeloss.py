"""Modelled recent trend from range loss (ToLaD#62), layer 4 of the estimate stack.

Unit tests on synthetic leaves, and checks on the built data/mammals output
(skipped without a build).
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path
from types import SimpleNamespace

from tolad_pipeline import history as H
from tolad_pipeline import model as M
from tolad_pipeline.anchors import NOW_YEAR, year_to_ma

DATA = Path(__file__).resolve().parents[2] / "data" / "mammals"


def _leaf(n_nat=1e5, n_now=1e4, L=5.0, t0=1.0):
    D = {"L": L, "rate_wild_now": n_now / L, "natural": {"N": n_nat, "lo": n_nat / 10, "hi": n_nat * 10},
         "sd_today_count": 0.25, "grade_cap_today": 3}
    return SimpleNamespace(name="Testus exemplaris", t0=t0, data=D)


class Record(unittest.TestCase):
    def test_kind_appended_at_11(self):
        self.assertEqual(H.KINDS[11], "rangeloss")
        self.assertEqual(H.KINDS[:11], H.POINT_KINDS + ["model", "interpolated", "held", "baseline",
                                                        "genomic", "natural"])

    def test_two_points_and_segment_kinds(self):
        rec = M.rangeloss_record(_leaf())
        p0, p1 = rec["curve"]
        self.assertEqual((p0["year"], p0["n"], p0["grade"], p0["kind"]), (1500, 1e5, "D", "rangeloss"))
        self.assertEqual((p1["year"], p1["kind"]), (NOW_YEAR, "model"))
        self.assertAlmostEqual(p1["n"], 1e4)
        self.assertEqual(rec["modelled"], "rangeloss")
        segs = rec["segments"]
        kinds = [H.KINDS[s["kind"]] for s in segs]
        self.assertEqual(kinds[0], "natural")
        first = kinds.index("rangeloss")
        self.assertEqual(set(kinds[:first]), {"natural"})
        self.assertEqual(set(kinds[first:]), {"rangeloss"})
        for G2 in (0.5, 1.3, 7.0, 29.0):  # 1500 off a generation boundary: still natural, then rangeloss
            leaf = _leaf(L=G2 / 2)
            k2 = [H.KINDS[s["kind"]] for s in M.rangeloss_record(leaf)["segments"]]
            i = k2.index("rangeloss")
            self.assertEqual((set(k2[:i]), set(k2[i:])), ({"natural"}, {"rangeloss"}), (G2, k2))
        self.assertTrue(all(s["grade"] == 3 for s in segs))
        bpg = rec["G"] / rec["L"]
        self.assertAlmostEqual(segs[0]["start"] / bpg, 1e5)
        self.assertAlmostEqual(segs[-1]["end"] / bpg, 1e4, delta=1e4 * 0.02)
        # contiguous, ending now
        for a, b in zip(segs, segs[1:]):
            self.assertAlmostEqual(a["year0"] + a["gens"] * rec["G"], b["year0"], places=6)
        self.assertAlmostEqual(segs[-1]["year0"] + segs[-1]["gens"] * rec["G"], NOW_YEAR, places=6)

    def test_big_decline_split_into_small_ramps(self):
        rec = M.rangeloss_record(_leaf(n_nat=1e6, n_now=1e3))
        for s in rec["segments"][1:]:
            self.assertLessEqual(max(s["start"], s["end"]) / min(s["start"], s["end"]), H.SPLIT_RATIO + 1e-9)

    def test_rise_is_the_same_shape(self):
        rec = M.rangeloss_record(_leaf(n_nat=1e3, n_now=1e4))
        self.assertLess(rec["segments"][0]["start"], rec["segments"][-1]["end"])

    def test_pieces_follow_the_log_linear_trend(self):
        L, t0 = 5.0, 1.0
        pcs = H.curve_pieces(M.rangeloss_points(1e5, 1e4), L, t0, step=M.RANGELOSS_PIECE_YR)
        # the natural level is held to 1500, then the pieces fall monotonically to today's
        self.assertAlmostEqual(pcs[0][1], year_to_ma(1500))
        self.assertEqual(pcs[0][2], 1e5 / L)
        rates = [r for _, _, r in pcs]
        self.assertTrue(all(a > b for a, b in zip(rates, rates[1:])))
        # births over the trend = the log-linear integral
        span = NOW_YEAR - 1500
        want = span * H.mean_loglinear(1e5, 1e4) / L
        got = H.pieces_births(pcs[1:])
        self.assertAlmostEqual(got / want, 1.0, places=9)
        # between the #61 step at 1500 (today's level after it) and holding the natural level
        self.assertGreater(got, span * 1e4 / L)
        self.assertLess(got, span * 1e5 / L)


def _built():
    st, dbg = DATA / "stats.json", DATA / "debug_top.json"
    if not st.exists() or not dbg.exists():
        return None, None
    s = json.loads(st.read_text())
    return (s, json.loads(dbg.read_text())) if "rangeloss" in s else (None, None)


class Build(unittest.TestCase):
    def setUp(self):
        self.st, self.dbg = _built()
        if self.st is None:
            self.skipTest("no build output with a range-loss trend")
        self.rl = self.st["rangeloss"]

    def test_coverage(self):
        # every extant species with both maps that differ, less those with a history file
        self.assertGreater(self.rl["hist_records"], 500)
        self.assertEqual(self.rl["species_with_trend"], self.rl["hist_records"] + self.rl["replaced_by_history_file"]
                         + self.rl["carried_by_genomic_record"])
        self.assertEqual(self.rl["declines"] + self.rl["rises"], self.rl["hist_records"])
        self.assertEqual(self.rl["start_year"], 1500)

    def test_factor_is_the_range_ratio(self):
        rows = self.rl["largest_declines"] + self.rl["rises_list"]
        for r in rows + [r for r in self.rl["showcase"] if r["from"] == "rangeloss"]:
            self.assertGreater(r["km2_cur"], 0, r["leaf"])
            self.assertAlmostEqual(r["factor"], r["km2_nat"] / r["km2_cur"], delta=1e-6 * r["factor"],
                                   msg=r["leaf"])
            self.assertNotAlmostEqual(r["factor"], 1.0, places=6, msg=r["leaf"])

    def test_history_file_wins(self):
        rows = {r["leaf"]: r for r in self.rl["showcase"]}
        for sp in ("Bison bison", "Canis lupus", "Ursus arctos", "Elephas maximus"):
            self.assertEqual(rows[sp]["from"], "history", sp)
        hist = {h["species"]: h for h in self.dbg["history"]}
        for sp in ("Bison bison", "Canis lupus"):
            self.assertIsNone(hist[sp].get("modelled"), sp)
        # a cited baseline (and a genomic curve scaled to it): no trend
        self.assertNotIn("rangeloss", {s["kind"] for s in hist["Bison bison"]["segments"]})
        # the natural level, no baseline (ToLaD#71): the trend fills the gap from 1500 to the first point
        self.assertEqual(hist["Canis lupus"]["points"][0]["kind"], "rangeloss")
        self.assertIn("rangeloss", {s["kind"] for s in hist["Canis lupus"]["segments"]})

    def test_unchanged_range_stays_flat(self):
        # species whose natural and current maps agree have no trend and no record
        nb = self.st["natural_baseline"]["extant_log10_natural_over_today"]
        self.assertGreater(nb["same"], 4000)
        rows = {r["leaf"]: r for r in self.rl["showcase"]}
        for sp in ("Procyon lotor", "Sorex araneus"):  # PHYLACINE certainty 0: natural map = IUCN map
            self.assertEqual(rows[sp]["from"], "flat", sp)
            self.assertAlmostEqual(rows[sp]["factor"], 1.0, places=12, msg=sp)
            self.assertEqual(rows[sp]["segments"], 0, sp)

    def test_dump_records(self):
        rl = [h for h in self.dbg["history"] if h.get("modelled") == "rangeloss"]
        self.assertGreater(len(rl), 10)
        for h in rl:
            self.assertEqual([p["kind"] for p in h["points"]], ["rangeloss", "model"], h["species"])
            kinds = [s["kind"] for s in h["segments"]]
            i = kinds.index("rangeloss")
            self.assertEqual((set(kinds[:i]), set(kinds[i:])), ({"natural"}, {"rangeloss"}), h["species"])


if __name__ == "__main__":
    unittest.main()
