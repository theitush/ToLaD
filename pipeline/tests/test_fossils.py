"""The amniote fossils (ToLaD#539 step 6, tolad_pipeline/fossils.py): the taxonomy path and its stems, the backbone
minima and the dated tree's stems on small trees; and the output (data/amniotes) against the research's counts."""

import json
import unittest
from pathlib import Path

from tolad_pipeline import fossils
from tolad_pipeline.dated import S_FLOOR, DNode
from tolad_pipeline.merge import build_leaf_index, graft_pbdb
from tolad_pipeline.overrides import Overrides
from tolad_pipeline.tree import D_INTERP, D_UPHAM, Node

ROOT = Path(__file__).resolve().parents[2]
AMN = ROOT / "data" / "amniotes"


def taxon(no, name, parent, taxon_no=None):
    return {"orig_no": no, "taxon_no": taxon_no or no, "taxon_name": name, "parent_no": parent}


def species(name, parent, fa, fb, la=None, lb=None):
    no = str(abs(hash(name)) % 10 ** 8)
    return {"orig_no": no, "taxon_no": no, "taxon_name": name, "parent_no": parent,
            "is_extant": "extinct", "n_occs": 1, "firstapp_max_ma": fa, "firstapp_min_ma": fb,
            "lastapp_max_ma": la if la is not None else fa, "lastapp_min_ma": lb if lb is not None else fb,
            "genus": name.split()[0]}


def node(name, *kids, age=None, hi=None):
    n = Node(name=name, kind="tree")
    for k in kids:
        n.add(k)
    if age is not None:
        n.age, n.date_src = age, D_UPHAM
        n.data["age_hpd"] = (age, hi if hi is not None else age)
    return n


def leaf(name, **data):
    n = Node(name=name, rank="species", kind="tree")
    n.data.update(data)
    return n


def path_to_root(n):
    out = []
    while n.parent is not None:
        n = n.parent
        out.append(n)
    return out


class TestPath(unittest.TestCase):
    """PBDB's path: a rows node by name, else the stem of the build's own clade it holds; stems move out by age."""

    def setUp(self):
        # PBDB: Amniota > Synapsida > Mammalia; Amniota > Reptilia > Eureptilia > Archosauria (its orig_no is not its
        # taxon_no, as PBDB's) > Dinosauria > Aves, Tyrannosauridae; Archosauria > Crocodylia
        T = [taxon("1", "Amniota", None), taxon("2", "Synapsida", "1"), taxon("3", "Mammalia", "2"),
             taxon("4", "Reptilia", "1"), taxon("11", "Eureptilia", "4"), taxon("5", "Archosauria", "11", "55"),
             taxon("6", "Dinosauria", "5"), taxon("7", "Aves", "6"), taxon("8", "Tyrannosauridae", "6"),
             taxon("9", "Tyrannosaurus", "8"), taxon("10", "Crocodylia", "5"), taxon("12", "Captorhinidae", "11"),
             taxon("13", "Captorhinus", "12"), taxon("15", "Hylonomus", "11"), taxon("14", "Dimetrodon", "2")]
        self.taxa = {t["orig_no"]: t for t in T}
        self.sp = [species("Tyrannosaurus rex", "9", 68.0, 66.0),
                   species("Captorhinus aguti", "13", 290.0, 285.0),
                   species("Hylonomus lyelli", "15", 318.0, 315.0),
                   species("Dimetrodon limbatus", "14", 290.0, 280.0)]
        # rows: Amniota > [Mammalia, Sauria > [Lepidosauria, Archosauria > [Crocodylia, Aves]]]
        self.aves = node("Aves", leaf("Gallus gallus", list="clements"), leaf("Anas crecca", list="clements"),
                         age=99.0, hi=110.0)
        self.croc = node("Crocodylia", leaf("Crocodylus niloticus", list="rdb"), leaf("Gavialis gangeticus", list="rdb"),
                         age=93.0, hi=95.0)
        self.arch = node("Archosauria", self.croc, self.aves, age=243.3, hi=260.2)
        self.lep = node("Lepidosauria", leaf("Anolis carolinensis", list="rdb"), leaf("Sphenodon punctatus", list="rdb"),
                        age=245.0, hi=252.7)
        self.sauria = node("Sauria", self.lep, self.arch, age=280.7, hi=295.9)
        self.mroot = node("Mammalia", leaf("Homo sapiens"), leaf("Mus musculus"), age=180.0)
        self.root = Node(name="Amniota", kind="tree", date_src=D_INTERP)
        self.root.add(self.mroot)
        self.root.add(self.sauria)

    def graft(self):
        pb = fossils.PBDB(self.sp, self.taxa)
        log: dict = {}
        hook = fossils.Path_(pb, [self.sauria], self.mroot, self.root,
                             ["Aves", "Crocodylia", "Archosauria", "Lepidosauria", "Sauria", "Mammalia"], log)
        exact, syn = build_leaf_index(self.sauria, {}, {})
        graft_pbdb(self.sauria, pb.species, exact, syn, log, Overrides(version=1), path=hook)
        first_min = {r["taxon_name"]: r["firstapp_min_ma"] for r in self.sp}
        rep = hook.place(fossils._bound, first_min)
        leaves = {n.name: n for n in self.root.preorder() if n.is_leaf}
        return leaves, rep

    def test_dinosaurs_are_the_birds_stem(self):
        leaves, _ = self.graft()
        anc = [n.name for n in path_to_root(leaves["Tyrannosaurus rex"])]
        self.assertEqual(anc[:3], ["Tyrannosaurus", "Tyrannosauridae", "Dinosauria"])
        dino = path_to_root(leaves["Tyrannosaurus rex"])[2]
        self.assertTrue(dino.data.get("total_group_of"))
        self.assertIs(dino.children[0], self.aves)  # round the birds' own clade
        self.assertIs(dino.parent, self.arch)  # inside Archosauria (its orig_no is not its taxon_no)

    def test_stem_moves_out_past_a_bound(self):
        # Eureptilia holds Archosauria in PBDB (not Lepidosauria: PBDB's own gap); Hylonomus' first appearance is
        # certainly older than Sauria's soft maximum, so Eureptilia is Sauria's stem
        leaves, rep = self.graft()
        eu = next(n for n in self.root.preorder() if n.name == "Eureptilia")
        self.assertIs(eu.children[0], self.sauria)
        self.assertIs(eu.parent, self.root)
        self.assertIn(eu, path_to_root(leaves["Captorhinus aguti"]))
        self.assertEqual([m["to"] for m in rep["moved_out"]], ["Sauria"])

    def test_stem_stays_for_an_uncertain_interval(self):
        # a first appearance whose interval only reaches past the bound (Aphelosaurus, 298.9-293.5 Ma) moves nothing
        self.sp[2] = species("Hylonomus lyelli", "15", 298.9, 293.5)
        leaves, rep = self.graft()
        eu = next(n for n in self.root.preorder() if n.name == "Eureptilia")
        self.assertIs(eu.children[0], self.arch)
        self.assertEqual(rep["moved_out"], [])

    def test_synapsids_are_the_mammals_stem(self):
        leaves, _ = self.graft()
        syn = path_to_root(leaves["Dimetrodon limbatus"])[1]
        self.assertEqual(syn.name, "Synapsida")
        self.assertIs(syn.children[0], self.mroot)
        self.assertIs(syn.parent, self.root)
        self.assertEqual([n.name for n in self.mroot.preorder() if n.is_leaf], ["Homo sapiens", "Mus musculus"])


class TestMinima(unittest.TestCase):
    def test_backbone_raised_by_a_fossil_inside(self):
        aves, croc, test = DNode(age=99.0), DNode(age=93.0), DNode(age=176.7)
        arch = DNode(age=243.3, lo=239.6, hi=247.0, name="Archosauria")
        arch.add(croc)
        arch.add(aves)
        archel = DNode(age=256.8, lo=249.0, hi=264.7, name="Archelosauria")
        archel.add(test)
        archel.add(arch)
        rows_arch = Node(name="Archosauria")
        rows_arch.age = 259.0
        rows_arch.data["raised_by_fossil"] = 15.7
        log: dict = {}
        fossils.backbone_minima({"Archosauria": arch, "Archelosauria": archel}, {"Archosauria": rows_arch},
                                ["Archelosauria", "Archosauria"], log)
        self.assertEqual(arch.age, 259.0)
        self.assertEqual(arch.src, S_FLOOR)
        self.assertGreaterEqual(arch.hi, 259.0)
        self.assertGreater(archel.age, arch.age)  # its parent kept older: raised by the split below it
        self.assertEqual(log["backbone"]["Archosauria"]["raised_by"], "a fossil inside it")
        self.assertEqual(log["backbone"]["Archelosauria"]["raised_by"], "a split below it")
        self.assertEqual(log["backbone"]["Archosauria"]["before_Ma"], 243.3)


class TestDatedStems(unittest.TestCase):
    def test_stems_nest_as_the_rows(self):
        # rows: Sauria > Dinosauria(stem) > [Coelurosauria(stem) > [Aves, Tyrannosauridae], Ornithischia]
        b1, b2, liz = leaf("Gallus gallus"), leaf("Anas crecca"), leaf("Anolis carolinensis")
        aves = node("Aves", b1, b2, age=99.0)
        tyr = Node(name="Tyrannosaurus rex", kind="graft", extinct=True)
        tyr.fad, tyr.t0, tyr.t1 = 68.0, 68.0, 66.0
        tg = Node(name="Tyrannosauridae", kind="group")
        tg.add(tyr)
        tg.age, tg.t0 = 68.0, 68.0
        orn = Node(name="Triceratops horridus", kind="graft", extinct=True)
        orn.fad, orn.t0, orn.t1 = 200.0, 200.0, 66.0
        og = Node(name="Ornithischia", kind="group")
        og.add(orn)
        og.age, og.t0 = 200.0, 200.0
        coel = node("Coelurosauria", aves, tg)
        coel.data["total_group_of"] = "Aves"
        coel.age = 120.0
        dino = node("Dinosauria", coel, og)
        dino.data["total_group_of"] = "Aves"
        dino.age = 200.0
        top = node("Sauria", liz, dino)
        # the living dated tree: Sauria > [Anolis, Aves > [Gallus, Anas]]
        d_aves = DNode(age=99.0, name="Aves")
        for L in (b1, b2):
            d = DNode(leaf=L)
            L.data["dleaf"] = d
            d_aves.add(d)
        d_liz = DNode(leaf=liz)
        liz.data["dleaf"] = d_liz
        d_top = DNode(age=280.7, name="Sauria")
        d_top.add(d_liz)
        d_top.add(d_aves)
        log: dict = {}
        (out,) = fossils.dated_fossils([(top, d_top)], Node(name="(no mammals)"), log)
        self.assertIs(out, d_top)
        self.assertEqual(d_aves.parent.name, "Coelurosauria")
        self.assertEqual(d_aves.parent.parent.name, "Dinosauria")
        self.assertIs(d_aves.parent.parent.parent, d_top)
        self.assertIs(tyr.data["dleaf"].parent, d_aves.parent)
        self.assertIs(orn.data["dleaf"].parent, d_aves.parent.parent)
        self.assertLess(d_aves.parent.age, d_aves.parent.parent.age)
        self.assertLess(d_aves.parent.parent.age, d_top.age)


# ------------------------------------------------------------------ the output


class TestOutput(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = json.loads((AMN / "stats.json").read_text())["amniotes"]
        cls.c = cls.s["checks"]
        cls.f = cls.c["fossils"]

    def test_counts_per_group(self):
        """research/amniote-sources.md §10, within 10%. PBDB files living birds' fossils under both Aves and Avialae, so
        the research's Aves list counted some birds as non-avian dinosaurs: the two are compared together."""
        v = self.f["vs_research_graftable"]
        for g, x in v.items():
            if g in ("Birds", "Non-avian dinosaurs"):
                continue
            self.assertAlmostEqual(x["here"] / x["research"], 1.0, delta=0.1, msg=g)
        both = v["Birds"]["here"] + v["Non-avian dinosaurs"]["here"]
        self.assertAlmostEqual(both / (v["Birds"]["research"] + v["Non-avian dinosaurs"]["research"]), 1.0, delta=0.1)
        self.assertEqual(self.c["fossils_in_dated_tree"], self.c["fossil_tips"])
        self.assertEqual(self.f["fossils"], self.c["fossil_tips"])

    def test_no_species_twice(self):
        self.assertEqual(self.c["species_twice"], [])

    def test_periods(self):
        self.assertEqual(self.f["non_avian_dinosaurs_after_K_Pg"]["n"], 0)
        for g in ("Pterosaurs", "Marine reptiles"):
            self.assertEqual(self.f["outside_the_Mesozoic"][g]["n"], 0, g)
        self.assertEqual(self.f["fossils_alive_into_the_recent"], [])

    def test_backbone_minima(self):
        bb = self.s["fossils"]["backbone"]
        self.assertGreaterEqual(bb["Archosauria"]["after_Ma"], 247.1)  # Benton et al. 2015's hard minimum
        for k, x in bb.items():
            self.assertGreaterEqual(x["after_Ma"], x["before_Ma"], k)
        self.assertLessEqual(bb["Sauria"]["after_Ma"], 295.9)  # Benton's soft maximum
        self.assertLessEqual(bb["Archosauria"]["after_Ma"], 260.2)

    def test_stems(self):
        st = self.s["fossils"]["stems"]
        for nm in ("Dinosauria", "Theropoda", "Pseudosuchia", "Pantestudines", "Synapsida", "Cynodontia"):
            self.assertIn(nm, st)
        self.assertEqual(st["Synapsida"]["round"], "Mammalia")
        self.assertEqual(st["Pantestudines"]["round"], "Testudines")

    def test_listed_lost_end_recently(self):
        r = self.s["rows"]
        self.assertGreater(r["listed_but_extinct"]["n"], 70)
        self.assertIn("Aplonis fusca", r["listed_but_extinct"]["names"])
        self.assertIn("Podocnemis expansa", r["ott_extinct_but_living_on_the_lists"]["names"])


if __name__ == "__main__":
    unittest.main()
