"""PhyloPic silhouettes for the species with no picture (ToLaD#577).

Its own step, after `make wiki` (`make phylopic`, `make phylopic-amniotes`): every species row of the dated tree whose
wiki.json entry has no picture gets a PhyloPic outline: its own, else its nearest ancestor's that PhyloPic has one for.
Writes the sidecar `data/<tree>/phylopic.json` and nothing else under data/<tree>; the photo always wins (a species
with one has no row).

The rule, per species (`outline`), up the dated tree (`dated/skeleton.json` `all`), nearest first:
  1. the species' own PhyloPic image;
  2. its genus's (the binomial's first word), where the genus is no named split of the tree;
  3. each split above it in turn: a named split's own PhyloPic image (PhyloPic's choice for the group); else, the first
     split with a pictured taxon under it (a species row or named split with an image of its own) gives the one nearest
     under it (least depth, then name, then image id), for the group that is the nearest named split at or above that
     split (the genus, when the pictured taxon is a congener), unless that group has an image of its own.
A taxon's image is the primary image (PhyloPic's own pick, a picture of the taxon or of one inside it) of its PhyloPic
node, matched by its Open Tree Taxonomy id (PhyloPic's `opentreeoflife.org/taxonomy` identifiers), else its PBDB taxon
number (`paleobiodb.org/txn`), else its exact scientific name among the nodes PhyloPic's Amniota images illustrate (a
name two nodes use matches neither). The ids are the tree's own: a species row's OTT_ and PBDB columns; a split's name
looked up in the Open Tree Taxonomy's Amniota cut and PBDB's lists (data/raw/amniotes/; a name two taxa use there has
no id). No name lists. Each row keeps the group (`taxon`, `rank`) and the taxon the image shows (`shows`, the image's
specific node), so the card can say "Outline of its genus, Felis (shows Felis silvestris)".

The group's rank: species and genus as above; a split's is its Open Tree Taxonomy rank, else PBDB's, when either is a
Linnaean one; else the family-group suffix the zoological code fixes (ICZN Art. 29: -oidea superfamily, -idae family,
-inae subfamily, -ini tribe; the last two only inside a family); else "clade".

PhyloPic (https://www.phylopic.org, API v2, https://api-docs.phylopic.org/v2/) is read in bulk rather than asked per
lineage: the images inside Amniota, each with the nodes it illustrates embedded (names, external identifiers, primary
image), ~132 pages of 48 (~10 minutes), where asking per lineage would be a call or more for each of the 29,499 species
with no picture. (The whole node list is 517 pages: `/nodes` takes no clade filter.) Every call passes the `build` the
API redirects to. The answer is pinned like every other source: one snapshot, `data/raw/phylopic/amniota.json` (rows
sorted, so its bytes are the content), its sha256 in pipeline/sources.lock.json. It is fetched only when missing or with
--refresh; otherwise the checksum is verified and a mismatch fails the step. Every page is kept as it comes
(`amniota.batches.jsonl` beside it), so a run cut off picks up where it stopped (a new PhyloPic build starts it
afresh). A polite User-Agent with no personal details, a pause between calls.

The sidecar is normalised (`sidecar`): each image once (its raster size, artist, contributor, licence), each species its
image id, group, rank and the taxon shown. The pictures are hotlinked, never copied, like the photos: the image's 192 px
square thumbnail on images.phylopic.org (the smallest of its thumbnail steps, 64/128/192, that covers the tree's 50 px
disc at devicePixelRatio 3: 141 device px) and, for the card, its raster 512 px wide (else the narrowest wider one, else
the widest; a tall image's is taller). images.phylopic.org sends `Access-Control-Allow-Origin: *`, so the 2D canvas the
name pills draw on can take them. The silhouettes are black on transparent; the page tints them.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import http.client
import json
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

from .fetch import sha256

API = "https://api.phylopic.org"
UA = "ToLaD-pipeline/0.1 (+https://github.com/theitush/ToLaD; species outlines, ToLaD#577)"
SNAPSHOT = "phylopic/amniota.json"
PAUSE_S = 0.3
# PhyloPic's Amniota (its node for OTT 229560); the images listed are its clade's.
AMNIOTA_OTT = 229560
THUMB = "192x192"
RASTER_W = 512

# ---- PhyloPic --------------------------------------------------------------------------------

BATCHES: Path | None = None


def _get(path: str, params: dict) -> tuple[int, dict]:
    """(HTTP status, JSON body) of one API call; a redirect is answered, not followed."""
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/vnd.phylopic.v2+json"})
    for attempt in range(6):
        try:
            with opener.open(req, timeout=60) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (307, 308, 404, 410):
                try:
                    body = json.load(e)
                except json.JSONDecodeError:
                    body = {}
                return e.code, dict(body, location=e.headers.get("Location") or "")
            if e.code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
            print(f"[phylopic] HTTP {e.code}, retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
        except (http.client.IncompleteRead, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == 5:
                raise
            print(f"[phylopic] {type(e).__name__}, retrying in {10 * (attempt + 1)}s", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    raise AssertionError


def current_build() -> int:
    status, body = _get("/", {})
    if status == 200 and "build" in body:
        return int(body["build"])
    m = re.search(r"build=(\d+)", body.get("location", ""))
    if not m:
        raise RuntimeError(f"PhyloPic: no build in {status} {body}")
    return int(m.group(1))


def _uuid(href: str | None) -> str:
    """The UUID of a `/nodes/<uuid>?build=..` / `/images/<uuid>?..` link ("" for none)."""
    if not href:
        return ""
    return href.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]


def _node(it: dict) -> list:
    """[uuid, names, OTT ids, PBDB taxon numbers, primary image uuid] of an embedded node record. `names`: its scientific names (without
    their citation), the preferred one first, "" when that is not a plain scientific name ("pan-Reptilia")."""
    names = []
    for nm in it.get("names", []):
        parts = [p for p in nm if p.get("class") != "citation"]
        plain = bool(parts) and all(p.get("class") == "scientific" for p in parts)
        txt = " ".join(p["text"] for p in parts).strip() if plain else ""
        if not names or (txt and txt not in names):
            names.append(txt)
    ott, pbdb = set(), set()
    for e in it["_links"].get("external", []):
        path = e["href"].split("?", 1)[0]
        if path.startswith("/resolve/opentreeoflife.org/taxonomy/"):
            ott.add(int(path.rsplit("/", 1)[-1]))
        elif path.startswith("/resolve/paleobiodb.org/txn/"):
            pbdb.add(int(path.rsplit("/", 1)[-1]))
    return [it["uuid"], names, sorted(ott), sorted(pbdb), _uuid((it["_links"].get("primaryImage") or {}).get("href"))]


def _raster(files: list[dict]) -> str:
    """The raster file RASTER_W wide, else the narrowest wider one, else the widest."""
    sized = sorted(((int(f["sizes"].split("x")[0]), f["href"]) for f in files if "x" in f.get("sizes", "")))
    for w, href in sized:
        if w >= RASTER_W:
            return href
    return sized[-1][1] if sized else ""


def image_row(it: dict) -> list:
    """[uuid, contributor, attribution, licence URL, thumbnail URL, raster URL, nodes] of an image record (embedded
    nodes), `nodes` the nodes it illustrates from its specific node to its general one, each as _node gives it."""
    links = it["_links"]
    thumb = next((f["href"] for f in links.get("thumbnailFiles", []) if f.get("sizes") == THUMB), "")
    emb = {n["uuid"]: _node(n) for n in it.get("_embedded", {}).get("nodes", [])}
    order = [_uuid(n["href"]) for n in links.get("nodes", [])]
    nodes = [emb[u] for u in order if u in emb] + [n for u, n in emb.items() if u not in order]
    return [it["uuid"], (links.get("contributor") or {}).get("title") or "", it.get("attribution") or "",
            (links.get("license") or {}).get("href") or "", thumb, _raster(links.get("rasterFiles", [])), nodes]


def _kept(what: str, build: int) -> dict[int, list]:
    """The pages of `what` a kept batch has for this build: page -> rows."""
    out: dict[int, list] = {}
    if BATCHES is None or not BATCHES.exists():
        return out
    with BATCHES.open(encoding="utf-8") as f:
        for line in f:
            try:
                b = json.loads(line)
            except json.JSONDecodeError:
                continue  # a line cut off mid-write: that page is asked again
            if b["what"] == what and b["build"] == build:
                out[b["page"]] = b["rows"]
    return out


def _keep(what: str, build: int, page: int, rows: list) -> None:
    if BATCHES is not None:
        BATCHES.parent.mkdir(parents=True, exist_ok=True)
        with BATCHES.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"what": what, "build": build, "page": page, "rows": rows}, ensure_ascii=False) + "\n")


def list_all(what: str, path: str, params: dict, embed: dict, row, build: int) -> list:
    """Every item of a paged list, as rows, each page kept as it comes (a rerun asks only for the pages it lacks)."""
    status, head = _get(path, {"build": build, **params})
    if status != 200:
        raise RuntimeError(f"PhyloPic {path}: {status} {head}")
    pages = int(head["totalPages"])
    kept = _kept(what, build)
    if kept:
        print(f"[phylopic] {what}: {len(kept)} of {pages} pages kept from an earlier run", file=sys.stderr)
    for p in range(pages):
        if p in kept:
            continue
        status, body = _get(path, {"build": build, **params, **embed, "page": p})
        if status == 410:
            raise RuntimeError("PhyloPic made a new build during the run: run again (it starts afresh)")
        if status != 200:
            raise RuntimeError(f"PhyloPic {path} page {p}: {status} {body}")
        kept[p] = [row(it) for it in body.get("_embedded", {}).get("items", [])]
        _keep(what, build, p, kept[p])
        if p % 20 == 0 or p == pages - 1:
            print(f"[phylopic] {what} page {p + 1}/{pages}", file=sys.stderr)
        time.sleep(PAUSE_S)
    return [r for p in sorted(kept) for r in kept[p]]


def fetch_snapshot() -> dict:
    build = current_build()
    print(f"[phylopic] build {build}", file=sys.stderr)
    status, body = _get(f"/resolve/opentreeoflife.org/taxonomy/{AMNIOTA_OTT}", {"build": build})
    root = _uuid(body.get("href") or body.get("location"))
    if status not in (307, 308) or not root:
        raise RuntimeError(f"PhyloPic has no node for Amniota (OTT {AMNIOTA_OTT}): {status} {body}")
    images = list_all("images", "/images", {"filter_clade": root}, {"embed_items": "true", "embed_nodes": "true"},
                      image_row, build)
    return {
        "api": API,
        "build": build,
        "retrieved": _dt.date.today().isoformat(),
        "root": root,
        "image_cols": ["uuid", "contributor", "attribution", "license", "thumbnail", "raster", "nodes"],
        "node_cols": ["uuid", "names", "ott", "pbdb", "primary_image"],
        "images": sorted({i[0]: i for i in images}.values()),
    }


# ---- the tree's taxa -------------------------------------------------------------------------

# The ranks a taxonomy's own word is taken for (Open Tree Taxonomy's "no rank", "clade" ... are not).
LINNAEAN = {"species", "genus", "subtribe", "tribe", "subfamily", "family", "superfamily", "parvorder", "infraorder",
            "suborder", "order", "superorder", "cohort", "infraclass", "subclass", "class", "superclass"}
# The family-group suffixes the zoological code fixes (ICZN Art. 29.2; -oidea its recommendation, Rec. 29A).
SUFFIX = (("oidea", "superfamily"), ("idae", "family"), ("inae", "subfamily"), ("ini", "tribe"))
# Coverage buckets: the ranks counted with the family (from it down to the genus).
FAMILY_GROUP = {"family", "subfamily", "tribe", "subtribe"}


def clean(name: str) -> str:
    """A split's name without a homonym note (Open Tree's "Eutheria (in Deuterostomia)")."""
    return re.sub(r"\s*\(.*\)\s*$", "", name).strip()


def suffix_rank(name: str) -> str | None:
    if " " in name or not name[:1].isupper():
        return None
    return next((rank for suf, rank in SUFFIX if name.endswith(suf)), None)


class Taxa:
    """The ids and ranks of names, from the Open Tree Taxonomy's Amniota cut and PBDB's lists (data/raw/amniotes/):
    a name used by two taxa there has no id."""

    def __init__(self, raw: Path):
        self.ott: dict[str, int | None] = {}
        self.ott_rank: dict[int, str] = {}
        self.ott_genus: dict[int, int] = {}
        p = raw / "amniotes" / "ott" / "amniota_taxonomy.tsv"
        if p.exists():
            with p.open(encoding="utf-8") as f:
                next(f)
                for line in f:
                    c = line.rstrip("\n").split("\t")
                    uid = int(c[0])
                    self.ott_rank[uid] = c[3]
                    self.ott[c[2]] = None if c[2] in self.ott else uid
                    if len(c) > 6 and c[6]:
                        self.ott_genus[uid] = int(c[6])
        self.pbdb: dict[str, int | None] = {}
        self.pbdb_rank: dict[int, str] = {}
        for f, rank in (("amniota_higher.json", None), ("amniota_genera.json", "genus"), ("amniota_species.json", "species")):
            p = raw / "amniotes" / "pbdb" / f
            if not p.exists():
                continue
            for r in json.loads(p.read_text(encoding="utf-8"))["records"]:
                name, no = r["taxon_name"], int(r["taxon_no"])
                self.pbdb[name] = None if self.pbdb.get(name, no) != no else no
                # A higher taxon's own rank: where it is the family or order its record names.
                rk = rank or ("family" if r.get("family") == name else "order" if r.get("order") == name else "")
                if rk:
                    self.pbdb_rank[no] = rk

    def rank(self, name: str, ott: int = 0, pbdb: int = 0, in_family: bool = True) -> str:
        """A name's rank: its Open Tree Taxonomy one, else PBDB's, when Linnaean; else its family-group suffix, a
        subfamily or tribe only inside a family (`in_family`: the -ini of Haplorhini or Catarrhini is no tribe's);
        else "clade"."""
        for rk in (self.ott_rank.get(ott or self.ott.get(name) or 0), self.pbdb_rank.get(pbdb or self.pbdb.get(name) or 0)):
            if rk in LINNAEAN:
                return rk
        rk = suffix_rank(name)
        return rk if rk and (in_family or rk not in ("subfamily", "tribe")) else "clade"


def _sections(b: bytes) -> dict[bytes, tuple[int, int, int]]:
    _, s = struct.unpack_from("<II", b, 8)
    return {fid: (off, ln, cnt) for fid, off, ln, cnt in (struct.unpack_from("<4sIII", b, 16 + 16 * i) for i in range(s))}


def tld_ids(path: Path) -> list[tuple[str, int, int]]:
    """(primary NAME, OTT_, PBDB) of every row of a .tld file (pipeline/FORMAT.md)."""
    b = path.read_bytes()
    n = struct.unpack_from("<I", b, 8)[0]
    sec = _sections(b)
    off = sec[b"NAME"][0]
    offs = struct.unpack_from(f"<{n + 1}I", b, off)
    blob = off + 4 * (n + 1)
    names = [b[blob + offs[j]: blob + offs[j + 1]].decode("utf-8").split("|")[0] for j in range(n)]
    col = lambda k: struct.unpack_from(f"<{n}I", b, sec[k][0]) if k in sec else (0,) * n  # noqa: E731
    return list(zip(names, col(b"OTT_"), col(b"PBDB")))


class Tree:
    """The dated tree of a dataset (dated/skeleton.json `all`): each node's parent, and its taxon where it has one: a
    species row's (name, "species", OTT_, PBDB), a named split's (name, rank, OTT id, PBDB taxon number)."""

    def __init__(self, parent: list[int], species: dict[int, tuple[str, int, int]], names: dict[int, str], taxa: Taxa):
        """`parent` per node in preorder (-1: the root); `species`: node -> (name, OTT id, PBDB taxon number);
        `names`: node -> a split's name."""
        self.parent = parent
        self.taxon: dict[int, tuple[str, str, int, int]] = {}
        self.species: dict[str, int] = {}
        fam = [False] * len(parent)  # a family-ranked split at or above (preorder: parents first)
        for i, p in enumerate(parent):
            up = fam[p] if p >= 0 else False
            if i in species:
                name, ott, pbdb = species[i]
                self.taxon[i] = (name, "species", ott, pbdb)
                self.species.setdefault(name, i)
            elif i in names:
                c = clean(names[i])
                ott, pbdb = taxa.ott.get(c) or 0, taxa.pbdb.get(c) or 0
                rank = taxa.rank(c, ott, pbdb, in_family=up)
                self.taxon[i] = (c, rank, ott, pbdb)
                up = up or rank == "family"
            fam[i] = up

    @classmethod
    def load(cls, data: Path, taxa: Taxa) -> "Tree":
        sk = json.loads((data / "dated" / "skeleton.json").read_text(encoding="utf-8"))["all"]
        rows: dict[int, list] = {}
        species = {}
        for i, nd in enumerate(sk["nodes"]):
            if len(nd) == 3:
                if nd[1] not in rows:
                    rows[nd[1]] = tld_ids(data / "skeleton.tld" if nd[1] == -1 else data / "t" / f"{nd[1]}.tld")
                species[i] = rows[nd[1]][nd[2]]
        return cls([nd[0] for nd in sk["nodes"]], species, {int(k): v for k, v in sk["names"].items()}, taxa)

    def named_above(self, i: int) -> int:
        """The nearest named split at or above node i (-1: none)."""
        while i >= 0 and (i not in self.taxon or self.taxon[i][1] == "species"):
            i = self.parent[i]
        return i


# ---- the rule --------------------------------------------------------------------------------

class PhyloPic:
    """A snapshot's images and the nodes they illustrate, the nodes indexed by OTT id, PBDB taxon number and preferred
    scientific name (one used by two nodes matches neither)."""

    def __init__(self, snap: dict):
        self.images = {i[0]: dict(zip(snap["image_cols"], i)) for i in snap["images"]}
        nodes: dict[str, list] = {}
        for im in self.images.values():
            for nd in im["nodes"]:
                nodes.setdefault(nd[0], nd)
        self.ott: dict[int, str] = {}
        self.pbdb: dict[int, str] = {}
        by_name: dict[str, set[str]] = {}
        self.primary: dict[str, str] = {}
        for uuid in sorted(nodes):  # the first node (by uuid) with an id keeps it
            _, nms, otts, pbdbs, img = nodes[uuid]
            for o in otts:
                self.ott.setdefault(o, uuid)
            for p in pbdbs:
                self.pbdb.setdefault(p, uuid)
            if nms and nms[0]:
                by_name.setdefault(nms[0], set()).add(uuid)
            if img in self.images and self.images[img]["thumbnail"]:
                self.primary[uuid] = img
        self.name = {nm: next(iter(u)) for nm, u in by_name.items() if len(u) == 1}

    def image(self, name: str, ott: int = 0, pbdb: int = 0) -> str | None:
        """The primary image of the taxon's node (by its OTT id, else its PBDB taxon number, else its exact name)."""
        node = (ott and self.ott.get(ott)) or (pbdb and self.pbdb.get(pbdb)) or self.name.get(name)
        return self.primary.get(node) if node else None

    def shows(self, img: str) -> str:
        """The taxon an image shows: its specific node's scientific name."""
        nds = self.images[img]["nodes"]
        return next((n for n in (nds[0][1] if nds else []) if n), "")


def pictured(tree: Tree, pp: PhyloPic) -> dict[int, tuple[int, str, str]]:
    """Per node of the tree, the pictured taxon nearest under it (a species row or named split whose PhyloPic node has
    an image): (depth below it, its name, image uuid), the least of these; absent where none is."""
    best: dict[int, tuple[int, str, str]] = {}
    for i, t in tree.taxon.items():
        if (img := pp.image(t[0], t[2], t[3])):
            best[i] = (0, t[0], img)
    for i in range(len(tree.parent) - 1, -1, -1):  # preorder reversed: every child before its parent
        p = tree.parent[i]
        if i in best and p >= 0:
            d, nm, img = best[i]
            if p not in best or (d + 1, nm, img) < best[p]:
                best[p] = (d + 1, nm, img)
    return best


def outline(i: int, tree: Tree, pp: PhyloPic, best: dict[int, tuple[int, str, str]], taxa: Taxa) -> dict | None:
    """The outline for species row i (the module docstring), or None: the image, the group it stands for (`taxon`,
    `rank`) and the taxon it shows."""
    name, _, ott, pbdb = tree.taxon[i]
    if (img := pp.image(name, ott, pbdb)):
        return _row(img, name, "species", pp)
    genus = name.split()[0] if " " in name else ""
    j = tree.parent[i]
    if genus and tree.named_above(j) >= 0 and tree.taxon[tree.named_above(j)][0] == genus:
        genus = ""  # the genus is a named split: the walk below meets it
    if genus:
        g_ott = taxa.ott_genus.get(ott) or 0
        if taxa.ott_rank.get(g_ott) != "genus" or taxa.ott.get(genus, g_ott) != g_ott:
            g_ott = taxa.ott.get(genus) or 0
        if (img := pp.image(genus, g_ott, taxa.pbdb.get(genus) or 0)):
            return _row(img, genus, "genus", pp)
    while j >= 0:
        if j in tree.taxon and (img := pp.image(tree.taxon[j][0], tree.taxon[j][2], tree.taxon[j][3])):
            return _row(img, tree.taxon[j][0], tree.taxon[j][1], pp)
        if j in best:
            _, shown, img = best[j]
            if genus and shown.split()[0] == genus:
                return _row(img, genus, "genus", pp)
            a = tree.named_above(j)
            if a < 0:
                return None
            t = tree.taxon[a]
            return _row(pp.image(t[0], t[2], t[3]) or img, t[0], t[1], pp)
        j = tree.parent[j]
    return None


def outlines(tree: Tree, wiki: dict, pp: PhyloPic, taxa: Taxa) -> dict[str, dict]:
    """The sidecar's rows: an outline for each species row with no picture in `wiki` (the photo always wins)."""
    best = pictured(tree, pp)
    bare = sorted(n for n in tree.species if not (wiki.get(n) or {}).get("img"))
    return {n: o for n in bare if (o := outline(tree.species[n], tree, pp, best, taxa))}


def _row(img: str, taxon: str, rank: str, pp: PhyloPic) -> dict:
    im = pp.images[img]
    return {"img": im["thumbnail"], "big": im["raster"] or im["thumbnail"], "taxon": taxon, "rank": rank,
            "shows": pp.shows(img), "contributor": im["contributor"], "attribution": im["attribution"],
            "license": license_name(im["license"]), "licenseUrl": im["license"], "image": img}


def license_name(url: str) -> str:
    """A Creative Commons licence URL's short name: "CC BY-SA 3.0", "CC0 1.0", "Public Domain Mark 1.0"."""
    m = re.search(r"creativecommons\.org/(licenses|publicdomain)/([a-z-]+)/([\d.]+)", url)
    if not m:
        return url
    kind, code, ver = m.groups()
    if kind == "publicdomain":
        return f"CC0 {ver}" if code == "zero" else f"Public Domain Mark {ver}"
    return f"CC {code.upper()} {ver}"


def bucket(rank: str) -> str:
    return "species" if rank == "species" else "genus" if rank == "genus" else "family" if rank in FAMILY_GROUP else "higher"


IMG = "https://images.phylopic.org/images/"
THUMB_RE = re.compile(re.escape(IMG) + r"([^/]+)/thumbnail/" + THUMB + r"\.png")
RASTER_RE = re.compile(re.escape(IMG) + r"([^/]+)/raster/(\d+x\d+)\.png")


def sidecar(out: dict[str, dict]) -> dict:
    """The sidecar, normalised: `images`, one entry per image id, {r: its raster's size (the URLs are rebuilt from the
    id: IMG + id + "/thumbnail/192x192.png" and "/raster/" + r + ".png"), a: attribution, c: contributor, l: licence,
    u: licence URL}; `species`, name -> [image id, group, its rank, the taxon the image shows]."""
    images: dict[str, dict] = {}
    for o in out.values():
        t, r = THUMB_RE.fullmatch(o["img"]), RASTER_RE.fullmatch(o["big"])
        if not (t and r and t.group(1) == r.group(1) == o["image"]):
            raise ValueError(f"PhyloPic URLs off their pattern: {o['img']} {o['big']}")
        images[o["image"]] = {"r": r.group(2), "a": o["attribution"], "c": o["contributor"], "l": o["license"],
                              "u": o["licenseUrl"]}
    return {"images": images, "species": {n: [o["image"], o["taxon"], o["rank"], o["shows"]] for n, o in out.items()}}


def write_sidecar(out: dict[str, dict], path: Path) -> None:
    """sidecar(out), one image and one species per line, sorted, so diffs stay readable."""
    sc = sidecar(out)
    parts = []
    for key in ("images", "species"):
        lines = [f"{json.dumps(k, ensure_ascii=False)}:{json.dumps(v, ensure_ascii=False, sort_keys=True)}"
                 for k, v in sorted(sc[key].items())]
        parts.append(f'"{key}":{{\n' + ",\n".join(lines) + "\n}")
    path.write_text("{\n" + ",\n".join(parts) + "\n}\n", encoding="utf-8")


def snapshot(path: Path, lock_path: Path, refresh: bool = False) -> dict | None:
    """The pinned snapshot: fetched when missing (or `refresh`) and its sha256 written to the lock, else verified
    against it (None on a mismatch)."""
    lock = json.loads(lock_path.read_text())
    if refresh or not path.exists():
        snap = fetch_snapshot()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(snap, ensure_ascii=False, indent=0, sort_keys=True) + "\n", encoding="utf-8")
        lock[SNAPSHOT] = {"url": f"{API}/images?build={snap['build']}&filter_clade={snap['root']}&embed_items=true&embed_nodes=true",
                          "sha256": sha256(path), "bytes": path.stat().st_size, "retrieved": snap["retrieved"]}
        lock_path.write_text(json.dumps(lock, indent=1, sort_keys=True) + "\n")
        print(f"[lock] {SNAPSHOT} {lock[SNAPSHOT]['sha256'][:16]}", file=sys.stderr)
        return snap
    rec, digest = lock.get(SNAPSHOT), sha256(path)
    if rec is None or rec["sha256"] != digest:
        print(f"[MISMATCH] {SNAPSHOT}: got {digest[:16]} (use --refresh to re-pin)", file=sys.stderr)
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    global BATCHES
    root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tree", choices=["mammals", "amniotes"], default="mammals")
    ap.add_argument("--raw", type=Path, default=root / "data" / "raw")
    ap.add_argument("--data", type=Path, help="the built dataset (default data/<tree>)")
    ap.add_argument("--lock", type=Path, default=root / "pipeline" / "sources.lock.json")
    ap.add_argument("--refresh", action="store_true", help="ask PhyloPic again and re-pin the snapshot")
    a = ap.parse_args(argv)

    data = a.data or root / "data" / a.tree
    snap_path = a.raw / SNAPSHOT
    BATCHES = snap_path.with_suffix(".batches.jsonl")
    if a.refresh and BATCHES.exists():
        BATCHES.unlink()
    snap = snapshot(snap_path, a.lock, a.refresh)
    if snap is None:
        return 1
    pp = PhyloPic(snap)
    wiki = json.loads((data / "wiki.json").read_text(encoding="utf-8"))
    taxa = Taxa(a.raw)
    tree = Tree.load(data, taxa)
    out = outlines(tree, wiki, pp, taxa)
    bare = [n for n in tree.species if not (wiki.get(n) or {}).get("img")]
    write_sidecar(out, data / "phylopic.json")
    by = Counter(bucket(o["rank"]) for o in out.values())
    n = len(bare) or 1
    print(f"[phylopic] {len(tree.species)} species, {len(bare)} with no picture: an outline for {len(out)} ({100 * len(out) / n:.0f}%): "
          + ", ".join(f"{k} {by[k]} ({100 * by[k] / n:.0f}%)" for k in ("species", "genus", "family", "higher")), file=sys.stderr)
    print(f"[phylopic] by rank: {dict(Counter(o['rank'] for o in out.values()).most_common())}", file=sys.stderr)
    print(f"[phylopic] {len({o['image'] for o in out.values()})} images", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
