"""The OTT Amniota cut (ToLaD#519, #535): the Amniota subtree (ott229560) of the pinned OTT 3.7.3 taxonomy.

Read from data/raw/ott/{taxonomy,synonyms}.tsv (extracted by `tolad-fetch` from the pinned
ott3.7.3.tgz), so the amniote steps read 2% of the file. No download: a cut of a pinned source.
`tolad-fetch --set amniotes` runs it when its outputs are missing and pins their sha256 in the lock.

Writes data/raw/amniotes/ott/:
  amniota_taxonomy.tsv  uid, parent, name, rank, flags, group, genus_uid, family_uid (preorder from Amniota)
  amniota_synonyms.tsv  name, uid (OTT's synonyms of the cut's taxa, in OTT's order)
`group` is the nearest of GROUPS above a taxon (Aves inside Dinosauria is "Aves"; an archosaur in none of
the named archosaur groups is "Archosauria other"; anything else "Amniota").

Usage:
    uv run python -I -m tolad_pipeline.ott_amniota [--raw DIR]   # writes the cut, prints its counts
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

AMNIOTA = 229560
ARCHOSAURIA = 335588
GROUPS = {244265: "Mammalia", 81461: "Aves", 35888: "Squamata", 35876: "Rhynchocephalia", 639666: "Testudines",
          195672: "Crocodylia", 90215: "Dinosauria", 5294683: "Pterosauria", 5294564: "Plesiosauria",
          5294570: "Ichthyosauria", 5294593: "Sauropterygia", ARCHOSAURIA: "Archosauria", 35881: "Lepidosauria"}
TAXONOMY = "amniotes/ott/amniota_taxonomy.tsv"
SYNONYMS = "amniotes/ott/amniota_synonyms.tsv"
OUTPUTS = (TAXONOMY, SYNONYMS)


def cut(raw: Path) -> dict:
    """Write the cut under raw/amniotes/ott/ and return its counts."""
    ott = raw / "ott"
    # Two passes over the 417 MB file, so only the tree's shape is held for all 4.5M taxa: the children
    # (in file order), then name, rank and flags for the Amniota taxa alone.
    children: dict[int, list[int]] = {}
    with open(ott / "taxonomy.tsv", encoding="utf-8") as f:
        next(f)
        for line in f:
            uid, pu = line.split("\t|\t", 2)[:2]
            children.setdefault(int(pu) if pu else 0, []).append(int(uid))
    inside, stack = set(), [AMNIOTA]
    while stack:
        u = stack.pop()
        inside.add(u)
        stack.extend(children.get(u, ()))
    children = {u: children[u] for u in inside if u in children}
    info = {}
    with open(ott / "taxonomy.tsv", encoding="utf-8") as f:
        next(f)
        for line in f:
            p = line.split("\t|\t")
            uid = int(p[0])
            if uid in inside:
                info[uid] = (p[2], p[3], p[6].rstrip("\t|\n"))

    rows = []
    stack = [(AMNIOTA, AMNIOTA, "Amniota", None, None)]
    while stack:
        u, pu, grp, gen, fam = stack.pop()
        name, rank, flags = info[u]
        grp = GROUPS.get(u, grp)
        if grp == "Archosauria" and u != ARCHOSAURIA:
            grp = "Archosauria other"
        gen = u if rank == "genus" else gen
        fam = u if rank == "family" else fam
        rows.append((u, pu, name, rank, flags, grp, gen or "", fam or ""))
        for c in children.get(u, []):
            stack.append((c, u, grp, gen, fam))

    out = raw / TAXONOMY
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tsv.part")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("uid\tparent\tname\trank\tflags\tgroup\tgenus_uid\tfamily_uid\n")
        for r in rows:
            f.write("\t".join(map(str, r)) + "\n")
    tmp.replace(out)
    uids = {r[0] for r in rows}
    n_syn = 0
    out = raw / SYNONYMS
    tmp = out.with_suffix(".tsv.part")
    with open(ott / "synonyms.tsv", encoding="utf-8") as f, open(tmp, "w", encoding="utf-8") as g:
        next(f)
        g.write("name\tuid\n")
        for line in f:
            p = line.split("\t|\t")
            if int(p[1]) in uids:
                g.write(f"{p[0]}\t{p[1]}\n")
                n_syn += 1
    tmp.replace(out)
    return counts(rows, n_syn)


def counts(rows, n_syn: int) -> dict:
    sp = Counter((r[5], "extinct" in r[4]) for r in rows if r[3] == "species")
    ids = {r[0] for r in rows}
    return {"taxa": len(rows), "species": sum(sp.values()), "synonyms": n_syn,
            "group_roots_present": {g: u in ids for u, g in GROUPS.items()},
            "species_by_group_(not_extinct,extinct_flagged)": {g: [sp[(g, False)], sp[(g, True)]]
                                                               for g in sorted({k[0] for k in sp})}}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, default=Path(__file__).resolve().parents[2] / "data" / "raw")
    a = ap.parse_args(argv)
    print(json.dumps(cut(a.raw), indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
