"""The reptiles a published number counts (ToLaD#578): pipeline/reptile_counts.toml, read and checked.

There is no reptile model: a reptile without an entry stays unknown (FLAG bit 11, amniotes.count_leaves). An entry's
number is used as its source gives it, never converted (the table's header says why); a source that gives only a
range has its geometric middle as the number. Its error: the source's range, never narrower than a census report's
(model.SD_CENSUS); its grade the table's, no better than that error allows.
"""

from __future__ import annotations

import math
import re
import tomllib
from pathlib import Path

from .model import SD_CENSUS, grade_from_sd

PATH = Path(__file__).resolve().parents[1] / "reptile_counts.toml"
GRADES = "ABCD"
KINDS = ("census", "estimate")
FIELDS = {"species", "n", "lo", "hi", "counts", "scope", "year", "grade", "kind", "cite", "url", "via", "quote",
          "note"}
NEEDED = ("species", "counts", "scope", "year", "grade", "kind", "cite", "url", "quote")


def load(path: Path = PATH) -> dict[str, dict]:
    """species -> {n, lo, hi, sd, grade (0-3), middle (n set as the range's geometric middle), and the row's fields}.
    Raises on a malformed entry: a number with no source never reaches the tree."""
    rows = tomllib.loads(path.read_text())["count"]
    out: dict[str, dict] = {}
    for r in rows:
        sp = r.get("species", "?")
        bad = set(r) - FIELDS
        if bad:
            raise ValueError(f"reptile_counts: {sp}: unknown fields {sorted(bad)}")
        miss = [k for k in NEEDED if not str(r.get(k, "")).strip()]
        if miss:
            raise ValueError(f"reptile_counts: {sp}: no {', '.join(miss)}")
        if sp in out:
            raise ValueError(f"reptile_counts: {sp} twice")
        if r["grade"] not in GRADES or r["kind"] not in KINDS:
            raise ValueError(f"reptile_counts: {sp}: grade {r['grade']!r} or kind {r['kind']!r}")
        if not r["url"].startswith("https://"):
            raise ValueError(f"reptile_counts: {sp}: url {r['url']!r}")
        lo, hi = r.get("lo"), r.get("hi")
        if (lo is None) != (hi is None):
            raise ValueError(f"reptile_counts: {sp}: lo and hi go together")
        middle = "n" not in r
        if middle and lo is None:
            raise ValueError(f"reptile_counts: {sp}: no n and no range")
        n = float(math.sqrt(lo * hi) if middle else r["n"])
        if not (n > 0 and (lo is None or 0 < lo <= n <= hi)):
            raise ValueError(f"reptile_counts: {sp}: n {n} outside {lo}-{hi}")
        # the 95% range in dex below and above n: the source's range, no narrower than a census report's error
        floor = 1.96 * SD_CENSUS
        dlo = max(floor, math.log10(n / lo) if lo is not None else 0.0)
        dhi = max(floor, math.log10(hi / n) if hi is not None else 0.0)
        sd = (dlo + dhi) / (2 * 1.96)
        g = max(GRADES.index(r["grade"]), grade_from_sd(sd))
        out[sp] = {**r, "n": n, "lo": lo, "hi": hi, "dlo": dlo, "dhi": dhi, "sd": sd, "grade_i": g, "middle": middle}
    return out


def method(e: dict) -> str:
    """The row's method line (METH): the figure, what it counts, its year and source."""
    rng = f" (its {e['lo']:,.0f}-{e['hi']:,.0f}: the geometric middle, set here)" if e["middle"] else \
        (f" ({e['lo']:,.0f}-{e['hi']:,.0f})" if e["lo"] is not None else "")
    word = "census" if e["kind"] == "census" else "published estimate"
    return (f"N:{word} {e['n']:,.0f}{rng} {e['counts']}, {e['scope']}, {e['year']}: {e['cite']}"
            + (f" (read through {e['via']})" if e.get("via") else "")
            + "; used as the source gives it, not converted to all ages")


def short(cite: str) -> str:
    """A citation's few words for the card: its authors before the first year, initials and brackets dropped, as
    "Isberg et al. 2019", "NMFS & USFWS 2020", "Jiang & Wu 2018"."""
    m = re.search(r"\((\d{4})", cite)
    if m is None:
        return cite.split(".")[0]
    who = re.sub(r"\([^)]*\)", "", cite[:m.start()]).strip(" ,;")
    if " et al" in who:
        return f"{who.split(' et al')[0]} et al. {m.group(1)}"
    names = [p for p in re.split(r",\s*|\s*&\s*", who) if p and not re.fullmatch(r"(?:[A-Z]\.-?\s?)+", p)]
    head = names[0] if len(names) == 1 else " & ".join(names) if len(names) == 2 else f"{names[0]} et al."
    return f"{head} {m.group(1)}"


def card(e: dict) -> dict:
    """What the species card says of it (the dated sidecar's `count`, FORMAT.md): what it counts, its year, kind,
    source (in full and in a few words) and link."""
    return {"counts": e["counts"], "year": e["year"], "kind": e["kind"], "cite": e["cite"], "short": short(e["cite"]),
            "url": e["url"]}
