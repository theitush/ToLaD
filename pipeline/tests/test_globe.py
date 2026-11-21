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
        d = json.loads(SIDECAR.read_text())
        cls.r, cls.before = d["ranges"], d["before_1500"]
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
        # ToLaD#507: less North America, which the evidence dates to the Late Pleistocene (lossdates.PREHISTORIC):
        # listed apart, so the grey is the range the tree draws as lost since 1500
        before = {(int(i), int(j)) for i, j in np.argwhere(globe.unpack(self.before["Cuon alpinus"]))}
        self.assertGreater(len(before), 2000)
        self.assertEqual(self.cells("Cuon alpinus", 1), set(d["nat"]) - before)
        self.assertLessEqual(before, set(d["nat"]) - set(d["cur"]))
        self.assertGreater(len(set(d["nat"]) - before - set(d["cur"])), 1000)  # the rest still drawn lost
        self.assertTrue(all(j < 130 for _, j in before))       # all west of 50 W: the Americas
        self.assertEqual(self.r["Mammuthus primigenius"][0], [])
        self.assertNotIn("Alces alces", self.before)           # the moose: only a bound, no cells dated


class ReptileCells(unittest.TestCase):
    """ToLaD#601: GARD's polygons on the mammals' grid, by PHYLACINE's rule (a cell counts when any part of it overlaps
    the polygon: an edge only touched is not in it)."""

    @classmethod
    def setUpClass(cls):
        cls.lat = globe.geodetic_row_edges()

    def row(self, lat: float) -> int:
        return int(np.flatnonzero((self.lat[:-1] > lat) & (self.lat[1:] <= lat))[0])

    def test_edges(self):
        lat = self.lat
        self.assertEqual(len(lat), globe.ROWS + 1)
        self.assertEqual(lat[0], 90.0)
        self.assertTrue(all(a > b for a, b in zip(lat, lat[1:])))
        # the geodetic latitudes; the page's (row_edges, asin(y / Y_TOP)) are within 0.25 deg of them (a fraction of a
        # cell) south of 75 N (0.34 deg at the top row's edge)
        off = np.abs(lat - np.array(globe.row_edges()))
        self.assertLess(off[lat < 75].max(), 0.25)
        self.assertLess(off.max(), 0.35)

    def test_a_cell_counts_when_any_part_of_it_overlaps(self):
        import shapely
        r = self.row(10.5)
        # a speck inside one cell: that cell
        self.assertEqual(globe.polygon_cells(shapely.box(10.2, 10.4, 10.3, 10.5), self.lat).tolist(), [r * 360 + 190])
        # a polygon reaching just over a column's edge takes the next cell too
        self.assertEqual(globe.polygon_cells(shapely.box(10.2, 10.4, 11.01, 10.5), self.lat).tolist(),
                         [r * 360 + 190, r * 360 + 191])
        # one that stops exactly on the meridian 11 E only touches the cell beyond it: not in it
        self.assertEqual(globe.polygon_cells(shapely.box(10.2, 10.4, 11.0, 10.5), self.lat).tolist(), [r * 360 + 190])
        # two polygons of one map: both their cells, once each
        two = shapely.MultiPolygon([shapely.box(10.2, 10.4, 10.3, 10.5), shapely.box(10.6, 10.4, 10.7, 10.5)])
        self.assertEqual(globe.polygon_cells(two, self.lat).tolist(), [r * 360 + 190])

    def test_an_invalid_ring_is_made_valid(self):
        import shapely
        # a bow tie (a ring crossing itself), as GARD has some: its two halves' cells
        bow = shapely.Polygon([(10.2, 10.1), (12.5, 10.6), (12.5, 10.1), (10.2, 10.6)])
        self.assertFalse(bow.is_valid)
        r = self.row(10.5)
        self.assertEqual(globe.polygon_cells(bow, self.lat).tolist(), [r * 360 + c for c in (190, 191, 192)])

    def test_names(self):
        ours = {"Aspidoscelis cozumela", "Ramphotyphlops affinis", "Hebius monticola", "Lycodon septentrionalis",
                "Oligodon septentrionalis",
                "Scincella capitanea", "Novus speciesus", "Crocodylus niloticus", "Ptychoglossus plicatus"}
        gard = {"Aspidoscelis cozumelus", "Anilios affinis", "Amphiesma monticola", "Dinodon septentrionalis",
                "Asymblepharus capitaneus", "Crocodylus niloticus", "Ptychoglossus plicatus", "Alopoglossus plicatus",
                "Geochelone gigantea"}
        m, how = globe.gard_match(
            ours | {"Dinodon c"}, gard, {"Ramphotyphlops affinis": "Anilios affinis"},
            {"Hebius monticola": {"Amphiesma monticola"}, "Lycodon septentrionalis": {"Dinodon septentrionalis"},
             "Oligodon septentrionalis": {"Dinodon septentrionalis"},
             "Ptychoglossus plicatus": {"Alopoglossus plicatus"}},
            {"Scincella capitanea": {"Asymblepharus capitaneus"}})
        self.assertEqual(m, {"Aspidoscelis cozumela": "Aspidoscelis cozumelus",      # a Latin ending
                             "Ramphotyphlops affinis": "Anilios affinis",            # the RDB's former genus
                             "Hebius monticola": "Amphiesma monticola",              # Open Tree's synonym
                             "Scincella capitanea": "Asymblepharus capitaneus",      # the Red List's synonym
                             "Crocodylus niloticus": "Crocodylus niloticus",
                             "Ptychoglossus plicatus": "Ptychoglossus plicatus"})    # its own name first
        # "Dinodon septentrionalis" is a synonym of two of ours (a lump): neither; another epithet is never the same
        # species
        self.assertEqual((how["Lycodon septentrionalis"], how["Oligodon septentrionalis"]), ("lump", "lump"))
        self.assertNotIn("Dinodon c", m)


REPTILES = ROOT / "data" / "amniotes" / "ranges.json"


@unittest.skipUnless(REPTILES.exists() and SIDECAR.exists(), "no data/amniotes/ranges.json (make globe-amniotes)")
class KnownReptileRanges(unittest.TestCase):
    """ToLaD#601: the reptiles' globe, today's range only (GARD 1.7)."""

    @classmethod
    def setUpClass(cls):
        d = json.loads(REPTILES.read_text())
        cls.grid, cls.r = d["grid"], d["ranges"]
        cls.lat = cls.grid["lat"]

    def at(self, sci: str, lat: float, lon: float, pad: int = 0) -> bool:
        m = globe.unpack(self.r[sci][0])
        row = bisect.bisect_left([-x for x in self.lat], -lat) - 1
        col = int(lon + 180)
        return bool(m[max(0, row - pad):row + pad + 1, max(0, col - pad):col + pad + 1].any())

    def test_the_mammals_grid_and_today_only(self):
        self.assertEqual(self.grid, json.loads(SIDECAR.read_text())["grid"])
        self.assertGreater(len(self.r), 10000)
        self.assertTrue(all(len(v) == 1 and v[0] for v in self.r.values()))  # [current], never empty

    def test_known_ranges(self):
        self.assertTrue(self.at("Crocodylus niloticus", 0.0, 32.0, pad=1))      # Lake Victoria
        self.assertFalse(self.at("Crocodylus niloticus", 10.0, -60.0, pad=5))   # not in the Americas
        self.assertTrue(self.at("Varanus komodoensis", -8.6, 119.5, pad=1))     # Komodo
        self.assertLessEqual(sum(self.r["Varanus komodoensis"][0][1::2]), 6)
        self.assertTrue(self.at("Aldabrachelys gigantea", -9.4, 46.4, pad=1))   # Aldabra
        self.assertTrue(self.at("Sphenodon punctatus", -41.0, 174.0, pad=2))    # New Zealand's islands
        self.assertNotIn("Lepidochelys olivacea", self.r)                       # GARD maps no sea turtle


if __name__ == "__main__":
    unittest.main()
