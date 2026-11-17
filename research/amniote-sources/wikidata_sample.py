"""Wikidata coverage of names and pictures for a random sample of 200 birds (Clements 2025) and 200 reptiles
(Reptile Database Oct 2026), the way pipeline/tolad_pipeline/wiki.py asks: the name as a taxon name (P225),
batched SPARQL, a polite User-Agent, a pause between batches (ToLaD#519). Only wiki.py's step 1 is asked; its
later steps (OTT id, aliases, the taxobox image of the English article) would only add hits.

Counted per species: an item; a picture (P18); an English common name (P1843 in English, or an English label
that differs from the scientific name); an English Wikipedia article.

Run: uv run --project pipeline python research/amniote-sources/wikidata_sample.py
"""
import csv
import json
import random
import sys
import time
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
import urllib.parse  # noqa: E402
import urllib.request  # noqa: E402

from tolad_pipeline.wiki import ENDPOINT, UA, _literal  # noqa: E402


def _sparql(query):
    data = urllib.parse.urlencode({"query": query}).encode()
    req = urllib.request.Request(ENDPOINT, data=data, headers={
        "User-Agent": UA, "Accept": "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.load(r)
    cols = ["key", "item", "img", "cn", "label", "article"]
    return [[b.get(c, {}).get("value", "") for c in cols] for b in res["results"]["bindings"]]

A = ROOT / "data" / "raw" / "amniotes"
Q = """SELECT ?key ?item ?img ?cn ?label ?article WHERE {{
  VALUES ?key {{ {values} }}
  ?item wdt:P225 ?key .
  OPTIONAL {{ ?item wdt:P18 ?img }}
  OPTIONAL {{ ?item wdt:P1843 ?cn . FILTER(LANG(?cn) = "en") }}
  OPTIONAL {{ ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }}
  OPTIONAL {{ ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }}
}}"""

birds = sorted(r.get("sci_name_2025") or r["SCI_NAME"] for r in csv.DictReader(open(A / "avesdata" / "OTT_crosswalk_2025.csv"))
               if r["CATEGORY"] == "species")
rept = sorted(r[1].strip() for r in openpyxl.load_workbook(A / "reptiledb" / "reptile_checklist_2026_10.xlsx", read_only=True)
              .worksheets[0].iter_rows(min_row=2, values_only=True) if r[1])
rng = random.Random(519)
out = {}
for label, pool in (("birds", birds), ("reptiles", rept)):
    sample = rng.sample(pool, 200)
    hits = {}
    for i in range(0, len(sample), 50):
        chunk = sample[i:i + 50]
        rows = _sparql(Q.format(values=" ".join(_literal(s) for s in chunk)))
        for row in rows:
            key, item, img, cn, lab, art = (row + [""] * 6)[:6]
            h = hits.setdefault(key, {"item": True, "img": False, "name": False, "article": False})
            h["img"] |= bool(img)
            h["name"] |= bool(cn) or (bool(lab) and lab.strip().lower() != key.lower())
            h["article"] |= bool(art)
        time.sleep(2)
    out[label] = {"sample": len(sample), "item": len(hits),
                  "picture_P18": sum(h["img"] for h in hits.values()),
                  "english_common_name": sum(h["name"] for h in hits.values()),
                  "english_article": sum(h["article"] for h in hits.values())}
print(json.dumps(out, indent=1))
