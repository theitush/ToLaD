"""Forks named from the taxonomy (ToLaD#417): the decoration's rule on small trees, and what it gave on the built data."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from tolad_pipeline import taxnames as T
from tolad_pipeline.dated import DNode

DATA = Path(__file__).resolve().parents[2] / "data" / "mammals"


def tree(spec, taxa):
    """Nested lists of species names, or (name, [...]) for a fork named already -> the root; taxa: {species: {rank: taxon}}."""

    def go(x):
        if isinstance(x, str):
            return DNode(leaf=SimpleNamespace(name=x, taxa=taxa.get(x)))
        d = DNode(name=x[0] if isinstance(x, tuple) else None)
        for c in x[1] if isinstance(x, tuple) else x:
            d.add(go(c))
        return d

    return go(spec)


def run(root, locked=(), genera=(), **kw):
    return T.decorate(root, lambda L: L.taxa, set(locked), set(genera), **kw)


def names(root):
    return {d.name: sorted(x.leaf.name for x in d.preorder() if x.leaf is not None)
            for d in root.preorder() if d.leaf is None and d.name}


def fam(f, **kw):
    return {"family": f, **kw}


class Rule(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(T.clean("Pteropus (genus in Holozoa)"), "Pteropus")
        self.assertEqual(T.clean("Lophostoma (genus in Opisthokonta)"), "Lophostoma")
        self.assertEqual(T.clean("Hipposideros larvatus sensu lato"), "Hipposideros larvatus")
        self.assertEqual(T.clean("Felidae (crown)"), "Felidae")
        self.assertEqual(T.clean("Homo"), "Homo")

    def test_a_stray_does_not_lose_a_family_its_name(self):
        taxa = {x: fam("Aidae") for x in "abcde"} | {"f": fam("Bidae"), "g": fam("Bidae")} | {x: fam("Cidae") for x in "pqrs"}
        root = tree([[["a", "b"], ["c", "d"], "f"], ["e", "g"], ["p", "q", "r", "s"]], taxa)
        run(root)
        self.assertEqual(names(root)["Aidae"], ["a", "b", "c", "d", "f"])  # F 0.8, one of Bidae's in it, its "e" out

    def test_a_poor_fork_gets_no_name(self):
        taxa = {x: fam("Aidae") for x in "ab"} | {x: fam("Bidae") for x in "cdef"}
        root = tree([["a", "c"], ["b", "d"], ["e", "f"]], taxa)
        rep = run(root)
        self.assertNotIn("Aidae", names(root))
        self.assertIn("family Aidae", rep["not_placed"])

    def test_a_name_stands_on_one_fork_and_moves_to_its_best(self):
        taxa = {x: fam("Aidae") for x in "abc"} | {"d": fam("Bidae"), "e": fam("Bidae")}
        root = tree([[("Aidae", ["a", "b"]), "c"], ["d", "e"]], taxa)
        run(root)
        self.assertEqual(names(root)["Aidae"], ["a", "b", "c"])
        self.assertEqual(sum(1 for d in root.preorder() if d.name == "Aidae"), 1)

    def test_fossils_do_not_count(self):
        taxa = {x: fam("Aidae") for x in "ab"} | {x: fam("Bidae") for x in "cd"}  # "x", "y": fossils, not on the list
        root = tree([[["a", "x"], ["b", "y"]], ["c", "d"]], taxa)
        run(root)
        self.assertEqual(names(root)["Aidae"], ["a", "b", "x", "y"])

    def test_the_crown_of_several_with_the_same_living_species(self):
        taxa = {x: fam("Aidae") for x in "ab"} | {x: fam("Bidae") for x in "cd"}
        root = tree([[["a", "b"], "x"], ["c", "d"]], taxa)  # a stem with fossil x over the crown (a, b)
        run(root)
        self.assertEqual(names(root)["Aidae"], ["a", "b"])

    def test_where_it_stands_wins_a_tie(self):
        taxa = {x: fam("Aidae") for x in "ab"} | {x: fam("Bidae") for x in "cd"}
        root = tree([("Aidae", [["a", "b"], "x"]), ["c", "d"]], taxa)
        run(root)
        self.assertEqual(names(root)["Aidae"], ["a", "b", "x"])

    def test_family_holds_a_fork_against_its_one_subfamily_and_genus(self):
        taxa = {x: fam("Aidae", subfamily="Ainae") for x in "ab"} | {x: fam("Bidae") for x in "cd"}
        root = tree([("Aus", ["a", "b"]), ["c", "d"]], taxa)
        rep = run(root, genera={"Aus"})
        self.assertEqual(names(root)["Aidae"], ["a", "b"])
        self.assertNotIn("Aus", names(root))
        self.assertEqual(rep["not_placed"]["subfamily Ainae"]["named_as"], "Aidae")

    def test_genus_holds_a_fork_against_its_tribe(self):
        taxa = {x: fam("Aidae", tribe="Aini") for x in "ab"} | {x: fam("Aidae", tribe="Bini") for x in "cd"}
        root = tree([("Aus", ["a", "b"]), ["c", "d"]], taxa)
        rep = run(root, genera={"Aus"})
        self.assertEqual(names(root)["Aus"], ["a", "b"])
        self.assertEqual(rep["not_placed"]["tribe Aini"]["named_as"], "Aus")

    def test_a_family_that_is_its_order_stays_off_a_part_of_it(self):
        taxa = {x: {"order": "O", "family": "Aidae"} for x in "abc"} | {x: {"order": "P", "family": "Bidae"} for x in "de"}
        root = tree([[["a", "b"], "c"], ["d", "e"]], taxa)
        rep = run(root)
        self.assertEqual(names(root)["O"], ["a", "b", "c"])
        self.assertNotIn("Aidae", names(root))  # not on (a, b), F 0.8
        self.assertEqual(rep["not_placed"]["family Aidae"]["named_as"], "O")

    def test_a_subfamily_never_above_its_family(self):
        taxa = {"a": fam("Aidae", subfamily="Ainae"), "b": fam("Aidae", subfamily="Ainae"),
                "c": fam("Aidae", subfamily="Binae"), "d": fam("Aidae", subfamily="Binae"),
                "e": fam("Bidae"), "f": fam("Bidae")}
        root = tree([[["a", "b"], ["c", "d"]], ["e", "f"]], taxa)
        run(root)
        got = names(root)
        self.assertEqual(got["Aidae"], ["a", "b", "c", "d"])
        self.assertEqual(got["Ainae"], ["a", "b"])
        self.assertEqual(got["Binae"], ["c", "d"])

    def test_siblings_on_one_fork_the_better_holds_it(self):
        taxa = {x: fam("Aidae") for x in "abc"} | {x: fam("Bidae") for x in "de"}
        root = tree([["a", "b", "c", "d"], "e"], taxa)
        run(root)
        self.assertEqual(names(root)["Aidae"], ["a", "b", "c", "d"])
        self.assertNotIn("Bidae", names(root))  # F 0.57 at most

    def test_locked_is_not_moved_and_its_fork_is_not_taken(self):
        taxa = {x: fam("Aidae", subfamily="Ainae") for x in "abc"} | {x: fam("Aidae", subfamily="Binae") for x in "de"}
        root = tree([("Ainae", ["a", "b", "d"]), ["c", "e"]], taxa)
        run(root, locked={"Ainae"})
        self.assertEqual(names(root)["Ainae"], ["a", "b", "d"])

    def test_names_not_on_the_list_stay(self):
        taxa = {x: fam("Aidae") for x in "ab"} | {x: fam("Bidae") for x in "cd"}
        root = tree([("Ferae", [["a", "b"], ["c", "d"]])], taxa)
        run(root)
        self.assertEqual(names(root)["Ferae"], ["a", "b", "c", "d"])

    def test_it_never_changes_the_shape(self):
        taxa = {x: fam("Aidae") for x in "abc"} | {x: fam("Bidae") for x in "de"}
        root = tree([[["a", "b"], "c"], ["d", "e"]], taxa)

        def shape(d):
            return d.leaf.name if d.leaf is not None else [shape(c) for c in d.children]

        was = shape(root)
        run(root)
        self.assertEqual(shape(root), was)


@unittest.skipUnless((DATA / "stats.json").exists(), "no build")
class Built(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stats = json.loads((DATA / "stats.json").read_text())["dated_tree"]["taxon_names"]
        cls.names = list(cls.all_names())

    @staticmethod
    def all_names():
        for f in sorted((DATA / "dated").glob("*.json")):
            m = json.loads(f.read_text())
            yield from (m.get("names") or {}).values()

    def test_every_family_of_2_or_more_is_named_or_its_order_is_it(self):
        np = self.stats["not_placed"]
        unnamed = sorted(k.split()[1] for k, v in np.items() if k.startswith("family ") and "named_as" not in v)
        self.assertEqual(unnamed, ["Balaenidae"])  # Upham's right whales: their fork also holds 2 dolphins and 2 beaked whales (F 0.667)
        self.assertEqual(sorted(k.split()[1] for k, v in np.items() if k.startswith("family ") and "named_as" in v),
                         ["Caenolestidae", "Cynocephalidae", "Didelphidae", "Elephantidae", "Macroscelididae", "Manidae",
                          "Microbiotheriidae", "Notoryctidae", "Procaviidae"])  # the whole of their order

    def test_bats(self):
        bo = self.stats["by_order"]["Chiroptera"]
        self.assertEqual(bo["families_of_2_or_more"], 20)
        self.assertEqual(bo["named_after"], 20)

    def test_no_raw_names(self):
        self.assertFalse([n for n in self.names if "(" in n or "sensu" in n])


if __name__ == "__main__":
    unittest.main()
