"""Manual overrides (pipeline/overrides.toml): exclusions, fossil dates, placements, domestic leaves.

The file is versioned and every entry carries a reason and a citation. The
build records each applied entry in stats.json -> overrides and fails if an
entry no longer matches anything, so stale overrides cannot linger silently.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "overrides.toml"


@dataclass
class Overrides:
    version: int
    exclude: dict[str, dict] = field(default_factory=dict)
    dates: dict[str, dict] = field(default_factory=dict)
    placements: list[dict] = field(default_factory=list)
    # the dated tree's hand values (ToLaD#145, tolad_pipeline/dated.py)
    dated_clades: list[dict] = field(default_factory=list)
    dated_fossils: list[dict] = field(default_factory=list)
    dated_names: list[dict] = field(default_factory=list)
    # domestic forms no species list carries as a species (ToLaD#175): a leaf of their own
    domestic_leaves: list[dict] = field(default_factory=list)
    # extinct species no fossil database carries (Denisovans, ToLaD#280): a leaf of their own
    fossil_leaves: list[dict] = field(default_factory=list)
    # cited census sizes for fossil species (hominins, ToLaD#302): they replace the allometric model's count
    fossil_counts: dict[str, dict] = field(default_factory=dict)
    applied: dict[str, list] = field(default_factory=lambda: {"exclude": [], "date": [], "placement": [],
                                                              "dated_clade": [], "dated_fossil": [],
                                                              "dated_name": [], "domestic_leaf": [],
                                                              "fossil_leaf": [], "fossil_count": []})

    def check_all_used(self, dated: bool = False) -> None:
        """Every entry matched something; `dated` checks the dated tree's sections (applied later)."""
        if dated:
            unused = ([f"dated_clade {e['name']}" for e in self.dated_clades
                       if e["name"] not in {a["name"] for a in self.applied["dated_clade"]}]
                      + [f"dated_fossil {e['name']}" for e in self.dated_fossils
                         if e["name"] not in {a["name"] for a in self.applied["dated_fossil"]}]
                      + [f"dated_name {e['name']}" for e in self.dated_names
                         if e["name"] not in {a["name"] for a in self.applied["dated_name"]}]
                      + [f"domestic_leaf {e['name']} (dated)" for e in self.domestic_leaves
                         if e["name"] not in {a["name"] for a in self.applied["dated_fossil"]}])
            if unused:
                raise RuntimeError(f"overrides.toml entries matched nothing: {unused}")
            return
        unused = ([f"exclude {k}" for k in self.exclude if k not in self.applied["exclude"]]
                  + [f"date {k}" for k in self.dates if k not in {a["name"] for a in self.applied["date"]}]
                  + [f"placement {p['name']}" for p in self.placements
                     if p["name"] not in {a["name"] for a in self.applied["placement"]}]
                  + [f"domestic_leaf {e['name']}" for e in self.domestic_leaves
                     if e["name"] not in {a["name"] for a in self.applied["domestic_leaf"]}]
                  + [f"fossil_leaf {e['name']}" for e in self.fossil_leaves
                     if e["name"] not in {a["name"] for a in self.applied["fossil_leaf"]}])
        if unused:
            raise RuntimeError(f"overrides.toml entries matched nothing: {unused}")

    def report(self) -> dict:
        return {"file": "pipeline/overrides.toml", "version": self.version, **self.applied}


def load(path: Path = PATH) -> Overrides:
    d = tomllib.loads(path.read_text(encoding="utf-8"))
    for sec in ("exclude", "date", "placement", "dated_clade", "dated_fossil", "dated_name", "domestic_leaf",
                "fossil_leaf", "fossil_count"):
        for e in d.get(sec, []):
            if not e.get("reason") or not e.get("citation"):
                raise RuntimeError(f"overrides.toml [{sec}] {e.get('name')}: reason and citation are required")
    return Overrides(
        version=int(d["version"]),
        exclude={e["name"]: e for e in d.get("exclude", [])},
        dates={e["name"]: e for e in d.get("date", [])},
        placements=list(d.get("placement", [])),
        dated_clades=list(d.get("dated_clade", [])),
        dated_fossils=list(d.get("dated_fossil", [])),
        dated_names=list(d.get("dated_name", [])),
        domestic_leaves=list(d.get("domestic_leaf", [])),
        fossil_leaves=list(d.get("fossil_leaf", [])),
        fossil_counts={e["name"]: check_count(e) for e in d.get("fossil_count", [])},
    )


# census: a published census-size estimate; ne-ratio: a genetic effective size (Ne) times a census/Ne
# ratio; density-area: a population density times an area, both cited; analog: no figure exists for the
# species, so the census of living species like it (the great apes, for the early hominins)
FOSSIL_COUNT_KINDS = ("census", "ne-ratio", "density-area", "analog")


def check_count(e: dict) -> dict:
    """A [[fossil_count]]: census individuals alive at a time over the species' band, `n` within `lo`..`hi`."""
    try:
        n, lo, hi = float(e["n"]), float(e["lo"]), float(e["hi"])
    except (KeyError, TypeError, ValueError) as err:
        raise RuntimeError(f"overrides.toml [fossil_count] {e.get('name')}: n, lo and hi are required numbers") from err
    if not 0 < lo <= n <= hi:
        raise RuntimeError(f"overrides.toml [fossil_count] {e['name']}: need 0 < lo <= n <= hi")
    if e.get("kind") not in FOSSIL_COUNT_KINDS:
        raise RuntimeError(f"overrides.toml [fossil_count] {e['name']}: kind must be one of {FOSSIL_COUNT_KINDS}")
    return {**e, "n": n, "lo": lo, "hi": hi}
