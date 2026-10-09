"""Loaders for the raw inputs. Each returns plain Python structures.

All of these only *parse* files under data/raw; nothing there is executed.
"""

from __future__ import annotations

import csv
import json
import math
import re
from pathlib import Path

from .newick import NNode, parse_comment, parse_newick, parse_nexus_tree

NA = {"", "NA", "-999", "-999.00", "-999.0", "NaN", "nan"}


def fnum(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        x = float(v)
    else:
        v = v.strip()
        if v in NA:
            return None
        try:
            x = float(v)
        except ValueError:
            return None
    if math.isnan(x) or x == -999:
        return None
    return x


def norm_name(s: str) -> str:
    """'Canis_lupus' / 'canis  lupus' -> 'Canis lupus'."""
    s = s.replace("_", " ").strip()
    s = re.sub(r"\s+", " ", s)
    return s[:1].upper() + s[1:].lower() if s else s


# ---------------------------------------------------------------- Open Tree

OTT_LABEL = re.compile(r"^(.*?)[ _]ott(\d+)$")
MRCA_LABEL = re.compile(r"^mrcaott\d+ott\d+$")


def load_opentree(raw: Path) -> tuple[NNode, dict]:
    d = json.loads((raw / "opentree" / "mammalia_subtree.json").read_text())
    about = json.loads((raw / "opentree" / "about.json").read_text())
    root = parse_newick(d["newick"])
    for nd in root.iter_preorder():
        lab = nd.label or ""
        m = OTT_LABEL.match(lab)
        nd.ott = None
        nd.name = None
        if m:
            nd.ott = int(m.group(2))
            nd.name = m.group(1).replace("_", " ").strip()
        elif MRCA_LABEL.match(lab):
            nd.name = None
    return root, about


def load_ott(raw: Path, ids: set[int]) -> tuple[dict[int, dict], dict[int, list[str]]]:
    """Rows of OTT taxonomy.tsv / synonyms.tsv for the given ids only."""
    tax: dict[int, dict] = {}
    with (raw / "ott" / "taxonomy.tsv").open(encoding="utf-8") as f:
        next(f)
        for line in f:
            p = line.split("\t|\t")
            try:
                uid = int(p[0])
            except ValueError:
                continue
            if uid in ids:
                tax[uid] = {
                    "parent": int(p[1]) if p[1] else None,
                    "name": p[2],
                    "rank": p[3],
                    "sourceinfo": p[4],
                    "flags": set(x for x in p[6].strip().strip("|").strip().split(",") if x),
                }
    syn: dict[int, list[str]] = {}
    with (raw / "ott" / "synonyms.tsv").open(encoding="utf-8") as f:
        next(f)
        for line in f:
            p = line.split("\t|\t")
            if len(p) < 2:
                continue
            try:
                uid = int(p[1])
            except ValueError:
                continue
            if uid in ids:
                syn.setdefault(uid, []).append(p[0])
    return tax, syn


# ---------------------------------------------------------------- Upham 2019


def load_upham(raw: Path) -> tuple[NNode, dict[str, dict]]:
    text = (raw / "upham" / "MamPhy_fullPosterior_BDvr_Completed_5911sp_topoCons_NDexp_MCC_v2_target.tre").read_text()
    root = parse_nexus_tree(text)
    # node heights (Ma) from TreeAnnotator annotations
    for nd in root.iter_preorder():
        kv = parse_comment(nd.comment)
        h = fnum(kv.get("height"))
        nd.height = h
        hpd = kv.get("height_95%_HPD")
        nd.hpd = None
        if hpd:
            try:
                lo, hi = (float(x) for x in hpd.strip("{}").split(","))
                nd.hpd = (lo, hi)
            except ValueError:
                pass
    # drop the outgroup: root has children [Anolis, Mammalia]
    kids = [c for c in root.children if not (c.label or "").startswith("_Anolis")]
    if len(kids) == 1 and len(root.children) == 2:
        root = kids[0]
        root.parent = None
    tax: dict[str, dict] = {}
    with (raw / "upham" / "taxonomy_mamPhy_5911species_toPublish.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            tax[r["tiplabel"]] = {
                "name": norm_name(r["Species_Name"]),
                "genus": r["gen"],
                "family": r["fam"].capitalize(),
                "order": r["ord"].capitalize(),
                "msw3": norm_name(r["MSW3_sciName_matched"]) if r["MSW3_sciName_matched"] not in NA else None,
                "extinct": r["extinct."] == "1",
                "samp": r["samp"],
            }
    return root, tax


# ---------------------------------------------------------------- traits


def load_phylacine(raw: Path) -> tuple[dict[str, dict], dict[str, str]]:
    traits: dict[str, dict] = {}
    with (raw / "phylacine" / "Trait_data.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            nm = norm_name(r["Binomial.1.2"])
            traits[nm] = {
                "order": r["Order.1.2"],
                "family": r["Family.1.2"],
                "mass_g": fnum(r["Mass.g"]),
                "mass_method": r["Mass.Method"],
                "iucn": r["IUCN.Status.1.2"],
                "marine": r["Marine"] == "1",
                "aerial": r["Aerial"] == "1",
                "terrestrial": r["Terrestrial"] == "1",
            }
    # synonym -> PHYLACINE 1.2 binomial
    syn: dict[str, str] = {}
    with (raw / "phylacine" / "Synonymy_table_valid_species_only.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            tgt = norm_name(r["Binomial.1.2"])
            for g, s in (("Genus.1.1", "Species.1.1"), ("Genus.1.0", "Species.1.0"),
                         ("EltonTraits.1.0.Genus", "EltonTraits.1.0.Species"),
                         ("IUCN.2016.3.Genus", "IUCN.2016.3.Species")):
                if r.get(g) and r.get(s) and r[g] not in NA and r[s] not in NA:
                    syn.setdefault(norm_name(f"{r[g]} {r[s]}"), tgt)
    return traits, syn


def load_combine(raw: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    def read(fn: str) -> dict[str, dict]:
        out: dict[str, dict] = {}
        with (raw / "combine" / fn).open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rec = {
                    "mass_g": fnum(r["adult_mass_g"]),
                    "gen_d": fnum(r["generation_length_d"]),
                    "longevity_d": fnum(r["max_longevity_d"]),
                    "density": fnum(r["density_n_km2"]),
                    "phylacine": norm_name(r["phylacine_binomial"]) if r["phylacine_binomial"] not in NA else None,
                    "marine": r.get("marine") == "1",
                }
                out[norm_name(r["iucn2020_binomial"])] = rec
                if rec["phylacine"]:
                    out.setdefault(rec["phylacine"], rec)
        return out

    return read("trait_data_reported.csv"), read("trait_data_imputed.csv")


def load_pantheria(raw: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    with (raw / "pantheria" / "PanTHERIA_1-0_WR05_Aug2008.txt").open(encoding="latin-1") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            out[norm_name(r["MSW05_Binomial"])] = {
                "order": r["MSW05_Order"],
                "family": r["MSW05_Family"],
                "mass_g": fnum(r["5-1_AdultBodyMass_g"]),
                "density": fnum(r["21-1_PopulationDensity_n/km2"]),
                "range_km2": fnum(r["26-1_GR_Area_km2"]),
                "longevity_m": fnum(r["17-1_MaxLongevity_m"]),
                "maturity_d": fnum(r["23-1_SexualMaturityAge_d"]),
            }
    return out


# ---------------------------------------------------------------- PBDB


def load_pbdb(raw: Path) -> tuple[list[dict], list[dict]]:
    sp = json.loads((raw / "pbdb" / "mammalia_species.json").read_text())["records"]
    ge = json.loads((raw / "pbdb" / "mammalia_genera.json").read_text())["records"]
    return sp, ge
