"""GARD 1.7 (Roll et al. 2017; Caetano et al. 2022; CC0): the attribute table of its range shapefile (the .dbf only;
the 855 MB .shp is left for Ita to fetch), matched to the Reptile Database Oct 2026 by exact name (ToLaD#519).

Run: uv run --project pipeline python research/amniote-sources/gard.py
"""
import json
import struct
from collections import Counter
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
A = ROOT / "data" / "raw" / "amniotes"
AMPHIS = {"Amphisbaenidae", "Bipedidae", "Blanidae", "Cadeidae", "Rhineuridae", "Trogonophidae"}


def read_dbf(p):
    b = p.read_bytes()
    n, hlen, rlen = struct.unpack("<IHH", b[4:12])
    fields, o = [], 32
    while b[o] != 0x0D:
        name = b[o:o + 11].split(b"\0")[0].decode()
        fields.append((name, b[o + 11:o + 12].decode(), b[o + 16]))
        o += 32
    rows = []
    for i in range(n):
        r = b[hlen + i * rlen: hlen + (i + 1) * rlen]
        if r[:1] == b"*":
            continue
        pos, d = 1, {}
        for name, typ, ln in fields:
            d[name] = r[pos:pos + ln].decode("latin1").strip()
            pos += ln
        rows.append(d)
    return fields, rows


fields, rows = read_dbf(A / "gard17" / "Gard_1_7_ranges.dbf")
rdb = {}
for r in openpyxl.load_workbook(A / "reptiledb" / "reptile_checklist_2026_10.xlsx", read_only=True).worksheets[0].iter_rows(min_row=2, values_only=True):
    if r[1]:
        rdb[r[1].strip()] = ("Amphisbaenia" if r[5] in AMPHIS else "Lizards" if r[4] == "Sauria" else
                             "Snakes" if r[4] == "Serpentes" else r[4] or "unknown")
namef = next(f[0] for f in fields if f[0].lower() in ("binomial", "binomial_", "species", "sci_name"))
names = {r[namef] for r in rows}
hit = Counter(rdb[n] for n in names if n in rdb)
tot = Counter(rdb.values())
print(json.dumps({"fields": [f[0] for f in fields], "rows": len(rows), "species": len(names),
                  "group_field_values": dict(Counter(r.get("group", r.get("Group", "")) for r in rows)),
                  "rdb_exact_by_group": {g: [hit[g], tot[g], round(hit[g] / tot[g], 3)] for g in tot},
                  "rdb_exact_total": [sum(hit.values()), len(rdb)]}, indent=1))
