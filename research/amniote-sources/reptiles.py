"""Reptile list (Reptile Database, Oct 2026) against the reptile trees we could fetch (ToLaD#519).

Trees: Title et al. 2024 time-calibrated (6,885 tips, github.com/macroevolution/squamata), Tonini et al. 2016
posterior tree 1 (9,755 tips, read by range from data.vertlife.org), Colston et al. 2020 PASTIS posterior tree 1
(turtles + crocodilians + tuatara, Zenodo 4986456).
"Exact" = genus + epithet equal. "+OTT synonyms" = the list name and the tip share an OTT 3.7.3 uid, through
accepted names and synonyms under Amniota (ott_amniota.py).

Run: uv run --project pipeline python research/amniote-sources/reptiles.py
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from tolad_pipeline.newick import parse_newick  # noqa: E402

RAW = ROOT / "data" / "raw" / "amniotes"
BIN = re.compile(r"^[A-Z][a-z]+ [a-z][a-z-]+$")
AMPHIS = {"Amphisbaenidae", "Bipedidae", "Blanidae", "Cadeidae", "Rhineuridae", "Trogonophidae"}

ws = openpyxl.load_workbook(RAW / "reptiledb" / "reptile_checklist_2026_10.xlsx", read_only=True).worksheets[0]
rdb = {}
for r in ws.iter_rows(min_row=2, values_only=True):
    if r[1]:
        order, fam = r[4], r[5]
        grp = ("Amphisbaenia" if fam in AMPHIS else "Lizards" if order == "Sauria" else "Snakes" if order == "Serpentes"
               else order or "unknown")
        rdb[r[1].strip()] = grp

name2uid = defaultdict(set)
for line in open(RAW / "ott" / "amniota_taxonomy.tsv", encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if p[3] == "species":
        name2uid[p[2]].add(p[0])
for line in open(RAW / "ott" / "amniota_synonyms.tsv", encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if BIN.match(p[0]):
        name2uid[p[0]].add(p[1])


def height(t):
    best, stack = 0.0, [(t, 0.0)]
    while stack:
        n, h = stack.pop()
        best = max(best, h)
        stack.extend((c, h + (c.length or 0.0)) for c in n.children)
    return best


trees = {
    "Title 2024 (time-calibrated)": RAW / "title2024" / "squamates_Title_Science2024_ultrametric_constrained.tre",
    "Tonini 2016 (posterior tree 1)": RAW / "tonini2016" / "tonini2016_posterior_9755_tree1.tre",
    "Colston 2020 (PASTIS tree 1)": RAW / "colston2020" / "colston2020_pastis_tree1.tre",
}
out = {"reptiledb_species": len(rdb), "reptiledb_by_group": dict(Counter(rdb.values()).most_common())}
for label, path in trees.items():
    t = parse_newick(path.read_text().strip())
    tips = [n.label.replace("_", " ").strip("'").strip() for n in t.iter_preorder() if not n.children]
    tipset = set(tips)
    tip_uids = set()
    for x in tipset:
        tip_uids |= name2uid.get(x, set())
    by = defaultdict(lambda: [0, 0, 0])
    for nm, g in rdb.items():
        hit = nm in tipset
        syn = (not hit) and bool(name2uid.get(nm, set()) & tip_uids)
        if hit or syn or True:
            by[g][0] += 1
            by[g][1] += hit
            by[g][2] += syn
    covered = {g: v for g, v in by.items() if v[1] + v[2] > 0}
    not_in_rdb = sum(1 for x in tipset if x not in rdb)
    out[label] = {"tips": len(tips), "root_age_Ma": round(height(t), 1),
                  "tips_not_in_reptiledb_exact": not_in_rdb,
                  "per_group [rdb species, exact, +ott synonyms]": covered}
print(json.dumps(out, indent=1))
