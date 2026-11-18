"""The amniotes (ToLaD#539; research/amniote-sources.md, build order steps 2-5 and 9): a second build output, in the
page's format (FORMAT.md 1.8), with the mammals grafted in exactly as their own build makes them.

    uv run python -I -m tolad_pipeline.amniotes [--raw data/raw] [--out data/amniotes] [--work data/build]

**Topology (rows).** The Open Tree 16.1 synthesis subtree for Amniota (ott229560) without its Mammalia: the
sauropsids. Its extinct tips (OTT `extinct`/`extinct_inherited`) are taxonomy-placed, so they go (the fossils come
from PBDB in step 6), unless a living-species list carries them. A tip stays only when a list knows it: birds the
eBird/Clements v2025 checklist (the AvesData 1.7 tip set), joined by OTT id through AvesData's crosswalk, else by
name; reptiles the Reptile Database 2026-10, by name or OTT 3.7.3 synonym. A listed species Open Tree lacks goes onto
its genus (the mechanism mdd.py uses for MDD species). A species stands once: a second tip matching it goes.

The synthesis has two faults (research/amniote-sources.md, "The join"):
1. Archosauria, Crocodylia and Dinosauria are "broken" taxa, with no node. Rule: with the extinct tips gone, an
   unnamed node whose tips are exactly an OTT taxon's tips in the tree takes that taxon's name (`name_by_taxonomy`).
   The dated tree names its group crowns and backbone splits itself.
2. An 85-tip clade of non-avian dinosaurs sits beside Lepidosauria. Rule: it is all extinct tips, so the extinct-tip
   rule drops it; nothing non-avian of Dinosauria survives (stats.json -> amniotes.faults checks it).

**Mammals:** the mammal build's own merged tree and dated tree (build.build_mammals), unchanged, as Amniota's
other daughter.

**Dates.** Each group's own dated tree, over the species matched to its tips: birds AvesData 1.7's summary dated tree
(McTavish et al. 2025; tips are Clements names), squamates Title et al. 2024, turtles and crocodilians Colston et al.
2020 (posterior tree 1). The tuatara is one species. Above them, the five backbone splits of `pipeline/amniotes.toml`
(TimeTree 5), each kept older than every split and fossil below it. The rows' Open Tree nodes take the age of a
concordant dated split (merge.calibrate's rule) and are interpolated elsewhere (merge.date_tree). A listed species no
dated tree has joins the dated crown of its genus-mates (`loose`; one mate: a new split halfway down its branch),
else its family's, else its group's.

**Counts (step 9).** Mammals as their build counts them. Birds: Callaghan et al. 2021's global abundance estimate
and its 95% interval, graded from the interval, no better than C except for its 684 training species (independent
estimates). Every reptile, and every bird Callaghan lacks: count unknown (FLAG bit 11), drawn at the thinnest a
living species is (the smallest count of any other living species). No source yet gives a bird or reptile
generation length, so births use an assumed one (`ASSUMED_GEN_YR`, the page's own fallback) and say so.
Histories, ranges, natural baselines, Red List status and traits stay "none" until their steps.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
import tomllib
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from . import build, dated, fossils, tiles
from .dated import EPS, SRC_NAMES, S_INTERP, DNode
from .merge import LAD_RECENT_EX, _mrca, assign_bands, date_tree
from .model import SRC, grade_from_sd, lognormal_sum, profile_edges
from .newick import NNode, parse_comment, parse_newick, parse_nexus_tree
from .overrides import Overrides
from .tree import BINOMIAL, D_UPHAM, Node, clean_opentree, collapse_knuckles, from_opentree

OTT_AMNIOTA, OTT_MAMMALIA = 229560, 244265
OTT_LABEL = re.compile(r"^(.*?)[ _]ott(\d+)$")
HOMONYM = re.compile(r"^(.+?) \((?:[a-z]+ )?(?:in|class|order|genus|family|kingdom|phylum)\b.*\)$")
GROUPS = ("Aves", "Squamata", "Testudines", "Crocodylia", "Rhynchocephalia")
RDB_GROUP = {"Sauria": "Squamata", "Serpentes": "Squamata", "Testudines": "Testudines", "Crocodylia": "Crocodylia",
             "Rhynchocephalia": "Rhynchocephalia"}
EXTINCT_FLAGS = {"extinct", "extinct_inherited"}

# The one place a bird's or reptile's generation length comes from until step 7 (Bird et al. 2020 for birds, a
# mass-based estimate from ReptTraits for reptiles): the page's own fallback for a species with none
# (web/src/fan/panthera.ts speciesRec, "assumed"). Births = alive / (G / 2), as the mammal model's lifespan.
ASSUMED_GEN_YR = 7.0
ASSUMED_GEN_NOTE = (f"births: alive / (G/2), G = {ASSUMED_GEN_YR:g} yr assumed (no bird or reptile generation length "
                    f"yet; the page's own fallback)")

# the dated tree's split sources, after the mammal build's (dated.SRC_NAMES keeps its indices)
AMNIOTE_SRC = ["avesdata", "title2024", "colston2020", "timetree"]
S_AVES, S_TITLE, S_COLSTON, S_TIMETREE = (len(SRC_NAMES) + i for i in range(len(AMNIOTE_SRC)))
CITES = {
    "clements": "Clements, J.F. et al. (2025). The eBird/Clements checklist of Birds of the World: v2025 (via "
                "AvesData 1.7's crosswalk); CC BY 4.0",
    "avesdata": "McTavish, E.J. et al. (2025). A complete and dynamic tree of birds. PNAS 122: e2409658122. "
                "AvesData 1.7, summary dated tree over the Clements 2025 species (doi:10.5281/zenodo.15226127); CC BY 4.0",
    "rdb": "Uetz, P., Freed, P., Aguilar, R. et al. (eds.) The Reptile Database, checklist 2026-10 "
           "(reptile-database.org)",
    "title2024": "Title, P.O., Singhal, S., Grundler, M.C. et al. (2024). The macroevolutionary singularity of "
                 "snakes. Science 383: 918-923. Time-calibrated (ultrametric, constrained) squamate tree; CC0",
    "colston2020": "Colston, T.J., Kulkarni, P., Jetz, W. & Pyron, R.A. (2020). Phylogenetic and spatial "
                   "distribution of evolutionary diversification, isolation, and threat in turtles and "
                   "crocodilians (non-avian archosauromorphs). BMC Evol. Biol. 20: 81. PASTIS posterior tree 1; CC0",
    "callaghan2021": "Callaghan, C.T., Nakagawa, S. & Cornwell, W.K. (2021). Global abundance estimates for 9,700 "
                     "bird species. PNAS 118: e2023170118 (Zenodo 4723365); CC BY 4.0",
    "timetree": "Kumar, S., Suleski, M., Craig, J.M. et al. (2022). TimeTree 5. Mol. Biol. Evol. 39: msac174",
}
METHOD_UNKNOWN = ("N:unknown: no count of this species exists in our sources ({why}); drawn at the thinnest a living "
                  "species is ({n:.3g}, {who}), a width, not a figure")


def log_step(t0: float, msg: str) -> None:
    print(f"[{time.time() - t0:6.1f}s] {msg}", file=sys.stderr)


# ------------------------------------------------------------------ inputs


def load_ott_cut(raw: Path):
    """The OTT 3.7.3 Amniota cut (ott_amniota.py): uid -> {parent, name, rank, flags, group}; uid -> synonyms; and a
    binomial -> uids index over species names and binomial synonyms."""
    tax: dict[int, dict] = {}
    with (raw / "amniotes" / "ott" / "amniota_taxonomy.tsv").open(encoding="utf-8") as f:
        next(f)
        for line in f:
            p = line.rstrip("\n").split("\t")
            tax[int(p[0])] = {"parent": int(p[1]) if p[1] else None, "name": p[2], "rank": p[3],
                              "flags": {x for x in p[4].split(",") if x}, "group": p[5]}
    syn: dict[int, list[str]] = defaultdict(list)
    uids: dict[str, set[int]] = defaultdict(set)
    for uid, t in tax.items():
        if t["rank"] == "species":
            uids[t["name"]].add(uid)
    with (raw / "amniotes" / "ott" / "amniota_synonyms.tsv").open(encoding="utf-8") as f:
        next(f)
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) < 2 or not p[1].isdigit():
                continue
            syn[int(p[1])].append(p[0])
            if BINOMIAL.match(p[0]):
                uids[p[0]].add(int(p[1]))
    return tax, syn, uids


def load_ot(raw: Path) -> NNode:
    d = json.loads((raw / "amniotes" / "opentree" / "amniota_subtree.json").read_text())
    root = parse_newick(d["newick"])
    for nd in root.iter_preorder():
        lab = (nd.label or "").strip("'")
        m = OTT_LABEL.match(lab)
        nd.ott, nd.name = (int(m.group(2)), m.group(1).replace("_", " ").strip()) if m else (None, None)
    return root


def _family(s: str) -> str:
    return s.split(" (", 1)[0].strip()


def load_clements(raw: Path) -> dict[str, dict]:
    """The Clements 2025 species, from AvesData 1.7's crosswalk: name -> {ott, order, family, common}."""
    out = {}
    with (raw / "amniotes" / "avesdata" / "OTT_crosswalk_2025.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["CATEGORY"] != "species":
                continue
            out[r["SCI_NAME"].strip()] = {"ott": int(r["ott_id"]) if r["ott_id"].isdigit() else None, "group": "Aves",
                                          "order": r["ORDER"], "family": _family(r["FAMILY"]),
                                          "common": r["PRIMARY_COM_NAME"].strip() or None, "list": "clements"}
    return out


def load_rdb(raw: Path) -> tuple[dict[str, dict], list[str]]:
    """The Reptile Database checklist 2026-10: name -> {group, order, family}; and the names with no order."""
    import openpyxl
    ws = openpyxl.load_workbook(raw / "amniotes" / "reptiledb" / "reptile_checklist_2026_10.xlsx",
                                read_only=True).worksheets[0]
    out, no_order = {}, []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r[1]:
            continue
        name = " ".join(str(r[1]).split())
        g = RDB_GROUP.get(r[4])
        if g is None:
            no_order.append(name)
            continue
        out[name] = {"ott": None, "group": g, "order": r[4], "family": r[5], "common": None, "list": "rdb"}
    return out, no_order


def load_lost(raw: Path) -> dict[str, set[str]]:
    """The birds and reptiles lost since 1500 CE: IOC 15.2's species marked extinct (a dagger, or two: known from
    subfossils), and the Red List 2026-1's Extinct (the GBIF copy the mammal build pins; Extinct in the Wild lives on,
    in captivity). Neither gives a year."""
    import io
    import zipfile

    import openpyxl
    ioc = set()
    ws = openpyxl.load_workbook(raw / "amniotes" / "ioc" / "IOC_Names_File_Plus-15.2.xlsx", read_only=True).worksheets[0]
    for r in ws.iter_rows(min_row=4, values_only=True):
        if r[4] == "Species" and r[5] and "\u2020" in str(r[5]) and r[7]:
            ioc.add(" ".join(str(r[7]).split()))
    rl, ids = set(), {}
    with zipfile.ZipFile(raw / "redlist" / "iucn-2026-1.zip") as z:
        with z.open("taxon.txt") as f:
            for line in io.TextIOWrapper(f, encoding="utf-8"):
                p = line.rstrip("\n").split("\t")
                if len(p) > 10 and p[4] in ("AVES", "REPTILIA") and p[10] == "species":
                    ids[p[0]] = f"{p[7]} {p[8]}"
        with z.open("distribution.txt") as f:
            for line in io.TextIOWrapper(f, encoding="utf-8"):
                p = line.rstrip("\n").split("\t")
                if p[0] in ids and len(p) > 5 and p[5] == "Extinct":
                    rl.add(ids[p[0]])
    return {"IOC 15.2 dagger": ioc, "Red List 2026-1 EX": rl}


def load_callaghan(raw: Path) -> dict[str, dict]:
    out = {}
    with (raw / "amniotes" / "callaghan2021" / "all_species_summary_table.csv").open(encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                n = float(r["Abundance estimate"])
            except ValueError:
                continue
            lo, hi = (float(r[k]) if r[k] not in ("", "NA") else None for k in ("95% Lower CI", "95% Upper CI"))
            out[r["Scientific name"].strip()] = {"N": n, "lo": lo, "hi": hi,
                                                 "training": r["Training species"].strip().upper() == "TRUE"}
    return out


def _tips(t: NNode) -> list[NNode]:
    return [n for n in t.iter_preorder() if not n.children]


def heights(t: NNode) -> None:
    """Each node's height (Ma) from its branch lengths, and a 95% interval where the file gives one."""
    for n in t.iter_postorder():
        n.height = max((c.height + (c.length or 0.0) for c in n.children), default=0.0)
        kv = parse_comment(n.comment)
        hpd = kv.get("age_95%_HPD") or kv.get("height_95%_HPD")
        n.hpd = None
        if hpd and n.children:
            try:
                lo, hi = (float(x) for x in hpd.strip("{}").split(","))
                n.hpd = (lo, hi)
            except ValueError:
                pass


def load_dated(raw: Path) -> dict[str, NNode]:
    A = raw / "amniotes"
    out = {"avesdata": parse_nexus_tree((A / "avesdata" / "summary_dated_clements.nex").read_text()),
           "title2024": parse_newick((A / "title2024" / "squamates_Title_Science2024_ultrametric_constrained.tre")
                                     .read_text().strip()),
           "colston2020": parse_newick((A / "colston2020" / "colston2020_pastis_tree1.tre").read_text().strip())}
    for t in out.values():
        heights(t)
        for n in _tips(t):
            n.name = (n.label or "").strip("'").replace("_", " ").strip()
    return out


# ------------------------------------------------------------------ rows: the sauropsid Open Tree


class Lists:
    """The living-species lists and the ways a name reaches them."""

    def __init__(self, birds: dict, reptiles: dict, syn: dict[int, list[str]], uids: dict[str, set[int]]):
        self.sp = {**reptiles, **birds}
        self.by_ott = {r["ott"]: n for n, r in birds.items() if r["ott"]}
        self.syn, self.uids = syn, uids
        # a list name's OTT uids (its own species uid, or a uid it is a synonym of)
        self.name_of_uid: dict[int, set[str]] = defaultdict(set)
        for n, r in self.sp.items():
            for u in ([r["ott"]] if r["ott"] else []) + sorted(uids.get(n, ())):
                self.name_of_uid[u].add(n)

    def match(self, nd: Node) -> tuple[str | None, str]:
        """The list species a tip is, and how: 'ott' (the crosswalk's id), 'name', 'synonym'."""
        if nd.ott in self.by_ott:
            return self.by_ott[nd.ott], "ott"
        for nm in [nd.name, *nd.alt]:
            if nm in self.sp:
                return nm, "name"
        hits = set(self.name_of_uid.get(nd.ott, ()))
        for s in self.syn.get(nd.ott, ()):
            if s in self.sp:
                hits.add(s)
        if len(hits) == 1:
            return hits.pop(), "synonym"
        return None, "ambiguous" if hits else "none"


def detach(nd: Node) -> None:
    nd.parent.children.remove(nd)
    nd.parent = None


def sauropsid_rows(nroot: NNode, tax: dict, lists: Lists, log: dict, counted: set[str] = frozenset(),
                   lost: dict[str, set[str]] | None = None) -> tuple[Node, dict]:
    lost = lost or {}
    root = from_opentree(nroot, tax)
    mam = [n for n in root.preorder() if n.ott == OTT_MAMMALIA]
    assert len(mam) == 1, "no single Mammalia node in the Open Tree Amniota subtree"
    detach(mam[0])
    group = lambda n: tax.get(n.ott, {}).get("group", "") if n.ott else ""  # noqa: E731
    n_tips = Counter(group(n) or "(no OTT group)" for n in root.preorder() if n.is_leaf)
    # 1. the extinct tips (taxonomy-placed; their fossils come from PBDB in step 6), unless a list carries them
    dropped_ext: Counter = Counter()
    kept_listed_ext = []
    for n in list(root.postorder()):
        if n is root or n.parent is None or not n.is_leaf:  # (or detached already, as an emptied parent)
            continue
        if EXTINCT_FLAGS & n.data.get("ott_flags", set()):
            sp, _ = lists.match(n)
            if sp is not None:  # (a list's recently extinct species; extinct below if OTT flags the species itself)
                kept_listed_ext.append(sp)
                continue
            dropped_ext[group(n) or "(no OTT group)"] += 1
            p = n.parent
            detach(n)
            while p is not root and not p.children and EXTINCT_FLAGS & p.data.get("ott_flags", set()):
                q = p.parent
                detach(p)
                p = q
    # (fault 2: the non-avian dinosaurs beside Lepidosauria are extinct tips; fault 1 is fixed by name_by_taxonomy)
    clean_opentree(root, log.setdefault("opentree", {}))
    # 2. only listed species; a species once
    seen: dict[str, Node] = {}
    how: Counter = Counter()
    unlisted: Counter = Counter()
    dup: list[str] = []
    extinct: list[str] = []
    lost_unflagged: list[str] = []
    ott_only: list[str] = []
    counted_ext: list[str] = []
    for n in list(root.preorder()):
        if not n.is_leaf or n is root or n.data.get("empty_higher"):
            continue
        sp, h = lists.match(n)
        if sp is None:
            unlisted[(group(n) or "(no OTT group)") + (": two list names" if h == "ambiguous" else "")] += 1
            detach(n)
            continue
        if sp in seen:
            dup.append(sp)
            detach(n)
            continue
        seen[sp] = n
        how[h] += 1
        if "extinct" in n.data.get("ott_flags", set()) and sp in counted:
            counted_ext.append(sp)  # a count today says it lives (OTT flags the silver gull extinct)
        elif sp not in counted and any(sp in names or n.name in names for names in lost.values()):
            # A list species IOC 15.2 marks extinct (a dagger) or the Red List 2026-1 assesses Extinct, and no count
            # today has: lost since 1500 CE (Raphus cucullatus, Aplonis fusca, the great auk). With no year in either
            # source, it ends a century ago (merge's rule for the Red List's EX, `red_list_ex`). OTT flags most of
            # them extinct itself (not by inheritance: Acratosaura mentalis is "extinct_inherited" and alive).
            n.extinct = True
            n.lad = LAD_RECENT_EX
            n.data.update(lad_default=True, red_list_ex=True,
                          lost_since_1500=[w for w, names in lost.items() if sp in names or n.name in names])
            (extinct if "extinct" in n.data.get("ott_flags", set()) else lost_unflagged).append(sp)
        elif "extinct" in n.data.get("ott_flags", set()):
            # OTT alone calls it extinct: the list carries it as a living species and neither IOC nor the Red List
            # says it is lost (Podocnemis expansa, Farancia abacura): it lives
            ott_only.append(sp)
        r = lists.sp[sp]
        if n.name != sp:
            n.alt.insert(0, n.name)
            n.name = sp
        n.rank = "species"
        n.data.update(group=r["group"], list=r["list"], family=r["family"], order=r["order"])
        if r["common"]:
            n.data["common_list"] = r["common"]
    # 3. listed species Open Tree lacks: onto their genus
    grafted, skipped = graft_on_genus(root, lists, seen, tax)
    n_drop = 0  # what is left of the higher taxa whose species all went: leaves that are no listed species
    changed = True
    while changed:
        changed = False
        for n in list(root.postorder()):
            if n is not root and n.parent is not None and n.is_leaf and "list" not in n.data:
                detach(n)
                n_drop += 1
                changed = True
    above = []
    while len(root.children) == 1 and not root.children[0].is_leaf:  # Amniota without Mammalia: Sauropsida
        above.insert(0, root.name)
        root = root.children[0]
        root.parent = None
    root.alt.extend(a for a in above if a and a != "Amniota")
    left = [n for n in root.preorder() if n.is_leaf]
    by_group = Counter(n.data.get("group") for n in left)
    log["rows"] = {
        "opentree_tips_without_mammalia": dict(n_tips.most_common()),
        "extinct_tips_dropped": dict(dropped_ext.most_common()),
        "extinct_flagged_but_listed_kept": {"n": len(kept_listed_ext), "names": sorted(kept_listed_ext)},
        "listed_but_extinct": {"n": len(extinct), "by_group": dict(Counter(seen[x].data["group"] for x in extinct)),
                               "names": sorted(extinct),
                               "lost_since_1500": {w: sum(1 for x in extinct if w in seen[x].data.get("lost_since_1500", ()))
                                                   for w in lost}},
        "ott_extinct_but_living_on_the_lists": {"n": len(ott_only), "names": sorted(ott_only)},
        "lost_since_1500_not_flagged_by_ott": {"n": len(lost_unflagged),
                                               "by_group": dict(Counter(seen[x].data["group"] for x in lost_unflagged)),
                                               "names": sorted(lost_unflagged)},
        "ott_extinct_but_counted_today": sorted(counted_ext),
        "unlisted_tips_dropped": dict(unlisted.most_common()),
        "duplicate_tips_dropped": {"n": len(dup), "names": sorted(dup)},
        "matched_by": dict(how), "grafted_on_genus": grafted, "not_placed": skipped,
        "emptied_higher_taxa_dropped": n_drop, "species_by_group": dict(by_group.most_common()),
        "listed": {g: sum(1 for r in lists.sp.values() if r["group"] == g) for g in GROUPS},
    }
    return root, seen


def _tight(m: Node, k: int) -> bool:
    return sum(1 for x in m.preorder() if x.is_leaf) <= 3 * k + 2


def graft_on_genus(root: Node, lists: Lists, seen: dict[str, Node], tax: dict) -> tuple[dict, dict]:
    """Each listed species no tip matched goes onto its genus (mdd.graft's mechanism): the common ancestor of its
    genus-mates when that is tight; one mate: a new split above it; else Open Tree's genus node; else a new genus
    node under the common ancestor of its family-mates (then its group's)."""
    mates: dict[tuple[str, str], list[Node]] = defaultdict(list)
    for sp, nd in seen.items():
        r = lists.sp[sp]
        mates[("genus", sp.split()[0])].append(nd)
        mates[("family", r["family"])].append(nd)
        mates[("group", r["group"])].append(nd)
    genus_nodes: dict[str, list[Node]] = defaultdict(list)
    for n in root.preorder():
        if n.name and n.rank == "genus":
            genus_nodes[n.name].append(n)
    target: dict[str, tuple[Node, str]] = {}

    def place(sp: str):
        g = sp.split()[0]
        if g in target:
            return target[g]
        r = lists.sp[sp]
        ms = mates.get(("genus", g), [])
        out = None
        if len(ms) == 1:
            leaf = ms[0]
            w = Node(name=None, rank="no rank", kind="tree", taxonomic=True)
            w.data["created_from"] = r["list"]
            par = leaf.parent
            par.children[par.children.index(leaf)] = w
            w.parent = par
            w.add(leaf)
            out = (w, "a new split above its one genus-mate")
        elif ms:
            m = _mrca(ms)
            if m is not None and m is not root and _tight(m, len(ms)):
                out = (m, "the common ancestor of its genus-mates")
        if out is None:
            gn = [x for x in genus_nodes.get(g, []) if tax.get(x.ott, {}).get("group") in (r["group"], "", None)]
            if gn:
                out = (gn[0], "Open Tree's genus node")
                gn[0].data.pop("empty_higher", None)
        if out is None:
            for rank in ("family", "group"):
                ms = mates.get((rank, r[rank]), [])
                m = _mrca(ms) if ms else None
                if m is not None and m.is_leaf:
                    m = m.parent
                if m is not None and m is not root:
                    gnode = Node(name=g, rank="genus", kind="tree", taxonomic=True)
                    gnode.data["created_from"] = r["list"]
                    m.add(gnode)
                    out = (gnode, f"a new genus under the common ancestor of its {rank}-mates")
                    break
        if out is not None:
            target[g] = out
        return out

    placed: Counter = Counter()
    by_group: Counter = Counter()
    skipped: dict[str, list[str]] = defaultdict(list)
    names = {n.name for n in root.preorder() if n.name}
    for sp in sorted(lists.sp):
        if sp in seen:
            continue
        if sp in names:
            skipped["the name is a higher taxon in Open Tree"].append(sp)
            continue
        t = place(sp)
        if t is None:
            skipped["no genus, family or group mate in the tree"].append(sp)
            continue
        node, where = t
        r = lists.sp[sp]
        leaf = Node(name=sp, rank="species", kind="tree", taxonomic=True)
        u = r["ott"] or (next(iter(lists.uids[sp])) if len(lists.uids.get(sp, ())) == 1 else None)
        leaf.ott = u
        leaf.data.update(group=r["group"], list=r["list"], family=r["family"], order=r["order"], list_graft=True)
        if r["common"]:
            leaf.data["common_list"] = r["common"]
        node.add(leaf)
        seen[sp] = leaf
        placed[where] += 1
        by_group[r["group"]] += 1
    return ({"n": sum(placed.values()), "by_group": dict(by_group), "on": dict(placed)},
            {k: {"n": len(v), "names": v} for k, v in skipped.items()})


def name_by_taxonomy(root: Node, tax: dict, log: dict) -> None:
    """Fault 1 (broken taxa): an unnamed node whose tips are exactly an OTT taxon's tips in the tree takes the
    taxon's name, if no other node has it. A homonym note in an Open Tree label goes (`Squamata (order in ...)`)."""
    chain_c: dict[int, list[int]] = {}

    def chain(u: int) -> list[int]:
        if u in chain_c:
            return chain_c[u]
        out, x = [], u
        while x is not None and x in tax and x not in out:
            out.append(x)
            p = tax[x]["parent"]
            x = None if p == x else p
        chain_c[u] = out
        return out

    under: Counter = Counter()
    for n in root.preorder():
        if n.is_leaf and n.ott in tax:
            for a in chain(n.ott):
                under[a] += 1
    used = {n.name for n in root.preorder() if n.name}
    lca: dict[int, int | None] = {}
    cnt: dict[int, int] = {}
    named, renamed = [], []
    for n in root.postorder():
        if n.is_leaf:
            lca[id(n)] = n.ott if n.ott in tax else None
            cnt[id(n)] = 1 if n.ott in tax else 0
            continue
        a = None
        for c in n.children:
            b = lca[id(c)]
            if b is None:
                continue
            if a is None:
                a = b
            else:
                sb = set(chain(b))
                a = next((x for x in chain(a) if x in sb), None)
                if a is None:
                    break
        lca[id(n)] = a
        cnt[id(n)] = sum(cnt[id(c)] for c in n.children)
        if n.name:
            m = HOMONYM.match(n.name)
            if m and m.group(1) not in used:
                renamed.append((n.name, m.group(1)))
                n.alt.append(n.name)
                n.name = m.group(1)
                used.add(n.name)
            continue
        if a is not None and cnt[id(n)] >= 2 and under[a] == cnt[id(n)] and tax[a]["rank"] != "species":
            nm = tax[a]["name"]
            if nm not in used:
                n.name, n.ott, n.rank = nm, a, tax[a]["rank"]
                used.add(nm)
                named.append(nm)
    left = Counter(tax.get(n.ott, {}).get("group") or "(no OTT row)" for n in root.preorder() if n.is_leaf)
    lep = [n for n in root.preorder() if n.name == "Lepidosauria" or "Lepidosauria" in n.alt]
    log["faults"] = {"tips_left_by_ott_group": dict(left.most_common()),
                     "lepidosauria_tips_by_group": dict(Counter(x.data.get("group") for x in lep[0].preorder()
                                                                if x.is_leaf)) if lep else None,
                     "named_by_taxonomy": {"n": len(named), "names": sorted(named)},
                     "homonym_notes_dropped": renamed}


# ------------------------------------------------------------------ the dated tree


def group_crown(t: NNode, leaf_of: dict[int, Node], group: str) -> NNode | None:
    tips = [n for n in _tips(t) if id(n) in leaf_of and leaf_of[id(n)].data.get("group") == group]
    if not tips:
        return None
    paths = []
    for x in tips:
        p = []
        while x is not None:
            p.append(x)
            x = x.parent
        paths.append(p[::-1])
    m = None
    for level in zip(*paths):
        if all(y is level[0] for y in level):
            m = level[0]
        else:
            break
    return m


def to_dnodes(top: NNode, leaf_of: dict[int, Node], group: str, src: int, used: set[int]) -> tuple[DNode | None, dict]:
    """The dated subtree under `top` over its tips matched to this group's rows (a row once), unary splits collapsed."""
    rep = Counter()
    built: dict[int, DNode | None] = {}
    for n in top.iter_postorder():
        if not n.children:
            L = leaf_of.get(id(n))
            if L is None:
                rep["tips not on a list or not in the rows"] += 1
                built[id(n)] = None
            elif L.data.get("group") != group:
                rep[f"tips of another group ({L.data.get('group')})"] += 1
                built[id(n)] = None
            elif id(L) in used:
                rep["a second tip for one species"] += 1
                built[id(n)] = None
            else:
                used.add(id(L))
                d = DNode(age=0.0, lo=0.0, hi=0.0, src=src, leaf=L)
                L.data["dleaf"] = d
                built[id(n)] = d
                rep["species"] += 1
            continue
        ks = [built[id(c)] for c in n.children if built[id(c)] is not None]
        if not ks:
            built[id(n)] = None
        elif len(ks) == 1:
            built[id(n)] = ks[0]
        else:
            lo, hi = n.hpd if n.hpd else (n.height, n.height)
            d = DNode(age=n.height, lo=min(lo, n.height), hi=max(hi, n.height), src=src)
            for k in ks:
                d.add(k)
            built[id(n)] = d
    return built[id(top)], dict(rep)


def match_tips(t: NNode, rows_by_name: dict[str, Node], lists: Lists) -> dict[int, Node]:
    """A dated tree's tips -> rows leaves: by name, else through the list's OTT synonyms (one species only)."""
    out = {}
    for n in _tips(t):
        L = rows_by_name.get(n.name)
        if L is None:
            hits = {x for u in lists.uids.get(n.name, ()) for x in lists.name_of_uid.get(u, ())}
            hits = {h for h in hits if h in rows_by_name}
            if len(hits) == 1:
                L = rows_by_name[hits.pop()]
        if L is not None:
            out[id(n)] = L
    return out


def load_backbone(path: Path) -> list[dict]:
    return tomllib.loads(path.read_text())["dated_clade"]


def sauropsid_dated(rows: Node, trees: dict[str, NNode], lists: Lists, backbone: list[dict], notes0: int,
                    log: dict) -> tuple[dict[str, DNode], dict]:
    """The group crowns (DNodes over the rows' species) and the backbone splits above them, up to Sauria."""
    by_name = {n.name: n for n in rows.preorder() if n.is_leaf}
    used: set[int] = set()
    crowns: dict[str, DNode] = {}
    rep = {}
    for g, key, src in (("Aves", "avesdata", S_AVES), ("Squamata", "title2024", S_TITLE),
                        ("Testudines", "colston2020", S_COLSTON), ("Crocodylia", "colston2020", S_COLSTON),
                        ("Rhynchocephalia", "colston2020", S_COLSTON)):
        t = trees[key]
        leaf_of = match_tips(t, by_name, lists)
        top = group_crown(t, leaf_of, g)
        if top is None:
            rep[g] = {"source": key, "species": 0}
            continue
        d, r = to_dnodes(top, leaf_of, g, src, used)
        crowns[g] = d
        n_rows = sum(1 for n in by_name.values() if n.data.get("group") == g)
        rep[g] = {"source": key, **r, "rows": n_rows, "crown_Ma": round(d.age, 2),
                  "source_tips_under_crown": sum(1 for _ in _tips(top))}
    # the backbone (amniotes.toml): each split older than every split below it (the fossils inside raise it later:
    # fossils.backbone_minima). Its upper bound for a fossil inside it (fossils.py): Benton's soft maximum, else its
    # TimeTree interval.
    bb = {}
    pending = {e["name"]: e for e in backbone if e["name"] != "Amniota"}
    while pending:
        ready = [e for e in pending.values() if all(b in crowns for b in e["between"])]
        if not ready:
            raise RuntimeError(f"backbone splits with no daughters: {sorted(pending)}")
        for e in ready:
            kids = [crowns[b] for b in e["between"]]
            floor = max(k.age for k in kids) + EPS
            age = max(float(e["age"]), floor)
            d = DNode(age=age, lo=min(float(e["lo"]), age), hi=max(float(e["hi"]), age), src=S_TIMETREE,
                      name=e["name"], note=notes0 + [x["name"] for x in backbone].index(e["name"]))
            d.bound = float(e.get("soft_max", e["hi"]))
            for k in kids:
                d.add(k)
            crowns[e["name"]] = d
            bb[e["name"]] = {"cited": e["age"], "age": round(age, 3), "raised_by": "the splits below it"
                             if age > float(e["age"]) else None, "between": e["between"]}
            del pending[e["name"]]
    for g in GROUPS:
        if g in crowns and crowns[g].leaf is None:
            crowns[g].name = g
    log["dated"] = {"groups": rep, "backbone": bb}
    return crowns, rep


def calibrate_rows(rows: Node, droot: DNode, log: dict) -> None:
    """merge.calibrate's rule on the dated tree's DNodes: an Open Tree node takes the age (and interval) of the
    dated split over exactly its matched species. Only phylogeny-placed tips count (call before the grafts)."""
    dep: dict[int, int] = {}
    for d in droot.preorder():
        dep[id(d)] = 0 if d.parent is None else dep[id(d.parent)] + 1
    nmatch: dict[int, int] = defaultdict(int)
    for d in droot.preorder():
        if d.leaf is not None:
            p = d
            while p is not None:
                nmatch[id(p)] += 1
                p = p.parent

    def lca(a: DNode, b: DNode) -> DNode:
        while dep[id(a)] > dep[id(b)]:
            a = a.parent
        while dep[id(b)] > dep[id(a)]:
            b = b.parent
        while a is not b:
            a, b = a.parent, b.parent
        return a

    m_of: dict[int, DNode | None] = {}
    k_of: dict[int, int] = {}
    n_cal = n_int = 0
    for nd in rows.postorder():
        if nd.is_leaf:
            d = nd.data.get("dleaf")
            m_of[id(nd)], k_of[id(nd)] = d, (1 if d is not None else 0)
            continue
        m, k = None, 0
        for c in nd.children:
            if m_of[id(c)] is None:
                continue
            k += k_of[id(c)]
            m = m_of[id(c)] if m is None else lca(m, m_of[id(c)])
        m_of[id(nd)], k_of[id(nd)] = m, k
        if m is not None and k >= 2 and nmatch[id(m)] == k and m.leaf is None:
            nd.age = m.age
            nd.date_src = D_UPHAM  # (code 0: calibrated on a dated tree; FORMAT.md's label says Upham, the mammals')
            nd.data["age_hpd"] = (m.lo, getattr(m, "bound", None) or m.hi)
            nd.data["dated_src"] = m.src
            n_cal += 1
        else:
            n_int += 1
    log["dating"] = {"calibrated_nodes": n_cal, "uncalibrated_internal": n_int}


def graft_dated(rows: Node, droot: DNode, lists: Lists, log: dict) -> None:
    """A listed species no dated tree has joins the dated crown of its genus-mates (dated.build's rule for MDD
    species): `loose`; with one mate, a new split halfway down that mate's branch, shared by its congeners. No
    genus-mate: its family's crown, else its group's."""
    dep: dict[int, int] = {}
    for d in droot.preorder():
        dep[id(d)] = 0 if d.parent is None else dep[id(d.parent)] + 1
    n_liv: dict[int, int] = defaultdict(int)
    mates: dict[tuple[str, str], list[DNode]] = defaultdict(list)
    for d in droot.preorder():
        if d.leaf is None:
            continue
        p = d
        while p is not None:
            n_liv[id(p)] += 1
            p = p.parent
        L = d.leaf
        mates[("genus", L.name.split()[0])].append(d)
        mates[("family", L.data.get("family"))].append(d)
        mates[("group", L.data.get("group"))].append(d)

    def lca(a: DNode, b: DNode) -> DNode:
        while dep[id(a)] > dep[id(b)]:
            a = a.parent
        while dep[id(b)] > dep[id(a)]:
            b = b.parent
        while a is not b:
            a, b = a.parent, b.parent
        return a

    def crown(ds: list[DNode]) -> DNode:
        A = ds[0]
        for d in ds[1:]:
            A = lca(A, d)
        if len(ds) > 1 and n_liv[id(A)] > 3 * len(ds) + 2:  # a loose crown: the smallest split holding most of them
            under: Counter = Counter()
            at: dict[int, DNode] = {}
            for d in ds:
                p = d
                while p is not None:
                    under[id(p)] += 1
                    at[id(p)] = p
                    p = p.parent
            A = min((at[i] for i, c in under.items() if 2 * c > len(ds)), key=lambda x: n_liv[id(x)])
        return A

    split_of: dict[int, DNode] = {}
    at_rank: Counter = Counter()
    by_group: Counter = Counter()
    for L in [n for n in rows.preorder() if n.is_leaf and n.data.get("dleaf") is None and n.data.get("list")]:
        r = {"genus": L.name.split()[0], "family": L.data.get("family"), "group": L.data.get("group")}
        target, rank = None, None
        for rk in ("genus", "family", "group"):
            ds = mates.get((rk, r[rk]))
            if ds:
                target, rank = crown(ds), rk
                break
        if target is None:
            at_rank["none"] += 1
            continue
        if target.leaf is not None:  # one mate: a new split halfway down its branch
            if id(target) not in split_of:
                P = target.parent
                x = DNode(age=P.age / 2, lo=0.0, hi=P.age, src=S_INTERP)
                P.children[P.children.index(target)] = x
                x.parent = P
                x.add(target)
                split_of[id(target)] = x
                dep[id(x)] = dep[id(target)]
                for d in x.preorder():
                    dep[id(d)] = dep[id(d.parent)] + 1
                n_liv[id(x)] = 1
            target = split_of[id(target)]
        g = DNode(age=0.0, lo=0.0, hi=0.0, src=S_INTERP, leaf=L, graft=True)
        target.add(g)
        target.loose += 1
        L.data["dleaf"] = g
        at_rank[rank] += 1
        by_group[r["group"]] += 1
    log["dated"]["grafted"] = {"n": sum(by_group.values()), "by_group": dict(by_group), "at_crown_of": dict(at_rank),
                               "new_halfway_splits": len(split_of)}


def name_dated(rows: Node, droot: DNode) -> int:
    """Open Tree's clade names on the dated splits over exactly their species (as dated.py names the mammals')."""
    rng = np.random.default_rng(539)
    key: dict[int, int] = {}
    for n in rows.preorder():
        if n.is_leaf:
            key[id(n)] = int(rng.integers(1, 2 ** 62))
    sig: dict[int, tuple[int, int]] = {}
    names: dict[tuple[int, int], str] = {}
    for n in rows.postorder():
        if n.is_leaf:
            sig[id(n)] = (1, key[id(n)]) if n.data.get("dleaf") is not None else (0, 0)
            continue
        s = (sum(sig[id(c)][0] for c in n.children), 0)
        x = 0
        for c in n.children:
            x ^= sig[id(c)][1]
        sig[id(n)] = (s[0], x)
        if n.name and BINOMIAL.match(n.name) is None and sig[id(n)] not in names:
            names[sig[id(n)]] = n.name
    dsig: dict[int, tuple[int, int]] = {}
    k = 0
    for d in reversed(list(droot.preorder())):
        if d.leaf is not None:
            dsig[id(d)] = (1, key.get(id(d.leaf), 0))
            continue
        x = 0
        for c in d.children:
            x ^= dsig[id(c)][1]
        dsig[id(d)] = (sum(dsig[id(c)][0] for c in d.children), x)
        if not d.name and dsig[id(d)] in names and dsig[id(d)][0] >= 2:
            d.name = names[dsig[id(d)]]
            k += 1
    return k


# ------------------------------------------------------------------ counts and sums


def count_leaves(rows: Node, birds_n: dict[str, dict], thin: tuple[float, str], log: dict,
                 skip: Node | None = None) -> None:
    """Step 9: Callaghan 2021's totals for birds; every other species' count unknown (module docstring). Every leaf
    under `rows` but `skip`'s (the mammals, counted by their own build)."""
    L_yr = ASSUMED_GEN_YR / 2
    rep: Counter = Counter()
    leaves = []
    st = [rows]
    while st:
        n = st.pop()
        if n is skip:
            continue
        if n.is_leaf:
            leaves.append(n)
        st.extend(n.children)
    for n in leaves:
        D = n.data
        c = birds_n.get(n.name) if D.get("group") == "Aves" else None
        span = (n.t0 - n.t1) * 1e6
        D.update(ghost=0.0, src={SRC["opentree"]}, red_list=None, natural=None, history=None)
        dl = D.get("dleaf")
        t_how = ("t: its band from the Open Tree node above it, dated on "
                 + (AMNIOTE_SRC[dl.src - len(SRC_NAMES)] + "'s tree" if dl is not None and not dl.graft else
                    "the group's dated tree; the species placed by name (its genus, else family), no tree has it"))
        if n.kind == "graft":
            N = thin[0]
            D.update(alive=0.0, lo=0.0, hi=0.0, sd=0.0, grade=3, count_unknown={"N": N, "thinnest": thin[1]})
            D["src"] = {SRC["pbdb"]}
            D["meth"] = ["N:unknown: a fossil species (PBDB); how many there were is not known: drawn at the thinnest "
                         f"a living species is ({N:.3g}, {thin[1]}), a width, not a figure", ASSUMED_GEN_NOTE,
                         "t: its band from its first to its last appearance in the Paleobiology Database (PBDB)"]
            rep["fossil: unknown"] += 1
        elif n.extinct:
            N = thin[0]
            D.update(alive=0.0, lo=0.0, hi=0.0, sd=0.0, grade=3, count_unknown={"N": N, "thinnest": thin[1]})
            D["meth"] = ["N:unknown: a species lost in historical times (OTT flags it extinct); how many there were is "
                         f"not known: drawn at the thinnest a living species is ({N:.3g}, {thin[1]}), a width, not a "
                         "figure", ASSUMED_GEN_NOTE, t_how]
            rep[("bird" if D.get("group") == "Aves" else "reptile") + ": extinct, unknown"] += 1
        elif c is not None and c["N"] > 0:
            N = c["N"]
            hi = math.log10(c["hi"] / N) if c["hi"] and c["hi"] > N else 0.0
            # (a lower bound of 0, 136 species: no bound on a log scale, so the interval is taken as symmetric in log)
            lo = math.log10(N / c["lo"]) if c["lo"] and 0 < c["lo"] < N else hi
            sd = (lo + hi) / (2 * 1.96)
            g = grade_from_sd(sd)
            kind = "independent estimate (one of its 684 training species)" if c["training"] else "eBird model"
            if not c["training"]:
                g = max(g, 2)
            D.update(alive=N, lo=lo, hi=hi, sd=sd, grade=g)
            # (its 95% interval is the row's LOHI: no figures here, so the methods table stays a few lines for birds)
            D["meth"] = [f"N:Callaghan et al. 2021 global abundance, {kind}; its 95% interval as the range"
                         + ("" if c["lo"] and 0 < c["lo"] < N else " (no lower bound given: taken symmetric in log)"),
                         ASSUMED_GEN_NOTE, t_how]
            rep["bird: Callaghan, training" if c["training"] else "bird: Callaghan, model"] += 1
        else:
            N = thin[0]
            why = "Callaghan et al. 2021 has no estimate for it" if D.get("group") == "Aves" else \
                "no reptile species total has been compiled"
            D.update(alive=N, lo=0.0, hi=0.0, sd=0.0, grade=3, count_unknown={"N": N, "thinnest": thin[1]})
            D["meth"] = [METHOD_UNKNOWN.format(why=why, n=N, who=thin[1]), ASSUMED_GEN_NOTE, t_how]
            rep[("bird" if D.get("group") == "Aves" else "reptile") + ": unknown"] += 1
        r = N / L_yr
        D["pieces"] = [(n.t0, n.t1, r)]
        D["ever"] = r * span
        D["kever"] = 0.0 if D.get("count_unknown") else D["ever"]  # the part of ever with a known count
        D["by_grade"] = np.bincount([D["grade"]], weights=[D["ever"]], minlength=4)
        D["profile"] = np.full(16, r)
    log["counts"] = {"by_kind": dict(rep), "thinnest": {"N": thin[0], "leaf": thin[1]},
                     "assumed_generation_yr": ASSUMED_GEN_YR}


def _cum(n: Node, x: np.ndarray) -> np.ndarray:
    """Births of n's band older-than-t1 up to each age in x, from its 16-bin profile (piecewise constant)."""
    e = profile_edges(n.t0, n.t1)
    C = np.concatenate([[0.0], np.cumsum(n.data["profile"] * np.diff(e) * 1e6)])
    return np.interp(x, e, C)


def sum_rows(root: Node, extra: list[Node]) -> None:
    """Internal sums over leaf pieces (exact, as model.sum_tree's sampled part; no ghosts or lineage fill outside
    mammals). `extra` are subtrees already summed (the mammals): left as they are, folded in through their profiles."""
    ex = {id(x) for x in extra}
    kids = lambda n: [] if id(n) in ex else n.children  # noqa: E731
    order = []
    st = [root]
    while st:
        n = st.pop()
        order.append(n)
        st.extend(reversed(kids(n)))
    O, Y, R = [], [], []
    start, end = {}, {}
    for n in order:
        start[id(n)] = len(O)
        if n.is_leaf:
            for o, y, r in n.data["pieces"]:
                O.append(o)
                Y.append(y)
                R.append(r)
    for i in range(len(order) - 1, -1, -1):
        n = order[i]
        end[id(n)] = end[id(kids(n)[-1])] if kids(n) else (start[id(order[i + 1])] if i + 1 < len(order) else len(O))
    O, Y, R = np.asarray(O), np.asarray(Y), np.asarray(R)
    for n in reversed(order):
        if not kids(n):
            continue
        D = n.data
        a, b = start[id(n)], end[id(n)]
        edges = profile_edges(n.t0, n.t1)
        C = (R[a:b, None] * np.clip(np.minimum(O[a:b, None], edges[None, :]) - Y[a:b, None], 0.0, None)).sum(0) * 1e6
        for c in n.children:
            if id(c) in ex:
                C = C + _cum(c, edges)
        D["profile"] = np.maximum(np.diff(C), 0.0) / np.maximum(np.diff(edges) * 1e6, 1e-9)
        D["ever"] = sum(c.data["ever"] for c in n.children)
        D["alive"] = sum(c.data["alive"] for c in n.children)
        D["ghost"] = sum(c.data.get("ghost", 0.0) for c in n.children)
        # The range: Fenton-Wilkinson over the children's known counts (an unknown count has none; it adds only the
        # thinnest width). The grade: no better than that range says, nor than the grade holding the median of the
        # ever (a sum of eBird-model counts is still a model's), and D where ghosts or unknown counts are most of it.
        # (a summed subtree, the mammals, is read, never written: its own range and grade stand for it)
        kever = lambda c: c.data["ever"] if id(c) in ex else c.data["kever"]  # noqa: E731
        sd_of = lambda c: c.data["log_sd"] if id(c) in ex else c.data["sd"]  # noqa: E731
        D["kever"] = sum(kever(c) for c in n.children)
        D["by_grade"] = sum(np.bincount([c.data["grade"]], weights=[c.data["ever"]], minlength=4) if id(c) in ex
                            else c.data["by_grade"] for c in n.children)
        parts = [(math.log10(kever(c)), sd_of(c)) for c in n.children if kever(c) > 0]
        le = math.log10(D["ever"])
        if parts:
            mu, sd = lognormal_sum(parts)
            D["lo"] = max(0.0, le - (mu - 1.96 * sd))
            D["hi"] = max(0.0, (mu + 1.96 * sd) - le)
        else:
            sd = 0.0
            D["lo"] = D["hi"] = 0.0
        D["sd"] = sd
        median_grade = int(np.searchsorted(np.cumsum(D["by_grade"]), 0.5 * D["by_grade"].sum()))
        D["grade"] = max(grade_from_sd(sd), min(median_grade, 3))
        if D["ghost"] / D["ever"] > 0.5 or D["kever"] < 0.5 * D["ever"]:
            D["grade"] = 3
        D["meth"] = [f"sum of {len(n.children)} children"]
        D["src"] = set().union(*(c.data["src"] for c in n.children))


def thinnest(mroot: Node, birds_n: dict[str, dict]) -> tuple[float, str]:
    """The smallest today's count of any living species with one (model.mark_unknown's rule, over the amniotes)."""
    best = (math.inf, "")
    for n in mroot.preorder():
        D = n.data
        if n.is_leaf and not n.extinct and n.name != "Homo sapiens" and not D.get("count_unknown") \
                and D.get("alive", 0) > 0 and D["alive"] < best[0]:
            best = (D["alive"], n.name)
    for name, c in birds_n.items():
        if 0 < c["N"] < best[0]:
            best = (c["N"], name)
    return best


def match_callaghan(cal: dict[str, dict], birds: dict[str, dict], lists: Lists, log: dict) -> dict[str, dict]:
    """Callaghan's species -> Clements names: exact, else one Clements species through OTT synonyms."""
    out, how = {}, Counter()
    for nm, c in cal.items():
        if nm in birds:
            out[nm] = c
            how["exact"] += 1
    for nm, c in cal.items():
        if nm in birds:
            continue
        hits = sorted({x for u in lists.uids.get(nm, ()) for x in lists.name_of_uid.get(u, ()) if x in birds})
        if len(hits) == 1 and hits[0] not in out:
            out[hits[0]] = c
            how["OTT synonym"] += 1
        elif len(hits) == 1:
            how["its Clements species has a count already"] += 1
        else:
            how["two or more Clements species" if hits else "no match"] += 1
    log["callaghan"] = {"species": len(cal), "matched_by": dict(how), "clements_with_a_count": len(out),
                        "training_matched": sum(1 for c in out.values() if c["training"])}
    return out


# ------------------------------------------------------------------ the build


def build_amniotes(raw: Path, work: Path, log: dict, alog: dict, t_start: float):
    mroot, mctx, mdroot = build.build_mammals(raw, work, log, t_start)
    log_step(t_start, "mammal build done")
    tax, syn, uids = load_ott_cut(raw)
    birds = load_clements(raw)
    reptiles, no_order = load_rdb(raw)
    lists = Lists(birds, reptiles, syn, uids)
    alog["lists"] = {"clements": len(birds), "rdb": len(reptiles), "rdb_no_order": no_order,
                     "rdb_by_group": dict(Counter(r["group"] for r in reptiles.values()))}
    cal = match_callaghan(load_callaghan(raw), birds, lists, alog)
    srows, seen = sauropsid_rows(load_ot(raw), tax, lists, alog, {n for n, c in cal.items() if c["N"] > 0},
                                 load_lost(raw))
    log_step(t_start, f"sauropsid rows: {alog['rows']['species_by_group']}")
    backbone = load_backbone(Path(__file__).resolve().parents[1] / "amniotes.toml")
    notes = list(getattr(mdroot, "data_notes", []))
    crowns, _ = sauropsid_dated(srows, load_dated(raw), lists, backbone, len(notes), alog)
    for e in backbone:
        notes.append({"name": e["name"], "cite": " ".join(e["citation"].split()), "reason": " ".join(e["reason"].split())})
    sdroot = crowns["Sauria"]
    # the rows: Sauria is Open Tree's Sauropsida (its only living members); dated on the group trees + backbone
    calibrate_rows(srows, sdroot, alog)
    srows.age = sdroot.age
    name_by_taxonomy(srows, tax, alog)
    # the fossils (step 6, fossils.py), on Amniota: the mammals as their build left them, the sauropsids
    am = next(e for e in backbone if e["name"] == "Amniota")
    root = Node(name="Amniota", ott=OTT_AMNIOTA, rank="no rank", kind="tree")
    root.add(mroot)
    root.add(srows)
    ttop, stop = fossils.graft(root, mroot, srows, lists, raw, Overrides(version=1),
                               list(GROUPS) + [e["name"] for e in backbone] + ["Mammalia"], alog)
    for n in srows.preorder():  # a listed species PBDB also has keeps the list's end (graft_pbdb gave it PBDB's)
        if n.is_leaf and n.extinct and n.data.get("list"):
            n.lad = LAD_RECENT_EX
    log_step(t_start, f"fossils grafted: {alog['fossils']['grafted_by_group']}")
    # dates and bands, each side on its own (a holder stands for Amniota, so each side's top is dated as any node)
    mt0, mt1 = mroot.t0, mroot.t1
    extra = [c for c in root.children if c is not ttop and c is not stop]  # fossils PBDB places in Amniota only
    for top, hide in [(stop, None), (ttop, mroot)] + [(c, None) for c in extra]:
        if top is mroot:
            continue
        kids = None
        if hide is not None:  # the mammals: a leaf as old as their band start; nothing inside them changes
            kids, hide.children, hide.fad = hide.children, [], hide.t0
        holder = Node(name="(holder)")
        holder.age = 1e4
        root.children[root.children.index(top)] = holder
        holder.add(top)
        try:
            date_tree(holder, alog)
            assign_bands(holder, {})
            # (the holder's own: a genus PBDB files straight under Amniota, of one species, is that species)
            collapse_knuckles(holder, absorb_root=False)
        finally:
            root.children[root.children.index(holder)] = holder.children[0]
            holder.children[0].parent = root
            if hide is not None:
                hide.children, hide.fad = kids, None
                hide.t0, hide.t1 = mt0, mt1
    ttop, stop, *extra = root.children
    graft_dated(srows, sdroot, lists, alog)
    alog["dated"]["named_by_open_tree"] = name_dated(srows, sdroot)
    # the backbone: each split no younger than the fossils inside it (the rows' ages after date_tree)
    named = {(n.data.get("crown_of") or n.name): n for n in stop.preorder()
             if (n.data.get("crown_of") or n.name) in crowns and not n.is_leaf and not n.data.get("total_group_of")}
    named.setdefault("Sauria", srows)  # (the rows' top is the crown the dated tree's Sauria is: calibrate_rows)
    fossils.backbone_minima(crowns, named, [e["name"] for e in backbone if e["name"] != "Amniota"], alog["fossils"])
    tops = fossils.dated_fossils([(ttop, mdroot), (stop, sdroot)], mroot, alog["fossils"])
    log_step(t_start, f"sauropsid dated tree: {alog['dated']['groups']}")
    # Amniota: the mammals' side and the sauropsids', at the backbone's oldest split
    m_floor = max([mdroot.age] + [n.fad or 0.0 for n in mroot.preorder() if n.is_leaf])
    extra_d = [d for d in (dated._sub(c, set()) for c in extra) if d is not None]
    age = max(float(am["age"]), m_floor + EPS, ttop.age + EPS, stop.age + EPS, *(t.age + EPS for t in tops),
              *(c.t0 + EPS for c in extra), *(d.age + EPS for d in extra_d))
    alog["dated"]["backbone"]["Amniota"] = {"cited": am["age"], "age": round(age, 3), "between": am["between"],
                                            "raised_by": "the splits or fossils below it" if age > am["age"] else None,
                                            "oldest_below_Ma": round(max(m_floor, ttop.age, stop.age), 3)}
    alog["fossils"]["backbone"]["Amniota"] = {"before_Ma": am["age"], "after_Ma": round(age, 3),
                                              "raised_by": "a fossil inside it" if age > am["age"] else None}
    adroot = DNode(age=age, lo=min(float(am["lo"]), age), hi=max(float(am["hi"]), age), src=S_TIMETREE,
                   name="Amniota", note=len(notes) - len(backbone) + [x["name"] for x in backbone].index("Amniota"))
    for t in tops + extra_d:
        adroot.add(t)
    for d in extra_d:
        for x in d.preorder():
            if x.leaf is not None:
                x.leaf.data["dleaf"] = x
    # the stems' zero-length branches (a stem at its oldest fossil, as old as the clade inside it: Dinosauria in
    # Avemetatarsalia), given time as the mammal build gives its own (dated.zero_length, ToLaD#561);
    # the mammals' dated tree stays exactly theirs
    dated.zero_length(adroot, alog["fossils"], skip=mdroot)
    # a stem named as the crown inside it (PBDB's Squamata round the squamates' crown): the crown keeps the name (ToLaD#561)
    alog["fossils"]["stems_unnamed"] = dated.crown_names(adroot)
    adroot.data_notes = notes
    stop.t0 = age
    if ttop is not mroot:
        ttop.t0 = age
    root.age, root.t0, root.t1, root.date_src = age, age * 1.02, 0.0, D_UPHAM
    # counts
    thin = thinnest(mroot, cal)
    count_leaves(root, cal, thin, alog, skip=mroot)
    sum_rows(root, extra=[mroot])
    alog["checks"] = checks(root, mroot, srows, adroot, mdroot, tops, crowns)
    alog["checks"]["fossils"] = fossils.checks(root, mroot)
    return root, adroot, mdroot


def checks(root: Node, mroot: Node, srows: Node, adroot: DNode, mdroot: DNode, tops: list[DNode], crowns: dict
           ) -> dict:
    """The plausibility checks (the #113 habit): tips per group, crown ages, duplicates, branch lengths."""
    leaves = [n for n in root.preorder() if n.is_leaf]
    names = Counter(n.name for n in leaves)
    sl = [n for n in srows.preorder() if n.is_leaf and n.data.get("list")]
    mam = {id(n) for n in mroot.preorder()}
    fos = [n for n in leaves if n.kind == "graft" and id(n) not in mam]

    def bad_branches(top: DNode, skip: DNode | None = None) -> int:
        out, st = 0, [top]
        while st:
            d = st.pop()
            if d is skip:
                continue
            for c in d.children:
                if not (d.age > (0.0 if c.leaf is not None else c.age)):
                    out += 1
            st.extend(d.children)
        return out

    def bad_rows(top: Node, skip: Node | None = None) -> int:
        out, st = 0, [top]
        while st:
            n = st.pop()
            if n is skip:
                continue
            out += int(not (n.t0 > n.t1))
            st.extend(n.children)
        return out

    bad_branch = {"sauropsids": bad_branches(tops[1]), "synapsids": bad_branches(tops[0], skip=mdroot),
                  "Amniota": int(not (adroot.age > max(c.age for c in adroot.children)))}
    bad_band = {"sauropsids": bad_rows(root.children[1]), "synapsids": bad_rows(root.children[0], skip=mroot),
                "Amniota": int(not (root.t0 > max(c.t0 for c in root.children)))}
    in_dated = sum(1 for d in tops[1].preorder() if d.leaf is not None and d.leaf.data.get("list"))
    return {
        "tips": len(leaves), "mammal_tips": sum(1 for n in mroot.preorder() if n.is_leaf),
        "sauropsid_tips": len(sl), "sauropsid_tips_by_group": dict(Counter(n.data.get("group") for n in sl)),
        "fossil_tips": len(fos),
        "sauropsid_in_dated_tree": in_dated,
        "fossils_in_dated_tree": sum(1 for d in adroot.preorder()
                                     if d.leaf is not None and d.leaf.kind == "graft" and id(d.leaf) not in mam),
        "crowns_Ma": {k: round(v.age, 2) for k, v in crowns.items() if v.leaf is None},
        "Amniota_Ma": round(adroot.age, 2), "Mammalia_dated_Ma": round(mdroot.age, 2),
        "species_twice": sorted(k for k, v in names.items() if v > 1),
        "dated_branches_not_positive": bad_branch, "rows_bands_not_positive": bad_band,
        "alive": {"Mammalia": mroot.data["alive"], "Sauropsida": root.children[1].data["alive"],
                  "Aves": sum(n.data["alive"] for n in sl if n.data.get("group") == "Aves" and
                              not n.data.get("count_unknown"))},
    }


def main(argv: list[str] | None = None) -> int:
    rootdir = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, default=rootdir / "data" / "raw")
    ap.add_argument("--out", type=Path, default=rootdir / "data" / "amniotes")
    ap.add_argument("--work", type=Path, default=rootdir / "data" / "build")
    a = ap.parse_args(argv)
    t_start = time.time()
    log: dict = {}
    alog: dict = {}
    root, adroot, mdroot = build_amniotes(a.raw, a.work, log, alog, t_start)
    sk = {**dated.skeleton_meta(mdroot), "sources": SRC_NAMES + AMNIOTE_SRC, "overrides": adroot.data_notes,
          **{k: CITES[k] for k in AMNIOTE_SRC},
          "common_source": "IUCN Red List 2026-1 (GBIF checklist doi:10.15468/0qnb58), preferred English name "
                           "(mammals); eBird/Clements v2025 English name (birds)"}
    extra = {"amniotes": {
        "note": "ToLaD#539: the living amniotes. Mammals exactly as data/mammals; birds and reptiles from the Open "
                "Tree Amniota synthesis, dated per group (dated/skeleton.json sources), counts for birds from "
                "Callaghan et al. 2021, every other bird and reptile count unknown (FLAG bit 11). Date-source "
                "code 0 means calibrated on a dated tree: Upham 2019 for mammals, AvesData 1.7, Title 2024, "
                "Colston 2020 or TimeTree 5 elsewhere. SRCM has no free bit: a bird or reptile row's sources are "
                "named in its METH and in `cites`.",
        "assumed_generation_yr": ASSUMED_GEN_YR, "cites": CITES}}
    tiles.write_all(root, a.out, log, adroot, dataset="amniotes-v0", dated_skeleton=sk, meta_extra=extra)
    log_step(t_start, "tiles written")
    stats = {"amniotes": alog, "output": log["output"]}
    (a.out / "stats.json").write_text(json.dumps(stats, indent=1, default=build._json_default, sort_keys=True) + "\n")
    print(json.dumps({"checks": alog["checks"], "output": log["output"]}, indent=1, default=build._json_default))
    return 0


if __name__ == "__main__":
    sys.exit(main())
