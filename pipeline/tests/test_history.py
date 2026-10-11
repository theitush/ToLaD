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

    def test_events(self):
        """[[event]] (ToLaD#141): validated, normalised and sorted oldest first; bad ones rejected."""
        ev = {"kind": "bottleneck", "from_ya": 25000, "to_ya": 10000, "title": "A refounding",
              "summary": "Few founders.", "quote": "a  small number\n of founders", "cite": "Z 2000",
              "url": "https://doi.org/10.1/x", "grade": "C"}
        d = copy.deepcopy(GOOD)
        d["event"] = [dict(ev, from_ya=12600, to_ya=11000, region="Africa"), dict(ev)]
        r = H.validate(d)
        self.assertEqual([e["from_ya"] for e in r["events"]], [25000.0, 12600.0])
        self.assertEqual(r["events"][0]["quote"], "a small number of founders")
        self.assertEqual((r["events"][0]["region"], r["events"][1]["region"]), ("", "Africa"))
        self.assertEqual(H.validate(copy.deepcopy(GOOD))["events"], [])
        for mut in (dict(kind="decline"), dict(from_ya=10000, to_ya=25000), dict(to_ya=-1), dict(quote=" "),
                    dict(cite=""), dict(url="doi:10.1/x"), dict(grade="E"), dict(title="x" * 41),
                    dict(colour="red"), dict(from_ya="25 kya")):
            d = copy.deepcopy(GOOD)
            d["event"] = [dict(ev, **mut)]
            with self.assertRaises(H.HistoryError, msg=str(mut)):
                H.validate(d)
        d = copy.deepcopy(GOOD)
        d["event"] = [{k: v for k, v in ev.items() if k != "quote"}]
        with self.assertRaises(H.HistoryError):
            H.validate(d)

    def test_seeded_bottlenecks(self):
        """The cougar's and the cheetah's bottlenecks are in their files, each quoting its source."""
        recs = {r["species"]: r for r in H.load_all()}
        for sp in ("Puma concolor", "Acinonyx jubatus"):
            evs = recs[sp]["events"]
            self.assertTrue(evs, sp)
            for e in evs:
                self.assertEqual(e["kind"], "bottleneck")
                self.assertTrue(e["url"].startswith("https://doi.org/"), sp)

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
                # (a genomic span finely: procgen's linear ramps then overcount its log-linear births by <= 0.02%)
                self.assertLessEqual(max(s["start"], s["end"]) / min(s["start"], s["end"]),
                                     (H.DEEP_SUB_RATIO if s["kind"] == H.K["genomic"] else H.SPLIT_RATIO) + 1e-9,
                                     msg=f"{rec['file']} {s}")
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
            if h.get("modelled"):  # range-loss records (test_rangeloss.py)
                continue
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
        self.assertGreaterEqual(n, 8)  # 10 before the bulk genomic deep pasts (ToLaD#64) took some over

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
            # resolved steps, then the blind ones kept where [deep.blind] cites a decline there (ToLaD#143)
            self.assertEqual(len(gen), d["points"] + d["kept_blind"], sp)
            self.assertGreaterEqual(d["youngest_yr_ago"], H.DEEP_BLIND_YR, sp)
            self.assertEqual(d["kept_blind"] > 0, bool((d["join"]["blind"] or {}).get("kept")), sp)
            if d["kept_blind"]:
                self.assertLess(d["youngest_blind_yr_ago"], H.DEEP_BLIND_YR, sp)
                self.assertTrue(all(p["grade"] == "D" for p in gen[d["points"]:]), sp)
            self.assertLessEqual(d["oldest_yr_ago"], d["band_start_yr_ago"], sp)
            self.assertTrue(all(p["grade"] in "CD" for p in gen), sp)
            # genomic points come first and are older than every cited point
            n = len(gen)
            self.assertTrue(all(p["kind"] == "genomic" for p in h["points"][:n]), sp)
            # segments: contiguous, no jumps, the oldest one held at the oldest genomic level
            segs = h["segments"]
            for a, b in zip(segs, segs[1:]):
                # G and year0 are float32 in the debug dump (as in HIST): allow their rounding
                self.assertAlmostEqual(a["year0"] + a["gens"] * h["G"], b["year0"],
                                       delta=max(1.0, a["gens"] * 2e-5 + abs(b["year0"]) * 1e-6), msg=sp)
                self.assertAlmostEqual(a["end"] / b["start"], 1.0, delta=1e-6, msg=sp)
            self.assertEqual(segs[0]["kind"], "held", sp)
            self.assertAlmostEqual(segs[0]["start"] * h["L"] / h["G"] / gen[0]["n"], 1.0, delta=0.01, msg=sp)
            self.assertIn("genomic", {x["kind"] for x in segs}, sp)
            # ever follows the deep level: within the range the deep points span, over the band
            band = d["band_start_yr_ago"]
            lo = min(p["n"] for p in gen) / h["L"] * band * 0.5
            hi = max(p["n"] for p in gen) / h["L"] * band * 1.5
            self.assertTrue(lo <= s["ever_after"] <= hi, (sp, lo, s["ever_after"], hi))


BLIND = {"cite": "F 2017, Results", "url": "https://example.org/f", "quote": "a second round of decline",
         "window": [10000, 20000]}


class BlindSpot(unittest.TestCase):
    """ToLaD#143: PSMC's blind-spot steps are kept (grade D) where [deep.blind] cites a decline there;
    else dropped, and a join running against them is flagged and said on the card."""

    def _gen(self, **kw):
        r = H.validate(_with_deep(**kw))
        keep, drop = H.deep_points(r["deep"], 10.0)  # resolved youngest 8e4 (~33 kya); blind 4e4 (~6 kya)
        return r, keep, drop

    def test_schema(self):
        r, _, _ = self._gen(blind=BLIND)
        self.assertEqual(r["deep"]["blind"]["window"], [10000.0, 20000.0])
        self.assertIsNone(self._gen()[0]["deep"]["blind"])
        for bad in ({k: v for k, v in BLIND.items() if k != "quote"}, {**BLIND, "url": "doi:1"},
                    {**BLIND, "window": [25000, 40000]}, {**BLIND, "window": [9, 8]}, {**BLIND, "colour": 1}):
            with self.assertRaises(H.HistoryError):
                H.validate(_with_deep(blind=bad))

    def test_kept_where_cited(self):
        r, keep, drop = self._gen(blind=BLIND)
        bp = H.blind_points(drop, r["deep"]["blind"], 1500)
        self.assertEqual(len(bp), 1)
        p = bp[0]
        self.assertTrue(p["blind"] and p["grade"] == "D" and p["kind"] == "genomic")
        self.assertAlmostEqual(NOW_YEAR - p["year"], 6000, places=3)
        self.assertIn('"a second round of decline"', p["note"])
        self.assertEqual(H.blind_points(drop, r["deep"]["blind"], NOW_YEAR - 7000), [])  # not before the next point
        out, j = H.deep_join(keep + bp, {"year": 1500, "n": 4e5, "lo": 2e5, "hi": 8e5, "grade": "D",
                                         "kind": "rangeloss"}, None, drop, r["deep"]["blind"])
        self.assertAlmostEqual(j["ratio"], 4e4 / 4e5)  # the join starts from the youngest kept step
        self.assertTrue(j["blind"]["kept"])
        self.assertFalse(j["blind"]["against"])
        self.assertAlmostEqual(j["blind"]["vs_resolved"], 0.5)
        self.assertIn("is kept, grade D, because F 2017, Results dates a decline there", j["note"])
        self.assertIn("the genomic level falls 2x", j["note"])
        self.assertIn("joined log-linearly from the youngest kept step", j["note"])

    def test_dropped_join_against_is_flagged(self):
        _, keep, drop = self._gen()

        def nxt(n, kind="rangeloss", year=1500):
            return {"year": year, "n": n, "lo": n / 2, "hi": n * 2, "grade": "D", "kind": kind}
        _, j = H.deep_join(keep, nxt(4e5), None, drop)  # blind 0.5x, join rises 5x: against
        self.assertFalse(j["blind"]["kept"])
        self.assertTrue(j["blind"]["against"])
        self.assertAlmostEqual(j["ratio"], 8e4 / 4e5)  # still from the youngest resolved step
        self.assertIn("sits 2x below its youngest resolved step", j["note"])
        self.assertIn("so the join rises instead (flagged)", j["note"])
        self.assertIn("across PSMC's last 20 kyr", j["note"])
        _, j = H.deep_join(keep, nxt(4e4), None, drop)  # the join falls with them: nothing to say
        self.assertFalse(j["blind"]["against"])
        self.assertNotIn("blind spot", j["note"])
        _, j = H.deep_join(keep, nxt(2e5, "census", 1900), None, drop)  # scaled: the join is flat
        self.assertTrue(j["blind"]["against"])
        self.assertIn("so the join stays flat instead", j["note"])
        s = H.deep_join_summary({"a": {"deep": {"join": j}}})
        self.assertEqual(list(s["blind"]["against"]), ["a"])
        self.assertEqual(s["blind"]["kept"], [])

    def test_built_lion_and_leopard_fall_after_the_glacial_maximum(self):
        st = _stats()
        dbg = DATA / "debug_top.json"
        if st is None or not dbg.exists() or "blind" not in st.get("deep_join", {}):
            self.skipTest("no build output")
        hist = {h["species"]: h for h in json.loads(dbg.read_text())["history"]}
        for sp in ("Panthera leo", "Panthera pardus"):
            self.assertIn(sp, st["deep_join"]["blind"]["kept"])
            pts = hist[sp]["points"]
            at = {ka: H.interp(pts, NOW_YEAR - ka * 1000) for ka in (30, 20, 15, 10, 5)}
            self.assertLess(at[10], at[20] / 1.5, (sp, at))  # Figueiro et al. 2017: 20-10 kya
            self.assertLessEqual(at[15], at[20], (sp, at))
            self.assertLessEqual(at[10], at[15], (sp, at))


class DeepJoin(unittest.TestCase):
    """ToLaD#77/#80: a cited next level scales the genomic curve to meet it; a modelled one keeps the
    genomic level; a mismatch beyond 10x is flagged either way; each species gets a sentence."""

    def _gen(self, G=10.0):
        r = H.validate(_with_deep())
        keep, _ = H.deep_points(r["deep"], G)
        return r, keep  # youngest n = 8000 / 0.1 = 8e4

    @staticmethod
    def _nxt(n, kind, year=1500, **kw):
        return {"year": year, "n": n, "lo": n / 2, "hi": n * 2, "grade": "D", "kind": kind, **kw}

    def test_cited_scales_to_meet(self):
        _, gen = self._gen()
        nxt = self._nxt(2e5, "census", year=1900)  # 2.5x above the genomic level: scaled, not flagged
        out, j = H.deep_join(gen, nxt)
        self.assertEqual((j["rule"], j["next"], j["flag"]), ("scaled", "cited", False))
        self.assertAlmostEqual(j["ratio"], 8e4 / 2e5)
        self.assertAlmostEqual(j["factor"], 2.5)
        self.assertAlmostEqual(out[-1]["n"] / nxt["n"], 1.0, places=12)  # meets it: no jump, no slope
        self.assertAlmostEqual(j["deep_n"], nxt["n"])
        self.assertAlmostEqual(j["deep_n_raw"], 8e4)
        for a, b in zip(gen, out):  # the shape (and each point's range) is kept
            self.assertEqual(a["year"], b["year"])
            for k in ("n", "lo", "hi", "ne"):
                self.assertAlmostEqual(b[k] / a[k], 2.5, places=12)
            self.assertIn("scaled x2.5 to meet the cited 1900 count", b["note"])
        self.assertEqual(gen[-1]["n"], 8e4)  # the input is not touched
        self.assertEqual(j["note"], "Genomic curve scaled x2.5 to meet the cited 1900 count (200,000), keeping its shape.")
        # a baseline says so; the curve still passes through every point
        r, gen = self._gen()
        pts = H.curve_points(r)
        out, j = H.deep_join(gen, pts[0])
        self.assertIn("the cited 1800 baseline (1,000,000)", j["note"])
        curve = out + pts
        for p in curve:
            self.assertAlmostEqual(H.interp(curve, p["year"]) / p["n"], 1.0, places=9)

    def test_modelled_keeps_absolute(self):
        _, gen = self._gen()
        for kind, what in (("rangeloss", "the modelled natural level in 1500 CE"), ("model", "today's modelled count")):
            nxt = self._nxt(4e4, kind)
            out, j = H.deep_join(gen, nxt)
            self.assertEqual((j["rule"], j["next"], j["flag"], j["factor"]), ("absolute", "modelled", False, 1.0))
            self.assertEqual([p["n"] for p in out], [p["n"] for p in gen])
            self.assertEqual([p["note"] for p in out], [p["note"] for p in gen])
            self.assertAlmostEqual(j["ratio"], 2.0)
            self.assertEqual(j["note"], f"Genomic curve kept at its own level; {what} is 2x lower; the two are "
                                        "joined log-linearly across PSMC's last 20 kyr.")

    def test_flag_beyond_10x(self):
        _, gen = self._gen()
        # modelled, 316x below the genomic level (the Addax case): kept, flagged
        out, j = H.deep_join(gen, self._nxt(8e4 / 316, "rangeloss"))
        self.assertTrue(j["flag"])
        self.assertEqual(j["rule"], "absolute")
        self.assertEqual(out[-1]["n"], gen[-1]["n"])
        self.assertIn("is 316x lower (flagged: beyond 10x)", j["note"])
        # cited, 1000x above it (the Bison case, inverted): scaled, and says how far it moved
        out, j = H.deep_join(gen, self._nxt(8e7, "estimate", year=1800))
        self.assertTrue(j["flag"])
        self.assertEqual(j["rule"], "scaled")
        self.assertAlmostEqual(out[-1]["n"], 8e7)
        self.assertEqual(j["note"], "Genomic curve scaled x1,000 to meet the cited 1800 count (80,000,000), keeping "
                                    "its shape; before scaling it was 1,000x below that level (flagged: beyond 10x).")
        # within 10x either way: not flagged
        for n in (8e4 / 9.9, 8e4 * 9.9):
            self.assertFalse(H.deep_join(gen, self._nxt(n, "model"))[1]["flag"])
            self.assertFalse(H.deep_join(gen, self._nxt(n, "census"))[1]["flag"])
        # the summary lists the flagged species, worst first
        rep = {sp: {"deep": {"join": H.deep_join(gen, self._nxt(n, k))[1]}}
               for sp, n, k in (("a", 8e4 / 316, "rangeloss"), ("b", 8e4 * 2, "census"), ("c", 8e7, "estimate"))}
        rep["d"] = {"deep": None}
        s = H.deep_join_summary(rep)
        self.assertEqual(s["by_rule"], {"scaled": 2, "absolute": 1})
        self.assertEqual(list(s["flagged"]), ["c", "a"])
        self.assertEqual(s["flagged_by_rule"], {"scaled": 1, "absolute": 1})

    def test_built_joins(self):
        st = _stats()
        dbg = DATA / "debug_top.json"
        if st is None or not dbg.exists() or "deep_join" not in st:
            self.skipTest("no build output")
        hist = {h["species"]: h for h in json.loads(dbg.read_text())["history"]}
        n = {"scaled": 0, "absolute": 0}
        for sp, s in st["species"].items():
            if not s.get("deep"):
                continue
            j, h = s["deep"]["join"], hist[sp]
            n[j["rule"]] += 1
            cited = j["to_kind"] in H.POINT_KINDS
            self.assertEqual(j["rule"], "scaled" if cited else "absolute", sp)
            self.assertEqual(j["flag"], max(j["ratio"], 1 / j["ratio"]) > H.DEEP_JOIN_FLAG, sp)
            gen = [p for p in h["points"] if p["kind"] == "genomic"]
            nxt = h["points"][len(gen)]
            self.assertAlmostEqual(nxt["n"] / j["to_n"], 1.0, places=6, msg=sp)
            if cited:  # the youngest genomic point sits on the cited level
                self.assertAlmostEqual(gen[-1]["n"] / nxt["n"], 1.0, places=6, msg=sp)
            else:
                self.assertAlmostEqual(j["factor"], 1.0, msg=sp)
            self.assertEqual(h["deep_join"], j["note"], sp)  # the card's sentence
            self.assertEqual(sp in st["deep_join"]["flagged"], j["flag"], sp)
        self.assertEqual(n, st["deep_join"]["by_rule"])
        self.assertGreater(n["scaled"], 5)  # the history files' cited historical levels (Bison, tiger, ...)
        self.assertGreater(n["absolute"], 50)  # the modelled records

    def test_cutoff_1900(self):
        """ToLaD#71/#80: only a cited level dated 1900 or earlier scales the genomic curve."""
        _, gen = self._gen()
        for year in (1530, 1800, 1900):
            out, j = H.deep_join(gen, self._nxt(2e5, "census", year=year))
            self.assertEqual(j["rule"], "scaled", year)
            self.assertIsNone(j["cited_late"])
            self.assertAlmostEqual(out[-1]["n"], 2e5)
        # a 1924 census of 66 (the wisent): kept, the sentence says why; flagged, as it is 1,212x off
        late = self._nxt(66, "census", year=1924)
        out, j = H.deep_join(gen, late)
        self.assertEqual((j["rule"], j["next"], j["factor"], j["flag"]), ("absolute", "cited", 1.0, True))
        self.assertEqual([p["n"] for p in out], [p["n"] for p in gen])
        self.assertEqual(j["cited_late"], {"year": 1924, "n": 66, "kind": "census"})
        self.assertEqual(j["note"], "First cited point (1924 census, 66) is after 1900, so not used as the deep "
                                    "past's level. Genomic curve kept at its own level; that point is 1,212x lower "
                                    "(flagged: beyond 10x); the two are joined log-linearly across PSMC's last "
                                    "20 kyr.")
        # with the natural level in 1500 put before it: joined to that, then the trend runs to the point
        out, j = H.deep_join(gen, self._nxt(4e4, "rangeloss"), late)
        self.assertEqual((j["rule"], j["next"], j["to_kind"], j["flag"]), ("absolute", "modelled", "rangeloss", False))
        self.assertEqual(j["cited_late"]["year"], 1924)
        self.assertEqual(j["note"], "First cited point (1924 census, 66) is after 1900, so not used as the deep "
                                    "past's level. Genomic curve kept at its own level; the modelled natural level "
                                    "in 1500 CE is 2x lower; the two are joined log-linearly across PSMC's last "
                                    "20 kyr, then the range-loss trend runs to the cited point.")
        s = H.deep_join_summary({"a": {"deep": {"join": j}}, "b": {"deep": {"join": H.deep_join(gen, late)[1]}}})
        self.assertEqual(s["cited_late"], {"to_natural_1500": 1, "to_the_point": 1})

    def test_built_bison_bonasus(self):
        """The wisent's deep past is no longer scaled x0.0037 to the 1924 census of 66."""
        st = _stats()
        if st is None or "deep_join" not in st:
            self.skipTest("no build output")
        j = st["species"]["Bison bonasus"]["deep"]["join"]
        self.assertEqual(j["rule"], "absolute")
        self.assertEqual(j["cited_late"]["year"], 1924)
        self.assertIn("First cited point (1924 census, 66) is after 1900, so not used as the deep past's level",
                      j["note"])
        for sp in ("Bison bison", "Loxodonta africana", "Vicugna vicugna", "Panthera tigris"):  # <= 1900
            self.assertEqual(st["species"][sp]["deep"]["join"]["rule"], "scaled", sp)


def _gap_leaf(n_nat=1e5, n_now=1e4, L=5.0, t0=1.0, rangeloss=True):
    """A living leaf as model.py leaves it before history.apply: natural level `n_nat` (both maps),
    today's count `n_now`, the range-loss trend (when `rangeloss`) in its pieces."""
    from types import SimpleNamespace
    nat = {"N": n_nat, "lo": n_nat / 10, "hi": n_nat * 10, "grade": "D", "kind": "reconstruction",
           "scaled": rangeloss, "km2_cur": 1.0, "km2_nat": n_nat / n_now, "method": "test"}
    D = {"L": L, "rate_wild_now": n_now / L, "natural": nat, "alive": n_now, "ever_med": 1.0, "grade_cap": 3,
         "sd_leaf": 0.3, "pieces": [(t0, 0.0, n_now / L)], "meth": [], "src": set(), "rangeloss": rangeloss,
         "sd_today_count": 0.2, "grade_cap_today": 2}
    leaf = SimpleNamespace(name="Testus exemplaris", t0=t0, extinct=False, is_leaf=True, data=D)
    return SimpleNamespace(preorder=lambda: [leaf]), leaf


def _gap_apply(doc: dict, **kw) -> tuple[dict, dict, dict]:
    from tolad_pipeline import model as M
    root, leaf = _gap_leaf(**kw)
    log = {}
    rec = H.apply(root, Path("."), log, 0, [{**H.validate(copy.deepcopy(doc)), "file": "t.toml"}],
                  M.rangeloss_start)[0]
    return rec, log["history"]["species"]["Testus exemplaris"], leaf.data


class GapTrend(unittest.TestCase):
    """ToLaD#71: the range-loss trend fills the gap between the natural level and the first cited point."""

    NOB = {k: v for k, v in GOOD.items() if k != "baseline"}  # 1950: 2e4, 2020: 1e4 (B)

    def test_natural_then_trend_then_points(self):
        rec, rep, D = _gap_apply(self.NOB)
        c = rec["curve"]
        self.assertEqual([(p["year"], p["kind"]) for p in c], [(1500, "rangeloss"), (1950, "estimate"),
                                                               (2020, "census")])
        self.assertEqual(c[0]["n"], 1e5)
        self.assertTrue(rec["trend_1500"] and rep["trend_1500"])
        self.assertEqual(rep["deep_from"], "natural")  # unchanged: the natural level sets the band start
        self.assertAlmostEqual(rep["deep_after"], 1e5)
        # births: the natural level held to 1500, then the log-linear trend to 2e4 in 1950 (no step)
        y = 1725.0
        want = math.exp((math.log(1e5) + math.log(2e4)) / 2) / 5.0
        r = next(r for o, yy, r in D["pieces"] if yy <= year_to_ma(y) <= o)
        self.assertAlmostEqual(r / want, 1.0, delta=0.01)
        self.assertAlmostEqual(D["pieces"][0][2] * 5.0, 1e5)
        # segments: natural, then the trend (kind rangeloss) to the first point, contiguous, no jump
        kinds = [H.KINDS[s["kind"]] for s in rec["segments"]]
        i = kinds.index("rangeloss")
        self.assertEqual(set(kinds[:i]), {"natural"})
        self.assertNotIn("held", kinds[:i])
        for a, b in zip(rec["segments"], rec["segments"][1:]):
            self.assertAlmostEqual(a["end"], b["start"], delta=1e-9 * a["end"])
        self.assertIn("then the range-loss trend from 1500 to the first cited point", D["meth"][-1])

    def test_no_trend_without_both_maps_or_before_1500(self):
        # no range-loss trend on the leaf (natural level from density x area): the held level and a step
        rec, rep, _ = _gap_apply(self.NOB, rangeloss=False)
        self.assertEqual(rec["curve"][0]["year"], 1950)
        self.assertFalse(rep["trend_1500"])
        self.assertEqual(rep["deep_from"], "natural")
        # a first point before 1500: nothing to fill
        doc = copy.deepcopy(self.NOB)
        doc["point"][0]["year"] = 1400
        rec, rep, _ = _gap_apply(doc)
        self.assertEqual(rec["curve"][0]["year"], 1400)
        self.assertFalse(rep["trend_1500"])
        # a cited baseline wins: no trend
        rec, rep, _ = _gap_apply(GOOD)
        self.assertNotIn("rangeloss", [p["kind"] for p in rec["curve"]])
        self.assertEqual(rep["deep_from"], "baseline")

    def test_genomic_scaled_to_1800_point(self):
        doc = _with_deep()
        del doc["baseline"]
        doc["point"][0]["year"] = 1800
        rec, rep, _ = _gap_apply(doc)
        kinds = [p["kind"] for p in rec["curve"]]
        self.assertNotIn("rangeloss", kinds)
        j = rec["deep_join"]
        self.assertEqual((j["rule"], j["to_year"], j["cited_late"]), ("scaled", 1800, None))
        self.assertAlmostEqual(rec["deep_points"][-1]["n"], 2e4)
        self.assertEqual(rep["deep_from"], "genomic")

    def test_genomic_kept_and_trend_fills_to_1924_point(self):
        doc = _with_deep()
        del doc["baseline"]
        doc["point"][0].update(year=1924, n=66, lo=60, hi=70, kind="census")
        raw, _ = H.deep_points(H.validate(copy.deepcopy(doc))["deep"], 10.0, NOW_YEAR - 1e6)
        # without the model's own trend (no current range map) the natural level in 1500 is joined too
        rec, rep, _ = _gap_apply(doc, rangeloss=False)
        n = len(rec["deep_points"])
        self.assertEqual([p["kind"] for p in rec["curve"][n:]], ["rangeloss", "census", "census"])
        self.assertTrue(rep["trend_1500"])
        rec, rep, _ = _gap_apply(doc)
        c = rec["curve"]
        n = len(rec["deep_points"])
        self.assertEqual([p["kind"] for p in c[n:]], ["rangeloss", "census", "census"])
        self.assertEqual((c[n]["year"], c[n]["n"], c[n + 1]["year"]), (1500, 1e5, 1924))
        j = rec["deep_join"]
        self.assertEqual((j["rule"], j["to_kind"], j["factor"]), ("absolute", "rangeloss", 1.0))
        self.assertEqual(j["cited_late"], {"year": 1924, "n": 66, "kind": "census"})
        self.assertEqual([p["n"] for p in rec["deep_points"]], [p["n"] for p in raw])  # not scaled
        self.assertIn("First cited point (1924 census, 66) is after 1900", j["note"])
        self.assertEqual(rep["deep_from"], "genomic")
        segk = [H.KINDS[s["kind"]] for s in rec["segments"]]
        self.assertIn("rangeloss", segk)
        for p in c:  # the curve passes through every point
            self.assertAlmostEqual(H.interp(c, p["year"]) / p["n"], 1.0, places=9)


def _no_rise(tc, rec):
    """From the 1500 knot to the first cited point the curve never rises (ToLaD#93)."""
    c = rec["curve"]
    i = next(i for i, p in enumerate(c) if p["kind"] == "rangeloss")
    a, b = c[i], c[i + 1]
    tc.assertEqual(a["year"], 1500)
    tc.assertLessEqual(b["n"], a["n"])
    for y in range(1500, int(b["year"]) + 1, 5):
        tc.assertLessEqual(H.interp(c, y), a["n"] * (1 + 1e-9))
    lo = H.year_to_ma(b["year"])
    for s in rec["segments"]:  # the births segments between the knot and the point never rise either
        if 1500 <= s["year0"] and H.year_to_ma(s["year0"]) > lo:
            tc.assertLessEqual(s["end"], s["start"] * (1 + 1e-9))


class TrendNeverRises(unittest.TestCase):
    """ToLaD#93: where the natural level in 1500 is below the first cited point, the range-loss trend
    would run upward; the cited level is held flat back to 1500 instead, and the card says so."""

    NOB = GapTrend.NOB  # 1950: 2e4, 2020: 1e4

    def test_trend_down_is_unchanged(self):
        rec, rep, _ = _gap_apply(self.NOB)  # natural 1e5 > 2e4: the trend as before
        _no_rise(self, rec)
        self.assertIsNone(rep["trend_held"])
        self.assertEqual(rec["curve"][0]["n"], 1e5)

    def test_natural_below_first_point_is_held(self):
        rec, rep, D = _gap_apply(self.NOB, n_nat=5e3)
        _no_rise(self, rec)
        c = rec["curve"]
        self.assertEqual([(p["year"], p["kind"], p["n"]) for p in c[:2]], [(1500, "rangeloss", 2e4),
                                                                           (1950, "estimate", 2e4)])
        self.assertEqual(rep["trend_held"], {"natural_n": 5e3, "year": 1950, "n": 2e4, "kind": "estimate",
                                             "baseline": False})
        self.assertIn("held back to 1500", c[0]["note"])
        self.assertIn("5,000", c[0]["note"])
        kinds = [H.KINDS[s["kind"]] for s in rec["segments"]]
        self.assertNotIn("rangeloss", kinds)
        self.assertIn("held", kinds)
        self.assertIn("first cited level held back to 1500", D["meth"][-1])
        self.assertEqual(rep["deep_from"], "natural")

    def test_genomic_joins_the_held_level(self):
        doc = _with_deep()
        del doc["baseline"]
        doc["point"][0].update(year=1950, n=5e5, lo=4e5, hi=6e5)  # Panthera leo: 150k natural, 500k in 1950
        rec, rep, _ = _gap_apply(doc, n_nat=1.5e5)
        _no_rise(self, rec)
        n = len(rec["deep_points"])
        c = rec["curve"]
        self.assertEqual((c[n]["year"], c[n]["n"]), (1500, 5e5))
        j = rec["deep_join"]
        self.assertEqual((j["rule"], j["to_kind"], j["to_n"]), ("absolute", "rangeloss", 5e5))
        self.assertAlmostEqual(j["ratio"], j["deep_n_raw"] / 5e5)
        self.assertIn("held back to 1500 CE because the modelled natural level there (150,000) is below it",
                      j["note"])
        self.assertIn("then that level is held flat to the cited point", j["note"])
        self.assertNotIn("range-loss trend runs", j["note"])  # the #71 wording
        self.assertEqual(rep["trend_held"]["natural_n"], 1.5e5)
        log = {}
        root, _ = _gap_leaf(n_nat=1.5e5)
        from tolad_pipeline import model as M
        H.apply(root, Path("."), log, 0, [{**H.validate(copy.deepcopy(doc)), "file": "t.toml"}], M.rangeloss_start)
        self.assertEqual(list(log["history"]["trend_held"]["species"]), ["Testus exemplaris"])


if __name__ == "__main__":
    unittest.main()
