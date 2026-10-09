# ToLaD data pipeline v0 (mammals). `make` = fetch (verify pinned checksums) + build + test.
.PHONY: all fetch build test

all: fetch build test

fetch:
	uv run tolad-fetch

build:
	uv run python -I -m tolad_pipeline.build

test:
	uv run python -I -m unittest discover -s tests -t .
	node --test decoder/test/roundtrip.test.mjs
