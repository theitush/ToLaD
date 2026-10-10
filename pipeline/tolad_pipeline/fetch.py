"""Download the pinned raw inputs into data/raw/<source>/.

Every source is listed in SOURCES below with a pinned URL (a commit SHA, a
release path or a frozen API query). The first successful download records
its sha256 in pipeline/sources.lock.json; later runs verify against it.

Downloads are treated as untrusted data: they are only ever read by the
parsers in this package, never executed. Each source gets its own directory.

Usage:
    uv run tolad-fetch [--raw DIR] [--lock FILE] [--refresh] [--only NAME ...]
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

UPHAM_SHA = "740b70189c77fc168be17bd6ade204c755bcb19b"
PHYLACINE_SHA = "2fb87f0b994ee82daa6691931f15971535322a2e"
UPHAM = f"https://raw.githubusercontent.com/n8upham/MamPhy_v1/{UPHAM_SHA}/_DATA"
PHYLACINE = f"https://raw.githubusercontent.com/MegaPast2Future/PHYLACINE_1.2/{PHYLACINE_SHA}"

PBDB_BASE = "https://paleobiodb.org/data1.2/taxa/list.json"

# name -> list of (relative path in data/raw, url, POST body or None)
SOURCES: dict[str, list[tuple[str, str, dict | None]]] = {
    "opentree": [
        (
            "opentree/mammalia_subtree.json",
            "https://api.opentreeoflife.org/v3/tree_of_life/subtree",
            {"node_id": "ott244265", "format": "newick", "label_format": "name_and_id", "height_limit": -1},
        ),
        (
            "opentree/about.json",
            "https://api.opentreeoflife.org/v3/tree_of_life/about",
            {},
        ),
    ],
    "ott": [
        ("ott/ott3.7.3.tgz", "https://files.opentreeoflife.org/ott/ott3.7.3/ott3.7.3.tgz", None),
    ],
    "upham": [
        (
            "upham/MamPhy_fullPosterior_BDvr_Completed_5911sp_topoCons_NDexp_MCC_v2_target.tre",
            f"{UPHAM}/MamPhy_fullPosterior_BDvr_Completed_5911sp_topoCons_NDexp_MCC_v2_target.tre",
            None,
        ),
        (
            "upham/taxonomy_mamPhy_5911species_toPublish.csv",
            f"{UPHAM}/taxonomy_mamPhy_5911species_toPublish.csv",
            None,
        ),
    ],
    "phylacine": [
        ("phylacine/Trait_data.csv", f"{PHYLACINE}/Data/Traits/Trait_data.csv", None),
        ("phylacine/Synonymy_table_valid_species_only.csv",
         f"{PHYLACINE}/Data/Taxonomy/Synonymy_table_valid_species_only.csv", None),
        # The v1.2.1 release asset (an uploaded file, so its bytes are fixed).
        # Its Data/Ranges tree is identical (git tree 7555039) to the one at
        # PHYLACINE_SHA. Read in place with zipfile; never extracted.
        ("phylacine/PHYLACINE_1.2.1.zip",
         "https://github.com/MegaPast2Future/PHYLACINE_1.2/releases/download/v1.2.1/PHYLACINE_1.2.1.zip", None),
    ],
    "pantheria": [
        (
            "pantheria/PanTHERIA_1-0_WR05_Aug2008.txt",
            "https://esapubs.org/archive/ecol/E090/184/PanTHERIA_1-0_WR05_Aug2008.txt",
            None,
        ),
    ],
    # COMBINE (Soria et al. 2021, Ecology 102:e03344), figshare v4, CC BY 4.0.
    # Carries Pacifici et al. 2013 generation lengths (Dryad itself blocks
    # scripted downloads), plus longevity, mass and density.
    "combine": [
        ("combine/trait_data_reported.csv", "https://ndownloader.figshare.com/files/27703263", None),
        ("combine/trait_data_imputed.csv", "https://ndownloader.figshare.com/files/27703266", None),
    ],
    # Count anchors (see pipeline/tolad_pipeline/anchors.py)
    "faostat": [
        ("faostat/Production_Crops_Livestock_E_All_Data_(Normalized).zip",
         "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip", None),
    ],
    "wpp": [
        ("wpp/WPP2024_Demographic_Indicators_Medium.csv.gz",
         "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/"
         "WPP2024_Demographic_Indicators_Medium.csv.gz", None),
    ],
    # Greenspoon et al. 2023 PNAS data + code release, Zenodo v1.0 (CC BY 4.0).
    # Per-species census anchors (IUCN Red List population reports) and the
    # pet numbers. The zip is only opened with zipfile and read as CSV.
    "greenspoon": [
        ("greenspoon/mammal_biomass-master.zip",
         "https://zenodo.org/api/records/7594807/files/mammal_biomass-master.zip/content", None),
    ],
    "prb": [
        ("prb/how-many-people-have-ever-lived-on-earth.html",
         "https://www.prb.org/articles/how-many-people-have-ever-lived-on-earth/", None),
    ],
    "pbdb": [
        (
            "pbdb/mammalia_species.json",
            PBDB_BASE + "?base_name=Mammalia&rank=species&taxon_status=accepted"
            "&pres=regular&show=app,parent,class&vocab=pbdb",
            None,
        ),
        (
            "pbdb/mammalia_genera.json",
            PBDB_BASE + "?base_name=Mammalia&rank=genus&taxon_status=accepted"
            "&pres=regular&show=app,parent,class&vocab=pbdb",
            None,
        ),
    ],
}

# Only these members are extracted from the OTT tarball (no paths from the
# archive are trusted: we write to fixed names).
OTT_MEMBERS = {"taxonomy.tsv", "synonyms.tsv", "version.txt"}


PBDB_TIMER = re.compile(rb'^\{\s*"elapsed_time"\s*:\s*[0-9.eE+-]+\s*,')


def normalize(rel: str, dest: Path) -> None:
    """Strip volatile bytes so the pinned checksum covers content only.

    PBDB JSON responses start with `"elapsed_time":<server seconds>`, which
    changes on every request (same records, different bytes). We rewrite it to
    0 before hashing. The records themselves are untouched."""
    if not rel.startswith("pbdb/"):
        return
    b = dest.read_bytes()
    nb = PBDB_TIMER.sub(b'{\n"elapsed_time":0,', b, count=1)
    if nb != b:
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(nb)
        os.replace(tmp, dest)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, body: dict | None, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = None
    headers = {"User-Agent": "Mozilla/5.0 (compatible; ToLaD-pipeline/0.1; +https://github.com/theitush/ToLaD)"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(req, timeout=900) as r, tmp.open("wb") as out:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    os.replace(tmp, dest)


def extract_ott(tgz: Path, outdir: Path) -> None:
    """Pull taxonomy.tsv etc. out of the OTT tarball, Mammalia rows only."""
    outdir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tgz, "r:gz") as tf:
        for m in tf:
            base = m.name.rsplit("/", 1)[-1]
            if base in OTT_MEMBERS and m.isfile():
                f = tf.extractfile(m)
                assert f is not None
                with (outdir / base).open("wb") as out:
                    while True:
                        chunk = f.read(1 << 20)
                        if not chunk:
                            break
                        out.write(chunk)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    root = Path(__file__).resolve().parents[2]
    ap.add_argument("--raw", type=Path, default=root / "data" / "raw")
    ap.add_argument("--lock", type=Path, default=root / "pipeline" / "sources.lock.json")
    ap.add_argument("--refresh", action="store_true", help="re-download even if present; update lock")
    ap.add_argument("--only", nargs="*", default=None)
    a = ap.parse_args(argv)

    lock = json.loads(a.lock.read_text()) if a.lock.exists() else {}
    failures = 0
    for name, items in SOURCES.items():
        if a.only and name not in a.only:
            continue
        for rel, url, body in items:
            dest = a.raw / rel
            if a.refresh or not dest.exists():
                print(f"[fetch] {name}: {url}", file=sys.stderr)
                download(url, body, dest)
                fresh = True
            else:
                fresh = False
            normalize(rel, dest)
            digest = sha256(dest)
            rec = lock.get(rel)
            if rec is None or (a.refresh and fresh):
                lock[rel] = {
                    "url": url,
                    "post_body": body,
                    "sha256": digest,
                    "bytes": dest.stat().st_size,
                    "retrieved": _dt.date.today().isoformat(),
                }
                print(f"[lock] {rel} {digest[:16]}", file=sys.stderr)
            elif rec["sha256"] != digest:
                print(f"[MISMATCH] {rel}: expected {rec['sha256'][:16]} got {digest[:16]}"
                      " (upstream changed? use --refresh to accept)", file=sys.stderr)
                failures += 1
            if rel.endswith("ott3.7.3.tgz") and not (a.raw / "ott" / "taxonomy.tsv").exists():
                print("[fetch] extracting OTT taxonomy.tsv", file=sys.stderr)
                extract_ott(dest, a.raw / "ott")
    a.lock.write_text(json.dumps(lock, indent=1, sort_keys=True) + "\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
