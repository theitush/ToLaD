"""The amniote build (ToLaD#539, tolad_pipeline/amniotes.py): its rules on small trees, and its output
(data/amniotes, `make build-amniotes`) against the research's counts and ages and the mammal build's own rows."""

import json
import math
import struct
import tempfile
import unittest
from collections import Counter
from pathlib import Path

import numpy as np

from tolad_pipeline import amniotes, reptcounts
from tolad_pipeline.dated import DNode
from tolad_pipeline.tiles import q_log16
from tolad_pipeline.tree import Node, collapse_knuckles

ROOT = Path(__file__).resolve().parents[2]
AMN = ROOT / "data" / "amniotes"
MAM = ROOT / "data" / "mammals"


def leaf(name, ott=None, **data):
    n = Node(name=name, ott=ott, rank="species")
    n.data.update(data)
    return n


def clade(name, *kids, ott=None):
    n = Node(name=name, ott=ott)
    for k in kids:
        n.add(k)
    return n


class TestRules(unittest.TestCase):
    def test_lists_match(self):
        birds = {"Aus bus": {"ott": 11, "group": "Aves", "family": "F", "order": "O", "common": None, "list": "clements"}}
        rept = {"Cus dus": {"ott": None, "group": "Squamata", "family": "G", "order": "Sauria", "common": None,
                            "list": "rdb"}}
        L = amniotes.Lists(birds, rept, {22: ["Cus dus"], 33: ["Aus bus", "Cus dus"]}, {"Cus dus": {44}})
        self.assertEqual(L.match(leaf("Aus cus", 11)), ("Aus bus", "ott"))  # the crosswalk's id wins over the name
        self.assertEqual(L.match(leaf("Cus dus", 99)), ("Cus dus", "name"))
        self.assertEqual(L.match(leaf("Cus eus", 22)), ("Cus dus", "synonym"))
        self.assertEqual(L.match(leaf("Cus fus", 44)), ("Cus dus", "synonym"))  # the list name's own OTT uid
        self.assertEqual(L.match(leaf("Xus yus", 33))[0], None)  # two list names: no match
        self.assertEqual(L.match(leaf("Xus zus", 55)), (None, "none"))

    def test_broken_taxon_named(self):
        # Crocodylia has no node in the synthesis; with its extinct tips gone, its species are one unnamed clade
        tax = {1: {"parent": None, "name": "Archosauria", "rank": "no rank", "flags": set(), "group": ""},
               2: {"parent": 1, "name": "Crocodylia", "rank": "order", "flags": set(), "group": ""},
               3: {"parent": 2, "name": "Aa", "rank": "species", "flags": set(), "group": ""},
               4: {"parent": 2, "name": "Ab", "rank": "species", "flags": set(), "group": ""},
               5: {"parent": 1, "name": "Ac", "rank": "species", "flags": set(), "group": ""}}
        croc = clade(None, leaf("Aa a", 3), leaf("Ab b", 4))
        root = clade("Archosauria", croc, leaf("Ac c", 5), ott=1)
        log = {}
        amniotes.name_by_taxonomy(root, tax, log)
        self.assertEqual(croc.name, "Crocodylia")
        self.assertEqual(log["faults"]["named_by_taxonomy"]["names"], ["Crocodylia"])

    def test_homonym_note_dropped(self):
        n = clade("Squamata (order in Deuterostomia)", leaf("Aa a"), leaf("Ab b"))
        log = {}
        amniotes.name_by_taxonomy(clade("Top", n), {}, log)
        self.assertEqual(n.name, "Squamata")
        self.assertIn("Squamata (order in Deuterostomia)", n.alt)

    def test_sums_exact(self):
        a, b = leaf("Aa a"), leaf("Ab b")
        top = clade("A", a, b)
        top.t0, top.t1 = 10.0, 0.0
        for x, t0, r, g in ((a, 4.0, 2.0, 2), (b, 7.0, 3.0, 3)):
            x.t0, x.t1 = t0, 0.0
            x.data.update(pieces=[(t0, 0.0, r)], ever=r * t0 * 1e6, alive=r, sd=0.5, grade=g, src={0},
                          profile=np.full(16, r), ghost=0.0)
            x.data["kever"] = x.data["ever"]
            x.data["by_grade"] = np.bincount([g], weights=[x.data["ever"]], minlength=4)
        amniotes.sum_rows(top, [])
        D = top.data
        self.assertAlmostEqual(D["ever"], 2.0 * 4e6 + 3.0 * 7e6)
        e = amniotes.profile_edges(top.t0, top.t1)
        self.assertAlmostEqual(float((D["profile"] * np.diff(e) * 1e6).sum()) / D["ever"], 1.0, places=9)
        self.assertEqual(D["grade"], 3)  # the median of the ever is grade D's (b holds 21 of 29)

    def test_unknown_only_is_d(self):
        a, b = leaf("Aa a"), leaf("Ab b")
        top = clade("A", a, b)
        top.t0 = 5.0
        for x in (a, b):
            x.t0 = 3.0
            x.data.update(pieces=[(3.0, 0.0, 0.2)], ever=0.2 * 3e6, alive=0.67, sd=0.0, grade=3, src={0},
                          profile=np.full(16, 0.2), ghost=0.0, kever=0.0,
                          by_grade=np.array([0, 0, 0, 0.2 * 3e6]))
        amniotes.sum_rows(top, [])
        self.assertEqual(top.data["grade"], 3)
        self.assertEqual((top.data["lo"], top.data["hi"]), (0.0, 0.0))

    def test_graft_dated_one_mate_halfway(self):
        # a species no dated tree has, with one genus-mate on it: a new split halfway down the mate's branch
        # (a listed species: graft_dated places the lists' species; a fossil goes on by fossils.dated_fossils)
        m, o, g = leaf("Aa a", family="F", group="Aves", list="clements"), \
            leaf("Bb b", family="F", group="Aves", list="clements"), leaf("Aa c", family="F", group="Aves", list="clements")
        rows = clade("R", clade(None, m, g), o)
        top = DNode(age=10.0, lo=10.0, hi=10.0)
        dm, do = DNode(leaf=m), DNode(leaf=o)
        top.add(dm)
        top.add(do)
        m.data["dleaf"], o.data["dleaf"] = dm, do
        log = {"dated": {}}
        amniotes.graft_dated(rows, top, None, log)
        dg = g.data["dleaf"]
        self.assertTrue(dg.graft)
        self.assertIs(dg.parent, dm.parent)
        self.assertEqual(dg.parent.age, 5.0)
        self.assertEqual(dg.parent.loose, 1)

    def test_genus_of_one_species_at_the_root_is_that_species(self):
        # a fossil genus PBDB files straight under Amniota is a top of its own, dated under a holder: its one species
        # takes its place (a holder never absorbs its child), not the genus with the species' name as an alias
        g = clade("Gen", leaf("Gen sp"))
        holder = clade("(holder)", g)
        collapse_knuckles(holder, absorb_root=False)
        (sp,) = holder.children
        self.assertEqual((sp.name, sp.alt, sp.is_leaf), ("Gen sp", ["Gen"], True))
        self.assertEqual(holder.alt, [])

    def test_reptile_counts(self):
        # ToLaD#578: a reptile a published number counts gets it, as its source gives it; any other stays unknown
        e = reptcounts.load()
        rows = clade("Testudines", leaf("Chelonia mydas", group="Testudines"), leaf("Caretta caretta", group="Testudines"))
        for n in rows.children:
            n.t0, n.t1 = 1.0, 0.0
        log = {}
        amniotes.count_leaves(rows, {}, (11.0, "T t"), log, rept={"Chelonia mydas": e["Chelonia mydas"]})
        cm, cc = (n.data for n in rows.children)
        self.assertAlmostEqual(cm["alive"], e["Chelonia mydas"]["n"])
        self.assertTrue(cm["anchored_count"])
        self.assertNotIn("count_unknown", cm)
        self.assertEqual(cm["count_src"]["counts"], "adult females")
        self.assertIn("not converted", cm["meth"][0])
        self.assertEqual(cm["kever"], cm["ever"])
        self.assertEqual((cc["alive"], cc["count_unknown"]["thinnest"]), (11.0, "T t"))  # no number: unknown
        self.assertNotIn("anchored_count", cc)
        self.assertEqual(log["counts"]["by_kind"], {"reptile: published count": 1, "reptile: unknown": 1})
        self.assertEqual((log["reptile_counts"]["on_a_living_row"], log["reptile_counts"]["not_found"]), (1, []))

    def test_reptile_names(self):
        # ToLaD#592: a reptile takes the Red List's English name by its binomial, else by an established synonym that
        # renames the same species (genus move, gender ending); never through a lump, a shared record or a name the
        # Red List gives an extinct taxon when a count says ours lives
        def rec(common, cat="LC", syn=()):
            return {"class": "REPTILIA", "category": cat, "common": common, "synonyms": list(syn)}
        rl = {"Aus bus": rec("Bee Lizard"), "Eus dus": rec("Dee Snake", syn=["Cus dus"]),
              "Hus ius": rec("Eye Gecko", syn=["Fus gus"]), "Lus kus": rec("Kay Skink", syn=["Jus ka"]),
              "Pus nus": rec("En Turtle"), "Qus rus": rec("Lost Tortoise", "EX"),
              "Wus tus": rec("Tee Viper", syn=["Sus tus", "Vus tus"]), "Xus yus": rec("Bird", syn=["Zus yus"])}
        rl["Xus yus"]["class"] = "AVES"
        names = ["Aus bus", "Cus dus", "Fus gus", "Jus kus", "Mus nus", "Qus rus", "Sus tus", "Vus tus", "Zus yus"]
        rept = {n: {"group": "Squamata", "common": None} for n in names}
        tax, syn, uids = {5: {"name": "Mus nus"}}, {5: ["Pus nus"]}, {"Mus nus": {5}}
        log = amniotes.name_reptiles(rept, rl, tax, syn, uids, counted={"Qus rus"})
        self.assertEqual({n: r["common"] for n, r in rept.items() if r["common"]},
                         {"Aus bus": "Bee Lizard", "Cus dus": "Dee Snake", "Jus kus": "Kay Skink", "Mus nus": "En Turtle"})
        self.assertEqual(log["Squamata: name"], 1)
        self.assertEqual((log["Squamata: Red List synonym"], log["Squamata: Open Tree synonym"]), (2, 1))

    def test_grafted_lost_species_ends(self):
        # ToLaD#600: a list species Open Tree lacks (grafted on its genus) that the Red List calls EX is lost since
        # 1500, as a tip is (Bolyeria multocarinata was drawn living); unless a count today has it
        from tolad_pipeline.merge import LAD_RECENT_EX
        from tolad_pipeline.newick import parse_newick
        nroot = parse_newick("((Homo_sapiens_ott1)Mammalia_ott244265,(Aus_bus_ott902,Aus_cus_ott903)Aus_ott901)"
                             "Amniota_ott229560;")
        for nd in nroot.iter_preorder():
            m = amniotes.OTT_LABEL.match(nd.label or "")
            nd.ott, nd.name = int(m.group(2)), m.group(1).replace("_", " ")
        rank = {1: "species", 244265: "class", 901: "genus", 902: "species", 903: "species", 229560: "no rank"}
        tax = {u: {"parent": None, "name": "", "rank": r, "flags": set(), "group": "Squamata"} for u, r in rank.items()}
        sp = lambda: {"ott": None, "group": "Squamata", "family": "F", "order": "Sauria", "common": None, "list": "rdb"}  # noqa: E731
        rept = {n: sp() for n in ("Aus bus", "Aus cus", "Aus dus", "Aus eus", "Aus fus")}
        lists = amniotes.Lists({}, rept, {}, {})
        log = {}
        _, seen = amniotes.sauropsid_rows(nroot, tax, lists, log, counted={"Aus eus"},
                                          lost={"Red List 2026-1 EX": {"Aus dus", "Aus eus"}})
        self.assertTrue(seen["Aus dus"].data.get("list_graft"))
        self.assertEqual((seen["Aus dus"].extinct, seen["Aus dus"].lad), (True, LAD_RECENT_EX))
        self.assertEqual(seen["Aus dus"].data["lost_since_1500"], ["Red List 2026-1 EX"])
        self.assertFalse(seen["Aus eus"].extinct)  # counted today: it lives
        self.assertFalse(seen["Aus fus"].extinct or seen["Aus bus"].extinct)
        self.assertEqual(log["rows"]["lost_since_1500_grafted_on_genus"]["names"], ["Aus dus"])

    def test_red_list_status(self):
        # ToLaD#600: a bird's or reptile's Red List status by the mammals' rule (redlist.match_all): its name, alt name,
        # Open Tree synonym, the Red List's own synonym, a gender ending; never a name another leaf has; a living leaf
        # never takes an EX record; one lost since 1500 only EX/EW; a fossil none; not listed: NE. The record carries no
        # English name (the lists' names stay).
        def rec(cat, taxon, syn=(), cls="REPTILIA", order="SQUAMATA"):
            return {"category": cat, "year": 2020, "taxon": taxon, "assessment": taxon * 10, "class": cls, "order": order,
                    "synonyms": list(syn), "common": "Red List Name"}
        rl = {"Aus bus": rec("LC", 1, cls="AVES", order="PASSERIFORMES"), "Eus dus": rec("VU", 2, syn=["Cus dus"]),
              "Hus ius": rec("EN", 3, syn=["Fus gus"]), "Pus nus": rec("CR", 4), "Qus rus": rec("EX", 5),
              "Tus vus": rec("EX", 6), "Wus xa": rec("NT", 7), "Yus za": rec("DD", 8)}
        names = {"Aus bus": dict(group="Aves", order="Passeriformes"), "Cus dus": {}, "Fus gus": {}, "Hus ius": {},
                 "Mus nus": {}, "Qus rus": {}, "Tus vus": {}, "Wus xus": {}, "Kus lus": {}}
        top = clade("Sauropsida")
        for n, d in names.items():
            top.add(leaf(n, ott=50 if n == "Mus nus" else None,
                         **{"group": "Squamata", "order": "Sauria", "list": "rdb", **d}))
        by = {n.name: n for n in top.preorder() if n.is_leaf}
        by["Tus vus"].t1 = 1e-4  # lost since 1500
        top.add(Node(name="Yus za", kind="graft", t1=50.0))  # a fossil of a listed name
        rep = amniotes.red_list_status(top, rl, {50: ["Pus nus"]})
        got = {n: (x.data["red_list"]["category"], x.data["red_list"]["via"]) for n, x in by.items()}
        self.assertEqual(got, {"Aus bus": ("LC", "name"), "Cus dus": ("VU", "Red List synonym"),
                               "Fus gus": ("NE", None),  # its Red List species is another leaf's own name: a lump
                               "Hus ius": ("EN", "name"), "Mus nus": ("CR", "Open Tree synonym"),
                               "Qus rus": ("NE", None),  # lives here, the list's taxon lost
                               "Tus vus": ("EX", "name"), "Wus xus": ("NT", "spelling variant"), "Kus lus": ("NE", None)})
        self.assertNotIn("common", by["Aus bus"].data["red_list"])
        self.assertNotIn("red_list", top.children[-1].data)
        self.assertEqual(rep["living_but_red_list_ex_not_taken"], ["Qus rus"])
        self.assertEqual(rep["ended_with_status"], {"Tus vus": "EX"})
        self.assertEqual(rep["living_matched_by"]["Aves"], {"name": 1})
        self.assertEqual(rep["redlist_not_taken"]["Squamata"]["n"], 2)  # Qus rus (EX, not taken) and Yus za
        self.assertEqual(rep["redlist_not_taken"]["Squamata"]["examples"], ["Yus za"])

    def test_reptile_count_table(self):
        """pipeline/reptile_counts.toml: every number has its source, what it counts, its year and a quote; a range's
        middle is its geometric middle; none is implausible (no sea turtle in billions, no species under 10)."""
        e = reptcounts.load()
        self.assertGreaterEqual(len(e), 25)
        for sp, r in e.items():
            for k in ("cite", "url", "counts", "scope", "quote"):
                self.assertTrue(r[k].strip(), f"{sp}: {k}")
            self.assertTrue(1990 <= r["year"] <= 2026, sp)
            self.assertTrue(10 <= r["n"] <= 1e7, f"{sp}: {r['n']}")
            if r["middle"]:
                self.assertAlmostEqual(r["n"], math.sqrt(r["lo"] * r["hi"]))
            self.assertGreaterEqual(r["grade_i"], amniotes.grade_from_sd(r["sd"]))
        with tempfile.TemporaryDirectory() as d, self.assertRaises(ValueError):  # a number with no source is refused
            bad = Path(d) / "counts.toml"
            bad.write_text('[[count]]\nspecies = "Aus bus"\nn = 5\ncounts = "all ages"\n')
            reptcounts.load(bad)

    def test_backbone_file(self):
        bb = amniotes.load_backbone(ROOT / "pipeline" / "amniotes.toml")
        self.assertEqual([e["name"] for e in bb], ["Amniota", "Sauria", "Archelosauria", "Archosauria", "Lepidosauria"])
        for e in bb:
            self.assertTrue(e["lo"] <= e["age"] <= e["hi"], e["name"])
            self.assertIn("TimeTree 5", e["citation"])


# ------------------------------------------------------------------ the output


def read_tld(path: Path) -> dict:
    """The sections of a .tld file (FORMAT.md, Container) as numpy arrays; NAME as a list; META as a dict."""
    b = path.read_bytes()
    assert b[:4] == b"TLAD"
    _ver, _kind, n, s = struct.unpack_from("<HHII", b, 4)
    out = {"n": n}
    types = {"CHLD": "<u2", "T0__": "<u2", "T1__": "<u2", "EVER": "<u2", "ALIV": "<u2", "GHST": "<u2", "LOHI": "u1",
             "FLAG": "<u2", "METH": "<u2", "SRCM": "<u2", "PPK_": "<u2", "PROF": "u1", "NTIP": "<u4", "GID_": "<u4",
             "OTT_": "<u4", "PBDB": "<u4", "NATB": "<u2", "RLST": "<u4", "STUB": "<u4"}
    for k in range(s):
        fid, off, ln, _cnt = struct.unpack_from("<IIII", b, 16 + 16 * k)
        name = fid.to_bytes(4, "little").decode()
        raw = b[off:off + ln]
        if name == "NAME":
            offs = np.frombuffer(raw[:4 * (n + 1)], "<u4")
            blob = raw[4 * (n + 1):]
            out[name] = [blob[offs[i]:offs[i + 1]].decode() for i in range(n)]
        elif name == "META":
            out[name] = json.loads(raw.decode())
        elif name in types:
            out[name] = np.frombuffer(raw, types[name])
    return out


def all_rows(d: Path) -> tuple[dict, list[dict]]:
    """Every non-stub row of an output, keyed by its global id, with METH resolved to its text."""
    sk = read_tld(d / "skeleton.tld")
    methods = sk["META"]["methods"]
    files = [sk] + [read_tld(d / t["file"]) for t in sk["META"]["tiles"]]
    rows = {}
    for f in files:
        for i in range(f["n"]):
            if f["FLAG"][i] & (1 << 7):  # a stub: the same node is row 0 of its tile
                continue
            r = {k: (f[k][i].item() if f[k].ndim == 1 and len(f[k]) == f["n"] else None)
                 for k in ("CHLD", "T0__", "T1__", "EVER", "ALIV", "GHST", "FLAG", "SRCM", "PPK_", "NTIP", "OTT_", "PBDB")}
            r["NAME"] = f["NAME"][i]
            r["METH"] = methods[f["METH"][i]]
            r["LOHI"] = f["LOHI"][2 * i:2 * i + 2].tolist()
            r["PROF"] = f["PROF"][16 * i:16 * i + 16].tobytes()
            r["NATB"] = f["NATB"][5 * i:5 * i + 5].tolist() if "NATB" in f else None
            r["RLST"] = f["RLST"][3 * i:3 * i + 3].tolist() if "RLST" in f else None
            rows[f["GID_"][i].item()] = r
    return sk["META"], rows


@unittest.skipUnless((AMN / "stats.json").exists(), "no amniote build (make build-amniotes)")
class TestOutput(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = json.loads((AMN / "stats.json").read_text())["amniotes"]
        cls.c = cls.s["checks"]

    def test_tips_per_group(self):
        # research/amniote-sources.md: Clements 11,167; RDB 12,293 squamates, 365 turtles, 27 crocodilians, 1 tuatara
        self.assertEqual(self.c["sauropsid_tips_by_group"], {"Aves": 11167, "Squamata": 12293, "Testudines": 365,
                                                            "Crocodylia": 27, "Rhynchocephalia": 1})
        self.assertEqual(self.c["sauropsid_in_dated_tree"], self.c["sauropsid_tips"])
        self.assertEqual(self.c["tips"], self.c["mammal_tips"] + self.c["sauropsid_tips"] + self.c["fossil_tips"])

    def test_crown_ages(self):
        a = self.c["crowns_Ma"]
        self.assertAlmostEqual(a["Aves"], 99.0, delta=1.0)  # AvesData 1.7's 99.0 Ma
        self.assertAlmostEqual(a["Squamata"], 213.2, delta=1.0)  # Title 2024
        self.assertAlmostEqual(a["Testudines"], 176.7, delta=1.0)  # Colston 2020
        self.assertAlmostEqual(a["Crocodylia"], 93.1, delta=1.0)
        self.assertAlmostEqual(self.c["Amniota_Ma"], 318.8, delta=2.0)
        # the pieces nest: each crown below the split above it
        self.assertLess(a["Aves"], a["Archosauria"])
        self.assertLess(a["Crocodylia"], a["Archosauria"])
        self.assertLess(a["Archosauria"], a["Archelosauria"])
        self.assertLess(a["Testudines"], a["Archelosauria"])
        self.assertLess(a["Squamata"], a["Lepidosauria"])
        self.assertLess(max(a["Archelosauria"], a["Lepidosauria"]), a["Sauria"])
        self.assertLess(max(a["Sauria"], self.c["Mammalia_dated_Ma"]), self.c["Amniota_Ma"])

    def test_no_species_twice_outside_the_mammals(self):
        # (the five twice are the mammal build's own fossil rows, kept exactly: tests below)
        sk = json.loads((AMN / "dated" / "skeleton.json").read_text())
        self.assertTrue(all(" " in x for x in self.c["species_twice"]))
        meta, rows = all_rows(AMN)
        names = Counter(r["NAME"].split("|")[0] for r in rows.values() if r["FLAG"] & (1 << 6))
        twice = sorted(k for k, v in names.items() if v > 1)
        self.assertEqual(twice, sorted(self.c["species_twice"]))
        _, mrows = all_rows(MAM)
        mnames = Counter(r["NAME"].split("|")[0] for r in mrows.values() if r["FLAG"] & (1 << 6))
        self.assertEqual(twice, sorted(k for k, v in mnames.items() if v > 1))
        self.assertIn("timetree", sk["sources"])

    def test_branches_positive(self):
        self.assertEqual(self.c["dated_branches_not_positive"], {"sauropsids": 0, "synapsids": 0, "Amniota": 0})
        self.assertEqual(self.c["rows_bands_not_positive"], {"sauropsids": 0, "synapsids": 0, "Amniota": 0})

    def test_faults(self):
        f = self.s["faults"]
        for g in ("Dinosauria", "Pterosauria"):  # fault 2: no non-avian dinosaur or pterosaur tip is left
            self.assertNotIn(g, f["tips_left_by_ott_group"])
        self.assertEqual(f["lepidosauria_tips_by_group"], {"Squamata": 12293, "Rhynchocephalia": 1})
        for nm in ("Archosauria", "Crocodylia"):  # fault 1: the broken taxa named by the rule
            self.assertIn(nm, f["named_by_taxonomy"]["names"])

    def test_counts(self):
        k = self.s["counts"]["by_kind"]
        self.assertEqual(sum(v for x, v in k.items() if x.startswith("bird")), 11167)
        self.assertEqual(sum(v for x, v in k.items() if x.startswith("reptile")), 12293 + 365 + 27 + 1)
        self.assertGreater(k["bird: Callaghan, model"], 8000)
        self.assertGreater(k["bird: Callaghan, training"], 600)
        self.assertNotIn("reptile: Callaghan", " ".join(k))
        # Callaghan's estimates sum to 50.5 billion (research §5); the matched ones to a little less
        self.assertAlmostEqual(self.c["alive"]["Aves"] / 50.5e9, 1.0, delta=0.03)

    def test_mammals_identical(self):
        """Every mammal row of data/amniotes is data/mammals' row, field for field (global ids shifted by the rows
        above Mammalia: Amniota's, 0, and the synapsid stems round it; tiling aside)."""
        _, mrows = all_rows(MAM)
        meta, arows = all_rows(AMN)
        self.assertEqual(arows[0]["NAME"], "Amniota")
        off = next(g for g in sorted(arows) if arows[g]["NAME"] == "Mammalia")
        self.assertEqual(arows[off - 1]["NAME"], "Mammaliaformes")  # its stems (fossils.py), nearest first
        for g, r in mrows.items():
            a = arows[g + off]
            for k in r:
                self.assertEqual(a[k], r[k], f"{r['NAME']} (gid {g}): {k}")
        self.assertEqual(sum(1 for g in arows if off <= g <= max(mrows) + off), len(mrows))

    def test_mammal_dated_tree_identical(self):
        """The amniote dated tree's Mammalia is the mammal build's, split for split."""
        def splits(d: Path, top: int) -> list:
            a = json.loads((d / "dated" / "skeleton.json").read_text())["all"]
            nodes = a["nodes"]
            kids = [[] for _ in nodes]
            for i, n in enumerate(nodes):
                if n[0] >= 0:
                    kids[n[0]].append(i)
            out, st = [], [top]
            while st:
                i = st.pop()
                n = nodes[i]
                out.append((len(n), tuple(n[1:]) if len(n) == 5 else None, a["names"].get(str(i)), len(kids[i])))
                st.extend(reversed(kids[i]))
            return out
        a = json.loads((AMN / "dated" / "skeleton.json").read_text())["all"]
        m = json.loads((MAM / "dated" / "skeleton.json").read_text())["all"]
        def mammalia(t: dict) -> int:
            return next(int(k) for k, v in t["names"].items() if v == "Mammalia")
        self.assertEqual(m["nodes"][mammalia(m)][0], 0)  # the mammal tree's root: Mammalia's stem, its fossils on it
        top = a["nodes"][mammalia(a)][0]  # the same split in the amniotes, under the synapsid stems
        self.assertEqual(splits(AMN, top), splits(MAM, 0))

    def test_reptile_counts_wired(self):
        """ToLaD#578: each reptile with a count has a source, and no reptile without one has a count. A reptile row
        is anchored (FLAG bit 8) with its known count exactly when the table counts it; its sidecar names the source."""
        table = reptcounts.load()
        meta, rows = all_rows(AMN)
        _, mrows = all_rows(MAM)
        sp = lambda r: r["FLAG"] & (1 << 6) and not r["FLAG"] & (1 << 2)  # noqa: E731  (a living species row)
        m_anch = {r["NAME"].split("|")[0] for r in mrows.values() if sp(r) and r["FLAG"] & (1 << 8)}
        anch = {r["NAME"].split("|")[0]: r for r in rows.values() if sp(r) and r["FLAG"] & (1 << 8)}
        rept = {k: r for k, r in anch.items() if k not in m_anch}
        self.assertEqual(set(rept), set(table))  # no bird is anchored: the rest are the table's reptiles
        for k, r in rept.items():
            self.assertFalse(r["FLAG"] & (1 << 11), k)
            self.assertIn("not converted", r["METH"], k)
            self.assertAlmostEqual(r["ALIV"], q_log16(table[k]["n"]), delta=1, msg=k)
        rc = self.s["reptile_counts"]
        self.assertEqual((rc["entries"], rc["on_a_living_row"], rc["not_found"]), (len(table), len(table), []))
        k = self.s["counts"]["by_kind"]
        self.assertEqual(k["reptile: published count"], len(table))
        # the sidecars: every counted reptile's source, and only theirs
        side = {}
        for f in (AMN / "dated").glob("*.json"):
            d = json.loads(f.read_text())
            for row, c in d.get("count", {}).items():
                side[c["cite"]] = side.get(c["cite"], 0) + 1
                self.assertTrue(c["url"].startswith("https://") and c["counts"] and c["year"], f.name)
        self.assertEqual(sum(side.values()), len(table))

    def test_reptile_names_in_sidecars(self):
        """ToLaD#592: the reptiles carry their Red List English names in the file sidecars, as the mammals and birds;
        the Floreana tortoise's name is not on the counted Galapagos tortoise."""
        names = set()
        for f in (AMN / "dated").glob("*.json"):
            names |= set(json.loads(f.read_text()).get("common", {}).values())
        for n in ("Olive Ridley Turtle", "Leatherback Turtle", "Green Turtle", "Aldabra Giant Tortoise", "Nile Crocodile",
                  "Tuatara", "Komodo Dragon", "Burmese Python", "Pond Slider"):
            self.assertIn(n, names)
        self.assertNotIn("Floreana Giant Tortoise", names)
        nm = self.s["lists"]["rdb_red_list_names"]
        named = Counter()
        for k, v in nm.items():
            if "unnamed" not in k:
                named[k.split(":")[0]] += v
        self.assertEqual(named["Crocodylia"], 23)
        self.assertEqual(named["Rhynchocephalia"], 1)
        self.assertGreater(named["Testudines"], 250)
        self.assertGreater(named["Squamata"], 7000)

    def test_red_list_status_wired(self):
        """ToLaD#600: every living bird and reptile row carries its Red List status (RLST), as every mammal's; a fossil
        none; one lost since 1500 the list's EX; the list's taxa a leaf took counted the other way too."""
        meta, rows = all_rows(AMN)
        _, mrows = all_rows(MAM)
        mam = {r["NAME"] for r in mrows.values()}
        cats = meta["red_list"]["categories"]
        cat = lambda r: cats[r["RLST"][0] & 255]  # noqa: E731
        sau = [r for r in rows.values() if r["FLAG"] & (1 << 6) and r["NAME"] not in mam]
        living = [r for r in sau if not r["FLAG"] & (1 << 2)]
        self.assertEqual(len(living), self.s["red_list"]["living_leaves"])
        self.assertEqual([r["NAME"] for r in living if not cat(r)], [])
        self.assertTrue(all(cat(r) == "" for r in sau if r["FLAG"] & (1 << 9)))  # PBDB fossils: none
        lost = [r for r in sau if r["FLAG"] & (1 << 2) and not r["FLAG"] & (1 << 9)]
        self.assertEqual(Counter(cat(r) for r in lost if cat(r)), {"EX": len(self.s["red_list"]["ended_with_status"])})
        by = Counter(cat(r) for r in living)
        self.assertNotIn("EX", by)  # a living row never carries EX
        self.assertGreater(by["LC"], 14000)
        self.assertLess(by["NE"] / len(living), 0.15)
        self.assertEqual(self.s["red_list"]["living_by_category"]["Crocodylia"], {"CR": 7, "EN": 1, "LC": 12, "NE": 4, "VU": 3})
        self.assertEqual(self.s["red_list"]["living_but_red_list_ex_not_taken"], ["Chelonoidis niger", "Zosterops conspicillatus"])
        self.assertEqual(self.s["rows"]["lost_since_1500_grafted_on_genus"]["n"], 21)

    def test_page_reads_unknown_flag(self):
        meta, rows = all_rows(AMN)
        _, mrows = all_rows(MAM)
        unknown = sum(1 for r in rows.values() if r["FLAG"] & (1 << 11))
        m_unknown = sum(1 for r in mrows.values() if r["FLAG"] & (1 << 11))
        k = self.s["counts"]["by_kind"]
        self.assertEqual(unknown - m_unknown, sum(v for x, v in k.items() if "unknown" in x))
        self.assertTrue(math.isfinite(meta["amniotes"]["assumed_generation_yr"]))


if __name__ == "__main__":
    unittest.main()
