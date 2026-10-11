"""The data audit (ToLaD#113): each guard on a synthetic row shaped like the past bug it catches."""

from __future__ import annotations

import unittest

from tolad_pipeline import audit as A


def row(**kw):
    r = {"name": "Felis testus", "family": "Felidae", "order": "Carnivora", "kind": "tree", "extinct": False,
         "extinct_by": None, "t1_ma": 0.0, "alive": 1000.0, "today_src": "model", "domestic": False, "G": 6.0,
         "phylacine": "LC", "upham": True, "red_list": "LC", "red_list_year": 2020, "natural": None,
         "census": None, "gs_model": None, "file": None, "modelled": None, "use": None, "curve": [],
         "deep": None, "deep_factors": None}
    r.update(kw)
    return r


def k(year, n, src, kind=None):
    return {"year": year, "n": n, "src": src, "kind": kind or {"cited": "census", "genomic": "genomic"}.get(src, "model")}


def classes(r):
    return sorted({f["class"] for f in A.audit_row(r)["flags"]})


class Guards(unittest.TestCase):
    def test_join_to_a_modelled_level(self):
        # the cougar (#94): a genomic level climbing 26x to the modelled natural level in 1500
        r = row(curve=[k(-30000, 4e4, "genomic"), k(1500, 1.02e6, "modelled", "rangeloss"), k(2026, 7.8e5, "modelled")],
                deep={"ratio": 0.039, "flag": True, "rule": "absolute", "to_kind": "rangeloss", "to_n": 1.02e6,
                      "deep_n": 4e4, "factor": 1.0})
        self.assertEqual(classes(r), ["deep", "join"])
        j = next(f for f in A.audit_row(r)["flags"] if f["class"] == "join")
        self.assertAlmostEqual(j["ratio"], 25.5, places=1)
        self.assertFalse(j["rapid"])

    def test_cited_to_cited_is_supported(self):
        # the bison's crash, cited at both ends, is history, not an artifact
        r = row(curve=[k(1800, 3e7, "cited"), k(1890, 1000, "cited")], today_src="history")
        self.assertEqual(classes(r), [])

    def test_genomic_curve_alone_is_one_source(self):
        r = row(curve=[k(-500000, 1e6, "genomic"), k(-30000, 5e4, "genomic")])
        self.assertEqual(classes(r), [])

    def test_step_is_rapid(self):
        # the #61 step: a modelled natural level held to 1500, then today's count
        r = row(curve=[k(-6e5, 4000, "modelled"), k(1500, 4000, "modelled"), k(1500, 50, "modelled"), k(2026, 50, "modelled")])
        j = [f for f in A.audit_row(r)["flags"] if f["class"] == "join"]
        self.assertEqual(len(j), 1)
        self.assertTrue(j[0]["rapid"])

    def test_today_against_an_independent_figure(self):
        # the ferret (#72): a modelled 161k where the published count is a few hundred
        r = row(alive=161078.0, census=496.0)
        self.assertEqual(classes(r), ["today"])
        # the count's own source is not a check of it
        self.assertEqual(classes(row(alive=496.0, census=496.0, today_src="census")), [])

    def test_unanchored(self):
        self.assertTrue(A.audit_row(row(alive=4e5, today_src="greenspoon model"))["unanchored"])
        self.assertFalse(A.audit_row(row(alive=4e5, census=3e5))["unanchored"])

    def test_ceiling(self):
        # #88: a CR species modelled above criterion C's widest bound
        self.assertEqual(classes(row(red_list="CR", alive=4e5)), ["ceiling"])
        self.assertEqual(classes(row(red_list="CR", alive=40.0)), [])
        self.assertEqual(classes(row(red_list="EN", alive=4e5)), [])  # EN under A or B: any size
        self.assertEqual(classes(row(red_list="CR", alive=4e5, today_src="census")), [])

    def test_status(self):
        # #105: Red List EX drawn living; an extinct band reaching the present; a graft ending now
        self.assertEqual(classes(row(red_list="EX")), ["status"])
        self.assertEqual(classes(row(extinct=True, alive=0.0, red_list="EX", extinct_by="PHYLACINE EX")), ["status"])
        self.assertEqual(classes(row(extinct=True, alive=0.0, red_list="EX", t1_ma=0.0002)), [])
        self.assertEqual(classes(row(kind="graft", extinct=True, alive=0.0, red_list=None, t1_ma=0.0)), ["status"])
        self.assertEqual(classes(row(extinct=True, alive=0.0, red_list="VU", t1_ma=0.01)), ["status"])

    def test_name(self):
        # a subspecies kept as a species tip, with its clade's mean count
        self.assertEqual(classes(row(upham=False, phylacine=None, red_list="NE")), ["name"])
        self.assertEqual(classes(row(upham=False, phylacine=None, red_list="LC")), [])

    def test_units(self):
        self.assertEqual(classes(row(deep_factors={"time": 5.4, "ne": 1.1, "cite": "x"})), ["units"])
        self.assertEqual(classes(row(deep_factors={"time": 2.5, "ne": 0.4, "cite": "x"})), [])

    def test_reviewed_and_ranking(self):
        r = row(name="Panthera leo", deep_factors={"time": 5.4, "ne": 1.0, "cite": "x"})
        rv = {("Panthera leo", "units"): {"reason": "g = 1", "issue": 66}}
        a = A.audit_row(r, rv, {"Panthera leo"})
        self.assertEqual(A.state(a), "reviewed")
        self.assertEqual(a["severity"], 0.0)
        rep = A.run([r, row(name="Felis affinis", upham=False, phylacine=None, red_list="NE"),
                     row(name="Lutra x", family="Mustelidae", alive=1e6, gs_model=1e4)], rv, {"Panthera leo"})
        self.assertEqual([c["name"] for c in rep["cats"]], ["Panthera leo", "Felis affinis"])
        self.assertEqual([x["name"] for x in rep["ranked"]], ["Felis affinis", "Lutra x"])
        self.assertIn("Felis affinis", A.render_md(rep))


if __name__ == "__main__":
    unittest.main()
