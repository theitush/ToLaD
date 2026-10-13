# ToLaD data pipeline v0 (mammals). `make` = fetch (verify pinned checksums) + build + test.
.PHONY: all fetch build test audit wiki globe

all: fetch build test

fetch:
	uv run tolad-fetch

build:
	uv run python -I -m tolad_pipeline.build

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

# Every species' range cells for the card's globe (ToLaD#267): PHYLACINE 1.2.1's current and present-natural rasters,
# run-length packed, matched to the dated tree's species. Its own step over the built data; writes
# data/mammals/ranges.json and nothing else.
globe:
	uv run python -I -m tolad_pipeline.globe
