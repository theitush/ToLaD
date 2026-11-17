"""The Open Tree 16.1 synthesis subtree for Amniota (ott229560), as our pipeline would read it (tree.py reads the
Mammalia one): tips per group, binomial tips, extinct-flagged tips, polytomies, and whether the backbone splits
(Amniota, Sauropsida, Archelosauria, Archosauria, Lepidosauria) are resolved (ToLaD#519).

Fetched: POST api.opentreeoflife.org/v3/tree_of_life/subtree {"node_id":"ott229560","label_format":"name_and_id"}
Run: uv run --project pipeline python research/amniote-sources/opentree_amniota.py
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from tolad_pipeline.newick import parse_newick  # noqa: E402

RAW = ROOT / "data" / "raw" / "amniotes"
BIN = re.compile(r"^[A-Z][a-z]+ [a-z][a-z-]+$")
sys.setrecursionlimit(1000000)

group, flags = {}, {}
for line in open(RAW / "ott" / "amniota_taxonomy.tsv", encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if p[0] == "uid":
        continue
    group[int(p[0])], flags[int(p[0])] = p[5], p[4]

t = parse_newick(json.loads((RAW / "opentree" / "amniota_subtree.json").read_text())["newick"])
ott_re = re.compile(r"_ott(\d+)$")
tips, poly = Counter(), Counter()
binom, ext = Counter(), Counter()
for n in t.iter_preorder():
    lab = (n.label or "").strip("'")
    m = ott_re.search(lab)
    if not n.children:
        uid = int(m.group(1)) if m else None
        g = group.get(uid, "not in OTT Amniota") if uid else "mrca label"
        tips[g] += 1
        name = lab[:m.start()].replace("_", " ") if m else lab
        if BIN.match(name):
            binom[g] += 1
        if uid and "extinct" in flags.get(uid, ""):
            ext[g] += 1
    elif len(n.children) > 2:
        uid = int(m.group(1)) if m else None
        poly[group.get(uid, "mrca node") if uid else "mrca node"] += 1


def find(name):
    for n in t.iter_preorder():
        if (n.label or "").startswith(name + "_ott"):
            return n
    return None


backbone = {}
for nm in ["Amniota", "Mammalia", "Sauropsida", "Aves", "Crocodylia", "Testudines", "Archosauria", "Lepidosauria",
           "Squamata", "Rhynchocephalia", "Dinosauria"]:
    n = find(nm)
    backbone[nm] = None if n is None else {"children": len(n.children),
                                           "child_labels": [(c.label or "")[:40] for c in n.children][:6]}
print(json.dumps({"tips_total": sum(tips.values()), "tips_by_group": dict(tips.most_common()),
                  "binomial_tips_by_group": dict(binom.most_common()),
                  "extinct_flagged_tips": dict(ext.most_common()),
                  "polytomy_nodes_by_group (labelled taxon nodes)": dict(poly.most_common()),
                  "backbone_nodes": backbone}, indent=1))
