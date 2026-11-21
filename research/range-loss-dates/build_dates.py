"""Date the range losses of the 682 species the tree draws falling since 1500 (ToLaD#515).

Inputs (from lost_cells.py, hyde_fetch.py and iucn_codes.py): lost_cells.json, hyde_on_phylacine.npz and, optional,
iucn_codes.json. Output: research/range-loss-dates.csv, one row per species, and a summary on stdout.

Every date here comes from a cited source; nothing is fitted. Four kinds of evidence:
  1. PHYLACINE's own note (Spatial_metadata.csv) and what its cited source covers;
  2. for islands, the archaeological date of people's first arrival: a bound, not a date;
  3. (ToLaD#594) IUCN 2026's range maps: the lost cells coded Possibly Extinct or Extinct were lost after 1500, by
     the species' assessment (iucn_*; the rule is in apply_iucn);
  4. HYDE 3.2.1 land use over the lost cells: an inference ("lost when converted"), kept in its
     own columns (hyde_*) and never written into earliest_year/latest_year.
Run from pipeline/: `uv run python ../research/range-loss-dates/build_dates.py LOST.json HYDE.npz OUT.csv [IUCN.json]`.
HYDE.npz `-` keeps the hyde_* columns OUT.csv already has (the HYDE slices are a ~10 min fetch).
"""
import csv
import json
import re
import sys

import numpy as np

MAP_YEAR = 2016  # PHYLACINE 1.2's current ranges are IUCN 2016-3: a loss in them happened by then
# ToLaD#594: the evidence that covers at least half a species' lost cells dates it, as an island does (step 4 below)
HALF = 0.5
IUCN_SOURCE = "IUCN 2026 range map, presence codes 4-5"
IUCN_CITE = ("IUCN 2026, The IUCN Red List of Threatened Species: range maps (search download, requested 2026-11-17): "
             "lost cells coded Possibly Extinct (4) or Extinct (5), which mean known or thought very likely to occur "
             "post-1500 and now gone (IUCN Mapping attribute codes v1.19, 2021); lost by the year of the species' "
             "assessment")
IUCN_COLS = ["iucn_name", "iucn_match", "iucn_assessed", "iucn_share", "iucn_extant_share", "iucn_ex_countries",
             "iucn_pe_countries"]
HYDE_COLS = ["hyde_q25", "hyde_q50", "hyde_q75", "hyde_conv_1500", "hyde_conv_2017", "hyde_used_2017",
             "hyde_conv_cur_2017"]

# ---------------------------------------------------------------- regions (lost-cell centres)


def in_region(reg, lon, lat):
    if reg is None:
        return True
    if reg == "NA":  # North America incl. Mexico
        return lon < -50 and lat > 14
    if reg == "AU":  # mainland Australia and Tasmania
        return 110 <= lon <= 156 and -45 <= lat <= -9
    if reg == "AF":  # Africa (Red Sea / Suez as the edge)
        if not (-20 <= lon <= 52 and -36 <= lat <= 38):
            return False
        if lat > 30:
            return lon < 32.5
        return lat < 12 or lon < 32.5 + (30 - lat) * 0.62
    if reg == "NZ":
        return 165 <= lon <= 179.5 and -48 <= lat <= -34
    if reg == "CN":  # China south of 43 N, east of 97 E
        return 97 <= lon <= 123 and 18 <= lat <= 43
    if reg == "AM":  # the Americas
        return lon < -30
    if reg == "EU":
        return -12 <= lon <= 45 and 35 <= lat <= 72
    raise ValueError(reg)


# ---------------------------------------------------------------- islands: people's first arrival
# (name, lon0, lon1, lat0, lat1, earliest year of arrival (negative = BCE), says_little, citation)
ISLANDS = [
    ("Madagascar", 43, 51, -26, -11.5, -8500, False,
     "Possible Early Holocene presence (cut-marked elephant-bird bones ~10,500 BP, Hansford et al. 2018 Sci. Adv. "
     "4:eaat6925); presence secure by ~2,000 cal BP (Douglass et al. 2019 Quat. Sci. Rev. 221:105878)"),
    ("Cuba", -85.5, -74, 19.3, 23.5, -3800, False,
     "First settlement of the Greater Antilles ~5,800 BP (Napolitano et al. 2019 Sci. Adv. 5:eaar7806)"),
    ("Hispaniola", -74.6, -68, 17.4, 20.2, -3800, False,
     "First settlement of the Greater Antilles ~5,800 BP (Napolitano et al. 2019 Sci. Adv. 5:eaar7806)"),
    ("Cayman Islands", -81.6, -79.6, 19.1, 19.9, 1503, False,
     "No pre-Columbian sites found; first seen by Columbus in 1503 (Stokes & Keegan 1993, settlement survey of Grand "
     "Cayman, Florida Museum of Natural History)"),
    ("Jamaica", -78.6, -75.9, 17.0, 18.8, 600, False,
     "Earliest sites shortly after AD 600, no Archaic sites (Callaghan 2008 J. Island Coastal Archaeol. 3:54-71)"),
    ("New Zealand", 165, 179.5, -48, -34, 1280, False,
     "Polynesian arrival ~1280 CE (Wilmshurst et al. 2011 PNAS 108:1815)"),
    ("Fiji/Tonga", 176, 180.1, -23, -15, -1050, False,
     "Lapita settlement ~3,000-2,850 cal BP (Sheppard 2011 Curr. Anthropol. 52:799; Burley et al. 2012 PLoS ONE "
     "7:e48769)"),
    ("Fiji/Tonga", -180.1, -172, -23, -15, -1050, False,
     "Lapita settlement ~3,000-2,850 cal BP (Sheppard 2011 Curr. Anthropol. 52:799; Burley et al. 2012 PLoS ONE "
     "7:e48769)"),
    ("New Caledonia", 163.5, 168.5, -23, -19.5, -1100, False,
     "Lapita settlement ~3,000 cal BP (Sheppard 2011 Curr. Anthropol. 52:799)"),
    ("Andaman Islands", 92, 94, 10, 14, -50000, True,
     "Archaeology only from ~2,200 BP (Cooper 2002, Archaeology and History: Early Settlements in the Andaman "
     "Islands, OUP); genetics suggests settlement tens of thousands of years ago (Endicott et al. 2003 Am. J. Hum. "
     "Genet. 72:178)"),
    ("Solomon Islands", 154, 163, -12, -5, -27000, True,
     "Buka (Kilu Cave) occupied ~29,000 BP (Wickler & Spriggs 1988 Antiquity 62:703)"),
    ("Vancouver Island", -128.6, -123, 48.2, 51, -11000, True,
     "People on the outer coast of British Columbia by ~13,000 BP (McLaren et al. 2018 PLoS ONE 13:e0193522)"),
    ("Sri Lanka", 79.4, 82.1, 5.7, 10, -46000, True,
     "Fa-Hien Lena ~48,000 BP (Wedage et al. 2019 Nat. Commun. 10:739); joined to India at glacial low sea level"),
    ("Taiwan", 119.5, 122.5, 21.5, 26, -30000, True,
     "Joined to mainland Asia at glacial low sea level (Voris 2000 J. Biogeogr. 27:1153): people there in the Late "
     "Pleistocene"),
    ("Hainan", 108.4, 111.3, 17.8, 20.3, -30000, True,
     "Joined to mainland Asia at glacial low sea level (Voris 2000 J. Biogeogr. 27:1153): people there in the Late "
     "Pleistocene"),
    ("Ryukyu Islands", 122.9, 130.6, 24, 29.5, -34000, True,
     "Okinawa occupied from ~36,000-35,000 BP (Fujita et al. 2016 PNAS 113:11184)"),
    ("Japan", 129, 146, 30, 46, -36000, True,
     "Japanese Palaeolithic from ~38,000 BP (Izuho & Kaifu 2015, in Emergence and Diversity of Modern Human "
     "Behavior in Paleolithic Asia, Texas A&M UP)"),
    ("Philippines", 116.9, 127, 4.5, 21.2, -45000, True,
     "Modern humans on Palawan ~47,000 BP (Detroit et al. 2004 C. R. Palevol 3:705); hominins on Luzon by "
     "709,000 BP (Ingicco et al. 2018 Nature 557:233)"),
    ("Sulawesi", 118.5, 125.6, -6, 2, -43500, True,
     "Cave art >=45,500 BP (Brumm et al. 2021 Sci. Adv. 7:eabd4648)"),
    ("Lesser Sundas", 115.5, 127.5, -11, -7.8, -42000, True,
     "Timor occupied ~44,000 BP (Hawkins et al. 2017 Quat. Sci. Rev. 171:58)"),
    ("Moluccas", 125.5, 130.6, -4.5, 3, -45000, True,
     "Wallacea crossed by ~47,000-55,000 BP (O'Connell et al. 2018 PNAS 115:8482)"),
    ("New Guinea", 130.6, 151, -11, 0, -47000, True,
     "Ivane Valley occupied 49,000-43,000 BP (Summerhayes et al. 2010 Science 330:78)"),
    ("Sundaland islands", 95, 120, -9, 7.5, -61000, True,
     "Sumatra (Lida Ajer) 73,000-63,000 BP (Westaway et al. 2017 Nature 548:322); Niah, Borneo ~46,000 BP "
     "(Barker et al. 2007 J. Hum. Evol. 52:243); joined to Asia at glacial low sea level (Voris 2000)"),
]


def island_of(lon, lat):
    for nm, x0, x1, y0, y1, yr, little, cite in ISLANDS:
        if x0 <= lon <= x1 and y0 <= lat <= y1:
            return nm, yr, little, cite
    return None


# ---------------------------------------------------------------- named sources: what period they cover
# Generic sources, matched on the note text. (pattern, key, region, earliest, latest, confidence, citation)
GENERIC = [
    (r"Strahan", "Strahan & Van Dyck 2008", "AU", 1788, 2008, "medium",
     "Strahan & Van Dyck 2008, The Mammals of Australia, 3rd ed.: former ranges from records since European "
     "settlement in 1788; Woinarski, Burbidge & Harrison 2015 PNAS 112:4531 (declines mostly 1850s-1950s)"),
    (r"Hall E", "Hall 1981", "NA", 1500, 1981, "medium",
     "Hall 1981, The Mammals of North America (2nd ed.): ranges from specimen and literature records of the "
     "historic period; used as the pre-settlement range by Laliberte & Ripple 2004 BioScience 54:123"),
    (r"Ray, Justina", "Ray et al. 2005", "AF", 1500, 2005, "low",
     "Ray, Hunter & Zigouris 2005, WCS Working Paper 24: historic ranges of African carnivores from literature "
     "records (no single baseline year stated)"),
]
# Species with their own source: (earliest, latest, region of the dated part, confidence, basis, citation).
# earliest None = the source gives no lower bound. Region None = all lost cells.
NAMED = {
    "Rhinopithecus avunculus": (1600, 2002, None, "high", "historic",
                                "Li, Pan & Oxnard 2002 Int. J. Primatol. 23:1227, 'Extinction of snub-nosed monkeys "
                                "in China during the past 400 years' (local gazetteers)"),
    "Rhinopithecus bieti": (1600, 2002, None, "high", "historic", "Li, Pan & Oxnard 2002 Int. J. Primatol. 23:1227"),
    "Rhinopithecus brelichi": (1600, 2002, None, "high", "historic", "Li, Pan & Oxnard 2002 Int. J. Primatol. 23:1227"),
    "Rhinopithecus roxellana": (1600, 2002, None, "high", "historic", "Li, Pan & Oxnard 2002 Int. J. Primatol. 23:1227"),
    "Enhydra lutris": (1741, 1911, None, "high", "historic",
                       "Maritime fur trade 1741-1911 (Kenyon 1969, The Sea Otter in the Eastern Pacific Ocean, "
                       "N. Am. Fauna 68); historic range per USFWS Biol. Rep. 90(1) 1990"),
    "Chinchilla chinchilla": (1828, 1996, None, "high", "historic",
                              "Fur trade, peak 1895-1910 (Jimenez 1996 Biol. Conserv. 77:1)"),
    "Chinchilla lanigera": (1828, 1996, None, "high", "historic",
                            "Fur trade, peak 1895-1910 (Jimenez 1996 Biol. Conserv. 77:1)"),
    "Ceratotherium simum": (1500, 1999, None, "medium", "historic",
                            "Emslie & Brooks 1999, African Rhino: Status Survey and Conservation Action Plan, IUCN"),
    "Diceros bicornis": (1500, 1999, None, "medium", "historic",
                         "Emslie & Brooks 1999, African Rhino: Status Survey and Conservation Action Plan, IUCN"),
    "Rhinoceros sondaicus": (1500, 1997, None, "medium", "historic",
                             "Foose & van Strien 1997, Asian Rhinos: Status Survey and Conservation Action Plan, IUCN"),
    "Rhinoceros unicornis": (1500, 1997, None, "medium", "historic",
                             "Foose & van Strien 1997, Asian Rhinos: Status Survey and Conservation Action Plan, IUCN"),
    "Dicerorhinus sumatrensis": (1500, 1997, None, "medium", "historic",
                                 "Foose & van Strien 1997 (Asian Rhinos action plan); part from C. R. Palevol 11:159 "
                                 "(2012), a prehistoric record"),
    "Mustela lutreola": (1800, 2007, None, "medium", "historic",
                         "Maran 2007, Conservation biology of the European mink (Tallinn Univ. diss.): decline since "
                         "the 19th century"),
    "Pteropus rodricensis": (1691, MAP_YEAR, None, "high", "island",
                             "Rodrigues had no people before 1691 (Cheke & Hume 2008, Lost Land of the Dodo)"),
    "Phocarctos hookeri": (1280, 1850, None, "medium", "prehistoric",
                           "Mainland NZ breeding range lost after Polynesian arrival (Collins et al. 2014 Proc. R. "
                           "Soc. B 281:20140097; Wilmshurst et al. 2011 PNAS 108:1815)"),
    "Mystacina robusta": (1280, 2001, None, "medium", "island",
                          "Historically widespread in NZ (Lloyd 2001 NZ J. Zool. 28:59); no people before ~1280 CE "
                          "(Wilmshurst et al. 2011)"),
    "Mystacina tuberculata": (1280, 2001, None, "medium", "island",
                              "Historically widespread in NZ (Lloyd 2001 NZ J. Zool. 28:59); no people before ~1280 "
                              "CE (Wilmshurst et al. 2011)"),
    "Lasiorhinus krefftii": (1788, 2013, None, "medium", "historic",
                             "Queensland Government (DEHP) species profile: former range from post-1788 records"),
    "Lasiorhinus latifrons": (1788, 2013, None, "medium", "historic",
                              "Queensland Government (DEHP) source as cited by PHYLACINE; post-1788 records"),
    "Neophoca cinerea": (1798, 1989, None, "medium", "historic",
                         "Bass Strait range lost to sealing from 1798 (King 1989, Fauna of Australia 1B, ch. 56)"),
    "Sarcophilus harrisii": (-1300, -1100, "AU-mainland", "high", "prehistoric",
                             "Mainland extinction ~3,200 BP (Brown 2006 Alcheringa 30(S1):49; White et al. 2018 "
                             "The Holocene 28:1145)"),
    "Pagophilus groenlandicus": (-5500, -500, None, "medium", "prehistoric",
                                 "Mid-Holocene Baltic breeding population, gone in prehistory (Stora & Ericson 2004 "
                                 "Mar. Mamm. Sci. 20:115)"),
    "Alces alces": (-800, None, "EU", "low", "prehistoric",
                    "Iron Age range (Willms 1987 Archeologia Polski 32:249): lost from that range after the Iron Age"),
    "Equus grevyi": (None, None, None, "low", "fossil",
                     "Fossil history of Grevy's zebra (Faith et al. 2013 J. Biogeogr. 40:359): prehistoric range"),
    "Ailuropoda melanoleuca": (None, MAP_YEAR, None, "low", "fossil",
                               "Historic and fossil range (Mol. Ecol. 21:5660, 2012): part prehistoric"),
    "Axis kuhlii": (None, None, None, "low", "fossil", "Holocene records on Java (PHYLACINE note): undated"),
    "Eschrichtius robustus": (None, 1750, None, "medium", "historic",
                              "Atlantic gray whale: last records 17th-18th century (Mead & Mitchell 1984, in The Gray "
                              "Whale, Academic Press); Mediterranean from a Holocene subfossil"),
    "Oryx leucoryx": (1500, 1972, None, "medium", "historic",
                      "Afr. J. Ecol. 2:103 (1963) historic range; last wild animals shot 1972 (Henderson 1974 Oryx "
                      "12:347)"),
    "Equus zebra": (1652, 1988, None, "medium", "historic",
                    "Penzhorn 1988 Mammalian Species 314: decline after Cape settlement (1652)"),
    "Lutra lutra": (1868, 1979, None, "medium", "historic",
                    "Japanese otter: fur hunting from the Meiji era, last record 1979, declared extinct 2012 (Ministry "
                    "of the Environment, Japan)"),
    "Martes martes": (1800, 1977, None, "medium", "historic",
                      "Langley & Yalden 1977 Mammal Rev. 7:95: decline of rarer carnivores in Great Britain in the "
                      "19th century"),
    "Pteropus fundatus": (1500, 2009, None, "low", "historic", "Am. Mus. Novit. 3646 (2009): historic records"),
    "Hippopotamus amphibius": (1500, MAP_YEAR, "AF", "low", "historic",
                               "African part: historic range per wildliferanching.com as cited by PHYLACINE; the "
                               "Eurasian part is suitable habitat with no date (hippos in the Levant are known from the "
                               "Bronze and Iron Ages)"),
    "Giraffa camelopardalis": (1500, 2013, None, "low", "historic",
                               "Assumed former range per Kingdon & Hoffmann 2013 (Mammals of Africa), plus suitable "
                               "habitat between the parts"),
    "Bos mutus": (None, None, None, "low", "none",
                  "Range set as the range of domestic yaks (ILRI-SLU): not a dated historic range"),
    "Bison bonasus": (None, 1927, "EU", "low", "historic",
                      "LHN historic range (lhnet.org) spans Holocene records; last wild bison 1919 (Bialowieza) and "
                      "1927 (Caucasus) (Pucek et al. 2004, Status Survey and Conservation Action Plan: European Bison, "
                      "IUCN)"),
    "Elaphurus davidianus": (None, 1900, None, "low", "historic",
                             "Historic occurrence north to 43 N per IUCN; wild population gone by ~1900 or earlier"),
    "Saiga tatarica": (None, None, None, "low", "fossil",
                       "Eurasian range from ancient DNA (Campos et al. 2010 Mol. Ecol. 19:4863); North America from "
                       "fossil co-occurrence: Pleistocene"),
    "Equus ferus": (None, -9000, "AM", "medium", "prehistoric",
                    "Suitable areas on four continents (Naundrup 2014 rewilding assessment); the dated part: horses "
                    "died out in the Americas in the Late Pleistocene (Guthrie 2003 Nature 426:169)"),
    "Cuon alpinus": (None, -9000, "NA", "medium", "prehistoric",
                     "The dated part: dholes in North America are known only from Late Pleistocene fossils (Kurten & "
                     "Anderson 1980, Pleistocene Mammals of North America)"),
}
# the rest of the cert-2 'other source' notes: written historic sources, no stated window
HISTORIC_DEFAULT = (1500, MAP_YEAR, None, "low", "historic")


def slice_year(s):
    return -int(s[:-2]) if s.endswith("BC") else int(s[:-2])


def hyde_curve(h, cells, years, slices):
    land = h["maxln"][cells].sum()
    if land < 5000:  # under ~half a cell of land: marine or coastal
        return None
    conv = np.array([sum(h[f"{v}_{s}"][cells].sum() for v in ("cropland", "pasture", "conv_rangeland", "uopp"))
                     for s in slices]) / land
    used = np.array([sum(h[f"{v}_{s}"][cells].sum() for v in ("cropland", "pasture", "rangeland", "uopp"))
                     for s in slices]) / land
    return conv, used


def q_year(curve, years, p):
    """First year the curve reaches p x its last value (linear between slices)."""
    target = p * curve[-1]
    if curve[-1] <= 0:
        return None
    for i in range(len(curve)):
        if curve[i] >= target:
            if i == 0:
                return years[0]
            f = (target - curve[i - 1]) / (curve[i] - curve[i - 1])
            return round(years[i - 1] + f * (years[i] - years[i - 1]))
    return years[-1]


def classify(b, s):
    """Primary basis from PHYLACINE's full note (Certainty.Level, Modification, Motivation)."""
    cert = s["certainty"][:1]
    t = s["modification"] + " || " + s["motivation"]
    if cert == "0":
        return "iucn_codes"
    if b in NAMED:
        return NAMED[b][4]
    if re.search(r"Strahan|Hall E|Ray, Justina", t):
        return "historic"
    if cert == "2" or (cert == "5" and re.search(r"histor|formerly occur", s["modification"], re.I)):
        return "historic"
    if cert == "6":
        return "fossil"
    if cert == "4" or re.search(r"island|Java|Taiwan", s["modification"], re.I):
        return "island"
    return "none"


def apply_iucn(basis, e, l, share, dated, lost, iu):
    """ToLaD#594: IUCN 2026's Possibly Extinct / Extinct codes on a species' lost cells. They mean lost after 1500, by
    the assessment's year: the rule that dates PHYLACINE's 78 certainty-0 species (their 2016-3 maps), on the 2026 maps.
    `dated`: the lost cells the basis's evidence dates after 1500 (a mask; None: not known which). Returns (basis, e, l,
    share, source, cite, conf), source None for the basis's own. A documented later start and a prehistoric part stay
    as they are; so does a historic source bounded by 1500, its dated share now the cells it or the codes cover."""
    coded = np.isin(lost, iu.get("coded", []))
    ish = float(coded.mean()) if len(lost) else 0.0
    later = e is not None and e > 1500
    if basis == "iucn_codes":
        if ish >= HALF:  # the 2026 maps still code the loss: they date it, by the 2026 assessment
            return basis, 1500, iu["assessed"], ish, IUCN_SOURCE, IUCN_CITE, "high"
        return basis, e, l, share, None, None, None  # the 2016-3 maps did; the 2026 ones no longer do
    if basis in ("island", "none", "fossil") and not later and ish >= HALF:
        return "iucn_codes", 1500, iu["assessed"], ish, IUCN_SOURCE, IUCN_CITE, "high"
    if basis == "historic" and not later and dated is not None:
        share = float((dated | coded).mean())
    elif basis in ("none", "fossil") and e is None and l is None:
        share = ish or 0  # undated: the codes date less than half of it
    return basis, e, l, share, None, None, None


def main(lost_json, hyde_npz, out_csv, iucn_json=None):
    d = json.load(open(lost_json))
    lons, lats = np.array(d["lons"]), np.array(d["lats"])
    h = dict(np.load(hyde_npz)) if hyde_npz != "-" else None  # decompress every array once
    prev = {r["binomial"]: r for r in csv.DictReader(open(out_csv))} if h is None else {}
    iucn = json.load(open(iucn_json)) if iucn_json else {}
    slices = [str(x) for x in h["slices"]] if h else []
    years = [slice_year(x) for x in slices]
    rows = []
    for b, s in d["species"].items():
        lost = np.array(s["lost"])
        cur = np.array(s["cur"])
        clon, clat = lons[lost % 360], lats[lost // 360]
        t = s["modification"] + " || " + s["motivation"]
        basis = classify(b, s)
        e = l = None
        conf, cite, source, region, share, dated = "", "", "", None, 0.0, None
        if basis == "iucn_codes":
            e, l, conf = 1500, MAP_YEAR, "high"
            source = "IUCN 2016-3 range map, presence codes 4-5"
            cite = ("Faurby et al. 2018 Ecology 99:2626 (PHYLACINE adds IUCN's Extinct and Possibly Extinct polygons "
                    "to the present-natural range); IUCN Mapping attribute codes v1.19 (2021): Possibly Extinct (4) "
                    "and Extinct (5) mean known or thought very likely to occur post-1500 and now gone")
            share, dated = 1.0, np.ones(len(lost), bool)
        elif b in NAMED:
            e, l, region, conf, _, cite = NAMED[b]
            source = cite if len(cite) <= 90 else cite[:87] + "..."
        elif basis == "historic":
            for pat, key, reg, e0, l0, c0, ct in GENERIC:
                if re.search(pat, t):
                    e, l, region, conf, cite, source = e0, l0, reg, c0, ct, key
                    break
            else:
                e, l, region, conf, _ = HISTORIC_DEFAULT
                source = re.sub(r"\s+", " ", s["motivation"])[:160]
                cite = (f"PHYLACINE note cites: {source}. Written-record historic range; no window stated by the "
                        "source, so bounded by 1500 and the 2016 map")
                if s["certainty"][:1] == "5":
                    source = re.sub(r"\s+", " ", s["modification"])[:160]
                    cite = ("PHYLACINE note: " + source + " Only the named part is historic; the rest of the added "
                            "range is suitable habitat with no date")
            if b in ("Herpailurus yagouaroundi", "Leopardus pardalis"):
                region, conf = None, "low"
                cite += " [PHYLACINE cites Ray et al. 2005 for an American cat: the source does not cover it]"
        if e is None and l is None and basis in ("island", "none", "fossil"):
            # bounded per lost cell by the island it lies on (people's first arrival)
            hits = [island_of(lo, la) for lo, la in zip(clon, clat)]
            on = [x for x in hits if x]
            if on and len(on) / len(lost) >= 0.5:
                e, l = min(x[1] for x in on), MAP_YEAR
                conf = "bound only, says little" if all(x[2] for x in on) else "bound only"
                source = "first human arrival: " + ", ".join(sorted({x[0] for x in on}))
                cite = " | ".join(sorted({x[3] for x in on}))
                share = len(on) / len(lost)
                basis = "island" if basis != "fossil" else "fossil"
            elif basis == "island":
                basis = "none"  # island in the note, but most lost cells are not on a listed island
        if (b in NAMED or basis == "historic") and (e is not None or l is not None):
            if region == "AU-mainland":
                m = [(110 <= lo <= 156 and -39.5 <= la <= -9) for lo, la in zip(clon, clat)]
            else:
                m = [in_region(region, lo, la) for lo, la in zip(clon, clat)]
            share, dated = float(np.mean(m)), np.array(m)
            if basis == "historic" and b not in NAMED and s["certainty"][:1] == "5" and not region:
                share, dated = None, None  # only a named part of the added range is historic: its share is not known
        if not (e is not None or l is not None):
            share = 0
        iu = iucn.get(b)
        if iu and iu["how"] != "no match":
            basis, e, l, share, src26, cite26, conf26 = apply_iucn(basis, e, l, share, dated, lost, iu)
            if src26:
                source, cite, conf = src26, cite26, conf26
        row = {"binomial": b, "iucn": s["iucn"], "order": s["order"], "lost_cells": len(lost),
               "earliest_year": "" if e is None else e, "latest_year": "" if l is None else l,
               "basis": basis, "dated_share": "" if share is None else round(share, 2),
               "source": source, "citation": cite, "confidence": conf,
               "phylacine_certainty": s["certainty"][:2], "phylacine_note": re.sub(r"\s+", " ", t)[:300]}
        if iu:
            row.update(iucn_name=iu["name"], iucn_match=iu["how"])
            if iu["how"] != "no match":
                row.update(iucn_assessed=iu["assessed"],
                           iucn_share=round(float(np.isin(lost, iu["coded"]).mean()), 2),
                           iucn_extant_share=round(float(np.isin(lost, iu["extant"]).mean()), 2),
                           iucn_ex_countries="; ".join(iu["ex_countries"]),
                           iucn_pe_countries="; ".join(iu["pe_countries"]))
        if h is None:
            row.update({k: prev[b][k] for k in HYDE_COLS})
            hc = None
        else:
            hc = hyde_curve(h, lost, years, slices)
            cc = hyde_curve(h, cur, years, slices) if len(cur) else None
        if hc:
            conv, used = hc
            row.update(hyde_q25=q_year(conv, years, 0.25), hyde_q50=q_year(conv, years, 0.5),
                       hyde_q75=q_year(conv, years, 0.75), hyde_conv_2017=round(float(conv[-1]), 3),
                       hyde_conv_1500=round(float(conv[slices.index("1500AD")]), 3),
                       hyde_used_2017=round(float(used[-1]), 3),
                       hyde_conv_cur_2017=round(float(cc[0][-1]), 3) if cc else "")
        rows.append(row)
    cols = (["binomial", "earliest_year", "latest_year", "basis", "source", "citation", "confidence", "dated_share",
             "iucn", "order", "lost_cells", "phylacine_certainty"] + HYDE_COLS + (IUCN_COLS if iucn else [])
            + ["phylacine_note"])
    with open(out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in sorted(rows, key=lambda r: r["binomial"]):
            w.writerow(r)
    # summary
    from collections import Counter
    print(Counter(r["basis"] for r in rows))
    print(Counter((r["basis"], r["confidence"]) for r in rows))


if __name__ == "__main__":
    main(*sys.argv[1:5])
