"""PBDB amniote species per group, with ages, and where they would attach through our existing graft (ToLaD#519).

Input: data/raw/amniotes/pbdb/amniota_species.json (taxa/list, base_name=Amniota, rank=species, accepted,
pres=regular, show=app,parent,class: the query fetch.py makes for Mammalia) and groups/<Group>.json (the same per
group, ids only, to assign each species a group).

The attach measure mirrors merge.graft_pbdb's ladder against the Open Tree 16.1 Amniota synthesis subtree (the
tree our build would start from): (1) the name is a synth tip ("matched leaf"); else (2) the genus is a labelled
synth node or has synth leaves ("under OT genus"); else (3) the PBDB family is a labelled synth node ("under OT
family"); else (4) the PBDB order is ("under OT order"); else the incertae-sedis bucket. Only extinct species
with a first appearance and occurrences are grafted, as merge.py requires. A second column asks the same of
OTT 3.7.3 (the taxonomy, which holds more fossil genera than the synthesis).

Run: uv run --project pipeline python research/amniote-sources/fossils.py
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from tolad_pipeline.newick import parse_newick  # noqa: E402

A = ROOT / "data" / "raw" / "amniotes"
BIN = re.compile(r"^[A-Z][a-z]+ [a-z][a-z-]+$")
sys.setrecursionlimit(1000000)

recs = json.loads((A / "pbdb" / "amniota_species.json").read_text())["records"]
gid = {}
for g in ["Aves", "Dinosauria", "Pterosauria", "Crocodylia", "Crocodylomorpha", "Testudines", "Testudinata",
          "Squamata", "Rhynchocephalia", "Lepidosauria", "Ichthyopterygia", "Sauropterygia", "Thalattosauria",
          "Synapsida", "Mammalia", "Mammaliaformes", "Archosauria", "Parareptilia", "Choristodera"]:
    gid[g] = {r["taxon_no"] for r in json.loads((A / "pbdb" / "groups" / f"{g}.json").read_text())["records"]}
ORDER = [("Birds", ["Aves"]), ("Non-avian dinosaurs", ["Dinosauria"]), ("Pterosaurs", ["Pterosauria"]),
         ("Crocodilians (crown)", ["Crocodylia"]), ("Other crocodylomorphs", ["Crocodylomorpha"]),
         ("Turtles (crown)", ["Testudines"]), ("Stem turtles", ["Testudinata"]),
         ("Lizards and snakes", ["Squamata"]), ("Tuatara and kin", ["Rhynchocephalia", "Lepidosauria"]),
         ("Marine reptiles", ["Ichthyopterygia", "Sauropterygia", "Thalattosauria"]),
         ("Mammals", ["Mammalia"]), ("Non-mammal synapsids", ["Synapsida", "Mammaliaformes"]),
         ("Other archosaurs", ["Archosauria"]), ("Parareptiles", ["Parareptilia"]), ("Choristoderes", ["Choristodera"])]


def group_of(no):
    for label, gs in ORDER:
        if any(no in gid[g] for g in gs):
            return label
    return "Other amniotes"


# Open Tree synth Amniota: tip names, labelled node names
t = parse_newick(json.loads((A / "opentree" / "amniota_subtree.json").read_text())["newick"])
ott_re = re.compile(r"[_ ]ott(\d+)$")
synth_tips, synth_nodes, synth_genera = set(), set(), set()
for n in t.iter_preorder():
    lab = (n.label or "").strip("'")
    m = ott_re.search(lab)
    name = (lab[:m.start()] if m else lab).replace("_", " ")
    name = re.sub(r" \(.*\)$", "", name)
    if not n.children:
        synth_tips.add(name)
        if BIN.match(name):
            synth_genera.add(name.split()[0])
    elif m:
        synth_nodes.add(name)
# OTT taxonomy names (all ranks) under Amniota
ott_names = set()
for line in open(A / "ott" / "amniota_taxonomy.tsv", encoding="utf-8"):
    ott_names.add(line.split("\t")[2])


def ladder(r, tips, nodes, genera):
    name = r["taxon_name"]
    g = r.get("genus") or name.split()[0]
    if name in tips:
        return "matched leaf"
    if g in nodes or g in genera:
        return "under genus"
    if r.get("family") and r["family"] in nodes:
        return "under family"
    if r.get("order") and r["order"] in nodes:
        return "under order"
    return "bucket"


per = defaultdict(Counter)
ages = defaultdict(list)
for r in recs:
    name = r["taxon_name"]
    if not BIN.match(name):
        per[group_of(r["taxon_no"])]["not a plain binomial"] += 1
        continue
    g = group_of(r["taxon_no"])
    c = per[g]
    c["species"] += 1
    if r.get("is_extant") == "extant":
        c["extant"] += 1
        continue
    c["extinct or unknown"] += 1
    fad = r.get("firstapp_max_ma")
    if fad is None or not r.get("n_occs"):
        c["no range/occurrences (skipped by merge.py)"] += 1
        continue
    c["graftable"] += 1
    fmid = (float(r["firstapp_max_ma"]) + float(r["firstapp_min_ma"])) / 2
    ages[g].append(fmid)
    c["synth: " + ladder(r, synth_tips, synth_nodes, synth_genera)] += 1
    c["OTT: " + ladder(r, ott_names, ott_names, ott_names)] += 1


def era(a):
    return "Cenozoic" if a < 66 else "Mesozoic" if a < 251.9 else "Paleozoic"


out = {}
for g, c in sorted(per.items(), key=lambda kv: -kv[1]["species"]):
    a = sorted(ages[g])
    d = dict(c)
    if a:
        d["first_appearance_Ma (min/median/max)"] = [round(a[0], 1), round(a[len(a) // 2], 1), round(a[-1], 1)]
        d["by_era"] = dict(Counter(era(x) for x in a))
    out[g] = d
tot = Counter()
for c in per.values():
    tot.update(c)
out["ALL"] = dict(tot)
print(json.dumps(out, indent=1))
