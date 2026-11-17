"""Test the land-use inference ("lost when its habitat was converted") on species whose loss is dated
by historians (ToLaD#515).

For each test, the lost cells (PHYLACINE present-natural minus current) inside a box are taken, and
HYDE 3.2.1's converted land (cropland + pasture + converted rangeland + urban) is summed over them per
time slice. The inferred date is the year conversion reached half of its 2017 level (q50), with q25-q75.
It is compared with the documented window. Run from pipeline/ as build_dates.py.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from build_dates import hyde_curve, q_year, slice_year  # noqa: E402

# (species, label, box lon0, lon1, lat0, lat1, documented first year, last year, citation)
TESTS = [
    ("Bison bison", "North America", -170, -50, 14, 75, 1750, 1890,
     "Hornaday 1889, The Extermination of the American Bison; Isenberg 2000, The Destruction of the Bison"),
    ("Cervus canadensis", "eastern North America", -100, -50, 25, 60, 1700, 1900,
     "O'Gara & Dundas 2002, in Toweill & Thomas (eds), North American Elk"),
    ("Ursus arctos", "contiguous USA and Mexico", -125, -90, 20, 49, 1850, 1950,
     "Mattson & Merrill 2002 Conserv. Biol. 16:1123"),
    ("Canis lupus", "North America", -170, -50, 14, 75, 1700, 1950,
     "Young & Goldman 1944, The Wolves of North America"),
    ("Puma concolor", "eastern North America", -100, -50, 25, 60, 1700, 1950,
     "Hall 1981; eastern cougar gone by the early 20th century (USFWS 2018, removal of the eastern puma, 83 FR 3086)"),
    ("Panthera leo", "North Africa", -20, 35, 20, 38, 1850, 1960,
     "Black et al. 2013 PLoS ONE 8:e60174 (Barbary lion's last records)"),
    ("Panthera tigris", "Java and Bali", 105, 116, -9, -5.5, 1940, 1990,
     "Seidensticker 1987, in Tilson & Seal (eds), Tigers of the World (Bali 1940s, Java 1970s-80s)"),
    ("Panthera tigris", "Caspian region", 40, 80, 35, 50, 1900, 1975,
     "Heptner & Sludskii 1972/1992, Mammals of the Soviet Union II(2)"),
    ("Lynx pardinus", "Iberia and France", -10, 8, 35, 50, 1900, 2002,
     "Rodriguez & Delibes 1992 Biol. Conserv. 61:189; Guzman et al. 2004 (Iberian lynx census)"),
    ("Mustela lutreola", "Europe", -12, 60, 35, 72, 1850, 2007, "Maran 2007 (Tallinn Univ. diss.)"),
    ("Oryx leucoryx", "Arabia and the Levant", 30, 60, 12, 38, 1850, 1972, "Henderson 1974 Oryx 12:347"),
    ("Rhinoceros sondaicus", "South and Southeast Asia", 70, 120, -10, 30, 1850, 2010,
     "Foose & van Strien 1997, Asian Rhinos action plan; Vietnam's last 2010 (Brook et al. 2014 Biol. Conserv. 174:21)"),
    ("Rhinopithecus roxellana", "China", 97, 123, 18, 43, 1600, 2002, "Li, Pan & Oxnard 2002 Int. J. Primatol. 23:1227"),
    ("Chinchilla lanigera", "Chile and Argentina", -80, -60, -40, -15, 1890, 1930, "Jimenez 1996 Biol. Conserv. 77:1"),
    ("Macrotis lagotis", "Australia", 110, 156, -45, -9, 1880, 1970,
     "Woinarski, Burbidge & Harrison 2014, The Action Plan for Australian Mammals 2012 (CSIRO)"),
    ("Bettongia lesueur", "mainland Australia", 110, 156, -39.5, -9, 1880, 1960,
     "Woinarski, Burbidge & Harrison 2014, The Action Plan for Australian Mammals 2012 (CSIRO)"),
    ("Myrmecobius fasciatus", "Australia", 110, 156, -45, -9, 1880, 1980,
     "Woinarski, Burbidge & Harrison 2014, The Action Plan for Australian Mammals 2012 (CSIRO)"),
    ("Equus zebra", "southern Africa", 10, 35, -36, -15, 1700, 1950, "Penzhorn 1988 Mammalian Species 314"),
    ("Martes martes", "Great Britain", -8, 2, 49.5, 61, 1800, 1915, "Langley & Yalden 1977 Mammal Rev. 7:95"),
    # prehistoric controls: losses long before 1500
    ("Sarcophilus harrisii", "mainland Australia", 110, 156, -39.5, -9, -1300, -1100,
     "Brown 2006 Alcheringa 30(S1):49; White et al. 2018 The Holocene 28:1145"),
    ("Cuon alpinus", "North America", -170, -50, 14, 75, -40000, -9000,
     "Late Pleistocene fossils only (Kurten & Anderson 1980, Pleistocene Mammals of North America)"),
    ("Equus ferus", "the Americas", -170, -30, -56, 75, -15000, -9000,
     "Late Pleistocene extinction of American horses (Guthrie 2003 Nature 426:169)"),
]


def main(lost_json, hyde_npz):
    d = json.load(open(lost_json))
    lons, lats = np.array(d["lons"]), np.array(d["lats"])
    h = dict(np.load(hyde_npz))
    slices = [str(x) for x in h["slices"]]
    years = [slice_year(x) for x in slices]
    hit = ovl = 0
    out = []
    for sp, lab, x0, x1, y0, y1, a, b, cite in TESTS:
        lost = np.array(d["species"][sp]["lost"])
        lo, la = lons[lost % 360], lats[lost // 360]
        cells = lost[(lo >= x0) & (lo <= x1) & (la >= y0) & (la <= y1)]
        conv, _ = hyde_curve(h, cells, years, slices)
        q = [q_year(conv, years, p) for p in (0.25, 0.5, 0.75)]
        ok = a <= q[1] <= b
        ov = q[0] <= b and q[2] >= a
        hit += ok
        ovl += ov
        miss = 0 if ok else min(abs(q[1] - a), abs(q[1] - b))
        out.append((sp, lab, len(cells), a, b, *q, round(float(conv[slices.index("1500AD")]), 2),
                    round(float(conv[-1]), 2), "yes" if ok else "no", "yes" if ov else "no", miss))
    print("| species | where | cells | documented | HYDE q25-q50-q75 | converted 1500 / 2017 | q50 in window | miss (yr) |")
    print("|---|---|---|---|---|---|---|---|")
    for r in out:
        print(f"| *{r[0]}* | {r[1]} | {r[2]} | {r[3]}-{r[4]} | {r[5]}-{r[6]}-{r[7]} | {r[8]} / {r[9]} | {r[10]} | {r[12]} |")
    print(f"\nq50 in window: {hit}/{len(TESTS)}; q25-q75 overlaps window: {ovl}/{len(TESTS)}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
