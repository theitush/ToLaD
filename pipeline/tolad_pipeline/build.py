"""Rebuild the ToLaD mammal dataset from data/raw.

    uv run tolad-build [--raw data/raw] [--out data/mammals] [--work data/build]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

from . import load
from . import overrides as overrides_mod
from .merge import (apply_placements, assign_bands, build_leaf_index, calibrate, date_tree,
                    graft_pbdb, match_upham, rehome_stem_fossils, set_extinct_flags)
from .tree import (clean_opentree, collapse_knuckles, drop_empty,
                   from_opentree)


def log_step(t0: float, msg: str) -> None:
    print(f"[{time.time() - t0:6.1f}s] {msg}", file=sys.stderr)


def ott_cached(raw: Path, work: Path, ids: set[int]):
    cache = work / "ott_mammalia.json"
    if cache.exists():
        d = json.loads(cache.read_text())
        if set(map(int, d["ids"])) >= ids:
            tax = {int(k): {**v, "flags": set(v["flags"])} for k, v in d["tax"].items()}
            syn = {int(k): v for k, v in d["syn"].items()}
            return tax, syn
    tax, syn = load.load_ott(raw, ids)
    work.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({
        "ids": sorted(ids),
        "tax": {k: {**v, "flags": sorted(v["flags"])} for k, v in tax.items()},
        "syn": syn,
    }))
    return tax, syn


def build_tree(raw: Path, work: Path, log: dict, t_start: float):
    from .model import ANCHOR_T0
    nroot, about = load.load_opentree(raw)
    log["opentree"] = {"synth_id": about.get("synth_id"), "taxonomy_version": about.get("taxonomy_version")}
    if about.get("synth_id") != "opentree16.1":
        raise RuntimeError(f"expected Open Tree synth opentree16.1, raw snapshot is {about.get('synth_id')}")
    ids = {n.ott for n in nroot.iter_preorder() if n.ott}
    tax, ott_syn = ott_cached(raw, work, ids)
    log_step(t_start, f"OTT rows for {len(tax)} of {len(ids)} ids")
    root = from_opentree(nroot, tax)
    root.name = "Mammalia"
    n_raw_tips = sum(1 for x in root.preorder() if x.is_leaf)
    clean_opentree(root, log)
    log["opentree"]["raw_tips"] = n_raw_tips
    log["opentree"]["species_tips"] = sum(1 for x in root.preorder() if x.is_leaf and not x.data.get("empty_higher"))

    up_root, up_tax = load.load_upham(raw)
    phy, phy_syn = load.load_phylacine(raw)
    exact, syn = build_leaf_index(root, ott_syn, phy_syn)
    match_upham(root, up_root, up_tax, exact, syn, log)
    log_step(t_start, f"Upham match {log['upham_match']}")

    pb_species, _pb_genera = load.load_pbdb(raw)
    pb_by_name = {load.norm_name(r["taxon_name"]): r for r in pb_species}
    set_extinct_flags(root, phy, pb_by_name, log)
    ov = overrides_mod.load()
    graft_pbdb(root, pb_species, exact, syn, log, ov)
    log_step(t_start, f"PBDB graft {log['pbdb_graft']}")
    n_drop = drop_empty(root)
    log["opentree"]["empty_higher_dropped"] = n_drop

    calibrate(root, up_root, log)
    apply_placements(root, ov, log)
    rehome_stem_fossils(root, log)
    log_step(t_start, f"stem re-homing: {log['stem_rehoming']['subtrees_moved']} fossil subtrees")
    ov.check_all_used()
    log["overrides"] = ov.report()
    date_tree(root, log)
    assign_bands(root, ANCHOR_T0)
    n_k = collapse_knuckles(root)
    log["knuckles_collapsed"] = n_k
    ctx = {"phy": phy, "phy_syn": phy_syn, "ott_syn": ott_syn, "exact": exact, "syn": syn}
    return root, ctx


def main(argv: list[str] | None = None) -> int:
    rootdir = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, default=rootdir / "data" / "raw")
    ap.add_argument("--out", type=Path, default=rootdir / "data" / "mammals")
    ap.add_argument("--work", type=Path, default=rootdir / "data" / "build")
    a = ap.parse_args(argv)
    t_start = time.time()
    log: dict = {}
    root, ctx = build_tree(a.raw, a.work, log, t_start)
    log_step(t_start, "tree built")

    from . import model, tiles
    model.run(root, a.raw, ctx, log)
    log_step(t_start, "counts modelled")
    from . import redlist
    redlist.attach(root, a.raw, ctx, log)
    log_step(t_start, f"Red List status: {log['red_list']['living_by_source']}")
    dj = log.get("history", {}).get("deep_join")
    if dj:  # the genomic deep past's join (ToLaD#80): rules applied and species beyond the flag
        log_step(t_start, f"genomic join: {dj['by_rule']}, flagged {dj['flagged_by_rule']}")
        for sp, f in dj["flagged"].items():
            print(f"    flagged {sp}: genomic/next {f['ratio']:.3g} ({f['to_kind']}), {f['rule']}"
                  + (f" x{f['factor']:.3g}" if f["rule"] == "scaled" else ""), file=sys.stderr)
    log["counts"] = counts(root)
    log["spot_checks"] = spot_checks(root)
    log["calibration_check"] = calibration_report(root, a.raw)
    log["top_orders"] = top_orders(root)
    from . import audit  # the data audit's per-leaf snapshot (ToLaD#113): `make audit` checks it
    log_step(t_start, f"audit snapshot {audit.snapshot(root, a.raw, a.work)}")
    tiles.write_all(root, a.out, log)
    log_step(t_start, "tiles written")
    (a.out / "stats.json").write_text(json.dumps(log, indent=1, default=_json_default, sort_keys=True) + "\n")
    print(json.dumps({k: log[k] for k in ("counts", "spot_checks", "output", "upham_match", "pbdb_match")},
                     indent=1, default=_json_default))
    return 0


def _json_default(o):
    if isinstance(o, (set, frozenset)):
        return sorted(o)
    if isinstance(o, Counter):
        return dict(o)
    try:
        return float(o)
    except (TypeError, ValueError):
        return str(o)


def counts(root) -> dict:
    nodes = list(root.preorder())
    leaves = [n for n in nodes if n.is_leaf]
    return {
        "nodes": len(nodes),
        "internal": len(nodes) - len(leaves),
        "tips": len(leaves),
        "tips_extant": sum(1 for n in leaves if not n.extinct),
        "tips_extinct": sum(1 for n in leaves if n.extinct),
        "tips_extinct_in_opentree": sum(1 for n in leaves if n.extinct and n.kind == "tree"),
        "tips_fossil_grafted": sum(1 for n in leaves if n.kind == "graft"),
        "taxonomic_nodes": sum(1 for n in nodes if n.taxonomic),
    }


CHECK_SPECIES = ["Canis lupus", "Vulpes vulpes", "Loxodonta africana", "Mus musculus", "Rattus norvegicus",
                 "Odocoileus virginianus", "Pan troglodytes", "Balaenoptera musculus", "Phoca vitulina",
                 "Myotis lucifugus", "Macropus giganteus", "Macropus rufus", "Sus scrofa", "Ursus arctos",
                 "Felis catus", "Gorilla gorilla", "Procyon lotor", "Tadarida brasiliensis"]


def calibration_report(root, raw: Path) -> dict:
    """Wild alive counts of well-known species against published figures."""
    from . import anchors
    census = anchors.greenspoon_census(raw)
    model = anchors.greenspoon_species_model(raw)
    commensal = anchors.greenspoon_commensal(raw)
    rows = {}
    for n in root.preorder():
        if not n.is_leaf or n.name not in CHECK_SPECIES or n.name in rows:
            continue
        D = n.data
        dom = D.get("domestic", {}).get("stock", 0.0)
        if n.name in census:
            pub, src = census[n.name]["N"], "IUCN population report (Greenspoon 2023 compilation)"
        elif n.name in model:
            pub, src = model[n.name]["N"], "Greenspoon 2023 per-species model (no census exists)"
        elif n.name in commensal:
            pub, src = commensal[n.name], "Greenspoon 2023 order-of-magnitude guess"
        else:
            pub, src = None, "no published global estimate found"
        rows[n.name] = {"wild_alive": D["alive"] - dom, "domestic_alive": dom, "ever": D["ever"],
                        "occupancy_model_only": D.get("N_model_oos"), "published": pub, "published_source": src,
                        "method": "; ".join(D["meth"][-2:])}
    return {k: rows[k] for k in CHECK_SPECIES if k in rows}


def top_orders(root, k: int = 10) -> dict:
    orders = [n for n in root.preorder() if n.rank == "order" and not n.is_leaf and not n.data.get("crown_of")]

    def row(n):
        D = n.data
        return {"name": n.name, "ever": D["ever"], "ghost": D["ghost"], "ghost_share": round(D["ghost"] / D["ever"], 3),
                "sampled": D["ever"] - D["ghost"], "alive": D["alive"], "t0_Ma": round(n.t0, 2)}
    return {"by_ever": [row(n) for n in sorted(orders, key=lambda n: -n.data["ever"])[:k]],
            "by_alive": [row(n) for n in sorted(orders, key=lambda n: -n.data["alive"])[:k]],
            "by_sampled_ever": [row(n) for n in sorted(orders, key=lambda n: -(n.data["ever"] - n.data["ghost"]))[:k]]}


def spot_checks(root) -> dict:
    out = {}
    want = {"Homo sapiens", "Mammuthus", "Mammuthus primigenius", "Mammalia", "Hominidae", "Bos taurus"}
    for n in root.preorder():
        key = n.name if n.name in want else next((a for a in n.alt if a in want), None)
        if key and key not in out:
            D = n.data
            out[key] = {"alive": D["alive"], "ever": D["ever"], "ghost": D.get("ghost", 0.0),
                        "t0_Ma": n.t0, "t1_Ma": n.t1, "extinct(gray)": n.t1 > 0 or D["alive"] == 0,
                        "grade": "ABCD"[D["grade"]],
                        "ever_range": [D["ever"] / 10 ** D["lo"], D["ever"] * 10 ** D["hi"]]}
    return out


if __name__ == "__main__":
    sys.exit(main())
