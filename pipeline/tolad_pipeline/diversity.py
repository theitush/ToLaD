"""Layer 2 of the estimate stack (ToLaD#63): long-term population size from genetic diversity.

A cross-check only: nothing here feeds the counts, the curves or the tiles. The build writes it to
stats.json -> diversity_crosscheck.

Source: Zoonomia, Wilder et al. 2023, Science 380:eabn5856, Table S1 (CC BY 4.0): genome-wide
heterozygosity of one sequenced individual (mostly the reference-genome animal) for 209 placental
mammals, the length-weighted mean of heterozygous sites per callable base over 50-kb windows.

Per species, with the pipeline's generation length G (years):
    Ne_div = het / (4 mu_gen),   mu_gen = mu_year x G
    N_div  = Ne_div / (Ne/N),    Ne/N = 0.1, range 0.3 (lo) .. 0.05 (hi)
The mutation rate and the Ne/N ratio are the ones the genomic deep past (layer 3, history.py) uses,
so the two genetic layers share their scaling. Heterozygosity estimates theta = 4 Ne mu averaged
over the coalescent depth (~4 Ne generations), so N_div is a long-run (harmonic-mean-like) size,
not a level at any date. Grade D.
"""

from __future__ import annotations

import math
from collections import Counter
from pathlib import Path

import numpy as np

from .history import DEEP_MU_CITE, DEEP_MU_YEAR, DEEP_NE_N, DEEP_NE_N_CITE, DEEP_NE_N_HI, DEEP_NE_N_LO

TABLE = "zoonomia/Wilder2023_Table_S1.xlsx"
CITE = ("Wilder et al. 2023, Science 380:eabn5856 (Zoonomia), Table S1: genome-wide heterozygosity",
        "https://doi.org/10.1126/science.abn5856")
DISAGREE_DEX = 1.0  # flag species where two layers differ by more than 10x


def load(raw: Path) -> list[dict]:
    """Table S1 rows with a numeric genome-wide heterozygosity."""
    import openpyxl
    wb = openpyxl.load_workbook(raw / TABLE, read_only=True, data_only=True)
    rows = wb.worksheets[0].iter_rows(values_only=True)
    head = [str(h).strip() if h is not None else "" for h in next(rows)]
    col = {h: i for i, h in enumerate(head)}
    out = []
    for r in rows:
        name = r[col["species"]]
        het = r[col["heterozygosity"]]
        if not name or not isinstance(het, (int, float)) or het <= 0:
            continue
        ob = r[col["outbred heterozygosity"]]
        g = r[col["generation time (days)"]]
        out.append({"species": str(name).strip(), "het": float(het),
                    "het_outbred": float(ob) if isinstance(ob, (int, float)) else None,
                    "sample": str(r[col["wild vs captive status of short-read sequenced sample"]] or "NA"),
                    "g_zoonomia_yr": float(g) / 365.25 if isinstance(g, (int, float)) else None})
    wb.close()
    return out


def level(het: float, G: float) -> dict:
    """Heterozygosity + generation length (years) -> long-term Ne and census N (lo / hi from Ne/N)."""
    ne = het / (4.0 * DEEP_MU_YEAR * G)
    return {"ne": ne, "N": ne / DEEP_NE_N, "lo": ne / DEEP_NE_N_HI, "hi": ne / DEEP_NE_N_LO}


def _dist(lr: np.ndarray) -> dict:
    if lr.size == 0:
        return {"n": 0}
    return {
        "n": int(lr.size), "median": round(float(np.median(lr)), 3),
        "p5_25_50_75_95": [round(float(x), 3) for x in np.percentile(lr, [5, 25, 50, 75, 95])],
        "within_10x": int((np.abs(lr) <= DISAGREE_DEX).sum()),
        "div_higher_10x": int((lr > DISAGREE_DEX).sum()), "div_lower_10x": int((lr < -DISAGREE_DEX).sum()),
        "histogram_dex": {"<-3": int((lr < -3).sum()),
                          **{f"{a:+.0f}..{a + 1:+.0f}": int(((lr >= a) & (lr < a + 1)).sum())
                             for a in np.arange(-3.0, 3.0, 1.0)},
                          ">=+3": int((lr >= 3).sum())},
    }


def _slope(rows: list[dict], key: str) -> dict | None:
    """OLS of log10 N_div on log10 N_other: a slope well below 1 means diversity barely tracks size."""
    pts = [(math.log10(r[key]), math.log10(r["N"])) for r in rows if r[key]]
    if len(pts) < 3:
        return None
    x, y = np.array(pts).T
    b, a = np.polyfit(x, y, 1)
    return {"slope": round(float(b), 3), "intercept": round(float(a), 3),
            "r": round(float(np.corrcoef(x, y)[0, 1]), 3), "n": len(pts),
            "span_dex_other": round(float(np.ptp(x)), 2), "span_dex_div": round(float(np.ptp(y)), 2)}


def report(root, raw: Path, ctx: dict) -> dict:
    """stats.json -> diversity_crosscheck. Sets D["diversity"] on matched leaves (not used downstream)."""
    from .model import match_species
    table = load(raw)
    hits, misses = match_species([t["species"] for t in table], ctx)
    # a trinomial (subspecies sample) falls back to its species; a leaf already taken keeps its first row
    binomial = {m: " ".join(m.split()[:2]) for m in misses if len(m.split()) > 2}
    sub, _ = match_species(sorted(set(binomial.values())), ctx)
    hits.update({m: sub[b] for m, b in binomial.items() if b in sub})
    misses = [m for m in misses if m not in hits]
    rows = []
    seen = set()
    dup = []
    for t in table:
        nd = hits.get(t["species"])
        if nd is None:
            continue
        if id(nd) in seen:
            dup.append(t["species"])
            continue
        seen.add(id(nd))
        D = nd.data
        G = 2.0 * D["L"]  # the pipeline's generation length (L = G / 2)
        lv = level(t["het"], G)
        D["diversity"] = lv
        today = D.get("rate_wild_now", 0.0) * D["L"]
        nat = D.get("natural")
        row = {"species": t["species"], "leaf": nd.name, "sample": t["sample"], "het": t["het"],
               "G": round(G, 3), "ne": round(lv["ne"]), "N": round(lv["N"]), "lo": round(lv["lo"]),
               "hi": round(lv["hi"]), "today": round(today) if today > 0 else None,
               "natural": round(nat["N"]) if nat else None,
               "div_in_natural_range": bool(nat["lo"] <= lv["N"] <= nat["hi"]) if nat else None,
               "dex_vs_natural": round(math.log10(lv["N"] / nat["N"]), 3) if nat and nat["N"] > 0 else None,
               "dex_vs_today": round(math.log10(lv["N"] / today), 3) if today > 0 else None}
        rows.append(row)
    rows.sort(key=lambda r: r["leaf"])
    ln = np.array([r["dex_vs_natural"] for r in rows if r["dex_vs_natural"] is not None])
    lt = np.array([r["dex_vs_today"] for r in rows if r["dex_vs_today"] is not None])
    lo = np.array([math.log10(t["het_outbred"] / t["het"]) for t in table if t["het_outbred"]])
    lg = np.array([math.log10(r["G"] / t["g_zoonomia_yr"]) for t in table for r in rows
                   if r["species"] == t["species"] and t["g_zoonomia_yr"]])

    def flagged(key):
        return [{k: r[k] for k in ("leaf", "sample", "N", "natural", "today", key)}
                for r in sorted(rows, key=lambda r: -abs(r[key] or 0))
                if r[key] is not None and abs(r[key]) > DISAGREE_DEX]

    return {
        "note": "Layer 2 of the estimate stack (ToLaD#63), a cross-check only (not used in the counts or "
                "curves): N_div = het / (4 mu_year G) / (Ne/N), grade D. het = genome-wide heterozygosity of "
                "one individual (Zoonomia). A long-run size over ~4 Ne generations, not a dated level. "
                "dex_* = log10(N_div / other).",
        "grade": "D", "kind": "reconstruction",
        "source": {"cite": CITE[0], "url": CITE[1], "license": "CC BY 4.0", "file": TABLE},
        "mu_year": DEEP_MU_YEAR, "mu_cite": list(DEEP_MU_CITE),
        "ne_over_n": DEEP_NE_N, "ne_over_n_lo_hi_range": [DEEP_NE_N_HI, DEEP_NE_N_LO],
        "ne_over_n_cite": list(DEEP_NE_N_CITE),
        "coverage": {"table_with_het": len(table), "matched_leaves": len(rows), "unmatched": sorted(misses),
                     "same_leaf_as_an_earlier_row": dup,
                     "with_natural": int(ln.size), "with_today": int(lt.size),
                     "samples": dict(Counter(r["sample"] for r in rows))},
        "vs_natural": {**_dist(ln), "div_in_natural_95_range": sum(1 for r in rows if r["div_in_natural_range"])},
        "vs_today": _dist(lt),
        "slope_log_div_on_log_natural": _slope(rows, "natural"),
        "slope_log_div_on_log_today": _slope(rows, "today"),
        "disagree_natural_10x": flagged("dex_vs_natural"),
        "disagree_today_10x": flagged("dex_vs_today"),
        "sensitivity_dex": {
            "outbred_over_genome_wide_het_median": round(float(np.median(lo)), 3) if lo.size else None,
            "pipeline_G_over_zoonomia_G_median": round(float(np.median(lg)), 3) if lg.size else None,
        },
        "species": rows,
    }
