"""When each range was lost (ToLaD#507 group 3): the fall starts at a documented start, prehistoric cells
are left out of the 1500 level, and every other species draws as before and carries its basis.

Unit tests on the CSV and synthetic leaves, and checks on the built data/mammals output (skipped without one).
"""

from __future__ import annotations

import json
import math
import unittest
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

from tolad_pipeline import history as H
from tolad_pipeline import lossdates as LD
from tolad_pipeline import model as M
from tolad_pipeline.anchors import NOW_YEAR, year_to_ma

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "mammals"
BUILD = ROOT / "data" / "build" / "audit_leaves.json"
RAW = ROOT / "data" / "raw"


def _leaf(start=None, n_nat=1e5, n_now=1e4, L=5.0, t0=1.0):
    D = {"L": L, "rate_wild_now": n_now / L, "natural": {"N": n_nat, "lo": n_nat / 10, "hi": n_nat * 10},
         "sd_today_count": 0.25, "grade_cap_today": 3}
    if start is not None:
        D["loss"] = {"basis": "later", "start": start}
    return SimpleNamespace(name="Testus exemplaris", t0=t0, data=D)


def _level(pieces, year):
    t = year_to_ma(year)
    return next(r for o, y, r in pieces if o >= t > y)


class Classes(unittest.TestCase):
    def test_counts_as_the_research_gives_them(self):
        d = LD.load()
        self.assertEqual(len(d), 682)
        self.assertEqual(Counter(x["basis"] for x in d.values()),
                         {"later": 77, "dated": 167, "prehistoric": 5, "bound": 248, "undated": 185})
        later = Counter(x["start"] for x in d.values() if x["basis"] == "later")
        self.assertEqual(later[1788], 64)  # Strahan & Van Dyck's 62 and the two hairy-nosed wombats
        self.assertEqual(d["Enhydra lutris"]["start"], 1741)
        self.assertTrue(all(x["start"] == 1500 for x in d.values() if x["basis"] != "later"))

    def test_bounds_name_their_island(self):
        d = LD.load()
        self.assertTrue(all(x["place"] for x in d.values() if x["basis"] == "bound"))
        self.assertEqual(Counter(x["place"] for x in d.values() if x["basis"] == "bound")["Madagascar"], 118)
        self.assertEqual(d["Alces alces"]["basis"], "bound")  # the Iron Age range: a bound, not cells
        src = LD.sources(d)
        mad = src[next(x["key"] for x in d.values() if x["place"] == "Madagascar")]
        self.assertEqual((mad["from"], mad["place"]), (-8500, "Madagascar"))
        self.assertIn("Douglass et al. 2019", mad["cite"])

    def test_undated_have_no_start_but_1500(self):
        d = LD.load()
        und = [x for x in d.values() if x["basis"] == "undated"]
        self.assertEqual(len(und), 185)
        self.assertTrue(all(x["start"] == 1500 for x in und))


class Trend(unittest.TestCase):
    def test_later_start_holds_then_falls_to_the_same_level(self):
        a, b = M.rangeloss_record(_leaf()), M.rangeloss_record(_leaf(1788))
        self.assertEqual(b["curve"][0]["year"], 1788)
        self.assertEqual(b["curve"][0]["n"], a["curve"][0]["n"])
        self.assertEqual(b["curve"][1]["n"], a["curve"][1]["n"])
        kinds = [s["kind"] for s in b["segments"]]
        i = kinds.index(H.K["rangeloss"])
        self.assertEqual(set(kinds[:i]), {H.K["natural"]})
        # the natural level held across 1500..1788, then the fall: its first segment starts at 1788
        self.assertLess(abs(b["segments"][i]["year0"] - 1788), b["G"])
        j = [s["kind"] for s in a["segments"]].index(H.K["rangeloss"])
        self.assertLess(abs(a["segments"][j]["year0"] - 1500), a["G"])

    def test_pieces_flat_to_the_start(self):
        L = 5.0
        pts = M.rangeloss_points(1e5, 1e4, 1788)
        pc = H.curve_pieces(pts, L, 1.0, step=M.RANGELOSS_PIECE_YR)
        for y in (1501, 1600, 1787):
            self.assertAlmostEqual(_level(pc, y) * L, 1e5, delta=1.0)
        self.assertLess(_level(pc, 1900) * L, 1e5 * 0.99)
        self.assertLess(pc[-1][2] * L, 1.3e4)  # the last 25-year piece: the mean of the curve over it


class Natural(unittest.TestCase):
    def _D(self, pre):
        pr = {"cells_nat": 30, "cells_cur": 10, "km2_nat": 30 * 9312.0, "km2_cur": 10 * 9312.0, "name": "X y",
              "note_class": "people"}
        if pre:
            pr["cells_pre"] = pre
        return {"phy_range": pr}

    def test_prehistoric_cells_left_out(self):
        a = M.natural_level(self._D(0), 1000.0, 0.3, False, {})
        b = M.natural_level(self._D(15), 1000.0, 0.3, False, {})
        self.assertAlmostEqual(a["N"], 3000.0)
        self.assertAlmostEqual(b["N"], 1500.0)
        self.assertEqual(b["cells_nat"], 15)
        self.assertAlmostEqual(b["km2_nat"], 15 * 9312.0)
        self.assertIn("without the 15 cells lost before 1500", b["method"])

    def test_all_lost_before_1500_is_flat(self):
        c = M.natural_level(self._D(20), 1000.0, 0.3, False, {})
        self.assertEqual(c["N"], 1000.0)


def _built():
    if not (DATA / "stats.json").exists() or not BUILD.exists():
        return None, None
    st = json.loads((DATA / "stats.json").read_text(encoding="utf-8"))
    if "by_basis" not in st.get("rangeloss", {}):
        return None, None
    rows = {r["name"]: r for r in json.loads(BUILD.read_text(encoding="utf-8"))["rows"]}
    return st, rows


def _at(r, year):
    c = sorted(r["curve"], key=lambda p: p["year"])
    for a, b in zip(c, c[1:]):
        if a["year"] <= year <= b["year"]:
            f = (year - a["year"]) / (b["year"] - a["year"])
            return math.exp(math.log(a["n"]) + f * (math.log(b["n"]) - math.log(a["n"])))
    return c[-1]["n"] if year > c[-1]["year"] else c[0]["n"]


class Build(unittest.TestCase):
    def setUp(self):
        self.st, self.rows = _built()
        if self.st is None:
            self.skipTest("no build output with loss dates")
        self.rl = self.st["rangeloss"]

    def test_australian_flat_to_1788_then_to_the_same_level(self):
        r = self.rows["Myrmecobius fasciatus"]  # the numbat: Strahan & Van Dyck 2008, from 1788
        self.assertEqual(r["modelled"], "rangeloss")
        nat, now = r["natural"]["N"], r["alive"]
        for y in (1500, 1600, 1700, 1788):
            self.assertAlmostEqual(_at(r, y), nat, delta=nat * 1e-9, msg=y)
        self.assertLess(_at(r, 1900), nat * 0.9)
        self.assertAlmostEqual(_at(r, NOW_YEAR), now, delta=now * 1e-9)
        self.assertGreater(nat / now, 2)

    def test_dhole_1500_level_leaves_out_north_america(self):
        pre = {p["leaf"]: p for p in self.rl["prehistoric"]}
        d = pre["Cuon alpinus"]
        self.assertEqual(d["place"], "North America")
        self.assertGreater(d["cells_left_out"], 2000)
        r = self.rows["Cuon alpinus"]
        if RAW.exists():
            from tolad_pipeline import ranges
            c = ranges.read_cells(RAW, ["Cuon alpinus"])["Cuon alpinus"]
            nat, cur = len(c["nat"]), len(c["cur"])
            self.assertAlmostEqual(r["natural"]["N"], r["alive"] * (nat - d["cells_left_out"]) / cur,
                                   delta=1e-9 * r["alive"])
            cells = LD.prehistoric_cells(RAW, LD.load())["Cuon alpinus"]["cells"]
            from tolad_pipeline.globe import row_edges
            e = row_edges()
            self.assertTrue(all(LD._cell_lonlat(x, e)[0] < -50 for x in cells))  # all in the Americas
            self.assertFalse(cells & c["cur"])
        self.assertAlmostEqual(_at(r, 1500), r["natural"]["N"], delta=r["natural"]["N"] * 1e-9)

    def test_island_and_undated_draw_as_before_and_carry_basis(self):
        st, rows = self.st, self.rows
        by = self.rl["by_basis"]
        for b in LD.BASES:
            self.assertGreater(by[b]["all"], 0, b)
        # an island species (Madagascar) and an undated one (the red fox): the fall from 1500, the range ratio
        for sp, basis in (("Microcebus murinus", "bound"), ("Vulpes vulpes", "undated")):
            r = rows[sp]
            self.assertEqual(r["loss"]["basis"], basis, sp)
            self.assertEqual(r["loss"]["start"], 1500, sp)
            pts = sorted(r["curve"], key=lambda p: p["year"])
            self.assertEqual([round(p["year"]) for p in pts if p["kind"] == "rangeloss"], [1500], sp)


if __name__ == "__main__":
    unittest.main()
