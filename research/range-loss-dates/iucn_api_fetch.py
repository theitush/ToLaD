"""Fetch the IUCN Red List assessments of the 682 species, for Ita to run with his own token (ToLaD#515).

Not run by the worker: the API needs a personal token (free account at
https://api.iucnredlist.org/users/sign_up). Each species takes two small JSON calls; with a 0.5 s pause
the 682 take about 12 minutes. Resumable: a species already saved is skipped, so just run it again.

    export IUCN_REDLIST_KEY=...      # from https://api.iucnredlist.org/users/edit
    python3 research/range-loss-dates/iucn_api_fetch.py research/range-loss-dates.csv data/raw/redlist/api/

What it is for: each assessment's country list says where the species is "Extinct Post-1500" or
"Possibly Extinct", and its range and threats text often names when it was lost ("extirpated from X in
the 1930s"). The field names are as the v4 docs describe them (taxa/scientific_name, then
assessment/{id}); the docs refuse a scripted read without a token, so check the first saved file.
"""
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.iucnredlist.org/api/v4"


def get(path, token):
    req = urllib.request.Request(API + path, headers={"Authorization": token, "accept": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - retry anything, then give up on this species
            if attempt == 4:
                raise
            time.sleep(5 * (attempt + 1))
            print("retry", path, e, file=sys.stderr)


def main(species_csv, out_dir):
    token = os.environ["IUCN_REDLIST_KEY"]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    names = [r["binomial"] for r in csv.DictReader(open(species_csv))]
    for i, b in enumerate(names):
        f = out / (b.replace(" ", "_") + ".json")
        if f.exists():
            continue
        g, s = b.split(" ", 1)
        taxon = get("/taxa/scientific_name?" + urllib.parse.urlencode({"genus_name": g, "species_name": s}), token)
        latest = [a for a in taxon.get("assessments", []) if a.get("latest") and "Global" in json.dumps(a.get("scopes"))]
        latest = latest or [a for a in taxon.get("assessments", []) if a.get("latest")]
        rec = {"taxon": taxon}
        if latest:
            time.sleep(0.5)
            rec["assessment"] = get(f"/assessment/{latest[0]['assessment_id']}", token)
        f.write_text(json.dumps(rec))
        print(i + 1, "/", len(names), b, flush=True)
        time.sleep(0.5)


if __name__ == "__main__":
    main(*sys.argv[1:3])
