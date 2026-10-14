"""Wikipedia link and Wikimedia Commons picture per species (ToLaD#182).

Its own step, apart from the main build (`make wiki`): reads the species rows of the dated tree
from the built data (data/mammals/dated/*.json + the .tld NAME and OTT_ sections), resolves each
on Wikidata, and writes the sidecar `data/mammals/wiki.json`. Nothing else under data/mammals is
touched.

Resolution, per species (the Wikidata Query Service, batched SPARQL, polite User-Agent, a pause
between batches):
  1. its name as a taxon name (P225);
  2. a miss: its Open Tree Taxonomy id (P9157), then its OTT synonyms as taxon names (P225).
Several items with one name (homonyms, duplicates): the one ranked species whose parent taxon is
the name's genus, then the one with an English article, then a picture, then the lowest Q number.

The query results are pinned like every other source: one snapshot, `data/raw/wikidata/taxa.json`
(rows sorted, so its bytes are the content), its sha256 in pipeline/sources.lock.json. It is
fetched only when missing or with --refresh; otherwise the checksum is verified and a mismatch
fails the step.

The pictures are hotlinked, never copied (Ita, 2026-10-12): the sidecar holds URLs only.
`img` is the upload.wikimedia.org thumbnail path at 330 px (a standard thumbnail step), built
from the file name's MD5 like MediaWiki does. Not Special:FilePath?width=: that answers with a
redirect from commons.wikimedia.org first (one more round trip per picture), and the 2D canvas
the name pills draw on needs the CORS headers upload.wikimedia.org sends on the image itself.

`range` (ToLaD#196) is the species' range map, Wikidata P181 (taxon range map image), as the
same kind of thumbnail at 500 px, with `rangeFile` its Commons file page for the credit. 500 px
is a standard thumbnail step that reads well across the card (~350 CSS px) on a phone; the tap
to enlarge asks for the 960 px step like the photo. Most maps are SVGs: upload.wikimedia.org
renders those as PNG (`500px-X.svg.png`), so an SVG is taken like any other file; with several
values, the first in sorted order.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import http.client
import json
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .fetch import sha256
from .load import load_ott

ENDPOINT = "https://query.wikidata.org/sparql"
UA = "ToLaD-pipeline/0.1 (+https://github.com/theitush/ToLaD; species links, ToLaD#182)"
SNAPSHOT = "wikidata/taxa.json"
BATCH = 150
PAUSE_S = 1.5
THUMB_W = 330
RANGE_W = 500
SPECIES_Q = "Q7432"

# By hand (ToLaD#275): (English article, Commons file) for a species whose Wikidata picture is no photo, or that
# the pinned snapshot predates. Homo sapiens's P18 is Human.svg, a dark silhouette; its stand-in is the photo the
# Human article long led with (an Akha couple, northern Thailand; CC BY-SA 2.0 de, Weltenbummler84). The three
# hominins joined the dated tree after the snapshot; their files are their Wikidata items' P18 (2026-10-14).
HAND = {
    "Homo sapiens": ("https://en.wikipedia.org/wiki/Human", "Akha cropped hires.JPG"),
    "Homo floresiensis": ("https://en.wikipedia.org/wiki/Homo_floresiensis", "Homo Florensiensis-MGL 95216-P5030051-white.jpg"),
    "Homo naledi": ("https://en.wikipedia.org/wiki/Homo_naledi", "Homo naledi skeletal specimens.jpg"),
    "Kenyanthropus platyops": ("https://en.wikipedia.org/wiki/Kenyanthropus_platyops",
                               "Kenyanthropus platyops, skull (model).JPG"),
    # Denisovans (ToLaD#280): a leaf the build adds (overrides.toml [[fossil_leaf]]); the Denisovan article's lead
    # picture, the Harbin cranium (CC BY 4.0, Fu et al. 2025)
    "Homo longi": ("https://en.wikipedia.org/wiki/Denisovan", "Homo longi holotype.jpg"),
}
ITEM = re.compile(r"http://www\.wikidata\.org/entity/Q\d+")

# One row per (key, item, rank, parent name, article, image, range map). `?key` is what was asked:
# a taxon name (P225) or an OTT id (P9157). The range map is P181 (taxon range map image, ToLaD#196).
QUERY = """SELECT ?key ?item ?rank ?pname ?article ?img ?range WHERE {{
  VALUES ?key {{ {values} }}
  ?item wdt:{prop} ?key .
  OPTIONAL {{ ?item wdt:P105 ?rank }}
  OPTIONAL {{ ?item wdt:P171/wdt:P225 ?pname }}
  OPTIONAL {{ ?item wdt:P18 ?img }}
  OPTIONAL {{ ?item wdt:P181 ?range }}
  OPTIONAL {{ ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }}
}}"""

# An item with no English article: the items it names, or that name it, as a taxon synonym (P1420),
# e.g. Catopuma temminckii's item has none and Pardofelis temminckii's ("Asian golden cat") has.
LINK_QUERY = """SELECT ?key ?item ?rank ?pname ?article ?img ?range WHERE {{
  VALUES ?q {{ {values} }}
  {{ ?item wdt:P1420 ?q }} UNION {{ ?q wdt:P1420 ?item }}
  BIND(STR(?q) AS ?key)
  OPTIONAL {{ ?item wdt:P105 ?rank }}
  OPTIONAL {{ ?item wdt:P171/wdt:P225 ?pname }}
  OPTIONAL {{ ?item wdt:P18 ?img }}
  OPTIONAL {{ ?item wdt:P181 ?range }}
  OPTIONAL {{ ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }}
}}"""

# ---- species rows of the built data ---------------------------------------------------------

def _sections(b: bytes) -> dict[bytes, tuple[int, int, int]]:
    n, s = struct.unpack_from("<II", b, 8)
    out = {}
    for i in range(s):
        fid, off, ln, cnt = struct.unpack_from("<4sIII", b, 16 + 16 * i)
        out[fid] = (off, ln, cnt)
    return out


def tld_rows(path: Path) -> list[tuple[str, int]]:
    """(NAME, OTT_) of every row of a .tld file (pipeline/FORMAT.md, Container and Sections)."""
    b = path.read_bytes()
    assert b[:4] == b"TLAD", path
    n = struct.unpack_from("<I", b, 8)[0]
    sec = _sections(b)
    off = sec[b"NAME"][0]
    offs = struct.unpack_from(f"<{n + 1}I", b, off)
    blob = off + 4 * (n + 1)
    names = [b[blob + offs[j]: blob + offs[j + 1]].decode("utf-8") for j in range(n)]
    ott = struct.unpack_from(f"<{n}I", b, sec[b"OTT_"][0]) if b"OTT_" in sec else (0,) * n
    return list(zip(names, ott))


def species_rows(mammals: Path) -> dict[str, int]:
    """Every species row of the dated tree (living, and fossils with dates): name -> OTT id (0: none)."""
    out: dict[str, int] = {}
    for f in sorted((mammals / "dated").glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        t = d["tile"]
        rows = tld_rows(mammals / "skeleton.tld" if t == -1 else mammals / "t" / f"{t}.tld")
        for nd in d.get("nodes", []):
            if len(nd) == 2:
                name, ott = rows[nd[1]]
                out.setdefault(name.split("|")[0], ott)
    return out


# ---- Wikidata ------------------------------------------------------------------------------

def _literal(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _sparql(query: str) -> list[list[str]]:
    data = urllib.parse.urlencode({"query": query}).encode()
    req = urllib.request.Request(ENDPOINT, data=data, headers={
        "User-Agent": UA, "Accept": "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                res = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
            print(f"[wiki] HTTP {e.code}, retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
        except (http.client.IncompleteRead, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            # The query service cuts a query off at 60 s, sometimes mid-stream.
            if attempt == 5:
                raise
            print(f"[wiki] {type(e).__name__}, retrying in {10 * (attempt + 1)}s", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    cols = ["key", "item", "rank", "pname", "article", "img", "range"]
    return [[b.get(c, {}).get("value", "") for c in cols] for b in res["results"]["bindings"]]


def query_all(prop: str, keys: list[str]) -> list[list[str]]:
    rows: list[list[str]] = []
    for i in range(0, len(keys), BATCH):
        chunk = keys[i: i + BATCH]
        if prop == "P1420":
            q = LINK_QUERY.format(values=" ".join("wd:" + k.rsplit("/", 1)[-1] for k in chunk))
        else:
            q = QUERY.format(values=" ".join(_literal(k) for k in chunk), prop=prop)
        rows += _sparql(q)
        print(f"[wiki] {prop} {i + len(chunk)}/{len(keys)}: {len(rows)} rows", file=sys.stderr)
        time.sleep(PAUSE_S)
    return rows


def fetch_snapshot(species: dict[str, int], raw: Path) -> dict:
    by_name = query_all("P225", sorted(species))
    found = {r[0] for r in by_name}
    miss = sorted(n for n in species if n not in found)
    ott_ids = sorted({str(species[n]) for n in miss if species[n]})
    by_ott = query_all("P9157", ott_ids) if ott_ids else []
    found_ott = {r[0] for r in by_ott}
    still = [n for n in miss if str(species[n]) not in found_ott]
    syn = synonyms({species[n] for n in still if species[n]}, raw)
    syn_names = sorted({s for n in still for s in syn.get(species[n], []) if s not in species})
    by_syn = query_all("P225", syn_names) if syn_names else []
    with_article = {r[1] for r in by_name + by_ott + by_syn if r[4]}
    bare = sorted({r[1] for r in by_name + by_ott + by_syn if ITEM.fullmatch(r[1])} - with_article)
    by_link = query_all("P1420", bare) if bare else []
    return {
        "endpoint": ENDPOINT,
        "query": QUERY,
        "retrieved": _dt.date.today().isoformat(),
        "names": sorted(by_name),
        "ott": sorted(by_ott),
        "synonyms": sorted(by_syn),
        "link_query": LINK_QUERY,
        "linked": sorted(by_link),
    }


def synonyms(ids: set[int], raw: Path) -> dict[int, list[str]]:
    """OTT synonyms (binomials only) of the given ids."""
    if not ids or not (raw / "ott" / "synonyms.tsv").exists():
        return {}
    _, syn = load_ott(raw, ids)
    return {u: sorted({s for s in names if len(s.split()) == 2}) for u, names in syn.items()}


# ---- the sidecar ----------------------------------------------------------------------------

def thumb_url(file: str, width: int = THUMB_W) -> str | None:
    """upload.wikimedia.org thumbnail of a Commons file (MediaWiki's hashed path)."""
    name = file.replace(" ", "_")
    ext = name.rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "gif", "svg", "tif", "tiff", "webp"):
        return None
    md5 = hashlib.md5(name.encode("utf-8")).hexdigest()
    q = urllib.parse.quote(name)
    thumb = f"{width}px-{q}"
    if ext == "svg":
        thumb += ".png"
    elif ext in ("tif", "tiff"):
        thumb = f"lossy-page1-{thumb}.jpg"
    return f"https://upload.wikimedia.org/wikipedia/commons/thumb/{md5[0]}/{md5[:2]}/{q}/{thumb}"


def _pick(rows: list[list[str]], genus: str) -> list[str] | None:
    """The best item among one key's rows (see the module docstring), merged over its duplicates."""
    items: dict[str, dict] = {}
    for r in rows:
        key, item, rank, pname, article, img = r[:6]
        rng = r[6] if len(r) > 6 else ""
        if not ITEM.fullmatch(item):
            continue  # a lexeme sense or the like, not an item
        it = items.setdefault(item, {"species": False, "genus": False, "article": "", "img": "", "range": ""})
        it["species"] |= rank.endswith("/" + SPECIES_Q)
        it["genus"] |= pname == genus
        it["article"] = it["article"] or article
        # Several values: the first in sorted order, so the pick is deterministic.
        it["img"] = min(filter(None, [it["img"], img]), default="")
        it["range"] = min(filter(None, [it["range"], rng]), default="")
    if not items:
        return None

    def score(kv):
        q, it = kv
        return (-(it["species"] and it["genus"]), -it["species"], -bool(it["article"]), -bool(it["img"]),
                int(q.rsplit("Q", 1)[-1] or 0))
    q, it = min(items.items(), key=score)
    return [q, it["article"], it["img"], it["range"]]


def resolve(species: dict[str, int], snap: dict, raw: Path) -> dict[str, dict | None]:
    def group(rows):
        g: dict[str, list] = {}
        for r in rows:
            g.setdefault(r[0], []).append(r)
        return g
    by_name, by_ott, by_syn = group(snap["names"]), group(snap["ott"]), group(snap["synonyms"])
    by_link = group(snap.get("linked", []))
    syn: dict[int, list[str]] = {}
    out: dict[str, dict | None] = {}
    for name in sorted(species):
        genus = name.split()[0]
        hit = _pick(by_name.get(name, []), genus)
        if hit is None and species[name]:
            hit = _pick(by_ott.get(str(species[name]), []), genus)
        if hit is None and species[name] and by_syn:
            if not syn:
                need = {species[n] for n in species if n not in by_name and species[n]}
                syn = synonyms(need, raw)
            for s in syn.get(species[name], []):
                hit = _pick(by_syn.get(s, []), s.split()[0])
                if hit:
                    break
        if hit is not None and not hit[1]:
            # No English article on the item: one its taxon-synonym links have (species first).
            alt = _pick([r for r in by_link.get(hit[0], []) if r[4]], genus)
            if alt:
                hit = [hit[0], alt[1], hit[2] or alt[2], hit[3] or alt[3]]
        out[name] = entry(hit)
    return out


def _commons(value: str, width: int) -> tuple[str, str] | None:
    """(thumbnail URL, Commons file page) of a Wikidata Commons-media value (a Special:FilePath URL)."""
    file = urllib.parse.unquote(value.rsplit("/Special:FilePath/", 1)[-1])
    t = thumb_url(file, width)
    if not t:
        return None
    return t, "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(file.replace(" ", "_"))


def entry(hit: list[str] | None) -> dict | None:
    if hit is None:
        return None
    _, article, img = hit[:3]
    rng = hit[3] if len(hit) > 3 else ""
    e: dict[str, str] = {}
    if article:
        e["wp"] = article
    if img and (c := _commons(img, THUMB_W)):
        e["img"], e["file"] = c
    if rng and (c := _commons(rng, RANGE_W)):
        e["range"], e["rangeFile"] = c
    return e or None


def write_sidecar(out: dict[str, dict | None], path: Path) -> None:
    """One species per line, sorted, so diffs stay readable."""
    lines = [f"{json.dumps(k, ensure_ascii=False)}:{json.dumps(v, ensure_ascii=False, sort_keys=True)}"
             for k, v in sorted(out.items())]
    path.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")


def rates(out: dict[str, dict | None], names: set[str]) -> str:
    n = len(names) or 1
    wp = sum(1 for k in names if (out.get(k) or {}).get("wp"))
    img = sum(1 for k in names if (out.get(k) or {}).get("img"))
    rng = sum(1 for k in names if (out.get(k) or {}).get("range"))
    return (f"{len(names)} species: wikipedia {wp} ({100 * wp / n:.0f}%), picture {img} ({100 * img / n:.0f}%), "
            f"range map {rng} ({100 * rng / n:.0f}%)")


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, default=root / "data" / "raw")
    ap.add_argument("--mammals", type=Path, default=root / "data" / "mammals")
    ap.add_argument("--lock", type=Path, default=root / "pipeline" / "sources.lock.json")
    ap.add_argument("--refresh", action="store_true", help="query Wikidata again and re-pin the snapshot")
    a = ap.parse_args(argv)

    species = species_rows(a.mammals)
    snap_path = a.raw / SNAPSHOT
    lock = json.loads(a.lock.read_text())
    if a.refresh or not snap_path.exists():
        snap = fetch_snapshot(species, a.raw)
        snap_path.parent.mkdir(parents=True, exist_ok=True)
        snap_path.write_text(json.dumps(snap, ensure_ascii=False, indent=0, sort_keys=True) + "\n", encoding="utf-8")
        lock[SNAPSHOT] = {"url": ENDPOINT, "post_body": {"query": "see the snapshot's `query`, keys: the dated tree's species"},
                          "sha256": sha256(snap_path), "bytes": snap_path.stat().st_size, "retrieved": snap["retrieved"]}
        a.lock.write_text(json.dumps(lock, indent=1, sort_keys=True) + "\n")
        print(f"[lock] {SNAPSHOT} {lock[SNAPSHOT]['sha256'][:16]}", file=sys.stderr)
    else:
        rec = lock.get(SNAPSHOT)
        digest = sha256(snap_path)
        if rec is None or rec["sha256"] != digest:
            print(f"[MISMATCH] {SNAPSHOT}: got {digest[:16]} (use --refresh to re-pin)", file=sys.stderr)
            return 1
        snap = json.loads(snap_path.read_text(encoding="utf-8"))
    out = resolve(species, snap, a.raw)
    for name, (article, photo) in HAND.items():
        if name in out:
            e = dict(out[name] or {}, wp=article)
            e["img"], e["file"] = _commons("/Special:FilePath/" + photo, THUMB_W)
            out[name] = e
    write_sidecar(out, a.mammals / "wiki.json")
    print(f"[wiki] all {rates(out, set(out))}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
