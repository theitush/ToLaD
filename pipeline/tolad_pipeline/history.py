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
              genomic points precede the cited ones and join them log-linearly;
              a cited next level dated 1900 or earlier scales the curve to meet it,
              a modelled one (or a later cited one) does not, a mismatch beyond 10x
              is flagged (deep_join, ToLaD#80, #71)
    natural   with no cited baseline and no [deep], the natural (pre-human) baseline
              (model.natural_level, NATB) is held from the band start to the first
              point. Precedence before the cited points: genomic > natural > today
    rangeloss a species with no history file whose natural baseline differs from
              today's count gets a modelled two-point record instead (model.py,
              rangeloss_record): a log-linear decline from 1500 CE to now. A history
              file replaces it, but where its deep past ends at the natural level (or
              at an unscaled genomic curve) the trend fills the gap from 1500 to its
              first cited point (ToLaD#71); never upward: where the natural level is
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
EVENT_KEYS = {"kind", "from_ya", "to_ya", "title", "summary", "quote", "cite", "url", "grade", "region"}
EVENT_REQUIRED = EVENT_KEYS - {"region"}
EVENT_TITLE_MAX = 40  # characters: the title is the label on the fan
DEEP_KEYS = {"method", "cite", "url", "mu", "g", "grade", "note", "steps"}
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
DEEP_BLIND_YR = 20000.0  # PSMC resolves little in the last ~10-20 kyr: younger steps are dropped
DEEP_STEP_MAX = 64  # births pieces per curve span at most (deep spans are 1e4-1e6 years long)
# The join across the blind spot (ToLaD#77/#80): a cited next level scales the genomic curve to meet it,
# a modelled one keeps the genomic level; either way a mismatch beyond this factor is flagged.
DEEP_JOIN_FLAG = 10.0
# Only a cited level dated this year or earlier scales the genomic curve (dispatcher's call, ToLaD#71/#80):
# the rule exists because a cited historical, pre-decline level (Bison 1800, Vicugna 1530, tiger 1900) is
# better evidence than Ne/N = 0.1. A first cited point after 1900 is mostly a crash or a modern count
# (wisent 1924: 66; scimitar oryx 2026: 650), which a million years of deep past should not be scaled to:
# the genomic curve then keeps its level, joins the natural level in 1500 CE, and the range-loss trend
# runs from there to that point.
DEEP_JOIN_CITED_MAX_YEAR = 1900
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
    if not e["url"].startswith(("http://", "https://")):
        raise HistoryError(f"{where}: url must be http(s)")
    if e["grade"] not in GRADES:
        raise HistoryError(f"{where}: grade {e['grade']!r} not in A-D")
    return {"kind": e["kind"], "from_ya": float(e["from_ya"]), "to_ya": float(e["to_ya"]),
            "title": e["title"].strip(), "summary": " ".join(e["summary"].split()),
            "quote": " ".join(e["quote"].split()), "cite": e["cite"].strip(), "url": e["url"].strip(),
            "grade": e["grade"], "region": str(e.get("region", "")).strip()}


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
        "events": events,
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
             "ne": ne2, "ago": ago,
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


def deep_join(deep_pts: list[dict], nxt: dict, skipped: dict | None = None) -> tuple[list[dict], dict]:
    """Join the genomic deep past to the next level across PSMC's blind spot (ToLaD#77, #80, #71).

    `nxt` is the first non-genomic point of the curve. A cited next level (a history file's baseline or
    first point: any POINT_KINDS) dated DEEP_JOIN_CITED_MAX_YEAR or earlier is a historical level, better
    evidence than Ne/N = 0.1, so the genomic curve (n, lo, hi, Ne) is scaled to meet it, keeping its
    shape. A modelled next level (the natural level in 1500 CE, today's modelled count), or a cited one
    after the cutoff, keeps the genomic curve's own level, joined log-linearly. `skipped` is the first
    cited point when it is after the cutoff and the natural level in 1500 (`nxt`) was put before it.
    Either way a mismatch (genomic / next, before any scaling) beyond DEEP_JOIN_FLAG is flagged. Returns
    the (scaled) genomic points and the join record, whose `note` is the sentence the species card shows."""
    raw = deep_pts[-1]["n"] / nxt["n"]
    cited_kind = nxt["kind"] in POINT_KINDS
    cited = cited_kind and nxt["year"] <= DEEP_JOIN_CITED_MAX_YEAR
    late = skipped if skipped is not None else nxt if cited_kind and not cited else None
    off = max(raw, 1 / raw)
    flag = off > DEEP_JOIN_FLAG
    f = 1 / raw if cited else 1.0
    if cited:
        what = (f"the cited {_year_txt(nxt['year'])} "
                + ("baseline" if nxt.get("baseline") else "count") + f" ({nxt['n']:,.0f})")
        note = (f"Genomic curve scaled x{_x(f)} to meet {what}, keeping its shape"
                + (f"; before scaling it was {_x(off)}x {'above' if raw > 1 else 'below'} that level "
                   f"(flagged: beyond {DEEP_JOIN_FLAG:g}x)" if flag else "") + ".")
        deep_pts = [{**p, "n": p["n"] * f, "lo": p["lo"] * f, "hi": p["hi"] * f, "ne": p["ne"] * f,
                     "note": p["note"] + f"; scaled x{_x(f)} to meet {what}"} for p in deep_pts]
    else:
        held = nxt.get("held_from") is not None
        what = ("that point" if nxt is late else
                (f"that point's level, held back to 1500 CE because the modelled natural level there "
                 f"({nxt['held_from']:,.0f}) is below it (evidently an underestimate),") if held else
                "the modelled natural level in 1500 CE" if nxt["kind"] == "rangeloss" else
                "the modelled natural baseline" if nxt["kind"] == "natural" else "today's modelled count")
        rel = ("about the same" if off < 1.05 else
               f"{_x(off)}x {'lower' if raw > 1 else 'higher'}")
        note = ((f"First cited point ({_cited_txt(late)}) is after {DEEP_JOIN_CITED_MAX_YEAR}, so not used "
                 "as the deep past's level. " if late is not None else "")
                + f"Genomic curve kept at its own level; {what} is {rel}"
                + (f" (flagged: beyond {DEEP_JOIN_FLAG:g}x)" if flag else "")
                + "; the two are joined log-linearly across PSMC's last 20 kyr"
                + ((", then that level is held flat to the cited point, with no range-loss trend rising to it"
                    if held else ", then the range-loss trend runs to the cited point")
                   if skipped is not None else "")
                + ".")
    join = {"rule": "scaled" if cited else "absolute", "next": "cited" if cited_kind else "modelled",
            "to_kind": nxt["kind"], "to_year": nxt["year"], "to_n": nxt["n"],
            "deep_n_raw": deep_pts[-1]["n"] / f, "deep_n": deep_pts[-1]["n"],
            "ratio": raw, "factor": f, "flag": flag, "note": note,
            # the first cited point, when it is after the cutoff and so not the deep past's level
            "cited_late": ({"year": late["year"], "n": late["n"], "kind": late["kind"]}
                           if late is not None else None)}
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
    """stats.json -> history.deep_join: species per join rule, and the flagged ones (ToLaD#80)."""
    joins = {sp: s["deep"]["join"] for sp, s in report.items() if s.get("deep")}
    flagged = {sp: {"rule": j["rule"], "ratio": j["ratio"], "factor": j["factor"], "to_kind": j["to_kind"]}
               for sp, j in sorted(joins.items(), key=lambda kv: -abs(math.log(kv[1]["ratio"])))
               if j["flag"]}
    return {
        "note": "How each genomic deep past meets the next level across PSMC's blind spot (ToLaD#77, #80, #71): "
                "a cited next level (a history file's baseline or first point) dated "
                f"{DEEP_JOIN_CITED_MAX_YEAR} or earlier scales the curve to meet it (rule `scaled`, factor = "
                "1 / ratio); a modelled one (the natural level in 1500 CE, today's modelled count) keeps the "
                f"genomic level (rule `absolute`). A first cited point after {DEEP_JOIN_CITED_MAX_YEAR} (a "
                "crash or a modern count, not a historical level) is not the deep past's level: the curve is "
                "kept, joins the natural level in 1500 CE where the range-loss trend applies (the trend then "
                "runs to that point), else that point itself (`cited_late` counts them). ratio = genomic level "
                f"at the blind spot / next level, before scaling; flagged when beyond {DEEP_JOIN_FLAG:g}x either "
                "way. Per species: history.species[<sp>].deep.join (its `note` is the card's sentence).",
        "by_rule": {r: sum(j["rule"] == r for j in joins.values()) for r in ("scaled", "absolute")},
        "cited_late": {"to_natural_1500": sum(bool(j.get("cited_late")) and j["to_kind"] == "rangeloss"
                                              for j in joins.values()),
                       "to_the_point": sum(bool(j.get("cited_late")) and j["to_kind"] in POINT_KINDS
                                           for j in joins.values())},
        "flagged_by_rule": {r: sum(f["rule"] == r for f in flagged.values()) for r in ("scaled", "absolute")},
        "flagged": flagged,
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
    whose deep past is the natural level (no baseline, no [deep]), or a genomic one whose first cited
    point is after DEEP_JOIN_CITED_MAX_YEAR, gets that knot before its first cited point, so the gap
    from 1500 to the first point is the trend, not a step (ToLaD#71)."""
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
        mu = mutation.for_leaf(raw, leaf, G) if rec["deep"] else None
        deep_pts, rec["deep_dropped"] = (deep_points(rec["deep"], G, year_to_ma_inv(leaf.t0), mu)
                                         if rec["deep"] else ([], []))
        if not deep_pts and not pts:  # a modelled genomic record whose steps all fell in the blind spot
            empty.append(rec["species"])
            continue
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
        # (no baseline, no [deep]), or at a genomic curve that is not scaled to the first cited point (it
        # is after DEEP_JOIN_CITED_MAX_YEAR), the range-loss trend runs from the natural level in 1500 CE
        # to that point instead of a held level and a step
        start = start_point(leaf) if start_point is not None and wild_counts else None
        first = pts[n_deep] if n_deep < len(pts) else None
        if (start is None and deep_pts and start_point is not None and wild_counts and first is not None
                and first["kind"] in POINT_KINDS and first["year"] > DEEP_JOIN_CITED_MAX_YEAR):
            # a genomic curve not scaled to its first cited point joins the natural level in 1500 even
            # where the model has no trend (no current range map: the scimitar oryx)
            start = start_point(leaf, True)
        trend = (start is not None and first is not None and first["kind"] in POINT_KINDS
                 and first["year"] > start["year"]
                 and (first["year"] > DEEP_JOIN_CITED_MAX_YEAR if deep_pts else nat_base is not None))
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
            # the join across the blind spot: a cited next level scales the curve, a modelled one does not
            deep_pts, rec["deep_join"] = deep_join(deep_pts, pts[n_deep], first if trend else None)
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
        deep_rep = None
        if deep_pts:
            deep_rep = {
                "method": rec["deep"]["method"], "cite": rec["deep"]["cite"], "grade": rec["deep"]["grade"],
                "bulk": bool(rec.get("deep_bulk")),
                "points": len(deep_pts), "dropped_blind": sum(p["why"] == "blind" for p in rec["deep_dropped"]),
                "dropped_before_band": sum(p["why"] != "blind" for p in rec["deep_dropped"]),
                "oldest_n": deep_pts[0]["n"], "oldest_yr_ago": NOW_YEAR - deep_pts[0]["year"], "youngest_yr_ago": NOW_YEAR - deep_pts[-1]["year"],
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
            "events": [f"{e['kind']} {e['from_ya']:g}-{e['to_ya']:g} ya: {e['title']}" for e in rec.get("events", [])],
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
