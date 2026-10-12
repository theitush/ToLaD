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
        q, article, img = wiki._pick(rows, "Felis")
        self.assertTrue(q.endswith("Q9"))
        self.assertEqual(wiki.entry([q, article, img]), {
            "img": wiki.thumb_url("C.jpg"),
            "file": "https://commons.wikimedia.org/wiki/File:C.jpg",
        })

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
        for v in side.values():
            if v is not None:
                self.assertTrue(set(v) <= {"wp", "img", "file"} and v)
                self.assertEqual("img" in v, "file" in v)


if __name__ == "__main__":
    unittest.main()
