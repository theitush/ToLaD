"""AvesData 1.7 (Clements 2025) measured: tips, tips placed by data vs by taxonomy, root age,
and the Clements -> IOC / BirdLife / OTT crosswalk the release ships (ToLaD#519).

Run: uv run --project pipeline python research/amniote-sources/birds_tree.py
Reads data/raw/amniotes/avesdata/ (fetched from github.com/McTavishLab/AvesData, CC BY 4.0).
"""
import csv
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from tolad_pipeline.newick import parse_newick, parse_nexus_tree  # noqa: E402

D = ROOT / "data" / "raw" / "amniotes" / "avesdata"


def tips(t):
    return [n.label.replace("_", " ").strip("'") for n in t.iter_preorder() if not n.children]


def height(t):
    best = 0.0
    def walk(n, h):
        nonlocal best
        best = max(best, h)
        for c in n.children:
            walk(c, h + (c.length or 0.0))
    sys.setrecursionlimit(100000)
    walk(t, 0.0)
    return best


out = {}
summ = parse_nexus_tree((D / "summary_dated_clements.nex").read_text())
mcc = parse_nexus_tree((D / "mcc_dated_clements.nex").read_text())
phylo = parse_newick((D / "phylo_only_clements_labels.tre").read_text().strip())
ts, tp = tips(summ), tips(phylo)
out["summary_dated_tips"] = len(ts)
out["summary_dated_unique"] = len(set(ts))
out["mcc_tips"] = len(tips(mcc))
out["phylo_only_tips (placed by data)"] = len(set(tp))
out["placed_by_taxonomy_only"] = len(set(ts) - set(tp))
out["phylo_only_not_in_summary"] = len(set(tp) - set(ts))
out["root_age_Ma_summary"] = round(height(summ), 2)
out["root_age_Ma_mcc"] = round(height(mcc), 2)

rows = list(csv.DictReader(open(D / "OTT_crosswalk_2025.csv", newline="")))
sp = [r for r in rows if r["CATEGORY"] == "species"]
names = {r.get("sci_name_2025") or r["SCI_NAME"] for r in sp}
out["clements2025_species_rows"] = len(sp)
out["clements2025_species_names"] = len(names)
out["clements_in_dated_tree_exact"] = len(names & set(ts))
out["dated_tips_not_in_clements"] = len(set(ts) - names)
out["clements_orders"] = len({r["ORDER"] for r in sp})
out["clements_families"] = len({r["FAMILY"] for r in sp})
out["ott_match_type"] = dict(Counter(r["match_type"] for r in sp).most_common())
out["ioc_match_type"] = dict(Counter(r["IOC_match_type"] for r in sp).most_common())
out["birdlife_match_type"] = dict(Counter(r["Birdlife_match_type"] for r in sp).most_common())
out["howard_moore_match_type"] = dict(Counter(r["H_M_match_type"] for r in sp).most_common())
out["ioc_name_equal_clements"] = sum(1 for r in sp if r["IOC_name"] == (r.get("sci_name_2025") or r["SCI_NAME"]))
out["birdlife_name_equal_clements"] = sum(1 for r in sp if r["Birdlife_name"] == (r.get("sci_name_2025") or r["SCI_NAME"]))
# studies per tip: how many input trees support each placed tip
spt = {}
for line in open(D / "studies_per_tip.txt"):
    if ":" in line:
        k, v = line.split(":", 1)
        spt[k.strip()] = len([x for x in v.split(",") if x.strip()])
out["studies_per_tip_rows"] = len(spt)
out["studies_per_tip_hist"] = dict(sorted(Counter(min(v, 5) for v in spt.values()).items()))
print(json.dumps(out, indent=1))
