"""TetraDENSITY v2.5 (Santini et al. 2024, GEB 33:e13929; CC BY-NC 4.0): measured local population densities, per
group, matched to the Reptile Database Oct 2026 and Clements 2025 lists (ToLaD#519). A density is individuals per
area at one site; it is not a species total.

Run: uv run --project pipeline python research/amniote-sources/densities.py
"""
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
A = ROOT / "data" / "raw" / "amniotes"
AMPHIS = {"Amphisbaenidae", "Bipedidae", "Blanidae", "Cadeidae", "Rhineuridae", "Trogonophidae"}
rdb = {}
for r in openpyxl.load_workbook(A / "reptiledb" / "reptile_checklist_2026_10.xlsx", read_only=True).worksheets[0].iter_rows(min_row=2, values_only=True):
    if r[1]:
        rdb[r[1].strip()] = ("Amphisbaenia" if r[5] in AMPHIS else "Lizards" if r[4] == "Sauria" else
                             "Snakes" if r[4] == "Serpentes" else r[4] or "unknown")
cl = {r.get("sci_name_2025") or r["SCI_NAME"] for r in csv.DictReader(open(A / "avesdata" / "OTT_crosswalk_2025.csv")) if r["CATEGORY"] == "species"}
est, sp, sites = Counter(), defaultdict(set), Counter()
for r in csv.DictReader(open(A / "tetradensity" / "TetraDENSITY_v2.5_Database.csv", encoding="utf-8", errors="replace")):
    c = r["Class"]
    name = r["Species_COL"] or r["Species_rep"]
    if c == "Reptilia":
        g = rdb.get(name) or rdb.get(r["Species_rep"]) or ("Testudines" if r["Order"] == "Testudines" else
                                                           "Crocodylia" if r["Order"] == "Crocodylia" else "reptile, not in RDB by name")
    elif c == "Aves":
        g = "Birds" if (name in cl or r["Species_rep"] in cl) else "Birds, not in Clements 2025 by name"
    else:
        g = c
    est[g] += 1
    sp[g].add(name)
listn = Counter(rdb.values())
listn["Birds"] = len(cl)
out = {g: {"estimates": est[g], "species": len(sp[g]), "list_species": listn.get(g),
           "share": round(len(sp[g]) / listn[g], 3) if listn.get(g) else None} for g in sorted(est, key=lambda k: -est[k])}
print(json.dumps(out, indent=1))
