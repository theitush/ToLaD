"""Direct count anchors (02 §2) and the mock individuals.

Every number here is either read from a pinned raw file (FAOSTAT, UN WPP) or
copied from a source whose page is pinned under data/raw and checked at build
time (PRB Table 1).
"""

from __future__ import annotations

import csv
import gzip
import html
import io
import re
import zipfile
from pathlib import Path

NOW_YEAR = 2026.77  # build date 2026-10-09, as a decimal year
MA_PER_YEAR = 1e-6


def year_to_ma(year: float) -> float:
    """Calendar year (negative = BCE) -> age in Ma before the build date."""
    return (NOW_YEAR - year) * MA_PER_YEAR


# PRB, "How Many People Have Ever Lived on Earth?" (Kaneda, Greenbaum & Haub,
# Nov 2022), Table 1: benchmark year, births between the previous benchmark and
# this one. 190,000 BCE is the start (population 2).
PRB_TABLE = [
    (-190000, 0),
    (-50000, 7_856_100_000),
    (-8000, 1_137_789_769),
    (1, 46_025_332_354),
    (1200, 26_591_343_000),
    (1650, 12_782_002_453),
    (1750, 3_171_931_513),
    (1850, 4_046_240_009),
    (1900, 2_900_237_856),
    (1950, 3_390_198_215),
    (2000, 6_064_994_884),
    (2010, 1_364_003_405),
    (2022, 1_690_275_115),
]
PRB_TOTAL_2022 = 117_020_448_575


def check_prb(raw: Path) -> bool:
    p = raw / "prb" / "how-many-people-have-ever-lived-on-earth.html"
    if not p.exists():
        return False
    t = html.unescape(re.sub(r"<[^>]+>", " ", p.read_text(encoding="utf-8", errors="replace")))
    ok = f"{PRB_TOTAL_2022:,}" in t and all(f"{b:,}" in t for _, b in PRB_TABLE[1:])
    if not ok:
        raise RuntimeError("PRB page no longer contains the Table 1 figures used in anchors.py")
    return True


def wpp_world(raw: Path) -> dict[int, dict]:
    out = {}
    with gzip.open(raw / "wpp" / "WPP2024_Demographic_Indicators_Medium.csv.gz", "rt", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["Location"] == "World" and row["Variant"] == "Medium":
                y = int(row["Time"])
                if 2015 <= y <= 2030:
                    out[y] = {"pop_july": float(row["TPopulation1July"]) * 1e3,
                              "births": float(row["Births"]) * 1e3}
    return out


def human_births_pieces(raw: Path) -> tuple[list[tuple[float, float, float]], float, float, list[str]]:
    """Piecewise-constant human birth rate: [(age_old_Ma, age_young_Ma, births/yr)].
    Returns (pieces, total ever born, alive now, notes)."""
    check_prb(raw)
    wpp = wpp_world(raw)
    pieces = []
    total = 0.0
    for (y0, _), (y1, births) in zip(PRB_TABLE, PRB_TABLE[1:]):
        pieces.append((year_to_ma(y0), year_to_ma(y1), births / (y1 - y0)))
        total += births
    y = 2022
    while y < NOW_YEAR:
        y_end = min(y + 1, NOW_YEAR)
        b = wpp[y]["births"] * (y_end - y)
        pieces.append((year_to_ma(y), year_to_ma(y_end), wpp[y]["births"]))
        total += b
        y += 1
    alive = wpp[2026]["pop_july"]
    notes = [f"ever = PRB 2022 Table 1 ({PRB_TOTAL_2022:.4g}) + UN WPP 2024 births 2022–2026",
             f"alive = UN WPP 2024 medium projection, 1 July 2026 ({alive:.4g})"]
    return pieces, total, alive, notes


# FAOSTAT QCL "Stocks" (element 5111), World (area 5000): item code -> species
FAO_ITEMS = {
    866: "Bos taurus",
    976: "Ovis aries",
    1016: "Capra hircus",
    1034: "Sus scrofa",
    946: "Bubalus bubalis",
    1096: "Equus caballus",
    1107: "Equus asinus",
    1126: "Camelus dromedarius",
}


def faostat_stocks(raw: Path) -> tuple[dict[str, tuple[float, int]], str]:
    z = zipfile.ZipFile(raw / "faostat" / "Production_Crops_Livestock_E_All_Data_(Normalized).zip")
    name = "Production_Crops_Livestock_E_All_Data_(Normalized).csv"
    best: dict[int, tuple[int, float]] = {}
    with z.open(name) as fb:
        for row in csv.DictReader(io.TextIOWrapper(fb, encoding="latin-1")):
            if row["Area Code"] != "5000" or row["Element Code"] != "5111":
                continue
            ic = int(row["Item Code"])
            if ic in FAO_ITEMS and row["Value"]:
                y = int(row["Year"])
                if ic not in best or y > best[ic][0]:
                    best[ic] = (y, float(row["Value"]))
    out = {FAO_ITEMS[ic]: (v, y) for ic, (y, v) in best.items()}
    return out, "FAOSTAT QCL stocks, World"


# Names the domestic form may carry in the Open Tree species list
DOMESTIC_ALIASES = {
    "Capra hircus": ["Capra aegagrus"],
    "Equus caballus": ["Equus ferus"],
    "Equus asinus": ["Equus africanus"],
    "Bos taurus": ["Bos primigenius"],
    "Bubalus bubalis": ["Bubalus arnee"],
}

# Domestication start (calendar year) for the domestic boom component.
DOMESTICATION_YEAR = {
    "Bos taurus": -8500, "Ovis aries": -9000, "Capra hircus": -8500, "Sus scrofa": -8500,
    "Bubalus bubalis": -5000, "Equus caballus": -3500, "Equus asinus": -4500,
    "Camelus dromedarius": -1000,
}

# ------------------------------------------------------------------ MOCK

MOCK_NOTE = ("MOCK: placeholder individual for UI development. Not from a records "
             "source; real individual records come in a later phase.")

# (species, display name, birth year, death year or None)
MOCK_INDIVIDUALS = [
    ("Canis lupus", "MOCK Hachiko (Akita dog)", 1923, 1935),
    ("Canis lupus", "MOCK Laika (space dog)", 1954, 1957),
    ("Ovis aries", "MOCK Dolly (cloned sheep)", 1996, 2003),
    ("Ursus maritimus", "MOCK Knut (zoo polar bear)", 2006, 2011),
    ("Gorilla gorilla", "MOCK Harambe (zoo gorilla)", 1999, 2016),
    ("Hexaprotodon liberiensis", "MOCK Moo Deng (zoo pygmy hippo)", 2024, None),
    ("Homo sapiens", "MOCK human#1 (placeholder person)", 1990, None),
]
