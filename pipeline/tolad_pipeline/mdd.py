"""The Mammal Diversity Database (MDD v2.5, ASM 2026; CC BY 4.0): the living species our backbone lacks (ToLaD#278).

Our species list is Upham 2019 (taxonomy ~2017) plus the Open Tree tips some species list recognises, so the
species described or split since are missing. MDD is the current list. This module

1. **recognises** an Open Tree tip MDD accepts by name as a living species (a synonym alone does not count),
   so drop_unrecognised (ToLaD#116) keeps it;
2. **matches** each living MDD species to our living leaves: its own name first, then its synonyms (MDD's
   nominal names in its genus, its original combination, its MSW3 and CMW names and the name the Red List
   assessed it under, then our OTT/PHYLACINE synonym index, then its epithet in another gender), each leaf claimed once and never by another MDD
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
                        "year": _na(r["authoritySpeciesYear"]), "syn": syn, "notes": _na(r.get("taxonomyNotes"))})
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


_GENDER_ENDINGS = ("us", "um", "a", "is", "e")


def _gender_stem(ep: str) -> str:
    """A Latin adjectival epithet without its gender ending (malayanus, malayana, malayanum -> malayan)."""
    for e in _GENDER_ENDINGS:
        if ep.endswith(e) and len(ep) - len(e) >= 4:
            return ep[: -len(e)]
    return ep


def match(root: Node, rows: list[dict], syn_index: dict[str, list[Node]]) -> tuple[dict[str, Node], dict]:
    """MDD living species -> our living leaf; and how each was found."""
    leaves = _living_leaves(root)
    by_name = {n.name: n for n in leaves}
    accepted = {r["name"] for r in rows}
    claimed: set[int] = set()
    hit: dict[str, Node] = {}
    how: dict[str, str] = {}
    living = [r for r in rows if not r["extinct"]]
    by_gender: dict[tuple[str, str], list[Node]] = defaultdict(list)
    for n in leaves:
        g, _, ep = n.name.partition(" ")
        if ep and " " not in ep:
            by_gender[(g, _gender_stem(ep))].append(n)
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
        if found is None:  # the same genus and epithet in another gender (Euroscaptor malayanus = our malayana)
            g, ep = r["name"].split(" ", 1)
            s = [x for x in by_gender.get((g, _gender_stem(ep)), []) if id(x) not in claimed and x.name not in accepted]
            if len(s) == 1:
                found = (s[0], "epithet gender")
        if found is not None:
            hit[r["name"]], how[r["name"]] = found
            claimed.add(id(found[0]))
    return hit, how


# The species an MDD species was split from, as its taxonomyNotes say it ("split from L. tigrinus", "split frmo
# C. calvus", "Split from H. brasiliensis", "spit from N. elegans", "recently described based on populations
# previously attributed to A. laniger", "split from chinensis; moved from Eothenomys"). The first such phrase wins;
# "split from X and Y" names X. A "recently described" species names none. The parent's own notes may say it the
# other way round ("previously included C. ucayalii, C. novaesi, ..."): parent_index reads those.
_PARENT = re.compile(
    r"\b(?:[Ss]pl?it\s+(?:from|frmo|form)|previously\s+(?:attributed|attribtued)\s+to"
    r"|included\s+(?:under|in|within)|(?:a\s+)?subspecies\s+of|synonym\s+of|distinct\s+from|wild\s+form\s+of)\s+"
    r"(?:([A-Z][a-z]*)\.?\s+)?([a-z][a-z-]+)")
_INCLUDED = re.compile(r"\bpreviously\s+included\s+(?!(?:in|under|within|as)\b)([^;]+)")
_BINOM = re.compile(r"\b([A-Z][a-z]*)\.?\s+([a-z][a-z-]{2,})")
_NOT_EPITHET = {"the", "a", "an", "its", "it", "populations", "species", "both", "all", "and", "now"}


_FAM_CACHE: dict[int, dict[str, list[str]]] = {}


def _family_genera(rows: list[dict]) -> dict[str, list[str]]:
    if id(rows) not in _FAM_CACHE:
        fam: dict[str, set[str]] = defaultdict(set)
        for x in rows:
            fam[x["family"]].add(x["genus"])
        _FAM_CACHE.clear()
        _FAM_CACHE[id(rows)] = {f: sorted(g) for f, g in fam.items()}
    return _FAM_CACHE[id(rows)]


def _names(g: str | None, ep: str, r: dict, rows: list[dict]) -> list[str]:
    """A note's name, its genus maybe abbreviated or left out, as candidate binomials (the row's own genus first)."""
    if ep in _NOT_EPITHET:
        return []
    if g and len(g) > 1:  # a full genus name
        return [f"{g} {ep}"]
    gens = [r["genus"]] + [x for x in _family_genera(rows).get(r["family"], []) if x != r["genus"]]
    if g:  # an abbreviation: its own genus when the letter fits, else a family genus starting so
        gens = [x for x in gens if x.startswith(g)]
    return [f"{x} {ep}" for x in gens]


def parent_names(r: dict, rows: list[dict]) -> list[str]:
    """Candidate binomials (most likely first) for the species `r` was split from, by its own taxonomyNotes."""
    m = _PARENT.search(r.get("notes") or "")
    return _names(m.group(1), m.group(2), r, rows) if m else []


def parent_index(rows: list[dict]) -> dict[str, str]:
    """name -> the MDD species whose notes say it "previously included" that name (its parent, the other way round)."""
    out: dict[str, str] = {}
    for r in rows:
        if r["extinct"]:
            continue
        for m in _INCLUDED.finditer(r.get("notes") or ""):
            for g, ep in _BINOM.findall(m.group(1)):
                for c in _names(g, ep, r, rows)[:1]:
                    out.setdefault(c, r["name"])
    return out


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
    sis = sisters(root, rows, hit, new)
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
        "beside_parent": sis,
        "ours_not_in_mdd": {"note": "our living leaves no living MDD species matches by name or synonym "
                                    "(reported only, ToLaD#278)", "n": len(ours), "names": ours},
    }
    return new


def sisters(root: Node, rows: list[dict], hit: dict[str, Node], new: list[Node]) -> dict:
    """An MDD species split from one of ours sits beside it, not at its genus crown (ToLaD#278): its taxonomyNotes
    name the parent (parent_names), resolved to our living leaf by name, MDD synonym or epithet gender. Sets
    leaf.data["mdd_parent"] (the dated tree splits the parent's own branch by it, dated.build) on every graft and
    every Open Tree tip only MDD knows; a graft also moves, in the merged tree, into a new split above its parent's
    leaf (shared by the parent's other daughters; a daughter of a graft joins its parent's split). Returns the report."""
    by_row = {r["name"]: r for r in rows if not r["extinct"]}
    leaves = {n.name: n for n in _living_leaves(root)}
    owner: dict[str, set[str]] = defaultdict(set)
    for r in by_row.values():
        for s in r["syn"]:
            owner[s].add(r["name"])
    gstem: dict[tuple[str, str], list[Node]] = defaultdict(list)
    for n in leaves.values():
        g, _, ep = n.name.partition(" ")
        gstem[(g, _gender_stem(ep))].append(n)

    def node_of(name: str) -> Node | None:
        if name in hit:
            return hit[name]
        if name in leaves:
            return leaves[name]
        o = owner.get(name, set())
        if len(o) == 1:
            acc = next(iter(o))
            return hit.get(acc) or leaves.get(acc)
        g, _, ep = name.partition(" ")
        s = gstem.get((g, _gender_stem(ep)), [])
        return s[0] if len(s) == 1 else None

    subjects = [(n, by_row.get(n.name)) for n in new]
    subjects += [(nd, by_row[nm]) for nm, nd in hit.items() if nd.data.get("mdd_rescued")]
    rev = parent_index(rows)
    found: dict[int, Node] = {}
    straggle: Counter = Counter()
    for n, r in subjects:
        if r is None:
            continue
        P = None
        for c in parent_names(r, rows) + ([rev[r["name"]]] if r["name"] in rev else []):
            P = node_of(c)
            if P is not None and P is not n:
                break
        if P is not None and P is not n:
            found[id(n)] = P
            n.data["mdd_parent"] = P.name
        else:
            why = "no parent named" if not parent_names(r, rows) and r["name"] not in rev else "parent named, not in our tree"
            straggle[f"{why}: " + " ".join((r.get("notes") or "NA").split(";")[0].split()[:3])] += 1

    def base(n: Node) -> Node:  # the root of a chain of daughters: the leaf they all descend from
        seen = set()
        while id(n) in found and id(n) not in seen:
            seen.add(id(n))
            n = found[id(n)]
        return n

    moved = 0
    gr = {id(n) for n in new}
    wraps: dict[int, Node] = {}
    for n in new:
        if id(n) not in found:
            continue
        b = base(n)
        if b is n or id(b) in gr:  # a chain that starts at a graft stays at the genus here (dated.build still splits it)
            continue
        w = wraps.get(id(b))
        if w is None:
            w = Node(name=None, rank="no rank", kind="tree", taxonomic=True)
            w.data["created_from"] = "MDD split"
            par = b.parent
            par.children[par.children.index(b)] = w
            w.parent = par
            w.add(b)
            wraps[id(b)] = w
        n.parent.children.remove(n)
        w.add(n)
        moved += 1
    return {"note": "an MDD species its taxonomyNotes say was split from one of ours sits beside that species "
                    "(mdd.sisters); the rest stay at their genus's crown",
            "grafts_beside_parent": sum(1 for k in found if k in gr), "grafts_at_genus": len(new) - sum(1 for k in found if k in gr),
            "open_tree_tips_beside_parent": sum(1 for k in found if k not in gr), "merged_tree_moves": moved,
            "parents": {n.name: found[id(n)].name for n, _ in subjects if id(n) in found},
            "stragglers_by_note": dict(straggle.most_common())}


def _is_under(nd: Node, anc: Node) -> bool:
    p = nd
    while p is not None:
        if p is anc:
            return True
        p = p.parent
    return False
