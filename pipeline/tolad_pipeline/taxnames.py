"""Forks named from the taxonomy (ToLaD#417): tax2tree's decoration (McDonald et al. 2012, ISME J 6: 610) over the dated tree.

A taxon's name goes on the fork with the best F-score against its species, if that clears F_MIN, so a few strays
(a species the tree places elsewhere, a neighbour the tree puts inside) do not lose a family its name. MDD's taxonomy
is the source: current, and one name per species. Living species only: a fossil under a fork says nothing against it.

Only names change here: never the tree's shape, ages, species or widths.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict

# The ranks, in the order they claim forks. Where two taxa want one fork, the name a reader knows the group by holds it:
# the ICZN's principal ranks (order, family; a genus already named stays) over the ranks between them. So a family of one
# subfamily is its family, a family of one genus its family, a tribe of one genus (Panini) its genus.
RANKS = ("order", "family", "suborder", "subfamily", "tribe")
TOP_DOWN = ("order", "suborder", "family", "subfamily", "tribe")  # MDD's own nesting
# Three quarters: F = 2c / (n + s) with c species shared means n + s - 2c = 2c (1 / F - 1) strays both ways, so at 0.75 at most
# 2 strays for every 3 species the fork and the taxon share: a few strays are forgiven, a fork half of others is not. The
# scores have the gap there: the last family above it is Heteromyidae (0.783, 47 of its 73, Upham putting the pocket
# gophers inside it), the first under it Balaenidae (0.667: 4 of 8, its fork as many rorquals as right whales).
# What it stops: stats.json dated_tree.taxon_names.not_placed.
F_MIN = 3 / 4

_NOTE = re.compile(r"\s*\(\w+\s+in\s+[^)]*\)\s*$")  # Open Tree's homonym note
_LATO = re.compile(r"\s+(?:sensu\s+lato|s\.\s*l\.)\s*$")


def clean(name: str) -> str:
    """A raw Open Tree name made fit to show: "Pteropus (genus in Holozoa)" -> "Pteropus", "H. larvatus sensu lato" ->
    "H. larvatus", "Felidae (crown)" -> "Felidae"."""
    return _LATO.sub("", _NOTE.sub("", name.removesuffix(" (crown)"))).strip()


def fscore(hit: int, fork: int, taxon: int) -> float:
    """F of a fork holding `fork` species, `hit` of a taxon's `taxon`: 2PR / (P + R), P = hit/fork, R = hit/taxon."""
    return 2 * hit / (fork + taxon)


def decorate(droot, ranks_of, locked: set[str], genera: set[str], f_min: float = F_MIN) -> dict:
    """Name droot's forks from the taxonomy; returns the report for stats.json.

    `ranks_of(leaf)`: a living species' {rank: taxon} (None: not on the list, counted on neither side); `locked`: names
    overrides.toml rules, never moved and whose forks are never taken; `genera`: the list's genus names (a fork that has
    one as its name keeps it against a rank between the principal ones)."""
    order = list(droot.preorder())
    pos = {id(d): i for i, d in enumerate(order)}
    span: dict[int, int] = {}  # a fork's last preorder position
    total: dict[int, int] = {}  # every species under it, fossils too
    below: dict[int, int] = defaultdict(int)  # the listed living species under it
    species: dict[tuple[str, str], list] = defaultdict(list)
    chain: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)  # a taxon -> the taxa above and below it
    for d in reversed(order):
        span[id(d)] = max([pos[id(d)]] + [span[id(c)] for c in d.children])
        total[id(d)] = 1 if d.leaf is not None else sum(total[id(c)] for c in d.children)
        if d.leaf is None:
            continue
        rs = ranks_of(d.leaf)
        if not rs:
            continue
        p = d.parent
        while p is not None:
            below[id(p)] += 1
            p = p.parent
        line = [(r, rs[r]) for r in TOP_DOWN if rs.get(r)]
        for t in line:
            species[t].append(d)
            chain[t].update(x for x in line if x != t)

    before = {d.name: d for d in reversed(order) if d.leaf is None and d.name}  # the outermost, if a name stands twice
    for d in order:
        if d.leaf is None and d.name and before[d.name] is not d:
            d.name = None
    named_before = {t for t in species if t[1] in before}

    def candidates(t: tuple[str, str]) -> list[tuple[float, object]]:
        """The forks over a taxon's species, best first: on a tie (forks with the same living species) where its name
        already stands, else the crown (fewest species, fossils counted); position last, so a rebuild picks the same."""
        hit: dict[int, int] = defaultdict(int)
        at: dict[int, object] = {}
        for d in species[t]:
            p = d.parent
            while p is not None:
                hit[id(p)] += 1
                at[id(p)] = p
                p = p.parent
        out = [(fscore(c, below[i], len(species[t])), at[i]) for i, c in hit.items() if c >= 2]
        return sorted(out, key=lambda x: (-x[0], before.get(t[1]) is not x[1], total[id(x[1])], pos[id(x[1])]))

    cand = {t: candidates(t) for t in species if len(species[t]) >= 2 and t[1] not in locked}
    held: dict[int, tuple[str, str]] = {}  # fork -> the taxon placed on it
    fork_of: dict[tuple[str, str], object] = {}
    not_placed: dict[tuple[str, str], dict] = {}

    def inverted(t: tuple[str, str], d) -> bool:
        """Would fork d put taxon t above a taxon it holds, or below one that holds it? (Apart is allowed: the tree may
        put a subfamily outside its family's fork, and then the subfamily is still that fork's name.)"""
        i = TOP_DOWN.index(t[0])
        for x in chain[t]:
            f = fork_of.get(x)
            if f is None or f is d:
                continue
            top, low = (f, d) if TOP_DOWN.index(x[0]) < i else (d, f)
            if pos[id(low)] < pos[id(top)] <= span[id(low)]:
                return True
        return False

    def holder(t: tuple[str, str], d) -> str | None:
        """Who holds fork d against taxon t and is the same group, or a lineage's more familiar name for it: a taxon of
        t's own lineage, a name overrides.toml rules, or (against a rank between the principal ones) a genus."""
        h = held.get(id(d))
        if h is not None:
            return h[1] if h in chain[t] else None
        if d.name != t[1] and (d.name in locked or (d.name in genera and t[0] not in ("order", "family"))):
            return d.name
        return None

    def place(t: tuple[str, str]) -> tuple[float, object] | str | None:
        """The fork t goes on. A sibling's claim sends it to its next fork; its own lineage's holding its best fork
        means the group is named already, and a worse fork would be a part of it (Elephantidae on the African
        elephants, its order Proboscidea being on all three): only a fork as good (a stem with the same living species) will do."""
        stop = None
        for f, d in cand[t]:
            if f < f_min or (stop is not None and f < stop[0] - 1e-9):
                break
            who = holder(t, d)
            if who is not None:
                stop = stop or (f, who)
            elif id(d) not in held and not inverted(t, d):
                return f, d
        return stop[1] if stop else None

    for rank in RANKS:
        ts = sorted((t for t in cand if t[0] == rank), key=lambda t: (-(cand[t][0][0] if cand[t] else 0), t[1]))
        for t in ts:
            spot = place(t)
            if spot is None or isinstance(spot, str):
                b = cand[t][0] if cand[t] else None
                not_placed[t] = {"species": len(species[t]), "best_F": round(b[0], 3) if b else 0.0,
                                 "best_fork_holds": below[id(b[1])] if b else 0}
                if spot:
                    not_placed[t]["named_as"] = spot
                continue
            held[id(spot[1])] = t
            fork_of[t] = spot[1]

    # Names on: a taxon placed takes its name off any other fork, and a fork takes the name of the taxon placed on it.
    moved, displaced = [], []
    for t, d in sorted(fork_of.items(), key=lambda x: pos[id(x[1])]):
        old = before.get(t[1])
        if old is not None and old is not d:
            old.name = None
            moved.append(t[1])
    for t, d in sorted(fork_of.items(), key=lambda x: pos[id(x[1])]):
        if d.name and d.name != t[1]:
            displaced.append({"fork": d.name, "by": t[1]})
        d.name = t[1]

    placed_f = {t: next(f for f, x in cand[t] if x is fork_of[t]) for t in fork_of}
    by_order: dict[str, Counter] = defaultdict(Counter)
    seen = set()
    for t in species:
        if t[0] != "family" or t in seen:
            continue
        seen.add(t)
        ords = Counter(ranks_of(d.leaf).get("order") for d in species[t])
        o = ords.most_common(1)[0][0]
        by_order[o]["families"] += 1
        if len(species[t]) >= 2:
            by_order[o]["families_of_2_or_more"] += 1
        by_order[o]["named_before"] += t in named_before
        by_order[o]["named_after"] += t in fork_of or t[1] in locked

    def fork_row(t: tuple[str, str]) -> dict:
        d = fork_of[t]
        hit = sum(1 for s in species[t] if pos[id(d)] < pos[id(s)] <= span[id(d)])
        return {"name": t[1], "rank": t[0], "F": round(placed_f[t], 3), "species": len(species[t]),
                "fork_holds": below[id(d)], "strays_out": len(species[t]) - hit, "others_in": below[id(d)] - hit}

    rows = [fork_row(t) for t in fork_of]
    return {
        "note": "MDD taxa on the dated tree by best F against living species (taxnames.decorate)",
        "f_min": round(f_min, 4),
        "placed": dict(Counter(t[0] for t in fork_of)),
        "of": dict(Counter(t[0] for t in cand)),
        "one_species_no_fork": dict(Counter(t[0] for t in species if len(species[t]) == 1)),
        "by_order": {o: dict(c) for o, c in sorted(by_order.items(), key=lambda x: str(x[0]))},
        "with_strays": sorted((r for r in rows if r["F"] < 1), key=lambda r: (r["F"], r["name"])),
        "not_placed": {f"{t[0]} {t[1]}": v for t, v in sorted(not_placed.items())},
        "moved": sorted(moved),
        "displaced": sorted(displaced, key=lambda x: x["fork"]),
    }
