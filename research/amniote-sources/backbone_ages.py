"""Backbone split ages as the fetched dated trees give them (ToLaD#519): the MRCA height of named tip sets.

Run: uv run --project pipeline python research/amniote-sources/backbone_ages.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from tolad_pipeline.newick import parse_newick, parse_nexus_tree  # noqa: E402

RAW = ROOT / "data" / "raw"
A = RAW / "amniotes"


def load(p):
    s = p.read_text()
    return parse_nexus_tree(s) if s.lstrip().upper().startswith("#NEXUS") else parse_newick(s.strip())


def ages(t, sets):
    depth, stack = {}, [(t, 0.0)]
    while stack:
        n, d = stack.pop()
        depth[id(n)] = d
        stack.extend((c, d + (c.length or 0.0)) for c in n.children)
    H = max(depth[id(n)] for n in t.iter_preorder() if not n.children)
    tips = {}
    for n in t.iter_preorder():
        if not n.children and n.label:
            tips[n.label.strip("'").replace(" ", "_")] = n
    out = {}
    for name, (a, b) in sets.items():
        pa, pb = [], set()
        x = tips.get(a)
        y = tips.get(b)
        if x is None or y is None:
            out[name] = None
            continue
        while x is not None:
            pa.append(x)
            x = x.parent
        while y is not None:
            pb.add(id(y))
            y = y.parent
        m = next(n for n in pa if id(n) in pb)
        out[name] = round(H - depth[id(m)], 1)
    return out


up_tips = None
res = {
    "Upham 2019 ND MCC (mammals + Anolis outgroup)": ages(
        load(RAW / "upham" / "MamPhy_fullPosterior_BDvr_Completed_5911sp_topoCons_NDexp_MCC_v2_target.tre"),
        {}),
}
# Upham labels are Genus_species_FAMILY_ORDER: find the Anolis tip and a mammal tip by prefix
t = load(RAW / "upham" / "MamPhy_fullPosterior_BDvr_Completed_5911sp_topoCons_NDexp_MCC_v2_target.tre")
labs = [n.label for n in t.iter_preorder() if not n.children]
an = next(x for x in labs if x.startswith("_Anolis") or x.startswith("Anolis"))
hs = next(x for x in labs if x.startswith("Homo_sapiens"))
oa = next(x for x in labs if x.startswith("Ornithorhynchus_anatinus"))
res["Upham 2019 ND MCC (mammals + Anolis outgroup)"] = ages(t, {"Amniota (Anolis vs mammals)": (an, hs),
                                                               "Mammalia crown": (oa, hs)})
res["AvesData 1.7 summary (Clements 2025)"] = ages(load(A / "avesdata" / "summary_dated_clements.nex"), {
    "Aves crown (Struthio vs Gallus)": ("Struthio_camelus", "Gallus_gallus"),
    "Neognathae (Gallus vs Passer)": ("Gallus_gallus", "Passer_domesticus")})
res["Colston 2020 PASTIS tree 1"] = ages(load(A / "colston2020" / "colston2020_pastis_tree1.tre"), {
    "Sauria (Sphenodon vs turtles)": ("Sphenodon_punctatus", "Chelonia_mydas"),
    "Archelosauria (turtles vs crocodilians)": ("Chelonia_mydas", "Crocodylus_niloticus"),
    "Testudines crown (Pleurodira vs Cryptodira)": ("Chelonia_mydas", "Chelus_fimbriata"),
    "Crocodylia crown (Alligator vs Crocodylus)": ("Alligator_mississippiensis", "Crocodylus_niloticus")})
res["Tonini 2016 posterior tree 1"] = ages(load(A / "tonini2016" / "tonini2016_posterior_9755_tree1.tre"), {
    "Lepidosauria (Sphenodon vs squamates)": ("Sphenodon_punctatus", "Anolis_carolinensis"),
    "Squamata crown (dibamid/gecko vs Anolis)": ("Gekko_gecko", "Anolis_carolinensis"),
    "Serpentes crown (Python vs Typhlops)": ("Python_regius", "Typhlops_jamaicensis")})
res["Title 2024 time-calibrated"] = ages(load(A / "title2024" / "squamates_Title_Science2024_ultrametric_constrained.tre"), {
    "Squamata crown (gecko vs Anolis)": ("Gekko_gecko", "Anolis_carolinensis"),
    "Serpentes crown (Python vs Typhlops)": ("Python_regius", "Typhlops_jamaicensis")})
print(json.dumps(res, indent=1))
