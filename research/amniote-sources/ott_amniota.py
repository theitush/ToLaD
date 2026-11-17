"""Cut the Amniota subtree (ott229560) out of the full OTT 3.7.3 taxonomy we already hold (data/raw/ott/),
with each row's group and its synonyms, so the other scripts read 2% of the file (ToLaD#519).

Writes data/raw/amniotes/ott/amniota_taxonomy.tsv (uid, parent, name, rank, flags, group, genus_uid,
family_uid) and amniota_synonyms.tsv (name, uid). Prints counts per group and rank.

Run: giverny-manage run amnio519 -- uv run --project pipeline python research/amniote-sources/ott_amniota.py
"""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OTT = ROOT / "data" / "raw" / "ott"
OUT = ROOT / "data" / "raw" / "amniotes" / "ott"
OUT.mkdir(parents=True, exist_ok=True)
AMNIOTA = 229560
GROUPS = {244265: "Mammalia", 81461: "Aves", 35888: "Squamata", 35876: "Rhynchocephalia", 639666: "Testudines",
          195672: "Crocodylia", 90215: "Dinosauria", 5294683: "Pterosauria", 5294564: "Plesiosauria",
          5294570: "Ichthyosauria", 5294593: "Sauropterygia", 335588: "Archosauria", 35881: "Lepidosauria"}

parent, info = {}, {}
with open(OTT / "taxonomy.tsv", encoding="utf-8") as f:
    next(f)
    for line in f:
        p = line.split("\t|\t")
        uid = int(p[0])
        parent[uid] = int(p[1]) if p[1] else 0
        info[uid] = (p[2], p[3], p[6].rstrip("\t|\n"))

children = {}
for u, pu in parent.items():
    children.setdefault(pu, []).append(u)
del parent

rows = []
stack = [(AMNIOTA, AMNIOTA, "Amniota", None, None)]
while stack:
    u, pu, grp, gen, fam = stack.pop()
    name, rank, flags = info[u]
    grp = GROUPS.get(u, grp)
    if grp == "Archosauria" and u != 335588:
        grp = "Archosauria other"
    gen = u if rank == "genus" else gen
    fam = u if rank == "family" else fam
    rows.append((u, pu, name, rank, flags, grp, gen or "", fam or ""))
    for c in children.get(u, []):
        stack.append((c, u, grp, gen, fam))

# Aves sits inside Dinosauria in OTT? keep Aves its own group either way
with open(OUT / "amniota_taxonomy.tsv", "w", encoding="utf-8") as f:
    f.write("uid\tparent\tname\trank\tflags\tgroup\tgenus_uid\tfamily_uid\n")
    for r in rows:
        f.write("\t".join(map(str, r)) + "\n")
uids = {r[0] for r in rows}
n_syn = 0
with open(OTT / "synonyms.tsv", encoding="utf-8") as f, open(OUT / "amniota_synonyms.tsv", "w", encoding="utf-8") as g:
    next(f)
    g.write("name\tuid\n")
    for line in f:
        p = line.split("\t|\t")
        if int(p[1]) in uids:
            g.write(f"{p[0]}\t{p[1]}\n")
            n_syn += 1
sp = Counter((r[5], "extinct" in r[4]) for r in rows if r[3] == "species")
print(json.dumps({"rows": len(rows), "synonyms": n_syn,
                  "species_by_group_(living,extinct-flagged)": {g: [sp[(g, False)], sp[(g, True)]]
                                                               for g in sorted({k[0] for k in sp})}}, indent=1))
