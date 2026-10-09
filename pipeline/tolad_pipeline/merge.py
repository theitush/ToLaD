"""Name matching (Upham, PBDB -> Open Tree), fossil grafting and dating."""

from __future__ import annotations

from collections import Counter, defaultdict

from .load import norm_name
from .newick import NNode
from .tree import (BINOMIAL, D_ANCHOR, D_FOSSIL, D_INTERP, D_UPHAM, Node,
                   ancestor_of_rank)

EPS = 1e-4  # Myr; minimum separation enforced between nested ages


def leaf_context(nd: Node) -> tuple[str | None, str | None]:
    fam = ancestor_of_rank(nd, "family")
    order = ancestor_of_rank(nd, "order")
    return (fam.name if fam else None, order.name if order else None)


def ancestor_names(nd: Node) -> set[str]:
    out = set()
    p = nd.parent
    while p is not None:
        if p.name:
            out.add(p.name)
        out.update(p.alt)
        p = p.parent
    return out


def build_leaf_index(root: Node, ott_syn: dict[int, list[str]], phy_syn: dict[str, str]):
    """name -> OT leaf, with a second map for synonyms."""
    exact: dict[str, Node] = {}
    syn: dict[str, list[Node]] = defaultdict(list)
    for nd in root.preorder():
        if nd.is_leaf and nd.name and nd.kind == "tree" and not nd.data.get("empty_higher"):
            exact[nd.name] = nd
    for nm, nd in list(exact.items()):
        cands = set(nd.alt)
        for s in ott_syn.get(nd.ott, []):
            s2 = norm_name(s)
            if BINOMIAL.match(s2):
                cands.add(s2)
        if nm in phy_syn:
            cands.add(phy_syn[nm])
        for c in cands:
            if c != nm:
                syn[c].append(nd)
    # PHYLACINE old-name -> 1.2-name also lets 1.2 names find an old OT name
    rev: dict[str, list[str]] = defaultdict(list)
    for old, new in phy_syn.items():
        rev[new].append(old)
    for new, olds in rev.items():
        for o in olds:
            if o in exact and new not in exact:
                syn[new].append(exact[o])
    return exact, syn


def context_ok(nd: Node, family: str | None, order: str | None) -> bool:
    """Parent-context check: the candidate must sit under the given family or
    order (by name, anywhere in its ancestry) when we know them."""
    names = ancestor_names(nd)
    if not names:
        return True
    if family and family in names:
        return True
    if order and order in names:
        return True
    fam, ordr = leaf_context(nd)
    # no family/order information on the OT side: accept
    return fam is None and ordr is None


def match_upham(root: Node, up_root: NNode, up_tax: dict[str, dict], exact, syn, log: dict) -> dict[str, Node]:
    how = Counter()
    mapping: dict[str, Node] = {}
    taken: set[int] = set()
    for tip in up_root.leaves():
        t = up_tax.get(tip.label)
        if t is None:
            how["no taxonomy row"] += 1
            continue
        hit = None
        method = None
        for cand, meth in ((t["name"], "exact"), (t["msw3"], "msw3-name")):
            if cand and cand in exact:
                nd = exact[cand]
                if id(nd) not in taken and context_ok(nd, t["family"], t["order"]):
                    hit, method = nd, meth
                    break
        if hit is None:
            for cand in (t["name"], t["msw3"]):
                for nd in syn.get(cand, []) if cand else []:
                    if id(nd) not in taken and context_ok(nd, t["family"], t["order"]):
                        hit, method = nd, "synonym"
                        break
                if hit:
                    break
        if hit is None:
            how["unmatched"] += 1
            continue
        how[method] += 1
        taken.add(id(hit))
        hit.upham = tip.label
        hit.data["upham_names"] = [x for x in (t["name"], t["msw3"]) if x]
        hit.data["upham_family"] = t["family"]
        hit.data["upham_order"] = t["order"]
        tip.ot = hit
        mapping[tip.label] = hit
        if t["extinct"]:
            hit.data["upham_extinct"] = True
    n = sum(1 for _ in up_root.leaves())
    log["upham_match"] = {"tips": n, **how, "rate": round(len(mapping) / n, 4)}
    return mapping


# ------------------------------------------------------------------ extinct


def set_extinct_flags(root: Node, phy: dict, pbdb_by_name: dict, log: dict) -> None:
    c = Counter()
    for nd in root.preorder():
        if not nd.is_leaf or nd.kind != "tree" or nd.data.get("empty_higher"):
            continue
        p = phy.get(nd.name)
        if p is not None:
            st = p["iucn"]
            nd.data["iucn"] = st
            if st in ("EP", "EX"):
                nd.extinct = True
                nd.data["extinct_by"] = "PHYLACINE " + st
            c["phylacine:" + ("extinct" if nd.extinct else "living")] += 1
            continue
        if nd.data.get("upham_extinct"):
            nd.extinct = True
            nd.data["extinct_by"] = "Upham"
        elif nd.upham:
            pass  # in Upham as living
        else:
            pb = pbdb_by_name.get(nd.name)
            flags = nd.data.get("ott_flags", set())
            if pb is not None and pb.get("is_extant") == "extinct":
                nd.extinct = True
                nd.data["extinct_by"] = "PBDB"
            elif pb is None and ("extinct" in flags or "extinct_inherited" in flags):
                nd.extinct = True
                nd.data["extinct_by"] = "OTT flag"
        c["extinct" if nd.extinct else "living"] += 1
    log["extinct_flags"] = dict(c)


# ------------------------------------------------------------------ PBDB


def pbdb_range(r: dict) -> tuple[float, float] | None:
    fmax, fmin = r.get("firstapp_max_ma"), r.get("firstapp_min_ma")
    lmax, lmin = r.get("lastapp_max_ma"), r.get("lastapp_min_ma")
    if fmax is None or fmin is None:
        return None
    fmax, fmin = float(fmax), float(fmin)
    lmax = float(lmax) if lmax is not None else fmax
    lmin = float(lmin) if lmin is not None else fmin
    if (fmax, fmin) == (lmax, lmin):
        # one interval: centre a species-length (<= 2 Myr) range inside it
        c = (fmax + fmin) / 2
        t0 = min(fmax, c + 1.0)
        t1 = max(fmin, c - 1.0)
    else:
        t0 = (fmax + fmin) / 2
        t1 = (lmax + lmin) / 2
    if t0 - t1 < 0.05:
        c = (t0 + t1) / 2
        t0, t1 = c + 0.025, max(0.0, c - 0.025)
    return t0, t1


# Records excluded on purpose (documented in pipeline/SOURCES.md).
PBDB_EXCLUDE = {
    "Tikitherium copei": "Carnian (~230 Ma) age is a ~25 Myr outlier vs every other PBDB mammal;"
                         " the type material has been argued to be a much younger shrew",
}


def graft_pbdb(root: Node, species: list[dict], exact, syn, log: dict) -> None:
    how = Counter()
    # OT name indices for higher taxa
    by_name: dict[str, list[Node]] = defaultdict(list)
    genus_leaves: dict[str, list[Node]] = defaultdict(list)
    for nd in root.preorder():
        if nd.name and not (nd.is_leaf and not nd.data.get("empty_higher")):
            by_name[nd.name].append(nd)
        if nd.is_leaf and nd.kind == "tree" and nd.genus():
            genus_leaves[nd.genus()].append(nd)

    # Families/orders that the synthesis tree does not resolve as a node
    # ("broken" taxa, e.g. Hominidae): use the MRCA of the OT leaves Upham
    # assigns to them, when that MRCA is tight.
    up_groups: dict[tuple[str, str], list[Node]] = defaultdict(list)
    for nd in root.preorder():
        if nd.is_leaf and nd.data.get("upham_family"):
            up_groups[("family", nd.data["upham_family"])].append(nd)
            up_groups[("order", nd.data["upham_order"])].append(nd)
    n_named = 0
    for (rank, nm), members in up_groups.items():
        if nm in by_name or len(members) < 2:
            continue
        m = _mrca(members)
        n_extant = sum(1 for x in m.preorder() if x.is_leaf and x.upham) if m is not None else 0
        if m is None or m is root or n_extant > 1.5 * len(members) + 2:
            continue
        if m.name is None:
            m.name, m.rank = nm, rank
        else:
            m.alt.append(nm)
        m.data["name_from_upham"] = nm
        by_name[nm].append(m)
        n_named += 1
    log["upham_named_broken_taxa"] = n_named

    bucket =Node(name="Mammalia incertae sedis (fossil)", rank="no rank", kind="bucket", taxonomic=True)
    created: dict[tuple[str, str], Node] = {}

    def pick(name: str | None, under: Node | None, ranks: tuple[str, ...]) -> Node | None:
        if not name:
            return None
        cands = by_name.get(name, [])
        if under is not None:
            cands = [c for c in cands if _is_desc(c, under)]
        pref = [c for c in cands if c.rank in ranks]
        cands = pref or cands
        return cands[0] if len(cands) == 1 or (cands and pref) else None

    def group(kind_rank: str, name: str, parent: Node) -> Node:
        key = (kind_rank, name)
        g = created.get(key)
        if g is None:
            g = Node(name=name, rank=kind_rank, kind="group", taxonomic=True)
            g.data["created_from"] = "PBDB"
            parent.add(g)
            created[key] = g
            by_name[name].append(g)
        return g

    def order_node(order: str | None) -> Node:
        n = pick(order, None, ("order", "superorder", "suborder", "infraorder"))
        if n is not None:
            return n
        if order:
            if bucket.parent is None:
                root.add(bucket)
            return group("order", order, bucket)
        if bucket.parent is None:
            root.add(bucket)
        return bucket

    def family_node(family: str | None, order: str | None) -> Node:
        onode = pick(order, None, ("order", "superorder", "suborder", "infraorder")) if order else None
        f = pick(family, onode, ("family", "subfamily", "superfamily"))
        if f is None and family:
            f = pick(family, None, ("family",))
            if f is not None and onode is not None and not _is_desc(f, onode):
                f = None
        if f is not None:
            return f
        on = order_node(order)
        if family:
            return group("family", family, on)
        return on

    for r in species:
        name = norm_name(r["taxon_name"])
        if name in PBDB_EXCLUDE:
            how["excluded (see PBDB_EXCLUDE)"] += 1
            continue
        if not BINOMIAL.match(name):
            how["not a plain binomial"] += 1
            continue
        rng = pbdb_range(r)
        fam, order, genus = r.get("family"), r.get("order"), r.get("genus") or name.split()[0]
        # 1. existing OT leaf?
        hit = None
        if name in exact and context_ok(exact[name], fam, order):
            hit = exact[name]
            m = "exact"
        else:
            for nd in syn.get(name, []):
                if context_ok(nd, fam, order):
                    hit, m = nd, "synonym"
                    break
        if hit is not None:
            how["matched OT leaf (" + m + ")"] += 1
            hit.pbdb = int(r["taxon_no"]) if r.get("taxon_no") else None
            if rng:
                hit.fad, lad = rng
                if hit.extinct:
                    hit.lad = lad
            continue
        if r.get("is_extant") != "extinct":
            how["living, not in OT (skipped)" if r.get("is_extant") == "extant" else "status unknown (skipped)"] += 1
            continue
        if not rng or not r.get("n_occs"):
            how["no occurrences/range (skipped)"] += 1
            continue
        # 2. graft under genus / family / order
        fnode = None
        g = None
        fam_ot = pick(fam, None, ("family",)) if fam else None
        ord_ot = pick(order, None, ("order",)) if order else None
        ctx = fam_ot or ord_ot
        cand = pick(genus, ctx, ("genus", "subgenus"))
        if cand is None and ctx is None:
            cand = pick(genus, None, ("genus",))
        if cand is not None and cand.kind == "tree":
            g = cand
            how["grafted: OT genus"] += 1
        elif cand is not None:
            g = cand
            how["grafted: PBDB genus (created)"] += 1
        else:
            # broken genus: OT leaves share the genus name but no genus node
            gl = [x for x in genus_leaves.get(genus, []) if ctx is None or _is_desc(x, ctx)]
            if gl:
                m = _mrca(gl)
                if m is not None and m.is_leaf:
                    m = m.parent  # never graft under a species tip
                if m is not None and m is not root and _n_leaves(m) <= 3 * len(gl) + 2:
                    g = m
                    how["grafted: MRCA of OT genus members"] += 1
            if g is None:
                fnode = family_node(fam, order)
                g = group("genus", genus, fnode)
                how["grafted: PBDB genus (created)"] += 1
        leaf = Node(name=name, rank="species", kind="graft", taxonomic=True, extinct=True,
                    pbdb=int(r["taxon_no"]))
        leaf.fad, leaf.lad = rng
        leaf.date_src = D_FOSSIL
        leaf.data["n_occs"] = r.get("n_occs")
        leaf.data["pbdb_family"] = fam
        leaf.data["pbdb_order"] = order
        g.add(leaf)
    log["pbdb_graft"] = dict(how)
    log["pbdb_groups_created"] = Counter(k[0] for k in created)
    # name-match summary: how deep into the Open Tree did each fossil land?
    level = Counter()
    for nd in root.preorder():
        if nd.kind != "graft":
            continue
        p = nd.parent
        while p is not None and p.kind != "tree":
            p = p.parent
        if p is None or p is root:
            level["unplaced (Mammalia root / incertae sedis)"] += 1
        elif p.rank in ("genus", "subgenus") or (p.name and p.name == nd.genus()):
            level["under OT genus"] += 1
        elif p.rank in ("family", "subfamily", "tribe", "subtribe", "superfamily") or p.data.get("name_from_upham"):
            level["under OT family-level node"] += 1
        else:
            level["under OT order or higher"] += 1
    matched_leaf = sum(v for k, v in how.items() if k.startswith("matched OT leaf"))
    used = matched_leaf + sum(level.values())
    log["pbdb_match"] = {
        "species_used": used,
        "matched_existing_OT_species": matched_leaf,
        **{f"grafted {k}": v for k, v in level.items()},
        "rate_matched_species": round(matched_leaf / used, 4),
        "rate_species_or_genus": round((matched_leaf + level["under OT genus"]) / used, 4),
        "rate_family_or_better": round((matched_leaf + level["under OT genus"]
                                        + level["under OT family-level node"]) / used, 4),
    }


def _is_desc(nd: Node, anc: Node) -> bool:
    p = nd
    while p is not None:
        if p is anc:
            return True
        p = p.parent
    return False


def _path(nd: Node) -> list[Node]:
    out = []
    while nd is not None:
        out.append(nd)
        nd = nd.parent
    return out[::-1]


def _mrca(nodes: list[Node]) -> Node | None:
    paths = [_path(n) for n in nodes]
    m = None
    for level in zip(*paths):
        if all(x is level[0] for x in level):
            m = level[0]
        else:
            break
    return m


def _n_leaves(nd: Node) -> int:
    return sum(1 for x in nd.preorder() if x.is_leaf)


# ------------------------------------------------------------------ dating


def calibrate(root: Node, up_root: NNode, log: dict) -> None:
    """Give OT internal nodes the Upham age of their MRCA when the clade is
    concordant (the Upham MRCA has exactly the same matched tips)."""
    # Upham: depth, parent, matched-tip counts
    up_nodes = list(up_root.iter_preorder())
    depth = {}
    for u in up_nodes:
        depth[id(u)] = 0 if u.parent is None else depth[id(u.parent)] + 1
        u.nmatch = 0
    for u in reversed(up_nodes):
        if not u.children:
            u.nmatch = 1 if getattr(u, "ot", None) is not None else 0
        else:
            u.nmatch = sum(c.nmatch for c in u.children)

    def lca(a: NNode, b: NNode) -> NNode:
        while depth[id(a)] > depth[id(b)]:
            a = a.parent
        while depth[id(b)] > depth[id(a)]:
            b = b.parent
        while a is not b:
            a, b = a.parent, b.parent
        return a

    ot2up = {id(u.ot): u for u in up_nodes if not u.children and getattr(u, "ot", None) is not None}
    n_cal = n_int = 0
    for nd in root.postorder():
        if nd.is_leaf:
            u = ot2up.get(id(nd))
            nd.data["_up"] = u
            nd.data["_k"] = 1 if u else 0
            continue
        m = None
        k = 0
        for c in nd.children:
            cu = c.data.get("_up")
            if cu is None:
                continue
            k += c.data["_k"]
            m = cu if m is None else lca(m, cu)
        nd.data["_up"] = m
        nd.data["_k"] = k
        if m is not None and k >= 2 and m.nmatch == k and m.height is not None:
            nd.age = m.height
            nd.date_src = D_UPHAM
            if m.hpd:
                nd.data["age_hpd"] = m.hpd
            n_cal += 1
        else:
            n_int += 1
    for nd in root.preorder():
        nd.data.pop("_up", None)
        nd.data.pop("_k", None)
    log["dating"] = {"upham_calibrated_nodes": n_cal, "uncalibrated_internal": n_int}


def leaf_floor(nd: Node) -> float:
    if nd.kind == "graft":
        return nd.fad or 0.0
    v = 0.0
    if nd.fad is not None:
        v = max(v, nd.fad)
    if nd.extinct and nd.lad is not None:
        v = max(v, nd.lad)
    return v


def date_tree(root: Node, log: dict) -> None:
    # floors and the "below" target for interpolation
    below: dict[int, tuple[float, int]] = {}
    floor: dict[int, float] = {}
    for nd in root.postorder():
        if nd.is_leaf:
            f = leaf_floor(nd)
            floor[id(nd)] = f
            below[id(nd)] = (f, 0)
            continue
        f = 0.0
        best = (0.0, 0)
        for c in nd.children:
            cf = floor[id(c)]
            if not c.is_leaf and c.age is not None and c.date_src == D_UPHAM:
                cf = max(cf, c.age)
                cand = (c.age, 1)
            else:
                ba, bs = below[id(c)]
                cand = (ba, bs + 1)
            f = max(f, cf)
            if cand[0] > best[0] or (cand[0] == best[0] and cand[1] > best[1]):
                best = cand
        floor[id(nd)] = f
        below[id(nd)] = best
    # root
    if root.age is None:
        ba, bs = below[id(root)]
        root.age = max(ba * 1.1, ba + 1.0)
    # top-down interpolation for uncalibrated nodes
    for nd in root.preorder():
        if nd is root or nd.is_leaf:
            continue
        if nd.kind in ("group", "bucket"):
            nd.age = floor[id(nd)]
            nd.date_src = D_FOSSIL
        elif nd.age is None:
            P = nd.parent.age
            ba, bs = below[id(nd)]
            if P <= ba:
                nd.age = ba + EPS
            else:
                nd.age = P - (P - ba) / (bs + 1)
            nd.date_src = D_INTERP if nd.kind == "tree" else D_FOSSIL
    # bottom-up: parents at least as old as any child's age / first appearance
    raised = 0
    for nd in root.postorder():
        if nd.is_leaf:
            continue
        need = 0.0
        for c in nd.children:
            need = max(need, (c.age + EPS) if not c.is_leaf else floor[id(c)])
        if nd.age < need:
            if nd.date_src == D_UPHAM:
                raised += 1
                nd.data["raised_by_fossil"] = round(need - nd.age, 4)
            nd.age = need
            if nd.date_src == D_UPHAM:
                nd.date_src = D_FOSSIL
    log["dating"]["calibrated_raised_by_fossils"] = raised


def assign_bands(root: Node, anchors_t0: dict[str, float]) -> None:
    """t0/t1 for every node. Tree children start at the parent's split; fossil
    grafts and created groups start at their first appearance."""
    root.t0 = root.age * 1.02
    for nd in root.preorder():
        for c in nd.children:
            if c.kind == "graft":
                c.t0 = c.fad
            elif c.kind in ("group", "bucket"):
                c.t0 = c.age
            else:
                c.t0 = nd.age
    for nd in root.postorder():
        if nd.is_leaf:
            if nd.kind == "graft":
                nd.t1 = nd.lad
            elif nd.extinct:
                if nd.lad is None:
                    st = nd.data.get("iucn")
                    nd.lad = 0.0001 if st == "EX" else 0.0117
                    nd.data["lad_default"] = True
                nd.t1 = min(nd.lad, nd.t0 - EPS)
            else:
                nd.t1 = 0.0
            if nd.name in anchors_t0:
                nd.t0 = anchors_t0[nd.name]
                nd.date_src = D_ANCHOR
        else:
            nd.t1 = min(c.t1 for c in nd.children)
            if nd.kind in ("group", "bucket"):
                nd.t0 = max(nd.t0, max(c.t0 for c in nd.children))
