"""The PhyloPic outline step (ToLaD#577): the lineage rule on a small tree, and the built sidecars."""
import json
import unittest
from pathlib import Path

from tolad_pipeline import phylopic

ROOT = Path(__file__).resolve().parents[2]
NO_RAW = Path("/nonexistent")


def _img(uuid, nodes, by="Ann Artist"):
    return [uuid, "Up Loader", by, "https://creativecommons.org/licenses/by/4.0/",
            f"https://images.phylopic.org/images/{uuid}/thumbnail/192x192.png",
            f"https://images.phylopic.org/images/{uuid}/raster/512x300.png", nodes]


def _node(uuid, name, ott=(), pbdb=(), primary=""):
    return [uuid, [name], list(ott), list(pbdb), primary]


# The tree, in preorder:
#   0 Amniota
#     1 Felidae
#       2 (unnamed)
#         3 Felis silvestris (OTT 100)       its own image, found by OTT id past a homonym name
#         4 Felis catus (OTT 101)            nothing: its congener's image, for its genus
#       5 Panthera (a named genus)
#         6 Panthera leo                     nothing: Felidae's own image, PhyloPic's pick for the family
#     7 Squamata
#       8 Varanidae
#         9 Varanus komodoensis              nothing: its congener's image (found by PBDB number)
#         10 Varanus priscus (PBDB 77)
#       11 Iguanidae
#         12 Iguana iguana                   a photo: no outline, though PhyloPic has one
#         13 Iguana delicatissima            its own image, found by name
#       14 Anolis carolinensis               nothing of its own or its genus's: the pictured species nearest under Squamata
#     15 Testudines
#       16 Chelonia mydas                    nothing anywhere under Testudines: Amniota's image
PARENT = [-1, 0, 1, 2, 2, 1, 5, 0, 7, 8, 8, 7, 11, 11, 7, 0, 15]
SPECIES = {3: ("Felis silvestris", 100, 0), 4: ("Felis catus", 101, 0), 6: ("Panthera leo", 0, 0),
           9: ("Varanus komodoensis", 0, 0), 10: ("Varanus priscus", 0, 77), 12: ("Iguana iguana", 0, 0),
           13: ("Iguana delicatissima", 0, 0), 14: ("Anolis carolinensis", 0, 0), 16: ("Chelonia mydas", 0, 0)}
NAMES = {0: "Amniota", 1: "Felidae", 5: "Panthera", 7: "Squamata", 8: "Varanidae", 11: "Iguanidae",
         15: "Testudines"}
AMNIOTA = _node("n-amniota", "Amniota", primary="i-amniota")
SNAP = {
    "image_cols": ["uuid", "contributor", "attribution", "license", "thumbnail", "raster", "nodes"],
    "images": [
        _img("i-fsil", [_node("n-fsil", "Felis silvestris", ott=[100], primary="i-fsil"), AMNIOTA]),
        # A second node by the same name: the name alone matches neither, the OTT id finds the first.
        _img("i-homonym", [_node("n-fsil2", "Felis silvestris", primary="i-homonym")]),
        _img("i-lynx", [_node("n-lynx", "Lynx lynx", primary="i-lynx"),
                        _node("n-felidae", "Felidae", primary="i-lynx")]),
        _img("i-vpri", [_node("n-vpri", "Varanus priscus", pbdb=[77], primary="i-vpri")]),
        _img("i-iigu", [_node("n-iigu", "Iguana iguana", primary="i-iigu")]),
        _img("i-idel", [_node("n-idel", "Iguana delicatissima", primary="i-idel")]),
        _img("i-amniota", [_node("n-arch", "Archaeovenator hamiltonensis", primary="i-amniota"), AMNIOTA]),
    ],
}
WIKI = {"Iguana iguana": {"img": "https://upload.wikimedia.org/x.jpg"}, "Felis catus": {"wp": "https://en.wikipedia.org/wiki/Cat"}}


class Rule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        taxa = phylopic.Taxa(NO_RAW)
        cls.out = phylopic.outlines(phylopic.Tree(PARENT, SPECIES, NAMES, taxa), WIKI, phylopic.PhyloPic(SNAP), taxa)

    def got(self, sp):
        o = self.out[sp]
        return o["image"], o["taxon"], o["rank"], o["shows"]

    def test_own_image_by_ott_id_past_a_homonym(self):
        self.assertEqual(self.got("Felis silvestris"), ("i-fsil", "Felis silvestris", "species", "Felis silvestris"))

    def test_own_image_by_name(self):
        self.assertEqual(self.got("Iguana delicatissima")[:3], ("i-idel", "Iguana delicatissima", "species"))

    def test_congener_for_its_genus(self):
        self.assertEqual(self.got("Felis catus"), ("i-fsil", "Felis", "genus", "Felis silvestris"))
        # The congener's node is found by its PBDB taxon number.
        self.assertEqual(self.got("Varanus komodoensis"), ("i-vpri", "Varanus", "genus", "Varanus priscus"))

    def test_a_group_with_its_own_image_shows_phylopics_pick(self):
        # Panthera has none; Felidae's own image (a lynx) over its nearer pictured species (Felis silvestris).
        self.assertEqual(self.got("Panthera leo"), ("i-lynx", "Felidae", "family", "Lynx lynx"))

    def test_nearest_pictured_relative_for_the_nearest_named_group(self):
        # Squamata has no image of its own: the pictured species nearest under it (depth 2: Iguana delicatissima,
        # before Varanus priscus by name; Iguana iguana's photo does not take its outline from its relatives).
        self.assertEqual(self.got("Anolis carolinensis"), ("i-idel", "Squamata", "clade", "Iguana delicatissima"))

    def test_up_to_the_root(self):
        self.assertEqual(self.got("Chelonia mydas")[:3], ("i-amniota", "Amniota", "clade"))

    def test_the_photo_wins(self):
        self.assertNotIn("Iguana iguana", self.out)
        self.assertEqual(len(self.out), 8)

    def test_credit(self):
        o = self.out["Felis catus"]
        self.assertEqual((o["attribution"], o["license"], o["licenseUrl"]),
                         ("Ann Artist", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"))
        self.assertTrue(o["img"].endswith("/i-fsil/thumbnail/192x192.png"))

    def test_the_sidecar_holds_each_image_once(self):
        sc = phylopic.sidecar(self.out)
        self.assertEqual(sc["species"]["Felis catus"], ["i-fsil", "Felis", "genus", "Felis silvestris"])
        self.assertEqual(sc["images"]["i-fsil"], {"r": "512x300", "a": "Ann Artist", "c": "Up Loader", "l": "CC BY 4.0",
                                                  "u": "https://creativecommons.org/licenses/by/4.0/"})
        self.assertEqual(set(sc["images"]), {"i-fsil", "i-lynx", "i-vpri", "i-idel", "i-amniota"})  # (not i-iigu: a photo)


class Ranks(unittest.TestCase):
    def test_suffix_ranks(self):
        taxa = phylopic.Taxa(NO_RAW)
        self.assertEqual(taxa.rank("Felidae"), "family")
        self.assertEqual(taxa.rank("Varanoidea"), "superfamily")
        self.assertEqual(taxa.rank("Hominini", in_family=True), "tribe")
        # Above any family, -ini is no tribe's (Haplorhini, a suborder).
        self.assertEqual(taxa.rank("Haplorhini", in_family=False), "clade")
        self.assertEqual(taxa.rank("Sauropodomorpha"), "clade")

    def test_licence_names(self):
        self.assertEqual(phylopic.license_name("https://creativecommons.org/licenses/by-sa/3.0/"), "CC BY-SA 3.0")
        self.assertEqual(phylopic.license_name("https://creativecommons.org/publicdomain/zero/1.0/"), "CC0 1.0")
        self.assertEqual(phylopic.license_name("https://creativecommons.org/publicdomain/mark/1.0/"),
                         "Public Domain Mark 1.0")


class Built(unittest.TestCase):
    """The sidecars as `make phylopic` / `make phylopic-amniotes` wrote them."""

    def check(self, tree):
        d = ROOT / "data" / tree
        if not (d / "phylopic.json").exists():
            self.skipTest(f"no data/{tree}/phylopic.json")
        sc = json.loads((d / "phylopic.json").read_text(encoding="utf-8"))
        wiki = json.loads((d / "wiki.json").read_text(encoding="utf-8"))
        images, out = sc["images"], sc["species"]
        self.assertGreater(len(out), 1000)
        for sp, (img, group, rank, _shows) in out.items():
            self.assertFalse((wiki.get(sp) or {}).get("img"), sp)  # the photo always wins
            self.assertIn(img, images, sp)
            self.assertTrue(group and rank, sp)
        for img, i in images.items():
            self.assertRegex(i["r"], r"^\d+x\d+$", img)
            self.assertTrue(i["l"] and i["u"].startswith("https://creativecommons.org/"), img)
        self.assertEqual(set(images), {v[0] for v in out.values()})  # each image once, every one used
        return {sp: dict(zip(("image", "taxon", "rank", "shows"), v)) for sp, v in out.items()}

    def test_mammals(self):
        self.check("mammals")

    def test_amniotes(self):
        out = self.check("amniotes")
        # A sauropodomorph with no photo that PhyloPic has no image of, outlined by a group of its own lineage; Aardonyx
        # has a photo (Wikipedia's), so no outline.
        o = out["Blikanasaurus cromptoni"]
        self.assertIn(o["taxon"], {"Blikanasaurus", "Sauropodiformes", "Massopoda", "Sauropodomorpha"})
        self.assertNotIn("Aardonyx celestae", out)


if __name__ == "__main__":
    unittest.main()
