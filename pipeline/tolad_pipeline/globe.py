"""Every species' range cells for the card's globe (ToLaD#267): `data/mammals/ranges.json`.

Its own step over the built data, like `make wiki` (`make globe`): reads the species rows of the
dated tree (wiki.species_rows), matches each to a PHYLACINE 1.2.1 range raster (ranges.py) by its
name, then PHYLACINE's synonymy table, then its Open Tree synonyms (the order model.resolve_traits
uses), and writes the matched species' current and present-natural cells. Nothing else under
data/mammals is touched.

A species PHYLACINE lacks under all its names (most were split or described after its 2019 taxonomy)
borrows the range of the older species it was split from (ToLaD#486): MDD's CMW name, then its MSW3
name, then the one species its notes say it was split from, then the one whose notes say it "previously
included" it (older_names), found by the same chain. A borrowed range must come within NEAR cells of the
species' type locality where MDD gives one; else the species stays without a range. An older name no
other current species shares and no note calls a split is the species' own former name (a genus move):
an exact match.

The grid is PHYLACINE's: 360 x 142 cells, Behrmann cylindrical equal-area (standard parallels
30 deg), row 0 at the north. Columns are 1 deg of longitude from -180; a row's edges are at
latitude asin(y / Y_POLE) (the sphere's equal-area formula on the ellipsoid's y, so authalic
latitude: within 0.13 deg of geodetic, ~1/7 of a cell). The file carries those edges (`lat`).

Packing, per species and kind: the raster's range cells as flat indices (row * 360 + col),
run-length coded as [gap, length, gap, length, ...], each gap counted from the end of the run
before (from 0 for the first). `ranges[name] = [current, present_natural]`; an empty list is no
cells (an extinct species has only its present-natural range). A borrowed range has a third element,
the species whose range it is: `[current, present_natural, "Loxodonta africana"]`.

The globe follows the maps the count stands on (ToLaD#507). A living species whose map difference PHYLACINE's
note puts down to taxonomy or a mapping fix, and the species such a note takes land from, have as current
cells today's corrected map (ranges.today_cells, the count's): the night monkey's present-natural map without
Colombia, which the note gives to Aotus jorgehernandezi, is its current map, so nothing of the move shows as
range lost. A living species whose present-natural map is a placeholder (stand_ins) is an empty pair: no range
to draw. The lost cells the evidence dates before 1500 (lossdates.PREHISTORIC: the Tasmanian devil's mainland
Australia, the dhole's North America, ...) are not in the level the tree holds to 1500, so they are not drawn grey:
they leave the species' present-natural cells and are packed apart, `before_1500[name]`, the same run-length way.

The reptiles (ToLaD#601, `--tree amniotes`, `make globe-amniotes`) are `data/amniotes/ranges.json`: GARD 1.7's range
polygons (Roll et al. 2017; Caetano et al. 2022; CC0) on the same grid, by PHYLACINE's own rule, "a cell was considered
as occupied if any part of the cell was overlapping with the range polygon" (PHYLACINE 1.2 metadata): a cell counts when
its interior and a polygon's share some area (a polygon that only touches its edge is not in it). The cells are the
WGS 84 lon/lat boxes of the grid (the ellipsoidal Behrmann inverted: geodetic_row_edges, as ToLaD#594's iucn_codes.py),
tested polygon by polygon of each species' map (shapely). GARD maps where a reptile lives today, and no one has mapped
where it would live without people, so each is `ranges[name] = [current]`: one element, nothing to draw as lost. A
species is matched by its Reptile Database name, else an established synonym (gard_match).
"""
from __future__ import annotations

import argparse
import bisect
import csv
import json
import math
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from . import lossdates, mdd, ranges
from .load import load_phylacine, norm_name
from .wiki import living_species, species_rows, synonyms

ROWS, COLS = ranges.GRID_SHAPE
# The grid's geotransform (ModelTiepointTag / ModelPixelScaleTag, identical in every raster).
Y_TOP = 7348382.0
CELL_Y = 96514.95774647887
CELL_X = 96486.27222222222
X_LEFT = -17367529.0
# y at the pole: the grid's top edge (the rasters start at the pole).
Y_POLE = Y_TOP


def pack(mask: np.ndarray) -> list[int]:
    """A boolean raster (ROWS x COLS) -> run-length cells [gap, len, gap, len, ...] over flat indices."""
    flat = np.asarray(mask, dtype=bool).ravel()
    if not flat.any():
        return []
    d = np.diff(np.concatenate(([0], flat.astype(np.int8), [0])))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    out: list[int] = []
    prev = 0
    for s, e in zip(starts.tolist(), ends.tolist()):
        out += [s - prev, e - s]
        prev = e
    return out


def unpack(runs: list[int], n: int = ROWS * COLS) -> np.ndarray:
    """The inverse of pack: a boolean raster (ROWS x COLS)."""
    flat = np.zeros(n, dtype=bool)
    i = 0
    for k in range(0, len(runs), 2):
        i += runs[k]
        flat[i:i + runs[k + 1]] = True
        i += runs[k + 1]
    return flat.reshape(ROWS, COLS)


def row_edges() -> list[float]:
    """Latitude of each row's edges, north to south (ROWS + 1 values, degrees, 3 decimals)."""
    out = []
    for r in range(ROWS + 1):
        y = Y_TOP - r * CELL_Y
        out.append(round(math.degrees(math.asin(max(-1.0, min(1.0, y / Y_POLE)))), 3))
    return out


def load_masks(raw: Path) -> dict[str, dict[str, np.ndarray]]:
    """PHYLACINE binomial -> {"cur"|"nat": boolean raster}."""
    out: dict[str, dict[str, np.ndarray]] = {}
    with zipfile.ZipFile(raw / ranges.ZIP_REL) as z:
        for info in z.infolist():
            nm = info.filename
            if not nm.startswith(ranges.PREFIX) or not nm.endswith(".tif"):
                continue
            parts = nm[len(ranges.PREFIX):].split("/")
            if len(parts) != 2 or parts[0] not in ranges.KINDS:
                continue
            a, _ = ranges._read_tif(z.read(info))
            if a.shape != ranges.GRID_SHAPE:
                raise ValueError(f"{nm}: grid {a.shape}, expected {ranges.GRID_SHAPE}")
            sp = parts[1][:-4].replace("_", " ")
            out.setdefault(sp, {})[ranges.KINDS[parts[0]]] = a > 0.5
    return out


def resolve(cands: list[str], have: set[str], phy_syn: dict[str, str]) -> str | None:
    """The first of the names that is a PHYLACINE binomial itself or by PHYLACINE's synonymy table."""
    for c in cands:
        hit = c if c in have else phy_syn.get(c) if phy_syn.get(c) in have else None
        if hit:
            return hit
    return None


def match(names: dict[str, int], have: set[str], phy_syn: dict[str, str], ott_syn: dict[int, list[str]]) -> dict[str, str]:
    """Our species name -> the PHYLACINE binomial whose maps it gets (name, PHYLACINE synonym, OTT synonym)."""
    out: dict[str, str] = {}
    for name, ott in names.items():
        hit = resolve([name] + ott_syn.get(ott, []), have, phy_syn)
        if hit:
            out[name] = hit
    return out


# ---- the species a newer one was split from (ToLaD#486) ------------------------------------

# "split from L. africana" / "split from Loxodonta africana" / "split from phillipsii" (same genus) /
# "recently described based on populations previously attributed to E. cinereus"
_SPLIT = re.compile(r"(?i:\b(?:split from|previously attributed to)) (?:([A-Z][a-z]*\.?) )?([a-z][a-z-]+)\b")
# a second species right after the first ("split from A. b and A. c", "split from b and c"): not clean
_MORE = re.compile(r"\s*(?:,|/|&|\band\b|\bor\b)\s*[A-Z][a-z]*\.? [a-z]")
_MORE_EP = re.compile(r"\s*(?:,|/|&|\band\b|\bor\b)\s*[a-z]+\s*(?:[,;.)]|$|\band\b|\bor\b)")
# "previously included C. catellus, C. dorsalis, and ... C. rufus": the parent's own word for its splits
_INCL = re.compile(r"\b(?:previously|formerly) includ(?:ed|es)\b([^;]*)")
_BIN = re.compile(r"\b([A-Z][a-z]*\.?) ([a-z][a-z-]+)\b")
_WORD = re.compile(r"\b[A-Z][a-z]+\b")


def _expand(g: str | None, ep: str, genera: list[str]) -> list[str]:
    """A binomial as a note writes it -> candidate full names: an abbreviated (or missing) genus is each of
    `genera` with that initial (or the first, the row's own), in order."""
    if g and len(g) > 1 and not g.endswith("."):
        return [f"{g} {ep}"]
    if not g:
        return [f"{genera[0]} {ep}"]
    return [f"{x} {ep}" for x in dict.fromkeys(genera) if x.startswith(g.rstrip("."))]


def split_note(note: str, genera: list[str]) -> list[str]:
    """The species a taxonomy note says this one was split from, as candidate binomials: [] unless the note
    names exactly one ("split from L. africana", not "split from A. b and A. c")."""
    hits = list(_SPLIT.finditer(note))
    if len({h.groups() for h in hits}) != 1 or (_MORE if hits[0].group(1) else _MORE_EP).match(note, hits[0].end()):
        return []
    return _expand(hits[0].group(1), hits[0].group(2), genera)


def older_names(raw: Path) -> dict[str, list[tuple[str, bool]]]:
    """MDD species -> the older species it was split from, as (candidate name, split?) in order:
    its name in the Illustrated Checklist of the Mammals of the World (CMW, 2020: closest in time to
    PHYLACINE), its name in MSW3 (2005), the one species its taxonomy notes say it was split from (or was
    described from populations "previously attributed to"), then the one species whose notes say it
    "previously included" it. A CMW or MSW3 name may be the same species
    under a former name (a genus move, a spelling) rather than a split: split? is False for those. Names
    equal to its own are left out (they are what failed)."""
    p = raw / mdd.MDD_FILE
    if not p.exists():
        return {}
    with p.open(encoding="utf-8", newline="") as f:
        rows = [(norm_name(r["sciName"]), r) for r in csv.DictReader(f)]
    names = {n for n, _ in rows}

    def genera(name: str, r: dict, olds: list[str]) -> list[str]:
        orig = mdd._na(r["originalNameCombination"]).replace("(", "").split()
        return [name.split()[0]] + [o.split()[0] for o in olds] + orig[:1] + _WORD.findall(r["taxonomyNotes"])

    out: dict[str, list[tuple[str, bool]]] = {}
    claims: dict[str, set[str]] = {}
    for name, r in rows:
        olds = [norm_name(mdd._na(r.get(c))) for c in ("CMW_sciName", "MSW3_sciName") if mdd._na(r.get(c))]
        gs = genera(name, r, olds)
        out[name] = [(o, False) for o in olds] + [(c, True) for c in split_note(r["taxonomyNotes"], gs)]
        for m in _INCL.finditer(r["taxonomyNotes"]):
            for g, ep in _BIN.findall(m.group(1)):
                for c in _expand(g, ep, gs):
                    if c in names and c != name:
                        claims.setdefault(c, set()).add(name)
    for child, parents in claims.items():
        if len(parents) == 1:
            out[child].append((next(iter(parents)), True))
    return {n: [c for c in dict.fromkeys(cs) if c[0] != n and len(c[0].split()) == 2] for n, cs in out.items()
            if any(c[0] != n for c in cs)}


def type_localities(raw: Path) -> dict[str, tuple[float, float]]:
    """MDD species -> its type locality (lat, lon), where MDD gives one."""
    p = raw / mdd.MDD_FILE
    if not p.exists():
        return {}
    out: dict[str, tuple[float, float]] = {}
    with p.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            try:
                out[norm_name(r["sciName"])] = (float(r["typeLocalityLatitude"]), float(r["typeLocalityLongitude"]))
            except (TypeError, ValueError):
                pass
    return out


# how near a borrowed range must come to the type locality: two cells (~200 km), for a locality given to a
# country's centre or a small island PHYLACINE's ~96 km cells miss
NEAR = 2


def cell(lat: float, lon: float) -> tuple[int, int]:
    """The grid cell (row, col) a point falls in."""
    row = bisect.bisect_left([-x for x in row_edges()], -lat) - 1
    return min(max(row, 0), ROWS - 1), min(int(lon + 180), COLS - 1)


def holds(mask: dict[str, np.ndarray], lat: float, lon: float, pad: int = NEAR) -> bool:
    """Whether a species' current or present-natural range comes within `pad` cells of a point."""
    r, c = cell(lat, lon)
    cols = [(c + d) % COLS for d in range(-pad, pad + 1)]
    return any(bool(a[max(0, r - pad):r + pad + 1][:, cols].any()) for a in mask.values())


def borrow(names: dict[str, int], exact: dict[str, str], older: dict[str, list[tuple[str, bool]]], have: set[str],
           phy_syn: dict[str, str], ott_syn: dict[int, list[str]]) -> dict[str, tuple[str, str, bool]]:
    """Our species PHYLACINE lacks under any of its names -> (the PHYLACINE binomial, the older species
    whose range it is, split?): the first of its older names (older_names) that PHYLACINE has, by the same
    chain as an exact match (the name, PHYLACINE's synonym, the OTT synonyms of our row of that name); an
    older name PHYLACINE lacks is followed to its own older names (a species split twice)."""
    def find(name: str, seen: set[str]) -> tuple[str, str, bool] | None:
        for p, split in older.get(name, []):
            if p in seen:
                continue
            seen.add(p)
            hit = resolve([p] + ott_syn.get(names.get(p, 0), []), have, phy_syn)
            if hit:
                return hit, p, split
            up = find(p, seen)
            if up:
                return up[0], up[1], up[2] or split
        return None

    out: dict[str, tuple[str, str, bool]] = {}
    for name in names:
        if name not in exact:
            hit = find(name, {name})
            if hit:
                out[name] = hit
    return out


def build(raw: Path, mammals: Path) -> tuple[dict, dict]:
    species = species_rows(mammals)
    masks = load_masks(raw)
    _, phy_syn = load_phylacine(raw)
    ott_syn = synonyms({u for u in species.values() if u}, raw)
    m = match(species, set(masks), phy_syn, ott_syn)
    b = borrow(species, m, older_names(raw), set(masks), phy_syn, ott_syn)
    # An older name whose map no other species MDD accepts shares, and no note calls a split, is this
    # species under a former name (Microtus oeconomus, now Alexandromys): its own range, an exact match.
    accepted = {r["name"] for r in mdd.load(raw)}
    uses = Counter(h for n, h in [*m.items(), *((n, v[0]) for n, v in b.items())] if n in accepted)
    renamed = {n: h for n, (h, _, split) in b.items() if not split and uses[h] <= 1}
    m |= renamed
    split = {n: (h, p) for n, (h, p, _) in b.items() if n not in renamed}
    # ... and a split species' borrowed range must hold where it was described from (MDD's type locality)
    tl = type_localities(raw)
    far = {n for n, (h, _) in split.items() if n in tl and not holds(masks[h], *tl[n])}
    split = {n: v for n, v in split.items() if n not in far}
    empty = np.zeros(ranges.GRID_SHAPE, dtype=bool)
    # ToLaD#507: a living species' globe follows the maps its count stands on. Where PHYLACINE's note moves land
    # between species or deletes bad records, today's map is the corrected one (ranges.today_cells): green, and
    # grey only the present-natural cells outside it. A living species whose present-natural map is a placeholder
    # has no current map and no range to draw (stand_in). A range borrowed from the species a newer one was split
    # from is PHYLACINE's map of that species before the split, as it was (Eudorcas tilonura, the population
    # PHYLACINE gives Eudorcas rufina, keeps it in E. rufifrons's): no count stands on it.
    today = {p: t["map"] for p, t in ranges.today_cells(raw).items() if t["map"] is not None}
    stand_in = set(stand_ins())
    living = living_species(mammals)
    # ToLaD#507: the lost cells the evidence dates before 1500 (lossdates.PREHISTORIC) are not in the level the tree
    # holds to 1500, so they are not drawn as range lost (grey): they leave the present-natural list and are listed
    # apart, in `before_1500`
    pre = {p: v["cells"] for p, v in lossdates.prehistoric_cells(raw, lossdates.load()).items()}
    before = {}

    def mask(cs) -> np.ndarray:
        a = np.zeros(ranges.GRID_SHAPE, dtype=bool)
        for r, c in cs:
            a[r, c] = True
        return a

    def cells(n: str, p: str, own: bool = True) -> list[list[int]]:
        if own and n in living and p in stand_in:
            return [[], []]
        cur = masks[p].get("cur", empty)
        if own and n in living and p in today:
            cur = mask(today[p])
        nat = masks[p].get("nat", empty)
        if own and n in living and p in pre:
            nat = nat & ~mask(pre[p])
            before[n] = pack(mask(pre[p]))
        return [pack(cur), pack(nat)]

    out = {
        "grid": {"rows": ROWS, "cols": COLS, "lon0": -180, "lat": row_edges()},
        "ranges": dict(sorted({**{n: cells(n, p) for n, p in m.items()},
                               **{n: cells(n, h, own=False) + [p] for n, (h, p) in split.items()}}.items())),
    }
    out["before_1500"] = dict(sorted(before.items()))
    uses = [(n, p) for n, p in m.items() if n in living]
    stats = {"species": len(species), "matched": len(m), "renamed": len(renamed), "borrowed": len(split),
             "far": sorted(far), "maps": len(masks), "maps_shared": len(m) - len(set(m.values())),
             "corrected": sorted(n for n, p in uses if p in today),
             "stand_in": sorted(n for n, p in uses if p in stand_in), "before_1500": sorted(before)}
    return out, stats


def stand_ins(notes: dict[str, dict] | None = None) -> list[str]:
    """The living species whose present-natural map is a placeholder (ToLaD#507, phylacine_notes.csv class
    `placeholder`): IUCN maps no current range for them, and PHYLACINE's map stands in for one nobody knows
    (a town or the province's main city near the type locality, the ecoregion round a city when the type
    locality is only "Brazil", the range of the likely closest relative's subspecies, two whole ecoregions for
    a bat IUCN does not map, the whole island it is known from). Their globe draws no range: 'Range not
    known'."""
    notes = ranges.load_notes() if notes is None else notes
    return sorted(k for k, r in notes.items() if r["class"] == "placeholder" and r["iucn"] not in ranges.EXTINCT_STATUS)


def write(out: dict, path: Path) -> int:
    text = json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n"
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


# ---- the reptiles (ToLaD#601): GARD 1.7, today's range only ----------------------------------------------------

GARD = Path("amniotes") / "gard17" / "Gard_1_7_ranges.shp"
# WGS 84, the ellipsoid of PHYLACINE's Behrmann (research/range-loss-dates/hyde_fetch.py)
_A, _F = 6378137.0, 1 / 298.257223563


def geodetic_row_edges() -> np.ndarray:
    """The latitude (WGS 84 degrees) of each row's edges, north to south (ROWS + 1): the ellipsoidal Behrmann's y
    inverted on a 1e-4 degree table, as research/range-loss-dates/iucn_codes.py cell_edges (ToLaD#594). (row_edges, the
    page's, asin(y / Y_TOP), is within 0.25 deg of them south of 75 N, a fraction of a cell.) The columns are whole
    degrees from -180."""
    e2 = _F * (2 - _F)
    e = math.sqrt(e2)
    k0 = math.cos(math.radians(30)) / math.sqrt(1 - e2 * math.sin(math.radians(30)) ** 2)
    lat_t = np.linspace(-90, 90, 1_800_001)
    s = np.sin(np.radians(lat_t))
    y_t = _A * (1 - e2) * (s / (1 - e2 * s * s) - 1 / (2 * e) * np.log((1 - e * s) / (1 + e * s))) / (2 * k0)
    return np.interp(Y_TOP - np.arange(ROWS + 1) * CELL_Y, y_t, lat_t)


def polygon_cells(geom, lat: np.ndarray, tally: Counter | None = None) -> np.ndarray:
    """The flat cells (row * COLS + col, sorted) a (multi)polygon in lon/lat overlaps: each cell whose box's interior
    shares area with one of its polygons (intersects, and not only touches). An invalid polygon (GARD's are mostly a
    ring touching itself) is made valid first, alone. `tally` counts the maps with an invalid polygon (`invalid`) and
    the cells left out because a polygon only touches them (`touch_only`)."""
    import shapely

    lon = np.arange(-180.0, 180.0 + 1, 1.0)
    polys = shapely.get_parts(geom)
    bad = ~shapely.is_valid(polys)
    if bad.any():
        if tally is not None:
            tally["invalid"] += 1
        fixed = shapely.get_parts(shapely.make_valid(polys[bad]))
        polys = np.concatenate([polys[~bad], fixed[np.isin(shapely.get_type_id(fixed), (3, 6))]])
        polys = shapely.get_parts(polys)
    hit = np.zeros(ROWS * COLS, dtype=bool)
    touched = np.zeros(ROWS * COLS, dtype=bool)
    for g in polys:
        if g.is_empty:
            continue
        x0, y0, x1, y1 = g.bounds
        cols = np.flatnonzero((lon[1:] >= x0) & (lon[:-1] <= x1))
        rows = np.flatnonzero((lat[:-1] >= y0) & (lat[1:] <= y1))
        if not len(cols) or not len(rows):
            continue
        r, c = (a.ravel() for a in np.meshgrid(rows, cols, indexing="ij"))
        flat = r * COLS + c
        todo = ~hit[flat]
        if not todo.any():
            continue
        r, c, flat = r[todo], c[todo], flat[todo]
        boxes = shapely.box(lon[c], lat[r + 1], lon[c + 1], lat[r])
        shapely.prepare(g)
        meets = shapely.intersects(g, boxes)
        ok = meets.copy()
        if ok.any():
            ok[ok] = ~shapely.touches(g, boxes[ok])
        hit[flat[ok]] = True
        touched[flat[meets & ~ok]] = True
    if tally is not None:
        tally["touch_only"] += int((touched & ~hit).sum())
    return np.flatnonzero(hit)


def gard_ranges(raw: Path, want: set[str] | None = None, batch: int = 64, log=None, tally: Counter | None = None):
    """GARD 1.7 binomial -> its cells (polygon_cells), the shapefile read feature by feature (pyogrio, `batch` at a
    time: never the whole 855 MB in memory). `want`: only these binomials."""
    import pyogrio
    import pyogrio.raw
    import shapely

    p = raw / GARD
    lat = geodetic_row_edges()
    n = pyogrio.read_info(p)["features"]
    out: dict[str, np.ndarray] = {}
    for i0 in range(0, n, batch):
        _, _, wkb, (names,) = pyogrio.raw.read(p, skip_features=i0, max_features=batch, columns=["binomial"])
        for name, b in zip((" ".join(str(n).split()) for n in names), wkb):
            if want is None or name in want:
                out[name] = polygon_cells(shapely.from_wkb(b), lat, tally)
        if log and (i0 // batch % 16 == 15 or i0 + batch >= n):
            log(f"[globe] GARD {min(i0 + batch, n)}/{n} maps read")
    return out


def gard_names(raw: Path) -> list[str]:
    """GARD 1.7's binomials (the attribute table alone)."""
    import pyogrio.raw

    _, _, _, (names,) = pyogrio.raw.read(raw / GARD, read_geometry=False, columns=["binomial"])
    return [" ".join(str(n).split()) for n in names]


_WAS = re.compile(r"\(was: ([A-Z][a-z]+)\)")


def rdb_former(raw: Path) -> dict[str, str]:
    """The Reptile Database 2026-10's own synonym of each species it moved this release: 'new genus (was: Anilios)'
    -> the binomial in its former genus (Ramphotyphlops affinis -> Anilios affinis)."""
    import openpyxl

    path = raw / "amniotes" / "reptiledb" / "reptile_checklist_2026_10.xlsx"
    ws = openpyxl.load_workbook(path, read_only=True).worksheets[0]
    out = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        m = _WAS.search(str(r[6] or "")) if r[1] else None
        if m:
            name = " ".join(str(r[1]).split())
            out[name] = f"{m.group(1)} {name.split(' ', 1)[1]}"
    return out


def gard_match(reptiles: set[str], gard: set[str], former: dict[str, str], ott_names: dict[str, set[str]],
               rl_syn: dict[str, set[str]]) -> tuple[dict[str, str], dict[str, str]]:
    """Our reptile (Reptile Database name) -> the GARD binomial whose map it gets, and how: by its own name; else
    #592's rule (amniotes.name_reptiles) over the established synonyms, in order: the Reptile Database's own (its former
    genus, `former`), Open Tree's (`ott_names`: the names and synonyms of the OTT taxa of that name), the Red List's
    (`rl_syn`: the binomials one Red List species goes by, its own and its synonyms). A synonym counts when it renames
    the same species (the epithet's stem the same: a genus move or a Latin gender ending), is no species of ours, and is
    the only GARD name the species' synonyms give; a GARD name two of ours would take (a lump) goes to neither."""
    from .redlist import _stem

    def key(b: str) -> tuple[str, str]:
        g, e = b.split(" ", 1)
        return g, _stem(e)

    by_key: dict[tuple[str, str], set[str]] = defaultdict(set)
    for g in gard:
        by_key[key(g)].add(g)
    out = {sp: sp for sp in reptiles if sp in gard}
    how = {sp: "name" for sp in out}
    for sp in sorted(reptiles - set(out)):
        k = key(sp)
        sources = [("name (a Latin ending)", {sp}),
                   ("Reptile Database synonym", {former[sp]} if sp in former else set()),
                   ("Open Tree synonym", ott_names.get(sp, set())), ("Red List synonym", rl_syn.get(sp, set()))]
        found: dict[str, str] = {}
        for label, names in sources:
            for n in names:
                for g in by_key.get(key(n), ()):
                    if g not in reptiles and key(g)[1] == k[1]:
                        found.setdefault(g, label)
        if len(found) == 1:
            g, label = next(iter(found.items()))
            out[sp], how[sp] = g, label
    taken = Counter(out.values())
    for sp in [sp for sp, g in out.items() if taken[g] > 1]:
        del out[sp]
        how[sp] = "lump"
    return out, how


def build_reptiles(raw: Path, amniotes: Path, log=None) -> tuple[dict, dict]:
    """data/amniotes/ranges.json: every reptile of the amniotes' tree GARD 1.7 maps, `[current]`."""
    from .amniotes import load_ott_cut, load_rdb
    from .redlist import load_redlist

    rdb, _ = load_rdb(raw)
    reptiles = set(rdb) & set(species_rows(amniotes))
    gard = gard_names(raw)
    tax, syn, uids = load_ott_cut(raw)
    ott_names = {sp: {nm for u in uids.get(sp, ()) for nm in (tax[u]["name"], *syn.get(u, ()))} - {sp}
                 for sp in reptiles}
    rl_syn: dict[str, set[str]] = defaultdict(set)
    for n, r in load_redlist(raw, ("REPTILIA",), synonyms=True).items():
        group = {n, *r.get("synonyms", ())}
        for s in group:
            rl_syn[s] |= group - {s}
    m, how = gard_match(reptiles, set(gard), rdb_former(raw), ott_names, rl_syn)
    tally: Counter = Counter()
    cells = gard_ranges(raw, set(m.values()), log=log, tally=tally)
    flat = np.zeros(ROWS * COLS, dtype=bool)

    def packed(c: np.ndarray) -> list[int]:
        flat[:] = False
        flat[c] = True
        return pack(flat)

    out = {"grid": {"rows": ROWS, "cols": COLS, "lon0": -180, "lat": row_edges()},
           "ranges": {sp: [packed(cells[g])] for sp, g in sorted(m.items()) if len(cells[g])}}
    stats = {"reptiles": len(reptiles), "gard": len(gard), "matched": len(m), "drawn": len(out["ranges"]),
             "how": dict(Counter(how.get(sp, "unmatched") for sp in reptiles).most_common()),
             "gard_unused": len(set(gard) - set(m.values())), "invalid_maps": tally["invalid"],
             "touch_only_cells": tally["touch_only"], "cells": int(sum(len(c) for c in cells.values())),
             "unmatched_by_group": dict(Counter(rdb[sp]["group"] for sp in reptiles if sp not in m).most_common()),
             "by_synonym": {sp: [g, how[sp]] for sp, g in sorted(m.items()) if g != sp}}
    return out, stats


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, default=root / "data" / "raw")
    ap.add_argument("--mammals", type=Path, default=root / "data" / "mammals")
    ap.add_argument("--tree", choices=("mammals", "amniotes"), default="mammals",
                    help="amniotes: the reptiles' GARD 1.7 cells into data/amniotes/ranges.json (ToLaD#601)")
    ap.add_argument("--amniotes", type=Path, default=root / "data" / "amniotes")
    a = ap.parse_args(argv)
    if a.tree == "amniotes":
        return main_reptiles(a.raw, a.amniotes)
    out, stats = build(a.raw, a.mammals)
    n = write(out, a.mammals / "ranges.json")
    import gzip

    gz = len(gzip.compress((a.mammals / "ranges.json").read_bytes(), 9))
    print(f"[globe] {stats['matched']}/{stats['species']} species matched to {stats['maps']} PHYLACINE maps "
          f"({stats['renamed']} by a former name, {stats['maps_shared']} shared), {stats['borrowed']} borrow the "
          f"range of the species they were split from ({len(stats['far'])} more left out: the range misses their "
          f"type locality); ranges.json {n / 1e6:.2f} MB, gzip {gz / 1e6:.2f} MB", file=sys.stderr)
    print(f"[globe] ToLaD#507: {len(stats['corrected'])} living species drawn on today's corrected map "
          f"({', '.join(stats['corrected'])}); {len(stats['stand_in'])} whose present-natural map is a placeholder "
          f"draw no range ({', '.join(stats['stand_in'])}); {len(stats['before_1500'])} with range lost before "
          f"1500 listed apart ({', '.join(stats['before_1500'])})", file=sys.stderr)
    return 0


def main_reptiles(raw: Path, amniotes: Path) -> int:
    import gzip
    import time

    t0 = time.time()
    out, stats = build_reptiles(raw, amniotes, log=lambda m: print(f"{m} ({time.time() - t0:.0f}s)", file=sys.stderr))
    n = write(out, amniotes / "ranges.json")
    gz = len(gzip.compress((amniotes / "ranges.json").read_bytes(), 9))
    # (Each match by a synonym, and the counts, for a look: data/build/, not the page's.)
    work = amniotes.parent / "build"
    work.mkdir(exist_ok=True)
    (work / "globe_amniotes.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[globe] ToLaD#601: {stats['matched']}/{stats['reptiles']} reptiles matched to GARD 1.7's "
          f"{stats['gard']} maps ({', '.join(f'{v} {k}' for k, v in stats['how'].items())}); {stats['drawn']} drawn; "
          f"{stats['gard_unused']} GARD maps no species of ours takes; {stats['invalid_maps']} maps with an invalid "
          f"polygon made valid, {stats['touch_only_cells']} cells only touched left out; ranges.json "
          f"{n / 1e6:.2f} MB, gzip {gz / 1e6:.2f} MB ({time.time() - t0:.0f}s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
