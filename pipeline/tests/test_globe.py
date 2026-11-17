"""The globe's range cells (ToLaD#267): the packing, and a few ranges as the sidecar has them."""
import bisect
import json
import unittest
from pathlib import Path

import numpy as np

from tolad_pipeline import globe, ranges

ROOT = Path(__file__).resolve().parents[2]
SIDECAR = ROOT / "data" / "mammals" / "ranges.json"


class Packing(unittest.TestCase):
    def test_round_trip(self):
        rng = np.random.default_rng(267)
        for p in (0.0, 0.01, 0.3, 0.97, 1.0):
            m = rng.random(globe.ranges.GRID_SHAPE) < p
            runs = globe.pack(m)
            self.assertTrue(np.array_equal(globe.unpack(runs), m), p)
            self.assertEqual(sum(runs[1::2]), int(m.sum()))

    def test_runs_and_edges(self):
        m = np.zeros(globe.ranges.GRID_SHAPE, dtype=bool)
        m[0, 0:3] = True       # the first cells
        m[0, 359] = True       # a row's end runs on into the next row's start
        m[1, 0] = True
        m[-1, -1] = True       # the last cell
        self.assertEqual(globe.pack(m), [0, 3, 356, 2, 360 * 142 - 1 - 361, 1])
        self.assertEqual(globe.pack(np.zeros_like(m)), [])

    def test_row_edges(self):
        lat = globe.row_edges()
        self.assertEqual(len(lat), globe.ROWS + 1)
        self.assertEqual(lat[0], 90.0)
        self.assertAlmostEqual(lat[-1], -59.9, places=1)  # the grid stops short of Antarctica
        self.assertTrue(all(a > b for a, b in zip(lat, lat[1:])))


class Borrowing(unittest.TestCase):
    """ToLaD#486: a species PHYLACINE lacks under all its names gets the range of the one it was split from."""

    def test_split_note(self):
        g = ["Loxodonta", "Elephas"]
        self.assertEqual(globe.split_note("split from L. africana, although some authorities", g), ["Loxodonta africana"])
        self.assertEqual(globe.split_note("Split from Loxodonta africana.", g), ["Loxodonta africana"])
        self.assertEqual(globe.split_note("split from africana", g), ["Loxodonta africana"])
        self.assertEqual(globe.split_note("split from L. africana and includes pumilio", g), ["Loxodonta africana"])
        self.assertEqual(globe.split_note("split from L. africana and E. maximus", g), [])   # two: not clean
        self.assertEqual(globe.split_note("split from africana and maximus", g), [])
        self.assertEqual(globe.split_note("split from L. africana; previously attributed to E. maximus", g), [])
        self.assertEqual(globe.split_note("recently described", g), [])

    def test_borrow(self):
        names = {"Loxodonta africana": 1, "Loxodonta cyclotis": 2, "Cyclopes ida": 3, "Cyclopes didactylus": 4,
                 "Novus recens": 5}
        have = {"Loxodonta africana", "Cyclopes didactylus"}
        exact = {"Loxodonta africana": "Loxodonta africana", "Cyclopes didactylus": "Cyclopes didactylus"}
        older = {
            "Loxodonta cyclotis": [("Loxodonta cyclotis", False), ("Loxodonta africana", True)],
            "Loxodonta africana": [("Elephas africanus", False)],          # an exact match keeps its own
            "Cyclopes ida": [("Cyclopes medius", True)],                  # a parent split again: its parent
            "Cyclopes medius": [("Cyclopes didactylus", True)],
            "Novus recens": [("Novus vetus", True)],                      # PHYLACINE lacks the parent too
        }
        b = globe.borrow(names, exact, older, have, {}, {})
        self.assertEqual(b, {"Loxodonta cyclotis": ("Loxodonta africana", "Loxodonta africana", True),
                             "Cyclopes ida": ("Cyclopes didactylus", "Cyclopes didactylus", True)})
        # the parent by PHYLACINE's synonymy table, and by the OTT synonyms of our row of that name
        self.assertEqual(globe.borrow({"A b": 1}, {}, {"A b": [("A c", True)]}, {"A d"}, {"A c": "A d"}, {}),
                         {"A b": ("A d", "A c", True)})
        self.assertEqual(globe.borrow({"A b": 1, "A c": 2}, {}, {"A b": [("A c", True)]}, {"A d"}, {}, {2: ["A d"]}),
                         {"A b": ("A d", "A c", True)})


@unittest.skipUnless(SIDECAR.exists(), "no data/mammals/ranges.json (make globe)")
class KnownRanges(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        d = json.loads(SIDECAR.read_text())
        cls.lat = d["grid"]["lat"]
        cls.r = d["ranges"]

    def mask(self, sci: str, kind: int) -> np.ndarray:
        return globe.unpack(self.r[sci][kind])

    def at(self, m: np.ndarray, lat: float, lon: float, pad: int = 0) -> bool:
        # rows run north to south: the row whose edges hold lat
        row = bisect.bisect_left([-x for x in self.lat], -lat) - 1
        col = int(lon + 180)
        return bool(m[max(0, row - pad):row + pad + 1, max(0, col - pad):col + pad + 1].any())

    def test_lion_africa_and_gir(self):
        cur, nat = self.mask("Panthera leo", 0), self.mask("Panthera leo", 1)
        self.assertEqual(int(cur.sum()), 496)                     # PHYLACINE's own count
        self.assertTrue(self.at(cur, -2.3, 34.8))                  # the Serengeti
        self.assertTrue(self.at(cur, 21.1, 70.8, pad=1))           # Gir forest, India
        self.assertFalse(self.at(cur, 32.0, 35.0, pad=1))          # gone from the Levant ...
        self.assertTrue(self.at(nat, 32.0, 35.0, pad=1))           # ... where it would live without people
        self.assertFalse(self.at(cur, 40.0, -100.0, pad=3))        # never in the Americas

    def test_snow_leopard(self):
        cur = self.mask("Panthera uncia", 0)
        self.assertTrue(self.at(cur, 38.0, 75.0, pad=2))           # the Pamirs
        self.assertFalse(self.at(cur, 0.0, 20.0, pad=5))           # not in Africa
        self.assertEqual(int(cur.sum()), int(self.mask("Panthera uncia", 1).sum()))

    def test_extinct_has_present_natural_only(self):
        for sci in ("Mammuthus primigenius", "Smilodon populator", "Thylacinus cynocephalus"):
            self.assertEqual(self.r[sci][0], [], sci)
            self.assertGreater(sum(self.r[sci][1][1::2]), 500, sci)

    def test_coverage(self):
        self.assertGreater(len(self.r), 5500)

    def test_split_species_borrow_the_range_before_the_split(self):
        # ToLaD#486: the forest elephant, lumped with the savanna elephant in PHYLACINE, draws its range
        self.assertEqual(len(self.r["Loxodonta africana"]), 2)                          # exact stays exact
        self.assertEqual(self.r["Loxodonta cyclotis"], self.r["Loxodonta africana"] + ["Loxodonta africana"])
        self.assertTrue(self.at(self.mask("Loxodonta cyclotis", 0), 3.0, 12.0, pad=1))  # Cameroon
        for sci in ("Cyclopes ida", "Cyclopes rufus"):                                  # one silky anteater, seven now
            self.assertEqual(self.r[sci][2], "Cyclopes didactylus", sci)
        self.assertEqual(self.r["Dasypus beniensis"][2], "Dasypus kappleri")

    def test_a_former_name_is_an_exact_match(self):
        # the root vole, Microtus oeconomus in PHYLACINE, Alexandromys now: its own range, not a split's
        self.assertEqual(len(self.r["Alexandromys oeconomus"]), 2)

    def test_holds(self):
        lion = {"cur": self.mask("Panthera leo", 0)}
        self.assertTrue(globe.holds(lion, -2.3, 34.8))                 # the Serengeti
        self.assertFalse(globe.holds(lion, 40.0, -100.0))              # never in the Americas


RAW = ROOT / "data" / "raw"


@unittest.skipUnless(SIDECAR.exists() and (RAW / ranges.ZIP_REL).exists(), "no ranges.json or PHYLACINE zip")
class CorrectedMaps(unittest.TestCase):
    """ToLaD#507: the globe draws the maps the count stands on (ranges.today_cells): no grey 'lost' range from a
    taxonomy move or a mapping fix, and no placeholder drawn as a range."""

    @classmethod
    def setUpClass(cls):
        cls.r = json.loads(SIDECAR.read_text())["ranges"]
        cls.today = ranges.today_cells(RAW)
        cls.raw = ranges.read_cells(RAW, ["Aotus zonalis", "Aotus jorgehernandezi", "Cuon alpinus",
                                          "Gerbillus agag"])

    def cells(self, sci: str, kind: int) -> set[tuple[int, int]]:
        return {(int(i), int(j)) for i, j in np.argwhere(globe.unpack(self.r[sci][kind]))}

    def test_note_species_green_is_todays_map_and_no_grey_from_the_move(self):
        drawn = [sp for sp, t in self.today.items() if t["map"] is not None and sp in self.r]
        self.assertGreaterEqual(len(drawn), 8)
        for sp in drawn:
            cur, nat = self.cells(sp, 0), self.cells(sp, 1)
            self.assertEqual(cur, set(self.today[sp]["map"]), sp)
            self.assertEqual(nat - cur, set(), sp)             # the whole difference is the move or the fix

    def test_night_monkeys_colombia_moves(self):
        z, j = self.raw["Aotus zonalis"], self.raw["Aotus jorgehernandezi"]
        given = z["cur"] - z["nat"]                            # the Colombian part, A. jorgehernandezi's now
        self.assertEqual(len(given), 22)
        self.assertEqual(self.cells("Aotus zonalis", 0) & given, set())
        self.assertLessEqual(given, self.cells("Aotus jorgehernandezi", 0))
        self.assertEqual(len(self.cells("Aotus zonalis", 0)), 20)
        self.assertEqual(len(self.cells("Aotus jorgehernandezi", 0)), 25)
        self.assertEqual(self.cells("Aotus jorgehernandezi", 1) - self.cells("Aotus jorgehernandezi", 0), set())
        self.assertLess(len(j["cur"]), 25)                     # (PHYLACINE's own current map: 1 cell)

    def test_tupaia_islands_move(self):
        pal, moe = self.cells("Tupaia palawanensis", 0), self.cells("Tupaia moellendorffi", 0)
        self.assertEqual((len(pal), len(moe)), (9, 3))
        self.assertEqual(pal & moe, set())
        self.assertLessEqual(moe, set(self.today["Tupaia palawanensis"]["cur"]))  # the islands it gave up

    def test_placeholders_draw_no_range(self):
        for sp in ("Gerbillus agag", "Gerbillus burtoni", "Makalata obscura", "Oryzomys curasoae",
                   "Rhinopoma macinnesi", "Eudorcas rufina"):
            self.assertEqual(self.r[sp], [[], []], sp)
        self.assertEqual(sorted(globe.stand_ins()), ["Eudorcas rufina", "Gerbillus agag", "Gerbillus burtoni",
                                                     "Makalata obscura", "Oryzomys curasoae", "Rhinopoma macinnesi"])
        self.assertTrue(self.raw["Gerbillus agag"]["nat"])     # PHYLACINE's stand-in, one town's cell

    def test_people_and_extinct_unchanged(self):
        d = self.raw["Cuon alpinus"]                           # the dhole: its losses are people's
        self.assertEqual(self.cells("Cuon alpinus", 0), set(d["cur"]))
        self.assertEqual(self.cells("Cuon alpinus", 1), set(d["nat"]))
        self.assertGreater(len(d["nat"] - d["cur"]), 1000)
        self.assertEqual(self.r["Mammuthus primigenius"][0], [])


if __name__ == "__main__":
    unittest.main()
