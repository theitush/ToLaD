"""IUCN 2026's Extinct and Possibly Extinct codes on the lost cells of the 682 (ToLaD#594).

IUCN's range maps code each polygon's presence; Possibly Extinct (4) and Extinct (5) mean the species was "known or
thought very likely to occur post 1500 AD" there and is gone (IUCN Mapping attribute codes v1.19, 2021). So a lost cell
(PHYLACINE present-natural minus current, lost_cells.py) that such a polygon covers was lost after 1500, by the year of
the assessment the map belongs to. That is what dates PHYLACINE's own 78 certainty-0 species (IUCN 2016-3 maps); here
the 2026 maps are put on the same cells for all 682.

Inputs (data/raw/redlist/search-2026-11-17/, Ita's IUCN Red List search download of 2026-11-17, unpacked):
  spatial/spatial_data.gpkg   every mammal's range polygons (presence, origin, assessment_id)
  tables/assessments.csv      the assessment of each taxon (its date)
  tables/countries.csv        presence per country ("Extinct Post-1500", "Possibly Extinct")
  tables/synonyms.csv         the Red List's synonyms of each taxon

Cells: PHYLACINE's grid (Behrmann, 360 x 142) and PHYLACINE's own rule, "a cell was considered as occupied if any part
of the cell was overlapping with the range polygon" (PHYLACINE 1.2 metadata). Polygons of native or reintroduced origin
only, as PHYLACINE's current maps; every season.

Names: the 682's PHYLACINE binomial; else the IUCN 2016-3 name PHYLACINE took its map from (Synonymy_table); else a Red
List synonym. A name other than the binomial is used only when it renames the same species (the epithet's stem the
same: a genus move, a Latin gender ending, or a patronym's genitive spelt the other way), is no other PHYLACINE
species, and is the only candidate: the rule of amniotes.name_reptiles (ToLaD#592).

Writes OUT.json: per species, the IUCN name and how it was matched, the assessment's year and category, the lost cells
the 2026 polygons code 4/5 (`coded`, flat indices) and the ones they show extant (presence 1-3, `extant`), and the
countries IUCN lists as Extinct Post-1500 or Possibly Extinct. The cells are an intermediate only: IUCN's terms forbid
redistributing the range data, so only per-species figures (build_dates.py --iucn) are committed.
Run from pipeline/: `uv run --with shapely python ../research/range-loss-dates/iucn_codes.py LOST.json OUT.json`.
"""
import csv
import io
import json
import sqlite3
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapely

sys.path.insert(0, str(Path(__file__).parent))
from hyde_fetch import NC, NR, X0, Y0, DX, DY, behrmann  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RL = ROOT / "data/raw/redlist/search-2026-11-17"
GPKG = RL / "spatial/spatial_data.gpkg"
PHY = ROOT / "data/raw/phylacine/PHYLACINE_1.2.1.zip"
CODED, EXTANT, ORIGINS = (4, 5), (1, 2, 3), (1, 2)  # presence codes; origin 1 native, 2 reintroduced


def _stem(e: str) -> str:
    """The epithet less its Latin ending: a gender ending (pipeline/tolad_pipeline/redlist._stem: -us, -um, -a) or a
    patronym's genitive (-orum, -arum, -ae, -ii, -i: Piliocolobus waldronae is the Red List's P. waldroni)."""
    for end in ("orum", "arum", "ae", "ii", "us", "um", "a", "i"):
        if e.endswith(end) and len(e) > len(end) + 2:
            return e[:-len(end)]
    return e


def key(b: str) -> tuple[str, str]:
    g, e = b.split(" ", 1)
    return g, _stem(e)


def cell_edges():
    """Each column's longitudes and each row's latitudes (degrees), of PHYLACINE's grid."""
    lon_scale = behrmann(1.0, 0.0)[0]
    lon = (X0 + np.arange(NC + 1) * DX) / lon_scale
    lat_t = np.linspace(-90, 90, 1800001)
    _, y_t = behrmann(np.zeros_like(lat_t), lat_t)
    lat = np.interp(Y0 - np.arange(NR + 1) * DY, y_t, lat_t)  # row 0 at the top
    return lon, lat


def gpkg_geom(blob: bytes):
    """A GeoPackage geometry blob (header + WKB) as a shapely geometry."""
    flags = blob[3]
    env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 7]
    return shapely.from_wkb(blob[8 + env:])


def match_names(want: list[str]) -> tuple[dict[str, tuple[str, str]], dict[str, dict]]:
    """PHYLACINE binomial -> (Red List name, how), and the Red List's assessments by name."""
    with open(RL / "tables/assessments.csv", encoding="utf-8") as f:
        ass = {r["scientificName"]: r for r in csv.DictReader(f)}
    of_syn: dict[tuple, set] = defaultdict(set)
    with open(RL / "tables/synonyms.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["genusName"] and r["speciesName"] and not r["infraType"]:
                of_syn[key(f"{r['genusName']} {r['speciesName']}")].add(r["scientificName"])
    z = zipfile.ZipFile(PHY)
    with z.open("Data/Taxonomy/Synonymy_table_valid_species_only.csv") as f:
        tab = list(csv.DictReader(io.TextIOWrapper(f, "utf-8")))
    ours = {r["Binomial.1.2"].replace("_", " ") for r in tab}
    iucn16 = {r["Binomial.1.2"].replace("_", " "): f"{r['IUCN.2016.3.Genus']} {r['IUCN.2016.3.Species']}"
              for r in tab if r["IUCN.2016.3.Genus"] not in ("", "NA")}
    out = {}
    for sp in want:
        if sp in ass:
            out[sp] = (sp, "name")
            continue
        old = iucn16.get(sp)
        c16 = {old} if old and old in ass and old not in ours and key(old)[1] == key(sp)[1] else set()
        cs = {n for n in of_syn.get(key(sp), set()) | ({n for n in of_syn.get(key(old), set())} if old else set())
              if n in ass and n not in ours and key(n)[1] == key(sp)[1]}
        c = c16 or cs
        if len(c) == 1:
            out[sp] = (c.pop(), "PHYLACINE's IUCN 2016-3 name" if c16 else "Red List synonym")
    taken = defaultdict(list)
    for sp, (n, _) in out.items():
        taken[n].append(sp)
    for n, sps in taken.items():
        if len(sps) > 1:  # a Red List species two of ours are: a lump, no match
            for sp in sps:
                del out[sp]
    return out, ass


def main(lost_json, out_json):
    d = json.load(open(lost_json))
    sp_all = sorted(d["species"])
    names, ass = match_names(sp_all)
    lon_e, lat_e = cell_edges()
    con = sqlite3.connect(f"file:{GPKG}?mode=ro", uri=True)
    rows = defaultdict(list)  # Red List name -> [(fid, presence, origin)]
    want = {n for n, _ in names.values()}
    for fid, nm, pres, orig in con.execute("select fid, sci_name, presence, origin from exported"):
        if nm in want:
            rows[nm].append((fid, pres, orig))
    countries = defaultdict(lambda: defaultdict(list))
    with open(RL / "tables/countries.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["presence"] in ("Extinct Post-1500", "Possibly Extinct") and r["scientificName"] in want:
                countries[r["scientificName"]][r["presence"]].append(r["name"])
    res = {}
    for sp in sp_all:
        lost = np.array(d["species"][sp]["lost"])
        rec = {"lost": len(lost)}
        if sp not in names:
            res[sp] = {**rec, "name": "", "how": "no match"}
            continue
        n, how = names[sp]
        a = ass[n]
        rec.update(name=n, how=how, assessed=int(a["assessmentDate"][:4]), published=int(a["yearPublished"]),
                   category=a["redlistCategory"], polygons=len(rows[n]),
                   ex_countries=sorted(set(countries[n]["Extinct Post-1500"])),
                   pe_countries=sorted(set(countries[n]["Possibly Extinct"])))
        r, c = lost // NC, lost % NC
        boxes = shapely.box(lon_e[c], lat_e[r + 1], lon_e[c + 1], lat_e[r])
        for kind, codes in (("coded", CODED), ("extant", EXTANT)):
            fids = [fid for fid, p, o in rows[n] if p in codes and o in ORIGINS]
            hit = np.zeros(len(lost), bool)
            for fid in fids:
                (blob,) = con.execute("select geom from exported where fid = ?", (fid,)).fetchone()
                g = gpkg_geom(blob)
                if g is None or g.is_empty:
                    continue
                x0, y0, x1, y1 = g.bounds
                near = ~hit & (lon_e[c + 1] >= x0) & (lon_e[c] <= x1) & (lat_e[r] >= y0) & (lat_e[r + 1] <= y1)
                if near.any():
                    shapely.prepare(g)
                    hit[near] |= shapely.intersects(g, boxes[near])
            rec[f"{kind}_polygons"] = len(fids)
            rec[kind] = lost[hit].tolist()
        res[sp] = rec
        print(f"{sp}: {how} {n}, {len(rec['coded'])}/{len(lost)} coded, {len(rec['extant'])} extant", flush=True)
    json.dump(res, open(out_json, "w"))
    m = [r for r in res.values() if r["how"] != "no match"]
    print(len(res), "species;", len(m), "matched;", sum(bool(r["coded"]) for r in m), "with coded lost cells")


if __name__ == "__main__":
    main(*sys.argv[1:3])
