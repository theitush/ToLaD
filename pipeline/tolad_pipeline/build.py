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
from .merge import (assign_bands, build_leaf_index, calibrate, date_tree,
                    graft_pbdb, match_upham, set_extinct_flags)
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
    graft_pbdb(root, pb_species, exact, syn, log)
    log_step(t_start, f"PBDB graft {log['pbdb_graft']}")
    n_drop = drop_empty(root)
    log["opentree"]["empty_higher_dropped"] = n_drop

    calibrate(root, up_root, log)
    date_tree(root, log)
    assign_bands(root, ANCHOR_T0)
    n_k = collapse_knuckles(root)
    log["knuckles_collapsed"] = n_k
    ctx = {"phy": phy, "phy_syn": phy_syn, "ott_syn": ott_syn}
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
    log["counts"] = counts(root)
    log["spot_checks"] = spot_checks(root)
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
