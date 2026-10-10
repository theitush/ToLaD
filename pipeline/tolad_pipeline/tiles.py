"""Cut the tree into a skeleton + subtree tiles and write the binary format
(pipeline/FORMAT.md), a JSON debug dump of the top levels and build stats."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import numpy as np

from . import anchors
from .model import (NATURAL_METHOD_FIT, NATURAL_METHOD_SCALED, NATURAL_STEP_YEAR, PROFILE_K, PROFILE_RANGE,
                    SOURCES)
from .tree import D_ANCHOR, DATE_SRC_NAMES, Node

FORMAT_VERSION = 1
# NATB (v1.2): per row, LOG16 natural baseline N, lo, hi, natural range km2, current range km2
NATB_PER_ROW = 5
NATB_FIELDS = ["n", "lo", "hi", "km2_natural", "km2_current"]
MAGIC = b"TLAD"
KIND_SKELETON, KIND_TILE = 0, 1
TILE_BUDGET = 2500

# quantizers ---------------------------------------------------------------

AGE_STEPS_PER_DEX = 6000
AGE_MIN_LOG = -6.0  # 1e-6 Ma = 1 year
LOG16_STEPS_PER_DEX = 1000
LOG16_MIN_LOG = -8.0
LOHI_STEPS_PER_DEX = 20
PROF_STEPS_PER_DEX = 20


def q_age(a: float) -> int:
    if a <= 0:
        return 0
    q = round((math.log10(a) - AGE_MIN_LOG) * AGE_STEPS_PER_DEX) + 1
    return max(1, min(65535, q))


def dq_age(q: int) -> float:
    return 0.0 if q == 0 else 10 ** ((q - 1) / AGE_STEPS_PER_DEX + AGE_MIN_LOG)


def q_log16(x: float) -> int:
    if x <= 0:
        return 0
    q = round((math.log10(x) - LOG16_MIN_LOG) * LOG16_STEPS_PER_DEX) + 1
    return max(1, min(65535, q))


def dq_log16(q: int) -> float:
    return 0.0 if q == 0 else 10 ** ((q - 1) / LOG16_STEPS_PER_DEX + LOG16_MIN_LOG)


def q_profile(p: np.ndarray) -> tuple[int, bytes]:
    peak = float(p.max())
    if peak <= 0:
        return 0, bytes([255] * PROFILE_K)
    qp = q_log16(peak)
    peak_q = dq_log16(qp)
    out = []
    for v in p:
        if v <= 0:
            out.append(255)
        else:
            out.append(int(max(0, min(254, round(-math.log10(v / peak_q) * PROF_STEPS_PER_DEX)))))
    return qp, bytes(out)


# flags --------------------------------------------------------------------

F_GRADE_MASK = 0x3
F_EXTINCT = 1 << 2
F_TAXONOMIC = 1 << 3
F_DATE_SHIFT = 4  # 2 bits
F_SPECIES = 1 << 6
F_STUB = 1 << 7
F_ANCHORED = 1 << 8
F_GRAFT = 1 << 9
F_GROUP = 1 << 10


def node_flags(n: Node, stub: bool) -> int:
    f = n.data["grade"] & F_GRADE_MASK
    if n.t1 > 0:
        f |= F_EXTINCT
    if n.taxonomic:
        f |= F_TAXONOMIC
    f |= (n.date_src & 3) << F_DATE_SHIFT
    if n.is_leaf:
        f |= F_SPECIES
    if stub:
        f |= F_STUB
    if n.date_src == D_ANCHOR or n.data.get("grade_cap") == 1 or n.data.get("anchored_count"):
        f |= F_ANCHORED
    if n.kind == "graft":
        f |= F_GRAFT
    if n.kind in ("group", "bucket"):
        f |= F_GROUP
    return f


# tiling -------------------------------------------------------------------


def cut_tiles(root: Node, budget: int) -> list[Node]:
    """Greedy bottom-up cut: returns tile roots (the tree root = skeleton)."""
    rem: dict[int, int] = {}
    roots: list[Node] = []
    for n in root.postorder():
        r = 1
        kids = []
        for c in n.children:
            if not c.data.get("tile_root"):
                r += rem[id(c)]
                kids.append(c)
        kids.sort(key=lambda c: -rem[id(c)])
        while r > budget and kids:
            c = kids.pop(0)
            c.data["tile_root"] = True
            roots.append(c)
            r -= rem[id(c)]
        rem[id(n)] = r
    return roots


def tile_members(tr: Node) -> list[tuple[Node, bool]]:
    """Preorder rows of a tile: (node, is_stub)."""
    out = []
    st = [tr]
    while st:
        n = st.pop()
        stub = n is not tr and n.data.get("tile_root", False)
        out.append((n, stub))
        if not stub:
            st.extend(reversed(n.children))
    return out


def representative(n: Node) -> str:
    while n.name is None and n.children:
        n = max(n.children, key=lambda c: c.data["ever"])
    return n.name or ""


# writer -------------------------------------------------------------------


def fourcc(s: str) -> int:
    return struct.unpack("<I", s.encode("ascii"))[0]


def write_container(path: Path, kind: int, n: int, sections: list[tuple[str, bytes, int]]) -> int:
    head = 16 + 16 * len(sections)
    off = (head + 7) & ~7
    table = []
    blobs = []
    for sid, data, count in sections:
        table.append(struct.pack("<IIII", fourcc(sid), off, len(data), count))
        pad = (-len(data)) % 8
        blobs.append(data + b"\0" * pad)
        off += len(data) + pad
    buf = bytearray(MAGIC + struct.pack("<HHII", FORMAT_VERSION, kind, n, len(sections)))
    buf += b"".join(table)
    buf += b"\0" * (((head + 7) & ~7) - len(buf))
    buf += b"".join(blobs)
    path.write_bytes(bytes(buf))
    return len(buf)


HIST_PREAMBLE = struct.Struct("<IIII")  # nspecies, npoints, nsegments, reserved
HIST_HEAD = struct.Struct("<IIIHHff")  # row, point0, seg0, npts, nseg, G, L  (24 B)
HIST_POINT = struct.Struct("<iHHHBBHH")  # year, n, lo, hi, grade, kind, cite, flags  (16 B)
HIST_SEG = struct.Struct("<ffHHBBH")  # year0, gens, start, end, grade, kind, reserved  (16 B)
HP_BASELINE = 1  # point flag: the pre-decline baseline


def hist_sources(root: Node) -> dict[tuple[str, str], int]:
    """Global (cite, url) table for HIST points, in tree order."""
    out: dict[tuple[str, str], int] = {}
    for n in root.preorder():
        rec = n.data.get("history")
        if rec is not None:
            for p in rec["curve"]:
                out.setdefault((p["cite"], p["url"]), len(out))
    assert len(out) < 65536
    return out


def hist_records(rows: list[tuple[Node, bool]]) -> list[tuple[int, dict]]:
    return [(i, nd.data["history"]) for i, (nd, stub) in enumerate(rows)
            if not stub and nd.data.get("history") is not None]


def encode_hist(rows: list[tuple[Node, bool]], cites: dict[tuple[str, str], int]) -> tuple[bytes, int, list[dict]]:
    """HIST section (FORMAT.md v1.1) + the per-species META entries aligned with it."""
    from .history import GRADES, K
    recs = hist_records(rows)
    heads, pts, segs, meta = [], [], [], []
    for row, rec in recs:
        heads.append(HIST_HEAD.pack(row, len(pts), len(segs), len(rec["curve"]), len(rec["segments"]),
                                    rec["G"], rec["L"]))
        for p in rec["curve"]:
            pts.append(HIST_POINT.pack(round(p["year"]), q_log16(p["n"]), q_log16(p["lo"]), q_log16(p["hi"]),
                                       GRADES.index(p["grade"]), K[p["kind"]], cites[(p["cite"], p["url"])],
                                       HP_BASELINE if p.get("baseline") else 0))
        for s in rec["segments"]:
            segs.append(HIST_SEG.pack(s["year0"], s["gens"], q_log16(s["start"]), q_log16(s["end"]),
                                      s["grade"], s["kind"], 0))
        meta.append({"species": rec["species"], "common": rec["common"], "component": rec["component"],
                     "use": rec["use"], "scope": rec["scope"], "file": rec["file"], "notes": rec["notes"],
                     "point_notes": [p["note"] for p in rec["curve"]]})
    if not recs:
        return b"", 0, []
    blob = HIST_PREAMBLE.pack(len(recs), len(pts), len(segs), 0) + b"".join(heads) + b"".join(pts) + b"".join(segs)
    return blob, len(recs), meta


def hist_debug(rec: dict, tile: int, row: int, gid: int) -> dict:
    from .history import KINDS
    return {
        "species": rec["species"], "common": rec["common"], "file": rec["file"], "use": rec["use"],
        "component": rec["component"], "tile": tile, "row": row, "gid": gid, "G": rec["G"], "L": rec["L"],
        "points": [{"year": round(p["year"]), "n": p["n"], "lo": p["lo"], "hi": p["hi"], "grade": p["grade"],
                    "kind": p["kind"], "baseline": bool(p.get("baseline")), "cite": p["cite"], "url": p["url"]}
                   for p in rec["curve"]],
        "segments": [{"year0": s["year0"], "gens": s["gens"], "start": s["start"], "end": s["end"],
                      "grade": "ABCD"[s["grade"]], "kind": KINDS[s["kind"]]} for s in rec["segments"]],
    }


def encode_rows(rows: list[tuple[Node, bool]], methods: dict[str, int], stub_tile: dict[int, int],
                extra_meta: dict, cites: dict[tuple[str, str], int] | None = None
                ) -> tuple[list[tuple[str, bytes, int]], int]:
    n = len(rows)
    chld = np.zeros(n, "<u2")
    t0 = np.zeros(n, "<u2")
    t1 = np.zeros(n, "<u2")
    ever = np.zeros(n, "<u2")
    aliv = np.zeros(n, "<u2")
    ghst = np.zeros(n, "<u2")
    lohi = np.zeros(2 * n, "u1")
    flag = np.zeros(n, "<u2")
    meth = np.zeros(n, "<u2")
    srcm = np.zeros(n, "<u2")
    ppk = np.zeros(n, "<u2")
    prof = bytearray()
    ntip = np.zeros(n, "<u4")
    gid = np.zeros(n, "<u4")
    ott = np.zeros(n, "<u4")
    pbdb = np.zeros(n, "<u4")
    natb = np.zeros(NATB_PER_ROW * n, "<u2")
    names = []
    stubs = []
    stub_rep = []
    for i, (nd, stub) in enumerate(rows):
        D = nd.data
        chld[i] = 0 if stub else len(nd.children)
        t0[i] = q_age(nd.t0)
        t1[i] = q_age(nd.t1)
        ever[i] = q_log16(D["ever"])
        aliv[i] = q_log16(D["alive"])
        ghst[i] = q_log16(D.get("ghost", 0.0))
        lohi[2 * i] = min(255, round(D["lo"] * LOHI_STEPS_PER_DEX))
        lohi[2 * i + 1] = min(255, round(D["hi"] * LOHI_STEPS_PER_DEX))
        flag[i] = node_flags(nd, stub)
        meth[i] = methods[D["method_key"]]
        m = 0
        for b in D["src"]:
            m |= 1 << b
        srcm[i] = m
        qp, pb = q_profile(D["profile"])
        ppk[i] = qp
        prof += pb
        ntip[i] = D["ntips"]
        gid[i] = D["gid"]
        ott[i] = nd.ott or 0
        pbdb[i] = nd.pbdb or 0
        nat = D.get("natural")
        if nat is not None and not stub:
            natb[NATB_PER_ROW * i:NATB_PER_ROW * (i + 1)] = [
                q_log16(nat["N"]), q_log16(nat["lo"]), q_log16(nat["hi"]),
                q_log16(nat["km2_nat"]), q_log16(nat["km2_cur"])]
        names.append("|".join([nd.name or ""] + [a for a in nd.alt if a]))
        if stub:
            stubs.append((i, stub_tile[id(nd)]))
            stub_rep.append(representative(nd))
    blob = bytearray()
    offs = [0]
    for s in names:
        blob += s.encode("utf-8")
        offs.append(len(blob))
    name_sec = np.asarray(offs, "<u4").tobytes() + bytes(blob)
    stub_arr = np.asarray(stubs, "<u4").reshape(-1).tobytes() if stubs else b""
    meta = dict(extra_meta)
    meta["stub_rep"] = stub_rep
    hist_blob, n_hist, hist_meta = encode_hist(rows, cites or {})
    if n_hist:
        meta["hist"] = hist_meta
    secs = [
        ("CHLD", chld.tobytes(), n), ("T0__", t0.tobytes(), n), ("T1__", t1.tobytes(), n),
        ("EVER", ever.tobytes(), n), ("ALIV", aliv.tobytes(), n), ("GHST", ghst.tobytes(), n),
        ("LOHI", lohi.tobytes(), 2 * n), ("FLAG", flag.tobytes(), n), ("METH", meth.tobytes(), n),
        ("SRCM", srcm.tobytes(), n), ("PPK_", ppk.tobytes(), n), ("PROF", bytes(prof), n * PROFILE_K),
        ("NTIP", ntip.tobytes(), n), ("GID_", gid.tobytes(), n), ("OTT_", ott.tobytes(), n),
        ("PBDB", pbdb.tobytes(), n), ("STUB", stub_arr, len(stubs)), ("NAME", name_sec, n),
        ("META", json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 1),
    ]
    if n_hist:
        secs.append(("HIST", hist_blob, n_hist))
    secs.append(("NATB", natb.tobytes(), NATB_PER_ROW * n))
    return secs, n


def method_key(n: Node) -> str:
    if n.is_leaf:
        return "; ".join(n.data["meth"])
    k = "sum of children"
    if n.data.get("fill", 0) > 0:
        k += " + lineage fill (stem / gaps at the geometric-mean child lineage rate)"
    if n.data.get("ghost", 0) > 0:
        k += " + ghost lineages (02 §2.3 T_eff top-down estimate minus sampled tree, allocated down by lineage rate)"
    return k


def mock_individuals(root: Node, where: dict[int, tuple[int, int]]) -> list[dict]:
    by_name = {}
    for n in root.preorder():
        if n.is_leaf and n.name:
            by_name.setdefault(n.name, n)
    out = []
    for sp, name, born, died in anchors.MOCK_INDIVIDUALS:
        n = by_name.get(sp)
        if n is None:
            continue
        tile, idx = where[id(n)]
        out.append({
            "mock": True,
            "name": name,
            "species": sp,
            "species_gid": n.data["gid"],
            "tile": tile,
            "index": idx,
            "born": born,
            "died": died,
            "alive": died is None,
            "note": anchors.MOCK_NOTE,
        })
    return out


def write_all(root: Node, out: Path, log: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    tdir = out / "t"
    tdir.mkdir(exist_ok=True)
    for old in tdir.glob("*.tld"):
        old.unlink()
    # global ids, tip counts, method keys
    for i, n in enumerate(root.preorder()):
        n.data["gid"] = i
    for n in root.postorder():
        n.data["ntips"] = 1 if n.is_leaf else sum(c.data["ntips"] for c in n.children)
        n.data["method_key"] = method_key(n)
    methods: dict[str, int] = {}
    for n in root.preorder():
        methods.setdefault(n.data["method_key"], len(methods))
    assert len(methods) < 65536

    cites = hist_sources(root)
    tile_roots = cut_tiles(root, TILE_BUDGET)
    tile_roots.sort(key=lambda t: t.data["gid"])
    tile_id = {id(t): i for i, t in enumerate(tile_roots)}
    where: dict[int, tuple[int, int]] = {}
    files = []
    manifest = []
    for t in tile_roots:
        rows = tile_members(t)
        for i, (nd, stub) in enumerate(rows):
            if not stub:
                where[id(nd)] = (tile_id[id(t)], i)
        meta = {"tile": tile_id[id(t)], "root_gid": t.data["gid"], "root_name": representative(t)}
        secs, n = encode_rows(rows, methods, tile_id, meta, cites)
        fn = tdir / f"{tile_id[id(t)]}.tld"
        size = write_container(fn, KIND_TILE, n, secs)
        files.append(fn)
        manifest.append({"id": tile_id[id(t)], "file": f"t/{tile_id[id(t)]}.tld", "nodes": n,
                         "root_gid": t.data["gid"], "root_name": representative(t), "bytes": size})
    sk_rows = tile_members(root)
    for i, (nd, stub) in enumerate(sk_rows):
        if not stub:
            where[id(nd)] = (-1, i)
    mock = mock_individuals(root, where)
    log["mock_individuals"] = len(mock)
    meta = {
        "format": "ToLaD tile format", "version": FORMAT_VERSION, "dataset": "mammals-v0",
        "license": "CC BY 4.0 (derived; attribute the sources listed)",
        "built": "2026-10-09",
        "units": {"t0": "Ma", "t1": "Ma (0 = alive now)", "ever": "individuals ever born",
                  "alive": "individuals alive now", "profile": "births per year"},
        "quant": {"age_steps_per_dex": AGE_STEPS_PER_DEX, "age_min_log10": AGE_MIN_LOG,
                  "log16_steps_per_dex": LOG16_STEPS_PER_DEX, "log16_min_log10": LOG16_MIN_LOG,
                  "lohi_steps_per_dex": LOHI_STEPS_PER_DEX, "profile_steps_per_dex": PROF_STEPS_PER_DEX,
                  "profile_k": PROFILE_K, "profile_range": PROFILE_RANGE},
        "grades": ["A", "B", "C", "D"],
        "date_sources": DATE_SRC_NAMES,
        "sources": [{"key": k, "label": v} for k, v in SOURCES],
        "methods": list(methods),
        "tiles": manifest,
        "total_nodes": root.data["gid_count"] if "gid_count" in root.data else sum(1 for _ in root.preorder()),
        "mock_individuals": mock,
        "tile": -1,
    }
    from .history import KINDS
    hist_index = []
    hist_dbg = []
    for nd in root.preorder():
        rec = nd.data.get("history")
        if rec is not None:
            t, r = where[id(nd)]
            hist_index.append({"species": rec["species"], "gid": nd.data["gid"], "tile": t, "row": r})
            hist_dbg.append(hist_debug(rec, t, r, nd.data["gid"]))
    # natural baselines for the debug dump: curated species, Panthera and the showcase list
    from .model import NATURAL_SHOWCASE
    nat_dbg = []
    for nd in root.preorder():
        nat = nd.data.get("natural")
        if nat is not None and (nd.data.get("history") is not None or nd.name in NATURAL_SHOWCASE
                                or (nd.name or "").startswith("Panthera ")):
            t, r = where[id(nd)]
            nat_dbg.append({"species": nd.name, "gid": nd.data["gid"], "tile": t, "row": r, "n": nat["N"],
                            "lo": nat["lo"], "hi": nat["hi"], "km2_natural": nat["km2_nat"],
                            "km2_current": nat["km2_cur"], "method": nat["method"]})
    meta["hist_sources"] = [{"cite": c, "url": u} for (c, u) in cites]
    meta["hist_kinds"] = KINDS
    meta["hist_index"] = hist_index
    meta["natural"] = {
        "fields": NATB_FIELDS, "grade": "D", "kind": "reconstruction", "step_year": NATURAL_STEP_YEAR,
        "methods": [NATURAL_METHOD_SCALED, NATURAL_METHOD_FIT],
        "label": "natural (pre-human) baseline: individuals alive with no human impact, modelled",
        "cite": "PHYLACINE 1.2.1 present-natural ranges (Faurby et al. 2018, Ecology 99:2626; "
                "Faurby & Svenning 2015, Diversity Distrib. 21:1155); CC0",
        "url": "https://github.com/MegaPast2Future/PHYLACINE_1.2",
    }
    log["history"]["hist_sources"] = len(cites)
    secs, n = encode_rows(sk_rows, methods, tile_id, meta, cites)
    sk_size = write_container(out / "skeleton.tld", KIND_SKELETON, n, secs)
    files.append(out / "skeleton.tld")
    write_debug_json(root, sk_rows, tile_id, out / "debug_top.json", meta, hist_dbg, nat_dbg)
    sizes(files, log, sk_size, n, len(tile_roots))


def write_debug_json(root: Node, sk_rows, tile_id, path: Path, meta: dict, hist: list[dict] | None = None,
                     natural: list[dict] | None = None) -> None:
    nodes = []
    depth = {id(root): 0}
    for nd, stub in sk_rows:
        if nd.parent is not None:
            depth[id(nd)] = depth[id(nd.parent)] + 1
        D = nd.data
        nodes.append({
            "gid": D["gid"],
            "parent_gid": nd.parent.data["gid"] if nd.parent is not None else None,
            "depth": depth[id(nd)],
            "name": nd.name or "",
            "alt": [a for a in nd.alt if a],
            "representative": representative(nd),
            "children": 0 if stub else len(nd.children),
            "stub_tile": tile_id[id(nd)] if stub else None,
            "t0_Ma": nd.t0, "t1_Ma": nd.t1,
            "alive": D["alive"], "ever": D["ever"], "ghost": D.get("ghost", 0.0),
            "ever_lo": D["ever"] / 10 ** D["lo"], "ever_hi": D["ever"] * 10 ** D["hi"],
            "alive_fraction": D["alive"] / D["ever"] if D["ever"] > 0 else 0.0,
            "grade": "ABCD"[D["grade"]],
            "extinct": nd.t1 > 0,
            "topology_confidence": "taxonomic" if nd.taxonomic else "phylogenetic",
            "date_source": DATE_SRC_NAMES[nd.date_src],
            "method": D["method_key"],
            "sources": [SOURCES[b][0] for b in sorted(D["src"])],
            "profile_births_per_yr": [float(x) for x in D["profile"]],
            "ntips": D["ntips"],
            "ott": nd.ott, "pbdb": nd.pbdb,
        })
    doc = {
        "note": "Human-readable dump of the skeleton (top levels) with unquantized values. "
                "The binary files are the product; this is for debugging and the decoder round-trip test.",
        "version": FORMAT_VERSION,
        "mock_individuals": meta["mock_individuals"],
        "tiles": meta["tiles"],
        "nodes": nodes,
    }
    # one node per line keeps it diffable and small
    head = {k: v for k, v in doc.items() if k != "nodes"}
    lines = json.dumps(head, indent=1, ensure_ascii=False)[:-2]
    body = ",\n".join(json.dumps(_round(nd), ensure_ascii=False, separators=(",", ":")) for nd in nodes)
    hist_body = ",\n".join(json.dumps(_round(h), ensure_ascii=False, separators=(",", ":")) for h in (hist or []))
    nat_body = ",\n".join(json.dumps(_round(h), ensure_ascii=False, separators=(",", ":"))
                          for h in (natural or []))
    path.write_text(lines + ",\n \"history\": [\n" + hist_body + "\n],\n \"natural\": [\n" + nat_body
                    + "\n],\n \"nodes\": [\n" + body + "\n]}\n")


def _round(o):
    if isinstance(o, float):
        return float(f"{o:.7g}")
    if isinstance(o, list):
        return [_round(x) for x in o]
    if isinstance(o, dict):
        return {k: _round(v) for k, v in o.items()}
    return o


def sizes(files: list[Path], log: dict, sk_size: int, sk_nodes: int, n_tiles: int) -> None:
    import brotli
    raw = sum(f.stat().st_size for f in files)
    br = sum(len(brotli.compress(f.read_bytes(), quality=11)) for f in files)
    sk = [f for f in files if f.name == "skeleton.tld"][0]
    log["output"] = {
        "files": len(files), "tiles": n_tiles, "skeleton_nodes": sk_nodes,
        "raw_bytes": raw, "brotli_bytes": br,
        "skeleton_raw": sk_size, "skeleton_brotli": len(brotli.compress(sk.read_bytes(), quality=11)),
    }
