"""Individual-count model (research/02-population-estimates.md §3).

Per species leaf:
    N_alive = standing wild population, in order of preference
              1. census: IUCN population report (Greenspoon et al. 2023 compilation)
              2. Greenspoon et al. 2023 per-species model estimate (land species)
              3. k * D(M) * A, with k fitted per order group and body mass
                 (fit_occupancy) on the species that have 1 or 2
    L       = G / 2                     census-pool residence time (yr)
    rate    = N_alive / L               births per year (band width)
    N_ever  = rate * (t0 - t1)          individuals ever born on that band

D, A, G come from observations where we have them (COMBINE, PanTHERIA) and
from allometry (Damuth-style D ~ M^b, G ~ M^d, refit here) or the nearest
clade with data otherwise. Humans (PRB + UN WPP) replace the model; domestic
stocks (FAOSTAT livestock, Greenspoon's dog and cat numbers) are added on top
of the wild lineage, growing like human births since domestication.

Internal nodes sum their children (linear space; Fenton-Wilkinson for the
uncertainty) and fill any time on their band not covered by a child (the stem
before the first split, gaps in fossil fans) with one "lineage" of births at
the geometric-mean child lineage rate, plus ghost lineages (see
ghost_deficit / ghost_weights).
"""

from __future__ import annotations

import math
from collections import Counter
from pathlib import Path

import numpy as np

from . import anchors, diversity, genomic, history, ranges
from .anchors import year_to_ma
from .load import load_combine, load_pantheria
from .tree import D_ANCHOR, D_FOSSIL, D_INTERP, D_UPHAM, Node, ancestor_of_rank

ANCHOR_T0 = {"Homo sapiens": year_to_ma(-190000)}

# Source registry; bit i of a node's source mask = SOURCES[i]
SOURCES = [
    ("opentree", "Open Tree of Life synthesis v16.1 (topology), OTT 3.7.3; CC0"),
    ("upham", "Upham, Esselstyn & Jetz 2019, node-dated MCC mammal tree (MamPhy v1); CC0"),
    ("pbdb", "Paleobiology Database, fossil mammal species and first/last appearances; CC BY 4.0"),
    ("phylacine", "PHYLACINE 1.2.1 (Faurby et al. 2018): body mass, extinction status, current and "
                  "present-natural range maps; CC0"),
    ("combine", "COMBINE (Soria et al. 2021): generation length (Pacifici et al. 2013), density, mass; CC BY 4.0"),
    ("pantheria", "PanTHERIA (Jones et al. 2009): density, geographic range area, mass"),
    ("greenspoon", "Greenspoon et al. 2023 PNAS 120:e2204892120: wild mammal biomass (occupancy calibration)"),
    ("damuth", "Damuth 1981 / Brook & Bowman 2005 allometry form, coefficients refit on COMBINE+PanTHERIA"),
    ("prb", "PRB 2022, How many people have ever lived on Earth? (Kaneda, Greenbaum & Haub)"),
    ("wpp", "UN World Population Prospects 2024, medium variant (population, births)"),
    ("faostat", "FAOSTAT QCL livestock stocks (World); CC BY 4.0"),
    ("mock", "MOCK placeholder (not a real record)"),
    ("greenspoon-data", "Greenspoon et al. 2023 data release (Zenodo 10.5281/zenodo.7594807): per-species "
                        "population reports (IUCN Red List), dog and cat numbers; CC BY 4.0"),
    ("overrides", "ToLaD manual overrides (pipeline/overrides.toml): fossil dates and placements, with citations"),
    ("history", history.HISTORY_SRC_LABEL),
]
SRC = {k: i for i, (k, _) in enumerate(SOURCES)}

# Greenspoon et al. 2023 (02 §2.3): wild terrestrial mammals ~20 Mt (13-38),
# reported in stats.json for comparison (the land fit uses their per-order and
# per-species numbers directly),
# marine ~40 Mt. Wet biomass, grams.
BIOMASS_LAND_G = 20e12
BIOMASS_MARINE_G = 40e12
MARINE_CLADES = {"Cetacea", "Sirenia", "Pinnipedia", "Otariidae", "Phocidae", "Odobenidae"}

SD_SYSTEMATIC = 0.6  # dex, shared model error (occupancy, allometry, lineage-count proxy)
SD_CENSUS = 0.25  # dex, a population report from an IUCN assessment
SD_SYSTEMATIC_CENSUS = 0.3  # dex, census species: constant abundance along the branch
K_SHRINK = 3.0  # clade effects in the marine occupancy fit are shrunk by n / (n + K_SHRINK)
# Source names that the synonym tables miss, where Open Tree keeps the old name for
# the living species (Open Tree "Equus quagga" is the extinct quagga)
NAME_ALIASES = {"Equus quagga": ["Equus burchellii"]}
MIN_GROUP = 20  # land order groups with fewer reference species use the pooled fit
SD_GS_MODEL = 0.5  # dex, Greenspoon per-species model estimate (their SVR, CI ~ +-0.2-0.5 dex)
# Greenspoon et al. 2023 report wild land biomass and individuals for these
# orders; everything else is "Other" (results/results_grouped_by_order.csv)
LAND_GROUPS = ("Rodentia", "Chiroptera", "Artiodactyla", "Proboscidea", "Primates", "Diprotodontia",
               "Carnivora", "Perissodactyla", "Lagomorpha")
SD_FILL = 1.0
# Natural (pre-human) baseline, layer 1 of the estimate stack (ToLaD#61):
# density x PHYLACINE present-natural range x occupancy. See natural_level().
NATURAL_STEP_YEAR = 1500  # the natural level holds until here (IUCN's "since 1500" window)
# Modelled recent trend from range loss, layer 4 of the estimate stack (ToLaD#62): an extant species
# whose natural baseline differs from today's count changes log-linearly from the natural level in
# RANGELOSS_START_YEAR to today's count now, instead of stepping. See rangeloss_record().
RANGELOSS_START_YEAR = NATURAL_STEP_YEAR
RANGELOSS_PIECE_YR = 25.0  # births pieces along the trend (each the exact mean of the curve over it)
RANGELOSS_CITE = ("ToLaD range-loss trend (ToLaD#62): natural baseline from PHYLACINE 1.2.1 present-natural "
                  "vs current ranges (Faurby et al. 2018, Ecology 99:2626), log-linear from 1500 CE "
                  "(the IUCN Red List 'since 1500' window, IUCN Categories and Criteria v3.1) to today's count")
RANGELOSS_URL = "https://github.com/theitush/ToLaD/blob/main/pipeline/history/README.md"
RANGELOSS_NOTE = ("Modelled, not counted (grade D). The natural (pre-human) level from the PHYLACINE present-natural "
                  "range, held until 1500 CE, then a log-linear change to today's count. The timing is an "
                  "assumption: IUCN's 1500 CE window, one date for every species and region; real declines "
                  "were mostly later (19th-20th century land use) and uneven.")
RANGELOSS_SHOWCASE = ["Bison bison", "Elephas maximus", "Ursus arctos", "Canis lupus", "Equus ferus",
                      "Gorilla gorilla", "Ceratotherium simum", "Vulpes vulpes", "Rattus norvegicus",
                      "Canis latrans", "Lynx canadensis", "Mustela nigripes", "Procyon lotor", "Sorex araneus"]
# Near-extinct species (ToLaD#68). PHYLACINE's current range is the IUCN range without the parts coded
# "possibly extinct" or "extinct", so a living species whose map exists but is empty and that IUCN lists
# as Critically Endangered or Extinct in the Wild survives, if at all, in numbers too small to map. Its
# modelled count (density x a range nobody has seen it in) is capped at CR criterion D's threshold.
NEAR_EXTINCT_STATUS = ("CR", "EW")
NEAR_EXTINCT_CAP = 50.0  # IUCN Categories and Criteria v3.1, CR criterion D: < 50 mature individuals
SD_NEAR_EXTINCT = 1.0  # dex: anything from a last few to the cap, or none
NEAR_EXTINCT_METHOD = ("N:capped at 50 (no current range in PHYLACINE/IUCN and IUCN {status}: possibly "
                       "extinct; IUCN 2012 Categories and Criteria v3.1, CR criterion D < 50 mature)")
IUCN_CRITERIA_CITE = ("IUCN 2012, IUCN Red List Categories and Criteria v3.1, 2nd ed.",
                      "https://portals.iucn.org/library/node/10315")
# CR/EW species whose today's count is still modelled and above any IUCN population threshold
# (criterion C covers only species below 10,000 mature individuals): listed for a census anchor
CHECK_CR_ABOVE = 10000.0
SD_NAT_RANGE = 0.2  # dex, a present-natural range that differs from the current one (reconstruction)
NATURAL_METHOD_SCALED = "N_nat: D x natural range (PHYLACINE) x occupancy, scaled as today's count"
METHOD_A_PHYLACINE = "A:PHYLACINE current (rescaled to PanTHERIA areas)"
NATURAL_METHOD_FIT = "N_nat: D x natural range (PHYLACINE, rescaled to PanTHERIA areas) x fitted occupancy"
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
    rng = ranges.load_ranges(raw)
    rng_meta = ranges.load_spatial_metadata(raw)
    hits = Counter()
    rng_used: Counter = Counter()

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
        for n in names:
            r = rng.get(n)
            if r is not None:
                D["phy_range"] = {**r, "name": n, "certainty": rng_meta.get(n, {}).get("certainty", "")}
                rng_used[n] += 1
                break
        if nd.kind == "tree" and not nd.extinct:
            for k in ("log_mass", "log_density_obs", "log_range_obs", "log_gen_obs", "phy_range"):
                hits[k + (":yes" if k in D else ":no")] += 1
    log["trait_coverage_extant"] = {k: v for k, v in sorted(hits.items()) if not k.startswith("mass:")}
    log["mass_sources"] = {k: v for k, v in hits.items() if k.startswith("mass:")}
    shared = sorted(k for k, v in rng_used.items() if v > 1)
    log["phylacine_ranges"] = {
        "range_maps": len(rng), "maps_used": len(rng_used), "leaves_with_map": sum(rng_used.values()),
        "maps_on_more_than_one_leaf": len(shared), "examples_shared": shared[:10],
    }


def phylacine_area(km2: float, area_fit: dict) -> float:
    """log10 range area on PanTHERIA's scale from a PHYLACINE grid area (ToLaD#67): the fitted map
    log10 A_pan = a + b log10 A_phy, never above the grid area itself (the grid only inflates: the
    median PHYLACINE/PanTHERIA ratio is > 1 in every area class, so the fit's b > 1 must not grow
    the large ranges past their own maps)."""
    x = math.log10(km2)
    return min(area_fit["a"] + area_fit["b"] * x, x)


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
    # PHYLACINE range cells (96.5 km Behrmann grid) -> PanTHERIA's range-area scale. Rasterising
    # inflates small ranges (a 100 km2 range fills a 9,300 km2 cell), so an area taken from the
    # maps alone is mapped onto the scale the occupancy fit was calibrated on.
    pts = [(math.log10(n.data["phy_range"]["km2_cur"]), n.data["log_range_obs"]) for n in extant_obs
           if "log_range_obs" in n.data and n.data.get("phy_range", {}).get("km2_cur", 0) > 0]
    aA, aB, aS = _fit(*zip(*pts))
    diff = np.array([x - y for x, y in pts])
    log["fits"]["pantheria_range_log10 = a + b*log10(phylacine_current_km2)"] = {
        "a": round(aA, 3), "b": round(aB, 3), "resid_sd": round(aS, 3), "n": len(pts)}
    log["phylacine_ranges"]["current_vs_pantheria_dex"] = {
        "median": round(float(np.median(diff)), 3),
        "p5_25_75_95": [round(float(x), 3) for x in np.percentile(diff, [5, 25, 75, 95])], "n": len(pts),
        "by_pantheria_area": {
            f"{lo:.0e}-{hi:.0e} km2": {"n": int(m.sum()), "median": round(float(np.median(diff[m])), 2)}
            for lo, hi in ((0, 1e3), (1e3, 1e4), (1e4, 1e5), (1e5, 1e6), (1e6, 1e7), (1e7, 1e9))
            for m in [(np.array([y for _, y in pts]) >= math.log10(max(lo, 1e-9)))
                      & (np.array([y for _, y in pts]) < math.log10(hi))] if m.any()},
        "note": "log10(PHYLACINE current range area / PanTHERIA GR_Area_km2), extant leaves with both. "
                "COMBINE carries no range area (only home range), so PanTHERIA is the model's only "
                "observed range. Small ranges are inflated by the 96.5 km grid."}
    area_fit = {"a": aA, "b": aB, "sd": aS}
    acc_r = clade_means(root, "log_range_obs")
    gm_r = np.mean([n.data["log_range_obs"] for n in leaves if "log_range_obs" in n.data])

    for n in leaves:
        D = n.data
        lm = D["log_mass"]
        sd2 = 0.0
        sdNA2 = 0.0  # density + range part (replaced by a census where one exists)
        meth = []
        src = {SRC["opentree"] if n.kind == "tree" else SRC["pbdb"]}
        if n.kind == "graft" or n.pbdb:
            src.add(SRC["pbdb"])
        if D.get("placement_override"):
            src.add(SRC["overrides"])
            meth.append("P:stem placement from overrides.toml")
        if D.get("date_override"):
            src.add(SRC["overrides"])
            meth.append("T:date from overrides.toml")
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
            sdNA2 += 0.5 ** 2
            src.add(SRC[D["density_src"]])
            meth.append(f"D:obs({D['density_src']})")
        else:
            ld = dA + dB * lm
            sdNA2 += dS ** 2 + (dB * msd) ** 2
            src.add(SRC["damuth"])
            meth.append("D:allometric(M)")
        D["sd_density"] = math.sqrt(sdNA2)
        if "log_range_obs" in D:
            lr = D["log_range_obs"]
            sdNA2 += 0.2 ** 2
            src.add(SRC["pantheria"])
            meth.append("A:obs(PanTHERIA)")
        elif not n.extinct and D.get("phy_range", {}).get("km2_cur", 0) > 0:
            # no PanTHERIA area: the PHYLACINE current range, mapped onto PanTHERIA's scale (ToLaD#67)
            lr = phylacine_area(D["phy_range"]["km2_cur"], area_fit)
            sdNA2 += aS ** 2
            src.add(SRC["phylacine"])
            meth.append(METHOD_A_PHYLACINE)
        else:
            lr, lvl = impute_from_clade(n, acc_r, gm_r)
            sdNA2 += 0.6 ** 2 if n.kind == "tree" else 0.8 ** 2
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
        # the leaf's generation length and where it came from (the dated tree's per-species field, ToLaD#145)
        D["gen_yr"] = 10 ** lg
        D["gen_how"] = f"COMBINE {D['gen_src']}" if "log_gen_obs" in D else "allometric"
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
        D["sd_leaf"] = math.sqrt(sd2 + sdNA2)
        D["sd_NA"] = math.sqrt(sdNA2)
        D["meth"] = meth
        D["src"] = src
        D["dur_yr"] = dur * 1e6
        # raw (uncalibrated) standing population
        D["N_raw"] = 10 ** (ld + lr)
    return area_fit


def match_species(names, ctx: dict) -> tuple[dict[str, Node], list[str]]:
    """Source binomial -> extant Open Tree species leaf (exact name, then the
    synonym index built for the Upham match). Returns (hits, misses)."""
    exact, syn, phy_syn = ctx["exact"], ctx["syn"], ctx["phy_syn"]
    hits: dict[str, Node] = {}
    misses = []
    for nm in names:
        cands = [nm] + ([phy_syn[nm]] if nm in phy_syn else []) + NAME_ALIASES.get(nm, [])
        hit = None
        for c in cands:
            if c in exact and not exact[c].extinct:
                hit = exact[c]
                break
        if hit is None:
            for c in cands:
                s = {id(x): x for x in syn.get(c, []) if not x.extinct}
                if len(s) == 1:
                    hit = next(iter(s.values()))
                    break
        if hit is None:
            misses.append(nm)
        else:
            hits[nm] = hit
    return hits, misses


def _ancestor_name(n: Node, rank: str) -> str | None:
    a = ancestor_of_rank(n, rank)
    if a is None:
        return None
    return a.data.get("crown_of") or a.name


def land_group(n: Node) -> str:
    p = n.parent
    while p is not None:
        base = (p.data.get("crown_of") or p.name or "").split(" (")[0]
        if base in LAND_GROUPS:
            return base
        p = p.parent
    return "Other"


def fit_occupancy(root: Node, ref: dict[int, float], census: dict[int, float],
                  targets: dict[str, dict], log: dict) -> None:
    """Per-clade, body-size-dependent occupancy (02 §3.2a).

    The raw estimate density x range area overstates standing populations
    (densities are measured where a species is common; ranges are extents of
    occurrence). Most extant species have a reference population `ref`: an
    IUCN census report, or else Greenspoon et al.'s per-species model
    estimate. Those species use it directly (see assign_leaf_counts). For the
    rest (fossils, species missing from Greenspoon's list) N = N_raw * k with

        log10 k = a_g + b_g * (log10 mass - xbar_g)

    fitted by least squares of log10(ref / N_raw) on mass within each land
    order group g (the nine orders Greenspoon report, plus 'Other'; groups
    with fewer than MIN_GROUP species use the pooled land fit), and for
    marine species on the marine census species with shrunk order effects."""
    every = [n for n in root.preorder() if n.is_leaf and n.name != "Homo sapiens"]
    out: dict = {"land_groups": {}}
    land_all = [n for n in every if not n.data["marine"]]
    ext = [n for n in land_all if n.kind == "tree" and not n.extinct]
    with_ref = [n for n in ext if id(n) in ref]

    def ols(nodes):
        x = np.array([n.data["log_mass"] for n in nodes])
        r = np.array([math.log10(ref[id(n)] / n.data["N_raw"]) for n in nodes])
        xbar = float(x.mean())
        a, b, s = _fit(x - xbar, r)
        return a, b, xbar, s, float(x.min()), float(x.max())

    pooled = ols(with_ref)
    params = {}
    for g in LAND_GROUPS + ("Other",):
        members = [n for n in ext if land_group(n) == g]
        pts = [n for n in members if id(n) in ref]
        p = ols(pts) if len(pts) >= MIN_GROUP else pooled
        params[g] = p
        Nm = sum(ref.get(id(n), n.data["N_raw"] * 10 ** (p[0] + p[1] * (n.data["log_mass"] - p[2])))
                 for n in members)
        Bm = sum(ref.get(id(n), n.data["N_raw"] * 10 ** (p[0] + p[1] * (n.data["log_mass"] - p[2])))
                 * 10 ** n.data["log_mass"] for n in members)
        t = targets[g]
        free = sorted(((n.data["N_raw"] * 10 ** (p[0] + p[1] * (n.data["log_mass"] - p[2]) + n.data["log_mass"]),
                        n.name) for n in members if id(n) not in ref), reverse=True)
        largest = [(nm, round(b / 1e12, 3)) for b, nm in free[:4]]
        out["land_groups"][g] = {
            "species": len(members), "census": sum(1 for n in members if id(n) in census),
            "greenspoon_model": len(pts) - sum(1 for n in pts if id(n) in census),
            "fit_on": len(pts) if len(pts) >= MIN_GROUP else f"pooled land fit ({len(pts)} < {MIN_GROUP})",
            "a": round(p[0], 3), "b_per_dex_mass": round(p[1], 3), "resid_sd": round(p[3], 3),
            "individuals": Nm, "biomass_Mt": round(Bm / 1e12, 3),
            "greenspoon_individuals": t["individuals"], "greenspoon_biomass_Mt": round(t["biomass_g"] / 1e12, 3),
            "largest_unreferenced_Mt": largest,
        }
    for n in land_all:
        a, b, xbar, s, xmin, xmax = params[land_group(n)]
        x = min(max(n.data["log_mass"], xmin), xmax)  # no extrapolation beyond the fitted masses
        n.data["log_k"] = a + b * (x - xbar)
        n.data["k_sd"] = s
        if id(n) in ref:
            n.data["N_model_oos"] = n.data["N_raw"] * 10 ** n.data["log_k"]
    out["land_pooled"] = {"a": round(pooled[0], 3), "b_per_dex_mass": round(pooled[1], 3),
                          "resid_sd": round(pooled[3], 3), "n": len(with_ref)}
    N_all = sum(v["individuals"] for v in out["land_groups"].values())
    B_all = sum(v["biomass_Mt"] for v in out["land_groups"].values())
    out["land_total"] = {"individuals": N_all, "biomass_Mt": round(B_all, 2),
                         "greenspoon_individuals": sum(t["individuals"] for t in targets.values()),
                         "greenspoon_biomass_Mt": round(sum(t["biomass_g"] for t in targets.values()) / 1e12, 2),
                         "note": "individuals within ~0.05 dex of Greenspoon; biomass is higher because census species "
                                 "use PHYLACINE adult masses (Greenspoon's 95% CI for wild land biomass is 13-38 Mt)"}

    # ---- marine
    mar_all = [n for n in every if n.data["marine"]]
    mext = [n for n in mar_all if n.kind == "tree" and not n.extinct]
    pts = [n for n in mext if id(n) in census]
    x = np.array([n.data["log_mass"] for n in pts])
    r = np.array([math.log10(census[id(n)] / n.data["N_raw"]) for n in pts])
    a, b, s0 = _fit(x, r)
    e = r - (a + b * x)
    so: dict = {}
    no: dict = {}
    for n, ei in zip(pts, e):
        o = _ancestor_name(n, "order")
        so[o] = so.get(o, 0.0) + ei
        no[o] = no.get(o, 0) + 1
    u = {o: so[o] / (no[o] + K_SHRINK) for o in so if o}
    for n in mar_all:
        n.data["log_k"] = a + b * n.data["log_mass"] + u.get(_ancestor_name(n, "order"), 0.0)
        n.data["k_sd"] = s0
        if id(n) in census:
            n.data["N_model_oos"] = n.data["N_raw"] * 10 ** n.data["log_k"]
    mar_B = sum((census[id(n)] if id(n) in census else n.data["N_raw"] * 10 ** n.data["log_k"])
                * 10 ** n.data["log_mass"] for n in mext)
    out["marine"] = {
        "census_species": len(pts), "species": len(mext),
        "fit": {"a": round(a, 3), "b_per_dex_mass": round(b, 3), "resid_sd": round(s0, 3)},
        "order_effects_dex": {k: round(v, 2) for k, v in u.items()},
        "biomass_Mt": round(mar_B / 1e12, 2), "greenspoon_biomass_Mt": BIOMASS_MARINE_G / 1e12,
        "note": "computed with PHYLACINE adult masses; Greenspoon use population-mean masses "
                "(Trites & Pauly 1998), which are lower",
    }
    log["occupancy_calibration"] = out


def near_extinct(n: Node) -> bool:
    """A living leaf with a PHYLACINE map but an empty current range, IUCN CR or EW (ToLaD#68)."""
    pr = n.data.get("phy_range")
    return (not n.extinct and pr is not None and pr["cells_cur"] == 0
            and n.data.get("iucn") in NEAR_EXTINCT_STATUS)


def count_flags(root: Node, ref: dict[int, float]) -> dict:
    """ToLaD#68: the living species whose today's count cannot be trusted as modelled. Listed in
    stats.json -> count_flags, with what was done (after history files: `today` is the shipped count)."""
    no_cur, check = [], []
    area_with_map: Counter = Counter()
    for n in root.preorder():
        if not n.is_leaf or n.extinct or n.name == "Homo sapiens":
            continue
        D = n.data
        if D.get("phy_range", {}).get("cells_cur", 0) > 0:
            area_with_map[next((m.split(" mean")[0] + " mean" if " mean" in m else m
                                for m in D["meth"] if m.startswith("A:")), "none (census, estimate or cap)")] += 1
        today_from = ("history file" if D.get("alive_from_history")
                      else "census" if D.get("census_N") is not None
                      else "Greenspoon model" if id(n) in ref else "capped" if D.get("near_extinct_cap")
                      else "model")
        row = {"leaf": n.name, "iucn": D.get("iucn"), "today": D["alive"], "today_from": today_from,
               "natural": D["natural"]["N"] if D.get("natural") else None,
               "area": next((m for m in D["meth"] if m.startswith("A:")), None)}
        pr = D.get("phy_range")
        if pr is not None and pr["cells_cur"] == 0 and not D.get("domestic"):
            row["action"] = ("cited count (history file)" if today_from == "history file"
                             else "capped: possibly extinct" if D.get("near_extinct_cap")
                             else "flagged: no current map, IUCN " + str(D.get("iucn")))
            no_cur.append(row)
        elif D.get("iucn") in NEAR_EXTINCT_STATUS and D["alive"] > CHECK_CR_ABOVE and today_from in (
                "model", "Greenspoon model"):
            row["action"] = "flagged: modelled count above IUCN criterion C ceiling"
            check.append(row)
    key = lambda r: -r["today"]
    return {
        "note": "ToLaD#68. no_current_range: living leaves with a PHYLACINE map but an empty current range "
                "(PHYLACINE's current range is IUCN's without 'possibly extinct' areas). IUCN CR/EW ones are "
                f"capped at {NEAR_EXTINCT_CAP:.0f} (CR criterion D, IUCN Categories and Criteria v3.1) unless a "
                "history file gives a cited count; the rest (DD/LC/unassessed: unmapped, mostly taxonomic) are "
                "flagged only. Their natural baseline takes the density route. cr_modelled_above_10k: IUCN CR/EW "
                f"species whose today's count is still modelled and above {CHECK_CR_ABOVE:.0f} (the ceiling of "
                "IUCN criterion C): candidates for a census anchor, not changed. today = the shipped alive count.",
        "cite": " ".join(IUCN_CRITERIA_CITE),
        "area_method_with_current_map": dict(sorted(area_with_map.items())),
        "no_current_range": sorted(no_cur, key=key),
        "cr_modelled_above_10k": sorted(check, key=key),
    }


def natural_level(D: dict, N_today: float, sd_today: float, extinct: bool, area_fit: dict) -> dict | None:
    """Layer 1 of the estimate stack (ToLaD#61): the pre-human population,
    density x present-natural range area x occupancy (PHYLACINE 1.2.1 maps).

    An extant species with a current range map keeps the occupancy and the
    area scale of today's count, so N_nat = N_today x natural cells / current
    cells. For a modelled species N_today = k D A, so this is k D A_nat; for a
    census (or Greenspoon-estimate) species the census fixes its own occupancy,
    k_i = N_ref / (D A), and the same k_i applies to the natural range. A
    species with no current range (extinct, or extinct in the wild) uses
    D x A_nat x k: A_nat mapped from the PHYLACINE grid onto PanTHERIA's area
    scale (area_fit), k the fitted group occupancy. Returns None without a
    present-natural map."""
    pr = D.get("phy_range")
    if not pr or pr["cells_nat"] <= 0:
        return None
    if not extinct and pr["cells_cur"] > 0 and N_today > 0:
        # exactly today's count where the maps agree (x * a / a can miss x by an ulp)
        N = N_today if pr["cells_nat"] == pr["cells_cur"] else N_today * pr["cells_nat"] / pr["cells_cur"]
        sd_x = 0.0 if pr["cells_nat"] == pr["cells_cur"] else SD_NAT_RANGE
        sd = math.hypot(sd_today, sd_x)
        how = NATURAL_METHOD_SCALED
    else:
        la = phylacine_area(pr["km2_nat"], area_fit)
        N = 10 ** (D["log_density"] + la + D["log_k"])
        sd_x = math.hypot(D["sd_density"], area_fit["sd"])
        sd = math.hypot(sd_x, D.get("k_sd", 0.0))
        how = NATURAL_METHOD_FIT
    h = 1.96 * sd
    return {"N": N, "lo": N / 10 ** h, "hi": N * 10 ** h, "sd": sd, "sd_extra": sd_x, "method": how,
            "grade": "D", "kind": "reconstruction", "map": pr["name"], "certainty": pr.get("certainty", ""),
            "scaled": how == NATURAL_METHOD_SCALED,
            "km2_cur": pr["km2_cur"], "km2_nat": pr["km2_nat"],
            "cells_cur": pr["cells_cur"], "cells_nat": pr["cells_nat"]}


def rangeloss_points(n_nat: float, n_today: float) -> list[dict]:
    """The two knots of the range-loss trend: the natural level in 1500, today's count now."""
    return [{"year": RANGELOSS_START_YEAR, "n": n_nat}, {"year": anchors.NOW_YEAR, "n": n_today}]


def rangeloss_start(leaf: Node, any_natural: bool = False) -> dict | None:
    """The first knot of the range-loss trend as a curve point: the natural level in 1500 CE (kind
    `rangeloss`, its span to today's count kind `rangeloss`, grade D). None without the trend, unless
    `any_natural`: then any living leaf with a natural level gets the knot (a genomic deep past whose
    first cited point is after 1900 joins the natural level whatever its method; ToLaD#71)."""
    D = leaf.data
    if D.get("rangeloss") or (any_natural and D.get("natural") and not leaf.extinct
                              and D.get("rate_wild_now", 0.0) > 0):
        return _rangeloss_p0(leaf)
    return None


def _rangeloss_p0(leaf: Node) -> dict:
    D = leaf.data
    nat = D["natural"]
    p0 = rangeloss_points(nat["N"], D["rate_wild_now"] * D["L"])[0]
    p0.update(lo=nat["lo"], hi=nat["hi"], grade="D", kind="rangeloss", span_kind="rangeloss",
              cite=RANGELOSS_CITE, url=RANGELOSS_URL,
              note="natural (pre-human) level from the PHYLACINE present-natural range; the modelled "
                   "range-loss trend starts here")
    return p0


def rangeloss_record(leaf: Node) -> dict:
    """Layer 4 of the estimate stack (ToLaD#62): a modelled HIST record for a
    species with no history file whose natural baseline differs from today's
    count. Two points: the natural level in 1500 CE (kind `rangeloss`, grade D)
    and today's count now (kind `model`). Segments: the natural level held from
    the band start (kind `natural`), then the log-linear change between the two
    points (kind `rangeloss`, grade D). Same shape as the leaf's births pieces."""
    D = leaf.data
    L = D["L"]
    G = 2 * L
    nat = D["natural"]
    n_now = D["rate_wild_now"] * L
    h = 1.96 * D.get("sd_today_count", 0.0)
    p0, p1 = rangeloss_points(nat["N"], n_now)
    p0 = _rangeloss_p0(leaf)
    p1.update(lo=n_now / 10 ** h, hi=n_now * 10 ** h, grade="ABCD"[min(3, D.get("grade_cap_today", 3))],
              kind="model", cite="ToLaD model (stats.json, this leaf)", url="https://github.com/theitush/ToLaD",
              note="the pipeline's alive-now for this leaf")
    pts = [p0, p1]
    segs = history.compile_segments(pts, G, L, leaf.t0, False, pre_level=nat["N"], pre_grade=3,
                                    pre_kind="natural")
    for sg in segs:
        # the generation that straddles 1500 can fall before the first point: it holds the natural level
        if sg["kind"] == history.K["held"]:
            sg["kind"] = history.K["natural"]
    return {"species": leaf.name, "aliases": [], "common": "", "component": "wild", "use": "counts",
            "scope": "global, modelled from range loss", "faostat_item": None, "file": None,
            "notes": RANGELOSS_NOTE, "points": [], "baseline": None, "deep": None, "modelled": "rangeloss",
            "curve": pts, "segments": segs, "G": G, "L": L, "leaf": leaf}


def rangeloss_report(root: Node) -> dict:
    """stats.json -> rangeloss: coverage, the factors N_nat / N_today, outliers, showcase."""
    leaves = [n for n in root.preorder() if n.is_leaf and n.data.get("rangeloss")]
    recs = [n for n in leaves if (n.data.get("history") or {}).get("modelled") == "rangeloss"]

    def factor(n):
        return n.data["natural"]["N"] / (n.data["rate_wild_now"] * n.data["L"])
    lf = np.array([math.log10(factor(n)) for n in recs])
    hist = Counter(f"{e:+.1f}..{e + 0.5:+.1f}" for e in np.floor(lf * 2) / 2)

    def row(n):
        D, nat = n.data, n.data["natural"]
        rec = D.get("history")
        return {"leaf": n.name, "natural": nat["N"], "today": D["rate_wild_now"] * D["L"],
                "factor": factor(n), "km2_nat": nat["km2_nat"], "km2_cur": nat["km2_cur"],
                "method": nat["method"], "G_yr": 2 * D["L"], "segments": len(rec["segments"]) if rec else 0,
                "from": ("flat" if not D.get("rangeloss") else
                         "rangeloss" if rec.get("modelled") == "rangeloss" else
                         "genomic" if rec.get("modelled") == "genomic" else "history")}
    by = sorted(recs, key=factor)
    return {
        "note": "Layer 4 of the estimate stack (ToLaD#62): an extant species whose natural baseline (layer 1, "
                "PHYLACINE present-natural vs current range) differs from today's count changes log-linearly "
                f"from N_nat in {RANGELOSS_START_YEAR} CE to today's count in {anchors.NOW_YEAR} (IUCN's "
                "'since 1500' window, one date for all). factor = N_nat / N_today (> 1 = decline). HIST kind "
                "11 `rangeloss`, grade D. A history file replaces it (showcase rows with from=history: the "
                "factor shown is the model's, the curve is the history file's).",
        "start_year": RANGELOSS_START_YEAR, "end_year": anchors.NOW_YEAR,
        "species_with_trend": len(leaves), "hist_records": len(recs),
        "replaced_by_history_file": sum((n.data.get("history") or {}).get("file") is not None for n in leaves),
        "carried_by_genomic_record": sum((n.data.get("history") or {}).get("modelled") == "genomic"
                                         for n in leaves),
        "declines": int(np.sum(lf > 0)), "rises": int(np.sum(lf < 0)),
        "log10_factor_histogram": dict(sorted(hist.items(), key=lambda kv: float(kv[0].split("..")[0]))),
        "log10_factor_p5_25_50_75_95": ([round(float(q), 3) for q in np.percentile(lf, [5, 25, 50, 75, 95])]
                                        if len(lf) else []),
        "segments_per_record": dict(sorted(Counter(len(n.data["history"]["segments"]) for n in recs).items())),
        "largest_declines": [row(n) for n in by[::-1][:10]],
        "rises_list": [row(n) for n in by if factor(n) < 1],
        "showcase": [row(n) for n in root.preorder() if n.is_leaf and n.name in RANGELOSS_SHOWCASE
                     and not n.extinct and "natural" in n.data and n.data.get("rate_wild_now", 0) > 0],
    }


NATURAL_SHOWCASE = ["Panthera leo", "Panthera tigris", "Panthera pardus", "Panthera onca", "Panthera uncia",
                    "Loxodonta africana", "Elephas maximus", "Ursus arctos", "Canis lupus", "Gorilla gorilla",
                    "Pan troglodytes", "Ceratotherium simum", "Bison bison", "Equus ferus", "Vulpes vulpes",
                    "Rattus norvegicus", "Mammuthus primigenius", "Megaloceros giganteus", "Bos primigenius"]


def natural_report(root: Node) -> dict:
    """stats.json -> natural_baseline: coverage, N_nat / N_today, showcase and outliers."""
    leaves = [n for n in root.preorder() if n.is_leaf and "natural" in n.data]
    ext = [n for n in leaves if not n.extinct and n.data["alive"] > 0]
    lr = np.array([round(math.log10(n.data["natural"]["N"] / n.data["rate_wild_now"] / n.data["L"]), 9)
                   for n in ext if n.data["rate_wild_now"] > 0])

    def row(n):
        D, nat = n.data, n.data["natural"]
        today = D["rate_wild_now"] * D["L"]
        return {"leaf": n.name, "map": nat["map"], "extinct": bool(n.extinct), "today": today,
                "natural": nat["N"], "lo": nat["lo"], "hi": nat["hi"],
                "ratio": nat["N"] / today if today > 0 else None,
                "km2_cur": round(nat["km2_cur"]), "km2_nat": round(nat["km2_nat"]),
                "area_ratio": nat["cells_nat"] / nat["cells_cur"] if nat["cells_cur"] else None,
                "method": nat["method"]}

    by_name = {n.name: n for n in leaves}
    ranked = sorted((n for n in ext if n.data["rate_wild_now"] > 0),
                    key=lambda n: n.data["natural"]["N"] / (n.data["rate_wild_now"] * n.data["L"]))
    extinct = [n for n in leaves if n.extinct]
    return {
        "note": "Layer 1 of the estimate stack (ToLaD#61): N_nat = density x PHYLACINE present-natural range "
                "x occupancy, grade D, kind reconstruction. Extant species: today's count x natural/current "
                "range cells (the same occupancy and area scale as today's count). No current range: density "
                f"x natural area (rescaled to PanTHERIA areas) x fitted occupancy. Held before "
                f"{NATURAL_STEP_YEAR} where it differs from today's count; extinct species: the whole band.",
        "leaves": len(leaves), "extant": len(ext), "extinct": len(extinct),
        "methods": dict(Counter(n.data["natural"]["method"] for n in leaves)),
        "extant_log10_natural_over_today": {
            "n": int(lr.size), "same": int((np.abs(lr) < 1e-9).sum()), "higher": int((lr > 1e-9).sum()),
            "lower": int((lr < -1e-9).sum()),
            "p5_25_50_75_95": [round(float(x), 3) for x in np.percentile(lr, [5, 25, 50, 75, 95])],
            "histogram_dex": {f"{a:+.1f}..{a + 0.5:+.1f}": int(((lr >= a) & (lr < a + 0.5)).sum())
                              for a in np.arange(-1.0, 2.5, 0.5)},
        },
        "extant_total": {"today": sum(n.data["rate_wild_now"] * n.data["L"] for n in ext),
                         "natural": sum(n.data["natural"]["N"] for n in ext)},
        "extinct_total_natural": sum(n.data["natural"]["N"] for n in extinct),
        "showcase": [row(by_name[s]) for s in NATURAL_SHOWCASE if s in by_name],
        "highest_ratio": [row(n) for n in ranked[::-1][:10]],
        "lowest_ratio": [row(n) for n in ranked[:10]],
    }


def human_rate_at(pieces, age_ma: float) -> float:
    for old, young, r in pieces:
        if young <= age_ma <= old:
            return r
    return 0.0


def assign_leaf_counts(root: Node, raw: Path, ctx: dict, log: dict) -> None:
    pieces_h, ever_h, alive_h, notes_h = anchors.human_births_pieces(raw)
    now_h = pieces_h[-1][2]

    # domestic stocks: FAOSTAT livestock + Greenspoon pets -> leaf name
    leaf_names = {n.name for n in root.preorder() if n.is_leaf}
    fao_raw, _ = anchors.faostat_stocks(raw)
    pets = anchors.greenspoon_pets(raw)
    domestic: dict[str, dict] = {}
    missing_dom = []
    for sp, (val, year) in fao_raw.items():
        domestic[sp] = {"stock": val, "src": "faostat", "label": f"FAOSTAT {year} stock {val:.3g}", "grade": "B"}
    for sp, val in pets.items():
        domestic[sp] = {"stock": val, "src": "greenspoon-data", "grade": "C",
                        "label": f"{val:.2g} ({'dogs' if sp.startswith('Canis') else 'cats'}; "
                                 f"Greenspoon 2023 data, pets table)"}
    dom_by_leaf: dict[str, dict] = {}
    for sp, d in domestic.items():
        for cand in [sp] + anchors.DOMESTIC_ALIASES.get(sp, []):
            if cand in leaf_names:
                dom_by_leaf[cand] = {**d, "species": sp, "dom_year": anchors.DOMESTICATION_YEAR[sp]}
                break
        else:
            missing_dom.append(sp)

    # wild census anchors (Greenspoon 2023 compilation of IUCN reports)
    census_raw = anchors.greenspoon_census(raw)
    hits, misses = match_species(sorted(census_raw), ctx)
    census: dict[int, float] = {}
    dup = 0
    for nm, nd in hits.items():
        if id(nd) in census:
            dup += 1
            continue
        census[id(nd)] = census_raw[nm]["N"]
    # Greenspoon's per-species model estimates (land): the reference for
    # species without a census report
    gs_model = anchors.greenspoon_species_model(raw)
    gs_hits, gs_miss = match_species(sorted(gs_model), ctx)
    gs: dict[int, float] = {}
    for nm, nd in gs_hits.items():
        if id(nd) not in census and id(nd) not in gs and not nd.data["marine"]:
            gs[id(nd)] = gs_model[nm]["N"]
    ref = {**gs, **census}
    fit_occupancy(root, ref, census, anchors.greenspoon_order_targets(raw), log)
    log["census_anchors"] = {
        "source": anchors.GREENSPOON_CITE,
        "census_reports": len(census_raw), "census_matched_extant_leaves": len(census),
        "census_unmatched_or_extinct": sorted(misses), "census_duplicates_skipped": dup,
        "species_model_estimates": len(gs_model), "species_model_used": len(gs),
        "species_model_unmatched": len(gs_miss),
    }

    found = Counter()
    for n in root.preorder():
        if not n.is_leaf:
            continue
        D = n.data
        if n.name == "Homo sapiens":
            D["pieces"] = list(pieces_h)
            D["alive"] = alive_h
            D["ever_med"] = ever_h
            D["sd_leaf"] = 0.1
            D["sys_sd"] = 0.0
            D["grade_cap"] = 1
            D["rate_wild_now"] = 0.0
            D["meth"] = ["anchor: " + "; ".join(notes_h)]
            D["src"] = {SRC["opentree"], SRC["upham"], SRC["prb"], SRC["wpp"]}
            found["Homo sapiens"] += 1
            continue
        cap = 2 if n.kind == "tree" else 3
        if id(n) in census:
            N = census[id(n)]
            # census replaces density x range x occupancy
            D["sd_leaf"] = math.sqrt(max(D["sd_leaf"] ** 2 - D["sd_NA"] ** 2, 0.0) + SD_CENSUS ** 2)
            D["sys_sd"] = SD_SYSTEMATIC_CENSUS
            D["meth"] = [m for m in D["meth"] if not m.startswith(("D:", "A:"))]
            D["meth"].append("N:census (IUCN report via Greenspoon 2023)")
            D["src"].add(SRC["greenspoon-data"])
            D["census_N"] = N
            D["anchored_count"] = True
            found["census"] += 1
        elif id(n) in gs:
            N = gs[id(n)]
            D["sd_leaf"] = math.sqrt(max(D["sd_leaf"] ** 2 - D["sd_NA"] ** 2, 0.0) + SD_GS_MODEL ** 2)
            D["sys_sd"] = SD_SYSTEMATIC_CENSUS
            D["meth"] = [m for m in D["meth"] if not m.startswith(("D:", "A:"))]
            D["meth"].append("N:Greenspoon 2023 per-species model (no census report)")
            D["src"].add(SRC["greenspoon-data"])
            found["greenspoon model"] += 1
        else:
            N = D["N_raw"] * 10 ** D["log_k"]
            D["sys_sd"] = SD_SYSTEMATIC
            D["src"].add(SRC["greenspoon"])
            D["meth"].append("k:occupancy fitted by order group and mass on census + Greenspoon 2023 estimates"
                             if not D["marine"] else "k:occupancy fitted on marine census species (mass, order)")
            if near_extinct(n) and N > NEAR_EXTINCT_CAP:
                N = NEAR_EXTINCT_CAP
                D["sd_leaf"] = math.sqrt(max(D["sd_leaf"] ** 2 - D["sd_NA"] ** 2, 0.0) + SD_NEAR_EXTINCT ** 2)
                D["meth"] = [m for m in D["meth"] if not m.startswith(("D:", "A:", "k:"))]
                D["meth"].append(NEAR_EXTINCT_METHOD.format(status=D["iucn"]))
                D["near_extinct_cap"] = True
                cap = 3
                found["near-extinct cap"] += 1
        r = N / D["L"]
        D["sd_leaf_today"] = D["sd_leaf"]
        D["grade_cap_today"] = cap
        # natural (pre-human) baseline: the level before NATURAL_STEP_YEAR (extinct: the whole band)
        sd_today = (SD_CENSUS if id(n) in census else SD_GS_MODEL if id(n) in gs
                    else SD_NEAR_EXTINCT if D.get("near_extinct_cap")
                    else math.hypot(D["sd_NA"], D.get("k_sd", 0.0)))
        D["sd_today_count"] = sd_today
        nat = natural_level(D, N, sd_today, n.extinct, ctx["area_fit"])
        r_nat = r
        if nat is not None:
            D["natural"] = nat
            D["src"].add(SRC["phylacine"])
            r_nat = nat["N"] / D["L"]
            if n.extinct:
                # the natural range replaces the clade-mean range of an extinct species
                D["sd_leaf"] = math.sqrt(max(D["sd_leaf"] ** 2 - D["sd_NA"] ** 2, 0.0) + nat["sd_extra"] ** 2)
                D["meth"] = [m for m in D["meth"] if not m.startswith("A:")] + [nat["method"]]
                cap = 3
                found["natural: extinct, whole band"] += 1
            elif nat["N"] != N:
                D["sd_leaf"] = math.hypot(D["sd_leaf"], nat["sd_extra"])
                D["meth"].append(f"{nat['method']}, held before {RANGELOSS_START_YEAR}"
                                 + (", then log-linear to today's count (range loss, modelled)"
                                    if nat["scaled"] else ""))
                cap = 3
                found["natural: extant, differs from today"] += 1
            else:
                found["natural: extant, same as today"] += 1
        step = year_to_ma(NATURAL_STEP_YEAR)
        if n.extinct:
            pieces = [(n.t0, n.t1, r_nat)]
        elif r_nat != r and n.t0 > step and nat["scaled"]:
            # range loss (ToLaD#62): the natural level held to 1500, then log-linear to today's count.
            # Only with both maps: N_nat is then today's count x natural / current cells, so the
            # factor is the range ratio and not a mismatch between two methods
            pieces = history.curve_pieces(rangeloss_points(nat["N"], N), D["L"], n.t0, step=RANGELOSS_PIECE_YR)
            D["rangeloss"] = True
        elif r_nat != r and n.t0 > step:
            # extant with no current range map (N_nat from density x area x occupancy): the #61 step
            pieces = [(n.t0, max(n.t1, step), r_nat), (step, n.t1, r)]
        else:
            pieces = [(n.t0, n.t1, r)]
        alive = 0.0 if n.extinct else N
        D["rate_wild_now"] = 0.0 if n.extinct else r
        dom = dom_by_leaf.get(n.name)
        if dom is not None and dom["species"] == n.name and id(n) not in census and id(n) not in gs:
            # a domestic form with no wild population of its own (cattle, sheep,
            # horse, ...): the modelled wild lineage runs up to domestication only,
            # at its natural level where a range map gives one
            dom_start = year_to_ma(dom["dom_year"])
            pieces = [(n.t0, max(n.t1, dom_start), r_nat)] if n.t0 > dom_start else []
            D.pop("rangeloss", None)  # no wild population today: no trend to it
            alive = 0.0
            D["rate_wild_now"] = 0.0
            D["meth"].append("wild ancestor modelled up to domestication; no wild population today")
        elif n.name in anchors.DOMESTIC_FORMS and n.name not in dom_by_leaf:
            # a domestic form whose wild ancestor is another leaf (llama, alpaca, zebu, yak, Bactrian
            # camel; ToLaD#135): its range map and census are the ancestor's, so it has no wild population
            # today and, with no pinned stock of its own, no alive count
            dom_start = year_to_ma(anchors.DOMESTICATION_YEAR[n.name])
            pieces = [(n.t0, max(n.t1, dom_start), r_nat)] if n.t0 > dom_start else []
            D.pop("rangeloss", None)
            alive = 0.0
            D["rate_wild_now"] = 0.0
            for k in ("census_N", "anchored_count", "near_extinct_cap"):
                D.pop(k, None)
            D["meth"] = [m for m in D["meth"] if not m.startswith("N:")]
            D["meth"].append(f"domestic form of {anchors.DOMESTIC_FORMS[n.name]}: wild lineage modelled up to "
                             f"domestication; no wild population today; no domestic stock: "
                             f"{anchors.DOMESTIC_FORM_NO_STOCK[n.name]}")
            found["domestic form, no stock"] += 1
        D["n_wild_pieces"] = len(pieces)
        if n.name in dom_by_leaf:
            d = dom_by_leaf[n.name]
            dom_start = year_to_ma(d["dom_year"])
            r_dom_now = d["stock"] / D["L"]
            for old, young, rh in pieces_h:
                if young >= dom_start:
                    continue
                o = min(old, dom_start)
                pieces.append((o, young, r_dom_now * rh / now_h))
            alive += d["stock"]
            D["meth"].append(f"+ domestic: {d['label']}, growth shaped like human births since domestication")
            D["src"].add(SRC[d["src"]])
            D["src"].add(SRC["prb"])
            D["domestic"] = d
            D["anchored_count"] = True
            found[f"domestic:{d['species']}"] += 1
        D["pieces"] = pieces
        D["alive"] = alive
        D["ever_med"] = sum((o - y) * 1e6 * rr for o, y, rr in pieces)
        D["grade_cap"] = cap
    log["anchors_found"] = dict(found)
    # curated flagship histories: pre-decline baselines and dated curves (pipeline/history/)
    # layer 3, bulk: genome Ne curves (genomic.py) become [deep] tables, of the history files that have
    # none and of modelled records for the species with no file (ToLaD#64)
    recs = history.load_all()
    living = {}
    for n in root.preorder():
        if n.is_leaf and n.name and not n.extinct:
            living.setdefault(n.name, n)
    recs += genomic.attach(recs, living, genomic.load(raw), rangeloss_start, log)
    ctx["history"] = history.apply(root, raw, log, SRC["history"], recs, rangeloss_start)
    # range-loss trend records for the species no history file covers (a history file wins)
    for n in root.preorder():
        if n.is_leaf and n.data.get("rangeloss") and n.data.get("history") is None:
            n.data["history"] = rangeloss_record(n)
    log["rangeloss"] = rangeloss_report(root)
    log["natural_baseline"] = natural_report(root)
    log["count_flags"] = count_flags(root, ref)
    # layer 2, genetic diversity: a cross-check written to stats.json only (ToLaD#63)
    log["diversity_crosscheck"] = diversity.report(root, raw, ctx)
    unverified = [n for n in root.preorder() if n.is_leaf and n.kind == "tree" and not n.extinct
                  and not n.upham and "iucn" not in n.data and id(n) not in ref and n.name != "Homo sapiens"]
    log["unverified_extant_tips"] = {
        "note": "living Open Tree tips that only the IUCN Red List 2026-1 (or a domestic table) recognises, not "
                "Upham, PHYLACINE or Greenspoon/IUCN: mostly recent splits. Their counts come from the occupancy "
                "model only. Tips no list recognises are dropped (ToLaD#116, stats.json -> unrecognised_tips).",
        "tips": len(unverified),
        "alive": sum(n.data["alive"] for n in unverified),
        "examples": [n.name for n in unverified[::max(1, len(unverified) // 12)]][:12],
    }
    log["domestic_anchors"] = {d["species"]: {"leaf": leaf, "stock": d["stock"], "alive_grade": d["grade"],
                                              "source": d["label"]} for leaf, d in dom_by_leaf.items()}
    if missing_dom:
        log["anchors_missing_in_tree"] = sorted(missing_dom)


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
# split over the reconstructed lineages crossing t, weighted by the modern
# wild births of each lineage's extant descendants, and credited to the
# clade in whose crown the lineage runs (ghost_weights). So Jurassic and
# Cretaceous ghosts land on Mammalia/Theria/Placentalia-level nodes, a crown
# order only collects ghosts after its own crown split, and neither old relict
# lineages nor whichever few fossils happen to be sampled soak them up.
# Species leaves keep their own counts; ghosts are stored separately (GHST) so
# the renderer can draw them in a distinct style (00-synthesis, Extinct taxa).
#
# Why the ghost share is ~95%: an extant species' band only reaches back to
# its split from its sister (a few Myr), and PBDB samples a small fraction of
# fossil species. Ghost shares by era (stats.json -> ghost_lineages.by_era)
# run from ~7% in the last 2.6 Myr to ~77% in the Neogene, ~99% in the
# Paleogene and 100% before 66 Ma, and with f(t) = 1 back to ~91 Ma more than
# half of all mammal births fall before the K-Pg boundary.
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


def _edge_intervals(n: Node) -> list[tuple[float, float]]:
    """The part of n's band that is a single reconstructed lineage: the whole
    band for a species, the time not covered by any *live* child otherwise
    (the stem before the crown split, for a total-group node the stem before
    its crown and stem fossils branch off)."""
    if n.is_leaf:
        return [(n.t0, n.t1)]
    kids = [c for c in n.children if c.data["live"]]
    cov = union([(c.t0, c.t1) for c in kids])
    gaps = []
    cur = n.t1
    for o, y in cov:
        if y > cur:
            gaps.append((y, cur))
        cur = max(cur, o)
    if n.t0 > cur:
        gaps.append((n.t0, cur))
    return gaps


def _edge_cover(E: np.ndarray, widths: np.ndarray, n: Node) -> np.ndarray:
    v = np.zeros(GRID_N)
    for o, y in _edge_intervals(n):
        v += overlap(E, o, y)
    return v / widths


def ghost_weights(E: np.ndarray, widths: np.ndarray, n: Node) -> np.ndarray:
    """Ghost-lineage weight per grid cell credited to node n (crown membership).

    A ghost lineage at time t is an unsampled side branch of some
    reconstructed lineage crossing t. It is credited to the clade *within
    whose crown* that lineage runs, i.e. to the parent of the crossing edge,
    not to the edge's own clade. So a crown order collects ghosts only after
    its own crown split, and deep-time ghosts on long ordinal stems go to the
    superordinal clade they sit in. The root keeps its own stem.

    Each crossing lineage is weighted by the present-day wild births of its
    extant descendants. That is 02 §3.1 eq. (3) applied per clade (ever ~
    births_now(c) x T_eff(c), with every clade following the class-wide
    abundance curve f(t) since its crown origin), so a relict lineage with one
    rare living species does not collect as many ghosts as a radiation of
    abundant rodents just because both cross the same deep time."""
    w = np.zeros(GRID_N)
    for c in n.children:
        if c.data["live"] and c.data["births_desc"] > 0:
            w += c.data["births_desc"] * _edge_cover(E, widths, c)
    if n.parent is None:
        w += n.data["births_desc"] * _edge_cover(E, widths, n)
    return w


def ghost_deficit(root: Node, E: np.ndarray, log: dict) -> np.ndarray:
    births_now = 0.0
    S = np.zeros(GRID_N)
    W = np.zeros(GRID_N)
    widths = np.diff(E)
    for n in root.postorder():
        D = n.data
        if n.is_leaf:
            D["dur_yr"] = max(D["dur_yr"], 1.0)
            D["lineage_rate"] = sum((o - y) * 1e6 * r for o, y, r in D["pieces"]) / D["dur_yr"]
            # reconstructed (live) lineage: extant, or recently extinct but in Upham
            D["live"] = (not n.extinct) or bool(n.upham)
            # wild births only: the domestic and human booms are not
            # "modern-equivalent abundance" over T_eff
            births_now += D.get("rate_wild_now", 0.0)
            D["births_desc"] = D.get("rate_wild_now", 0.0)
            S += _leaf_vec(E, n)
            continue
        D["live"] = any(c.data["live"] for c in n.children)
        D["births_desc"] = sum(c.data["births_desc"] for c in n.children)
        D["lineage_rate"] = float(np.exp(np.mean([math.log(max(c.data["lineage_rate"], 1e-12))
                                                  for c in n.children])))
        D["fill_gaps"] = _gaps(n)
        S += _fill_vec(E, n)
    for n in root.preorder():
        if not n.is_leaf:
            W += ghost_weights(E, widths, n)
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
    mid = (E[1:] + E[:-1]) / 2
    by_era = {}
    for name, lo, hi in (("Holocene-Pleistocene 0-2.58 Ma", 0, 2.58), ("Neogene 2.58-23 Ma", 2.58, 23.03),
                         ("Paleogene 23-66 Ma", 23.03, 66.0), ("Cretaceous 66-145 Ma", 66.0, 145.0),
                         ("Jurassic and older >145 Ma", 145.0, 1e9)):
        sel = (mid >= lo) & (mid < hi)
        by_era[name] = {"sampled": float(S[sel].sum()), "ghost": float(deficit[sel].sum()),
                        "ghost_share": round(float(deficit[sel].sum() / max(S[sel].sum() + deficit[sel].sum(), 1)), 4)}
    log["ghost_lineages"] = {
        "births_now_per_yr": births_now,
        "births_now_note": "wild births only (no humans, no domestic stocks)",
        "T_eff_yr": MAMMALIA_T_EFF_YR,
        "f_ramp_Ma": [round(t_origin, 2), round(t_full, 2)],
        "top_down_estimate": float(expected.sum()),
        "sampled_sum": sampled,
        "with_ghosts": total,
        "ghost_share": round(1 - sampled / total, 4),
        "by_era": by_era,
        "allocation": "crown membership: a ghost at time t is credited to the parent of each reconstructed "
                      "lineage crossing t, in proportion to the present-day wild births of that lineage's "
                      "extant descendants",
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
            own_g = per_rate * ghost_weights(E, widths, n)  # births per grid cell
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
            D["log_sd"] = math.hypot(D["sd_leaf"], D["sys_sd"])
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
    ctx["area_fit"] = model_leaves(root, raw, log)
    assign_leaf_counts(root, raw, ctx, log)
    sum_tree(root, log)
    finalize(root)
    r = root.data
    log["mammalia"] = {"alive": r["alive"], "ever": r["ever"], "ghost": r["ghost"],
                       "grade": "ABCD"[r["grade"]],
                       "lo": r["ever"] / 10 ** r["lo"], "hi": r["ever"] * 10 ** r["hi"]}
