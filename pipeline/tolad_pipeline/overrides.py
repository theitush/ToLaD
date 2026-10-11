"""Manual overrides (pipeline/overrides.toml): exclusions, fossil dates, placements.

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
    applied: dict[str, list] = field(default_factory=lambda: {"exclude": [], "date": [], "placement": [],
                                                              "dated_clade": [], "dated_fossil": []})

    def check_all_used(self, dated: bool = False) -> None:
        """Every entry matched something; `dated` checks the dated tree's sections (applied later)."""
        if dated:
            unused = ([f"dated_clade {e['name']}" for e in self.dated_clades
                       if e["name"] not in {a["name"] for a in self.applied["dated_clade"]}]
                      + [f"dated_fossil {e['name']}" for e in self.dated_fossils
                         if e["name"] not in {a["name"] for a in self.applied["dated_fossil"]}])
            if unused:
                raise RuntimeError(f"overrides.toml entries matched nothing: {unused}")
            return
        unused = ([f"exclude {k}" for k in self.exclude if k not in self.applied["exclude"]]
                  + [f"date {k}" for k in self.dates if k not in {a["name"] for a in self.applied["date"]}]
                  + [f"placement {p['name']}" for p in self.placements
                     if p["name"] not in {a["name"] for a in self.applied["placement"]}])
        if unused:
            raise RuntimeError(f"overrides.toml entries matched nothing: {unused}")

    def report(self) -> dict:
        return {"file": "pipeline/overrides.toml", "version": self.version, **self.applied}


def load(path: Path = PATH) -> Overrides:
    d = tomllib.loads(path.read_text(encoding="utf-8"))
    for sec in ("exclude", "date", "placement", "dated_clade", "dated_fossil"):
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
    )
