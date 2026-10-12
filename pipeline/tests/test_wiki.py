"""The Wikipedia/Commons sidecar step (ToLaD#182)."""
import json
import unittest
from pathlib import Path

from tolad_pipeline import wiki

ROOT = Path(__file__).resolve().parents[2]
MAMMALS = ROOT / "data" / "mammals"


class ThumbUrl(unittest.TestCase):
    def test_hashed_path(self):
        # The path upload.wikimedia.org serves (checked by hand, 2026-10-12).
        self.assertEqual(
            wiki.thumb_url("Lion waiting in Namibia.jpg"),
            "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Lion_waiting_in_Namibia.jpg/"
            "330px-Lion_waiting_in_Namibia.jpg")

    def test_svg_and_tiff_render_to_raster(self):
        self.assertTrue(wiki.thumb_url("A b.svg").endswith("/330px-A_b.svg.png"))
        self.assertTrue(wiki.thumb_url("A.tif").endswith("/lossy-page1-330px-A.tif.jpg"))
        self.assertIsNone(wiki.thumb_url("A.pdf"))


class Pick(unittest.TestCase):
    SP = "http://www.wikidata.org/entity/Q7432"
    GENUS = "http://www.wikidata.org/entity/Q34740"

    def test_prefers_the_species_in_its_genus(self):
        rows = [
            ["Felis x", "http://www.wikidata.org/entity/Q5", self.SP, "Planta", "https://en.wikipedia.org/wiki/P", ""],
            ["Felis x", "http://www.wikidata.org/entity/Q9", self.SP, "Felis", "", "http://commons.wikimedia.org/wiki/Special:FilePath/C.jpg"],
            ["Felis x", "http://www.wikidata.org/entity/Q2", self.GENUS, "Felidae", "https://en.wikipedia.org/wiki/G", ""],
        ]
        q, article, img, rng = wiki._pick(rows, "Felis")
        self.assertTrue(q.endswith("Q9"))
        self.assertEqual(rng, "")
        self.assertEqual(wiki.entry([q, article, img, rng]), {
            "img": wiki.thumb_url("C.jpg"),
            "file": "https://commons.wikimedia.org/wiki/File:C.jpg",
        })

    def test_range_map(self):
        # P181 (ToLaD#196): a 500 px thumbnail (SVGs come back as PNG) and its Commons page.
        fp = "http://commons.wikimedia.org/wiki/Special:FilePath/"
        rows = [
            ["Felis x", "http://www.wikidata.org/entity/Q9", self.SP, "Felis", "", fp + "C.jpg", fp + "Felis%20x%20range.svg"],
            ["Felis x", "http://www.wikidata.org/entity/Q9", self.SP, "Felis", "", fp + "C.jpg", fp + "A%20older%20map.png"],
        ]
        hit = wiki._pick(rows, "Felis")
        e = wiki.entry(hit)
        # Several values: the first in sorted order.
        self.assertEqual(e["range"], "https://upload.wikimedia.org/wikipedia/commons/thumb/"
                         + wiki.thumb_url("A older map.png", 500).split("/thumb/", 1)[1])
        self.assertEqual(e["rangeFile"], "https://commons.wikimedia.org/wiki/File:A_older_map.png")
        self.assertTrue(e["range"].endswith("/500px-A_older_map.png"))
        e = wiki.entry(wiki._pick(rows[:1], "Felis"))
        self.assertEqual(e["range"], wiki.thumb_url("Felis x range.svg", 500))
        self.assertTrue(e["range"].endswith("/500px-Felis_x_range.svg.png"))
        self.assertEqual(e["rangeFile"], "https://commons.wikimedia.org/wiki/File:Felis_x_range.svg")
        self.assertEqual(e["img"], wiki.thumb_url("C.jpg"))  # the photo is unchanged

    def test_no_range_map_no_key(self):
        fp = "http://commons.wikimedia.org/wiki/Special:FilePath/"
        rows = [["Felis x", "http://www.wikidata.org/entity/Q9", self.SP, "Felis", "https://en.wikipedia.org/wiki/F", fp + "C.jpg", ""]]
        e = wiki.entry(wiki._pick(rows, "Felis"))
        self.assertNotIn("range", e)
        self.assertNotIn("rangeFile", e)
        self.assertEqual(set(e), {"wp", "img", "file"})

    def test_nothing_is_null(self):
        self.assertIsNone(wiki._pick([], "Felis"))
        self.assertIsNone(wiki.entry(None))
        self.assertIsNone(wiki.entry(["Q1", "", ""]))


@unittest.skipUnless((MAMMALS / "wiki.json").exists(), "no data/mammals/wiki.json (run make wiki)")
class Sidecar(unittest.TestCase):
    def test_every_species_row_has_an_entry(self):
        side = json.loads((MAMMALS / "wiki.json").read_text(encoding="utf-8"))
        names = wiki.species_rows(MAMMALS)
        self.assertEqual(set(side), set(names))
        self.assertEqual(side["Panthera leo"]["wp"], "https://en.wikipedia.org/wiki/Lion")
        self.assertRegex(side["Panthera leo"]["range"], r"^https://upload\.wikimedia\.org/wikipedia/commons/thumb/.+/500px-")
        for v in side.values():
            if v is not None:
                self.assertTrue(set(v) <= {"wp", "img", "file", "range", "rangeFile"} and v)
                self.assertEqual("img" in v, "file" in v)
                self.assertEqual("range" in v, "rangeFile" in v)


if __name__ == "__main__":
    unittest.main()
