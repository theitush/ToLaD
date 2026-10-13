"""The globe's range cells (ToLaD#267): the packing, and a few ranges as the sidecar has them."""
import bisect
import json
import unittest
from pathlib import Path

import numpy as np

from tolad_pipeline import globe

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


if __name__ == "__main__":
    unittest.main()
