"""Data audit (ToLaD#113): flag the data artifacts that would reach the fan looking like real history.

Past bugs of this kind were all found by eye (the cougar's 26x climb to a modelled level, #94; the
wisent's 386x climb to a modelled 7M, #92; the range-loss trend running upward, #93; the black-footed
ferret's modelled 161k, #72; the Eurasian lynx at ~400k, #110; Red List EX species drawn living,
#105; the steps explosion, #70). research/data-audit.md classifies them; this module checks every
species leaf for each class, with thresholds taken from stated rules, not tuned:

  join     a change of more than JOIN_FLAG (10x, the #77 rule) between two adjacent knots of the drawn
           curve that are not both cited (a join between sources, or a modelled span); `rapid` when
           it happens within IUCN criterion A's window (max(10 years, 3 generations))
  today    a modelled today's count more than 10x off an independent published figure for the same
           species (Greenspoon 2023's IUCN census compilation, its per-species model, or a recent cited
           point of a history file that does not drive the count); `unanchored` (a state, not a
           flag) when there is none
  ceiling  an IUCN CR/EW species whose today's count is modelled and above 10,000, the largest
           population criterion C or D allows any threatened listing (VU C; #88's rule). EN is not
           checked: listed under criterion A or B, an EN species can be of any size
  deep     a genomic deep past the pipeline's own #77/#80 rule flags (beyond 10x of the next level), or
           whose join runs against PSMC's dropped blind-spot steps (#143: their mean beyond 1.5x of the
           youngest resolved step the other way; kept and drawn only where [deep.blind] cites a source)
  status   a living leaf the Red List calls EX, an extinct leaf the Red List assesses as living, an
           EW species drawn with a wild count, a fossil graft ending at the present (#105)
  name     a living leaf no extant-species list recognises (Upham, PHYLACINE, Greenspoon/IUCN, Red
           List): a stale or infraspecific name drawn as a species with its own count
  units    a genomic curve rescaled (time or Ne) by more than DEEP_FACTOR_FLAG (3x) from its source,
           beyond the 0.35-2.55x spread of the sources' own per-year mutation rates (#75)

The steps class (#70) is guarded in web/src/fan/population.test.ts (steps per cat bounded).

    make -C pipeline audit   (after a build: reads data/build/audit_leaves.json)

The build writes the snapshot (`snapshot`, called from build.py); `main` checks it, writes
research/data-audit-report.md (ranked: Felidae first, as the fan shows them) and
data/build/audit.json, and prints a summary.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

JOIN_FLAG = 10.0  # ToLaD#77: a ratio beyond 10x either way between two levels is flagged
TODAY_FLAG = 10.0  # the same 10x, for today's count against an independent published figure
CEILING = 10_000.0  # IUCN Categories and Criteria v3.1: criterion C's VU bound, the largest C/D allows
CEILING_STATUS = ("CR", "EW")  # #88; EN is not: listed under A or B it can be any size
C_BOUND = {"CR": 250.0, "EN": 2_500.0, "VU": 10_000.0}  # criterion C, mature individuals (context)
DEEP_FACTOR_FLAG = 3.0  # #75: the sources' per-year rates run 0.35-2.55x of the 1e-9 the curves use
IUCN_A_YEARS, IUCN_A_GENS = 10.0, 3.0  # criterion A's window: 10 years or 3 generations, the longer
RECENT_YEAR = 2000  # a cited point this recent is a today's figure (history.ALIVE_MIN_YEAR)
CITED = {"census", "estimate", "index-scaled", "reconstruction", "unverified"}  # history.POINT_KINDS
LIVING_CATS = {"LC", "NT", "VU", "EN", "CR", "DD"}
# severity of a categorical error, in the same dex units as a ratio: a wrong alive/dead state or a
# species that is not one is as visible as a 100x error
SEV_STATUS, SEV_NAME = 2.0, 1.0
ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "data" / "build" / "audit_leaves.json"
REPORT_MD = ROOT / "research" / "data-audit-report.md"
REPORT_JSON = ROOT / "data" / "build" / "audit.json"
REVIEWED = ROOT / "pipeline" / "audit-reviewed.toml"  # flags checked and accepted, each with its reason
FAN_SPLITS = ROOT / "web" / "src" / "fan" / "splits.ts"  # the species the Felidae view places


# ------------------------------------------------------------------ snapshot (from the build)


def _ancestor(n, rank: str) -> str | None:
    p = n.parent
    while p is not None:
        if p.rank == rank and p.name:
            return p.name.removesuffix(" (crown)")
        p = p.parent
    return None


def _today_src(n) -> str:
    D = n.data
    if D.get("alive_from_history"):
        return "history"
    if D.get("domestic"):
        return "domestic"
    meth = " ".join(D.get("meth", []))
    if "N:census" in meth:
        return "census"
    if "N:capped at" in meth:
        return "cap"
    if "N:Greenspoon" in meth:
        return "greenspoon model"
    if n.name == "Homo sapiens":
        return "anchor"
    return "model"


def _knot(p: dict) -> dict:
    kind = p.get("span_kind") if p.get("held_from") is not None else p["kind"]
    src = ("cited" if p.get("held_from") is not None or p["kind"] in CITED
           else "genomic" if p["kind"] == "genomic" else "modelled")
    return {"year": float(p["year"]), "n": float(p["n"]), "kind": kind, "src": src}


def _knots_from_pieces(n) -> list[dict]:
    """A leaf with no history record: its births pieces as level knots (one per change)."""
    from .anchors import NOW_YEAR
    D = n.data
    L = D.get("L") or 0.0
    spans: list[list[float]] = []  # [year_from, year_to, level], equal neighbours merged
    nw = D.get("n_wild_pieces", len(D.get("pieces", [])))
    for old, young, r in D.get("pieces", [])[:nw]:
        lvl = r * L
        if spans and lvl > 0 and abs(math.log(lvl / spans[-1][2])) < 1e-9:
            spans[-1][1] = NOW_YEAR - young * 1e6
            continue
        spans.append([NOW_YEAR - old * 1e6, NOW_YEAR - young * 1e6, lvl])
    out: list[dict] = []
    for i, (y0, y1, lvl) in enumerate(spans):  # each level held over its span: a change is a step
        kind = "natural" if i == 0 and len(spans) > 1 else "model"
        out += [{"year": y0, "n": lvl, "kind": kind, "src": "modelled"},
                {"year": y1, "n": lvl, "kind": kind, "src": "modelled"}]
    return out


def leaf_row(n, census: dict, gs_model: dict, deep_reports: dict | None = None) -> dict:
    D = n.data
    rec = D.get("history") or {}
    deep = rec.get("deep_join") if isinstance(rec.get("deep_join"), dict) else None
    curve = [_knot(p) for p in rec.get("curve", [])] if rec else []
    if not curve and not n.extinct:
        curve = _knots_from_pieces(n)
    nat = D.get("natural")
    rl = D.get("red_list") or {}
    row = {
        "name": n.name, "family": _ancestor(n, "family") or D.get("upham_family"),
        "order": _ancestor(n, "order") or D.get("upham_order"), "kind": n.kind,
        "extinct": bool(n.extinct), "extinct_by": D.get("extinct_by"), "t1_ma": n.t1,
        "alive": float(D.get("alive", 0.0)), "today_src": _today_src(n),
        "domestic": bool(D.get("domestic")), "G": 2 * D["L"] if D.get("L") else None,
        "phylacine": D.get("iucn"), "upham": bool(n.upham),
        "red_list": rl.get("category"), "red_list_year": rl.get("year"),
        "natural": {k: nat[k] for k in ("N", "lo", "hi")} if nat else None,
        "census": (census.get(n.name) or {}).get("N"), "gs_model": (gs_model.get(n.name) or {}).get("N"),
        "file": rec.get("file"), "modelled": rec.get("modelled"), "use": rec.get("use"),
        "curve": curve,
        "deep": ({k: deep.get(k) for k in ("ratio", "flag", "rule", "to_kind", "to_n", "deep_n", "factor", "blind")}
                 if deep else None),
        "deep_factors": None,
    }
    rep = (deep_reports or {}).get(n.name)
    if rec.get("deep") and rep and rep.get("mu"):
        # the source's own rates against the lineage's per-year rate band (mutation.py, #74/#75)
        mu = rep["mu"]
        row["deep_factors"] = {"time": rep["time_factor"], "ne": rep["ne_factor"], "cite": rec["deep"].get("cite"),
                               "src_mu_gen": rec["deep"]["mu"], "src_g": rec["deep"]["g"], "G": mu["G"],
                               "mu_year": mu["mu_year"], "lo": mu["lo"], "hi": mu["hi"], "clade": mu.get("clade")}
    return row


def snapshot(root, raw: Path, work: Path, log: dict | None = None) -> Path:
    """Write the per-leaf rows the audit checks (every species leaf that is living, or carries a
    Red List status, or is a graft ending at the present)."""
    from . import anchors
    census = anchors.greenspoon_census(raw)
    gs_model = anchors.greenspoon_species_model(raw)
    deep = {r["leaf"]: r["deep"] for r in ((log or {}).get("history", {}).get("species", {})).values()
            if r.get("deep")}
    rows = []
    for n in root.preorder():
        if not n.is_leaf or not n.name or n.data.get("empty_higher"):
            continue
        if n.extinct and not n.data.get("red_list") and n.t1 > 0:
            continue
        rows.append(leaf_row(n, census, gs_model, deep))
    work.mkdir(parents=True, exist_ok=True)
    path = work / SNAPSHOT.name
    path.write_text(json.dumps({"version": 1, "rows": rows}, separators=(",", ":")))
    return path


# ------------------------------------------------------------------ checks


def _flag(cls: str, sev: float, what: str, **kw) -> dict:
    return {"class": cls, "severity": round(sev, 3), "what": what, **kw}


def _fmt(x: float | None) -> str:
    if x is None:
        return "-"
    if x >= 1e6:
        return f"{x / 1e6:.3g}M"
    if x >= 1e4:
        return f"{x / 1e3:.3g}k"
    return f"{x:.3g}"


def _yr(y: float) -> str:
    return f"{-y / 1e3:.0f} kya" if y < -10_000 else f"{-y:.0f} BCE" if y < 0 else f"{y:.0f}"


def _what(k: dict) -> str:
    return k["kind"] if k["kind"] == k["src"] else f"{k['src']} {k['kind']}"


def check_join(row: dict) -> list[dict]:
    out = []
    c = row["curve"]
    if c and row["today_src"] == "census" and c[-1]["kind"] == "model":
        # a modelled record ends at the shipped count, which a census sets here: that end is cited
        c = c[:-1] + [{**c[-1], "src": "cited", "kind": "census"}]
    G = row.get("G") or 1.0
    window = max(IUCN_A_YEARS, IUCN_A_GENS * G)
    for a, b in zip(c, c[1:]):
        if a["src"] == "cited" and b["src"] == "cited":
            continue  # supported by the cited points at both ends
        if a["src"] == "genomic" and b["src"] == "genomic":
            continue  # one source's own curve
        if a["n"] <= 0 or b["n"] <= 0:
            continue
        r = b["n"] / a["n"]
        if max(r, 1 / r) <= JOIN_FLAG:
            continue
        span = b["year"] - a["year"]
        rapid = span < window
        out.append(_flag("join", abs(math.log10(r)),
                         f"{'rises' if r > 1 else 'falls'} {max(r, 1 / r):.3g}x from {_what(a)} "
                         f"{_fmt(a['n'])} ({_yr(a['year'])}) to {_what(b)} {_fmt(b['n'])} "
                         f"({_yr(b['year'])})" + (f" within {span:.0f} yr (IUCN A window {window:.0f})"
                                                  if rapid else ""),
                         ratio=r, rapid=rapid, frm=a, to=b))
    return out


def anchors_for(row: dict) -> list[tuple[str, float]]:
    """Independent published figures for today's count (none is the count's own source)."""
    src = row["today_src"]
    out = []
    if row.get("census") and src != "census":
        out.append(("IUCN census (Greenspoon 2023 compilation)", row["census"]))
    if row.get("gs_model") and src not in ("census", "greenspoon model"):
        out.append(("Greenspoon 2023 per-species model", row["gs_model"]))
    if src != "history":
        recent = [k for k in row["curve"] if k["src"] == "cited" and k["year"] >= RECENT_YEAR]
        if recent:
            out.append((f"history file {row.get('file')} ({recent[-1]['kind']} {recent[-1]['year']:.0f})",
                        recent[-1]["n"]))
    return out


def check_today(row: dict) -> tuple[list[dict], bool]:
    """Flags, and whether today's count rests on no published figure at all (unanchored)."""
    src = row["today_src"]
    if row["extinct"] or row["alive"] <= 0 or row["domestic"] or src not in ("model", "greenspoon model"):
        return [], False  # a cited count (census, history file) or the CR cap is not a modelled level
    out = []
    for label, v in anchors_for(row):
        r = row["alive"] / v
        if max(r, 1 / r) > TODAY_FLAG:
            out.append(_flag("today", abs(math.log10(r)),
                             f"today {_fmt(row['alive'])} ({src}) is {max(r, 1 / r):.3g}x "
                             f"{'above' if r > 1 else 'below'} {label} {_fmt(v)}", ratio=r, anchor=label))
    unanchored = src in ("model", "greenspoon model") and not row.get("census") and not any(
        k["src"] == "cited" and k["year"] >= RECENT_YEAR for k in row["curve"])
    return out, unanchored


def check_ceiling(row: dict) -> list[dict]:
    cat = row.get("red_list") or row.get("phylacine")
    if (cat in CEILING_STATUS and not row["extinct"] and row["today_src"] in ("model", "greenspoon model")
            and row["alive"] > CEILING):
        return [_flag("ceiling", math.log10(row["alive"] / CEILING),
                      f"IUCN {cat} but modelled at {_fmt(row['alive'])} ({row['today_src']}), above "
                      f"{_fmt(CEILING)} (criterion C's widest bound; {cat} C bound "
                      f"{_fmt(C_BOUND.get(cat, 0))})", ratio=row["alive"] / CEILING)]
    return []


def check_deep(row: dict) -> list[dict]:
    d = row.get("deep")
    if not d:
        return []
    out = []
    bl = d.get("blind") or {}
    if bl.get("against"):  # the join runs against PSMC's dropped blind-spot steps (ToLaD#143)
        v = bl["vs_resolved"]
        out.append(_flag("deep", abs(math.log10(v)),
                         f"PSMC's {bl['steps']} blind-spot steps average {max(v, 1 / v):.2g}x "
                         f"{'below' if v < 1 else 'above'} the youngest resolved step but are not drawn "
                         "(no [deep.blind] source), and the join goes the other way", blind=v))
    if not d.get("flag"):
        return out
    r = d["ratio"]
    return out + [_flag("deep", abs(math.log10(r)),
                  f"genomic level {_fmt(d['deep_n'])} is {max(r, 1 / r):.3g}x "
                  f"{'above' if r > 1 else 'below'} the next level ({d['to_kind']}, {_fmt(d['to_n'])}); "
                  f"rule {d['rule']}" + (f" x{d['factor']:.3g}" if d["rule"] == "scaled" else ""), ratio=r)]


def check_status(row: dict) -> list[dict]:
    rl, living = row.get("red_list"), not row["extinct"] and row["t1_ma"] == 0
    out = []
    if living and rl == "EX":
        out.append(_flag("status", SEV_STATUS, f"drawn living ({_fmt(row['alive'])} alive) but Red List "
                                               f"{row.get('red_list_year')} says EX"))
    if row["extinct"] and rl in LIVING_CATS:
        out.append(_flag("status", SEV_STATUS, f"drawn extinct ({row.get('extinct_by')}) but Red List "
                                               f"{row.get('red_list_year')} assesses it {rl}"))
    if living and rl == "EW" and row["alive"] > 0 and row["today_src"] != "history":
        out.append(_flag("status", 1.0, f"Red List EW but drawn with a modelled wild count {_fmt(row['alive'])}"))
    if row["extinct"] and row["t1_ma"] == 0:
        out.append(_flag("status", SEV_STATUS, ("fossil graft" if row["kind"] == "graft" else "extinct leaf")
                         + f" ({row.get('extinct_by') or 'PBDB'}"
                         + (f", Red List {rl}" if rl else "") + ") whose band runs to the present (T1 = 0)"))
    if row["kind"] == "graft" and row["t1_ma"] == 0 and not row["extinct"]:
        out.append(_flag("status", SEV_STATUS, "fossil graft ends at the present (drawn living)"))
    return out


def check_name(row: dict) -> list[dict]:
    if (row["kind"] == "tree" and not row["extinct"] and row["t1_ma"] == 0 and not row["upham"]
            and not row.get("phylacine") and not row.get("census") and not row.get("gs_model")
            and row.get("red_list") in (None, "NE") and row["name"] != "Homo sapiens"):
        return [_flag("name", SEV_NAME, f"no extant-species list knows this name (Upham, PHYLACINE, "
                                        f"Greenspoon/IUCN, Red List: {row.get('red_list') or 'none'}); drawn "
                                        f"as a living species with {_fmt(row['alive'])} alive")]
    return []


def check_units(row: dict) -> list[dict]:
    f = row.get("deep_factors")
    if not f:
        return []
    out = []
    if f.get("lo"):
        # the lineage's per-year rate has a 95% band (mutation.py: Bergeron 2023 pedigree fit), hi / lo wide.
        # Rescaling a source's curve to any rate inside the band moves it by less than that width; a
        # bigger rescale is more than the rate's uncertainty explains (a time axis read in the wrong unit,
        # a generation length mixed up: the g = 1 figures of #66)
        width = f["hi"] / f["lo"]
        for k, v in (("time", f["time"]), ("Ne", f["ne"])):
            if v <= 0 or max(v, 1 / v) <= width:
                continue
            src = f["src_mu_gen"] / f["src_g"] if k == "time" else f["src_mu_gen"]
            out.append(_flag("units", math.log10(max(v, 1 / v) / width),
                             f"the curve's {k} is rescaled x{v:.3g} from its source ({f.get('cite')}: "
                             f"{src:.3g}{'/yr' if k == 'time' else '/gen'}, g = {f['src_g']:g}), more than the "
                             f"lineage's 95% rate band spans ({width:.2g}x; {f.get('clade')})", factor=v))
        return out
    for k in ("time", "ne"):  # a snapshot without the lineage band: the #75 spread
        v = f[k]
        if v > 0 and max(v, 1 / v) > DEEP_FACTOR_FLAG:
            out.append(_flag("units", abs(math.log10(v)),
                             f"genomic curve's {k} rescaled x{v:.3g} from its source ({f.get('cite')}); "
                             f"beyond {DEEP_FACTOR_FLAG:g}x", factor=v))
    return out


CHECKS = (check_join, check_ceiling, check_deep, check_status, check_name, check_units)


def load_reviewed(path: Path = REVIEWED) -> dict[tuple[str, str], dict]:
    """(species, class) -> {reason, issue}: flags a person has checked and accepted as real (not a bug)."""
    if not path.exists():
        return {}
    import tomllib
    out = {}
    for r in tomllib.loads(path.read_text()).get("reviewed", []):
        for k in ("species", "class", "reason", "issue"):
            if k not in r:
                raise ValueError(f"{path}: reviewed entry {r} lacks {k!r}")
        out[(r["species"], r["class"])] = {"reason": r["reason"], "issue": r["issue"]}
    return out


def fan_placed(path: Path = FAN_SPLITS) -> set[str]:
    """The species the Felidae view places (web/src/fan/splits.ts names them as quoted binomials)."""
    if not path.exists():
        return set()
    return set(re.findall(r"'([A-Z][a-z]+ [a-z]+)'", path.read_text()))


def _clean(x: str | None) -> str | None:
    return x.removesuffix(" (crown)") if x else x


def audit_row(row: dict, reviewed: dict | None = None, placed: set[str] | frozenset = frozenset()) -> dict:
    flags = [f for chk in CHECKS for f in chk(row)]
    tf, unanchored = check_today(row)
    flags += tf
    for f in flags:
        rv = (reviewed or {}).get((row["name"], f["class"]))
        if rv:
            f["reviewed"] = rv
    open_ = [f for f in flags if not f.get("reviewed")]
    return {"name": row["name"], "family": _clean(row.get("family")), "order": _clean(row.get("order")),
            "in_fan": row["name"] in placed, "extinct": row["extinct"],
            "alive": row["alive"], "today_src": row["today_src"], "red_list": row.get("red_list"),
            "file": row.get("file"), "flags": flags, "unanchored": unanchored,
            "severity": max((f["severity"] for f in open_), default=0.0)}


def state(r: dict) -> str:
    if any(not f.get("reviewed") for f in r["flags"]):
        return "flagged"
    if r["flags"]:
        return "reviewed"
    return "unanchored" if r["unanchored"] else "clean"


def tier(r: dict) -> int:
    """How visible in the Felidae view: the cats it places, the other Felidae leaves (in the tiles' Felidae
    totals and the tree, not placed in the fan), the rest of Carnivora, everything else."""
    return (0 if r["in_fan"] else 1 if r.get("family") == "Felidae" else 2 if r.get("order") == "Carnivora"
            else 3)


def run(rows: list[dict], reviewed: dict | None = None, placed: set[str] | frozenset = frozenset()) -> dict:
    res = [audit_row(r, reviewed, placed) for r in rows]
    flagged = sorted((r for r in res if state(r) == "flagged"),
                     key=lambda r: (tier(r), -r["severity"], -r["alive"]))
    order = {"flagged": 0, "reviewed": 1, "unanchored": 2, "clean": 3}
    cats = sorted((r for r in res if r.get("family") == "Felidae"),
                  key=lambda r: (tier(r), order[state(r)], -r["severity"], -r["alive"]))
    by_class: dict[str, int] = {}
    for r in flagged:
        for c in sorted({f["class"] for f in r["flags"] if not f.get("reviewed")}):
            by_class[c] = by_class.get(c, 0) + 1
    names = [r for r in res if any(f["class"] == "name" for f in r["flags"])]
    return {"leaves": len(res), "flagged": len(flagged), "by_class": by_class,
            "reviewed": sum(state(r) == "reviewed" for r in res),
            "unanchored": sum(r["unanchored"] for r in res),
            "name_alive": sum(r["alive"] for r in names),
            "cats": cats, "ranked": flagged}


# ------------------------------------------------------------------ report


def _causes(r: dict, limit: int | None = None) -> str:
    fl = r["flags"][:limit] if limit else r["flags"]
    s = "; ".join(f"**{f['class']}**: {f['what']}"
                  + (f" *(reviewed, #{f['reviewed']['issue']}: {f['reviewed']['reason']})*"
                     if f.get("reviewed") else "") for f in fl)
    if limit and len(r["flags"]) > limit:
        s += f" (+{len(r['flags']) - limit} more)"
    return s


def render_md(rep: dict, top: int = 60) -> str:
    L = ["# Data audit report (generated)", "",
         "*Generated by `make -C pipeline audit` (`pipeline/tolad_pipeline/audit.py`, ToLaD#113) from the last "
         "build's snapshot; overwritten on each run. Classes, thresholds and the display proposal: "
         "`research/data-audit.md`. Accepted flags: `pipeline/audit-reviewed.toml`.*", "",
         f"{rep['leaves']} species leaves checked; **{rep['flagged']} flagged**, {rep['reviewed']} with reviewed "
         f"flags only; {rep['unanchored']} living species have a modelled today's count that no published "
         "figure checks (unanchored: a state, not a flag).", "",
         "| class | species flagged |", "|---|---|"]
    L += [f"| {c} | {n} |" for c, n in sorted(rep["by_class"].items(), key=lambda kv: -kv[1])]
    L += ["", "## Every cat (Felidae)", "",
          "In the fan's order of visibility: the cats the Felidae view places first, then the other Felidae "
          "leaves (in the tree and in the tiles' Felidae totals, not placed in the fan). State: `flagged` (open "
          "causes listed), `reviewed` (every flag checked and accepted), `unanchored` (no flag, but today's "
          "count is modelled and no published figure checks it), `clean`. sev = the worst open flag in dex "
          "(log10 of the ratio drawn; a wrong alive/dead state counts 2, an unrecognised name 1).", "",
          "| cat | in fan | state | sev | alive (source) | Red List | causes |", "|---|---|---|---|---|---|---|"]
    for r in rep["cats"]:
        causes = _causes(r) or ("today's count modelled, no published figure" if r["unanchored"] else "")
        L.append(f"| *{r['name']}* | {'yes' if r['in_fan'] else 'no'} | {state(r)} | {r['severity']:.2f} | "
                 f"{_fmt(r['alive'])} ({'extinct' if r['extinct'] else r['today_src']}) | "
                 f"{r.get('red_list') or '-'} | {causes} |")
    rest = [r for r in rep["ranked"] if r.get("family") != "Felidae"]
    named = [r for r in rest if {f["class"] for f in r["flags"] if not f.get("reviewed")} == {"name"}]
    other = [r for r in rest if r not in named]
    L += ["", f"## Beyond the cats: the {min(top, len(other))} most visible of {len(other)} flagged "
              "(the name-only class summarised below)",
          "", "Ranked: the rest of Carnivora first, then by severity.", "",
          "| species | family | sev | alive (source) | causes |", "|---|---|---|---|---|"]
    for r in other[:top]:
        L.append(f"| *{r['name']}* | {r.get('family') or '-'} | {r['severity']:.2f} | "
                 f"{_fmt(r['alive'])} ({r['today_src']}) | {_causes(r, 3)} |")
    big = sorted(named, key=lambda r: -r["alive"])[:15]
    L += ["", f"## Names no extant-species list knows ({len(named)} beyond the cats)", "",
          f"Drawn as living species with {_fmt(rep['name_alive'])} individuals alive in all (cats included): "
          "mostly subspecies or synonyms Open Tree keeps as species tips, each given its clade's mean count. "
          "The largest:", "",
          ", ".join(f"*{r['name']}* {_fmt(r['alive'])}" for r in big) + "."]
    return "\n".join(L) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--snapshot", type=Path, default=SNAPSHOT)
    ap.add_argument("--md", type=Path, default=REPORT_MD)
    ap.add_argument("--json", type=Path, default=REPORT_JSON)
    a = ap.parse_args(argv)
    if not a.snapshot.exists():
        print(f"audit: no snapshot at {a.snapshot}; run `make build` first", file=sys.stderr)
        return 2
    rows = json.loads(a.snapshot.read_text())["rows"]
    rep = run(rows, load_reviewed(), fan_placed())
    a.md.write_text(render_md(rep))
    a.json.write_text(json.dumps(rep, indent=1, default=str) + "\n")
    cats = rep["cats"]
    n = {s: sum(state(r) == s for r in cats if r["in_fan"]) for s in ("flagged", "reviewed", "unanchored", "clean")}
    print(f"audit: {rep['leaves']} leaves, {rep['flagged']} flagged {rep['by_class']}; cats in the fan: {n}; "
          f"other Felidae leaves flagged: {sum(state(r) == 'flagged' for r in cats if not r['in_fan'])} -> {a.md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
