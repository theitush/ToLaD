# ToLaD data pipeline v0 (mammals). `make` = fetch (verify pinned checksums) + build + test.
.PHONY: all fetch fetch-amniotes build build-amniotes test audit wiki wiki-amniotes phylopic phylopic-amniotes globe

all: fetch build test

fetch:
	uv run tolad-fetch

# The amniote sources (ToLaD#535; research/amniote-sources.md, build order step 1) into data/raw/amniotes/,
# plus the OTT Amniota cut, pinned in sources.lock.json. Not part of `make`: the mammal build never reads them.
# RAW=<dir> fetches into another raw root.
fetch-amniotes:
	uv run tolad-fetch --set amniotes $(if $(RAW),--raw $(RAW))

build:
	uv run python -I -m tolad_pipeline.build

# The amniotes (ToLaD#539): the living Amniota tree, dated per group, with the mammal build grafted in as its Mammalia,
# into data/amniotes/ (amniotes.py; its hand values in amniotes.toml). Runs the mammal build in-process and writes
# nothing of it: data/mammals stays as `make build` left it. Not part of `make`.
build-amniotes:
	uv run python -I -m tolad_pipeline.amniotes

test:
	uv run python -I -m unittest discover -s tests -t .
	node --test decoder/test/roundtrip.test.mjs
	@if [ -f ../data/build/audit_leaves.json ]; then $(MAKE) --no-print-directory audit; else echo "audit: skipped (no build snapshot; run make build)"; fi

# Data audit (ToLaD#113): flags interesting-looking data bugs in the last build's snapshot
# (data/build/audit_leaves.json) and writes research/data-audit-report.md. Flags never fail it.
audit:
	uv run python -I -m tolad_pipeline.audit

# Wikipedia link + Wikimedia Commons picture URL per species (ToLaD#182): its own step over the built
# data. Queries Wikidata only when data/raw/wikidata/taxa.json is missing (or `--refresh`), else
# verifies its pinned checksum; writes data/mammals/wiki.json and nothing else.
wiki:
	uv run python -I -m tolad_pipeline.wiki

# The same for the amniotes (ToLaD#539): data/amniotes/wiki.json, the birds and reptiles asked about on Wikidata (its
# own snapshot, data/raw/wikidata/amniotes.json), the mammals' entries copied from data/mammals/wiki.json as they are.
# A run cut off resumes where it stopped. ARGS: `--names-only` (steps 1-2, ~10 min), `--extend` (the rest, ~13 min).
wiki-amniotes:
	uv run python -I -m tolad_pipeline.wiki --tree amniotes $(ARGS)

# A PhyloPic outline for every species wiki.json has no picture for (ToLaD#577): its own, else its nearest relative's up
# the dated tree (phylopic.py). Its own step over the built data and wiki.json; asks PhyloPic only when
# data/raw/phylopic/amniota.json is missing (or `ARGS=--refresh`; ~10 min, resumes), else verifies its pinned checksum;
# writes data/mammals/phylopic.json (data/amniotes/phylopic.json) and nothing else. Reads data/raw/amniotes/ott and pbdb
# for the splits' ids and ranks (`make fetch-amniotes`).
phylopic:
	uv run python -I -m tolad_pipeline.phylopic $(ARGS)

phylopic-amniotes:
	uv run python -I -m tolad_pipeline.phylopic --tree amniotes $(ARGS)

# Every species' range cells for the card's globe (ToLaD#267): PHYLACINE 1.2.1's current and present-natural rasters,
# run-length packed, matched to the dated tree's species. Its own step over the built data; writes
# data/mammals/ranges.json and nothing else.
globe:
	uv run python -I -m tolad_pipeline.globe
