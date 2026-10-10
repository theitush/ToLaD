"""Tests for the curated population history (pipeline/history/, tolad_pipeline/history.py).

    cd pipeline && uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import copy
import json
import math
import unittest
from pathlib import Path

from tolad_pipeline import history as H
from tolad_pipeline.anchors import NOW_YEAR, year_to_ma

DATA = Path(__file__).resolve().parents[2] / "data" / "mammals"

GOOD = {
    "species": "Testus exemplaris", "common": "test", "component": "wild", "use": "counts",
    "scope": "global", "notes": "",
    "baseline": {"year": 1800, "n": 1e6, "lo": 5e5, "hi": 2e6, "grade": "D", "kind": "unverified",
                 "cite": "Somebody 1900", "url": "https://example.org/a", "note": ""},
    "point": [
        {"year": 1950, "n": 2e4, "lo": 1e4, "hi": 3e4, "grade": "C", "kind": "estimate",
         "cite": "X 1951", "url": "https://example.org/b"},
        {"year": 2020, "n": 1e4, "lo": 9e3, "hi": 1.1e4, "grade": "B", "kind": "census",
         "cite": "Y 2021", "url": "https://example.org/c", "note": "aerial count"},
    ],
}


def _stats():
    p = DATA / "stats.json"
    if not p.exists():
        return None
    return json.loads(p.read_text()).get("history")


class Schema(unittest.TestCase):
    def test_all_files_validate(self):
        recs = H.load_all()
        self.assertGreaterEqual(len(recs), 40)
        self.assertLessEqual(len(recs), 60)
        for r in recs:
            for p in H.curve_points(r):
                self.assertTrue(p["cite"] and p["url"].startswith("http"), r["file"])

    def test_required_flagships_present(self):
        names = {r["species"] for r in H.load_all()}
        for sp in ("Loxodonta africana", "Loxodonta cyclotis", "Elephas maximus", "Balaenoptera musculus",
                   "Balaenoptera physalus", "Megaptera novaeangliae", "Eschrichtius robustus",
                   "Eubalaena glacialis", "Physeter macrocephalus", "Bison bison", "Enhydra lutris",
                   "Callorhinus ursinus", "Canis lupus", "Panthera leo", "Panthera tigris", "Panthera pardus",
                   "Acinonyx jubatus", "Panthera uncia", "Ceratotherium simum", "Diceros bicornis",
                   "Ailuropoda melanoleuca", "Gorilla beringei", "Pan troglodytes", "Phascolarctos cinereus",
                   "Sarcophilus harrisii", "Saiga tatarica", "Connochaetes taurinus", "Ursus maritimus",
                   "Ursus arctos", "Castor canadensis", "Homo sapiens", "Bos taurus", "Ovis aries",
                   "Capra hircus", "Sus scrofa", "Bubalus bubalis", "Equus caballus", "Equus asinus",
                   "Camelus dromedarius"):
            self.assertIn(sp, names)
        self.assertTrue(any(n.startswith("Pongo ") for n in names))

    def test_leopard_and_jaguar_have_global_dated_history(self):
        """The leopard and jaguar curves are global (they drive counts), with a recent cited
        point after 2000 and a cited earlier level from the Red List's decline (ToLaD#51)."""
        recs = {r["species"]: r for r in H.load_all()}
        for sp in ("Panthera pardus", "Panthera onca"):
            r = recs[sp]
            self.assertEqual(r["use"], "counts", sp)
            pts = H.curve_points(r)
            self.assertGreaterEqual(len(pts), 2, sp)
            for p in pts:
                self.assertTrue(p["cite"] and p["url"].startswith("https://doi.org/"), sp)
            self.assertGreaterEqual(pts[-1]["year"], 2000, sp)
            self.assertIn(pts[-1]["grade"], "ABC", sp)
            # the earlier level is higher: the Red List's three-generation decline
            self.assertGreater(pts[0]["n"], pts[-1]["n"], sp)
            self.assertLess(pts[0]["year"], pts[-1]["year"] - 15, sp)

    def test_good_doc(self):
        r = H.validate(copy.deepcopy(GOOD))
        self.assertEqual([p["year"] for p in r["points"]], [1950.0, 2020.0])
        self.assertEqual(r["baseline"]["n"], 1e6)

    def test_bad_docs_rejected(self):
        def bad(mut):
            d = copy.deepcopy(GOOD)
            mut(d)
            with self.assertRaises(H.HistoryError):
                H.validate(d)
        bad(lambda d: d.update(colour="green"))  # unknown key
        bad(lambda d: d.pop("species"))
        bad(lambda d: d.update(component="feral"))
        bad(lambda d: d.update(use="maybe"))
        bad(lambda d: d["point"][0].update(grade="E"))
        bad(lambda d: d["point"][0].update(kind="guess"))
        bad(lambda d: d["point"][0].update(lo=3e4))  # lo > n
        bad(lambda d: d["point"][0].update(hi=1e3))  # hi < n
        bad(lambda d: d["point"][0].update(n=0))
        bad(lambda d: d["point"][0].pop("cite"))
        bad(lambda d: d["point"][0].update(url="doi:10.1/x"))
        bad(lambda d: d["point"][0].update(kind="unverified", grade="C"))  # unverified must be D
        bad(lambda d: d["point"][1].update(year=1950))  # duplicate year
        bad(lambda d: d["point"][1].update(year=2100))  # future
        bad(lambda d: d["baseline"].update(year=1990))  # baseline after first point
        bad(lambda d: d["point"][0].update(extra=1))
        bad(lambda d: d.update(faostat_item=866))  # wild file
        bad(lambda d: (d.pop("point"), d.pop("baseline")))  # no data at all


class Curve(unittest.TestCase):
    def test_interpolation_hits_every_point(self):
        for r in H.load_all() + [H.validate(copy.deepcopy(GOOD)) | {"file": "GOOD"}]:
            pts = H.curve_points(r)
            for p in pts:
                self.assertAlmostEqual(H.interp(pts, p["year"]) / p["n"], 1.0, places=12, msg=r["file"])
            # log-linear between points: the midpoint is the geometric mean
            for a, b in zip(pts, pts[1:]):
                mid = H.interp(pts, (a["year"] + b["year"]) / 2)
                self.assertAlmostEqual(mid / math.sqrt(a["n"] * b["n"]), 1.0, places=9)

    def test_pieces_integrate_the_curve(self):
        r = H.validate(copy.deepcopy(GOOD))
        pts = H.curve_points(r)
        L = 10.0
        t0 = year_to_ma(1000)
        pcs = H.curve_pieces(pts, L, t0)
        # contiguous, from t0 to now
        self.assertAlmostEqual(pcs[0][0], t0)
        self.assertAlmostEqual(pcs[-1][1], 0.0, places=12)
        for (o1, y1, _), (o2, y2, _) in zip(pcs, pcs[1:]):
            self.assertAlmostEqual(y1, o2, places=12)
        # analytic integral of the log-linear curve / L
        def seg(a, b):
            k = math.log(b["n"] / a["n"]) / (b["year"] - a["year"])
            return (b["n"] - a["n"]) / k
        want = (pts[0]["n"] * (1800 - 1000) + sum(seg(a, b) for a, b in zip(pts, pts[1:]))
                + pts[-1]["n"] * (NOW_YEAR - 2020)) / L
        self.assertAlmostEqual(H.pieces_births(pcs) / want, 1.0, places=6)


class Segments(unittest.TestCase):
    def _check(self, rec, G):
        L = G / 2
        pts = H.curve_points(rec)
        t0 = year_to_ma(min(pts[0]["year"], 0) - 50000)
        segs = H.compile_segments(pts, G, L, t0, rec["baseline"] is not None)
        # alive now = last segment's end size * L / G (births per generation = N G / L)
        self.assertAlmostEqual(segs[-1]["end"] * L / G / pts[-1]["n"], 1.0, delta=0.10, msg=rec["file"])
        for s, nxt in zip(segs, segs[1:] + [None]):
            self.assertGreaterEqual(s["gens"], 1)
            if s["gens"] > 1:  # a one-generation span may have to change faster
                self.assertLessEqual(max(s["start"], s["end"]) / min(s["start"], s["end"]),
                                     H.SPLIT_RATIO + 1e-9, msg=f"{rec['file']} {s}")
            if nxt is not None:  # contiguous, no jumps
                self.assertAlmostEqual(s["year0"] + s["gens"] * G, nxt["year0"], places=6)
                self.assertAlmostEqual(s["end"] / nxt["start"], 1.0, places=9)
        # ever over the segments vs the births pieces over the same span, within 10%
        pcs = H.curve_pieces(pts, L, t0)
        span_years = sum(s["gens"] for s in segs) * G
        self.assertAlmostEqual(segs[0]["year0"], NOW_YEAR - span_years, places=6)
        want = H.pieces_births([p for p in pcs if p[1] < year_to_ma(segs[0]["year0"])])
        self.assertAlmostEqual(H.segments_births(segs) / want, 1.0, delta=0.10, msg=rec["file"])

    def test_segments_reproduce_alive_now(self):
        for r in H.load_all():
            if not r["points"]:
                continue
            for G in (4.0, 12.0, 30.0):
                self._check(r, G)

    def test_built_segments_match_alive(self):
        st = _stats()
        dbg = DATA / "debug_top.json"
        if st is None or not dbg.exists():
            self.skipTest("no build output")
        hist = json.loads(dbg.read_text())["history"]
        for h in hist:
            s = st["species"][h["species"]]
            if s["use"] != "counts" or s["component"] != "wild" or s["domestic_on_leaf"]:
                continue
            seg = h["segments"][-1]
            alive_seg = seg["end"] * h["L"] / h["G"]
            # wild alive (minus any domestic stock on the same leaf)
            alive = h["points"][-1]["n"]
            self.assertAlmostEqual(alive_seg / alive, 1.0, delta=0.10, msg=h["species"])
            if s["alive_from"] == "history":
                self.assertLessEqual(abs(s["alive_after"] - alive), 0.10 * alive + 1, h["species"])


class Baseline(unittest.TestCase):
    def test_baseline_raises_ever_synthetic(self):
        r = H.validate(copy.deepcopy(GOOD))
        L = 10.0
        t0 = 1.0  # a 1 Myr band
        before = 1e4 / L * 1e6  # today's count held over the band
        after = H.pieces_births(H.curve_pieces(H.curve_points(r), L, t0))
        # the deep past runs at the baseline (1e6), 100x today's 1e4
        self.assertAlmostEqual(after / before, 100.0, delta=1.0)

    def test_baseline_raises_ever_in_build(self):
        st = _stats()
        if st is None:
            self.skipTest("no build output")
        n = 0
        for sp, s in st["species"].items():
            b = s["baseline"]
            if (s["use"] != "counts" or s["component"] != "wild" or b is None or s["domestic_on_leaf"]
                    or s.get("deep")):  # a genomic deep past sets its own level (DeepPast)
                continue
            if b["n"] > 2 * s["alive_after"]:
                n += 1
                if b["n"] > 2 * s["deep_before"]:  # baseline above the model's deep past: ever rises
                    self.assertGreater(s["ever_after"], s["ever_before"], sp)
                # ever scales with the deep-past level: baseline / the model's (natural or today's) level
                want = b["n"] / s["deep_before"]
                self.assertAlmostEqual(math.log10(s["ever_after"] / s["ever_before"]), math.log10(want),
                                       delta=0.15, msg=sp)
        self.assertGreaterEqual(n, 10)

    def test_no_baseline_keeps_the_model_level(self):
        """Without a cited baseline the deep past runs at the natural baseline
        (or, with no range map, today's level), so a recorded bottleneck is not
        held back over the whole band."""
        st = _stats()
        if st is None:
            self.skipTest("no build output")
        for sp, s in st["species"].items():
            if (s["use"] != "counts" or s["component"] != "wild" or s["baseline"] or s["domestic_on_leaf"]
                    or s.get("deep")):
                continue
            want = s["deep_after"] / s["deep_before"]
            if s["deep_from"] == "today":
                self.assertAlmostEqual(math.log10(want), math.log10(s["alive_after"] / s["alive_before"]),
                                       delta=1e-6, msg=sp)
            self.assertAlmostEqual(math.log10(s["ever_after"] / s["ever_before"]), math.log10(want),
                                   delta=0.1, msg=sp)

    def test_precedence_cited_natural_today(self):
        """Level at the band start: genomic deep past > cited baseline > natural baseline > today's level.

        (The cited baseline still governs from its year on: genomic points are all older.)"""
        st = _stats()
        if st is None:
            self.skipTest("no build output")
        seen = set()
        for sp, s in st["species"].items():
            if s["use"] != "counts" or s["component"] != "wild":
                continue
            if s.get("deep"):
                want, src = s["deep"]["oldest_n"], "genomic"
            elif s["baseline"]:
                want, src = s["baseline"]["n"], "baseline"
            elif s["natural"]:
                want, src = s["natural"]["N"], "natural"
            else:
                want, src = s["alive_after"], "today"
            self.assertEqual(s["deep_from"], src, sp)
            seen.add(src)
            if not s["domestic_on_leaf"]:
                self.assertAlmostEqual(s["deep_after"] / want, 1.0, delta=1e-6, msg=sp)
        self.assertTrue({"genomic", "baseline", "natural"} <= seen)

    def test_panthera_genomic_beats_natural(self):
        """The five Panthera have a natural baseline, but their deep past is the genomic curve:
        the oldest genomic level is held to the band start (segments: decoder/test/roundtrip.test.mjs)."""
        st = _stats()
        if st is None:
            self.skipTest("no build output")
        recs = {r["species"]: r for r in H.load_all()}
        for sp in ("Panthera leo", "Panthera tigris", "Panthera pardus", "Panthera onca", "Panthera uncia"):
            s = st["species"][sp]
            self.assertIsNotNone(s["natural"], sp)  # reported, not used
            self.assertEqual(s["deep_from"], "genomic", sp)
            self.assertAlmostEqual(s["deep_after"] / s["deep"]["oldest_n"], 1.0, delta=1e-6, msg=sp)
            if recs[sp]["baseline"] is not None:
                self.assertEqual(s["baseline"]["n"], recs[sp]["baseline"]["n"], sp)

    def test_natural_segment_kind(self):
        """With no cited baseline, the held segment before the first point is kind `natural`, grade D."""
        r = H.validate({k: v for k, v in copy.deepcopy(GOOD).items() if k != "baseline"})
        pts = H.curve_points(r)
        segs = H.compile_segments(pts, 10.0, 5.0, 0.01, False, pre_level=3e4, pre_grade=3, pre_kind="natural")
        self.assertEqual(H.KINDS[segs[0]["kind"]], "natural")
        self.assertEqual(segs[0]["grade"], 3)
        self.assertAlmostEqual(segs[0]["start"], 3e4 * 10.0 / 5.0)
        segs = H.compile_segments(pts, 10.0, 5.0, 0.01, False, pre_level=1e4)
        self.assertEqual(H.KINDS[segs[0]["kind"]], "model")


DEEP = {"method": "PSMC", "cite": "Z 2020, Fig. 1", "url": "https://example.org/z", "mu": 1e-8, "g": 5.0,
        "grade": "D", "steps": [[1000, 9000, 4000], [9000, 30000, 8000], [30000, 90000, 16000],
                                [90000, 300000, 12000], [300000, 900000, 20000]]}


def _with_deep(**kw):
    d = copy.deepcopy(GOOD)
    d["deep"] = {**copy.deepcopy(DEEP), **kw}
    return d


class DeepPast(unittest.TestCase):
    def test_schema(self):
        r = H.validate(_with_deep())
        self.assertEqual(len(r["deep"]["steps"]), 5)

        def bad(**kw):
            with self.assertRaises(H.HistoryError):
                H.validate(_with_deep(**kw))
        bad(grade="B")  # genomic deep past: C or D only
        bad(method="guess")
        bad(mu=1e-3)
        bad(g=0)
        bad(url="doi:10.1/x")
        bad(steps=[[1000, 9000, 4000], [5000, 30000, 8000], [30000, 90000, 1]])  # overlap
        bad(steps=[[1000, 9000, 4000], [9000, 30000, 8000]])  # too few
        bad(steps=[[1000, 900, 4000], [9000, 30000, 8000], [30000, 90000, 1]])  # from > to
        bad(colour="green")
        d = _with_deep()
        d["component"] = "domestic"
        with self.assertRaises(H.HistoryError):
            H.validate(d)

    def test_rescale_formula(self):
        r = H.validate(_with_deep())
        G = 10.0
        kt, kn = H.deep_scale(r["deep"], G)
        # mu 1e-8 per 5-yr generation = 2e-9 per year, twice DEEP_MU_YEAR: times double;
        # per generation of 10 yr the target rate is 1e-8, the source's: Ne unchanged
        self.assertAlmostEqual(kt, 2e-9 / H.DEEP_MU_YEAR)
        self.assertAlmostEqual(kn, 1e-8 / (H.DEEP_MU_YEAR * G))
        keep, drop = H.deep_points(r["deep"], G)
        p = keep[-1]  # the youngest kept step: [9000, 30000] -> ~33 kyr ago
        self.assertAlmostEqual(NOW_YEAR - p["year"], math.sqrt(9000 * 30000) * kt, places=3)
        self.assertAlmostEqual(p["n"], 8000 * kn / H.DEEP_NE_N, places=6)
        self.assertLess(p["lo"], p["n"])
        self.assertGreater(p["hi"], p["n"])
        self.assertGreater(p["hi"] / p["lo"], 3)  # a wide range: grade C/D territory
        self.assertTrue(all(q["kind"] == "genomic" and q["grade"] == "D" for q in keep))
        # the youngest step (~6 kyr after rescaling) is in PSMC's blind spot
        self.assertEqual([q["why"] for q in drop], ["blind"])
        # a band starting 1 Myr ago drops the oldest step (centred ~1.04 Myr ago)
        keep2, drop2 = H.deep_points(r["deep"], G, start_year=NOW_YEAR - 1e6)
        self.assertEqual(len(keep2), len(keep) - 1)
        self.assertEqual(sorted(q["why"] for q in drop2), ["before band", "blind"])

    def _deep_curve(self, G=10.0):
        r = H.validate(_with_deep())
        keep, _ = H.deep_points(r["deep"], G)
        return r, keep + H.curve_points(r)

    def test_join_has_no_jump(self):
        """The deep curve meets the baseline by a log-linear span across the blind spot: the curve
        passes through the youngest genomic point and the baseline, and the segments are contiguous."""
        G, L = 10.0, 5.0
        r, pts = self._deep_curve(G)
        gen = [p for p in pts if p["kind"] == "genomic"]
        self.assertTrue(all(p["year"] < r["baseline"]["year"] for p in gen))  # older than the baseline: allowed
        for p in pts:
            self.assertAlmostEqual(H.interp(pts, p["year"]) / p["n"], 1.0, places=9)
        mid = (gen[-1]["year"] + r["baseline"]["year"]) / 2
        lo, hi = sorted((gen[-1]["n"], r["baseline"]["n"]))
        self.assertTrue(lo <= H.interp(pts, mid) <= hi)
        t0 = year_to_ma(pts[0]["year"] - 1e6)
        segs = H.compile_segments(pts, G, L, t0, False)
        for s, nxt in zip(segs, segs[1:]):
            self.assertAlmostEqual(s["year0"] + s["gens"] * G, nxt["year0"], places=3)
            self.assertAlmostEqual(s["end"] / nxt["start"], 1.0, places=9)
        kinds = {H.KINDS[s["kind"]] for s in segs}
        self.assertTrue({"held", "genomic", "interpolated"} <= kinds, kinds)
        self.assertEqual(H.KINDS[segs[0]["kind"]], "held")  # the oldest genomic level, held to the band start
        # births: pieces integrate the curve, the deep spans in a bounded number of pieces
        pcs = H.curve_pieces(pts, L, t0)
        self.assertLess(len(pcs), 64 * len(pts) + 200)
        y_old = NOW_YEAR - t0 * 1e6
        hold = (pts[0]["year"] - y_old) * pts[0]["n"] / L
        spans = sum((b["year"] - a["year"]) * H.mean_loglinear(a["n"], b["n"]) / L for a, b in zip(pts, pts[1:]))
        tail = (NOW_YEAR - pts[-1]["year"]) * pts[-1]["n"] / L
        self.assertAlmostEqual(H.pieces_births(pcs) / (hold + spans + tail), 1.0, delta=1e-6)

    def test_built_deep_pasts(self):
        st = _stats()
        dbg = DATA / "debug_top.json"
        if st is None or not dbg.exists():
            self.skipTest("no build output")
        hist = {h["species"]: h for h in json.loads(dbg.read_text())["history"]}
        deep = {sp for sp, s in st["species"].items() if s.get("deep")}
        self.assertTrue({"Panthera leo", "Panthera tigris", "Panthera pardus", "Panthera onca",
                         "Panthera uncia"} <= deep, deep)
        for sp in deep:
            s, h = st["species"][sp], hist[sp]
            d = s["deep"]
            gen = [p for p in h["points"] if p["kind"] == "genomic"]
            self.assertEqual(len(gen), d["points"], sp)
            self.assertGreaterEqual(d["youngest_yr_ago"], H.DEEP_BLIND_YR, sp)
            self.assertLessEqual(d["oldest_yr_ago"], d["band_start_yr_ago"], sp)
            self.assertTrue(all(p["grade"] in "CD" for p in gen), sp)
            # genomic points come first and are older than every cited point
            n = len(gen)
            self.assertTrue(all(p["kind"] == "genomic" for p in h["points"][:n]), sp)
            # segments: contiguous, no jumps, the oldest one held at the oldest genomic level
            segs = h["segments"]
            for a, b in zip(segs, segs[1:]):
                self.assertAlmostEqual(a["year0"] + a["gens"] * h["G"], b["year0"], delta=1.0, msg=sp)
                self.assertAlmostEqual(a["end"] / b["start"], 1.0, delta=1e-6, msg=sp)
            self.assertEqual(segs[0]["kind"], "held", sp)
            self.assertAlmostEqual(segs[0]["start"] * h["L"] / h["G"] / gen[0]["n"], 1.0, delta=0.01, msg=sp)
            self.assertIn("genomic", {x["kind"] for x in segs}, sp)
            # ever follows the deep level: within the range the deep points span, over the band
            band = d["band_start_yr_ago"]
            lo = min(p["n"] for p in gen) / h["L"] * band * 0.5
            hi = max(p["n"] for p in gen) / h["L"] * band * 1.5
            self.assertTrue(lo <= s["ever_after"] <= hi, (sp, lo, s["ever_after"], hi))


if __name__ == "__main__":
    unittest.main()
