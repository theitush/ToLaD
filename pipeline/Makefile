# ToLaD data pipeline v0 (mammals). `make` = fetch (verify pinned checksums) + build + test.
.PHONY: all fetch build test audit

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
