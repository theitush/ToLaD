"""Bulk genomic deep past (layer 3 of the estimate stack, ToLaD#64).

Bergman et al. 2023 (Nat Commun 14:7679, CC BY 4.0) ran PSMC on one genome of each of 139 extant
megafauna species (>= 44 kg) and published every trajectory as a table: Supplementary Data 3 (sample,
time in years, Ne, in the paper's own scaling) with each sample's mutation rate per generation and
generation time in Supplementary Data 1. This module reads them and emits, per species, the same
[deep] table a history file holds (history._check_deep), so history.apply runs them through the one
conversion of ToLaD#60 (rescale to DEEP_MU_YEAR and the leaf's G, Ne -> N by DEEP_NE_N, the blind
spot dropped, joined to the next level by history.deep_join: scaled to a cited level, else kept).

Precedence: a hand-written [deep] in pipeline/history/*.toml wins (the five Panthera keep Armstrong
2025). A wild `counts` history file without one gets the bulk curve as its [deep]. A species with no
history file gets a modelled record (`modelled = "genomic"`): the genomic points, then (when it has
the range-loss trend of ToLaD#62) the natural level in 1500 CE and the trend to today's count, else
today's count. See pipeline/history/README.md, "Bulk genomic deep past".
"""

from __future__ import annotations

import csv
import math
from collections import defaultdict
from pathlib import Path

CITE = "Bergman et al. 2023, Nat Commun 14:7679, Supplementary Data 3 (PSMC Ne trajectory)"
URL = "https://doi.org/10.1038/s41467-023-43426-5"
LICENSE = "CC BY 4.0"
SD1 = "bergman/Bergman2023_SupplementaryData1.csv"
SD3 = "bergman/Bergman2023_SupplementaryData3.txt"
GRADE = "D"  # one genome, mostly modelled mutation rates (Supplementary Note 1): never better than D
STEP_CAP = 30  # PSMC steps kept per species at most (the fan draws one step per change, ToLaD#70)
# The paper's names that are synonyms of the names the tree, PHYLACINE or Data 1 use (Supplementary Data 2
# maps them to PHYLACINE; the eland sits under Tragelaphus in Data 3 and Taurotragus in Data 1).
SYNONYMS = {
    "Hemitragus hylocrius": ["Nilgiritragus hylocrius"],
    "Hexaprotodon liberiensis": ["Choeropsis liberiensis"],
    "Tragelaphus oryx": ["Taurotragus oryx"],
    "Taurotragus oryx": ["Tragelaphus oryx"],
    "Equus quagga": ["Equus burchellii"],  # the Open Tree keeps the plains zebra under its older name
    "Macropus rufus": ["Osphranter rufus"],  # red kangaroo, now in Osphranter
}
SKIP = {"Homo sapiens"}  # humans have their own demography (WPP, PRB); the paper's samples incl. simulated


def _sample_name(s: str) -> str:
    return s.replace("_dnaZoo", "").replace("_PanLeo", "").replace("_", " ").strip()


def _pick(samples: list[str], binomial: str) -> str:
    """One sample per species: the reference-genome sample (bare binomial or DNA Zoo), else the
    nominate subspecies (the one Supplementary Data 2 uses), else the first by name."""
    names = {s: _sample_name(s) for s in samples}
    for s in sorted(samples):
        if names[s] == binomial:
            return s
    nominate = binomial + " " + binomial.split()[1]
    for s in sorted(samples):
        if names[s] == nominate:
            return s
    return sorted(samples)[0]


def cap_steps(steps: list[list[float]], cap: int = STEP_CAP) -> list[list[float]]:
    """Merge neighbouring steps (closest in log Ne first) until at most `cap` remain. A merged step
    keeps the time-weighted harmonic mean of Ne, as PSMC's Ne is a coalescence-rate inverse."""
    out = [list(s) for s in steps]
    while len(out) > cap:
        i = min(range(len(out) - 1), key=lambda j: abs(math.log(out[j][2] / out[j + 1][2])))
        a, b = out[i], out[i + 1]
        w1, w2 = a[1] - a[0], b[1] - b[0]
        out[i:i + 2] = [[a[0], b[1], (w1 + w2) / (w1 / a[2] + w2 / b[2])]]
    return out


def load(raw: Path) -> dict[str, dict]:
    """binomial -> {"deep": [deep] table, "sample": ..., "names": [binomial + synonyms]}."""
    meta = {}
    with (raw / SD1).open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            meta[r["Species"].strip()] = r
    rows = defaultdict(list)
    with (raw / SD3).open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            rows[r["Species"]].append((float(r["time"]), float(r["Ne"])))
    by_sp = defaultdict(list)
    for s in rows:
        by_sp[" ".join(_sample_name(s).split()[:2])].append(s)
    out = {}
    for sp, samples in sorted(by_sp.items()):
        if sp in SKIP:
            continue
        s = _pick(samples, sp)
        name = _sample_name(s)
        m = meta.get(name) or next((meta[a] for a in SYNONYMS.get(name, []) if a in meta), None)
        if m is None:
            continue
        tn = sorted(rows[s])
        # PSMC steps [t_i, t_i+1): the first starts at 0 (inside the blind spot anyway) and the last
        # is open-ended; both are left out. Equal neighbours (grouped atoms) are merged.
        steps = []
        for (a, ne), (b, _) in zip(tn, tn[1:]):
            if a <= 0 or b <= a or ne <= 0:
                continue
            if steps and steps[-1][2] == ne and steps[-1][1] == a:
                steps[-1][1] = b
            else:
                steps.append([a, b, ne])
        if len(steps) < 3:
            continue
        n_in = len(steps)
        steps = cap_steps(steps)
        deep = {
            "method": "PSMC", "cite": CITE, "url": URL, "grade": GRADE,
            "mu": float(m["Mutation rate per generation"]), "g": float(m["Generation time in years"]),
            "note": (f"sample {s}; PSMC -p {m['PSMC (-p parameter)']}, coverage {m['Coverage']}x; "
                     f"g from {m['Generation time in years (source)']}, mu from "
                     f"{m['Mutation rate per generation (source)']}; {n_in} steps"
                     + (f" merged to {len(steps)}" if len(steps) < n_in else "")
                     + " (first and open last step left out)"),
            "steps": steps,
        }
        out[sp] = {"deep": deep, "sample": s, "names": [sp] + SYNONYMS.get(sp, [])}
    return out


def attach(recs: list[dict], leaves: dict, curves: dict[str, dict], start_point, log: dict) -> list[dict]:
    """Give the bulk curves to the history records (in place) and return the new modelled records.

    `leaves`: tree leaf name -> living leaf. `start_point(leaf)` gives the natural-level point in
    1500 CE for a leaf with the range-loss trend (model.rangeloss_start), else None."""
    by_name = {}
    for r in recs:
        for nm in [r["species"]] + r["aliases"]:
            by_name[nm] = r
    rows, new = {}, []
    for sp, c in curves.items():
        rec = next((by_name[n] for n in c["names"] if n in by_name), None)
        if rec is not None:
            if rec["deep"] is not None:
                why = "hand-written [deep] wins"
            elif rec["component"] != "wild" or rec["use"] != "counts":
                why = f"history file is {rec['component']} / {rec['use']}"
            else:
                rec["deep"] = c["deep"]
                rec["deep_bulk"] = True
                why = "history file"
            rows[sp] = {"used": why == "history file", "how": why, "leaf": rec["species"], "sample": c["sample"]}
            continue
        leaf = next((leaves[n] for n in c["names"] if n in leaves), None)
        if leaf is None:
            rows[sp] = {"used": False, "how": "no living tree leaf of this name", "sample": c["sample"]}
            continue
        D = leaf.data
        if D.get("rate_wild_now", 0.0) <= 0:
            rows[sp] = {"used": False, "how": "no wild population today (domestic form)", "leaf": leaf.name,
                        "sample": c["sample"]}
            continue
        p0 = start_point(leaf)
        new.append({"species": leaf.name, "aliases": [], "common": "", "component": "wild", "use": "counts",
                    "scope": "global; deep past from one genome (PSMC), modelled", "faostat_item": None,
                    "file": None, "notes": NOTE, "points": [p0] if p0 else [], "baseline": None,
                    "deep": c["deep"], "deep_bulk": True, "modelled": "genomic"})
        rows[sp] = {"used": True, "how": "modelled record" + (" + range-loss trend" if p0 else ""),
                    "leaf": leaf.name, "sample": c["sample"]}
    log["genomic"] = {
        "note": "Layer 3 of the estimate stack, bulk (ToLaD#64): PSMC Ne histories from Bergman et al. 2023, "
                "rescaled and converted as pipeline/history/README.md 'Deep past' says. used = the curve became "
                "the leaf's deep past (a history file's [deep], or a modelled record). Per-species points, drops "
                "and the join to the next level are in history.species[<leaf>].deep.",
        "source": {"cite": CITE, "url": URL, "license": LICENSE, "files": [SD1, SD3]},
        "curves": len(curves), "used": sum(r["used"] for r in rows.values()),
        "by_how": {h: sum(r["how"] == h for r in rows.values()) for h in sorted({r["how"] for r in rows.values()})},
        "species": rows,
    }
    return new


NOTE = ("Modelled, not counted (grade D). The deep past is one genome's PSMC curve (Bergman et al. 2023, "
        "CC BY 4.0), rescaled to a mutation rate of 1e-9 per site per year and this leaf's generation length, "
        "Ne -> N by Ne/N = 0.1; PSMC's last ~20 kyr are not used. The curve then joins the next level "
        "log-linearly (the natural level in 1500 CE where the range-loss trend applies, else today's count).")
