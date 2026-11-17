"""Bird species lists measured against the AvesData 1.7 tree (ToLaD#519).

IOC's own cross-reference (IOC_15.2_vs_other_lists.xlsx, worldbirdnames.org) aligns IOC 15.2, AviList v2025,
Clements v2025 and HBW/BirdLife v10 row by row. AviList's own site refuses scripted reads (Cloudflare 403), so
AviList is counted from this file. A species of a list = a two-word name in that list's column.
"Exact" = the name is an AvesData tip. "+crosswalk" = otherwise the Clements v2025 name on the same row is a tip.

Run: uv run --project pipeline python research/amniote-sources/birds_lists.py
"""
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "amniotes"
BIN = re.compile(r"^[A-Z][a-z]+ [a-z][a-z-]+$")

tips = set()
txt = (RAW / "avesdata" / "summary_dated_clements.nex").read_text()
block = txt.split("TAXLABELS", 1)[1].split(";", 1)[0]
tips = {t.strip().strip("'").replace("_", " ") for t in block.split() if t.strip()}

wb = openpyxl.load_workbook(RAW / "ioc" / "IOC_15.2_vs_other_lists.xlsx", read_only=True)
ws = wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
hdr = rows[0]
col = {"IOC 15.2": 1, "AviList v2025": 4, "Clements v2025": 6, "HBW/BirdLife v10": 7}
assert str(hdr[4]).startswith("AviList") and str(hdr[6]).startswith("Clements") and str(hdr[7]).startswith("HBW")
out = {"avesdata_tips": len(tips)}
for name, c in col.items():
    sp, exact, cross = set(), 0, 0
    seen = set()
    for r in rows[1:]:
        v = (r[c] or "").strip() if isinstance(r[c], str) else ""
        if not BIN.match(v) or v in seen:
            continue
        seen.add(v)
        sp.add(v)
        if v in tips:
            exact += 1
        else:
            cl = (r[6] or "").strip() if isinstance(r[6], str) else ""
            if BIN.match(cl) and cl in tips:
                cross += 1
    out[name] = {"species": len(sp), "exact_in_tree": exact, "via_clements_row": cross,
                 "rate_exact": round(exact / len(sp), 4), "rate_after_crosswalk": round((exact + cross) / len(sp), 4)}
# extinct flags in the IOC master (species extinct since 1500 that IOC lists)
wb2 = openpyxl.load_workbook(RAW / "ioc" / "IOC_Names_File_Plus-15.2.xlsx", read_only=True)
ws2 = wb2.worksheets[0]
n_sp = n_ext = 0
for r in ws2.iter_rows(min_row=2, values_only=True):
    if r[4] == "Species":
        n_sp += 1
        if r[5]:
            n_ext += 1
out["ioc_master_species"] = n_sp
out["ioc_master_extinct_flagged"] = n_ext  # † extinct since 1500, †† possibly extinct
print(json.dumps(out, indent=1))
