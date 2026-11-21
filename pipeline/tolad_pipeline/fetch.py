"""Download the pinned raw inputs into data/raw/<source>/.

Every source is listed in SOURCES below with a pinned URL (a commit SHA, a
release path or a frozen API query). The first successful download records
its sha256 in pipeline/sources.lock.json; later runs verify against it.

Downloads are treated as untrusted data: they are only ever read by the
parsers in this package, never executed. Each source gets its own directory.

Usage:
    uv run tolad-fetch [--set mammals|amniotes] [--raw DIR] [--lock FILE] [--refresh] [--only NAME ...]

`--set amniotes` (`make fetch-amniotes`) fetches the amniote sources (ToLaD#535) and cuts OTT's Amniota;
the default set is the mammal build's, unchanged.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import struct
import sys
import tarfile
import urllib.error
import urllib.request
import zlib
from pathlib import Path

UPHAM_SHA = "740b70189c77fc168be17bd6ade204c755bcb19b"
PHYLACINE_SHA = "2fb87f0b994ee82daa6691931f15971535322a2e"
ALVAREZ_SHA = "4c564448c0a99f84aa78f34f05dc24b926cdcbf6"
UPHAM = f"https://raw.githubusercontent.com/n8upham/MamPhy_v1/{UPHAM_SHA}/_DATA"
ALVAREZ = (f"https://raw.githubusercontent.com/sabifo4/mammals_dating/{ALVAREZ_SHA}"
           "/02_SeqBayes_S2/03_Generate_final_mammal_tree")
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
    # Alvarez-Carretero et al. 2022, Nature 602:263 (4,705-taxon mammal timetree, MCMCtree, ages in
    # units of 100 Myr, 95% CIs in [&95%={lo, hi}] comments). The file is byte-identical to
    # timetrees/01_step2/4705sp_mammal-time.tree in the authors' CC BY 4.0 figshare deposit
    # (doi:10.6084/m9.figshare.14885691, a 465 MB zip); the commit-pinned GitHub copy is the small one.
    # The recommended age source for the dated tree (research/dated-tree-sources.md, ToLaD#145).
    "alvarez": [
        ("alvarez/4705sp_mammal-time.tree", f"{ALVAREZ}/4705sp.tree", None),
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
    # The IUCN Red List of Threatened Species, version 2026-1, as GBIF's Darwin Core checklist
    # (doi:10.15468/0qnb58, CC BY 4.0). The versioned file is fixed (iucn-latest.zip moves).
    # Read in place with zipfile: the mammal rows' category, assessment citation and ids (ToLaD#48).
    "redlist": [
        ("redlist/iucn-2026-1.zip", "https://hosted-datasets.gbif.org/datasets/iucn/iucn-2026-1.zip", None),
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
    # Zoonomia: Wilder et al. 2023, Science 380:eabn5856 (CC BY 4.0, PMC10184782), Table S1:
    # genome-wide heterozygosity for 209 placental mammals. Europe PMC serves the supplement only
    # as a zip it rebuilds per request (fresh timestamps, so new bytes every time); we keep the one
    # member we read, under a fixed name, and pin that member's checksum (see ZIP_MEMBERS).
    "zoonomia": [
        ("zoonomia/Wilder2023_Table_S1.xlsx",
         "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10184782/supplementaryFiles", None),
    ],
    # Bergman et al. 2023, Nat Commun 14:7679 (CC BY 4.0, PMC10667484): PSMC Ne histories of 139
    # extant megafauna. Supplementary Data 1 (per-sample generation time and mutation rate) and
    # Supplementary Data 3 (each sample's PSMC steps, in years and Ne, in that scaling). Layer 3 of
    # the estimate stack, the bulk genomic deep past (ToLaD#64, genomic.py).
    "bergman": [
        ("bergman/Bergman2023_SupplementaryData1.csv",
         "https://static-content.springer.com/esm/art%3A10.1038%2Fs41467-023-43426-5/MediaObjects/"
         "41467_2023_43426_MOESM4_ESM.csv", None),
        ("bergman/Bergman2023_SupplementaryData3.txt",
         "https://static-content.springer.com/esm/art%3A10.1038%2Fs41467-023-43426-5/MediaObjects/"
         "41467_2023_43426_MOESM6_ESM.txt", None),
    ],
    # Bergeron et al. 2023, Nature 615:285-291 (CC BY 4.0, PMC9995274): pedigree (trio) germline
    # mutation rates of 68 vertebrates. Supplementary Tables 1-9; Table 9 has each species' rate per
    # generation modelled at its generation time, and per year. The per-lineage mutation rate of the
    # genetic layers 2 and 3 (ToLaD#74, #75, mutation.py).
    "bergeron": [
        ("bergeron/Bergeron2023_SupplementaryTables.xlsx",
         "https://static-content.springer.com/esm/art%3A10.1038%2Fs41586-023-05752-y/MediaObjects/"
         "41586_2023_5752_MOESM5_ESM.xlsx", None),
    ],
    # Mammal Diversity Database v2.5 (MDD, ASM; Zenodo doi:10.5281/zenodo.21654811, 2026-07-28,
    # CC BY 4.0): the current list of 6,904 mammal species (living and recently extinct) with
    # authority, English name, genus/family/order, extinct and domestic flags and IUCN status.
    # Source of the living species our 2017-era backbone lacks (ToLaD#278, mdd.py). Read as CSV.
    "mdd": [
        ("mdd/MDD_v2.5_6904species.csv",
         "https://zenodo.org/api/records/21654811/files/MDD_v2.5_6904species.csv/content", None),
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

# The amniote sources (ToLaD#519 research/amniote-sources.md, step 1 of its build order; ToLaD#535).
# Fetched only by `tolad-fetch --set amniotes` (`make fetch-amniotes`), into data/raw/amniotes/<source>/;
# plain `tolad-fetch` and the mammal build never read them. Credits: SOURCES.md, "Amniote inputs".
AVESDATA_SHA = "4af84f14f8f3df26bd4480202689b08ea0fc2c48"
TITLE_SHA = "cff10111854513d2405144e40bee95476e84a8b7"
CALFFACE_SHA = "693779ca6d12dd197edbf5109884cbef8fcd0b2e"
TETRADENSITY_SHA = "cfa9c059009ca5433d863b1a74d67bd1db1c047d"
AVESDATA = f"https://raw.githubusercontent.com/McTavishLab/AvesData/{AVESDATA_SHA}"
AMNIOTA_OTT = "ott229560"
ZENODO = "https://zenodo.org/api/records"


def _pbdb(base: str, rank: str) -> str:
    return (PBDB_BASE + f"?base_name={base}&rank={rank}&taxon_status=accepted"
            "&pres=regular&show=app,parent,class&vocab=pbdb")


AMNIOTES: dict[str, list[tuple[str, str, dict | None]]] = {
    # The OTT Amniota cut (ott_amniota.py) is made from the pinned OTT 3.7.3, so the set needs it.
    "ott": SOURCES["ott"],
    # The Open Tree synthesis Amniota subtree, the query mammalia_subtree.json makes; about.json pins the
    # synthesis version for both.
    "opentree": [
        ("amniotes/opentree/amniota_subtree.json",
         "https://api.opentreeoflife.org/v3/tree_of_life/subtree",
         {"node_id": AMNIOTA_OTT, "format": "newick", "label_format": "name_and_id", "height_limit": -1}),
        SOURCES["opentree"][1],
    ],
    # AvesData 1.7 (McTavish et al. 2025), Clements 2025 taxonomy: the summary-dated MCC tree, the per-tip
    # count of input studies (placed by data or by taxonomy), and the Clements 2025 -> OTT crosswalk.
    "avesdata": [
        ("amniotes/avesdata/summary_dated_clements.nex",
         f"{AVESDATA}/Tree_versions/Aves_1.7/Clements2025/summary_dated_clements.nex", None),
        ("amniotes/avesdata/studies_per_tip.txt",
         f"{AVESDATA}/Tree_versions/Aves_1.7/Clements2025/studies_per_tip.txt", None),
        ("amniotes/avesdata/OTT_crosswalk_2025.csv",
         f"{AVESDATA}/Taxonomy_versions/Clements2025/OTT_crosswalk_2025.csv", None),
    ],
    # The IOC World Bird List 15.2 and its row-by-row cross-reference to Clements, AviList and BirdLife.
    "ioc": [
        ("amniotes/ioc/IOC_Names_File_Plus-15.2.xlsx",
         "https://www.worldbirdnames.org/IOC_Names_File_Plus-15.2.xlsx", None),
        ("amniotes/ioc/IOC_15.2_vs_other_lists.xlsx",
         "https://www.worldbirdnames.org/IOC_15.2_vs_other_lists.xlsx", None),
    ],
    # The Reptile Database checklist of 1 Oct 2026 (a versioned file name).
    "reptiledb": [
        ("amniotes/reptiledb/reptile_checklist_2026_10.xlsx",
         "https://www.reptile-database.org/data/reptile_checklist_2026_10.xlsx", None),
    ],
    # Title et al. 2024, Science: the time-calibrated (ultrametric, constrained) squamate tree, commit pinned.
    "title2024": [
        ("amniotes/title2024/squamates_Title_Science2024_ultrametric_constrained.tre",
         f"https://raw.githubusercontent.com/macroevolution/squamata/{TITLE_SHA}/data/1.tree_inference/"
         "mainTrees/squamates_Title_Science2024_ultrametric_constrained.tre", None),
    ],
    # Tonini et al. 2016: one posterior draw (the first tree) of the 1.9 GB vertlife zip (RANGE_CUTS).
    "tonini2016": [
        ("amniotes/tonini2016/tonini2016_posterior_9755_tree1.tre",
         "https://data.vertlife.org/squamatetree/squam_shl_new_Posterior_9755.1000-10000.trees.zip", None),
    ],
    # Colston et al. 2020 (Zenodo 4986456, CC0): one named draw (the first tree) of the 156 MB
    # 10,000-tree PASTIS posterior for turtles, crocodilians and tuatara (RANGE_CUTS).
    "colston2020": [
        ("amniotes/colston2020/colston2020_pastis_tree1.tre",
         f"{ZENODO}/4986456/files/archosauromorpha_PASTIS_386_10000.trees/content", None),
    ],
    # Lloyd's synapsid metatree (ProjectCalfFace, GPL-3.0): the first of its 1,000 most-parsimonious
    # trees (35 MB, RANGE_CUTS), commit pinned.
    "calfface": [
        ("amniotes/calfface_synapsid_metatree/mpt1.tre",
         f"https://raw.githubusercontent.com/graemetlloyd/ProjectCalfFace/{CALFFACE_SHA}/Trees/MPTs.tre", None),
    ],
    # The PBDB Amniota species and genera: the mammals' query with base_name=Amniota. And every Amniota taxon above
    # the genus, with its parent: PBDB's own classification, the path a fossil grafts through (fossils.py, ToLaD#539).
    "pbdb": [
        ("amniotes/pbdb/amniota_species.json", _pbdb("Amniota", "species"), None),
        ("amniotes/pbdb/amniota_genera.json", _pbdb("Amniota", "genus"), None),
        ("amniotes/pbdb/amniota_higher.json", _pbdb("Amniota", "above_genus"), None),
    ],
    # Callaghan et al. 2021 (Zenodo 4723365 v1): the per-species abundance estimates, one member of Tables.zip.
    "callaghan2021": [
        ("amniotes/callaghan2021/all_species_summary_table.csv", f"{ZENODO}/4723365/files/Tables.zip/content",
         None),
    ],
    # AVONET (Tobias et al. 2022; figshare 16586228 v7): Supplementary dataset 1 (the trait sheets).
    "avonet": [
        ("amniotes/avonet/AVONET_Supplementary_dataset_1.xlsx", "https://ndownloader.figshare.com/files/34480856",
         None),
    ],
    # ReptTraits 1.2 (Oskyrko et al. 2024; figshare 24572683 v4).
    "repttraits": [
        ("amniotes/repttraits/ReptTraits_v1-2.xlsx", "https://ndownloader.figshare.com/files/45408133", None),
    ],
    # TetraDENSITY 2.5 (Zampetti et al.), commit pinned in its GitHub repo.
    "tetradensity": [
        ("amniotes/tetradensity/TetraDENSITY_v2.5_Database.csv",
         f"https://raw.githubusercontent.com/andrewzamp/TetraDENSITY/{TETRADENSITY_SHA}/data/"
         "TetraDENSITY_v2.5_Database.csv", None),
    ],
    # GARD 1.7 (Zenodo 6499637, CC0): the reptiles' range shapes (the 855 MB .shp: ~30 min from Zenodo, so a fresh
    # copy is better fetched with SOURCES.md's resumable curl line first; the reptile globe, ToLaD#601), their attribute
    # table, index and projection.
    "gard17": [
        (f"amniotes/gard17/Gard_1_7_ranges.{ext}", f"{ZENODO}/6499637/files/Gard_1_7_ranges.{ext}/content", None)
        for ext in ("shp", "dbf", "shx", "prj", "cpg")
    ],
}

SETS = {"mammals": SOURCES, "amniotes": AMNIOTES}

# Only these members are extracted from the OTT tarball (no paths from the
# archive are trusted: we write to fixed names).
OTT_MEMBERS = {"taxonomy.tsv", "synonyms.tsv", "version.txt"}


# Sources served inside a zip whose own bytes are not stable: rel path -> the member to keep.
# Only that member is read (its name is fixed here, never taken from the archive), and the
# lock pins the member's bytes.
ZIP_MEMBERS = {"zoonomia/Wilder2023_Table_S1.xlsx": "NIHMS1893031-supplement-Table_S1.xlsx",
               # Callaghan's Tables.zip: only the per-species table is kept.
               "amniotes/callaghan2021/all_species_summary_table.csv": "Tables/all_species_summary_table.csv"}

# Sources that are one piece of a large remote file, read with HTTP range requests only (the file itself is
# never downloaded): rel path -> how. The lock pins the kept bytes.
#   ("first_line",): the file's first line (through its newline)
#   ("zip_first_line", member): the first line of one member of a remote zip
RANGE_CUTS = {
    "amniotes/tonini2016/tonini2016_posterior_9755_tree1.tre":
        ("zip_first_line", "squam_shl_new_Posterior_9755.1000.trees"),
    "amniotes/colston2020/colston2020_pastis_tree1.tre": ("first_line",),
    "amniotes/calfface_synapsid_metatree/mpt1.tre": ("first_line",),
}


PBDB_TIMER = re.compile(rb'^\{\s*"elapsed_time"\s*:\s*[0-9.eE+-]+\s*,')


def normalize(rel: str, dest: Path) -> None:
    """Strip volatile bytes so the pinned checksum covers content only.

    PBDB JSON responses start with `"elapsed_time":<server seconds>`, which
    changes on every request (same records, different bytes). We rewrite it to
    0 before hashing. The records themselves are untouched."""
    if "/pbdb/" not in "/" + rel:
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


USER_AGENT = "Mozilla/5.0 (compatible; ToLaD-pipeline/0.1; +https://github.com/theitush/ToLaD)"


def download(url: str, body: dict | None, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = None
    headers = {"User-Agent": USER_AGENT}
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


def extract_member(zpath: Path, member: str, dest: Path) -> None:
    """Copy one named member out of a zip to dest (the archive's paths are never used)."""
    import zipfile
    tmp = dest.with_suffix(dest.suffix + ".part")
    with zipfile.ZipFile(zpath) as zf, zf.open(member) as f, tmp.open("wb") as out:
        while True:
            chunk = f.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    os.replace(tmp, dest)


RANGE_CHUNK = 1 << 20


def http_range(url: str, first: int, last: int | None = None) -> bytes:
    """Bytes first..last (inclusive) of url by an HTTP range request; first < 0 asks for the last -first bytes.
    A server that ignores the range (HTTP 200) is an error, never a whole-file download. Three tries: the
    vertlife server sometimes stalls a request."""
    spec = str(first) if first < 0 else f"{first}-{'' if last is None else last}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={spec}"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.status != 206:
                    raise OSError(f"{url}: no range support (HTTP {r.status})")
                return r.read()
        except (TimeoutError, urllib.error.URLError) as e:
            if attempt == 2:
                raise
            print(f"[retry] {url} bytes={spec}: {e}", file=sys.stderr)
    raise AssertionError


def first_line(chunks) -> bytes:
    """The first line (through its newline) of a stream of byte chunks; an error if it never ends."""
    got = b""
    for c in chunks:
        got += c
        i = got.find(b"\n")
        if i >= 0:
            return got[:i + 1]
    raise ValueError("no newline: the first line runs past the end")


def remote_file_chunks(url: str):
    pos = 0
    while True:
        c = http_range(url, pos, pos + RANGE_CHUNK - 1)
        yield c
        if len(c) < RANGE_CHUNK:
            return
        pos += len(c)


def remote_zip_member(url: str, member: str) -> tuple[int, int, int]:
    """(method, compressed size, local header offset) of one member of a remote zip, from its central
    directory, read from the tail with range requests (a suffix range with no HEAD first). Zip64 aware."""
    tail = http_range(url, -65536)
    i = tail.rfind(b"PK\x05\x06")
    if i < 0:
        raise ValueError(f"{url}: no zip end record in the last 64 KB")
    cd_size, cd_off = struct.unpack("<II", tail[i + 12:i + 20])
    end = i
    if cd_off == 0xFFFFFFFF:
        end = tail.rfind(b"PK\x06\x06")
        cd_size, cd_off = struct.unpack("<QQ", tail[end + 40:end + 56])
    cd = tail[end - cd_size:end] if end >= cd_size else http_range(url, cd_off, cd_off + cd_size - 1)
    p = 0
    while cd[p:p + 4] == b"PK\x01\x02":
        meth, = struct.unpack("<H", cd[p + 10:p + 12])
        csz, usz = struct.unpack("<II", cd[p + 20:p + 28])
        fl, el, cl = struct.unpack("<HHH", cd[p + 28:p + 34])
        off, = struct.unpack("<I", cd[p + 42:p + 46])
        name = cd[p + 46:p + 46 + fl].decode("utf-8", "replace")
        extra = cd[p + 46 + fl:p + 46 + fl + el]
        q = 0
        while q + 4 <= len(extra):  # the zip64 extra field, in its fixed order
            hid, hl = struct.unpack("<HH", extra[q:q + 4])
            if hid == 1:
                vals = list(struct.unpack("<" + "Q" * (hl // 8), extra[q + 4:q + 4 + hl]))
                if usz == 0xFFFFFFFF:
                    usz = vals.pop(0)
                if csz == 0xFFFFFFFF:
                    csz = vals.pop(0)
                if off == 0xFFFFFFFF:
                    off = vals.pop(0)
            q += 4 + hl
        if name == member:
            return meth, csz, off
        p += 46 + fl + el + cl
    raise KeyError(f"{url}: no member {member}")


def remote_zip_member_chunks(url: str, member: str):
    """The decompressed bytes of one member of a remote zip, chunk by chunk, read by range requests."""
    meth, csz, off = remote_zip_member(url, member)
    if meth not in (0, 8):
        raise ValueError(f"{url}: {member} uses zip method {meth}")
    lh = http_range(url, off, off + 29)
    fl, el = struct.unpack("<HH", lh[26:30])
    start = off + 30 + fl + el
    d = zlib.decompressobj(-15) if meth == 8 else None
    pos = start
    while pos < start + csz:
        c = http_range(url, pos, min(pos + RANGE_CHUNK, start + csz) - 1)
        pos += len(c)
        yield d.decompress(c) if d else c


def range_cut(url: str, spec: tuple, dest: Path) -> None:
    """Write the piece of url that RANGE_CUTS names to dest."""
    if spec[0] == "first_line":
        b = first_line(remote_file_chunks(url))
    elif spec[0] == "zip_first_line":
        b = first_line(remote_zip_member_chunks(url, spec[1]))
    else:
        raise ValueError(spec)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(b)
    os.replace(tmp, dest)


def check_lock(lock: dict, rel: str, dest: Path, record: dict, fresh: bool, refresh: bool) -> int:
    """Pin dest's sha256 in the lock if it has none (or on --refresh of a fresh copy), else verify it.
    Returns 1 on a mismatch."""
    digest = sha256(dest)
    rec = lock.get(rel)
    if rec is None or (refresh and fresh):
        lock[rel] = {**record, "sha256": digest, "bytes": dest.stat().st_size,
                     "retrieved": _dt.date.today().isoformat()}
        print(f"[lock] {rel} {digest[:16]}", file=sys.stderr)
    elif rec["sha256"] != digest:
        print(f"[MISMATCH] {rel}: expected {rec['sha256'][:16]} got {digest[:16]}"
              " (upstream changed? use --refresh to accept)", file=sys.stderr)
        return 1
    return 0


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
    ap.add_argument("--set", choices=sorted(SETS), default="mammals",
                    help="which sources: the mammal build's (default) or the amniotes' (ToLaD#535)")
    a = ap.parse_args(argv)

    lock = json.loads(a.lock.read_text()) if a.lock.exists() else {}
    failures = 0
    for name, items in SETS[a.set].items():
        if a.only and name not in a.only:
            continue
        for rel, url, body in items:
            dest = a.raw / rel
            record = {"url": url, "post_body": body}
            if rel in RANGE_CUTS:
                record["cut"] = list(RANGE_CUTS[rel])
            if a.refresh or not dest.exists():
                print(f"[fetch] {name}: {url}", file=sys.stderr)
                if rel in ZIP_MEMBERS:
                    zdest = dest.with_name(dest.name + ".download.zip")
                    download(url, body, zdest)
                    extract_member(zdest, ZIP_MEMBERS[rel], dest)
                    zdest.unlink()
                elif rel in RANGE_CUTS:
                    range_cut(url, RANGE_CUTS[rel], dest)
                else:
                    download(url, body, dest)
                fresh = True
            else:
                fresh = False
            normalize(rel, dest)
            failures += check_lock(lock, rel, dest, record, fresh, a.refresh)
            if rel.endswith("ott3.7.3.tgz") and not (a.raw / "ott" / "taxonomy.tsv").exists():
                print("[fetch] extracting OTT taxonomy.tsv", file=sys.stderr)
                extract_ott(dest, a.raw / "ott")
    if a.set == "amniotes" and (not a.only or "ott" in a.only):
        # The OTT Amniota cut: made from the pinned OTT when missing, then pinned and verified like a download.
        from tolad_pipeline import ott_amniota
        fresh = a.refresh or not all((a.raw / rel).exists() for rel in ott_amniota.OUTPUTS)
        if fresh:
            print("[cut] OTT Amniota (ott_amniota.py)", file=sys.stderr)
            ott_amniota.cut(a.raw)
        for rel in ott_amniota.OUTPUTS:
            failures += check_lock(lock, rel, a.raw / rel, {"derived_from": "ott/ott3.7.3.tgz",
                                                           "script": "pipeline/tolad_pipeline/ott_amniota.py"},
                                   fresh, a.refresh)
    a.lock.write_text(json.dumps(lock, indent=1, sort_keys=True) + "\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
