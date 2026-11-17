"""IUCN Red List 2026-1 (the GBIF copy the mammal build already pins, data/raw/redlist/iucn-2026-1.zip) for birds and
reptiles: species assessed, categories (EX / EW: lost since 1500), and the match to Clements 2025 and the Reptile
Database Oct 2026 by exact name (ToLaD#519).

Run: uv run --project pipeline python research/amniote-sources/redlist_amniotes.py
"""
import csv
import io
import json
import zipfile
from collections import Counter
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
A = ROOT / "data" / "raw" / "amniotes"
z = zipfile.ZipFile(ROOT / "data" / "raw" / "redlist" / "iucn-2026-1.zip")
cls = {}
with z.open("taxon.txt") as f:
    for line in io.TextIOWrapper(f, encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) > 10 and p[4] in ("AVES", "REPTILIA") and p[10] == "species":
            cls[p[0]] = (p[4], p[5], f"{p[7]} {p[8]}")
cat = {}
with z.open("distribution.txt") as f:
    for line in io.TextIOWrapper(f, encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if p[0] in cls and len(p) > 5:
            cat[p[0]] = p[5]
cl = {r.get("sci_name_2025") or r["SCI_NAME"] for r in csv.DictReader(open(A / "avesdata" / "OTT_crosswalk_2025.csv")) if r["CATEGORY"] == "species"}
rdb = {r[1].strip() for r in openpyxl.load_workbook(A / "reptiledb" / "reptile_checklist_2026_10.xlsx", read_only=True).worksheets[0].iter_rows(min_row=2, values_only=True) if r[1]}
out = {}
for c, lst, lname in (("AVES", cl, "Clements 2025"), ("REPTILIA", rdb, "Reptile Database 2026-10")):
    ids = [i for i, v in cls.items() if v[0] == c]
    names = {cls[i][2] for i in ids}
    cc = Counter(cat.get(i, "?") for i in ids)
    lost = [cls[i][2] for i in ids if cat.get(i) in ("Extinct", "Extinct in the Wild")]
    out[c] = {"assessed_species": len(ids), "categories": dict(cc.most_common()),
              f"in {lname} by exact name": len(names & lst), f"share of {lname}": round(len(names & lst) / len(lst), 3),
              "EX+EW in list by exact name": len(set(lost) & lst)}
    if c == "REPTILIA":
        out[c]["orders"] = dict(Counter(cls[i][1] for i in ids))
print(json.dumps(out, indent=1))
