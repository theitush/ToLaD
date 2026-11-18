"""The amniote build (ToLaD#539, tolad_pipeline/amniotes.py): its rules on small trees, and its output
(data/amniotes, `make build-amniotes`) against the research's counts and ages and the mammal build's own rows."""

import json
import math
import struct
import unittest
from collections import Counter
from pathlib import Path

import numpy as np

from tolad_pipeline import amniotes
from tolad_pipeline.dated import DNode
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
