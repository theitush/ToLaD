"""The amniote fossils (ToLaD#539, build order step 6; research/amniote-sources.md, "The join" and §4).

**Which.** Every PBDB Amniota species (`amniota_species.json`) the mammal build does not read already
(`pbdb/mammalia_species.json`): the mammals stay exactly their own build's.

**Where (rows).** Through `merge.graft_pbdb`, as the mammals' fossils: onto its Open Tree leaf, else under its genus,
family or order in the rows. Where the rows have none of the three (the synthesis has no node for an extinct group),
it grafts through its **taxonomy path**: PBDB's own classification above the genus (`amniota_higher.json`), walked up
to the first taxon that is a node of the rows by name (Archosauria, Squamata, Mammalia, ...) or that holds living
species, by its PBDB descendants that are nodes of the rows (Dinosauria holds the birds). The PBDB taxa below it are
made as groups. A taxon holding living species without a node of its own is their **stem** (a wrapper round their
clade, as merge.total_group's): the non-avian dinosaurs sit in Dinosauria > Saurischia > Theropoda > Coelurosauria
round the birds, the cynodonts round the mammals.

Why PBDB's path and not OTT's (the research's word): OTT 3.7.3's Amniota has no Synapsida, Pseudosuchia or
Pantestudines, and files the pterosaurs, ichthyosaurs, plesiosaurs and Dimetrodon straight under Sauropsida,
incertae sedis. PBDB, the fossils' own source, places them; OTT's names still decide which rows nodes the path meets
(the rows are the synthesis', named by OTT).

**Ages decide what the classification cannot.** PBDB's deep reptile classes are not one tree with the living ones
(it files Lepidosauria under Sauria beside Eureptilia; its Archelosauria holds only the turtles), so a stem is first
put round its living species' clade, then moves out round each calibrated clade above it while its oldest fossil is
older than that clade's upper bound: merge.rehome_stem_fossils' rule for a fossil subtree, applied to a stem.
Eureptilia's Hylonomus (~312 Ma) cannot sit inside Sauria (Benton et al. 2015's soft maximum 295.9 Ma), so
Eureptilia is Sauria's stem, not Archelosauria's. A backbone split's upper bound is Benton's soft maximum where
amniotes.toml gives one (`soft_max`), else its TimeTree interval; a group tree's split, its own 95% interval.
Below its bound a fossil sets a minimum: every split is older than the fossils inside it (the backbone splits are
raised to them in the dated tree too; stats.json -> amniotes.fossils.backbone says each before and after).

**Dates** (#548's rules, merge.py): a fossil's band is its PBDB range (merge.pbdb_range); none ends after 1500 CE
(merge.assign_bands' end floor), so none reaches the recent for want of a date.

**The dated tree.** A stem is a split of its own, at its oldest fossil, round its living clade's dated node; a
fossil subtree under it keeps its rows shape and dates (dated._sub). Under any other rows node a fossil subtree joins
the dated tree as dated.build grafts the mammals' fossils: on the stem of the living species' dated crown when it is
older than the crown, else at that crown's split (`loose`).
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

from .dated import S_FLOOR, S_FOSSIL, DNode, _sub
from .load import norm_name, one_per_taxon
from .merge import EPS, _is_desc, _mrca, graft_pbdb, pbdb_range, rehome_stem_fossils
from .tree import D_UPHAM, Node

# What each fossil is called in the checks (the research's per-group table, §4 and §10): the first group whose PBDB
# taxon is in its path. A label, never a placement. PBDB files living birds under both Aves and Avialae.
GROUPS = [("Birds", ("Aves", "Avialae")), ("Non-avian dinosaurs", ("Dinosauria",)), ("Pterosaurs", ("Pterosauria",)),
          ("Crocodilians (crown)", ("Crocodylia",)), ("Other crocodylomorphs", ("Crocodylomorpha",)),
          ("Turtles (crown)", ("Testudines",)), ("Stem turtles", ("Testudinata", "Pantestudines")),
          ("Lizards and snakes", ("Squamata",)), ("Tuatara and kin", ("Rhynchocephalia", "Lepidosauria")),
          ("Marine reptiles", ("Ichthyopterygia", "Sauropterygia", "Thalattosauria")),
          ("Non-mammal synapsids", ("Synapsida", "Mammaliaformes")), ("Other archosaurs", ("Archosauria",)),
          ("Parareptiles", ("Parareptilia",)), ("Choristoderes", ("Choristodera",))]
# research/amniote-sources.md §10: fossils that would graft (extinct, with a range), per group
RESEARCH_GRAFTABLE = {"Birds": 1273, "Lizards and snakes": 972, "Turtles (crown + stem)": 1068,
                      "Crocodilians + crocodylomorphs": 630, "Tuatara and kin": 74, "Non-avian dinosaurs": 1717,
                      "Pterosaurs": 255, "Marine reptiles": 467, "Non-mammal synapsids": 786, "Other": 639}
LIST_GROUP = {"Aves": "Birds", "Squamata": "Lizards and snakes", "Testudines": "Turtles (crown)",
              "Crocodylia": "Crocodilians (crown)", "Rhynchocephalia": "Tuatara and kin"}
K_PG = 66.0  # Ma, the end of the Cretaceous (Maastrichtian top in PBDB's timescale)
P_TR = 251.902  # Ma, the end of the Permian: the Mesozoic's start


def group_of(path: list[str]) -> str:
    s = set(path)
    for label, names in GROUPS:
        if s.intersection(names):
            return label
    return "Other amniotes"


def research_group(g: str) -> str:
    """The research §10 row a group is counted in."""
    return {"Turtles (crown)": "Turtles (crown + stem)", "Stem turtles": "Turtles (crown + stem)",
            "Crocodilians (crown)": "Crocodilians + crocodylomorphs",
            "Other crocodylomorphs": "Crocodilians + crocodylomorphs", "Other archosaurs": "Other",
            "Parareptiles": "Other", "Choristoderes": "Other", "Other amniotes": "Other"}.get(g, g)


# ------------------------------------------------------------------ inputs


class PBDB:
    """PBDB's Amniota: the species outside the mammal build's list, and every taxon above them with its parent
    (`taxa`: orig_no -> record; a species' and a taxon's `parent_no` is its parent's orig_no)."""

    def __init__(self, species: list[dict], taxa: dict[str, dict], n_mammal: int = 0):
        self.taxa = taxa
        # (a taxon has a row per original name it absorbed: orig_no differs, taxon_no is the same; its children
        # point at one of them. Archosauria's own orig_no is not its taxon_no.)
        by: dict[str, dict[str, str]] = defaultdict(dict)
        for no, r in taxa.items():
            by[r["taxon_name"]].setdefault(r["taxon_no"], no)
        self.genus_by_name = {k: list(v.values()) for k, v in by.items()}
        # (none whose path runs through Mammalia: a mammal entered since the mammal list was pinned)
        self.species = [r for r in species if "Mammalia" not in self.path_names(r)]
        self.n_mammal = n_mammal + len(species) - len(self.species)

    @classmethod
    def load(cls, raw: Path) -> "PBDB":
        A = raw / "amniotes" / "pbdb"
        mam = json.loads((raw / "pbdb" / "mammalia_species.json").read_text())["records"]
        mam_no = {r["orig_no"] for r in mam} | {r["taxon_no"] for r in mam}
        allsp = json.loads((A / "amniota_species.json").read_text())["records"]
        taxa: dict[str, dict] = {}
        for f in ("amniota_higher.json", "amniota_genera.json"):
            for r in json.loads((A / f).read_text())["records"]:
                taxa[r["orig_no"]] = r
        sp = [r for r in allsp if not (r["orig_no"] in mam_no or r["taxon_no"] in mam_no)]
        return cls(one_per_taxon(sp), taxa, n_mammal=len(allsp) - len(sp))

    def parent_of_species(self, r: dict) -> str | None:
        if r.get("parent_no") in self.taxa:
            return r["parent_no"]
        g = self.genus_by_name.get((r.get("genus") or "").split(" (")[0], [])
        return g[0] if len(g) == 1 else None

    def path(self, r: dict) -> list[str]:
        """orig_nos from the species' genus up to the top PBDB holds (Amniota)."""
        out, no = [], self.parent_of_species(r)
        while no in self.taxa and no not in out:
            out.append(no)
            no = self.taxa[no].get("parent_no")
        return out

    def path_names(self, r: dict) -> list[str]:
        return [self.taxa[no]["taxon_name"] for no in self.path(r)]


# ------------------------------------------------------------------ the path


class Path_:
    """The taxonomy path (module docstring): graft_pbdb's `path` hook, and the stems it makes, placed afterwards."""

    def __init__(self, pb: PBDB, side: list[Node], mroot: Node, root: Node, anchors: list[str], log: dict):
        self.pb, self.mroot, self.root, self.log = pb, mroot, root, log
        # rows nodes by their own name (the sauropsids' clades, and Mammalia itself, never inside it)
        nodes: dict[str, list[Node]] = defaultdict(list)
        for top in side:
            for n in top.preorder():
                if n.is_leaf or not n.name or n.kind != "tree":
                    continue
                nodes[n.name].append(n)
        nodes["Mammalia"] = [mroot]
        self.node = {k: v[0] for k, v in nodes.items() if len(v) == 1}
        # each PBDB taxon's living members: the build's own clades (a group's crown, a backbone split, Mammalia:
        # `anchors`, complete in the rows and in PBDB alike) its PBDB descendants (or itself) are. (Not every rows
        # name: PBDB files a living order or family beside the taxon it belongs in often enough, Ornithuromorpha
        # holding the neognaths but not the palaeognaths, that a lower name would put a stem inside a crown.)
        self.mapped: dict[str, list[Node]] = defaultdict(list)
        anchor = {nm: self.node[nm] for nm in anchors if nm in self.node}
        for no, r in pb.taxa.items():
            nd = anchor.get(r["taxon_name"])
            if nd is None:
                continue
            x, seen = no, set()
            while x in pb.taxa and x not in seen:
                seen.add(x)
                self.mapped[x].append(nd)
                x = pb.taxa[x].get("parent_no")
        self._m: dict[str, Node | None] = {}
        self.stems: dict[str, Node] = {}  # orig_no -> its stem node (no parent until place())
        self.used: Counter = Counter()
        self.bucket: Node | None = None

    def living(self, no: str) -> Node | None:
        """The rows clade of a PBDB taxon's living members (their common ancestor), if it has any."""
        if no not in self._m:
            ns = self.mapped.get(no)
            self._m[no] = (ns[0] if len({id(x) for x in ns}) == 1 else _mrca(ns)) if ns else None
        return self._m[no]

    def __call__(self, r: dict, genus: str):
        """graft_pbdb's hook: (the node to graft under, the PBDB taxa between it and the genus, outer first, as
        (rank, name)), or None (no PBDB path: graft_pbdb's own ladder)."""
        path = self.pb.path(r)
        if not path:  # (PBDB has no genus record above it): Amniota, incertae sedis, under its PBDB order and family
            self.used["no PBDB path"] += 1
            return self._bucket(), [(k, r[k]) for k in ("order", "family") if r.get(k)]
        between = []
        for no in path[1:] if self.pb.taxa[path[0]]["taxon_name"] == genus else path:
            t = self.pb.taxa[no]
            nm = t["taxon_name"]
            nd = self.node.get(nm)
            if nd is not None:
                self.used["a rows node by name"] += 1
                return nd, [(self._rank(nm, r), x) for x in reversed(between)]
            L = self.living(no)
            if L is not None and L.parent is None:  # (living members on both sides: Amniota itself)
                self.used["the root"] += 1
                return L, [(self._rank(x, r), x) for x in reversed(between)]
            if L is not None:
                s = self.stems.get(no)
                if s is None:
                    s = Node(name=nm, rank="no rank", kind="tree", taxonomic=True)
                    s.data.update(created_from="PBDB", stem_taxon=no)
                    self.stems[no] = s
                self.used["the stem of living species"] += 1
                return s, [(self._rank(x, r), x) for x in reversed(between)]
            between.append(nm)
        self.used["no rows node on the path"] += 1
        return self._bucket(), [(self._rank(x, r), x) for x in reversed(between)]

    def _bucket(self) -> Node:
        if self.bucket is None:
            self.bucket = Node(name="Amniota incertae sedis (fossil)", rank="no rank", kind="bucket", taxonomic=True)
            self.root.add(self.bucket)
        return self.bucket

    @staticmethod
    def _rank(name: str, r: dict) -> str:
        return "family" if name == r.get("family") else "order" if name == r.get("order") else "no rank"

    def depth(self, no: str) -> int:
        d, x = 0, self.pb.taxa[no].get("parent_no")
        while x in self.pb.taxa and d < 200:
            d += 1
            x = self.pb.taxa[x].get("parent_no")
        return d

    def place(self, bound, first_min: dict[str, float]) -> dict:
        """Put each stem round its living clade, moved out past every calibrated clade its oldest fossil is older
        than (`bound(node)`: its upper bound, or None), never out of the first rows node its PBDB path names.
        Stems round the same clade nest by PBDB's order (outer: the higher taxon), then by age."""
        rep = {"stems": {}, "moved_out": []}
        targets: dict[int, list[tuple[Node, Node]]] = defaultdict(list)
        at: dict[int, Node] = {}
        for no, s in self.stems.items():
            leaves = [x for x in s.preorder() if x.is_leaf]
            s.data["floor"] = max((x.fad or 0.0) for x in leaves) if leaves else 0.0
            # (the younger end of each first appearance: a stem moves out of a clade only for a fossil certainly
            # older than the clade's bound, not one whose interval merely reaches past it)
            f = max((first_min.get(x.name, x.fad) or 0.0) for x in leaves) if leaves else 0.0
            X = self.living(no)
            # the first rows node by name above it in PBDB's path: the stem stays inside it
            A, x = None, self.pb.taxa[no].get("parent_no")
            while x in self.pb.taxa and A is None:
                A = self.node.get(self.pb.taxa[x]["taxon_name"])
                x = self.pb.taxa[x].get("parent_no")
            start = X
            while X.parent is not None and X.parent is not A:
                b = bound(X.parent)
                if b is None or f <= b:
                    break
                X = X.parent
            if X is not start:
                rep["moved_out"].append({"stem": s.name, "oldest_first_appearance_Ma": round(f, 2),
                                         "from": _label(start), "to": _label(X)})
            targets[id(X)].append((s, X))
            at[id(X)] = X
        for k, lst in targets.items():
            X = at[k]
            lst.sort(key=lambda sx: (-self.depth(sx[0].data["stem_taxon"]), sx[0].data["floor"]))  # inner first
            cur = X
            for s, _ in lst:
                par = cur.parent
                par.children[par.children.index(cur)] = s
                s.parent = par
                s.children.insert(0, cur)
                cur.parent = s
                s.data["total_group_of"] = X.name or "(unnamed clade)"
                rep["stems"][s.name] = {"round": _label(X), "oldest_fossil_Ma": round(s.data["floor"], 2),
                                        "fossils": sum(1 for x in s.preorder() if x.is_leaf and x.kind == "graft")}
                cur = s
        rep["path_used"] = dict(self.used)
        return rep


def _label(n: Node) -> str:
    return n.name or "(unnamed: " + ", ".join(x.name for x in n.preorder() if x.is_leaf)[:60] + ")"


# ------------------------------------------------------------------ the rows


def graft(root: Node, mroot: Node, srows: Node, lists, raw: Path, ov, anchors: list[str], log: dict
          ) -> tuple[Node, Node]:
    """Graft the fossils into the rows (Amniota root -> [mroot, srows], calibrated, before date_tree). Returns the
    outermost node of each side (the mammals' stems, the sauropsids' stems), as they now hang from the root."""
    from .merge import build_leaf_index
    pb = PBDB.load(raw)
    # a PBDB species of a listed species' own name, in the same group, is that species (its first appearance is
    # PBDB's; its end the list's): matched before graft_pbdb, whose family/order check fails where OTT's Sauria,
    # ranked an order, is the nearest "order" above a leaf (the great auk, under Neognathae)
    listed = {n.name: n for n in srows.preorder() if n.is_leaf and n.data.get("list")}
    pre, rest = 0, []
    for r in pb.species:
        L = listed.get(norm_name(r["taxon_name"]))
        if L is not None and research_group(group_of(pb.path_names(r))) == research_group(LIST_GROUP.get(
                L.data.get("group"), "")):
            L.pbdb = int(r["taxon_no"]) if r.get("taxon_no") else None
            rng = pbdb_range(r)
            if rng:
                L.fad = rng[0]
            pre += 1
            continue
        rest.append(r)
    pb.species = rest
    exact, syn = build_leaf_index(srows, lists.syn, {})
    hook = Path_(pb, [srows], mroot, root, anchors, log)
    glog: dict = {}
    graft_pbdb(srows, pb.species, exact, syn, glog, ov, bucket_name="Amniota incertae sedis (fossil)", path=hook)
    rep = {"pbdb": {"species_outside_the_mammals": len(pb.species) + pre, "in_the_mammal_build": pb.n_mammal,
                    "a listed species by name": pre},
           "graft": glog["pbdb_graft"], "match": glog["pbdb_match"]}
    first_min = {norm_name(r["taxon_name"]): float(r["firstapp_min_ma"]) for r in pb.species
                 if r.get("firstapp_min_ma") is not None}
    rep.update(hook.place(_bound, first_min))
    # the stems hang where their living clade hung; a fossil subtree older than a calibrated crown's upper bound moves
    # to that crown's stem (merge.rehome_stem_fossils; never inside the mammal build, so it is hidden meanwhile)
    kids = mroot.children
    mroot.children = []
    try:
        rehome_stem_fossils(root, glog)
    finally:
        mroot.children = kids
    rep["rehomed"] = {k: glog["stem_rehoming"][k] for k in ("subtrees_moved", "by_crown", "largest_age_gaps")}
    # a stem whose fossils all moved out (older than a crown round it) is no stem: its living clade takes its place
    emptied = []
    for s in hook.stems.values():
        if s.parent is not None and len(s.children) == 1:
            c, par = s.children[0], s.parent
            par.children[par.children.index(s)] = c
            c.parent = par
            s.parent, s.children = None, []
            emptied.append(s.name)
    rep["stems_emptied"] = sorted(emptied)
    # each fossil's group, for the checks
    groups = Counter()
    for r in pb.species:
        r["_group"] = group_of(pb.path_names(r))
    by_name = {norm_name(r["taxon_name"]): r for r in pb.species}
    for n in _outside(root, mroot):
        if n.is_leaf and n.kind == "graft":
            r = by_name.get(n.name)
            g = r["_group"] if r else "Other amniotes"
            n.data["fossil_group"] = g
            groups[g] += 1
    rep["grafted_by_group"] = dict(groups.most_common())
    rep["at_amniota"] = sorted(c.name for c in root.children if c is not mroot and c is not srows
                               and not _is_desc(mroot, c) and not _is_desc(srows, c))
    log["fossils"] = rep
    side = lambda x: next(c for c in root.children if _is_desc(x, c))  # noqa: E731
    return side(mroot), side(srows)


def _outside(root: Node, skip: Node):
    st = [root]
    while st:
        n = st.pop()
        if n is skip:
            continue
        yield n
        st.extend(reversed(n.children))


def _bound(n: Node) -> float | None:
    """A calibrated rows node's upper bound for the fossils inside it (its dated split's 95% interval, or a backbone
    split's soft maximum); None for one no dated tree dates."""
    if n.date_src != D_UPHAM or n.data.get("total_group_of"):
        return None
    h = n.data.get("age_hpd")
    return h[1] if h else n.age


# ------------------------------------------------------------------ the dated tree


def backbone_minima(crowns: dict[str, DNode], rows_by_name: dict[str, Node], names: list[str], log: dict) -> None:
    """The backbone splits take their rows node's age when that is older: the oldest fossil inside (and every split
    below) sets the minimum, as date_tree does on the rows. Bottom-up, each kept older than its daughters."""
    rep = {}
    order = sorted(names, key=lambda nm: crowns[nm].age)
    for nm in order:
        d = crowns[nm]
        before = d.age
        n = rows_by_name.get(nm)
        need = max([d.age, n.age if n is not None and n.age is not None else 0.0]
                   + [c.age + EPS for c in d.children if c.leaf is None])
        if need > d.age:
            d.age, d.hi, d.src = need, max(d.hi, need), S_FLOOR
        rep[nm] = {"before_Ma": round(before, 3), "after_Ma": round(d.age, 3),
                   "raised_by": None if d.age <= before else "a fossil inside it" if n is not None and
                   n.data.get("raised_by_fossil") else "a split below it"}
    log["backbone"] = rep


def dated_fossils(sides: list[tuple[Node, DNode]], mroot: Node, log: dict) -> list[DNode]:
    """Hang every fossil and stem on the dated tree. `sides`: (the rows' outermost node of a side, the dated tree
    of its living species). The mammals' rows count as one living species, their dated tree as its leaf: nothing
    inside either changes. Returns each side's dated top. A rows node's fossils stay inside its own part of the
    dated tree: a stem split climbs only over the splits made for the same rows node, and is kept below the next."""
    from .dated import _depths, _lca
    how = Counter()
    clamped = 0
    out = []
    for top, droot in sides:
        holder = DNode(age=float("inf"))  # (a parent for the side's dated top while stems go on above it)
        holder.add(droot)
        order: list[Node] = []
        st = [top]
        while st:
            n = st.pop()
            order.append(n)
            if n is not mroot:
                st.extend(reversed(n.children))
        dep = _depths(holder)
        m: dict[int, DNode | None] = {}
        k: dict[int, int] = {}
        for n in reversed(order):
            if n is mroot:
                m[id(n)], k[id(n)] = droot, 1
            elif n.is_leaf:
                dl = n.data.get("dleaf")
                m[id(n)], k[id(n)] = dl, 1 if dl is not None else 0
            else:
                mm, kk = None, 0
                for c in n.children:
                    if m[id(c)] is not None:
                        mm = m[id(c)] if mm is None else _lca(mm, m[id(c)], dep)
                        kk += k[id(c)]
                m[id(n)], k[id(n)] = mm, kk
        owner: dict[int, Node] = {}  # a split made here -> the rows node it was made for

        def top_inside(A: DNode, p: Node) -> DNode:
            while A.parent is not None and id(A.parent) in owner and _is_desc(owner[id(A.parent)], p):
                A = A.parent
            return A

        for p in reversed(order):  # children before parents: an inner stem's split is on before the one round it
            if p.is_leaf or p is mroot or k[id(p)] == 0:
                continue
            fos = [c for c in p.children if k[id(c)] == 0]
            if not fos and not p.data.get("total_group_of"):
                continue
            A = top_inside(m[id(p)], p)
            if p.data.get("total_group_of"):
                # a stem: a split of its own round its living clade, at its oldest fossil
                P = A.parent
                age = max(p.age, A.age + EPS)
                if age >= P.age:
                    age = (A.age + P.age) / 2
                    clamped += 1
                x = DNode(age=age, lo=age, hi=age, src=S_FOSSIL, name=(p.name or "").split(" (")[0] or None)
                P.children[P.children.index(A)] = x
                x.parent = P
                x.add(A)
                owner[id(x)] = p
                for c in fos:
                    sub = _sub(c, set())
                    if sub is not None:
                        x.add(sub)
                        how["on a stem's own split"] += 1
                continue
            for c in fos:
                sub = _sub(c, set())
                if sub is None:
                    continue
                g = max(c.t0, sub.age)
                if g > A.age + EPS or A.leaf is not None:  # older than its living crown: on the crown's stem
                    B = A
                    while (B.parent is not None and id(B.parent) in owner and owner[id(B.parent)] is p
                           and B.parent.age < g):
                        B = B.parent
                    P = B.parent
                    age = max(g, A.age * 1.02 + 0.01)
                    if P is not holder:
                        age = min(age, P.age - EPS)
                    if age <= B.age + EPS / 2:
                        (B if B.leaf is None else P).add(sub)
                        how["on a stem, joins a split of the same age"] += 1
                        continue
                    x = DNode(age=age, lo=age, hi=P.age if P is not holder else age, src=S_FOSSIL, anchor=A)
                    P.children[P.children.index(B)] = x
                    x.parent = P
                    x.add(B)
                    x.add(sub)
                    owner[id(x)] = p
                    how["on a stem (fossil)"] += 1
                else:
                    A.add(sub)
                    A.loose += 1
                    how["joins a split (loose)"] += 1
        top_d = holder.children[0]
        holder.children = []
        top_d.parent = None
        out.append(top_d)
    # merged ages inside a graft can sit above a clamped attachment: keep every split below its parent
    for top_d in out:
        for d in top_d.preorder():
            if d.parent is not None and d.leaf is None and d.age >= d.parent.age:
                d.age = d.parent.age * (1 - 2e-3)
                d.lo, d.hi = min(d.lo, d.age), min(max(d.hi, d.age), d.parent.age)
                clamped += 1
            if d.leaf is not None:
                d.leaf.data["dleaf"] = d
    log["dated"] = {"how": dict(how), "clamped_below_parent": clamped}
    return out


# ------------------------------------------------------------------ checks


def checks(root: Node, mroot: Node) -> dict:
    """Plausibility (the #113 habit): counts per group against the research's §10, the non-avian dinosaurs ended by
    the K-Pg, pterosaurs and marine reptiles inside the Mesozoic, no fossil alive into the recent."""
    fos = [n for n in _outside(root, mroot) if n.is_leaf and n.kind == "graft"]
    by = Counter(n.data.get("fossil_group") for n in fos)
    res = Counter()
    for g, v in by.items():
        res[research_group(g)] += v
    late_dinos = sorted((n.name, round(n.t1, 3)) for n in fos
                        if n.data.get("fossil_group") == "Non-avian dinosaurs" and n.t1 < K_PG - 1e-6)
    out_meso = {g: sorted((n.name, round(n.t0, 2), round(n.t1, 2)) for n in fos if n.data.get("fossil_group") == g
                          and (n.t0 > P_TR + 1e-6 or n.t1 < K_PG - 1e-6))
                for g in ("Pterosaurs", "Marine reptiles")}
    return {
        "fossils": len(fos),
        "by_group": dict(by.most_common()),
        "vs_research_graftable": {g: {"here": res.get(g, 0), "research": v} for g, v in RESEARCH_GRAFTABLE.items()},
        "non_avian_dinosaurs_after_K_Pg": {"n": len(late_dinos), "names": late_dinos[:40]},
        "outside_the_Mesozoic": {g: {"n": len(v), "names": v[:40]} for g, v in out_meso.items()},
        "fossils_alive_into_the_recent": sorted(n.name for n in fos if n.t1 <= 0.0),
        "oldest_Ma": {g: round(max(n.t0 for n in fos if n.data.get("fossil_group") == g), 2) for g in by},
    }
