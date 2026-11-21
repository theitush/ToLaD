"""IUCN Red List status of every living species (ToLaD#48; the birds and reptiles of data/amniotes, ToLaD#600).

Source: the IUCN Red List of Threatened Species, version 2026-1, as GBIF publishes it (a Darwin Core
checklist, doi:10.15468/0qnb58, CC BY 4.0). Per species: the category (`distribution.txt`
threatStatus), the current assessment's year (its citation, "The IUCN Red List of Threatened Species
2017: ..."), the IUCN taxon id and the assessment id (its URL, iucnredlist.org/species/<taxon>/<assessment>).

A leaf is matched by its own name, then its alt names and Open Tree synonyms, then through the
taxonomies that already bridge IUCN names to ours (PHYLACINE 1.2's synonymy table, IUCN 2016-3 names;
COMBINE's iucn2020 -> PHYLACINE binomial). A living leaf the 2026-1 list does not have takes PHYLACINE
1.2's status (IUCN 2016-3); with neither it is "NE", not evaluated. Fossils get none; a leaf that ended
after 1500 CE keeps the Red List's EX/EW where the list has it, and a leaf that lives in our tree never takes an EX
record (the name is then the lost taxon's, not our species').

The birds and reptiles (amniotes.py) take the same rule through the same Matcher, with no PHYLACINE or COMBINE to
bridge them: their list name (eBird/Clements v2025, the Reptile Database), alt names, Open Tree synonyms, then the Red
List's own synonyms (`synonym_index`), then the gender ending; not listed: NE.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from collections import Counter
from pathlib import Path

from .anchors import DOMESTIC_FORMS
from .load import NA, norm_name
from .tree import Node

ZIP = "redlist/iucn-2026-1.zip"
VERSION = "2026-1"

# RLST category codes (FORMAT.md): 0 = none
CATEGORIES = ["", "LC", "NT", "VU", "EN", "CR", "EW", "EX", "DD", "NE"]
CODE = {c: i for i, c in enumerate(CATEGORIES) if c}
THREAT_STATUS = {
    "least concern": "LC", "near threatened": "NT", "vulnerable": "VU", "endangered": "EN",
    "critically endangered": "CR", "extinct in the wild": "EW", "extinct": "EX", "data deficient": "DD",
    # Lower Risk/conservation dependent, a pre-2001 (version 2.3) category the Red List counts with Near Threatened;
    # only old bird and reptile assessments carry it (Podocnemis expansa, ToLaD#592), no mammal
    "conservation dependent": "NT",
}
# PHYLACINE 1.2 codes that are a Red List category of a living species (EP/EX: extinct, no fallback)
PHYLACINE_LIVING = {"LC", "NT", "VU", "EN", "CR", "EW", "DD"}

# RLST source indices into META.red_list.sources
SRC_IUCN, SRC_PHYLACINE, SRC_NONE = 0, 1, 2
SOURCES = [
    {"key": "iucn-2026-1", "label": f"IUCN Red List {VERSION}", "vintage": 2026,
     "cite": f"IUCN (2026). The IUCN Red List of Threatened Species. Version {VERSION}. "
             "https://www.iucnredlist.org. Accessed via GBIF.org, doi:10.15468/0qnb58",
     "url": "https://doi.org/10.15468/0qnb58", "license": "CC BY 4.0"},
    {"key": "phylacine-1.2", "label": "PHYLACINE 1.2 (IUCN Red List 2016-3)", "vintage": 2016,
     "cite": "Faurby et al. 2018, Ecology 99:2626, PHYLACINE 1.2 trait table, IUCN status from the "
             "IUCN Red List 2016-3",
     "url": "https://github.com/MegaPast2Future/PHYLACINE_1.2", "license": "CC0"},
    {"key": "not-listed", "label": "not on the IUCN Red List", "vintage": 2026,
     "cite": f"Not in the IUCN Red List {VERSION} nor PHYLACINE 1.2 under this name or a known synonym "
             "(a domestic form, a recent split or an unrecognised Open Tree tip): Not Evaluated",
     "url": "", "license": ""},
]

# Names the Red List has re-pointed at a different, extinct taxon after a revision: our tree's leaf is the
# living species of the older concept, so it keeps PHYLACINE 1.2's status (IUCN 2016-3) instead.
REDEFINED = {
    # Burbidge & Woinarski 2026, e.T2790A258665015: B. penicillata is now the extinct south-eastern
    # woylie; the living woylie of the older concept is not under this name in 2026-1
    "Bettongia penicillata",
    # Woinarski et al. 2026, e.T277135776A258656594: the crest-tailed mulgara split into six species
    # (Newman-Martin & Travouillon 2023); the name now holds the extinct one
    "Dasycercus cristicauda",
}

# the lower-case words that start an authority ("Typhlops boettgeri de Witte"), not an infraspecific epithet
AUTHOR_PARTICLES = {"d", "da", "de", "del", "della", "den", "der", "di", "du", "la", "le", "ter", "van", "von"}
YEAR_RE = re.compile(r"The IUCN Red List of Threatened Species (\d{4})")
URL_RE = re.compile(r"/species/(\d+)/(\d+)")


def load_redlist(raw: Path, classes: tuple[str, ...] = ("MAMMALIA",), synonyms: bool = False) -> dict[str, dict]:
    """Binomial -> {category, year, taxon, assessment[, common]} for the checklist's accepted species of `classes` (the
    mammals by default; the amniote build asks for the birds and reptiles, ToLaD#539/#592). `synonyms`: each record
    also carries its class, order and the binomials the checklist gives as its synonyms (authority dropped; no
    trinomials)."""
    out: dict[str, dict] = {}
    with zipfile.ZipFile(raw / ZIP) as z:
        recs: dict[str, dict] = {}
        syn_rows: list[tuple[str, str]] = []
        with z.open("taxon.txt") as f:
            for line in io.TextIOWrapper(f, encoding="utf-8"):
                r = line.rstrip("\n").split("\t")
                if synonyms and len(r) > 13 and r[12] == "synonym":
                    syn_rows.append((r[13], r[1]))
                if len(r) < 16 or r[4] not in classes or r[10] != "species" or r[12] != "accepted":
                    continue
                y = YEAR_RE.search(r[14])
                u = URL_RE.search(r[15])
                recs[r[0]] = {"name": norm_name(f"{r[7]} {r[8]}"), "class": r[4], "order": r[5], "year": int(y.group(1)) if y else 0,
                              "taxon": int(u.group(1)) if u else int(r[0]),
                              "assessment": int(u.group(2)) if u else 0}
        for acc, sci in syn_rows:
            b = _binomial(sci)
            if acc in recs and b:
                recs[acc].setdefault("synonyms", []).append(b)
        with z.open("distribution.txt") as f:
            for line in io.TextIOWrapper(f, encoding="utf-8"):
                r = line.rstrip("\n").split("\t")
                rec = recs.get(r[0])
                if rec is None or len(r) < 6:
                    continue
                cat = THREAT_STATUS.get(r[5].strip().lower())
                if cat is None:
                    raise ValueError(f"unknown Red List status {r[5]!r} for {rec['name']}")
                rec["category"] = cat
        eng = english_names(z, recs)
    keys = ("category", "year", "taxon", "assessment") + (("class", "order", "synonyms") if synonyms else ())
    for tid, rec in recs.items():
        if "category" in rec:
            out[rec["name"]] = {k: rec[k] for k in keys if k in rec}
            if tid in eng:
                out[rec["name"]]["common"] = eng[tid]
    return out


def english_names(z: zipfile.ZipFile, ids) -> dict[str, str]:
    """Red List taxon id (of `ids`) -> its English common name (ToLaD#145): the checklist's preferred English name,
    else its first English one. The one rule for every class the build names from the Red List (mammals, #592 reptiles)."""
    eng: dict[str, tuple[bool, str]] = {}
    with z.open("vernacularname.txt") as f:
        for line in io.TextIOWrapper(f, encoding="utf-8"):
            r = line.rstrip("\n").split("\t")
            if len(r) < 4 or r[0] not in ids or r[1] != "eng" or not r[2].strip():
                continue
            pref = r[3].strip().lower() == "true"
            if r[0] not in eng or (pref and not eng[r[0]][0]):
                eng[r[0]] = (pref, r[2].strip())
    return {k: v[1] for k, v in eng.items()}


def synonym_index(rl: dict[str, dict]) -> dict[str, str]:
    """The Red List's own synonymy (load_redlist(synonyms=True)): a synonym binomial -> the one accepted species it is
    a synonym of. A binomial the checklist gives as a synonym of two species names none."""
    of: dict[str, set[str]] = {}
    for n, r in rl.items():
        for s in r.get("synonyms", ()):
            if s != n:
                of.setdefault(s, set()).add(n)
    return {s: next(iter(ns)) for s, ns in of.items() if len(ns) == 1}


def _binomial(sci: str) -> str | None:
    """A checklist synonym's binomial: 'Ramphotyphlops affinis (Boulenger, 1889)' -> 'Ramphotyphlops affinis'; None for
    a name that is no plain binomial (a trinomial, 'ssp.', 'var.')."""
    w = sci.split()
    if len(w) < 2 or not w[0][:1].isupper() or not w[1].isalpha() or not w[1].islower():
        return None
    if len(w) > 2 and (w[2].islower() and w[2].isalpha() and w[2] not in AUTHOR_PARTICLES
                       or w[2].rstrip(".") in ("ssp", "subsp", "var")):
        return None
    return norm_name(f"{w[0]} {w[1]}")


def _bridges(raw: Path, phy_syn: dict[str, str]) -> dict[str, list[str]]:
    """Our (PHYLACINE 1.2) binomial -> IUCN names it is known under: PHYLACINE's synonymy (IUCN 2016-3
    names among them) and COMBINE's iucn2020_binomial -> phylacine_binomial."""
    rev: dict[str, list[str]] = {}
    for old, new in phy_syn.items():
        rev.setdefault(new, []).append(old)
    with (raw / "combine" / "trait_data_reported.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["phylacine_binomial"] not in NA and r["iucn2020_binomial"] not in NA:
                rev.setdefault(norm_name(r["phylacine_binomial"]), []).append(norm_name(r["iucn2020_binomial"]))
    return rev


def load_all(raw: Path, ctx: dict) -> tuple[dict[str, dict], dict[str, list[str]]]:
    """The Red List and the bridge map, loaded once per build (kept in ctx["red_list_src"])."""
    if "red_list_src" not in ctx:
        ctx["red_list_src"] = (load_redlist(raw), _bridges(raw, ctx["phy_syn"]))
    return ctx["red_list_src"]


def attach(root: Node, raw: Path, ctx: dict, log: dict) -> None:
    """Set n.data["red_list"] = {category, year, source, taxon, assessment, via} on every species leaf
    that has one: every living leaf (NE when no list has it); a leaf that ended since 1500 CE only
    where the Red List lists it."""
    rl, rev = load_all(raw, ctx)
    log["red_list"] = assign(root, rl, rev, ctx)


class Matcher:
    """A leaf's Red List record: by its own name, alt names, Open Tree synonyms, PHYLACINE/COMBINE
    bridges, the Red List's own synonyms (`rl_syn`, synonym_index; the birds and reptiles, ToLaD#600: none for the
    mammals, whose bridges are PHYLACINE's and COMBINE's), then a Latin gender ending. A synonym that is another
    leaf's own name is that leaf's record (Bos taurus is not the aurochs); a name the list re-pointed at another
    taxon (REDEFINED) has none."""

    def __init__(self, root: Node, rl: dict[str, dict], rev: dict[str, list[str]], ctx: dict,
                 rl_syn: dict[str, str] | None = None):
        self.rl, self.rev, self.rl_syn = rl, rev, rl_syn or {}
        self.phy_syn, self.ott_syn = ctx["phy_syn"], ctx.get("ott_syn", {})
        self.leaf_names = {n.name for n in root.preorder() if n.is_leaf and n.name}
        self.variants: dict[tuple[str, str], list[str]] = {}
        for nm in rl:
            g, e = nm.split(" ", 1)
            self.variants.setdefault((g, _stem(e)), []).append(nm)

    def __call__(self, nd: Node) -> tuple[dict | None, str | None]:
        rl, leaf_names = self.rl, self.leaf_names
        if nd.name in REDEFINED or nd.name in DOMESTIC_FORMS:
            return None, None
        cands = [(nd.name, "name")] + [(a, "alt name") for a in nd.alt if a]
        cands += [(norm_name(s), "Open Tree synonym") for s in self.ott_syn.get(nd.ott, [])]
        own = self.phy_syn.get(nd.name, nd.name)
        cands += [(own, "PHYLACINE synonym")] + [(s, "PHYLACINE/COMBINE synonym") for s in self.rev.get(own, [])]
        cands += [(self.rl_syn[a], "Red List synonym") for a in [nd.name, *nd.alt] if a in self.rl_syn]
        for c, how in cands:
            if c in rl and (c == nd.name or c not in leaf_names):
                return rl[c], how if c != nd.name else "name"
        if " " in nd.name:  # Latin gender ending only (Erethizon dorsatus / dorsatum)
            g, e = nd.name.split(" ", 1)
            vs = [v for v in self.variants.get((g, _stem(e)), []) if v not in leaf_names]
            if len(vs) == 1:
                return rl[vs[0]], "spelling variant"
        return None, None


def flag_extinct(root: Node, raw: Path, ctx: dict, log: dict) -> None:
    """ToLaD#105: a living-looking Open Tree leaf that the Red List 2026-1 assesses EX is extinct (it ended
    after 1500 CE, the Red List's window). Runs before dating, so the leaf's band ends at its extinction
    (merge.assign_bands) and the model gives it no alive count."""
    rl, rev = load_all(raw, ctx)
    match = Matcher(root, rl, rev, ctx)
    out = []
    for nd in root.preorder():
        if not nd.is_leaf or not nd.name or nd.kind != "tree" or nd.extinct or nd.data.get("empty_higher"):
            continue
        hit, via = match(nd)
        if hit is not None and hit["category"] == "EX":
            nd.extinct = True
            nd.data["extinct_by"] = f"IUCN Red List {VERSION} EX"
            nd.data["red_list_ex"] = True
            out.append(nd.name)
    log["red_list_extinct_flags"] = {"note": f"Open Tree leaves no other source marks extinct that the IUCN Red "
                                             f"List {VERSION} assesses EX (ToLaD#105)", "leaves": sorted(out)}


def assign(root: Node, rl: dict[str, dict], rev: dict[str, list[str]], ctx: dict) -> dict:
    """attach()'s matching, on a loaded list (`rl`) and bridge map (`rev`); returns the report."""
    by, used, _ = match_all(root, rl, rev, ctx)
    return report(root, rl, by, used)


def match_all(root: Node, rl: dict[str, dict], rev: dict[str, list[str]], ctx: dict,
              rl_syn: dict[str, str] | None = None) -> tuple[Counter, Counter, list[str]]:
    """Every species leaf under `root` its n.data["red_list"] (attach's rule); returns how many matched how, each Red
    List taxon's leaf count, and the living leaves whose match is an EX record not taken (lost_not_ours)."""
    phy, phy_syn = ctx["phy"], ctx["phy_syn"]
    by = Counter()
    used: Counter = Counter()
    lost_not_ours: list[str] = []
    match = Matcher(root, rl, rev, ctx, rl_syn)
    for nd in root.preorder():
        if not nd.is_leaf or not nd.name or nd.kind != "tree":
            continue
        living = nd.t1 == 0
        hit, via = match(nd)
        if hit is not None and living and hit["category"] == "EX":
            # a leaf that lives in our tree, the list's taxon under its name lost: the name is the lost taxon's, not
            # ours (the build marks a leaf the list has EX extinct unless a count today says it lives: Chelonoidis
            # niger is the Floreana tortoise alone on the Red List, ours the counted Galapagos tortoise, ToLaD#592)
            lost_not_ours.append(nd.name)
            hit = None
        if hit is not None and (living or hit["category"] in ("EX", "EW")):
            nd.data["red_list"] = {**hit, "source": SRC_IUCN, "via": via}
            used[(hit["taxon"])] += 1
            by["iucn:" + via] += 1
            continue
        if not living:
            continue
        own = phy_syn.get(nd.name, nd.name)
        p = phy.get(nd.name) or phy.get(own)
        st = p["iucn"] if p else None
        if st in PHYLACINE_LIVING and nd.name not in DOMESTIC_FORMS:
            nd.data["red_list"] = {"category": st, "year": SOURCES[SRC_PHYLACINE]["vintage"], "taxon": 0,
                                   "assessment": 0, "source": SRC_PHYLACINE, "via": "PHYLACINE 1.2"}
            by["phylacine"] += 1
        else:
            nd.data["red_list"] = {"category": "NE", "year": SOURCES[SRC_NONE]["vintage"], "taxon": 0,
                                   "assessment": 0, "source": SRC_NONE, "via": None}
            by["not listed"] += 1
    return by, used, lost_not_ours


def report(root: Node, rl: dict, by: Counter, used: Counter) -> dict:
    living = [n for n in root.preorder() if n.is_leaf and n.kind == "tree" and n.name and n.t1 == 0]
    ended = [n for n in root.preorder() if n.is_leaf and n.t1 > 0 and "red_list" in n.data]
    cats = Counter(n.data["red_list"]["category"] for n in living)
    src = Counter(SOURCES[n.data["red_list"]["source"]]["key"] for n in living)
    felidae = [n for n in living if _under(n, "Felidae")]
    nl = [n.name for n in living if n.data["red_list"]["source"] == SRC_NONE]
    gone = [n.name for n in living if n.data["red_list"]["category"] == "EX"]
    return {
        "note": "IUCN Red List category of every living species leaf (ToLaD#48): the Red List "
                f"{VERSION} (GBIF, doi:10.15468/0qnb58) by name or synonym, else PHYLACINE 1.2 "
                "(IUCN 2016-3), else NE (not evaluated). Fossils none; EX/EW kept for leaves the list has.",
        "living_leaves": len(living),
        "living_by_category": dict(sorted(cats.items())),
        "living_by_source": dict(sorted(src.items())),
        "matched_by": dict(sorted(by.items())),
        "living_in_tree_but_red_list_ex": gone,
        "redefined_names_kept_on_phylacine": sorted(REDEFINED),
        "ended_with_status": {n.name: n.data["red_list"]["category"] for n in ended},
        "felidae_living_by_category": dict(sorted(Counter(n.data["red_list"]["category"] for n in felidae).items())),
        "felidae": {n.name: f"{n.data['red_list']['category']} {n.data['red_list']['year']}" for n in felidae},
        "redlist_mammals": len(rl),
        "redlist_taxa_on_two_leaves": sum(1 for v in used.values() if v > 1),
        "not_listed_examples": nl[::max(1, len(nl) // 15)][:15],
    }


def _stem(e: str) -> str:
    return e[:-2] if e.endswith(("us", "um")) else e[:-1] if e.endswith("a") else e


def _under(n: Node, name: str) -> bool:
    p = n.parent
    while p is not None:
        if p.name == name or name in (p.alt or []):
            return True
        p = p.parent
    return False
