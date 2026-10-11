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
              Ne/N = 0.1, steps in PSMC's blind spot (< 20 kyr) dropped unless a
              [deep.blind] source dates a decline there (kept, grade D; ToLaD#143); the
              genome gives the shape, the anchor the number: the whole curve is scaled
              to meet the higher of the first cited count (any year) and the modelled
              natural level (then the range-loss trend runs down to the count), else
              the modelled level, and held flat to it; a factor beyond 10x is flagged
              (deep_join, ToLaD#143)
    natural   with no cited baseline and no [deep], the natural (pre-human) baseline
              (model.natural_level, NATB) is held from the band start to the first
              point. Precedence before the cited points: genomic > natural > today
    rangeloss a species with no history file whose natural baseline differs from
              today's count gets a modelled two-point record instead (model.py,
              rangeloss_record): a log-linear decline from 1500 CE to now. A history
              file replaces it, but where its deep past ends at the natural level (no
              [deep], or a [deep] anchored on it) the trend fills the gap from 1500 to
              its first cited point (ToLaD#71, #143); never upward: where the natural level is
              below that point, the cited level is held back to 1500 instead (ToLaD#93)

`apply` rewrites the leaf's pieces / alive / error before sum_tree, so the
existing sum-up and ghost allocation keep the totals consistent up the tree.
"""

from __future__ import annotations

import csv
import io
import math
import tomllib
import zipfile
from collections import Counter
from pathlib import Path

import numpy as np

from .anchors import DOMESTIC_ALIASES, NOW_YEAR, year_to_ma
from . import mutation

HIST_DIR = Path(__file__).resolve().parents[1] / "history"

GRADES = "ABCD"
POINT_KINDS = ["census", "estimate", "index-scaled", "reconstruction", "unverified"]
# point kinds, then span-only kinds, then kinds appended later (the index is the HIST kind code, so
# new kinds are only ever appended): `genomic` (points compiled from [deep], and the spans between two
# of them; ToLaD#60), `natural` (the natural baseline held before the first point; ToLaD#61) and
# `rangeloss` (the modelled decline from the natural baseline to today's count of a species with no
# history file, and its start point; ToLaD#62, see model.rangeloss_record)
KINDS = POINT_KINDS + ["model", "interpolated", "held", "baseline", "genomic", "natural", "rangeloss"]
K = {k: i for i, k in enumerate(KINDS)}

TOP_KEYS = {"species", "aliases", "common", "component", "use", "scope", "faostat_item", "notes",
            "baseline", "point", "deep", "event"}
# A curated event in a species' past (ToLaD#141): today only a population bottleneck, marked on the fan's
# column over its window and explained on the card with the source quoted verbatim.
EVENT_KINDS = ("bottleneck",)
EVENT_KEYS = {"kind", "from_ya", "to_ya", "title", "summary", "quote", "cite", "url", "grade", "region", "scope",
              "scope_why"}
EVENT_REQUIRED = EVENT_KEYS - {"region", "scope", "scope_why"}
# Whom an event concerns (ToLaD#149): "species" (the whole species: tinted on the fan's column, which must fall
# through its window) or "regional" (a subpopulation named by `region`: on the card and its sparkline only, since
# the column is the whole species and cannot narrow for a few % of it). `scope_why` says why, in one line.
EVENT_SCOPES = ("species", "regional")
EVENT_TITLE_MAX = 40  # characters: the title is the label on the fan
DEEP_KEYS = {"method", "cite", "url", "mu", "g", "grade", "note", "steps", "blind"}
# [deep.blind]: a source dating a decline inside PSMC's blind spot, which keeps the blind steps (ToLaD#143)
BLIND_KEYS = {"cite", "url", "quote", "window", "note"}
DEEP_METHODS = ("PSMC", "MSMC", "MSMC2", "SMC++")
DEEP_GRADES = "CD"
# Deep past (layer 3): a genome-based Ne history rescaled to the lineage's mutation rate per year
# (mutation.py: a pedigree fit on generation length with per-order offsets, ToLaD#74/#75) and to the
# pipeline's generation length, then Ne -> census N. See pipeline/history/README.md, "Deep past".
# The flat rate below is the fallback (no rate table on disk) and the reference the per-lineage
# factor (`mu.vs_flat`) is quoted against.
DEEP_MU_YEAR = 1.0e-9  # per site per year: Pantherinae pedigree mean 5.5e-9/gen at parental age 5.5 yr
DEEP_MU_YEAR_LO, DEEP_MU_YEAR_HI = 0.8e-9, 1.5e-9  # species pedigree rate / parental age: leopard, tiger
DEEP_NE_N, DEEP_NE_N_LO, DEEP_NE_N_HI = 0.1, 0.05, 0.3  # Ne/N (Frankham 1995 mean ~0.1), a wide range
DEEP_BLIND_YR = 20000.0  # PSMC resolves little in the last ~10-20 kyr: younger steps are marked blind (D)
BLIND_KEEP_MAX_YEAR = 1500  # blind steps are kept only before this (model.NATURAL_STEP_YEAR, the trend's knot)
# A join that runs against the dropped blind steps (their mean level this far from the youngest resolved
# step, which the flat span from that step to the next level then runs against) is flagged `blind.against`
# and said on the card (ToLaD#143)
BLIND_AGAINST = 1.5
DEEP_STEP_MAX = 64  # births pieces per curve span at most (deep spans are 1e4-1e6 years long)
# The genome gives the shape, the next level gives the number (Ita, ToLaD#143, replacing #77/#80/#71):
# the whole genomic curve is scaled to meet the first cited count (any year), else the modelled level;
# a scale factor beyond this either way is flagged.
DEEP_JOIN_FLAG = 10.0
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
# a genomic deep past (log-linear over 10^4-10^6 years) holds most of a species' births, and procgen ramps
# linearly: a linear ramp over a ratio r overcounts the log-linear curve by ~ln(r)^2/24 (2% at r = 2), which
# rescaled to EVER put today's count 0.8% low (the jaguar, ToLaD#70). Split genomic spans to at most this
# ratio (<= 0.02% each); 75-150 segments for a Panthera species.
DEEP_SUB_RATIO = 1.05
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


def _check_event(e: dict, where: str) -> dict:
    """One [[event]] (ToLaD#141): a dated window in years before present, explained and sourced."""
    if not isinstance(e, dict):
        raise HistoryError(f"{where}: not a table")
    extra = set(e) - EVENT_KEYS
    if extra:
        raise HistoryError(f"{where}: unknown keys {sorted(extra)}")
    miss = EVENT_REQUIRED - set(e)
    if miss:
        raise HistoryError(f"{where}: missing {sorted(miss)}")
    if e["kind"] not in EVENT_KINDS:
        raise HistoryError(f"{where}: kind {e['kind']!r} not in {EVENT_KINDS}")
    for k in ("from_ya", "to_ya"):
        if not _num(e[k]) or not math.isfinite(e[k]):
            raise HistoryError(f"{where}: {k} must be a number (years before present)")
    if not e["from_ya"] > e["to_ya"] >= 0:
        raise HistoryError(f"{where}: need from_ya > to_ya >= 0 (older end first), got {e['from_ya']} {e['to_ya']}")
    for k in ("title", "summary", "quote", "cite", "url") + (("region",) if "region" in e else ()):
        if not isinstance(e[k], str) or not e[k].strip():
            raise HistoryError(f"{where}: {k} must be a non-empty string")
    if len(e["title"].strip()) > EVENT_TITLE_MAX:
        raise HistoryError(f"{where}: title longer than {EVENT_TITLE_MAX} characters (it is the fan's label)")
    scope = e.get("scope", "species")
    if scope not in EVENT_SCOPES:
        raise HistoryError(f"{where}: scope {scope!r} not in {EVENT_SCOPES}")
    if scope == "regional" and not str(e.get("region", "")).strip():
        raise HistoryError(f"{where}: a regional event names its region")
    if "scope_why" in e and (not isinstance(e["scope_why"], str) or not e["scope_why"].strip()):
        raise HistoryError(f"{where}: scope_why must be a non-empty string")
    if not e["url"].startswith(("http://", "https://")):
        raise HistoryError(f"{where}: url must be http(s)")
    if e["grade"] not in GRADES:
        raise HistoryError(f"{where}: grade {e['grade']!r} not in A-D")
    return {"kind": e["kind"], "from_ya": float(e["from_ya"]), "to_ya": float(e["to_ya"]),
            "title": e["title"].strip(), "summary": " ".join(e["summary"].split()),
            "quote": " ".join(e["quote"].split()), "cite": e["cite"].strip(), "url": e["url"].strip(),
            "grade": e["grade"], "region": str(e.get("region", "")).strip(), "scope": scope,
            "scope_why": " ".join(str(e.get("scope_why", "")).split())}


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _check_deep(d: dict, where: str) -> dict:
    """The [deep] table: one genome-based Ne history, as read from the source (in its own scaling)."""
    if not isinstance(d, dict):
        raise HistoryError(f"{where}: not a table")
    extra = set(d) - DEEP_KEYS
    if extra:
        raise HistoryError(f"{where}: unknown keys {sorted(extra)}")
    miss = (DEEP_KEYS - {"note", "blind"}) - set(d)
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
            "steps": [[float(a), float(b), float(ne)] for a, b, ne in steps],
            "blind": _check_blind(d["blind"], f"{where}.blind") if "blind" in d else None}


def _check_blind(b: dict, where: str) -> dict:
    """[deep.blind]: a cited source dating a decline inside PSMC's blind spot (ToLaD#143). `window` is
    [from, to] years before present as the source dates it, and must reach into the blind spot."""
    if not isinstance(b, dict):
        raise HistoryError(f"{where}: not a table")
    extra, miss = set(b) - BLIND_KEYS, (BLIND_KEYS - {"note"}) - set(b)
    if extra or miss:
        raise HistoryError(f"{where}: unknown keys {sorted(extra)}, missing {sorted(miss)}")
    for k in ("cite", "url", "quote"):
        if not isinstance(b[k], str) or not b[k].strip():
            raise HistoryError(f"{where}: {k} must be a non-empty string")
    if not b["url"].startswith(("http://", "https://")):
        raise HistoryError(f"{where}: url must be http(s)")
    w = b["window"]
    if not (isinstance(w, list) and len(w) == 2 and all(_num(v) for v in w) and 0 <= w[0] < w[1]
            and w[0] < DEEP_BLIND_YR):
        raise HistoryError(f"{where}: window is [from, to] years ago, from < to, reaching into the last "
                           f"{DEEP_BLIND_YR:g} years")
    return {"cite": b["cite"].strip(), "url": b["url"].strip(), "quote": " ".join(b["quote"].split()),
            "window": [float(w[0]), float(w[1])], "note": str(b.get("note", "")).strip()}


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
    # a blind-only [deep] (just [deep.blind], ToLaD#149) dates a decline in the blind spot of the bulk
    # curve (genomic.py) the file gets as its deep past; genomic.attach carries it over
    blind_only = isinstance(doc.get("deep"), dict) and set(doc["deep"]) == {"blind"}
    deep = _check_deep(doc["deep"], f"{name} deep") if "deep" in doc and not blind_only else None
    deep_blind = _check_blind(doc["deep"]["blind"], f"{name} deep.blind") if blind_only else None
    if (deep is not None or blind_only) and (doc["component"] != "wild" or use != "counts"):
        raise HistoryError(f"{name}: a deep past is for wild species with use = \"counts\"")
    evs = doc.get("event", [])
    if not isinstance(evs, list):
        raise HistoryError(f"{name}: event must be an array of tables ([[event]])")
    events = sorted((_check_event(e, f"{name} event {i + 1}") for i, e in enumerate(evs)),
                    key=lambda e: (-e["from_ya"], -e["to_ya"]))
    aliases = doc.get("aliases", [])
    if not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases):
        raise HistoryError(f"{name}: aliases must be a list of strings")
    return {
        "species": doc["species"], "aliases": aliases, "common": str(doc.get("common", "")),
        "component": doc["component"], "use": use, "scope": str(doc.get("scope", "")),
        "faostat_item": fao, "notes": str(doc.get("notes", "")).strip(),
        "baseline": base, "points": sorted(points, key=lambda p: p["year"]), "deep": deep,
        "deep_blind": deep_blind, "events": events,
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


def deep_scale(deep: dict, G: float, mu_y: float = DEEP_MU_YEAR) -> tuple[float, float]:
    """(time factor, Ne factor) taking the source's scaling to the per-year rate mu_y (the lineage's,
    mutation.rate; DEEP_MU_YEAR by default) and generation length G.

    PSMC infers theta = 4 Ne mu_gen and coalescent time in units of 2 Ne generations, so a curve
    published with (mu per generation, g years) gives, for a per-year rate mu_y and generation G:
        t' = t * (mu / g) / mu_y            (time scales with the per-year rate only)
        Ne' = Ne * mu / (mu_y * G)          (Ne scales with the per-generation rate mu_y * G)
    """
    return (deep["mu"] / deep["g"]) / mu_y, deep["mu"] / (mu_y * G)


def deep_points(deep: dict, G: float, start_year: float | None = None,
                mu: dict | None = None) -> tuple[list[dict], list[dict]]:
    """[deep] steps -> dated `genomic` points (census N) and the steps dropped, oldest first.

    Each step becomes one point at its log-midpoint in time. N = Ne' / DEEP_NE_N; lo / hi carry the
    Ne/N range and the per-year mutation-rate range. Steps younger than DEEP_BLIND_YR (PSMC's blind
    spot) or older than the species band start are dropped (returned with a `why`). `mu` is the
    lineage's rate (mutation.rate: mu, lo, hi); None takes the flat DEEP_MU_YEAR and its range."""
    mu = mu or {"mu": DEEP_MU_YEAR, "lo": DEEP_MU_YEAR_LO, "hi": DEEP_MU_YEAR_HI}
    kt, kn = deep_scale(deep, G, mu["mu"])
    keep, drop = [], []
    for a, b, ne in deep["steps"]:
        ago = math.sqrt(a * b) * kt
        ne2 = ne * kn
        p = {"year": NOW_YEAR - ago, "n": ne2 / DEEP_NE_N,
             "lo": ne2 * (mu["mu"] / mu["hi"]) / DEEP_NE_N_HI,
             "hi": ne2 * (mu["mu"] / mu["lo"]) / DEEP_NE_N_LO,
             "grade": deep["grade"], "kind": "genomic", "cite": deep["cite"], "url": deep["url"],
             "ne": ne2, "ago": ago, "span_ago": (a * kt, b * kt),
             "note": (f"{deep['method']} step {a:.0f}-{b:.0f} yr ago, Ne {ne:.0f} as published "
                      f"(mu {deep['mu']:.3g}/gen, g {deep['g']:g} yr); rescaled (mu {mu['mu']:.3g}/yr, G {G:.3g} yr) "
                      f"to {a * kt:.0f}-{b * kt:.0f} "
                      f"yr ago, Ne {ne2:.0f}; N = Ne / {DEEP_NE_N:g}")}
        if ago < DEEP_BLIND_YR:
            drop.append({**p, "why": "blind"})
        elif start_year is not None and p["year"] < start_year:
            drop.append({**p, "why": "before band"})
        else:
            keep.append(p)
    by_year = lambda p: p["year"]  # noqa: E731
    return sorted(keep, key=by_year), sorted(drop, key=by_year)


def blind_points(drop: list[dict], src: dict, before_year: float | None = None) -> list[dict]:
    """The steps in PSMC's blind spot, kept as `genomic` points marked `blind` (ToLaD#143), oldest first.

    Kept only where `src` ([deep.blind]) cites a source dating a decline inside the blind spot: PSMC
    resolves little in the last ~20 kyr, so the steps there are weak evidence alone, but they are the
    genome's record of the decline the source dates (lion and leopard after the last glacial maximum,
    Figueiro et al. 2017), and joining across them drew the opposite whenever the next level was higher.
    Kept steps are graded D and their notes quote the source. Only the steps the source's `window`
    ([young, old] years ago) dates are kept: a step whose span overlaps the window, at its log-midpoint
    clamped into the window. So the step that overlaps the window's young edge (the genome's level when
    the dated decline ends) is kept, dated at that edge if its midpoint is younger, and the join to the
    next level starts there; steps wholly younger than the window are evidence of nothing the source
    dates and stay dropped. Not kept either: a step starting at 0 (no log-midpoint) and any step not
    older than `before_year`, which the curve must reach after them."""
    young, old = src["window"]
    out = []
    for p in drop:
        if p.get("why") != "blind" or p["span_ago"][0] <= 0:
            continue
        a, b = p["span_ago"]
        if b <= young or a >= old:
            continue
        ago = min(max(p["ago"], young), old)
        year = NOW_YEAR - ago
        if before_year is not None and year >= before_year:
            continue
        q = {k: v for k, v in p.items() if k != "why"}
        moved = (f"; dated at the cited window's {'young' if ago == young else 'old'} edge "
                 f"({ago:.0f} yr ago), not its midpoint ({p['ago']:.0f}), since the source dates the "
                 f"decline to {young:.0f}-{old:.0f} yr ago" if ago != p["ago"] else "")
        out.append({**q, "year": year, "ago": ago, "grade": "D", "blind": True,
                    "note": q["note"] + f"; in PSMC's blind spot (< {DEEP_BLIND_YR / 1000:g} kyr ago after "
                            f"rescaling, where it resolves little), kept because {src['cite']} dates a "
                            f"decline here: \"{src['quote']}\"{moved} (ToLaD#143)"})
    return sorted(out, key=lambda p: p["year"])


def blind_mean(drop: list[dict]) -> dict | None:
    """The dropped blind steps' level: the log-mean of their N weighted by each step's duration inside
    the blind window [0, DEEP_BLIND_YR] (rescaled), at the duration-weighted mean age; None if none."""
    w = []
    for p in drop:
        if p.get("why") == "blind":
            a, b = max(p["span_ago"][0], 0.0), min(p["span_ago"][1], DEEP_BLIND_YR)
            if b > a:
                w.append((b - a, (a + b) / 2, p["n"]))
    if not w:
        return None
    tot = sum(d for d, _, _ in w)
    return {"steps": len(w), "n": math.exp(sum(d * math.log(n) for d, _, n in w) / tot),
            "ago": sum(d * m for d, m, _ in w) / tot}


def blind_summary(deep_pts: list[dict], dropped: list[dict] | None = None,
                  src: dict | None = None) -> dict | None:
    """The blind spot against the youngest resolved step (ToLaD#143), or None when no step fell there.
    Kept steps (a source cited in [deep.blind]): their youngest and lowest. Dropped: their blind_mean."""
    res = [p for p in deep_pts if not p.get("blind")]
    bps = [p for p in deep_pts if p.get("blind")]
    if not res:
        return None
    r = res[-1]
    out = {"kept": bool(bps), "resolved_ago": r["ago"], "resolved_n": r["n"],
           "min_ago": None, "min_n": None, "min_vs_resolved": None,
           "cite": src["cite"] if src and bps else None, "url": src["url"] if src and bps else None,
           "window": src["window"] if src and bps else None}
    if bps:
        lo = min(bps, key=lambda p: p["n"])
        return {**out, "steps": len(bps), "ago": bps[-1]["ago"], "n": bps[-1]["n"],
                "vs_resolved": bps[-1]["n"] / r["n"],
                "min_ago": lo["ago"], "min_n": lo["n"], "min_vs_resolved": lo["n"] / r["n"]}
    m = blind_mean(dropped or [])
    if m is None:
        return None
    return {**out, "steps": m["steps"], "ago": m["ago"], "n": m["n"], "vs_resolved": m["n"] / r["n"]}


def _year_txt(y: float) -> str:
    y = round(y)
    return f"{-y} BCE" if y < 0 else f"{y}"


def _x(v: float) -> str:
    """A factor for a sentence: two significant figures, no exponent."""
    if v >= 100:
        return f"{v:,.0f}"
    return f"{v:.2g}" if v >= 1e-4 else f"{v:.1e}"


def _cited_txt(p: dict) -> str:
    """'1924 census, 66' / '1800 baseline, 42,000,000': a cited point for a sentence."""
    what = "baseline" if p.get("baseline") else {"index-scaled": "index-scaled estimate",
                                                 "unverified": "unverified figure"}.get(p["kind"], p["kind"])
    return f"{_year_txt(p['year'])} {what}, {p['n']:,.0f}"


def deep_join(deep_pts: list[dict], nxt: dict, dropped: list[dict] | None = None,
              blind_src: dict | None = None, below: dict | None = None) -> tuple[list[dict], dict]:
    """Meet the genomic deep past to its anchor (ToLaD#143, replacing #77/#80/#71's join).

    The genome gives the shape, the anchor gives the number: the whole genomic curve (n, lo, hi, Ne)
    is multiplied by one factor so its youngest point meets `nxt`, the first non-genomic point of the
    curve. The genome's young end is pre-modern, so its anchor is the higher of the first cited count
    (a history file's baseline or first point: any POINT_KINDS, of any year) and the modelled natural
    level (the level before range loss). `nxt` is that count when it is the higher (or there is no
    natural level); where the natural level is higher (a count taken after a crash), `nxt` is the
    natural level in 1500 CE and `below` is the first cited count, which the range-loss trend then
    runs down to (history.apply). With no cited count `nxt` is the modelled level (the natural level
    in 1500 CE where the range-loss trend starts, the natural baseline, today's modelled count). No
    join rises or falls between the genome and `nxt`: that span is flat. The factor is
    recorded and said on the card; one beyond DEEP_JOIN_FLAG either way is flagged. The blind spot
    (ToLaD#143): `deep_pts` may end in blind steps kept because `blind_src` ([deep.blind]) cites a
    decline there; else `dropped` holds them, and dropped steps whose mean level is beyond BLIND_AGAINST
    from the youngest resolved step are flagged as `blind.against` (the flat span runs against them)
    and said on the card. Returns the scaled genomic points and the join record, whose `note` is the
    sentence the species card shows."""
    raw = deep_pts[-1]["n"] / nxt["n"]
    cited = nxt["kind"] in POINT_KINDS
    bl = blind_summary(deep_pts, dropped, blind_src)
    blind_txt = ""
    if bl is not None:
        r = bl["vs_resolved"]
        one = bl["steps"] == 1
        k = f"{bl['steps']} step{'' if one else 's'}"
        if bl["kept"]:
            blind_txt = (f"PSMC's {k} in its blind spot (the last {DEEP_BLIND_YR / 1000:g} kyr, where it resolves "
                         f"little) {'is' if one else 'are'} kept, grade D, because {bl['cite']} dates a decline there: from the youngest "
                         f"resolved step (~{bl['resolved_ago'] / 1000:.0f} kya) to the youngest kept "
                         f"(~{bl['ago'] / 1000:.1f} kya"
                         + (", the young edge of the window it dates" if bl["window"] and bl["ago"] == bl["window"][0]
                            else "") + ") the genomic level "
                         + ("holds" if max(r, 1 / r) < 1.05 else f"{'falls' if r < 1 else 'rises'} {_x(max(r, 1 / r))}x")
                         + ". ")
            bl["against"] = False
        else:
            # the curve is flat from the youngest resolved step to the next level: against blind steps
            # whose mean sits beyond BLIND_AGAINST from it either way
            bl["against"] = max(r, 1 / r) > BLIND_AGAINST
            if bl["against"]:
                blind_txt = (f"PSMC's {k} in its blind spot (the last {DEEP_BLIND_YR / 1000:g} kyr) "
                             f"{'sits' if one else 'average'} "
                             f"{_x(max(r, 1 / r))}x {'below' if r < 1 else 'above'} its youngest resolved step "
                             f"(~{bl['resolved_ago'] / 1000:.0f} kya) but {'is' if one else 'are'} not drawn: "
                             "PSMC resolves little there and no source in this file dates a change, so the "
                             "curve stays flat from that step instead (flagged). ")
    off = max(raw, 1 / raw)
    flag = off > DEEP_JOIN_FLAG
    f = 1 / raw
    if cited:
        what = (f"the cited {_year_txt(nxt['year'])} "
                + ("baseline" if nxt.get("baseline") else {"index-scaled": "index-scaled estimate",
                                                          "unverified": "unverified figure"}.get(nxt["kind"], nxt["kind"]))
                + f" ({nxt['n']:,.0f})")
    elif below is not None:
        what = (f"the modelled natural level in 1500 CE ({nxt['n']:,.0f}), which is above the first cited "
                f"count ({_cited_txt(below)}), taken after the decline")
    else:
        what = ("the modelled natural level in 1500 CE" if nxt["kind"] == "rangeloss" else
                "the modelled natural baseline" if nxt["kind"] == "natural" else "today's modelled count") + \
               f" ({nxt['n']:,.0f}; no cited count)"
    note = blind_txt + (f"The genome gives the shape, not the number: its curve is scaled ×{_x(f)} to meet "
                        f"{what}, then held flat to "
                        + ("1500; the range-loss trend runs from there down to the count" if below is not None
                           else "it")
                        + (f" (flagged: beyond {DEEP_JOIN_FLAG:g}×)" if flag else "") + ".")
    if below is not None:  # the point notes name the anchor, not the whole sentence
        what = f"the modelled natural level in 1500 CE ({nxt['n']:,.0f}), above the first cited count"
    deep_pts = [{**p, "n": p["n"] * f, "lo": p["lo"] * f, "hi": p["hi"] * f, "ne": p["ne"] * f,
                 "note": p["note"] + f"; scaled ×{_x(f)} to meet {what}"} for p in deep_pts]
    join = {"rule": "scaled", "next": "cited" if cited else "natural" if below is not None else "modelled",
            # the first cited count when the natural level is above it and so is the anchor (ToLaD#143)
            "below": ({"year": below["year"], "n": below["n"], "kind": below["kind"]}
                      if below is not None else None),
            "to_kind": nxt["kind"], "to_year": nxt["year"], "to_n": nxt["n"],
            "deep_n_raw": deep_pts[-1]["n"] / f, "deep_n": deep_pts[-1]["n"],
            "ratio": raw, "factor": f, "flag": flag, "note": note,
            # the kept blind steps against the youngest resolved one (ToLaD#143; levels before scaling)
            "blind": bl}
    return deep_pts, join


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


# A species-wide event must look like one (ToLaD#149): the drawn curve falls through its window by at least
# this factor, its lowest level inside the window (its young end included) at most 1/1.5 of its level at the
# window's old end. 1.5x is the pipeline's own "worth telling the reader" ratio (BLIND_AGAINST, #143): a column
# a third narrower is plainly narrower at any zoom, while the 1.1-1.3x wobbles of a log-linear join are not
EVENT_FALL = 1.5


def _seg_level(knots: list[tuple[float, float]], year: float) -> float:
    """The column's level at `year`: log-linear between the segments' ends, flat outside them."""
    if year <= knots[0][0]:
        return knots[0][1]
    for (ya, na), (yb, nb) in zip(knots, knots[1:]):
        if ya <= year <= yb and yb > ya:
            f = (year - ya) / (yb - ya)
            return math.exp(math.log(max(na, 1e-12)) * (1 - f) + math.log(max(nb, 1e-12)) * f)
    return knots[-1][1]


def event_fall(rec: dict, ev: dict) -> dict:
    """How the species' column moves through an event's window, read off the segments the fan draws
    (rec["segments"]: births per generation, so the column's N up to a constant): `fall` = the level at the
    window's old end / the lowest level inside it (every segment end in it, and its young end), `end` = old
    end / young end; `shown` when fall >= EVENT_FALL. When not shown, `why` says why the column misses it:
      not drawn      the record does not drive the column (use = "display"): the column is the model's
      blind spot     the window lies where PSMC's dropped blind-spot steps are and the curve is a join there
      joined across  the window spans a join between sources (a genome to a count, a modelled span, a held level)
      before the data   the window is older than the curve's first point: the column holds a modelled level
      data rises / data too shallow   one source's own points span the window and do not fall (enough)"""
    out = {"fall": 1.0, "end": 1.0, "shown": False, "why": "not drawn"}
    segs, G, pts = rec.get("segments") or [], rec.get("G") or 0.0, rec.get("curve") or []
    if rec.get("use") != "counts" or rec.get("component") != "wild" or not segs or not pts:
        return out
    y0, y1 = NOW_YEAR - ev["from_ya"], NOW_YEAR - ev["to_ya"]
    knots = [(sg["year0"] + j * sg["gens"] * G, sg[k]) for sg in segs for j, k in ((0, "start"), (1, "end"))]
    lv = [_seg_level(knots, y0)] + [n for y, n in knots if y0 < y < y1] + [_seg_level(knots, y1)]
    fall, end = lv[0] / min(lv[1:]), lv[0] / lv[-1]
    out = {"fall": round(fall, 3), "end": round(end, 3), "shown": fall >= EVENT_FALL, "why": ""}
    if out["shown"]:
        return out
    a = max((i for i, p in enumerate(pts) if p["year"] <= y0), default=None)
    b = min((i for i, p in enumerate(pts) if p["year"] >= y1), default=len(pts) - 1)
    if a is None:
        out["why"] = "before the data"
        return out
    seg = pts[a:b + 1]
    src = {"genomic" if p["kind"] == "genomic" else "cited" if p["kind"] in POINT_KINDS and not p.get("span_kind")
           else "modelled" for p in seg}
    blind = any(d.get("why") == "blind" and d["span_ago"][0] < ev["from_ya"] and d["span_ago"][1] > ev["to_ya"]
                for d in rec.get("deep_dropped") or ())
    if blind and src != {"genomic"}:
        out["why"] = "blind spot"
    elif len(src) > 1 or src == {"modelled"}:
        out["why"] = "joined across"
    else:
        out["why"] = "data rises" if end < 1 else "data too shallow"
    return out


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
                     pre_grade: int = 3, pre_kind: str = "model") -> list[dict]:
    """Curve -> procgen segments (see _segments). With `pre_level`, the span
    from the band start to the first point is one segment held at that level
    (no cited baseline is known: kind `natural` for the natural baseline,
    `model` for today's level), and the curve's segments follow it, with a
    step at the first point."""
    if pre_level is None:
        return _segments(pts, G, L, t0_ma, has_baseline, end_year)
    segs = _segments(pts, G, L, year_to_ma(pts[0]["year"]), has_baseline, end_year)
    g_curve = round(segs[0]["gens"] + sum(s["gens"] for s in segs[1:]))
    g_start = round((end_year - year_to_ma_inv(t0_ma)) / G)
    if g_start > g_curve:
        bpg = G / L
        segs.insert(0, {"year0": end_year - g_start * G, "gens": g_start - g_curve, "start": pre_level * bpg,
                        "end": pre_level * bpg, "grade": pre_grade, "kind": K[pre_kind]})
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
    # between base knots the curve is one log-linear piece: split big changes (genomic spans finely)
    for ga, gb in zip(base, base[1:]):
        ratio = max(lev[ga], lev[gb]) / min(lev[ga], lev[gb])
        mid = (year_of(ga) + year_of(gb)) / 2
        deep = any(a["kind"] == b["kind"] == "genomic" and a["year"] <= mid <= b["year"] for a, b in zip(pts, pts[1:]))
        split, sub = (DEEP_SUB_RATIO, DEEP_SUB_RATIO) if deep else (SPLIT_RATIO, SUB_RATIO)
        if ratio > split and ga - gb >= 2:
            m = min(math.ceil(math.log(ratio) / math.log(sub) - 1e-9), ga - gb)
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
            kind = (K[a["span_kind"]] if a.get("span_kind")
                    else K["genomic"] if a["kind"] == b["kind"] == "genomic" else K["interpolated"])
            gr = max(GRADES.index(a["grade"]), GRADES.index(b["grade"]))
        segs.append({"year0": year_of(g0), "gens": g0 - g1, "start": level(g0) * bpg, "end": level(g1) * bpg,
                     "grade": gr, "kind": kind})
    return segs


def segments_births(segs: list[dict]) -> float:
    return sum(s["gens"] * (s["start"] + s["end"]) / 2 for s in segs)


# ------------------------------------------------------------------ apply to the tree


def deep_join_summary(report: dict) -> dict:
    """stats.json -> history.deep_join: species per next level, the factor spread, the flagged ones
    (ToLaD#143)."""
    joins = {sp: s["deep"]["join"] for sp, s in report.items() if s.get("deep")}
    flagged = {sp: {"next": j["next"], "ratio": j["ratio"], "factor": j["factor"], "to_kind": j["to_kind"],
                    "to_year": j["to_year"]}
               for sp, j in sorted(joins.items(), key=lambda kv: -abs(math.log(kv[1]["ratio"])))
               if j["flag"]}
    fs = sorted(j["factor"] for j in joins.values())

    def q(x: float) -> float | None:  # a quantile of the factors, log-interpolated
        if not fs:
            return None
        i = x * (len(fs) - 1)
        lo, hi = fs[int(math.floor(i))], fs[int(math.ceil(i))]
        return math.exp(math.log(lo) + (i - math.floor(i)) * (math.log(hi) - math.log(lo)))
    return {
        "note": "How each genomic deep past meets its anchor (ToLaD#143, replacing #77/#80/#71): the genome "
                "gives the shape, the anchor the number. The whole genomic curve is scaled by one factor so "
                "its young end (pre-modern) meets the higher of the first cited count (a history file's "
                "baseline or first point, any year) and the modelled natural level: the count when it is the "
                "higher (`next` cited), else the natural level in 1500 CE, from which the range-loss trend "
                "runs down to the count (`next` natural); with no cited count, the modelled level (the "
                "natural level in 1500 CE, the natural baseline, today's modelled count; `next` modelled). "
                "It is held flat to it. ratio = genomic "
                "level at its young end / anchor, before scaling; factor = 1 / ratio; flagged when beyond "
                f"{DEEP_JOIN_FLAG:g}x either way. Per species: history.species[<sp>].deep.join (its `note` is "
                "the card's sentence).",
        "by_next": {r: sum(j["next"] == r for j in joins.values()) for r in ("cited", "natural", "modelled")},
        "factor": {"n": len(fs), "min": fs[0] if fs else None, "p10": q(0.1), "p25": q(0.25), "median": q(0.5),
                   "p75": q(0.75), "p90": q(0.9), "max": fs[-1] if fs else None,
                   "beyond_flag": {"up": sum(f > DEEP_JOIN_FLAG for f in fs),
                                   "down": sum(f < 1 / DEEP_JOIN_FLAG for f in fs)}},
        "flagged_by_next": {r: sum(f["next"] == r for f in flagged.values()) for r in ("cited", "natural", "modelled")},
        "flagged": flagged,
        # PSMC's blind spot (ToLaD#143): species whose blind steps are kept (a source in [deep.blind] dates
        # a decline there), and those whose join runs against their dropped blind steps' mean level
        "blind": {
            "note": f"Steps younger than {DEEP_BLIND_YR:g} yr (rescaled) are dropped unless the file's "
                    "[deep.blind] cites a source dating a decline there, which keeps them (grade D). `against`: "
                    f"dropped steps whose mean level is beyond {BLIND_AGAINST:g}x from the youngest resolved step, "
                    "which the flat span to the next level runs against: said on the card, not drawn.",
            "kept": sorted(sp for sp, j in joins.items() if (j.get("blind") or {}).get("kept")),
            "against": {sp: j["blind"]["vs_resolved"] for sp, j in sorted(joins.items())
                        if (j.get("blind") or {}).get("against")},
        },
    }


def mutation_summary(raw: Path, report: dict) -> dict:
    """stats.json -> history.mutation_rate: the per-lineage rate model (mutation.py, ToLaD#74/#75) and the
    factor each genomic deep past took on the flat DEEP_MU_YEAR (times and Ne both scale by 1 / factor)."""
    mus = {sp: s["deep"]["mu"] for sp, s in sorted(report.items()) if s.get("deep")}
    f = np.array([m["vs_flat"] for m in mus.values()]) if mus else np.array([])
    return {
        **mutation.summary(raw),
        "flat_mu_year": DEEP_MU_YEAR, "flat_cite": list(DEEP_MU_CITE),
        "deep_vs_flat": ({"n": int(f.size), "min": round(float(f.min()), 3), "median": round(float(np.median(f)), 3),
                          "max": round(float(f.max()), 3)} if f.size else {"n": 0}),
        "deep_by_clade": dict(Counter(m["clade"] for m in mus.values())),
        "deep_species": {sp: {"G": round(m["G"], 2), "mu_year": float(f"{m['mu_year']:.3g}"),
                              "vs_flat": round(m["vs_flat"], 3), "clade": m["clade"]} for sp, m in mus.items()},
    }


def _sd_of(p: dict) -> float:
    """95% range -> log10 sd."""
    return math.log10(p["hi"] / p["lo"]) / (2 * 1.96)


def apply(root, raw: Path, log: dict, src_bit: int, recs: list[dict] | None = None,
          start_point=None) -> list[dict]:
    """Rewrite curated leaves in place (before sum_tree). Returns the records
    with their compiled curve, segments and tree location.

    `start_point(leaf)` gives the range-loss trend's first knot (the natural level in 1500 CE, kind
    `rangeloss`; model.rangeloss_start) for a leaf that has the trend, else None. A wild counts file
    whose deep past is the natural level (no baseline, no [deep]) gets that knot before its first cited
    point, so the gap from 1500 to the first point is the trend, not a step (ToLaD#71). A genomic deep
    past is anchored on the higher of its first cited count and the natural level (deep_join, ToLaD#143):
    on the count, no trend; on the natural level (`start_point(leaf, True)`, any leaf with one), the
    knot and the trend down to the count, as above."""
    recs = load_all() if recs is None else recs
    leaves = {}
    for n in root.preorder():
        if n.is_leaf and n.name and (not n.extinct or n.name not in leaves):
            leaves[n.name] = n if not n.extinct else leaves.get(n.name, n)
    fao_items = {r["faostat_item"] for r in recs if r["faostat_item"] is not None}
    series = faostat_series(raw, fao_items) if fao_items else {}
    report = {}
    missing, empty = [], []
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
        if rec.get("deep_blind") and not rec["deep"]:
            raise HistoryError(f"{rec['file']}: a blind-only [deep] needs a bulk genomic curve to apply to")
        mu = mutation.for_leaf(raw, leaf, G) if rec["deep"] else None
        deep_pts, rec["deep_dropped"] = (deep_points(rec["deep"], G, year_to_ma_inv(leaf.t0), mu)
                                         if rec["deep"] else ([], []))
        if not deep_pts and not pts:  # a modelled genomic record whose steps all fell in the blind spot
            empty.append(rec["species"])
            continue
        # PSMC's blind spot (ToLaD#143): where [deep.blind] cites a source dating a decline there, its steps
        # are kept after the youngest resolved one, so the join follows the genome's direction; only those
        # older than the first point and than 1500 CE (the range-loss trend's first knot, which may come
        # before it). A curve with no resolved step gets none
        blind_src = rec["deep"].get("blind") if rec["deep"] else None
        if deep_pts and blind_src:
            before = min([BLIND_KEEP_MAX_YEAR] + [p["year"] for p in pts[:1]])
            deep_pts = deep_pts + blind_points(rec["deep_dropped"], blind_src, before)
        if deep_pts and pts and deep_pts[-1]["year"] >= pts[0]["year"]:
            raise HistoryError(f"{rec['file']}: genomic points reach the cited ones ({deep_pts[-1]['year']:.0f})")
        rec["deep_points"] = deep_pts
        pts = deep_pts + pts
        rec["leaf"] = leaf
        rec["G"], rec["L"] = G, L
        before = {"alive": D["alive"], "ever": D["ever_med"], "grade_cap": D["grade_cap"],
                  "sd_leaf": D["sd_leaf"], "deep": D["pieces"][0][2] * L if D["pieces"] else 0.0}
        nw = D.get("n_wild_pieces", len(D["pieces"]))
        # precedence for the deep past of a wild species: a cited baseline, else a genomic deep past
        # ([deep]), else the natural (pre-human) baseline from model.natural_level, else today's level.
        # The natural baseline is only used when neither of the first two is there.
        nat = D.get("natural")
        nat_base = None
        if nat is not None and rec["baseline"] is None and not deep_pts:
            nat_base = {"n": nat["N"], "lo": nat["lo"], "hi": nat["hi"], "grade": nat["grade"],
                        "kind": nat["kind"], "year": None}
        model_now = None
        if rec["use"] == "counts":
            if rec["component"] == "wild":
                model_now = D.get("rate_wild_now", 0.0) * L
            elif rec["component"] == "domestic":
                model_now = D.get("domestic", {}).get("stock")
        last = pts[-1]
        alive_from_hist = last["year"] >= ALIVE_MIN_YEAR and GRADES.index(last["grade"]) <= ALIVE_MAX_GRADE
        if (nat is not None and nat.get("scaled") and alive_from_hist and model_now
                and rec["use"] == "counts" and rec["component"] == "wild"):
            # the natural baseline scales today's count by the range ratio: use the curated today
            s = last["n"] / model_now
            for k in ("N", "lo", "hi"):
                nat[k] *= s
            nat["today_from"] = "history"
            if nat_base is not None:
                nat_base.update(n=nat["N"], lo=nat["lo"], hi=nat["hi"])
        if rec["use"] == "counts" and not alive_from_hist and model_now:
            # end the curve at the model's alive-now, so the green lane and the curve agree
            pts = pts + [{"year": NOW_YEAR, "n": model_now, "lo": model_now, "hi": model_now,
                          "grade": "ABCD"[min(3, D["grade_cap"])], "kind": "model",
                          "cite": "ToLaD model (stats.json, this leaf)", "url": "https://github.com/theitush/ToLaD",
                          "note": "the pipeline's alive-now for this leaf; no recent graded point"}]
        wild_counts = rec["use"] == "counts" and rec["component"] == "wild"
        n_deep = len(deep_pts)
        # the gap before the first cited point (ToLaD#71): where the deep past ends at the natural level
        # (no baseline, no [deep]), the range-loss trend runs from the natural level in 1500 CE to that
        # point instead of a held level and a step. A genomic deep past is anchored on the higher of its
        # first cited count and the modelled natural level (ToLaD#143): where the natural level is higher
        # (a count taken after a crash: wisent 1924, scimitar oryx 2026), the genome meets the natural
        # level in 1500 CE and the same trend runs down from it to the count; else it meets the count
        first = pts[n_deep] if n_deep < len(pts) else None
        cited_first = first is not None and first["kind"] in POINT_KINDS
        start = None
        if start_point is not None and wild_counts and cited_first:
            if not deep_pts:
                start = start_point(leaf)
            else:
                s = start_point(leaf, True)
                start = s if s is not None and first["year"] > s["year"] and s["n"] > first["n"] else None
        trend = (start is not None and first["year"] > start["year"]
                 and (nat_base is not None or bool(deep_pts)))
        held = None
        if trend and start["n"] < first["n"]:
            # the trend would rise from 1500 to the first cited point (ToLaD#93): a population the record
            # says was larger after 1500 than the natural level contradicts the trend's meaning (range
            # loss). The natural level is evidently an underestimate there: the cited level is held flat
            # back to 1500 instead (a `held` span, grade D: no figure covers it)
            held = {"natural_n": start["n"], "year": first["year"], "n": first["n"], "kind": first["kind"],
                    "baseline": bool(first.get("baseline"))}
            start = {**start, "n": first["n"], "lo": first["lo"], "hi": first["hi"], "span_kind": "held",
                     "held_from": start["n"], "cite": first["cite"], "url": first["url"],
                     "note": f"the {_cited_txt(first)} held back to 1500: the modelled natural (pre-human) "
                             f"level ({start['n']:,.0f}) is below it, evidently an underestimate here, so no "
                             "range-loss trend runs up to the cited point"}
        if trend:
            pts = pts[:n_deep] + [start] + pts[n_deep:]
        rec["trend_1500"] = trend
        rec["trend_held"] = held
        rec["deep_join"] = None
        if deep_pts:
            # the genome gives the shape, the anchor the number: scaled to meet it (ToLaD#143)
            deep_pts, rec["deep_join"] = deep_join(deep_pts, pts[n_deep], rec["deep_dropped"], blind_src,
                                                   first if trend and cited_first else None)
            rec["deep_points"] = deep_pts
            pts = deep_pts + pts[n_deep:]
        rec["curve"] = pts
        if rec["use"] == "counts" and rec["component"] == "wild":
            if D.get("domestic") and nw == len(D["pieces"]):
                raise HistoryError(f"{rec['file']}: domestic leaf without n_wild_pieces")
            n_now = pts[-1]["n"]
            # the deep past, in order of precedence: a cited baseline (held back to the band start),
            # else a genomic deep past (its oldest level held back to the band start), else the
            # natural baseline, else today's level; with a cited baseline AND a genomic past, the
            # genomic points come first and join the baseline point log-linearly
            pre = None if (rec["baseline"] or deep_pts) else nat_base["n"] if nat_base else n_now
            new = curve_pieces(pts, L, leaf.t0, pre_level=pre)
            D["pieces"] = new + D["pieces"][nw:]
            D["n_wild_pieces"] = len(new)
            # a domestic stock on the leaf keeps its own count (its history file's, else the model's)
            D["alive"] = n_now + (D.get("domestic_now", D["domestic"]["stock"]) if D.get("domestic") else 0.0)
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
            # the same growth for procgen's segments, from domestication: the pieces' level at
            # their starts, kept where it has changed by SUB_RATIO since the last one kept
            rec["early"] = []
            for o, y, r in early:
                yr = year_to_ma_inv(o)
                if r > 0 and yr < pts[0]["year"] - G and (
                        not rec["early"] or max(r * L, rec["early"][-1]["n"]) / min(r * L, rec["early"][-1]["n"]) >= SUB_RATIO):
                    rec["early"].append({"year": yr, "n": r * L, "lo": r * L, "hi": r * L, "grade": "D",
                                         "kind": "model", "note": ""})
            new = curve_pieces(pts, L, a_first)
            D["pieces"] = D["pieces"][:nw] + early + new
            D["alive"] = D["alive"] - D["domestic"]["stock"] + pts[-1]["n"]
            D["domestic_now"] = pts[-1]["n"]
        if rec["use"] == "counts":
            # the deep-past level: the cited baseline, else the natural baseline or today's level
            # (wild), or the first point (domestic); a genomic deep past is also a deep-past level
            if rec["component"] == "wild":
                base = rec["baseline"] or nat_base or pts[-1]
                # the wild curve replaced the model's own deep past, natural widening included
                D["sd_leaf"] = D.get("sd_leaf_today", D["sd_leaf"])
                D["grade_cap"] = D.get("grade_cap_today", D["grade_cap"])
            else:
                base = pts[0]
            refs = [base] + deep_pts[:1]  # the genomic deep past dominates "ever" when present
            D["ever_med"] = pieces_births(D["pieces"])
            # the deep-past level sets "ever": widen the error by its range, cap the grade by its grade
            D["sd_leaf"] = math.hypot(D["sd_leaf"], max(_sd_of(r) for r in refs))
            D["grade_cap"] = max([D["grade_cap"]] + [GRADES.index(r["grade"]) for r in refs])
            D["meth"].append((f"H:genomic deep past (modelled: {rec['deep']['method']} {len(deep_pts)} points, "
                              f"{rec['deep']['grade']}; {rec['deep']['cite']}"
                              + (", then the range-loss trend from 1500" if rec["points"] else "")
                              + "; pipeline/tolad_pipeline/genomic.py)")
                             if rec.get("modelled") == "genomic" else
                             f"H:curated history ({len(rec['points'])} points"
                             + (f", baseline {base['n']:.3g} in {base['year']:.0f} ({base['grade']})"
                                if rec["baseline"] else "")
                             + (f", deep past {rec['deep']['method']} {len(deep_pts)} points "
                                f"({rec['deep']['grade']}; {rec['deep']['cite']})" if deep_pts else "")
                             + (f", natural baseline {base['n']:.3g} ({base['grade']}) before the first point"
                                if base is nat_base else "")
                             + ((", then the first cited level held back to 1500 (the natural level is below it)"
                                 if held else ", then the range-loss trend from 1500 to the first cited point")
                                if trend else "")
                             + f"; pipeline/history/{rec['file']})"
                             + (" + bulk genomic deep past (genomic.py)" if rec.get("deep_bulk") else ""))
            D["src"].add(src_bit)
            D["anchored_count"] = True
        # a leaf can carry a wild record and a domestic one (wild boar and the pig, the bezoar and the
        # goat; ToLaD#76): both shape its births pieces above, but HIST holds one record per row, and
        # the wild one holds it (the species' own past over its whole band; the domestic stock's
        # count still rides in the leaf's alive and EVER). The other is kept as `history_beside`.
        prev = D.get("history")
        if prev is not None and prev["component"] == "wild" and rec["component"] != "wild":
            D["history_beside"] = rec
        else:
            if prev is not None:
                D["history_beside"] = prev
            D["history"] = rec
        D["alive_from_history"] = (rec["use"] == "counts" and alive_from_hist) or (
            prev is not None and D.get("alive_from_history", False))
        # wild: the first segment holds the baseline back to the band start; domestic and
        # humans: segments cover the curated span only (before it the model's own shape stands)
        t0_seg = leaf.t0 if rec["component"] == "wild" else year_to_ma(pts[0]["year"])
        early = rec.get("early") or []
        if early:
            # domestic: the segments start at domestication, the growth before the first point
            # (shaped like human births, as the leaf's own births) as `model` segments, grade D
            rec["segments"] = compile_segments(early + pts, G, L, year_to_ma(early[0]["year"]), False)
            for sg in rec["segments"]:
                if sg["year0"] + sg["gens"] * G / 2 < pts[0]["year"]:
                    sg["kind"], sg["grade"] = K["model"], 3
        else:
            pre = ((nat_base["n"] if nat_base else pts[-1]["n"]) if wild_counts and not rec["baseline"]
                   and not deep_pts else None)
            rec["segments"] = compile_segments(pts, G, L, t0_seg, rec["baseline"] is not None and not deep_pts,
                                               pre_level=pre, pre_grade=3 if nat_base else min(3, D["grade_cap"]),
                                               pre_kind="natural" if nat_base else "model")
        if trend and not deep_pts and held is None:
            # the generation that straddles 1500 can fall before the trend's first knot: it holds the
            # natural level (as in model.rangeloss_record); a held knot (ToLaD#93) is the cited level
            for sg in rec["segments"]:
                if sg["kind"] == K["held"] and sg["year0"] < start["year"]:
                    sg["kind"] = K["natural"]
        rec["natural"] = nat_base if wild_counts else None
        for ev in rec.get("events", []):  # does the column fall through each event's window (ToLaD#149)
            ev.update(event_fall(rec, ev))
        deep_rep = None
        if deep_pts:
            resolved = [p for p in deep_pts if not p.get("blind")]
            deep_rep = {
                "method": rec["deep"]["method"], "cite": rec["deep"]["cite"], "grade": rec["deep"]["grade"],
                "bulk": bool(rec.get("deep_bulk")),
                "points": len(resolved), "kept_blind": len(deep_pts) - len(resolved),
                "dropped_blind": sum(p["why"] == "blind" for p in rec["deep_dropped"]) - (len(deep_pts) - len(resolved)),
                "dropped_before_band": sum(p["why"] != "blind" for p in rec["deep_dropped"]),
                "oldest_n": deep_pts[0]["n"], "oldest_yr_ago": NOW_YEAR - deep_pts[0]["year"],
                "youngest_yr_ago": NOW_YEAR - resolved[-1]["year"],
                "youngest_blind_yr_ago": NOW_YEAR - deep_pts[-1]["year"] if deep_pts[-1].get("blind") else None,
                "band_start_yr_ago": leaf.t0 * 1e6,
                "time_factor": deep_scale(rec["deep"], G, mu["mu"])[0],
                "ne_factor": deep_scale(rec["deep"], G, mu["mu"])[1],
                # the lineage's per-year rate (mutation.py) and its factor on the flat DEEP_MU_YEAR
                "mu": {"G": G, "mu_year": mu["mu"], "lo": mu["lo"], "hi": mu["hi"],
                       "clade": mu["clade"] or "Mammalia (fit only)", "vs_flat": mu["vs_flat"]},
                "join": rec["deep_join"],
            }
        entry = {
            "file": rec["file"], "modelled": rec.get("modelled"), "leaf": leaf.name, "use": rec["use"], "component": rec["component"],
            "points": len(rec["points"]), "grades": "".join(sorted({p["grade"] for p in rec["points"]})),
            "baseline": ({k: rec["baseline"][k] for k in ("year", "n", "lo", "hi", "grade", "kind")}
                         if rec["baseline"] else None),
            "alive_before": before["alive"], "alive_after": D["alive"],
            "deep_before": before["deep"], "deep_after": D["pieces"][0][2] * L if D["pieces"] else 0.0,
            "deep_from": ("genomic" if deep_pts else "baseline" if rec["baseline"] else "natural" if nat_base
                          else "today")
                         if wild_counts else None,
            "natural": ({k: nat[k] for k in ("N", "lo", "hi", "km2_cur", "km2_nat", "method")}
                        if nat is not None else None),
            "alive_from": "history" if alive_from_hist else "model",
            "ever_before": before["ever"], "ever_after": D["ever_med"],
            "ever_ratio": D["ever_med"] / before["ever"] if before["ever"] > 0 else None,
            "trend_1500": trend,
            "trend_held": held,
            "G_yr": G, "segments": len(rec["segments"]), "domestic_on_leaf": bool(D.get("domestic")),
            "deep": deep_rep,
            "events": [{"what": f"{e['kind']} {e['from_ya']:g}-{e['to_ya']:g} ya: {e['title']}",
                        **{k: e[k] for k in ("scope", "region", "fall", "end", "shown", "why") if k in e}}
                       for e in rec.get("events", [])],
            "hist_row": D["history"] is rec,  # this record is the leaf's HIST record (see history_beside)
            "beside": rec.get("beside"),
        }
        key = rec["species"]
        if key in report:
            # two records of one name on one leaf (the wild boar beside the pig file, ToLaD#76): the
            # one in HIST keeps the name, the other takes its component as a suffix
            if D["history"] is rec:
                other = report.pop(key)
                report[f"{key} ({other['component']})"] = other
            else:
                key = f"{key} ({rec['component']})"
        report[key] = rec["report"] = entry
    for rec in recs:  # a later record on the same leaf may have taken the HIST row
        if "leaf" in rec:
            rec["report"]["hist_row"] = rec["leaf"].data.get("history") is rec
    if missing:
        raise HistoryError(f"history species not found among living tree leaves: {missing}")
    log["history"] = {
        "note": "Curated flagship histories (pipeline/history/). ever_before = the model alone (the natural "
                "baseline before 1500 and the range-loss trend after it where it differs from today's count, else today's count, over "
                "the band); ever_after = with the curve. deep_from = what sets the level at the band start: "
                "`genomic` (a [deep] genome-based curve, older than any cited point, baseline included), "
                "else `baseline` (cited), else `natural` (the natural baseline), else `today`. deep_before / deep_after = the level at "
                "the band start. Leaf values, before the tree sum.",
        "species": report,
        "genomic_records_without_points": empty,
        "deep_join": deep_join_summary(report),
        "mutation_rate": mutation_summary(raw, report),
        "trend_held": {
            "note": "Species whose modelled natural level in 1500 CE is below their first cited point (ToLaD#93): "
                    "the range-loss trend would rise from 1500 to that point, contradicting its meaning (range "
                    "loss), so the cited level is held flat back to 1500 instead (a `held` span, grade D) and the "
                    "natural level is taken as an underestimate there. natural_n = that natural level; year, n, "
                    "kind = the first cited point. Per species: history.species[<sp>].trend_held.",
            "species": {sp: r["trend_held"] for sp, r in sorted(report.items()) if r.get("trend_held")},
        },
    }
    return [r for r in recs if "leaf" in r]
