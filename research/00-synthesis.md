# 00 — Research synthesis and proposed direction

Date: 2026-10-09. This combines the four research notes:
[01 tree data](01-tree-data.md), [02 population estimates](02-population-estimates.md), [03 rendering](03-rendering.md) and [04 layout and mesh](04-layout-and-mesh.md).
Those notes have the details and sources. This one has the decisions.

## The picture in one paragraph

ToLaD is a **vertical time river**. LUCA is at the bottom and "now" is the green rim at the top. Every clade is a band nested in its parent, and extinct clades taper into gray at their last appearance. You zoom continuously from the root down to a single named individual, without the scene ever cutting to a new view:

1. **River:** clades above species.
2. **Braid:** populations with gene-flow threads.
3. **Weave:** a pedigree of individuals laid out in generation rows.

Everything below species is generated on the fly from integer hashes and needs no storage. `cat#856639` is the same cat on every device, forever. A custom WebGL2 engine draws it all, React draws the UI around it, and the data comes as precomputed static tiles.

## Proposed decisions

| Area | Proposal | Why | Source |
|---|---|---|---|
| Layout | Vertical time river → braid → weave. Radial layout only as an optional "poster" skin | Only layouts with a time axis can show *when* lineages died. A portrait phone's long axis is time | 04 |
| Width semantics | **Width = births per unit time, so area = individuals ever lived** (the "W2" option in 04). Total count shown on the label and in a ledger | Nests correctly and turns smoothly into the per-individual weave. **Needs your OK**, see below | 04 |
| Log/linear | Nested **sibling shares** `g(n)/Σg`, with g = n (linear) or 1+log10 n (log). The toggle animates g | Absolute log widths can't nest. Under linear, deep zoom *is* the log axis | 04 |
| Green | Split each band into a green and a gray lane, with a 1 px floor for any living clade. **Log-mode formula needs your OK** | True alive share is ~1e-8 to 1e-10 almost everywhere; humans are ~7% | 02, 04 |
| Renderer | Custom WebGL2 (twgl-level), instanced tapered quads, SDF text, shader-generated mesh edges. WebGPU later | Workload is ~100k instances per frame, so WebGL2 is enough and runs everywhere | 03 |
| Deep zoom | Hierarchical local frames, with the camera re-anchored to a nearby node (OneZoom's method), plus separate X/Y scales | No float format spans ~133 bits of width or ~47 bits of time | 03, 04 |
| Shell | React + Vite + TS. Camera state never goes through React | React costs startup bytes, not frame time | 03 |
| Data delivery | Skeleton file under 2 MB, then 50–300 KB subtree tiles (brotli) loaded on zoom, decoded in a Web Worker. Full dataset ~30–45 MB, but phones fetch only what's visited | Static CDN, snappy first paint | 01, 03 |
| Topology and dates | Open Tree synth v16.1 (CC0) + the OneZoom/Duke 2026 fully dated tree (CC BY) | Resolved and dated for all 2.29M living species | 01 |
| Extinct taxa | Graft PBDB (~217k fossil species) under the matching genus/family, with first/last appearance as branch start/end. Add procedural **"ghost lineages"** for the unknown dead, shown in a distinct style | Open Tree has only ~1k extinct tips. Fossils cover about 0.1% of species that ever lived | 01 |
| Viruses | A separate forest next to LUCA, with its own toggle | Several separate origins. Counting particles would out-width all cellular life | 01, 02 |
| Individual counts | Modelled: `N_ever ≈ alive ÷ lifespan × T_eff`. Body-mass allometry fills gaps. Sum up the tree, then allocate down. Order-of-magnitude ranges and A–D grades | No source gives individual counts, so everything except humans, *T. rex* and all-cells is modelled | 02 |
| Procedural individuals | Address = species / generation / index. Public ID = keyed Feistel permutation. Parents found by recursive binomial splitting, O(log N) in both directions. **Integer-only math** | Deterministic, stateless, identical across devices | 03, 04 |
| License of the built dataset | CC BY 4.0 (CC BY-SA if GTDB is added later). Avoid TimeTree and the GBIF backbone | Redistribution terms | 01 |

## Reconciled differences between the reports

- **Uniform vs separate X/Y zoom.** 03 generalizes OneZoom's uniform similarity frames. 04 needs separate width and time scales, because a clade can be 500 My long and 1e-20 wide. Resolution: per-chunk frames carry separate (sx, st) scales, and the re-anchoring logic is otherwise the same. This is the main thing to test in the spike.
- **Green in log mode.** 02 suggests a log-scaled hue or a minimum sliver. 04 suggests green following the active width mode. Proposal: green lane width follows the active mode, there's a 1 px floor, and the true % is always in the ledger.

## Open decisions (for the user)

1. Width = births-rate river (area = individuals), or literal "width = total individuals" (constant-width flow-tree) as the default?
2. In log mode, is the green share log-compressed too?
3. Viruses: count particles or infections? Start with them off by default?
4. First real-data slice: mammals (~27k tips, under 1 MB), or straight to the coarse all-life skeleton?

## Proposed plan

0. **Spike (no real data needed):**
   - WebGL2 tapered-band renderer, plus the re-anchoring camera with separate X/Y scales, on a synthetic infinitely deep procedural tree.
   - Pinch and inertia with Pointer Events.
   - Measure on a mid-range Android and an iPhone. Target: 60 fps at depth 10^3+.
   - This tests the two hardest problems (deep-zoom numerics and mobile performance) before any data work.
1. **Procedural core:** integer hash, Feistel IDs and binomial-split pedigree as a pure TS library, with golden-value tests that run identically in CPU code and GLSL.
2. **Data pipeline v0 (Python, offline):**
   - Mammals: Open Tree + Upham dates + PBDB fossils, then counts modelled with the 02 method.
   - Output: skeleton + tile files.
   - MOCK "real" individuals, clearly labelled as mock.
3. **River with real data:** tiles + worker + SDF labels + search + info panel showing counts, grade and sources.
4. **Braid and weave:** population tubes, then the pedigree weave, with LOD thresholds from 04 §4.
5. **Scale out:** all life (Duke dated tree + PBDB + ghost lineages), the virus forest, a service worker, then hosting.

## Top risks

1. Re-anchoring and precision bugs (jitter, cracks, teleporting). Mitigate with a random deep-zoom test harness and a debug overlay.
2. Procedural results differing across devices. Mitigate with integer-only math and golden tests.
3. iOS closing the tab at ~300–500 MB. Mitigate with byte-budgeted LRU caches.
4. Modelled counts presented as facts. Mitigate by showing grades, ranges and "modelled" labels everywhere.
5. Name matching across Open Tree, PBDB, COL and ICTV is the main data-engineering cost.
6. The weave layer is novel UX, so it risks reading as noise. Prototype the LOD ladder early.
