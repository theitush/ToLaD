"""Zero-length branches given time (ToLaD#561, dated.zero_length: the minimum branch length, dated.mbl_dates, or the
"equal" method, dated.equal_dates): both rules on small trees, and both builds' output (data/mammals, data/amniotes):
every split below its parent, the moved ones never younger than their oldest fossil, and no two nested fossil-dated
splits at one date."""

import json
import unittest
from pathlib import Path

from tolad_pipeline import dated
from tolad_pipeline.dated import S_FLOOR, S_FOSSIL, S_OVERRIDE, S_UPHAM, DNode, equal_dates, mbl_dates, tied

ROOT = Path(__file__).resolve().parents[2]
MAM = ROOT / "data" / "mammals"
AMN = ROOT / "data" / "amniotes"
FIXED = ("upham", "upham-imputed", "override", "alvarez", "ensemble", "upham-interp", "avesdata", "title2024",
         "colston2020", "timetree")


def split(age, *kids, src=S_FOSSIL, name=None, note=-1):
    d = DNode(age=age, lo=age, hi=age, src=src, name=name, note=note)
    for k in kids:
        d.add(k)
    return d


class _Leaf:
    name = "Species tip"


def tip():
    return DNode(leaf=_Leaf())


class TestRule(unittest.TestCase):
    def test_a_run_shares_the_branch_above_it_equally(self):
        # Archosauria (fixed, 251) > Avemetatarsalia > Ornithodira > Dinosauriformes > Dinosauria, all at 245 (the
        # oldest dinosaur): the 6 Ma above Avemetatarsalia shared by the four branches, Dinosauria where it was
        dino = split(245.0, tip(), tip(), name="Dinosauria")
        dfm = split(245.0, dino, tip(), name="Dinosauriformes")
        orn = split(245.0, dfm, tip(), name="Ornithodira")
        ave = split(245.0, orn, tip(), name="Avemetatarsalia")
        arch = split(251.0, ave, tip(), src=S_UPHAM, name="Archosauria")
        log = {}
        equal_dates(arch, log)
        self.assertEqual([round(x.age, 6) for x in (arch, ave, orn, dfm, dino)], [251.0, 249.5, 248.0, 246.5, 245.0])
        self.assertEqual(log["zero_length"]["splits_moved"], 3)
        self.assertEqual(log["zero_length"]["largest_move"], {"split": "Avemetatarsalia", "from_Ma": 245.0, "to_Ma": 249.5})
        self.assertEqual(ave.lo, 245.0)  # the oldest fossil stays its minimum
        self.assertEqual(log["zero_length"]["moved_younger"] + log["zero_length"]["not_below_parent"], 0)

    def test_fixed_ages_never_move_and_end_a_run(self):
        # a dated tree's crown (fixed) under a fossil stem at its age: the stem moves, the crown never
        crown = split(100.0, tip(), tip(), src=S_UPHAM, name="crown")
        stem = split(100.0, crown, tip(), name="stem")
        top = split(110.0, stem, tip(), src=S_UPHAM)
        equal_dates(top, {})
        self.assertEqual((top.age, stem.age, crown.age), (110.0, 105.0, 100.0))
        # a fixed split inside a run of ties: nothing can move it, so the fossil split under it stays tied
        inner = split(100.0, tip(), tip())
        fixed = split(100.0, inner, tip(), src=S_UPHAM)
        top = split(110.0, fixed, tip(), src=S_UPHAM)
        log = {}
        equal_dates(top, log)
        self.assertEqual((fixed.age, inner.age), (100.0, 100.0))
        self.assertEqual(log["zero_length"]["tied_left"], 1)
        # an override never moves
        inner = split(100.0, tip(), tip())
        ov = split(100.0, inner, tip(), src=S_OVERRIDE, note=0)
        top = split(110.0, ov, tip(), src=S_UPHAM)
        equal_dates(top, {})
        self.assertEqual(ov.age, 100.0)

    def test_a_fossil_floor_moves(self):
        # a backbone split raised to the oldest fossil inside it (fossils.backbone_minima: fossil-floor) is a fossil's date
        inner = split(263.0, tip(), tip(), name="Crocopoda")
        floor = split(263.0, inner, tip(), src=S_FLOOR, name="Archelosauria")
        top = split(281.0, floor, tip(), src=S_UPHAM, name="Sauria")
        equal_dates(top, {})
        self.assertEqual((round(floor.age, 6), inner.age), (272.0, 263.0))

    def test_no_time_at_the_data_precision(self):
        # 0.1 Ma above a run of three at 318.7 Ma: a share under 1e-3 of the age is a tie still, so the inner split stays
        # and the run above it, two branches, tries again (0.05 Ma each: still tied): nothing moves
        a = split(318.7, tip(), tip())
        b = split(318.7, a, tip())
        c = split(318.7, b, tip())
        top = split(318.8, c, tip(), src=S_UPHAM)
        log = {}
        equal_dates(top, log)
        self.assertEqual((a.age, b.age, c.age), (318.7, 318.7, 318.7))
        self.assertEqual(log["zero_length"]["splits_moved"], 0)
        # with 1 Ma above, three branches of 0.33: shared
        top.age = 319.7
        equal_dates(top, log)
        self.assertEqual([round(x.age, 4) for x in (a, b, c)], [318.7, 319.0333, 319.3667])

    def test_innermost_left_when_the_share_is_too_short(self):
        # four tied under 1 Ma at 300: a quarter (0.25) is under 1e-3 x 301, a third (0.33) is not: the innermost stays
        # at the date of the split round it, the three above share the time
        a = split(300.0, tip(), tip(), name="a")
        b = split(300.0, a, tip(), name="b")
        c = split(300.0, b, tip(), name="c")
        d = split(300.0, c, tip(), name="d")
        top = split(301.0, d, tip(), src=S_UPHAM)
        log = {}
        equal_dates(top, log)
        self.assertEqual([round(x.age, 4) for x in (a, b, c, d)], [300.0, 300.0, 300.3333, 300.6667])
        self.assertEqual(log["zero_length"]["tied_left"], 1)

    def test_branching_runs_and_order(self):
        # a run shared first from its furthest branch (paleotree's order); a sister run under a split already moved
        # has time of its own then, and shares only its own branch
        x0 = split(50.0, tip(), tip())
        x1 = split(50.0, x0, tip())
        y0 = split(50.0, tip(), tip())
        v = split(50.0, x1, y0)
        top = split(56.0, v, tip(), src=S_UPHAM)
        equal_dates(top, {})
        self.assertEqual([round(x.age, 4) for x in (x0, x1, v)], [50.0, 52.0, 54.0])
        self.assertEqual(y0.age, 50.0)  # (its branch now 4 Ma long)
        for d in top.preorder():
            for c in d.children:
                if c.leaf is None:
                    self.assertGreater(d.age, c.age)

    def test_skip_is_left_exactly(self):
        # the mammal build's dated tree inside the amniotes': its own ties are its build's, never re-dated
        m_in = split(80.0, tip(), tip())
        m_root = split(80.0, m_in, tip(), name="mammals")
        stem = split(80.0, m_root, tip(), name="stem")
        top = split(90.0, stem, tip(), src=S_UPHAM)
        equal_dates(top, {}, skip=m_root)
        self.assertEqual((m_in.age, m_root.age, round(stem.age, 6)), (80.0, 80.0, 85.0))

    def test_mbl(self):
        # the minimum branch length: each split pushed older just past its daughter's tie, rootward; fixed ones never
        dino = split(245.0, tip(), tip(), name="Dinosauria")
        dfm = split(245.0, dino, tip())
        ave = split(245.0, dfm, tip())
        arch = split(251.0, ave, tip(), src=S_UPHAM)
        log = {}
        mbl_dates(arch, log)
        self.assertEqual(dino.age, 245.0)
        self.assertTrue(arch.age > ave.age > dfm.age > dino.age)
        self.assertTrue(not tied(dfm.age, dino.age) and not tied(ave.age, dfm.age) and not tied(arch.age, ave.age))
        # (moved just enough: each branch MBL of its age, the shortest the page's layout needs, no more)
        self.assertAlmostEqual(dfm.age, 245.0 * (1 + dated.MBL), delta=1e-3)
        self.assertAlmostEqual(ave.age, 245.0 * (1 + dated.MBL) ** 2, delta=1e-3)
        self.assertEqual((arch.age, log["zero_length"]["moved_younger"], log["zero_length"]["not_below_parent"]),
                         (251.0, 0, 0))
        # under a fixed split with no room (0.1 Ma above at 318.7 Ma): nothing moves, never past the fixed split
        a = split(318.7, tip(), tip())
        b = split(318.7, a, tip())
        top = split(318.8, b, tip(), src=S_UPHAM)
        mbl_dates(top, {})
        self.assertEqual((top.age, b.age, a.age), (318.8, 318.7, 318.7))
        # with room above: pushed just past its daughter's tie, below the fixed split's
        top.age = 330.0
        mbl_dates(top, {})
        self.assertTrue(330.0 > b.age > 318.7 and not tied(b.age, a.age) and not tied(top.age, b.age))

    def test_mbl_chain_under_a_fixed_split(self):
        # a chain with too little room below a fixed split: pushed only as far as it fits, never past a split above it
        a = split(300.0, tip(), tip())
        b = split(300.0, a, tip())
        c = split(300.0, b, tip())
        top = split(300.5, c, tip(), src=S_UPHAM)
        mbl_dates(top, {})
        self.assertTrue(top.age > c.age >= b.age >= a.age == 300.0, (c.age, b.age))
        # room for a tie's width a branch but not MBL (1.5 Ma at 300 Ma): packed at the data's precision, none left tied
        top.age = 301.5
        mbl_dates(top, {})
        self.assertTrue(not tied(top.age, c.age) and not tied(c.age, b.age) and not tied(b.age, a.age), (c.age, b.age))
        self.assertTrue(c.age - b.age < 300.0 * dated.MBL)

    def test_method_switch(self):
        a = split(245.0, tip(), tip())
        b = split(245.0, a, tip())
        top = split(251.0, b, tip(), src=S_UPHAM)
        log = {}
        dated.zero_length(top, log)
        self.assertEqual((log["zero_length"]["method"], log["zero_length"]["fossil_splits_at_one_date"]),
                         (dated.ZERO_LENGTH, 0))

    def test_tied(self):
        self.assertTrue(tied(245.23, 245.23))
        self.assertTrue(tied(245.2301, 245.23))
        self.assertFalse(tied(245.23, 245.2301))  # (a daughter older than its parent is no tie: the clamp's)
        self.assertFalse(tied(246.0, 245.0))


def dated_all(d: Path) -> tuple[list, dict, list]:
    sk = json.loads((d / "dated" / "skeleton.json").read_text())
    return sk["all"]["nodes"], sk["all"]["names"], sk["sources"]


class Output:
    """Both builds' dated tree: every split below its parent; no two nested fossil-dated splits at one date (the
    page's four significant digits, web/src/fan/splits.ts r3), but for the few with no time to share."""
    D: Path
    key: str
    LEFT: int  # the nested fossil-dated splits still at one date (stats: tied_left), at most

    @classmethod
    def setUpClass(cls):
        cls.nodes, cls.names, cls.src = dated_all(cls.D)
        s = json.loads((cls.D / "stats.json").read_text())
        cls.eq = s["dated_tree"]["zero_length"] if cls.key == "dated_tree" else s["amniotes"]["fossils"]["zero_length"]

    def test_below_parent(self):
        N = self.nodes
        bad = [(self.names.get(str(i)), n[1], N[n[0]][1]) for i, n in enumerate(N)
               if len(n) == 5 and n[0] >= 0 and not N[n[0]][1] >= n[1]]
        self.assertEqual(bad, [])
        self.assertEqual(self.eq["not_below_parent"], 0)

    def test_never_younger(self):
        self.assertEqual(self.eq["moved_younger"], 0)

    def test_no_nested_fossil_splits_at_one_date(self):
        r3 = lambda x: float(f"{x:.4g}")  # noqa: E731
        N = self.nodes
        same = [(self.names.get(str(i), ""), n[1]) for i, n in enumerate(N)
                if len(n) == 5 and n[0] >= 0 and self.src[n[4]] not in FIXED and self.src[N[n[0]][4]] not in FIXED
                and r3(n[1]) >= r3(N[n[0]][1])]
        self.assertLessEqual(len(same), self.LEFT, same[:20])


@unittest.skipUnless((MAM / "stats.json").exists(), "no mammal build (make build)")
class TestMammals(Output, unittest.TestCase):
    D, key, LEFT = MAM, "dated_tree", 0


@unittest.skipUnless((AMN / "stats.json").exists(), "no amniote build (make build-amniotes)")
class TestAmniotes(Output, unittest.TestCase):
    D, key, LEFT = AMN, "amniotes", 6  # (the oldest amniote fossils, 318.7 Ma, 0.1 Ma under Amniota's cited 318.8: no room)


if __name__ == "__main__":
    unittest.main()
