"""Merged ToLaD tree: Open Tree topology + Upham dates + PBDB fossil grafts."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from .load import fnum, norm_name
from .newick import NNode

BINOMIAL = re.compile(r"^[A-Z][a-z]+ [a-z][a-z-]+$")

# date sources
D_UPHAM, D_INTERP, D_FOSSIL, D_ANCHOR = 0, 1, 2, 3
DATE_SRC_NAMES = ["upham-calibrated", "interpolated", "fossil-range", "anchored"]


@dataclass(eq=False)
class Node:
    name: str | None
    ott: int | None = None
    pbdb: int | None = None
    rank: str = "no rank"
    kind: str = "tree"  # tree | graft | group | bucket
    children: list["Node"] = field(default_factory=list)
    parent: "Node | None" = None
    alt: list[str] = field(default_factory=list)
    extinct: bool = False
    fad: float | None = None  # first appearance (Ma)
    lad: float | None = None  # last appearance (Ma)
    age: float | None = None  # crown / split age (Ma)
    t0: float = 0.0  # band start (Ma)
    t1: float = 0.0  # band end (Ma), 0 = extant
    date_src: int = D_INTERP
    taxonomic: bool = False  # topology_confidence == taxonomic
    upham: str | None = None  # matched Upham tip label
    data: dict = field(default_factory=dict)

    def add(self, c: "Node") -> None:
        c.parent = self
        self.children.append(c)

    def preorder(self):
        st = [self]
        while st:
            n = st.pop()
            yield n
            st.extend(reversed(n.children))

    def postorder(self):
        return reversed(list(self.preorder()))

    @property
    def is_leaf(self) -> bool:
        return not self.children

    def genus(self) -> str | None:
        if self.name and " " in self.name:
            return self.name.split(" ", 1)[0]
        return None


def from_opentree(nroot: NNode, ott: dict[int, dict]) -> Node:
    def conv(nn: NNode) -> Node:
        info = ott.get(nn.ott) if nn.ott else None
        nd = Node(
            name=nn.name if nn.name else None,
            ott=nn.ott,
            rank=info["rank"] if info else "no rank",
        )
        if info:
            nd.data["ott_flags"] = info["flags"]
        return nd

    root = conv(nroot)
    stack = [(nroot, root)]
    while stack:
        nn, nd = stack.pop()
        for c in nn.children:
            cn = conv(c)
            nd.add(cn)
            stack.append((c, cn))
    return root


INFRA = {"subspecies", "variety", "forma", "infraspecificname", "varietas", "subvariety", "natio"}


def clean_opentree(root: Node, log: dict) -> None:
    """Species-rank tips only: fold infraspecific taxa into their species,
    drop non-binomial / environmental / 'cf.' tips."""
    dropped = Counter()
    # 1. species nodes with children (subspecies) become leaves
    for nd in list(root.preorder()):
        if nd.rank == "species" and nd.children:
            dropped["infraspecific"] += sum(1 for _ in nd.preorder()) - 1
            nd.children = []
    # 2. infraspecific tips whose species node is absent: rename to species
    for nd in list(root.preorder()):
        if nd.is_leaf and nd.rank in INFRA and nd.name:
            parts = nd.name.split()
            if len(parts) >= 3:
                nd.alt.append(nd.name)
                nd.name = " ".join(parts[:2])
                nd.rank = "species"
                nd.data["from_infraspecific"] = True
    # 3. drop tips that are not plain binomials at species rank
    def keep(nd: Node) -> bool:
        if not nd.is_leaf:
            return True
        if nd.name and BINOMIAL.match(nd.name) and nd.rank in ("species", "no rank"):
            return True
        return False

    changed = True
    while changed:
        changed = False
        for nd in list(root.postorder()):
            if nd is root:
                continue
            if nd.is_leaf and not keep(nd):
                if nd.rank in ("genus", "family", "order", "subgenus", "subfamily", "tribe"):
                    # a higher taxon with no tips: keep it for grafting, drop later if still empty
                    nd.data["empty_higher"] = True
                    continue
                dropped["non-species tip"] += 1
                nd.parent.children.remove(nd)
                changed = True
    # 4. same binomial twice (species + folded subspecies): keep the first
    seen: dict[str, Node] = {}
    for nd in list(root.preorder()):
        if nd.is_leaf and nd.name and not nd.data.get("empty_higher"):
            if nd.name in seen:
                dropped["duplicate binomial"] += 1
                nd.parent.children.remove(nd)
            else:
                seen[nd.name] = nd
    log["opentree_dropped"] = dict(dropped)


def drop_empty(root: Node) -> int:
    n = 0
    changed = True
    while changed:
        changed = False
        for nd in list(root.postorder()):
            if nd is not root and nd.is_leaf and (nd.data.get("empty_higher") or nd.kind in ("group", "bucket") or (nd.name is None)):
                nd.parent.children.remove(nd)
                n += 1
                changed = True
    return n


# ------------------------------------------------------------------ helpers


def ancestor_of_rank(nd: Node, rank: str) -> Node | None:
    p = nd.parent
    while p is not None:
        if p.rank == rank:
            return p
        p = p.parent
    return None


def name_index(root: Node) -> dict[str, list[Node]]:
    idx: dict[str, list[Node]] = defaultdict(list)
    for nd in root.preorder():
        if nd.name:
            idx[nd.name].append(nd)
    return idx


def collapse_knuckles(root: Node) -> int:
    """Remove unary nodes. The surviving child keeps its own name, records the
    removed ancestors' names in .alt (nearest first), and takes over the band
    start (t0) and the taxon ids it lacks."""
    n = 0
    for nd in list(root.preorder()):
        if nd is root or len(nd.children) != 1 or nd.parent is None:
            continue
        c = nd.children[0]
        par = nd.parent
        par.children[par.children.index(nd)] = c
        c.parent = par
        if nd.name:
            c.alt.append(nd.name)
        c.alt.extend(nd.alt)
        c.t0 = max(c.t0, nd.t0)
        if c.ott is None:
            c.ott = nd.ott
        n += 1
    while len(root.children) == 1:
        c = root.children[0]
        if c.name:
            root.alt.append(c.name)
        root.alt.extend(c.alt)
        root.children = c.children
        for g in root.children:
            g.parent = root
        n += 1
    return n
