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

SRC_NAMES = ["upham", "upham-imputed", "fossil", "interpolated", "override", "alvarez", "ensemble", "upham-interp",
             "fossil-floor"]
S_UPHAM, S_IMPUTED, S_FOSSIL, S_INTERP, S_OVERRIDE, S_ALVAREZ, S_ENSEMBLE, S_UPINTERP, S_FLOOR = range(9)
# The ages rule the build applies (research/dated-tree-sources.md §5): "alvarez" (candidate A: Álvarez-Carretero
# ages on the clades both trees share) or "ensemble" (candidate B: their geometric mean). The build scores both.
AGES = "ensemble"
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
    name_en: str | None = None  # the taxon's English form, from a [[dated_name]] override ("small cat")
    note: int = -1  # index into the dated overrides list (its citation)
    h: float = 0.0  # Upham's own height (Ma): the shape that unshared splits are interpolated in
    cand: dict | None = None  # {"alvarez"|"ensemble": (age, lo, hi, src)}: both ages rules, before fossil floors
    loose: int = 0  # daughters placed by taxonomy only (where inside the split is not known)
    imputed: bool = False  # a leaf Upham placed without genetic data
    graft: bool = False  # a leaf placed by taxonomy only (a graft), not by a phylogeny or an override
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
            d = DNode(age=u.height, lo=lo, hi=hi, src=S_IMPUTED if any(k.imputed for k in kids) else S_UPHAM,
                      h=u.height)
            for k in kids:
                d.add(k)
            out[id(u)] = d
    root = out[id(up_root)]
    root.parent = None
    log["upham_tips_dropped"] = dict(dropped)
    return root


# ------------------------------------------------------------------ 1b. ages: Álvarez-Carretero et al. 2022

AC_FILE = ("alvarez", "4705sp_mammal-time.tree")
AC_CITE = ("Álvarez-Carretero, S., Tamuri, A.U., Battini, M. et al. (2022). A species-level timeline of mammal "
           "evolution integrating phylogenomic data. Nature 602: 263-267. 4,705-species timetree (mean ages, 95% CIs)")
RULES = ("alvarez", "ensemble")

# The benchmark (research/dated-tree-sources.md §3): each node is the MRCA of its species; the consensus range in Ma
BENCH = [
    ("Homo-Pan", ["Homo sapiens", "Pan troglodytes"], 6, 8),
    ("crown Panthera", ["Panthera tigris", "Panthera leo"], 4, 6.5),
    ("crown Felidae", ["Panthera leo", "Felis catus"], 11, 16),
    ("crown Canidae", ["Canis lupus", "Urocyon cinereoargenteus", "Vulpes vulpes"], 9, 14),
    ("crown Ursidae", ["Ailuropoda melanoleuca", "Ursus arctos"], 17, 22),
    ("crown Pinnipedia", ["Phoca vitulina", "Zalophus californianus"], 22, 27),
    ("Caniformia", ["Canis lupus", "Ursus arctos"], 42, 50),
    ("crown Carnivora", ["Canis lupus", "Felis catus"], 50, 60),
    ("Mus-Rattus", ["Mus musculus", "Rattus norvegicus"], 10.4, 14),
    ("Whippomorpha", ["Tursiops truncatus", "Hippopotamus amphibius"], 52, 58),
    ("crown Cetacea", ["Eubalaena glacialis", "Tursiops truncatus"], 34, 38),  # same node; no rorqual is in it (a bug)
    ("crown Primates", ["Homo sapiens", "Lemur catta"], 65, 75),
    ("Euarchontoglires", ["Homo sapiens", "Mus musculus"], 76, 90),
    ("crown Placentalia", ["Homo sapiens", "Dasypus novemcinctus", "Loxodonta africana"], 85, 100),
    ("Theria", ["Homo sapiens", "Macropus giganteus"], 157, 170),
]


def load_alvarez(raw) -> list[tuple[set[str], float, float, float]]:
    """A-C's timetree as clades, postorder: (the binomials under it, mean age, 95% lo, hi), ages in Ma.

    Tips are `genus_species[_subspecies]`: a species with several subspecies tips is all of them."""
    from .newick import parse_comment, parse_nexus_tree
    t = parse_nexus_tree((raw / AC_FILE[0] / AC_FILE[1]).read_text())
    height: dict[int, float] = {}
    tips: dict[int, set[str]] = {}
    out = []
    for u in t.iter_postorder():
        if not u.children:
            b = (u.label or "").split("_")
            height[id(u)], tips[id(u)] = 0.0, {f"{b[0].capitalize()} {b[1]}"} if len(b) >= 2 else set()
            continue
        c = u.children[0]
        h = height[id(u)] = height[id(c)] + (c.length or 0.0)
        tips[id(u)] = set().union(*(tips.pop(id(c)) for c in u.children))
        ci = parse_comment(u.comment).get("95%")
        lo, hi = (float(x) for x in ci.strip("{}").split(",")) if ci else (h, h)
        out.append((tips[id(u)], h * 100, lo * 100, hi * 100))  # units of 100 Myr
    return out


def redate(droot: DNode, ac, exact: dict, syn: dict, log: dict) -> None:
    """Both ages rules on every Upham split (d.cand), then the chosen one (AGES) applied.

    A split whose shared species (in both trees) are exactly an A-C clade is dated: by A-C ("alvarez"), or by the
    geometric mean of the two ages with the union of their 95% ranges ("ensemble"). Nested Upham splits over the
    same shared species: only the youngest is dated. Every other split is interpolated linearly in Upham's height
    between its nearest dated ancestor and the oldest dated split below it (a tip counts as 0): `upham-interp`,
    or `upham-imputed` where a daughter was placed with no genetic data."""
    import math
    key: dict[str, int] = {}
    for d in droot.preorder():
        if d.leaf is not None:
            for n in (d.leaf.name, *d.leaf.data.get("upham_names", [])):
                key.setdefault(n, id(d))

    def lookup(b: str) -> int | None:
        if b in key:
            return key[b]
        for nd in ([exact[b]] if b in exact else []) + list(syn.get(b, [])):
            dl = nd.data.get("dleaf")
            if dl is not None:
                return id(dl)
        return None

    kmap = {b: lookup(b) for b in ac[-1][0]}
    clade: dict[frozenset, tuple[float, float, float]] = {}
    for s, age, lo, hi in ac:  # postorder: of nested A-C clades over the same shared species, the youngest
        f = frozenset(kmap[b] for b in s if kmap[b] is not None)
        if len(f) >= 2:
            clade.setdefault(f, (age, lo, hi))
    shared = {v for v in kmap.values() if v is not None}
    post = list(reversed(list(droot.preorder())))
    S: dict[int, frozenset] = {}
    matched: dict[int, tuple[float, float, float]] = {}
    for d in post:
        if d.leaf is not None:
            S[id(d)] = frozenset([id(d)]) if id(d) in shared else frozenset()
            continue
        f = frozenset().union(*(S[id(c)] for c in d.children))
        S[id(d)] = f
        if len(f) >= 2 and f in clade and all(S[id(c)] != f for c in d.children):
            matched[id(d)] = clade[f]
    del S
    for rule in RULES:
        new: dict[int, tuple[float, float, float]] = {}
        for d in post:
            if id(d) in matched:
                a, lo, hi = matched[id(d)]
                new[id(d)] = (a, lo, hi) if rule == "alvarez" else (math.sqrt(a * d.h), min(lo, d.lo), max(hi, d.hi))
        below: dict[int, tuple[float, float]] = {}  # the oldest dated split below: (new age, Upham height)
        for d in post:
            if d.leaf is not None:
                below[id(d)] = (0.0, 0.0)
                continue
            below[id(d)] = max(((new[id(c)][0], c.h) if id(c) in new else below[id(c)] for c in d.children))
        anc: dict[int, tuple[float, float] | None] = {}
        for d in droot.preorder():
            p = d.parent
            anc[id(d)] = None if p is None else (new[id(p)][0], p.h) if id(p) in new else anc[id(p)]
            if d.leaf is not None:
                continue
            if id(d) in new:
                d.cand = {**(d.cand or {}), rule: (*new[id(d)], S_ALVAREZ if rule == "alvarez" else S_ENSEMBLE)}
                continue
            A, (dn, dh) = anc[id(d)], below[id(d)]

            def f(x: float) -> float:
                if A is None:
                    return x * dn / dh if dh > 0 else x
                an, ah = A
                if ah - dh <= EPS:
                    return (an + dn) / 2
                return dn + (an - dn) * min(1.0, max(0.0, (x - dh) / (ah - dh)))

            age = f(d.h)
            d.cand = {**(d.cand or {}), rule: (age, min(f(d.lo), age), max(f(d.hi), age),
                                               S_IMPUTED if d.src == S_IMPUTED else S_UPINTERP)}
    for d in droot.preorder():
        if d.leaf is None:
            d.age, d.lo, d.hi, d.src = d.cand[AGES]
            if d.parent is not None and d.age >= d.parent.age:
                d.age = d.parent.age * (1 - 2e-3)
                d.lo = min(d.lo, d.age)
    log["ages"] = {
        "rule": AGES,
        "alvarez_binomials": len(kmap),
        "alvarez_binomials_matched": sum(1 for v in kmap.values() if v is not None),
        "shared_species": len(shared),
        "splits_dated": len(matched),
        "splits_interpolated": sum(1 for d in post if d.leaf is None) - len(matched),
    }


def fossil_floors(root: Node, m: dict, k: dict, skip: set[int]) -> dict[int, tuple[float, str, DNode]]:
    """The fossil floor: a fossil species of a living genus is inside that genus's crown, so the crown is no
    younger than its first appearance. {id(crown): (oldest first appearance, that fossil, crown)}."""
    out: dict[int, tuple[float, str, DNode]] = {}
    for nd in root.preorder():
        p = nd.parent
        if p is None or k[id(nd)] > 0 or k[id(p)] == 0 or p.rank != "genus" or p.data.get("total_group_of"):
            continue
        A = m[id(p)]
        if A is None or A.leaf is not None or not nd.is_leaf or not nd.name:
            continue
        gw = nd.name.split()[0]  # the fossil's genus is the crown's only genus (Open Tree has odd "genus" nodes)
        if any(x.leaf.name.split()[0] != gw for x in A.preorder() if x.leaf is not None):
            continue
        sub = _sub(nd, skip)
        if sub is None or not all(x.leaf.extinct or x.leaf.t1 > 0 for x in sub.preorder() if x.leaf is not None):
            continue
        g = max(nd.t0, sub.age)
        if id(A) not in out or g > out[id(A)][0]:
            out[id(A)] = (g, nd.name or "?", A)
    return out


def _floored(age: float, parent_age: float | None, floor: float | None) -> float:
    """A crown's age under its fossil floor; never up to its parent's split (the backbone keeps its order)."""
    if floor is None or floor <= age:
        return age
    return min(floor, parent_age * (1 - 2e-3)) if parent_age is not None else floor


def benchmark(droot: DNode, floors: dict, rule: str) -> dict:
    """The 15 benchmark nodes under one ages rule (with fossil floors), and its score."""
    import math
    by: dict[str, DNode] = {}
    for d in droot.preorder():
        if d.leaf is not None:
            for n in (d.leaf.name, *d.leaf.data.get("upham_names", [])):
                by.setdefault(n, d)

    def age_of(d: DNode) -> float:
        return d.cand[rule][0] if d.cand else d.age

    rows, offs = {}, []
    for name, sps, lo, hi in BENCH:
        if any(s not in by for s in sps):
            rows[name] = None
            continue
        d = _mrca([by[s] for s in sps])
        fl = floors.get(id(d))
        a = _floored(age_of(d), age_of(d.parent) if d.parent is not None else None, fl[0] if fl else None)
        rows[name] = [round(a, 2), lo <= a <= hi]
        offs.append(abs(math.log(a / math.sqrt(lo * hi))))
    offs.sort()
    med = (offs[len(offs) // 2] + offs[(len(offs) - 1) // 2]) / 2 if offs else 0.0
    return {"inside": sum(1 for r in rows.values() if r and r[1]), "of": len(BENCH),
            "median_factor_off": round(math.exp(med), 3), "nodes": rows}


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
        for sci, cn in e.get("common", {}).items():
            if sci not in names:
                raise RuntimeError(f"overrides.toml dated_clade {e['name']}: common name for {sci!r}, not in its tree")
            by_name[sci].leaf.data["common_override"] = cn
        root = _replace(m, new, root)
        ov.applied["dated_clade"].append({"name": e["name"], "species": len(names),
                                          "replaced_age": round(m.age, 4), "age": t[1]})
    placed: set[int] = set()
    fossils = {n.name: n for n in merged.preorder() if n.is_leaf and n.name and eligible(n)}
    ents = []
    # a domestic leaf (ToLaD#175) branches off its wild ancestor's lineage like a dated fossil
    for e in ov.dated_fossils + ov.domestic_leaves:
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
        return DNode(leaf=nd, graft=True)
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


def _mrca_map(root: Node, droot: DNode) -> tuple[dict, dict, dict]:
    """The dated tree's MRCA of the matched species under every merged node, and how many there are."""
    dep = _depths(droot)
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
    return m, k, dep


def _label(d: DNode) -> str:
    if d.name:
        return d.name
    sp = [x.leaf.name for x in d.preorder() if x.leaf is not None]
    return f"{sp[0]} + {sp[-1]}" if len(sp) > 1 else sp[0]


def apply_names(droot: DNode, ov) -> int:
    """overrides.toml `[[dated_name]]`: a taxon name (and its English form) for the split that founds it.

    With `genera`, the split is the common ancestor of the dated species of those genera, and it must hold
    no other genus's species (Open Tree's taxonomy keeps NCBI's outdated felid subfamilies, so Pantherinae
    and Felinae are not clades of its synthesis tree); without, the entry names the split Open Tree already
    named `name`. Returns the number of splits it newly named."""
    leaves = [d for d in droot.preorder() if d.leaf is not None]
    new = 0
    for e in ov.dated_names:
        if e.get("genera"):
            gs = set(e["genera"])
            mine = [d for d in leaves if d.leaf.name.split()[0] in gs]
            if not mine:
                raise RuntimeError(f"overrides.toml dated_name {e['name']}: no dated species of {sorted(gs)}")
            m = _mrca(mine)
            other = sorted({d.leaf.name for d in m.preorder() if d.leaf is not None} - {d.leaf.name for d in mine})
            if other:
                raise RuntimeError(f"overrides.toml dated_name {e['name']}: the common ancestor of {sorted(gs)} "
                                   f"also holds {other}")
            new += m.name is None
        else:
            hit = [d for d in droot.preorder() if d.leaf is None and d.name == e["name"]]
            if len(hit) != 1:
                raise RuntimeError(f"overrides.toml dated_name {e['name']}: {len(hit)} splits named so, not 1")
            m = hit[0]
        m.name = e["name"]
        m.name_en = e.get("common") or None
        ov.applied["dated_name"].append({"name": e["name"], "common": m.name_en,
                                         "species": sum(1 for d in m.preorder() if d.leaf is not None)})
    return new


def build(root: Node, up_root, up_tax: dict[str, dict], ov, log: dict, ac=None, names=({}, {})) -> DNode:
    """The whole dated tree; sets n.data["dleaf"] on every species leaf in it.

    `ac`: load_alvarez()'s clades (None keeps Upham's own ages); `names`: the merged tree's (exact, synonym) index."""
    rep: dict = {}
    droot = from_upham(up_root, up_tax, rep)
    for d in droot.preorder():
        if d.leaf is not None:
            d.leaf.data["dleaf"] = d
    if ac is not None:
        redate(droot, ac, *names, rep)
        m, k, _ = _mrca_map(root, droot)
        fl = fossil_floors(root, m, k, set())
        rep["benchmark"] = {r: benchmark(droot, fl, r) for r in RULES}
    notes: list[dict] = []
    droot, placed = apply_overrides(droot, root, ov, notes)

    # the dated tree's MRCA of the matched species under every merged node (before grafting)
    m, k, dep = _mrca_map(root, droot)
    nleaf: dict[int, int] = {}
    for d in reversed(list(droot.preorder())):
        nleaf[id(d)] = 1 if d.leaf is not None else sum(nleaf[id(c)] for c in d.children)
    # names: the outermost named merged clade with exactly the same species
    named = 0
    for nd in root.preorder():
        d = m[id(nd)]
        if nd.is_leaf or not nd.name or d is None or d.leaf is not None or d.name or k[id(nd)] != nleaf[id(d)]:
            continue
        d.name = nd.name.removesuffix(" (crown)")
        named += 1
    named += apply_names(droot, ov)
    ov.check_all_used(dated=True)

    # fossil floors: no crown younger than a fossil of its genus (capped below the crown's parent split)
    if ac is not None:
        floors = []
        for g, fossil, A in sorted(fossil_floors(root, m, k, placed).values(), key=lambda x: -x[0]):
            new = _floored(A.age, A.parent.age if A.parent is not None else None, g)
            if A.src == S_OVERRIDE or new <= A.age:
                continue
            floors.append({"clade": _label(A), "from": round(A.age, 3), "to": round(new, 3), "fossil": fossil,
                           "first_appearance": round(g, 3), "capped": new < g})
            A.age, A.lo, A.hi, A.src = new, max(A.lo, new), max(A.hi, new), S_FLOOR
        rep["fossil_floors"] = floors

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
        g = max(nd.t0, sub.age)  # its band start, never below its own oldest split (a group starts at its genus record)
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
            if age <= B.age + EPS / 2:  # a split already there at this age (a graft of the same first appearance): join it
                (B if B.leaf is None else P).add(sub)
                how["on a stem, joins a graft of the same age"] += 1
                continue
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
    nodes, names, names_en, loose, notes, grafts = [], {}, {}, {}, {}, []
    st = [(top, -1)]
    while st:
        d, par = st.pop()
        i = len(nodes)
        if d.leaf is not None:
            nodes.append([par, row_of[id(d.leaf)]])
            if d.graft:
                grafts.append(row_of[id(d.leaf)])
            continue
        nodes.append([par, _r(d.age), _r(d.lo), _r(d.hi), d.src])
        if d.name:
            names[str(i)] = d.name
        if d.name_en:
            names_en[str(i)] = d.name_en
        if d.loose:
            loose[str(i)] = d.loose
        if d.note >= 0:
            notes[str(i)] = d.note
        st.extend((c, i) for c in reversed(kids_of[id(d)]))
    out.update({"nodes": nodes, "names": names, "names_en": names_en, "loose": loose, "notes": notes, "grafts": sorted(grafts)})
    return out


def skeleton_meta(droot: DNode | None) -> dict:
    return {
        "sources": SRC_NAMES,
        "upham": "Upham, N.S., Esselstyn, J.A. & Jetz, W. (2019). Inferring the mammal tree: species-level "
                 "sets of phylogenies for questions in ecology, evolution, and conservation. PLoS Biology 17: "
                 "e3000494. Node-dated MCC tree of the completed 5,911-species posterior (topology-constrained, birth-death); node heights and 95% HPDs",
        "alvarez": AC_CITE,
        "ages": AGES,
        "gen_how": GEN_HOW,
        "common_source": "IUCN Red List 2026-1 (GBIF checklist doi:10.15468/0qnb58), preferred English name",
        "overrides": getattr(droot, "data_notes", []) if droot is not None else [],
    }
