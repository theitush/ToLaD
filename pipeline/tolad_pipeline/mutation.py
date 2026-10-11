"""Per-lineage germline mutation rate per year for the genetic layers (ToLaD#74, #75).

Layer 2 (diversity.py, Ne from heterozygosity) and layer 3 (history.py, the genomic deep past) both
need the mutation rate per site per year, mu_y. They used one rate for every mammal (1.0e-9, the
Pantherinae pedigree mean; history.DEEP_MU_YEAR). But per-year rates fall with generation time (the
generation-time effect): short-lived mammals mutate faster per year, long-lived ones (primates,
whales, rhinos) slower.

Source: Bergeron et al. 2023, Nature 615:285-291 (CC BY 4.0), Supplementary Table 9: pedigree (trio)
rates for 68 vertebrates, of which 32 mammals have a rate per generation modelled at the species'
generation time ("m_generation_modeled", from the trios' parental ages) and that rate per year
("m_yearly_modeled" = m_generation_modeled / generation time). Over those 32:

    log10 mu_y = a + b log10 G + c_clade

a, b: an OLS fit of the modelled per-year rate on generation time G (years); b is about -0.77 (so the
rate per generation rises as G^0.23) and the residual scatter is about 0.12 dex. c_clade: the mean
residual of the order's pedigree species, for orders with at least OFFSET_MIN_N of them (the per-clade
table, `offsets`); other orders take 0. The range (lo / hi) is the fit's 95% prediction band. The
pipeline evaluates it at its own G (= 2L). Without the table on disk every lineage takes the flat
rate history.DEEP_MU_YEAR and its old range.
"""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

import numpy as np

TABLE = "bergeron/Bergeron2023_SupplementaryTables.xlsx"
SHEET = "Supplementary Table 9"
CITE = ("Bergeron et al. 2023, Nature 615:285-291, Supplementary Table 9 (pedigree mutation rates, "
        "modelled at generation time)", "https://doi.org/10.1038/s41586-023-05752-y")
LICENSE = "CC BY 4.0"
# the table's order names that are not the tree's (Open Tree keeps whales, pigs and camels in Artiodactyla)
ORDER_NAMES = {"Primate": "Primates", "Cetartiodactyla": "Artiodactyla", "Suina": "Artiodactyla",
               "Tylopoda": "Artiodactyla"}
OFFSET_MIN_N = 2  # an order gets its own offset from this many pedigree species
PI_Z = 1.96  # the range is the fit's 95% prediction band


def load(raw: Path) -> list[dict]:
    """Supplementary Table 9 mammals with a modelled rate: species, order, G (years), mu_y."""
    import openpyxl
    wb = openpyxl.load_workbook(raw / TABLE, read_only=True, data_only=True)
    rows = list(wb[SHEET].iter_rows(values_only=True))
    wb.close()
    head = [str(h).strip() if h is not None else "" for h in rows[1]]
    col = {h: i for i, h in enumerate(head)}
    out = []
    for r in rows[2:]:
        if r[col["Taxonomic group"]] != "Mammal":
            continue
        mu = r[col["Modeled rate per year (m_yearly_modeled)"]]
        g = r[col["Generation time (years)"]]
        if not isinstance(mu, (int, float)) or not isinstance(g, (int, float)) or mu <= 0 or g <= 0:
            continue
        order = str(r[col["Taxonomic order"]]).strip()
        out.append({"species": str(r[col["Species name"]]).replace("_", " ").strip(),
                    "order": ORDER_NAMES.get(order, order), "G": float(g), "mu_y": float(mu)})
    return out


def fit(rows: list[dict]) -> dict:
    """The rate model: log10 mu_y = a + b log10 G (+ an order offset), with its scatter."""
    x = np.log10([r["G"] for r in rows])
    y = np.log10([r["mu_y"] for r in rows])
    b, a = np.polyfit(x, y, 1)
    res = y - (a + b * x)
    n = len(rows)
    rms = float(math.sqrt((res ** 2).sum() / (n - 2)))
    by = {}
    for r, e in zip(rows, res):
        by.setdefault(r["order"], []).append((r["species"], float(e)))
    offsets = {o: {"dex": round(float(np.mean([e for _, e in v])), 4), "n": len(v),
                   "species": sorted(s for s, _ in v)}
               for o, v in sorted(by.items()) if len(v) >= OFFSET_MIN_N}
    return {"a": round(float(a), 4), "b": round(float(b), 4), "rms_dex": round(rms, 4), "n": n,
            "r": round(float(np.corrcoef(x, y)[0, 1]), 3),
            "band_dex": round(PI_Z * rms * math.sqrt(1 + 1 / n), 4), "offsets": offsets,
            "orders_without_offset": sorted(o for o, v in by.items() if len(v) < OFFSET_MIN_N)}


@lru_cache(maxsize=4)
def model(raw: Path) -> dict | None:
    """The fitted model from the pinned table, or None when the table is not on disk."""
    if not (raw / TABLE).exists():
        return None
    return fit(load(raw))


def clade_of(leaf, m: dict | None) -> str | None:
    """The leaf's nearest ancestor that has its own offset, else None (the mammal-wide fit)."""
    if m is None:
        return None
    nd = leaf.parent if leaf is not None else None
    while nd is not None:
        if nd.name in m["offsets"]:
            return nd.name
        nd = nd.parent
    return None


def rate(m: dict | None, G: float, clade: str | None = None) -> dict:
    """{mu, lo, hi, clade, vs_flat}: the per-year rate for generation length G in that clade.
    lo / hi are the slowest / fastest rates of the range. m None: the flat rate and its range."""
    from .history import DEEP_MU_YEAR, DEEP_MU_YEAR_HI, DEEP_MU_YEAR_LO
    if m is None:
        return {"mu": DEEP_MU_YEAR, "lo": DEEP_MU_YEAR_LO, "hi": DEEP_MU_YEAR_HI, "clade": None, "vs_flat": 1.0}
    off = m["offsets"][clade]["dex"] if clade in m["offsets"] else 0.0
    lg = m["a"] + m["b"] * math.log10(G) + off
    mu = 10 ** lg
    return {"mu": mu, "lo": 10 ** (lg - m["band_dex"]), "hi": 10 ** (lg + m["band_dex"]),
            "clade": clade, "vs_flat": mu / DEEP_MU_YEAR}


def for_leaf(raw: Path, leaf, G: float) -> dict:
    m = model(raw)
    return rate(m, G, clade_of(leaf, m))


def summary(raw: Path) -> dict:
    """stats.json: the model, its source, and its rate at a few generation lengths."""
    m = model(raw)
    if m is None:
        return {"model": None, "note": f"{TABLE} not on disk: every lineage takes the flat rate"}
    return {"note": "Per-lineage mutation rate per site per year (ToLaD#74, #75): log10 mu_y = a + b log10 G "
                    "+ offset[order], G = the pipeline's generation length (2L, years). Fit over the modelled "
                    "per-year rates of the pedigree mammals of the source; an order gets an offset (the mean "
                    "residual of its species) from " + str(OFFSET_MIN_N) + " species. lo / hi = mu x/ "
                    "10^band_dex (the 95% prediction band).",
            "source": {"cite": CITE[0], "url": CITE[1], "license": LICENSE, "file": TABLE},
            "model": m,
            "mu_y_at_G": {str(g): float(f"{rate(m, g)['mu']:.3g}") for g in (1, 2, 5, 10, 20, 30)}}
