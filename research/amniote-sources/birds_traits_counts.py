"""Bird counts (Callaghan et al. 2021) and mass (AVONET, Tobias et al. 2022) against the Clements 2025 list
(AvesData 1.7 tips) (ToLaD#519). "Exact" = same binomial; "+Avibase" = otherwise the same Avibase concept id
(AVONET's eBird sheet carries it; the AvesData crosswalk carries Clements 2025's).

Run: uv run --project pipeline python research/amniote-sources/birds_traits_counts.py
"""
import csv
import json
from collections import Counter
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
A = ROOT / "data" / "raw" / "amniotes"

cw = [r for r in csv.DictReader(open(A / "avesdata" / "OTT_crosswalk_2025.csv", newline="")) if r["CATEGORY"] == "species"]
cl = {r.get("sci_name_2025") or r["SCI_NAME"] for r in cw}
avi2cl = {r["TAXON_CONCEPT_ID"]: (r.get("sci_name_2025") or r["SCI_NAME"]) for r in cw}
# Clements 2025 names by their pre-2025 names too (a cheap synonym step: SCI_NAME is the older name)
old2cl = {r["SCI_NAME"]: (r.get("sci_name_2025") or r["SCI_NAME"]) for r in cw}
out = {"clements2025_species": len(cl)}
# OTT 3.7.3 names and synonyms -> uid, for a synonym step between taxonomies
n2u = {}
for f in ("amniota_taxonomy.tsv", "amniota_synonyms.tsv"):
    for line in open(A / "ott" / f, encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        nm, uid = (p[2], p[0]) if f.startswith("amniota_t") else (p[0], p[1])
        n2u.setdefault(nm, set()).add(uid)
u2cl = {}
for c in cl:
    for u in n2u.get(c, ()):
        u2cl.setdefault(u, c)


def via_ott(names):
    return {u2cl[u] for n in names for u in n2u.get(n, ()) if u in u2cl}

# Callaghan 2021
rows = list(csv.DictReader(open(A / "callaghan2021" / "Tables" / "all_species_summary_table.csv", encoding="latin1")))
names = {r["Scientific name"] for r in rows}
ex = names & cl
via = {old2cl[n] for n in names - cl if n in old2cl} | via_ott(names - cl)
out["callaghan2021"] = {"species": len(rows), "training_species (independent estimate)": sum(r["Training species"] == "TRUE" for r in rows),
                       "range_adjusted": sum(r["Range adjusted"] == "TRUE" for r in rows),
                       "clements2025_exact": len(ex), "clements2025_after_ott_synonyms": len(ex | via),
                       "share_of_clements2025": round(len(ex | via) / len(cl), 3),
                       "sum_of_estimates_billion": round(sum(float(r["Abundance estimate"]) for r in rows) / 1e9, 1)}
# CI width: median ratio upper/lower
rat = sorted(float(r["95% Upper CI"]) / max(1.0, float(r["95% Lower CI"])) for r in rows)
out["callaghan2021"]["median_upper/lower_CI_ratio"] = round(rat[len(rat) // 2], 1)

wb = openpyxl.load_workbook(A / "avonet" / "AVONET_Supplementary_dataset_1.xlsx", read_only=True)
ws = wb["AVONET2_eBird"]
it = ws.iter_rows(values_only=True)
hdr = list(next(it))
ix = {h: i for i, h in enumerate(hdr)}
got, src, inf = set(), Counter(), Counter()
n = 0
for r in it:
    if not r[ix["Species2"]]:
        continue
    n += 1
    nm, avi = r[ix["Species2"]], r[ix["Avibase.ID2"]]
    if r[ix["Mass"]] in (None, "", "NA"):
        continue
    src[str(r[ix["Mass.Source"]])[:30]] += 1
    inf[str(r[ix["Inference"]])] += 1
    if nm in cl:
        got.add(nm)
    elif avi in avi2cl:
        got.add(avi2cl[avi])
    elif nm in old2cl:
        got.add(old2cl[nm])
out["avonet_eBird_sheet"] = {"species": n, "with_mass": sum(src.values()), "mass_source": dict(src.most_common(5)),
                             "inference_flag": dict(inf), "clements2025_with_mass": len(got),
                             "share_of_clements2025": round(len(got) / len(cl), 3)}
print(json.dumps(out, indent=1))
