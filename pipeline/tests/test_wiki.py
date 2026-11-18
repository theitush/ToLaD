"""The Wikipedia/Commons sidecar step (ToLaD#182)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tolad_pipeline import wiki

ROOT = Path(__file__).resolve().parents[2]
MAMMALS = ROOT / "data" / "mammals"
AMNIOTES = ROOT / "data" / "amniotes"


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


class Fallbacks(unittest.TestCase):
    Q = "http://www.wikidata.org/entity/"
    SP = Q + "Q7432"
    NOWHERE = Path("/nonexistent")

    def snap(self, **kw):
        return {"names": [], "ott": [], "synonyms": [], "linked": [], **kw}

    def test_alias_finds_the_domestic_form(self):
        # Wikidata keeps the dog as Canis lupus familiaris; "Canis familiaris" is only an alias of its item.
        alias = [["Canis familiaris", self.Q + "Q144", self.SP, "Canis", "https://en.wikipedia.org/wiki/Dog", "", ""]]
        out = wiki.resolve({"Canis familiaris": 0}, self.snap(alias=alias), self.NOWHERE)
        self.assertEqual(out["Canis familiaris"], {"wp": "https://en.wikipedia.org/wiki/Dog"})

    def test_article_lead_image_fills_a_missing_picture(self):
        art = "https://en.wikipedia.org/wiki/Dog"
        names = [["Canis x", self.Q + "Q1", self.SP, "Canis", art, "", ""]]
        out = wiki.resolve({"Canis x": 0}, self.snap(names=names, pageimg={art: "A dog.jpg"}), self.NOWHERE)
        self.assertEqual(out["Canis x"]["img"], wiki.thumb_url("A dog.jpg"))
        # a Wikidata picture wins over the article's
        names[0][5] = "http://commons.wikimedia.org/wiki/Special:FilePath/W.jpg"
        out = wiki.resolve({"Canis x": 0}, self.snap(names=names, pageimg={art: "A dog.jpg"}), self.NOWHERE)
        self.assertEqual(out["Canis x"]["img"], wiki.thumb_url("W.jpg"))


class InfoboxImage(unittest.TestCase):
    def test_takes_the_image_field_only(self):
        t = "{{Speciesbox\n| name = X\n| image = X_x.jpg\n| image_caption = c\n| range_map = X_map.svg\n}}"
        self.assertEqual(wiki.infobox_image(t), "X x.jpg")

    def test_forms_of_the_value(self):
        for v in ("File:A b.png", "[[File:A b.png|thumb]]", "A_b.png"):
            self.assertEqual(wiki.infobox_image("{{Automatic taxobox\n|image=%s\n}}" % v), "A b.png")

    def test_a_template_of_pictures(self):
        t = ("{{Speciesbox\n| image = <!-- no change -->\n {{multiple image\n | border = infobox\n"
             " | image1 = Blue merle.jpg\n | image2 = B.JPG\n }}\n| status = DOM\n| range_map = M.svg\n}}")
        self.assertEqual(wiki.infobox_image(t), "Blue merle.jpg")

    def test_no_image_field_is_no_picture(self):
        self.assertIsNone(wiki.infobox_image("{{Speciesbox\n| image =\n| range_map = M.svg\n| image2 = Z.jpg\n}}"))
        self.assertIsNone(wiki.infobox_image("{{Speciesbox\n| range_map = M.svg\n}}"))
        self.assertIsNone(wiki.infobox_image("no box here\n| image = A.jpg"))


class KeptBatches(unittest.TestCase):
    """A run cut off resumes: a rerun asks only for the keys no kept batch has (ToLaD#539)."""

    def test_rerun_asks_only_the_rest(self):
        asked: list[list[str]] = []

        def sparql(q):
            keys = [k for k in ("A a", "B b", "C c") if f'"{k}"' in q]
            asked.append(keys)
            return [[k, "http://www.wikidata.org/entity/Q1", "", "", "", "", ""] for k in keys]

        with tempfile.TemporaryDirectory() as d, mock.patch.object(wiki, "BATCHES", Path(d) / "x.batches.jsonl"), \
                mock.patch.object(wiki, "BATCH", 2), mock.patch.object(wiki, "PAUSE_S", 0), \
                mock.patch.object(wiki, "_sparql", sparql):
            wiki._remember("P225", ["A a", "B b"], sparql('"A a" "B b"'))
            asked.clear()
            rows = wiki.query_all("P225", ["A a", "B b", "C c"])
            self.assertEqual(asked, [["C c"]])
            self.assertEqual(sorted(r[0] for r in rows), ["A a", "B b", "C c"])
            self.assertEqual(wiki._recall("P9157", ["A a"]), (set(), []))  # another step's batches are its own


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


@unittest.skipUnless((AMNIOTES / "wiki.json").exists(), "no data/amniotes/wiki.json (run make wiki-amniotes)")
class AmnioteSidecar(unittest.TestCase):
    def test_every_species_row_and_the_mammals_as_they_are(self):
        side = json.loads((AMNIOTES / "wiki.json").read_text(encoding="utf-8"))
        self.assertEqual(set(side), set(wiki.species_rows(AMNIOTES)))
        def lines(d: Path) -> set[str]:
            return {ln.rstrip(",") for ln in (d / "wiki.json").read_text(encoding="utf-8").splitlines()[1:-1]}
        self.assertLessEqual(lines(MAMMALS), lines(AMNIOTES))  # every mammal's line, byte for byte
        self.assertIn("upload.wikimedia.org", (side["Passer domesticus"] or {}).get("img", ""))


if __name__ == "__main__":
    unittest.main()
