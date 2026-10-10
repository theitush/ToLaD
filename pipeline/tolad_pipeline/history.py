"""Curated population history for flagship species (pipeline/history/*.toml).

See pipeline/history/README.md for the file schema and research/05 §5 for the
design. In short:

    curve     points (+ the pre-decline baseline) sorted by year, log-linear
              interpolation between them, held flat outside
    births    births/yr = N(t) / L, L = G / 2 (research/02 §3.1). Before the
              baseline (or first) year the rate is held at that level back to
              the start of the species band, so the deep-past "ever" uses the
              pre-decline level, not today's depleted count
    segments  procgen births per generation = alive * G / lifespan
              = N(t) * G / L (= 2 N(t)), boundaries snapped to whole
              generations counted back from now, spans changing > 2x split
              into sub-spans of <= ~1.41x (procgen ramps linearly)
    deep      an optional [deep] genome-based Ne history (PSMC ...) rescaled to one
              per-year mutation rate and the leaf's generation length, Ne -> N by
              Ne/N = 0.1, steps in PSMC's blind spot (< 20 kyr) dropped; the
              genomic points precede the cited ones and join them log-linearly

`apply` rewrites the leaf's pieces / alive / error before sum_tree, so the
existing sum-up and ghost allocation keep the totals consistent up the tree.
"""

from __future__ import annotations

import csv
import io
import math
import tomllib
import zipfile
from pathlib import Path

from .anchors import DOMESTIC_ALIASES, NOW_YEAR, year_to_ma

HIST_DIR = Path(__file__).resolve().parents[1] / "history"

GRADES = "ABCD"
POINT_KINDS = ["census", "estimate", "index-scaled", "reconstruction", "unverified"]
# point kinds, then span-only kinds, then `genomic` (points compiled from [deep], and the spans
# between two of them); the index is the HIST kind code, so new kinds are appended
KINDS = POINT_KINDS + ["model", "interpolated", "held", "baseline", "genomic"]
K = {k: i for i, k in enumerate(KINDS)}

TOP_KEYS = {"species", "aliases", "common", "component", "use", "scope", "faostat_item", "notes",
            "baseline", "point", "deep"}
DEEP_KEYS = {"method", "cite", "url", "mu", "g", "grade", "note", "steps"}
DEEP_METHODS = ("PSMC", "MSMC", "MSMC2", "SMC++")
DEEP_GRADES = "CD"
# Deep past (layer 3): a genome-based Ne history rescaled to one mutation rate per year and to the
# pipeline's generation length, then Ne -> census N. See pipeline/history/README.md, "Deep past".
DEEP_MU_YEAR = 1.0e-9  # per site per year: Pantherinae pedigree mean 5.5e-9/gen at parental age 5.5 yr
DEEP_MU_YEAR_LO, DEEP_MU_YEAR_HI = 0.8e-9, 1.5e-9  # species pedigree rate / parental age: leopard, tiger
DEEP_NE_N, DEEP_NE_N_LO, DEEP_NE_N_HI = 0.1, 0.05, 0.3  # Ne/N (Frankham 1995 mean ~0.1), a wide range
DEEP_BLIND_YR = 20000.0  # PSMC resolves little in the last ~10-20 kyr: younger steps are dropped
DEEP_STEP_MAX = 64  # births pieces per curve span at most (deep spans are 1e4-1e6 years long)
DEEP_MU_CITE = ("Armstrong et al. 2025, Genome Biol Evol 17:evaf060 (Pantherinae pedigree rates)",
                "https://doi.org/10.1093/gbe/evaf060")
DEEP_NE_N_CITE = ("Frankham 1995, Genet Res 66:95-107 (Ne/N ~0.1 over comprehensive estimates)",
                  "https://doi.org/10.1017/S0016672300034455")
POINT_KEYS = {"year", "n", "lo", "hi", "grade", "kind", "cite", "url", "note"}
POINT_REQUIRED = POINT_KEYS - {"note"}
COMPONENTS = ("wild", "domestic", "total")
USES = ("counts", "display")

ALIVE_MIN_YEAR = 2000  # latest point replaces the model's alive-now only if this recent ...
ALIVE_MAX_GRADE = 2  # ... and graded A-C
STEP_YR = 5.0  # piecewise-constant births pieces along the curve
FAO_EVERY = 5
SPLIT_RATIO = 2.0
SUB_RATIO = math.sqrt(2.0)
FAO_CITE = "FAOSTAT QCL, Crops and livestock products: Stocks, World (FAO 2025); CC BY 4.0"
FAO_URL = "https://www.fao.org/faostat/en/#data/QCL"
HISTORY_SRC_LABEL = ("ToLaD curated population history (pipeline/history/*.toml): dated points with "
                     "per-point citations, see META.hist_sources")


class HistoryError(ValueError):
    pass


# ------------------------------------------------------------------ load + validate


def _check_point(p: dict, where: str) -> dict:
    if not isinstance(p, dict):
        raise HistoryError(f"{where}: not a table")
    extra = set(p) - POINT_KEYS
    if extra:
        raise HistoryError(f"{where}: unknown keys {sorted(extra)}")
    miss = POINT_REQUIRED - set(p)
    if miss:
        raise HistoryError(f"{where}: missing {sorted(miss)}")
    if not isinstance(p["year"], (int, float)) or isinstance(p["year"], bool):
        raise HistoryError(f"{where}: year must be a number")
    for k in ("n", "lo", "hi"):
        if not isinstance(p[k], (int, float)) or isinstance(p[k], bool) or not p[k] > 0:
            raise HistoryError(f"{where}: {k} must be a positive number")
    if not p["lo"] <= p["n"] <= p["hi"]:
        raise HistoryError(f"{where}: need lo <= n <= hi, got {p['lo']} {p['n']} {p['hi']}")
    if p["grade"] not in GRADES:
        raise HistoryError(f"{where}: grade {p['grade']!r} not in A-D")
    if p["kind"] not in POINT_KINDS:
        raise HistoryError(f"{where}: kind {p['kind']!r} not in {POINT_KINDS}")
    if p["kind"] == "unverified" and p["grade"] != "D":
        raise HistoryError(f"{where}: an unverified figure must be grade D")
    for k in ("cite", "url"):
        if not isinstance(p[k], str) or not p[k].strip():
            raise HistoryError(f"{where}: {k} must be a non-empty string")
    if not p["url"].startswith(("http://", "https://")):
        raise HistoryError(f"{where}: url must be http(s)")
    if p["year"] > NOW_YEAR:
        raise HistoryError(f"{where}: year {p['year']} is in the future")
    return {"year": float(p["year"]), "n": float(p["n"]), "lo": float(p["lo"]), "hi": float(p["hi"]),
            "grade": p["grade"], "kind": p["kind"], "cite": p["cite"].strip(), "url": p["url"].strip(),
            "note": str(p.get("note", "")).strip()}


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _check_deep(d: dict, where: str) -> dict:
    """The [deep] table: one genome-based Ne history, as read from the source (in its own scaling)."""
    if not isinstance(d, dict):
        raise HistoryError(f"{where}: not a table")
    extra = set(d) - DEEP_KEYS
    if extra:
        raise HistoryError(f"{where}: unknown keys {sorted(extra)}")
    miss = (DEEP_KEYS - {"note"}) - set(d)
    if miss:
        raise HistoryError(f"{where}: missing {sorted(miss)}")
    if d["method"] not in DEEP_METHODS:
        raise HistoryError(f"{where}: method {d['method']!r} not in {DEEP_METHODS}")
    if d["grade"] not in DEEP_GRADES:
        raise HistoryError(f"{where}: grade {d['grade']!r}: a genomic deep past is graded C or D")
    for k in ("cite", "url"):
        if not isinstance(d[k], str) or not d[k].strip():
            raise HistoryError(f"{where}: {k} must be a non-empty string")
    if not d["url"].startswith(("http://", "https://")):
        raise HistoryError(f"{where}: url must be http(s)")
    if not _num(d["mu"]) or not 1e-10 <= d["mu"] <= 1e-7:
        raise HistoryError(f"{where}: mu is the source's rate per site per generation (1e-10 .. 1e-7)")
    if not _num(d["g"]) or not 0.1 <= d["g"] <= 100:
        raise HistoryError(f"{where}: g is the source's generation time in years")
    steps = d["steps"]
    if not isinstance(steps, list) or len(steps) < 3:
        raise HistoryError(f"{where}: steps must list at least 3 [from_yr, to_yr, ne] steps")
    prev = 0.0
    for i, st in enumerate(steps):
        if not (isinstance(st, list) and len(st) == 3 and all(_num(v) for v in st)):
            raise HistoryError(f"{where}: step {i + 1} must be [from_yr, to_yr, ne]")
        a, b, ne = st
        if not (0 < a < b and ne > 0):
            raise HistoryError(f"{where}: step {i + 1} needs 0 < from_yr < to_yr and ne > 0")
        if a < prev:
            raise HistoryError(f"{where}: steps must run young to old without overlap (step {i + 1})")
        prev = b
    return {"method": d["method"], "cite": d["cite"].strip(), "url": d["url"].strip(), "mu": float(d["mu"]),
            "g": float(d["g"]), "grade": d["grade"], "note": str(d.get("note", "")).strip(),
            "steps": [[float(a), float(b), float(ne)] for a, b, ne in steps]}


def validate(doc: dict, name: str = "<doc>") -> dict:
    """Check one parsed history file; return the normalised record."""
    extra = set(doc) - TOP_KEYS
    if extra:
        raise HistoryError(f"{name}: unknown keys {sorted(extra)}")
    for k in ("species", "component"):
        if not isinstance(doc.get(k), str) or not doc[k]:
            raise HistoryError(f"{name}: missing {k}")
    if doc["component"] not in COMPONENTS:
        raise HistoryError(f"{name}: component {doc['component']!r} not in {COMPONENTS}")
    use = doc.get("use", "counts")
    if use not in USES:
        raise HistoryError(f"{name}: use {use!r} not in {USES}")
    fao = doc.get("faostat_item")
    if fao is not None and (doc["component"] != "domestic" or not isinstance(fao, int)):
        raise HistoryError(f"{name}: faostat_item is an integer item code, domestic files only")
    pts = doc.get("point", [])
    if not isinstance(pts, list):
        raise HistoryError(f"{name}: point must be an array of tables ([[point]])")
    points = [_check_point(p, f"{name} point {i + 1}") for i, p in enumerate(pts)]
    base = None
    if "baseline" in doc:
        base = _check_point(doc["baseline"], f"{name} baseline")
        if points and base["year"] > min(p["year"] for p in points):
            raise HistoryError(f"{name}: baseline year {base['year']} is after the first point")
    if not points and base is None and fao is None:
        raise HistoryError(f"{name}: no points")
    years = [p["year"] for p in points]
    if len(set(years)) != len(years):
        raise HistoryError(f"{name}: two points share a year")
    deep = _check_deep(doc["deep"], f"{name} deep") if "deep" in doc else None
    if deep is not None and (doc["component"] != "wild" or use != "counts"):
        raise HistoryError(f"{name}: a deep past is for wild species with use = \"counts\"")
    aliases = doc.get("aliases", [])
    if not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases):
        raise HistoryError(f"{name}: aliases must be a list of strings")
    return {
        "species": doc["species"], "aliases": aliases, "common": str(doc.get("common", "")),
        "component": doc["component"], "use": use, "scope": str(doc.get("scope", "")),
        "faostat_item": fao, "notes": str(doc.get("notes", "")).strip(),
        "baseline": base, "points": sorted(points, key=lambda p: p["year"]), "deep": deep,
    }


def load_all(d: Path = HIST_DIR) -> list[dict]:
    out = []
    seen = set()
    for f in sorted(d.glob("*.toml")):
        with f.open("rb") as fh:
            try:
                doc = tomllib.load(fh)
            except tomllib.TOMLDecodeError as e:
                raise HistoryError(f"{f.name}: {e}") from e
        rec = validate(doc, f.name)
        want = rec["species"].replace(" ", "_") + ".toml"
        if f.name != want:
            raise HistoryError(f"{f.name}: file name should be {want}")
        if rec["species"] in seen:
            raise HistoryError(f"{f.name}: duplicate species")
        seen.add(rec["species"])
        rec["file"] = f.name
        out.append(rec)
    return out


def faostat_series(raw: Path, items: set[int]) -> dict[int, dict[int, float]]:
    """FAOSTAT QCL World stocks (element 5111) by item code -> {year: head}."""
    z = zipfile.ZipFile(raw / "faostat" / "Production_Crops_Livestock_E_All_Data_(Normalized).zip")
    name = "Production_Crops_Livestock_E_All_Data_(Normalized).csv"
    out: dict[int, dict[int, float]] = {i: {} for i in items}
    with z.open(name) as fb:
        for row in csv.DictReader(io.TextIOWrapper(fb, encoding="latin-1")):
            if row["Area Code"] != "5000" or row["Element Code"] != "5111":
                continue
            ic = int(row["Item Code"])
            if ic in out and row["Value"]:
                out[ic][int(row["Year"])] = float(row["Value"])
    return out


def add_faostat(rec: dict, series: dict[int, float]) -> None:
    """FAOSTAT 1961-latest, every FAO_EVERY years plus the latest, as grade B census points."""
    if not series:
        raise HistoryError(f"{rec['file']}: FAOSTAT item {rec['faostat_item']} has no World stocks")
    last = max(series)
    yrs = [y for y in sorted(series) if y % FAO_EVERY == 1 or y == last]  # 1961, 1966, ...
    have = {p["year"] for p in rec["points"]}
    for y in yrs:
        if float(y) in have:
            continue
        v = series[y]
        rec["points"].append({"year": float(y), "n": v, "lo": v, "hi": v, "grade": "B", "kind": "census",
                              "cite": FAO_CITE, "url": FAO_URL,
                              "note": f"World stocks, item {rec['faostat_item']}, {y}"})
    rec["points"].sort(key=lambda p: p["year"])


# ------------------------------------------------------------------ curve


def curve_points(rec: dict) -> list[dict]:
    """Baseline (if any) + points, sorted by year."""
    pts = list(rec["points"])
    if rec["baseline"] is not None and not any(p["year"] == rec["baseline"]["year"] for p in pts):
        pts.append({**rec["baseline"], "baseline": True})
    return sorted(pts, key=lambda p: p["year"])


def deep_scale(deep: dict, G: float) -> tuple[float, float]:
    """(time factor, Ne factor) taking the source's scaling to DEEP_MU_YEAR and generation length G.

    PSMC infers theta = 4 Ne mu_gen and coalescent time in units of 2 Ne generations, so a curve
    published with (mu per generation, g years) gives, for a per-year rate mu_y and generation G:
        t' = t * (mu / g) / mu_y            (time scales with the per-year rate only)
        Ne' = Ne * mu / (mu_y * G)          (Ne scales with the per-generation rate mu_y * G)
    """
    return (deep["mu"] / deep["g"]) / DEEP_MU_YEAR, deep["mu"] / (DEEP_MU_YEAR * G)


def deep_points(deep: dict, G: float, start_year: float | None = None) -> tuple[list[dict], list[dict]]:
    """[deep] steps -> dated `genomic` points (census N) and the steps dropped, oldest first.

    Each step becomes one point at its log-midpoint in time. N = Ne' / DEEP_NE_N; lo / hi carry the
    Ne/N range and the per-year mutation-rate range. Steps younger than DEEP_BLIND_YR (PSMC's blind
    spot) or older than the species band start are dropped (returned with a `why`)."""
    kt, kn = deep_scale(deep, G)
    keep, drop = [], []
    for a, b, ne in deep["steps"]:
        ago = math.sqrt(a * b) * kt
        ne2 = ne * kn
        p = {"year": NOW_YEAR - ago, "n": ne2 / DEEP_NE_N,
             "lo": ne2 * (DEEP_MU_YEAR / DEEP_MU_YEAR_HI) / DEEP_NE_N_HI,
             "hi": ne2 * (DEEP_MU_YEAR / DEEP_MU_YEAR_LO) / DEEP_NE_N_LO,
             "grade": deep["grade"], "kind": "genomic", "cite": deep["cite"], "url": deep["url"],
             "ne": ne2, "ago": ago,
             "note": (f"{deep['method']} step {a:.0f}-{b:.0f} yr ago, Ne {ne:.0f} as published "
                      f"(mu {deep['mu']:.3g}/gen, g {deep['g']:g} yr); rescaled to {a * kt:.0f}-{b * kt:.0f} "
                      f"yr ago, Ne {ne2:.0f}; N = Ne / {DEEP_NE_N:g}")}
        if ago < DEEP_BLIND_YR:
            drop.append({**p, "why": "blind"})
        elif start_year is not None and p["year"] < start_year:
            drop.append({**p, "why": "before band"})
        else:
            keep.append(p)
    by_year = lambda p: p["year"]  # noqa: E731
    return sorted(keep, key=by_year), sorted(drop, key=by_year)


def interp(pts: list[dict], year: float) -> float:
    """Log-linear interpolation through the points, flat outside them."""
    if year <= pts[0]["year"]:
        return pts[0]["n"]
    if year >= pts[-1]["year"]:
        return pts[-1]["n"]
    for a, b in zip(pts, pts[1:]):
        if a["year"] <= year <= b["year"]:
            f = (year - a["year"]) / (b["year"] - a["year"])
            return math.exp(math.log(a["n"]) * (1 - f) + math.log(b["n"]) * f)
    raise AssertionError


def mean_loglinear(n0: float, n1: float) -> float:
    """Mean of a log-linear ramp from n0 to n1."""
    if n0 <= 0 or n1 <= 0:
        return 0.0
    k = math.log(n1 / n0)
    return n0 if abs(k) < 1e-12 else (n1 - n0) / k


def curve_pieces(pts: list[dict], L: float, t0_ma: float, end_year: float = NOW_YEAR,
                 step: float = STEP_YR, pre_level: float | None = None) -> list[tuple[float, float, float]]:
    """Births pieces [(old_Ma, young_Ma, births/yr)] for a curve: a level held
    from the band start t0 to the first point (the first point's own level, or
    `pre_level` if given), then the curve in steps of at most `step` years
    (each piece = the exact mean of the log-linear curve over it), then the
    last level held to end_year."""
    y_first = pts[0]["year"]
    out = []
    if year_to_ma(y_first) < t0_ma:
        out.append((t0_ma, year_to_ma(y_first), (pts[0]["n"] if pre_level is None else pre_level) / L))
    knots = [p["year"] for p in pts] + ([end_year] if end_year > pts[-1]["year"] else [])
    for ya, yb in zip(knots, knots[1:]):
        if ya < year_to_ma_inv(t0_ma):
            ya = year_to_ma_inv(t0_ma)
        if yb <= ya:
            continue
        # pieces of at most `step` years; a deep (genomic) span is cut into DEEP_STEP_MAX pieces
        m = max(1, math.ceil((yb - ya) / step)) if yb - ya <= 1e4 else DEEP_STEP_MAX
        for j in range(m):
            a = ya + (yb - ya) * j / m
            b = ya + (yb - ya) * (j + 1) / m
            r = mean_loglinear(interp(pts, a), interp(pts, b)) / L
            out.append((year_to_ma(a), year_to_ma(b), r))
    return out


def year_to_ma_inv(ma: float) -> float:
    return NOW_YEAR - ma * 1e6


def pieces_births(pieces) -> float:
    return sum((o - y) * 1e6 * r for o, y, r in pieces)


# ------------------------------------------------------------------ segments


def compile_segments(pts: list[dict], G: float, L: float, t0_ma: float, has_baseline: bool,
                     end_year: float = NOW_YEAR, pre_level: float | None = None,
                     pre_grade: int = 3) -> list[dict]:
    """Curve -> procgen segments (see _segments). With `pre_level`, the span
    from the band start to the first point is one segment held at that level
    (kind `model`: no baseline is known, so the model's level stands), and the
    curve's segments follow it, with a step at the first point."""
    if pre_level is None:
        return _segments(pts, G, L, t0_ma, has_baseline, end_year)
    segs = _segments(pts, G, L, year_to_ma(pts[0]["year"]), has_baseline, end_year)
    g_curve = round(segs[0]["gens"] + sum(s["gens"] for s in segs[1:]))
    g_start = round((end_year - year_to_ma_inv(t0_ma)) / G)
    if g_start > g_curve:
        bpg = G / L
        segs.insert(0, {"year0": end_year - g_start * G, "gens": g_start - g_curve, "start": pre_level * bpg,
                        "end": pre_level * bpg, "grade": pre_grade, "kind": K["model"]})
    return segs


def _segments(pts: list[dict], G: float, L: float, t0_ma: float, has_baseline: bool,
              end_year: float = NOW_YEAR) -> list[dict]:
    """Curve -> procgen segments, oldest first, contiguous, ending at end_year.

    births per generation = N(t) * G / L. Knots sit on whole generations
    counted back from end_year: the band start (t0), the two generation
    boundaries around each point, and now. Each knot carries the curve's value
    at its year, so segments join without jumps. A span whose level
    changes by more than SPLIT_RATIO is split evenly in time (= evenly in log
    level, the curve being log-linear there) into sub-spans of at most
    SUB_RATIO, as far as whole generations allow."""
    bpg = G / L
    start_year = year_to_ma_inv(t0_ma)

    def snap(year: float) -> int:  # generations before end_year, rounded
        return max(0, round((end_year - year) / G))

    def year_of(g: int) -> float:
        return end_year - g * G

    g_start = max(snap(start_year), math.ceil((end_year - pts[0]["year"]) / G - 1e-9), 1)
    # base knots: band start, now, and the two generation boundaries around each point
    base = {0, g_start}
    for p in pts:
        x = (end_year - p["year"]) / G
        base |= {min(max(math.floor(x + 1e-9), 0), g_start), min(max(math.ceil(x - 1e-9), 0), g_start)}
    base = sorted(base, reverse=True)
    lev = {g: interp(pts, year_of(g)) for g in base}
    # between base knots the curve is one log-linear piece: split big changes
    for ga, gb in zip(base, base[1:]):
        ratio = max(lev[ga], lev[gb]) / min(lev[ga], lev[gb])
        if ratio > SPLIT_RATIO and ga - gb >= 2:
            m = min(math.ceil(math.log(ratio) / math.log(SUB_RATIO) - 1e-9), ga - gb)
            for j in range(1, m):
                g = round(ga - (ga - gb) * j / m)
                if ga > g > gb:
                    lev[g] = interp(pts, year_of(g))
    knots = sorted(lev, reverse=True)

    def level(g: int) -> float:
        return lev[g]
    segs = []
    for g0, g1 in zip(knots, knots[1:]):
        mid = (year_of(g0) + year_of(g1)) / 2
        if mid < pts[0]["year"]:
            kind, gr = (K["baseline"] if has_baseline else K["held"]), GRADES.index(pts[0]["grade"])
        elif mid > pts[-1]["year"]:
            kind, gr = K["held"], GRADES.index(pts[-1]["grade"])
        else:
            a, b = next((a, b) for a, b in zip(pts, pts[1:]) if a["year"] <= mid <= b["year"])
            kind = K["genomic"] if a["kind"] == b["kind"] == "genomic" else K["interpolated"]
            gr = max(GRADES.index(a["grade"]), GRADES.index(b["grade"]))
        segs.append({"year0": year_of(g0), "gens": g0 - g1, "start": level(g0) * bpg, "end": level(g1) * bpg,
                     "grade": gr, "kind": kind})
    return segs


def segments_births(segs: list[dict]) -> float:
    return sum(s["gens"] * (s["start"] + s["end"]) / 2 for s in segs)


# ------------------------------------------------------------------ apply to the tree


def _sd_of(p: dict) -> float:
    """95% range -> log10 sd."""
    return math.log10(p["hi"] / p["lo"]) / (2 * 1.96)


def apply(root, raw: Path, log: dict, src_bit: int, recs: list[dict] | None = None) -> list[dict]:
    """Rewrite curated leaves in place (before sum_tree). Returns the records
    with their compiled curve, segments and tree location."""
    recs = load_all() if recs is None else recs
    leaves = {}
    for n in root.preorder():
        if n.is_leaf and n.name and (not n.extinct or n.name not in leaves):
            leaves[n.name] = n if not n.extinct else leaves.get(n.name, n)
    fao_items = {r["faostat_item"] for r in recs if r["faostat_item"] is not None}
    series = faostat_series(raw, fao_items) if fao_items else {}
    report = {}
    missing = []
    for rec in recs:
        cands = [rec["species"]] + rec["aliases"] + DOMESTIC_ALIASES.get(rec["species"], [])
        # a domestic form may sit on a leaf flagged extinct in the wild (dromedary)
        leaf = next((leaves[c] for c in cands
                     if c in leaves and (not leaves[c].extinct or rec["component"] == "domestic")), None)
        if leaf is None:
            missing.append(rec["species"])
            continue
        if rec["faostat_item"] is not None:
            add_faostat(rec, series[rec["faostat_item"]])
        D = leaf.data
        L = D["L"]
        G = 2 * L
        pts = curve_points(rec)
        # the deep past: genomic points older than the cited ones, joined to the first cited
        # point (or baseline) by the usual log-linear span across PSMC's blind spot
        deep_pts, rec["deep_dropped"] = (deep_points(rec["deep"], G, year_to_ma_inv(leaf.t0))
                                         if rec["deep"] else ([], []))
        if deep_pts and deep_pts[-1]["year"] >= pts[0]["year"]:
            raise HistoryError(f"{rec['file']}: genomic points reach the cited ones ({deep_pts[-1]['year']:.0f})")
        rec["deep_points"] = deep_pts
        pts = deep_pts + pts
        rec["leaf"] = leaf
        rec["G"], rec["L"] = G, L
        before = {"alive": D["alive"], "ever": D["ever_med"], "grade_cap": D["grade_cap"],
                  "sd_leaf": D["sd_leaf"]}
        nw = D.get("n_wild_pieces", len(D["pieces"]))
        model_now = None
        if rec["use"] == "counts":
            if rec["component"] == "wild":
                model_now = D.get("rate_wild_now", 0.0) * L
            elif rec["component"] == "domestic":
                model_now = D.get("domestic", {}).get("stock")
        last = pts[-1]
        alive_from_hist = last["year"] >= ALIVE_MIN_YEAR and GRADES.index(last["grade"]) <= ALIVE_MAX_GRADE
        if rec["use"] == "counts" and not alive_from_hist and model_now:
            # end the curve at the model's alive-now, so the green lane and the curve agree
            pts = pts + [{"year": NOW_YEAR, "n": model_now, "lo": model_now, "hi": model_now,
                          "grade": "ABCD"[min(3, D["grade_cap"])], "kind": "model",
                          "cite": "ToLaD model (stats.json, this leaf)", "url": "https://github.com/theitush/ToLaD",
                          "note": "the pipeline's alive-now for this leaf; no recent graded point"}]
        rec["curve"] = pts
        if rec["use"] == "counts" and rec["component"] == "wild":
            if D.get("domestic") and nw == len(D["pieces"]):
                raise HistoryError(f"{rec['file']}: domestic leaf without n_wild_pieces")
            n_now = pts[-1]["n"]
            # no baseline: the deep past keeps the level of today's count (as the model had it);
            # with a genomic deep past the oldest genomic level is held back to the band start
            pre = None if (rec["baseline"] or deep_pts) else n_now
            new = curve_pieces(pts, L, leaf.t0, pre_level=pre)
            D["pieces"] = new + D["pieces"][nw:]
            D["n_wild_pieces"] = len(new)
            D["alive"] = n_now + (D["domestic"]["stock"] if D.get("domestic") else 0.0)
            D["rate_wild_now"] = n_now / L
        elif rec["use"] == "counts" and rec["component"] == "domestic":
            if not D.get("domestic"):
                raise HistoryError(f"{rec['file']}: {leaf.name} has no domestic component in the model")
            dom = D["pieces"][nw:]
            y_first = pts[0]["year"]
            a_first = year_to_ma(y_first)
            # keep the human-births-shaped growth before the first point, rescaled to meet it
            r_at = next((r for o, y, r in dom if y <= a_first <= o), dom[-1][2] if dom else 0.0)
            s = (pts[0]["n"] / L) / r_at if r_at > 0 else 1.0
            early = [(o, max(y, a_first), r * s) for o, y, r in dom if o > a_first]
            new = curve_pieces(pts, L, a_first)
            D["pieces"] = D["pieces"][:nw] + early + new
            D["alive"] = D["alive"] - D["domestic"]["stock"] + pts[-1]["n"]
        if rec["use"] == "counts":
            # the deep-past level: the baseline, else today's level (wild) or the first point (domestic)
            base = rec["baseline"] or (pts[-1] if rec["component"] == "wild" else pts[0])
            refs = [base] + deep_pts[:1]  # the genomic deep past dominates "ever" when present
            D["ever_med"] = pieces_births(D["pieces"])
            # the deep-past level sets "ever": widen the error by its range, cap the grade by its grade
            D["sd_leaf"] = math.hypot(D["sd_leaf"], max(_sd_of(r) for r in refs))
            D["grade_cap"] = max([D["grade_cap"]] + [GRADES.index(r["grade"]) for r in refs])
            D["meth"].append(f"H:curated history ({len(rec['points'])} points"
                             + (f", baseline {base['n']:.3g} in {base['year']:.0f} ({base['grade']})"
                                if rec["baseline"] else "")
                             + (f", deep past {rec['deep']['method']} {len(deep_pts)} points "
                                f"({rec['deep']['grade']}; {rec['deep']['cite']})" if deep_pts else "")
                             + f"; pipeline/history/{rec['file']})")
            D["src"].add(src_bit)
            D["anchored_count"] = True
        D["history"] = rec
        # wild: the first segment holds the baseline back to the band start; domestic and
        # humans: segments cover the curated span only (before it the model's own shape stands)
        t0_seg = leaf.t0 if rec["component"] == "wild" else year_to_ma(pts[0]["year"])
        pre = (pts[-1]["n"] if rec["use"] == "counts" and rec["component"] == "wild" and not rec["baseline"]
               and not deep_pts else None)
        rec["segments"] = compile_segments(pts, G, L, t0_seg, rec["baseline"] is not None and not deep_pts,
                                           pre_level=pre, pre_grade=min(3, D["grade_cap"]))
        deep_rep = None
        if deep_pts:
            nxt = next(p for p in pts if p["kind"] != "genomic")
            deep_rep = {
                "method": rec["deep"]["method"], "cite": rec["deep"]["cite"], "grade": rec["deep"]["grade"],
                "points": len(deep_pts), "dropped_blind": sum(p["why"] == "blind" for p in rec["deep_dropped"]),
                "dropped_before_band": sum(p["why"] != "blind" for p in rec["deep_dropped"]),
                "oldest_yr_ago": NOW_YEAR - deep_pts[0]["year"], "youngest_yr_ago": NOW_YEAR - deep_pts[-1]["year"],
                "band_start_yr_ago": leaf.t0 * 1e6,
                "time_factor": deep_scale(rec["deep"], G)[0], "ne_factor": deep_scale(rec["deep"], G)[1],
                "join": {"deep_n": deep_pts[-1]["n"], "to_year": nxt["year"], "to_n": nxt["n"],
                         "ratio": deep_pts[-1]["n"] / nxt["n"]},
            }
        report[rec["species"]] = {
            "file": rec["file"], "leaf": leaf.name, "use": rec["use"], "component": rec["component"],
            "points": len(rec["points"]), "grades": "".join(sorted({p["grade"] for p in rec["points"]})),
            "baseline": ({k: rec["baseline"][k] for k in ("year", "n", "lo", "hi", "grade", "kind")}
                         if rec["baseline"] else None),
            "alive_before": before["alive"], "alive_after": D["alive"],
            "alive_from": "history" if alive_from_hist else "model",
            "ever_before": before["ever"], "ever_after": D["ever_med"],
            "ever_ratio": D["ever_med"] / before["ever"] if before["ever"] > 0 else None,
            "G_yr": G, "segments": len(rec["segments"]), "domestic_on_leaf": bool(D.get("domestic")),
            "deep": deep_rep,
        }
    if missing:
        raise HistoryError(f"history species not found among living tree leaves: {missing}")
    log["history"] = {
        "note": "Curated flagship histories (pipeline/history/). ever_before = the model with today's count "
                "held over the whole band; ever_after = with the pre-decline baseline / curve. Leaf values, "
                "before the tree sum.",
        "species": report,
    }
    return [r for r in recs if "leaf" in r]
