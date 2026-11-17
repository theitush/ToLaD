"""ReptTraits v1.2 (Oskyrko et al. 2024, CC BY 4.0) coverage per group against the Reptile Database Oct 2026
list: maximum body mass, maximum longevity, offspring per clutch, Red List assessment; and where the mass values
come from (the per-value source sheet) (ToLaD#519).

Run: uv run --project pipeline python research/amniote-sources/reptile_traits.py
"""
import json
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
A = ROOT / "data" / "raw" / "amniotes"
AMPHIS = {"Amphisbaenidae", "Bipedidae", "Blanidae", "Cadeidae", "Rhineuridae", "Trogonophidae"}

ws = openpyxl.load_workbook(A / "reptiledb" / "reptile_checklist_2026_10.xlsx", read_only=True).worksheets[0]
rdb = {}
for r in ws.iter_rows(min_row=2, values_only=True):
    if r[1]:
        o, f = r[4], r[5]
        rdb[r[1].strip()] = ("Amphisbaenia" if f in AMPHIS else "Lizards" if o == "Sauria" else
                             "Snakes" if o == "Serpentes" else o or "unknown")

wb = openpyxl.load_workbook(A / "repttraits" / "ReptTraits_v1-2.xlsx", read_only=True)
data = list(wb["Data"].iter_rows(values_only=True))
srcs = list(wb.worksheets[2].iter_rows(values_only=True))  # "Sources of individual trait val..."
hdr = [str(h).strip() if h else "" for h in data[0]]


def col(prefix):
    return next(i for i, h in enumerate(hdr) if h.startswith(prefix))


C = {"mass": col("Maximum body mass"), "longevity": col("Maximum Longevity"), "offspring": col("Mean number of offspring"),
     "svl": col('Maximum length ("SVL"'), "iucn": col("IUCN redlist")}
src_by = {r[0]: r for r in srcs[1:] if r and r[0]}
per = defaultdict(Counter)
mass_src = Counter()
for r in data[1:]:
    sp = r[0]
    if not sp:
        continue
    g = rdb.get(sp.strip())
    key = g if g else "not in RDB 2026-10"
    per[key]["species"] += 1
    for k, i in C.items():
        v = r[i]
        if v not in (None, "", "NA", "na", "-"):
            per[key][k] += 1
    if r[C["mass"]] not in (None, "", "NA"):
        s = src_by.get(sp, [None] * len(hdr))[C["mass"]]
        s = str(s or "")
        mass_src["Feldman et al. 2016 (allometry from length)" if "Feldman" in s else
                 "Slavenko/Meiri" if ("Slavenko" in s or "Meiri" in s) else "other/none given"] += 1
rdb_n = Counter(rdb.values())
out = {"repttraits_species": sum(c["species"] for c in per.values()),
       "per_group (counts of species with a value)": {g: dict(c) | {"rdb_species": rdb_n.get(g)} for g, c in per.items()},
       "mass_value_sources": dict(mass_src)}
print(json.dumps(out, indent=1))
