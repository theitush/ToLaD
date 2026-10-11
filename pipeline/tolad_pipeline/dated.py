"""The dated tree (format 1.6, ToLaD#145): a proper dated phylogeny of the species rows.

The tiles' own topology is Open Tree's, dated with Upham ages only where a clade is
concordant and interpolated elsewhere. The fan needs a real dated tree, so this module
builds one by rule, for every clade at once:

1. **Upham et al. 2019's node-dated MCC tree** over the tips matched to species leaves
   (merge.match_upham): its topology, node heights and 95% HPDs. Tips Upham placed with no
   genetic data (`samp = imputed`) stay when living (their genus constrains them), and the
   split that joins one is marked `upham-imputed`; extinct imputed tips (sabre-tooths,
   Miracinonyx: placed by taxonomy only, often absurdly) leave Upham's topology and are
   grafted like any fossil. Unmatched tips go, and unary nodes collapse.
2. **Overrides** (overrides.toml `[[dated_clade]]`, `[[dated_fossil]]`): the only hand values.
3. **Grafts:** every other species leaf the data defines (a fossil with a first appearance, a
   living species a Red List knows, or one with a curated history; not a name no species list
   knows, #116) hangs from the Upham node that is the common ancestor of the matched species
   under its Open Tree parent. A graft older than that node (or one the merged tree put on a
   clade's stem, `total_group_of`) branches off its stem at its band start (a fossil: its first
   appearance); a younger one joins that node's split (its place inside is not known: `loose`).
   A fossil-only subtree keeps the merged tree's shape and dates inside.

Every split carries its date source, so the web can tell an Upham date from an
interpolated one. tiles.py writes the tree induced on each file's species rows into its
META (FORMAT.md, "Dated tree").
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from .tree import D_INTERP, D_UPHAM, Node

SRC_NAMES = ["upham", "upham-imputed", "fossil", "interpolated", "override"]
S_UPHAM, S_IMPUTED, S_FOSSIL, S_INTERP, S_OVERRIDE = range(5)
GEN_HOW = ["COMBINE reported", "COMBINE imputed", "allometric"]
EPS = 1e-4  # Ma


@dataclass(eq=False)
class DNode:
    age: float = 0.0
    lo: float = 0.0
    hi: float = 0.0
    src: int = S_UPHAM
    leaf: Node | None = None
    name: str | None = None
    note: int = -1  # index into the dated overrides list (its citation)
    loose: int = 0  # daughters placed by taxonomy only (where inside the split is not known)
    imputed: bool = False  # a leaf Upham placed without genetic data
    anchor: "DNode | None" = None  # a graft's stem node: the crown it sits above
    children: list["DNode"] = field(default_factory=list)
    parent: "DNode | None" = None

    def add(self, c: "DNode") -> None:
        c.parent = self
        self.children.append(c)

    def preorder(self):
        st = [self]
        while st:
            n = st.pop()
            yield n
            st.extend(reversed(n.children))


def eligible(nd: Node) -> bool:
    """A species leaf the data defines: dated if it ended, known to a species list (or curated) if living."""
    if not nd.is_leaf or not nd.name or nd.kind not in ("tree", "graft") or nd.data.get("empty_higher"):
        return False
    if nd.upham:
        return True
    if nd.extinct or nd.t1 > 0:
        return nd.fad is not None or nd.lad is not None  # a first or last appearance (PBDB, PHYLACINE EP)
    rl = nd.data.get("red_list")
    return bool(nd.data.get("history")) or (rl is not None and rl.get("source", 2) != 2)  # 2: not-listed


# ------------------------------------------------------------------ 1. Upham


def from_upham(up_root, up_tax: dict[str, dict], log: dict) -> DNode:
    out: dict[int, DNode | None] = {}
    dropped = Counter()
    for u in reversed(list(up_root.iter_preorder())):
        if not u.children:
            nd = getattr(u, "ot", None)
            t = up_tax.get(u.label, {})
            imputed = t.get("samp") == "imputed"
            if nd is None or not nd.is_leaf:
                out[id(u)] = None
                dropped["unmatched tip"] += nd is None
            elif imputed and t.get("extinct"):
                out[id(u)] = None
                dropped["extinct, placed without data (grafted instead)"] += 1
            else:
                out[id(u)] = DNode(leaf=nd, imputed=imputed)
            continue
        kids = [out[id(c)] for c in u.children if out[id(c)] is not None]
        if not kids:
            out[id(u)] = None
        elif len(kids) == 1:
            out[id(u)] = kids[0]
        else:
            lo, hi = u.hpd if u.hpd else (u.height, u.height)
            d = DNode(age=u.height, lo=lo, hi=hi, src=S_IMPUTED if any(k.imputed for k in kids) else S_UPHAM)
            for k in kids:
                d.add(k)
            out[id(u)] = d
    root = out[id(up_root)]
    root.parent = None
    log["upham_tips_dropped"] = dict(dropped)
    return root


# ------------------------------------------------------------------ 2. overrides


def parse_tree(s: str) -> tuple:
    """`(a,(b,c)1.2[1.0,1.5])3[2,4]` -> nested ('split', age, lo, hi, kids) / ('leaf', name)."""
    i = 0

    def node():
        nonlocal i
        if s[i] == "(":
            i += 1
            kids = [node()]
            while s[i] == ",":
                i += 1
                kids.append(node())
            assert s[i] == ")", s[i:]
            i += 1
            j = i
            while s[i] not in "[,)":
                i += 1
            age = float(s[j:i])
            lo = hi = age
            if s[i:i + 1] == "[":
                k = s.index("]", i)
                lo, hi = (float(x) for x in s[i + 1:k].split(","))
                i = k + 1
            return ("split", age, lo, hi, kids)
        j = i
        while i < len(s) and s[i] not in ",()":
            i += 1
        return ("leaf", s[j:i].strip())

    t = node()
    assert i == len(s), f"trailing text in {s!r}"
    return t


def _leafnames(t) -> list[str]:
    return [t[1]] if t[0] == "leaf" else [n for k in t[4] for n in _leafnames(k)]


def _replace(old: DNode, new: DNode, root: DNode) -> DNode:
    p = old.parent
    if p is None:
        new.parent = None
        return new
    p.children[p.children.index(old)] = new
    new.parent = p
    return root


def _mrca(nodes: list[DNode]) -> DNode:
    paths = []
    for n in nodes:
        p = []
        while n is not None:
            p.append(n)
            n = n.parent
        paths.append(p[::-1])
    m = paths[0][0]
    for i in range(min(len(p) for p in paths)):
        if all(p[i] is paths[0][i] for p in paths):
            m = paths[0][i]
    return m


def apply_overrides(root: DNode, merged: Node, ov, notes: list[dict]) -> tuple[DNode, set[int]]:
    by_name = {d.leaf.name: d for d in root.preorder() if d.leaf is not None}
    for e in ov.dated_clades:
        t = parse_tree(e["tree"])
        names = _leafnames(t)
        miss = [n for n in names if n not in by_name]
        if miss:
            raise RuntimeError(f"overrides.toml dated_clade {e['name']}: not in the dated tree: {miss}")
        m = _mrca([by_name[n] for n in names])
        under = sorted(d.leaf.name for d in m.preorder() if d.leaf is not None)
        if under != sorted(names):
            raise RuntimeError(f"overrides.toml dated_clade {e['name']}: the dated tree has {under} under "
                               f"their common ancestor, the override {sorted(names)}")
        k = len(notes)
        notes.append({"name": e["name"], "cite": e["citation"], "reason": e["reason"]})

        def build(x):
            if x[0] == "leaf":
                d = by_name[x[1]]
                d.parent = None
                return d
            d = DNode(age=x[1], lo=x[2], hi=x[3], src=S_OVERRIDE, note=k)
            for c in x[4]:
                d.add(build(c))
            return d

        new = build(t)
        new.name = m.name
        root = _replace(m, new, root)
        ov.applied["dated_clade"].append({"name": e["name"], "species": len(names),
                                          "replaced_age": round(m.age, 4), "age": t[1]})
    placed: set[int] = set()
    fossils = {n.name: n for n in merged.preorder() if n.is_leaf and n.name and eligible(n)}
    ents = []
    for e in ov.dated_fossils:
        f = fossils.get(e["name"])
        why = ("no such dated species" if f is None else "already in Upham's tree" if f.data.get("dleaf")
               else f"sister {e['sister']!r} not in the dated tree" if e["sister"] not in by_name else "")
        if why:
            raise RuntimeError(f"overrides.toml dated_fossil {e['name']}: {why}")
        age = float(e.get("age", f.fad if f.fad is not None else f.t0))
        ents.append((age, e, f))
    for age, e, f in sorted(ents, key=lambda x: -x[0]):
        s = by_name[e["sister"]]
        if s.parent is not None and age >= s.parent.age:
            raise RuntimeError(f"overrides.toml dated_fossil {e['name']}: age {age} is not below "
                               f"{e['sister']}'s split at {s.parent.age}")
        k = len(notes)
        notes.append({"name": e["name"], "cite": e["citation"], "reason": e["reason"]})
        x = DNode(age=age, lo=float(e.get("lo", age)), hi=float(e.get("hi", age)), src=S_OVERRIDE, note=k)
        root = _replace(s, x, root)
        x.add(s)
        leaf = DNode(leaf=f)
        f.data["dleaf"] = leaf
        x.add(leaf)
        by_name[f.name] = leaf
        if e.get("common"):
            f.data["common_override"] = e["common"]
        placed.add(id(f))
        ov.applied["dated_fossil"].append({"name": e["name"], "sister": e["sister"], "age": age})
    return root, placed


# ------------------------------------------------------------------ 3. names and grafts


def _depths(root: DNode) -> dict[int, int]:
    dep = {}
    for d in root.preorder():
        dep[id(d)] = 0 if d.parent is None else dep[id(d.parent)] + 1
    return dep


def _lca(a: DNode, b: DNode, dep: dict[int, int]) -> DNode:
    while dep[id(a)] > dep[id(b)]:
        a = a.parent
    while dep[id(b)] > dep[id(a)]:
        b = b.parent
    while a is not b:
        a, b = a.parent, b.parent
    return a


def _sub(nd: Node, skip: set[int]) -> DNode | None:
    """A fossil-only (or unmatched) merged subtree as dated nodes: eligible leaves, merged ages."""
    if nd.is_leaf:
        if id(nd) in skip or not eligible(nd):
            return None
        return DNode(leaf=nd)
    kids = [k for k in (_sub(c, skip) for c in nd.children) if k is not None]
    if not kids:
        return None
    if len(kids) == 1:
        return kids[0]
    src = S_UPHAM if nd.date_src == D_UPHAM else S_INTERP if nd.date_src == D_INTERP and nd.kind == "tree" else S_FOSSIL
    d = DNode(age=nd.age, lo=nd.age, hi=nd.age, src=src)
    for k in kids:
        d.add(k)
    return d


def build(root: Node, up_root, up_tax: dict[str, dict], ov, log: dict) -> DNode:
    """The whole dated tree; sets n.data["dleaf"] on every species leaf in it."""
    rep: dict = {}
    droot = from_upham(up_root, up_tax, rep)
    for d in droot.preorder():
        if d.leaf is not None:
            d.leaf.data["dleaf"] = d
    notes: list[dict] = []
    droot, placed = apply_overrides(droot, root, ov, notes)
    ov.check_all_used(dated=True)

    # the dated tree's MRCA of the matched species under every merged node (before grafting)
    dep = _depths(droot)
    nleaf: dict[int, int] = {}
    for d in reversed(list(droot.preorder())):
        nleaf[id(d)] = 1 if d.leaf is not None else sum(nleaf[id(c)] for c in d.children)
    m: dict[int, DNode | None] = {}
    k: dict[int, int] = {}
    for nd in root.postorder():
        if nd.is_leaf:
            dl = nd.data.get("dleaf")
            m[id(nd)], k[id(nd)] = dl, 1 if dl is not None else 0
            continue
        mm, kk = None, 0
        for c in nd.children:
            if m[id(c)] is not None:
                mm = m[id(c)] if mm is None else _lca(mm, m[id(c)], dep)
                kk += k[id(c)]
        m[id(nd)], k[id(nd)] = mm, kk
    # names: the outermost named merged clade with exactly the same species
    named = 0
    for nd in root.preorder():
        d = m[id(nd)]
        if nd.is_leaf or not nd.name or d is None or d.leaf is not None or d.name or k[id(nd)] != nleaf[id(d)]:
            continue
        d.name = nd.name.removesuffix(" (crown)")
        named += 1

    # grafts
    how = Counter()
    clamped = 0
    for nd in list(root.preorder()):
        p = nd.parent
        if p is None or k[id(nd)] > 0 or k[id(p)] == 0:
            continue
        sub = _sub(nd, placed)
        if sub is None:
            continue
        A = m[id(p)]
        g = nd.t0
        fossil = nd.kind != "tree" or all(x.leaf.extinct or x.leaf.t1 > 0 for x in sub.preorder() if x.leaf is not None)
        stem = bool(p.data.get("total_group_of")) or g > A.age + EPS
        B = A
        while B.parent is not None and B.parent.age < g:  # older than the crown's parent: further up its ancestral line
            B = B.parent
        P = B.parent
        if stem:
            age = max(g, A.age * 1.02 + 0.01)
            if P is not None:
                age = min(age, P.age - EPS)
            if age <= B.age + EPS / 2:
                stem = False
        if not stem:
            T = A if A.leaf is None else (A.parent or A)
            T.add(sub)
            T.loose += 1
            how["joins a split (loose)"] += 1
            continue
        x = DNode(age=age, src=S_FOSSIL if fossil else S_INTERP, anchor=A)
        x.lo = age if fossil else B.age
        x.hi = P.age if P is not None else age
        if P is None:
            droot = x
        else:
            P.children[P.children.index(B)] = x
            x.parent = P
        x.add(B)
        x.add(sub)
        how["on a stem (fossil)" if fossil else "on a stem (living, interpolated)"] += 1
    # a graft's merged subtree resolves polytomies with zero-length branches (merge.EPS): splice those into their
    # parent, so a split dated by fossils or interpolation that is no later than its parent becomes one event
    spliced = 0
    for d in reversed(list(droot.preorder())):
        p = d.parent
        if (p is not None and d.leaf is None and d.src in (S_FOSSIL, S_INTERP) and d.note < 0
                and 0 <= p.age - d.age < max(1e-3 * p.age, 2 * EPS)):
            i = p.children.index(d)
            p.children[i:i + 1] = d.children
            for c in d.children:
                c.parent = p
            p.loose += d.loose
            spliced += 1
    # merged ages inside a graft can sit above a clamped attachment: keep every split below its parent
    for d in droot.preorder():
        if d.parent is not None and d.leaf is None and d.age >= d.parent.age:
            d.age = d.parent.age * (1 - 2e-3)
            d.lo, d.hi = min(d.lo, d.age), min(max(d.hi, d.age), d.parent.age)
            clamped += 1
    for d in droot.preorder():
        if d.leaf is not None:
            d.leaf.data["dleaf"] = d
    leaves = [d for d in droot.preorder() if d.leaf is not None]
    splits = [d for d in droot.preorder() if d.leaf is None]
    log["dated_tree"] = {
        **rep,
        "species": len(leaves),
        "living": sum(1 for d in leaves if not (d.leaf.extinct or d.leaf.t1 > 0)),
        "splits": len(splits),
        "splits_by_source": dict(Counter(SRC_NAMES[d.src] for d in splits)),
        "named_splits": named,
        "grafts": dict(how),
        "clamped_below_parent": clamped,
        "zero_length_spliced": spliced,
        # a fossil whose last appearance is older than the split it hangs from (a dating conflict; should be none)
        "ended_before_split": sorted(d.leaf.name for d in leaves if d.parent is not None and d.leaf.t1 >= d.parent.age)[:20],
        "species_rows_left_out": sum(1 for n in root.preorder() if n.is_leaf and n.name and n.kind in ("tree", "graft")
                                     and n.data.get("dleaf") is None),
    }
    droot.data_notes = notes  # type: ignore[attr-defined]
    return droot


# ------------------------------------------------------------------ per file


def _r(x: float) -> float:
    return float(f"{x:.5g}")


def gen_entry(nd: Node) -> list | None:
    g = nd.data.get("gen_yr")
    if g is None:
        return None
    return [_r(g), GEN_HOW.index(nd.data.get("gen_how", "allometric"))]


def common_name(nd: Node) -> str | None:
    return nd.data.get("common_override") or (nd.data.get("red_list") or {}).get("common")


def file_meta(droot: DNode | None, rows: list[tuple[Node, bool]]) -> dict | None:
    """The dated tree induced on this file's species rows, plus their common names and generation lengths."""
    row_of = {id(nd): i for i, (nd, stub) in enumerate(rows) if not stub}
    common, gen = {}, {}
    for nd, stub in rows:
        if stub or not nd.is_leaf or not nd.name:
            continue
        i = row_of[id(nd)]
        c = common_name(nd)
        if c:
            common[str(i)] = c
        g = gen_entry(nd)
        if g:
            gen[str(i)] = g
    out: dict = {"common": common, "gen": gen}
    if droot is None:
        return out
    marked = {id(nd.data["dleaf"]) for nd, stub in rows if not stub and nd.data.get("dleaf") is not None}
    if not marked:
        return out
    # induce: postorder keep nodes with >= 2 marked branches
    keep: dict[int, DNode | None] = {}
    kids_of: dict[int, list[DNode]] = {}
    for d in reversed(list(droot.preorder())):
        if d.leaf is not None:
            keep[id(d)] = d if id(d) in marked else None
            continue
        ks = [keep[id(c)] for c in d.children if keep[id(c)] is not None]
        if not ks:
            keep[id(d)] = None
        elif len(ks) == 1:
            keep[id(d)] = ks[0]
        else:
            keep[id(d)] = d
            kids_of[id(d)] = ks
    top = keep[id(droot)]
    nodes, names, loose, notes = [], {}, {}, {}
    st = [(top, -1)]
    while st:
        d, par = st.pop()
        i = len(nodes)
        if d.leaf is not None:
            nodes.append([par, row_of[id(d.leaf)]])
            continue
        nodes.append([par, _r(d.age), _r(d.lo), _r(d.hi), d.src])
        if d.name:
            names[str(i)] = d.name
        if d.loose:
            loose[str(i)] = d.loose
        if d.note >= 0:
            notes[str(i)] = d.note
        st.extend((c, i) for c in reversed(kids_of[id(d)]))
    out.update({"nodes": nodes, "names": names, "loose": loose, "notes": notes})
    return out


def skeleton_meta(droot: DNode | None) -> dict:
    return {
        "sources": SRC_NAMES,
        "upham": "Upham, N.S., Esselstyn, J.A. & Jetz, W. (2019). Inferring the mammal tree: species-level "
                 "sets of phylogenies for questions in ecology, evolution, and conservation. PLoS Biology 17: "
                 "e3000494. Node-dated MCC tree of the completed 5,911-species posterior (topology-constrained, birth-death); node heights and 95% HPDs",
        "gen_how": GEN_HOW,
        "common_source": "IUCN Red List 2026-1 (GBIF checklist doi:10.15468/0qnb58), preferred English name",
        "overrides": getattr(droot, "data_notes", []) if droot is not None else [],
    }
