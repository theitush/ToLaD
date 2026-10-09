"""Individual-count model (research/02-population-estimates.md §3).

Per species leaf:
    N_alive = k_occ * D(M) * A          standing population
    L       = G / 2                     census-pool residence time (yr)
    rate    = N_alive / L               births per year (band width)
    N_ever  = rate * (t0 - t1)          individuals ever born on that band

D, A, G come from observations where we have them (COMBINE, PanTHERIA) and
from allometry (Damuth-style D ~ M^b, G ~ M^d, refit here) or the nearest
clade with data otherwise. k_occ is fitted top-down so that the summed
biomass of wild extant mammals matches Greenspoon et al. 2023 (the
"allocate down" step). Anchored species (humans, livestock) replace or add to
the model with direct counts.

Internal nodes sum their children (linear space; Fenton-Wilkinson for the
uncertainty) and fill any time on their band not covered by a child (the stem
before the first split, gaps in fossil fans) with one "lineage" of births at
the geometric-mean child lineage rate.
"""

from __future__ import annotations

import math
from collections import Counter
from pathlib import Path

import numpy as np

from . import anchors
from .anchors import year_to_ma
from .load import load_combine, load_pantheria
from .tree import D_ANCHOR, D_FOSSIL, D_INTERP, D_UPHAM, Node

ANCHOR_T0 = {"Homo sapiens": year_to_ma(-190000)}

# Source registry; bit i of a node's source mask = SOURCES[i]
SOURCES = [
    ("opentree", "Open Tree of Life synthesis v16.1 (topology), OTT 3.7.3; CC0"),
    ("upham", "Upham, Esselstyn & Jetz 2019, node-dated MCC mammal tree (MamPhy v1); CC0"),
    ("pbdb", "Paleobiology Database, fossil mammal species and first/last appearances; CC BY 4.0"),
    ("phylacine", "PHYLACINE 1.2.1 (Faurby et al. 2018): body mass, extinction status; CC0"),
    ("combine", "COMBINE (Soria et al. 2021): generation length (Pacifici et al. 2013), density, mass; CC BY 4.0"),
    ("pantheria", "PanTHERIA (Jones et al. 2009): density, geographic range area, mass"),
    ("greenspoon", "Greenspoon et al. 2023 PNAS 120:e2204892120: wild mammal biomass (occupancy calibration)"),
    ("damuth", "Damuth 1981 / Brook & Bowman 2005 allometry form, coefficients refit on COMBINE+PanTHERIA"),
    ("prb", "PRB 2022, How many people have ever lived on Earth? (Kaneda, Greenbaum & Haub)"),
    ("wpp", "UN World Population Prospects 2024, medium variant (population, births)"),
    ("faostat", "FAOSTAT QCL livestock stocks (World); CC BY 4.0"),
    ("mock", "MOCK placeholder (not a real record)"),
]
SRC = {k: i for i, (k, _) in enumerate(SOURCES)}

# Greenspoon et al. 2023 (02 §2.3): wild terrestrial mammals ~20 Mt (13-38),
# marine ~40 Mt. Wet biomass, grams.
BIOMASS_LAND_G = 20e12
BIOMASS_MARINE_G = 40e12
MARINE_CLADES = {"Cetacea", "Sirenia", "Pinnipedia", "Otariidae", "Phocidae", "Odobenidae"}

SD_SYSTEMATIC = 0.6  # dex, shared model error (occupancy, allometry, lineage-count proxy)
SD_FILL = 1.0
GRID_N = 1600
GRID_MIN_MA = 1e-6
PROFILE_K = 16
PROFILE_RANGE = 1000.0  # log-spacing of profile bins (see FORMAT.md)


def grade_from_sd(sd: float) -> int:
    h = 1.96 * sd
    return 0 if h <= 0.5 else 1 if h <= 1.0 else 2 if h <= 2.0 else 3


# ---------------------------------------------------------------- utilities


def _fit(xs, ys):
    x = np.asarray(xs)
    y = np.asarray(ys)
    b, a = np.polyfit(x, y, 1)
    resid = y - (a + b * x)
    return float(a), float(b), float(resid.std())


def clade_means(root: Node, key: str) -> dict[int, tuple[float, int]]:
    """Geometric means of a log10 trait over each node's descendants with data."""
    acc: dict[int, tuple[float, int]] = {}
    for nd in root.postorder():
        if nd.is_leaf:
            v = nd.data.get(key)
            acc[id(nd)] = (v, 1) if v is not None else (0.0, 0)
        else:
            s = sum(acc[id(c)][0] for c in nd.children)
            n = sum(acc[id(c)][1] for c in nd.children)
            acc[id(nd)] = (s, n)
    return acc


def impute_from_clade(nd: Node, acc, global_mean: float) -> tuple[float, str]:
    p = nd.parent
    while p is not None:
        s, n = acc[id(p)]
        if n > 0:
            lvl = p.rank if p.rank in ("genus", "subfamily", "family", "superfamily", "order") else "clade"
            return s / n, lvl
        p = p.parent
    return global_mean, "Mammalia"


def lognormal_sum(parts: list[tuple[float, float]]) -> tuple[float, float]:
    """Fenton-Wilkinson: [(log10 median, log10 sd)] -> (log10 median, log10 sd)."""
    ln10 = math.log(10)
    m = v = 0.0
    for mu10, sd10 in parts:
        mu, s = mu10 * ln10, sd10 * ln10
        mi = math.exp(mu + s * s / 2)
        m += mi
        v += (math.exp(s * s) - 1) * math.exp(2 * mu + s * s)
    if m <= 0:
        return -math.inf, 0.0
    s2 = math.log(1 + v / (m * m))
    mu = math.log(m) - s2 / 2
    return mu / ln10, math.sqrt(s2) / ln10


# ---------------------------------------------------------------- leaves


def resolve_traits(root: Node, raw: Path, ctx: dict, log: dict) -> None:
    phy, phy_syn, ott_syn = ctx["phy"], ctx["phy_syn"], ctx["ott_syn"]
    comb_rep, comb_imp = load_combine(raw)
    pan = load_pantheria(raw)
    hits = Counter()

    def candidates(nd: Node) -> list[str]:
        c = [nd.name] + [a for a in nd.alt if " " in a] + nd.data.get("upham_names", [])
        for s in ott_syn.get(nd.ott, []) if nd.ott else []:
            c.append(s.replace("_", " "))
        out = []
        for x in c:
            if x and x not in out:
                out.append(x)
            if x in phy_syn and phy_syn[x] not in out:
                out.append(phy_syn[x])
        return out

    def first(d: dict, names: list[str], field: str):
        for n in names:
            r = d.get(n)
            if r is not None and r.get(field) is not None and r[field] > 0:
                return r[field]
        return None

    for nd in root.preorder():
        if not nd.is_leaf:
            continue
        names = candidates(nd)
        D = nd.data
        # body mass
        for src, d, f in (("phylacine", phy, "mass_g"), ("combine", comb_rep, "mass_g"),
                          ("pantheria", pan, "mass_g"), ("combine-imputed", comb_imp, "mass_g")):
            v = first(d, names, f)
            if v:
                D["log_mass"] = math.log10(v)
                D["mass_src"] = src
                hits["mass:" + src] += 1
                break
        v = first(comb_rep, names, "density") or None
        if v:
            D["log_density_obs"], D["density_src"] = math.log10(v), "combine"
        else:
            v = first(pan, names, "density")
            if v:
                D["log_density_obs"], D["density_src"] = math.log10(v), "pantheria"
        v = first(pan, names, "range_km2")
        if v:
            D["log_range_obs"] = math.log10(v)
        v = first(comb_rep, names, "gen_d")
        if v:
            D["log_gen_obs"], D["gen_src"] = math.log10(v / 365.25), "reported"
        else:
            v = first(comb_imp, names, "gen_d")
            if v:
                D["log_gen_obs"], D["gen_src"] = math.log10(v / 365.25), "imputed"
        marine = None
        for n in names:
            if n in phy:
                marine = phy[n]["marine"]
                break
        if marine is None:
            p = nd.parent
            while p is not None and marine is None:
                if p.name in MARINE_CLADES or any(a in MARINE_CLADES for a in p.alt):
                    marine = True
                p = p.parent
        D["marine"] = bool(marine)
        if nd.kind == "tree" and not nd.extinct:
            for k in ("log_mass", "log_density_obs", "log_range_obs", "log_gen_obs"):
                hits[k + (":yes" if k in D else ":no")] += 1
    log["trait_coverage_extant"] = {k: v for k, v in sorted(hits.items()) if not k.startswith("mass:")}
    log["mass_sources"] = {k: v for k, v in hits.items() if k.startswith("mass:")}


def model_leaves(root: Node, raw: Path, log: dict) -> None:
    leaves = [n for n in root.preorder() if n.is_leaf]
    extant_obs = [n for n in leaves if n.kind == "tree" and not n.extinct]
    # allometric fits on extant species with observations
    pts = [(n.data["log_mass"], n.data["log_density_obs"]) for n in extant_obs
           if "log_mass" in n.data and "log_density_obs" in n.data]
    dA, dB, dS = _fit(*zip(*pts))
    pts = [(n.data["log_mass"], n.data["log_gen_obs"]) for n in extant_obs
           if "log_mass" in n.data and "log_gen_obs" in n.data and n.data.get("gen_src") == "reported"]
    gA, gB, gS = _fit(*zip(*pts))
    log["fits"] = {
        "density_log10 = a + b*log10(mass_g)": {"a": round(dA, 3), "b": round(dB, 3), "resid_sd": round(dS, 3), "n": len(pts)},
        "generation_yr_log10 = a + b*log10(mass_g)": {"a": round(gA, 3), "b": round(gB, 3), "resid_sd": round(gS, 3)},
    }
    # nearest-clade imputation of mass and range
    acc_m = clade_means(root, "log_mass")
    gm_m = np.mean([n.data["log_mass"] for n in leaves if "log_mass" in n.data])
    for n in leaves:
        if "log_mass" not in n.data:
            n.data["log_mass"], lvl = impute_from_clade(n, acc_m, gm_m)
            n.data["mass_src"] = f"{lvl} mean"
    acc_r = clade_means(root, "log_range_obs")
    gm_r = np.mean([n.data["log_range_obs"] for n in leaves if "log_range_obs" in n.data])

    for n in leaves:
        D = n.data
        lm = D["log_mass"]
        sd2 = 0.0
        meth = []
        src = {SRC["opentree"] if n.kind == "tree" else SRC["pbdb"]}
        if n.kind == "graft" or n.pbdb:
            src.add(SRC["pbdb"])
        if D["mass_src"] in ("phylacine",):
            src.add(SRC["phylacine"]); msd = 0.05
        elif D["mass_src"].startswith("combine"):
            src.add(SRC["combine"]); msd = 0.1
        elif D["mass_src"] == "pantheria":
            src.add(SRC["pantheria"]); msd = 0.05
        else:
            msd = 0.4
        meth.append(f"M:{D['mass_src']}")
        if "log_density_obs" in D:
            ld = D["log_density_obs"]
            sd2 += 0.5 ** 2
            src.add(SRC[D["density_src"]])
            meth.append(f"D:obs({D['density_src']})")
        else:
            ld = dA + dB * lm
            sd2 += dS ** 2 + (dB * msd) ** 2
            src.add(SRC["damuth"])
            meth.append("D:allometric(M)")
        if "log_range_obs" in D:
            lr = D["log_range_obs"]
            sd2 += 0.2 ** 2
            src.add(SRC["pantheria"])
            meth.append("A:obs(PanTHERIA)")
        else:
            lr, lvl = impute_from_clade(n, acc_r, gm_r)
            sd2 += 0.6 ** 2 if n.kind == "tree" else 0.8 ** 2
            meth.append(f"A:{lvl} mean")
        if "log_gen_obs" in D:
            lg = D["log_gen_obs"]
            sd2 += (0.1 if D["gen_src"] == "reported" else 0.2) ** 2
            src.add(SRC["combine"])
            meth.append(f"G:{D['gen_src']}(Pacifici/COMBINE)")
        else:
            lg = gA + gB * lm
            sd2 += gS ** 2 + (gB * msd) ** 2
            src.add(SRC["damuth"])
            meth.append("G:allometric(M)")
        L = max(10 ** lg / 2.0, 0.05)  # residence time ~ G/2, years
        dur = n.t0 - n.t1
        if n.date_src == D_UPHAM or (n.parent is not None and n.parent.date_src == D_UPHAM and n.kind == "tree"):
            hpd = n.parent.data.get("age_hpd") if n.parent is not None else None
            tsd = 0.1
            if hpd and hpd[0] > 0:
                tsd = min(0.5, math.log10(hpd[1] / hpd[0]) / 3.92 + 0.05)
            meth.append("T:Upham branch")
        elif n.kind == "graft":
            tsd = 0.3
            meth.append("T:PBDB FAD-LAD")
        else:
            tsd = 0.3
            meth.append("T:interpolated branch")
        sd2 += tsd ** 2
        D["L"] = L
        D["log_density"] = ld
        D["log_range"] = lr
        D["sd_leaf"] = math.sqrt(sd2)
        D["meth"] = meth
        D["src"] = src
        D["dur_yr"] = dur * 1e6
        # raw (uncalibrated) standing population
        D["N_raw"] = 10 ** (ld + lr)


def calibrate_occupancy(root: Node, anchored: set[str], log: dict) -> tuple[float, float]:
    land = marine = 0.0
    for n in root.preorder():
        if n.is_leaf and n.kind == "tree" and not n.extinct and n.name not in anchored:
            b = n.data["N_raw"] * 10 ** n.data["log_mass"]
            if n.data["marine"]:
                marine += b
            else:
                land += b
    k_land = BIOMASS_LAND_G / land
    k_marine = BIOMASS_MARINE_G / marine
    log["occupancy_calibration"] = {
        "raw_land_biomass_Mt": round(land / 1e12, 2), "raw_marine_biomass_Mt": round(marine / 1e12, 2),
        "k_land": round(k_land, 5), "k_marine": round(k_marine, 5),
        "target": "Greenspoon et al. 2023: wild land 20 Mt, marine 40 Mt",
    }
    return k_land, k_marine


def human_rate_at(pieces, age_ma: float) -> float:
    for old, young, r in pieces:
        if young <= age_ma <= old:
            return r
    return 0.0


def assign_leaf_counts(root: Node, raw: Path, log: dict) -> None:
    pieces_h, ever_h, alive_h, notes_h = anchors.human_births_pieces(raw)
    fao_raw, _ = anchors.faostat_stocks(raw)
    leaf_names = {n.name for n in root.preorder() if n.is_leaf}
    fao = {}
    for sp, val in fao_raw.items():
        for cand in [sp] + anchors.DOMESTIC_ALIASES.get(sp, []):
            if cand in leaf_names:
                fao[cand] = val
                anchors.DOMESTICATION_YEAR.setdefault(cand, anchors.DOMESTICATION_YEAR[sp])
                break
    anchored = {"Homo sapiens"} | set(fao)
    k_land, k_marine = calibrate_occupancy(root, anchored, log)
    now_h = pieces_h[-1][2]
    found = Counter()
    for n in root.preorder():
        if not n.is_leaf:
            continue
        D = n.data
        k = k_marine if D["marine"] else k_land
        N = D["N_raw"] * k
        r = N / D["L"]
        D["src"].add(SRC["greenspoon"])
        D["meth"].append("k:biomass-calibrated(Greenspoon 2023)")
        if n.name == "Homo sapiens":
            D["pieces"] = list(pieces_h)
            D["alive"] = alive_h
            D["ever_med"] = ever_h
            D["sd_leaf"] = 0.1
            D["grade_cap"] = 1
            D["meth"] = ["anchor: " + "; ".join(notes_h)]
            D["src"] = {SRC["opentree"], SRC["upham"], SRC["prb"], SRC["wpp"]}
            found["Homo sapiens"] += 1
            continue
        pieces = [(n.t0, n.t1, r)]
        alive = 0.0 if n.extinct else N
        cap = 2 if n.kind == "tree" else 3
        if n.name in fao:
            stock, year = fao[n.name]
            dom_start = year_to_ma(anchors.DOMESTICATION_YEAR[n.name])
            r_dom_now = stock / D["L"]
            for old, young, rh in pieces_h:
                if young >= dom_start:
                    continue
                o = min(old, dom_start)
                pieces.append((o, young, r_dom_now * rh / now_h))
            alive += stock
            D["meth"].append(f"+ domestic: FAOSTAT {year} stock {stock:.3g}, growth shaped like human births since domestication")
            D["src"].add(SRC["faostat"])
            D["src"].add(SRC["prb"])
            cap = 1
            found["FAO:" + n.name] += 1
        D["pieces"] = pieces
        D["alive"] = alive
        D["ever_med"] = sum((o - y) * 1e6 * rr for o, y, rr in pieces)
        D["grade_cap"] = cap
        if n.name in fao:
            # livestock: alive is grade B, ever dominated by the modelled wild lineage
            D["grade_cap"] = 2
    log["anchors_found"] = dict(found)
    missing = [sp for sp in fao_raw
               if not any(c in fao for c in [sp] + anchors.DOMESTIC_ALIASES.get(sp, []))]
    if missing:
        log["anchors_missing_in_tree"] = sorted(missing)


# ---------------------------------------------------------------- sums + profiles


def make_grid() -> np.ndarray:
    return np.concatenate([[0.0], np.geomspace(GRID_MIN_MA, 400.0, GRID_N)])


def overlap(E: np.ndarray, old: float, young: float) -> np.ndarray:
    return np.clip(np.minimum(E[1:], old) - np.maximum(E[:-1], young), 0.0, None)


def union(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """[(old, young)] -> merged, sorted by young."""
    iv = sorted((y, o) for o, y in intervals)
    out: list[list[float]] = []
    for y, o in iv:
        if out and y <= out[-1][1]:
            out[-1][1] = max(out[-1][1], o)
        else:
            out.append([y, o])
    return [(o, y) for y, o in out]


def profile_edges(t0: float, t1: float) -> np.ndarray:
    x = np.arange(PROFILE_K + 1) / PROFILE_K
    return t1 + (t0 - t1) * (PROFILE_RANGE ** x - 1) / (PROFILE_RANGE - 1)



# Top-down anchor for the whole class (02 §2.3, grade C):
#     N_ever(Mammalia) ~ births_now * T_eff,  T_eff = 1.5e8 yr.
# As a time profile: expected(t) = births_now * f(t), with f a linear ramp from
# 0 at the Mammalia origin to 1, reaching 1 at the time that makes the integral
# of f equal T_eff, and 1 after that (02 §3.2c default shape).
# The sampled tree (extant species, PBDB fossils, lineage fill) explains only
# part of expected(t) in deep time ("pull of the present"). The deficit,
# deficit(t) = max(0, expected(t) - sampled(t)), is allocated down the tree as
# "ghost lineages" (unsampled extinct side branches): at each time t it is
# split among the internal nodes whose band covers t, in proportion to their
# lineage rate. So Jurassic ghosts land on Theria/Eutheria-level stems, not
# on whichever few fossils happen to be sampled then. Species leaves keep
# their own counts; ghosts are stored separately so the renderer can draw them
# in a distinct style (00-synthesis, Extinct taxa).
MAMMALIA_T_EFF_YR = 1.5e8
SD_GHOST = 1.0


def _gaps(n: Node) -> list[tuple[float, float]]:
    cov = union([(c.t0, c.t1) for c in n.children])
    gaps = []
    cur = n.t1
    for o, y in cov:
        if y > cur:
            gaps.append((y, cur))
        cur = max(cur, o)
    if n.t0 > cur:
        gaps.append((n.t0, cur))
    return gaps


def _leaf_vec(E: np.ndarray, n: Node) -> np.ndarray:
    v = np.zeros(GRID_N)
    for old, young, r in n.data["pieces"]:
        v += r * 1e6 * overlap(E, old, young)
    return v


def _fill_vec(E: np.ndarray, n: Node) -> np.ndarray:
    v = np.zeros(GRID_N)
    for o, y in n.data["fill_gaps"]:
        v += n.data["lineage_rate"] * 1e6 * overlap(E, o, y)
    return v


def _cover(E: np.ndarray, n: Node) -> np.ndarray:
    """Fraction of each grid cell covered by the node's band."""
    return overlap(E, n.t0, n.t1) / np.diff(E)


def ghost_deficit(root: Node, E: np.ndarray, log: dict) -> tuple[np.ndarray, np.ndarray]:
    births_now = 0.0
    S = np.zeros(GRID_N)
    W = np.zeros(GRID_N)
    for n in root.postorder():
        D = n.data
        if n.is_leaf:
            D["dur_yr"] = max(D["dur_yr"], 1.0)
            D["lineage_rate"] = sum((o - y) * 1e6 * r for o, y, r in D["pieces"]) / D["dur_yr"]
            if not n.extinct:
                births_now += sum(r for o, y, r in D["pieces"] if y <= 0.0)
            S += _leaf_vec(E, n)
            continue
        D["lineage_rate"] = float(np.exp(np.mean([math.log(max(c.data["lineage_rate"], 1e-12))
                                                  for c in n.children])))
        D["fill_gaps"] = _gaps(n)
        S += _fill_vec(E, n)
        W += D["lineage_rate"] * _cover(E, n)
    t_origin = root.t0
    t_full = max(0.0, 2 * MAMMALIA_T_EFF_YR / 1e6 - t_origin)
    # integral of f over each cell (Myr): f = 1 for t <= t_full, ramps to 0 at t_origin
    def F(t):  # integral of f from 0 to t
        t = np.minimum(t, t_origin)
        ramp = np.clip(t - t_full, 0.0, None)
        return np.minimum(t, t_full) + ramp - ramp ** 2 / (2 * (t_origin - t_full))
    expected = births_now * 1e6 * (F(E[1:]) - F(E[:-1]))
    deficit = np.maximum(expected - S, 0.0)
    deficit[W <= 0] = 0.0
    with np.errstate(divide="ignore", invalid="ignore"):
        m = np.where(S > 0, (S + deficit) / S, 1.0)
    sampled = float(S.sum())
    total = sampled + float(deficit.sum())
    log["ghost_lineages"] = {
        "births_now_per_yr": births_now,
        "T_eff_yr": MAMMALIA_T_EFF_YR,
        "f_ramp_Ma": [round(t_origin, 2), round(t_full, 2)],
        "top_down_estimate": float(expected.sum()),
        "sampled_sum": sampled,
        "with_ghosts": total,
        "ghost_share": round(1 - sampled / total, 4),
        "max_multiplier": float(m.max()),
        "multiplier_at_Ma": {str(a): round(float(np.interp(a, E[1:], m)), 3)
                             for a in (0.01, 1, 5, 20, 50, 66, 100, 150, 200)},
    }
    with np.errstate(divide="ignore", invalid="ignore"):
        per_rate = np.where(W > 0, deficit / W, 0.0)
    return per_rate


def sum_tree(root: Node, log: dict) -> None:
    """Sums and profiles.

    Sampled births (species bands and lineage fills) are piecewise constant and
    handled exactly: a node's births are the pieces of its whole subtree, a
    contiguous slice in preorder. Ghost lineages are defined on the ghost grid
    and accumulated as grid vectors."""
    E = make_grid()
    per_rate = ghost_deficit(root, E, log)
    order = list(root.preorder())
    O, Y, R, G = [], [], [], []  # pieces; G = 0 species band, 1 lineage fill
    start: dict[int, int] = {}
    for n in order:
        start[id(n)] = len(O)
        D = n.data
        if n.is_leaf:
            for o, y, r in D["pieces"]:
                O.append(o); Y.append(y); R.append(r); G.append(0)
        else:
            for o, y in D["fill_gaps"]:
                O.append(o); Y.append(y); R.append(D["lineage_rate"]); G.append(1)
    O = np.asarray(O); Y = np.asarray(Y); R = np.asarray(R); G = np.asarray(G)
    nxt = {id(order[i]): (start[id(order[i + 1])] if i + 1 < len(order) else len(O)) for i in range(len(order))}
    end_piece: dict[int, int] = {}
    for n in reversed(order):  # children before parents
        end_piece[id(n)] = end_piece[id(n.children[-1])] if n.children else nxt[id(n)]
    gvec: dict[int, np.ndarray] = {}
    widths = np.diff(E)
    for n in reversed(order):
        D = n.data
        a, b, own = start[id(n)], end_piece[id(n)], nxt[id(n)]
        o, y, r = O[a:b], Y[a:b], R[a:b]
        sampled = float(np.sum(r * (o - y))) * 1e6
        D["fill"] = float(np.sum((R[a:own] * (O[a:own] - Y[a:own]))[G[a:own] == 1])) * 1e6
        edges = profile_edges(n.t0, n.t1)
        C = (r[:, None] * np.clip(np.minimum(o[:, None], edges[None, :]) - y[:, None], 0.0, None)).sum(0) * 1e6
        if n.is_leaf:
            gv = None
            D["ghost"] = D["ghost_own"] = 0.0
        else:
            own_g = per_rate * D["lineage_rate"] * _cover(E, n)  # births per grid cell
            gv = own_g
            for c in n.children:
                cg = gvec.pop(id(c), None)
                if cg is not None:
                    gv = gv + cg
            D["ghost_own"] = float(own_g.sum())
            D["ghost"] = float(gv.sum())
            Cg = np.interp(edges, E, np.concatenate([[0.0], np.cumsum(gv)]))
            C = C + Cg
            gvec[id(n)] = gv
        D["ever"] = sampled + D["ghost"]
        D["profile"] = np.maximum(np.diff(C), 0.0) / np.maximum(np.diff(edges) * 1e6, 1e-9)
    # uncertainty, grades, methods (bottom-up)
    for n in reversed(order):
        D = n.data
        if n.is_leaf:
            anchored = n.name == "Homo sapiens"
            D["log_sd_indep"] = D["sd_leaf"]
            D["anchored_dom"] = anchored
            D["log_sd"] = D["sd_leaf"] if anchored else math.hypot(D["sd_leaf"], SD_SYSTEMATIC)
            D["grade"] = max(D["grade_cap"], grade_from_sd(D["log_sd"]))
            continue
        D["alive"] = sum(c.data["alive"] for c in n.children)
        parts = [(math.log10(c.data["ever"]), c.data["log_sd_indep"]) for c in n.children if c.data["ever"] > 0]
        if D["fill"] > 0:
            parts.append((math.log10(D["fill"]), SD_FILL))
        if D["ghost_own"] > 0:
            parts.append((math.log10(D["ghost_own"]), SD_GHOST))
        mu, sd = lognormal_sum(parts)
        D["log_sd_indep"] = sd
        ever = max(D["ever"], 1e-300)
        anchored_share = sum(c.data["ever"] for c in n.children if c.data.get("anchored_dom")) / ever
        D["log_sd"] = math.hypot(sd, SD_SYSTEMATIC * (1 - anchored_share))
        D["fw_mu"] = mu
        dom = max(n.children, key=lambda c: c.data["ever"])
        share = dom.data["ever"] / ever
        D["anchored_dom"] = share > 0.5 and dom.data.get("anchored_dom", False)
        D["grade"] = max(grade_from_sd(D["log_sd"]), dom.data["grade"] if share > 0.5 else 0)
        if D["ghost"] / ever > 0.5:
            D["grade"] = 3
        meth = f"sum of {len(n.children)} children"
        if D["fill"] > 0:
            meth += f" + lineage fill {100 * D['fill'] / ever:.2g}%"
        if D["ghost"] > 0:
            meth += f" + ghost lineages {100 * D['ghost'] / ever:.2g}% (02 T_eff top-down, allocated down)"
        D["meth"] = [meth]
        src = set()
        for c in n.children:
            src |= c.data["src"]
        D["src"] = src
    log["grid_cells"] = GRID_N
    log["pieces"] = int(len(O))


def finalize(root: Node) -> None:
    for n in root.preorder():
        D = n.data
        ever = D["ever"]
        sd = D["log_sd"]
        le = math.log10(ever) if ever > 0 else 0.0
        mu = le if n.is_leaf else D["fw_mu"]
        D["lo"] = max(0.0, le - (mu - 1.96 * sd))
        D["hi"] = max(0.0, (mu + 1.96 * sd) - le)


def run(root: Node, raw: Path, ctx: dict, log: dict) -> None:
    resolve_traits(root, raw, ctx, log)
    model_leaves(root, raw, log)
    assign_leaf_counts(root, raw, log)
    sum_tree(root, log)
    finalize(root)
    r = root.data
    log["mammalia"] = {"alive": r["alive"], "ever": r["ever"], "ghost": r["ghost"],
                       "grade": "ABCD"[r["grade"]],
                       "lo": r["ever"] / 10 ** r["lo"], "hi": r["ever"] * 10 ** r["hi"]}
