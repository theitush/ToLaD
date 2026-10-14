"""The Mammal Diversity Database (MDD v2.5, ASM 2026; CC BY 4.0): the living species our backbone lacks (ToLaD#278).

Our species list is Upham 2019 (taxonomy ~2017) plus the Open Tree tips some species list recognises, so the
species described or split since are missing. MDD is the current list. This module

1. **recognises** an Open Tree tip MDD accepts by name as a living species (a synonym alone does not count),
   so drop_unrecognised (ToLaD#116) keeps it;
2. **matches** each living MDD species to our living leaves: its own name first, then its synonyms (MDD's
   nominal names in its genus, its original combination, its MSW3 and CMW names and the name the Red List
   assessed it under, then our OTT/PHYLACINE synonym index), each leaf claimed once and never by another MDD
   species' accepted name (a split's daughter does not claim the parent's leaf);
3. **grafts** each living, wild MDD species with no leaf onto its genus: the common ancestor of our leaves its
   MDD genus-mates matched (a split inside the genus, dated by interpolation like any living graft); with one
   genus-mate, a new split above that leaf; with none, a new genus node under the leaves of its MDD family
   (else order). The leaf carries its MDD English name; its Red List status comes from redlist.attach.

Our living leaves MDD does not recognise are only reported (stats.json -> mdd.ours_not_in_mdd).
"""

from __future__ import annotations

import csv
import re
from collections import Counter, defaultdict
from pathlib import Path

from .load import norm_name
from .tree import Node

MDD_FILE = "mdd/MDD_v2.5_6904species.csv"
VERSION = "MDD v2.5 (2026-07-28, doi:10.5281/zenodo.21654811)"
CITE = ("Mammal Diversity Database 2026. Mammal Diversity Database (Version 2.5) [Data set]. Zenodo. "
        "doi:10.5281/zenodo.21654811; CC BY 4.0")
_BIN = re.compile(r"^[A-Z][a-z]+ [a-z][a-z-]+$")
_AS = re.compile(r"\(as ([A-Z][a-z]+ [a-z-]+)\)")


def _na(s: str | None) -> str:
    return "" if s is None or s.strip() in ("", "NA") else s.strip()


def load(raw: Path) -> list[dict]:
    """Every MDD species row: name, genus, family, order, English name, extinct/domestic flags, IUCN
    category (MDD's), authority year, and the binomial synonyms it can be matched by."""
    p = raw / MDD_FILE
    if not p.exists():
        return []
    out = []
    with p.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            name = norm_name(r["sciName"])
            genus = _na(r["genus"]) or name.split()[0]
            syn = set()
            for nom in _na(r["nominalNames"]).split("|"):
                ep = nom.strip().split(" ", 1)[0].lower()
                if ep.isalpha():
                    syn.add(f"{genus} {ep}")
            orig = _na(r["originalNameCombination"]).replace("(", "").replace(")", "").split()
            if len(orig) >= 2:
                syn.add(norm_name(f"{orig[0]} {orig[-1]}"))
            for col in ("MSW3_sciName", "CMW_sciName"):
                if _na(r.get(col)):
                    syn.add(norm_name(r[col]))
            m = _AS.search(r.get("iucnStatus") or "")
            if m:
                syn.add(norm_name(m.group(1)))
            syn = {s for s in syn if _BIN.match(s) and s != name}
            iucn = _na(r["iucnStatus"]).split(" ", 1)[0]
            out.append({"name": name, "id": int(r["id"]), "genus": genus, "family": _na(r["family"]),
                        "order": _na(r["order"]), "common": _na(r["mainCommonName"]) or None,
                        "extinct": r["extinct"] == "1", "domestic": r["domestic"] == "1", "iucn": iucn or None,
                        "year": _na(r["authoritySpeciesYear"]), "syn": syn})
    return out


def recogniser(rows: list[dict]):
    """name -> True when MDD accepts it as a living species. A synonym does not count: one MDD species
    has many (Felis lybica: F. ornata, F. servalina, ...), and keeping such tips is #116 again; the
    species itself is matched or grafted under its MDD name instead. (`leaf_names` is unused, kept for
    the call's shape.)"""
    living = {r["name"] for r in rows if not r["extinct"]}

    def known(name: str, leaf_names: set[str]) -> bool:
        return name in living
    return known


def _living_leaves(root: Node) -> list[Node]:
    return [n for n in root.preorder() if n.is_leaf and n.name and n.kind == "tree" and not n.extinct
            and not n.data.get("empty_higher")]


def match(root: Node, rows: list[dict], syn_index: dict[str, list[Node]]) -> tuple[dict[str, Node], dict]:
    """MDD living species -> our living leaf; and how each was found."""
    leaves = _living_leaves(root)
    by_name = {n.name: n for n in leaves}
    accepted = {r["name"] for r in rows}
    claimed: set[int] = set()
    hit: dict[str, Node] = {}
    how: dict[str, str] = {}
    living = [r for r in rows if not r["extinct"]]
    for r in living:
        nd = by_name.get(r["name"])
        if nd is not None:
            hit[r["name"]], how[r["name"]] = nd, "name"
            claimed.add(id(nd))
    for r in living:
        if r["name"] in hit:
            continue
        found = None
        for c in sorted(r["syn"] - accepted):  # MDD's own synonyms, never another species' accepted name
            nd = by_name.get(c)
            if nd is not None and id(nd) not in claimed:
                found = (nd, "MDD synonym")
                break
        if found is None:
            for c in [r["name"]] + sorted(r["syn"] - accepted):  # our OTT/PHYLACINE/folded synonyms
                s = {id(x): x for x in syn_index.get(c, []) if x.kind == "tree" and not x.extinct
                     and id(x) not in claimed and x.name not in accepted}
                if len(s) == 1:
                    found = (next(iter(s.values())), "our synonym index")
                    break
        if found is not None:
            hit[r["name"]], how[r["name"]] = found
            claimed.add(id(found[0]))
    return hit, how


def _tight(m: Node, mates: list[Node]) -> bool:
    n_living = sum(1 for x in m.preorder() if x.is_leaf and x.kind == "tree" and not x.extinct)
    return n_living <= 3 * len(mates) + 2


def graft(root: Node, rows: list[dict], syn_index: dict[str, list[Node]], log: dict) -> list[Node]:
    """Graft every living wild MDD species we lack onto its genus (module docstring). Returns the new leaves."""
    from .merge import _mrca  # the merged tree's common ancestor
    if not rows:
        log["mdd"] = {"note": f"{MDD_FILE} missing: no MDD species added"}
        return []
    hit, how = match(root, rows, syn_index)
    living = [r for r in rows if not r["extinct"]]
    for r in living:
        if r["name"] in hit:
            nd = hit[r["name"]]
            nd.data["mdd_genus"] = r["genus"]
            nd.data["mdd_family"] = r["family"]
            nd.data["mdd_order"] = r["order"]
            nd.data["mdd_iucn"] = r["iucn"]
            if nd.name != r["name"] and r["name"] not in nd.alt:
                nd.alt.append(r["name"])
            if nd.data.get("mdd_rescued") and r["common"]:
                nd.data["common_mdd"] = r["common"]  # an Open Tree tip only MDD knows: its English name too
    mates: dict[tuple[str, str], list[Node]] = defaultdict(list)
    for r in living:
        if r["name"] in hit:
            nd = hit[r["name"]]
            mates[("genus", r["genus"])].append(nd)
            mates[("family", r["family"])].append(nd)
            mates[("order", r["order"])].append(nd)
    all_names = {n.name for n in root.preorder() if n.name}
    by_name: dict[str, list[Node]] = defaultdict(list)
    for n in root.preorder():
        if n.name and not n.is_leaf and n.kind == "tree":
            by_name[n.name].append(n)

    target: dict[str, tuple[Node, str]] = {}

    def wrap(leaf: Node, name: str | None) -> Node:
        """A new split above `leaf` (its genus, by MDD): the leaf and its new congeners below it."""
        w = Node(name=name, rank="genus" if name else "no rank", kind="tree", taxonomic=True)
        w.data["created_from"] = "MDD"
        par = leaf.parent
        par.children[par.children.index(leaf)] = w
        w.parent = par
        w.add(leaf)
        return w

    def place(r: dict) -> tuple[Node, str] | None:
        g = r["genus"]
        if g in target:
            return target[g]
        ms = mates.get(("genus", g), [])
        out = None
        if len(ms) == 1:
            out = (wrap(ms[0], None), "a new split above its one genus-mate")
        elif ms:
            m = _mrca(ms)
            if m is not None and m is not root and _tight(m, ms):
                out = (m, "the common ancestor of its genus-mates")
            else:
                named = [x for x in by_name.get(g, []) if any(_is_under(y, x) for y in ms)]
                out = ((named[0], "our genus node (genus-mates not monophyletic)") if named else
                       (m, "the common ancestor of its genus-mates (not tight)") if m is not None and m is not root
                       else None)
        if out is None:
            for rank in ("family", "order"):
                ms = mates.get((rank, r[rank]), [])
                m = _mrca(ms) if ms else None
                if m is not None and m.is_leaf:
                    m = m.parent
                if m is not None and m is not root:
                    gnode = Node(name=g, rank="genus", kind="tree", taxonomic=True)
                    gnode.data["created_from"] = "MDD"
                    m.add(gnode)
                    out = (gnode, f"a new genus under the common ancestor of its {rank}-mates")
                    break
        if out is not None:
            target[g] = out
        return out

    placed: Counter = Counter()
    skipped: dict[str, list[str]] = defaultdict(list)
    new: list[Node] = []
    for r in living:
        if r["name"] in hit:
            continue
        if r["domestic"]:
            skipped["domestic form (counted with its wild ancestor or as stock)"].append(r["name"])
            continue
        if r["name"] in all_names:
            skipped["the name is an extinct leaf or a higher taxon of ours"].append(r["name"])
            continue
        t = place(r)
        if t is None:
            skipped["no genus, family or order mate in our tree"].append(r["name"])
            continue
        node, where = t
        leaf = Node(name=r["name"], rank="species", kind="tree", taxonomic=True)
        leaf.data["mdd"] = {"id": r["id"], "year": r["year"], "iucn": r["iucn"], "genus": r["genus"],
                            "family": r["family"], "order": r["order"]}
        leaf.data["mdd_genus"], leaf.data["mdd_family"], leaf.data["mdd_order"] = r["genus"], r["family"], r["order"]
        leaf.data["mdd_iucn"] = r["iucn"]
        if r["common"]:
            leaf.data["common_mdd"] = r["common"]
        node.add(leaf)
        all_names.add(r["name"])
        placed[where] += 1
        new.append(leaf)
    matched_ids = {id(nd) for nd in hit.values()}
    ours = sorted(n.name for n in _living_leaves(root) if id(n) not in matched_ids and not n.data.get("mdd")
                  and n.name != "Homo sapiens")
    by_order = Counter(r["order"] for r in living if r["name"] not in hit and not r["domestic"])
    log["mdd"] = {
        "source": CITE,
        "species": len(rows), "living": len(living), "extinct": len(rows) - len(living),
        "living_matched": len(hit), "matched_by": dict(Counter(how.values())),
        "open_tree_tips_only_mdd_knows": sum(1 for n in _living_leaves(root) if n.data.get("mdd_rescued")),
        "living_lacking": len(living) - len(hit), "lacking_by_order": dict(by_order.most_common()),
        "grafted": len(new), "grafted_on": dict(placed),
        "skipped": {k: {"n": len(v), "names": sorted(v)} for k, v in skipped.items()},
        "grafted_names": sorted(n.name for n in new),
        "ours_not_in_mdd": {"note": "our living leaves no living MDD species matches by name or synonym "
                                    "(reported only, ToLaD#278)", "n": len(ours), "names": ours},
    }
    return new


def _is_under(nd: Node, anc: Node) -> bool:
    p = nd
    while p is not None:
        if p is anc:
            return True
        p = p.parent
    return False
