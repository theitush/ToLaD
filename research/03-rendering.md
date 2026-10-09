# 03 — Rendering, deep-zoom numerics, data streaming, gestures

Research date: 2026-10-09. Scope: choosing the canvas renderer and client architecture for ToLaD, a mobile-first, 60fps, effectively infinite-zoom tree of life (tree above species, then population mesh, then individual pedigree, all procedurally generated below some depth).

Confidence markers: **[verified]** means checked against a primary source during this research. **[secondary]** means blogs or forums only. **[judgement]** means my engineering opinion.

---

## TL;DR

1. **Renderer: a custom WebGL2 renderer** (about 3-5k LOC, hand-rolled or on `twgl.js`) using instanced quads with analytic anti-aliasing in the fragment shader, MSDF/SDF text drawn as instanced glyph quads, and **all geometry stored in subtree-local float32 frames, with each chunk's transform computed in float64 on the CPU every frame**. Keep the API small enough to add a WebGPU backend later. Do not build on deck.gl, three.js or CanvasKit. PixiJS v8 is the only framework that would be a reasonable prototype shortcut.
2. **WebGPU in 2026** runs on iOS/iPadOS 26+ Safari and Chrome Android (Android 12+ on supported GPUs), and caniuse puts it at about 86-88% global. Desktop Safari is listed as "partial", Firefox Android is still off by default, and deck.gl 9.4 (Sept 2026) still calls its WebGPU path experimental. This workload (at most about 100k instances per frame, simple shaders) is not limited by WebGL2, so **WebGL2 should ship first and WebGPU can come later**.
3. **Infinite zoom needs a re-anchored, hierarchical coordinate system.** OneZoom solves exactly this problem. Each node stores its children's placement relative to itself (`nextx/nexty/nextr`). The camera is expressed relative to an *anchor node* near the view, and positions are propagated up and down from the anchor every frame. Plain float64 cannot work: across trillions of generations the total scale ratio overflows any fixed coordinate system.
4. **Data is subtree tiles, not spatial quadtree tiles.** Tiles are keyed by node id, use a custom columnar typed-array format, and are served as static files (or one range-requested archive) from a CDN. Decoding, layout, procedural generation and label placement run in a Web Worker and come back as Transferable `ArrayBuffer`s. SharedArrayBuffer is not needed, which avoids COOP/COEP headaches on static hosts.
5. **Below species, generate geometry in shaders** from `gl_InstanceID` plus an integer hash seed (WebGL2 has `uint` and bitwise ops). Use the identical integer hash on the CPU for picking and labels. Floating-point `Math.sin/exp/log` are not bit-identical across engines, so they must not drive deterministic generation.
6. **Gestures:** Pointer Events, either raw or via `@use-gesture/vanilla` 10.3.x (still maintained, latest release about March 2026). Use `touch-action: none` and do inertia in log-zoom space. Camera state lives in a mutable object outside React, and frames are rendered on demand.
7. **React is fine for the shell** as long as nothing in the per-frame path touches React state, and labels are drawn in WebGL rather than as DOM. Solid, Svelte or Preact mostly save 30-45 KB gz of startup, not frame time.

---

## 1. Prior art

### 1.1 OneZoom (github.com/OneZoom/OZtree), read from source [verified]

Source paths are in `OZprivate/rawJS/OZTreeModule/src/`.

- **Renderer: Canvas2D.** `render/renderer.js` calls `canvas.getContext("2d")`, keeps a background canvas, and draws shape objects (`projection/shapes/`: arc, bezier, path, text, image). It reaches 2M+ species with no GPU code at all. It works because only a few thousand shapes are drawn per frame.
- **Relative layout.** `projection/pre_calc/*` precomputes each node's child placement in the parent's unit frame: `node.nextx[i]`, `node.nexty[i]`, `node.nextr[i]` (offset and scale of child *i*). Absolute size never appears.
- **Re-anchoring (`position_helper.js: reanchor`).** The view state is `(xp, yp, ws)` *relative to an anchor node*. Every node on the root-to-anchor path has `graphref = true`. Each frame, `re_calc.js: drawreg` walks *down* the graphref path to the anchor and then works *upward* (`node.rvar = child.rvar / node.nextr[index]` and so on). Every other visible node is placed *downward* from its parent (`x + r*nextx[i]`). Re-anchoring picks the first visible node whose on-screen radius is between 1 and 2200 px. As a result, every number the code handles is roughly screen-sized, and float64 never loses precision no matter how deep you are.
- **Flights** (animated jumps across huge scale ranges) are split into steps of at most a 10^7 scale factor (`r_mult >= 10000000` sets `more_flying_needed`), with a re-anchor between steps.
- **Culling and LOD:** `node_on_screen` checks precomputed bounding boxes of the node and its descendants (`hxmin/hxmax...`) in the node's own frame. Recursion stops when `r <= tree_state.threshold`. `adjust_threshold` raises or lowers the threshold based on measured frame time (adaptive LOD). That idea is worth copying.
- **Data loading:** the *entire topology* is shipped as a compact string (`completetree.js`) plus `cut_position_map.js`, which lets a subtree be parsed lazily ("developing" midnodes on demand: `factory/`, `dynamic_loading`). Metadata (names, images, IUCN status) comes from an API per visible node. `factory/garbage_collection.js` frees subtrees once they are a set number of generations away from the visible, targeted and anchor paths. The comments there warn that collecting the anchor node itself teleports the view. Expect the same class of bug.
- **Lesson for ToLaD:** keep the numerics design (relative frames plus anchor) and the adaptive threshold. Replace Canvas2D with WebGL2, because ToLaD needs mesh edges, partial-colour branches and many more primitives. Replace "ship the whole topology" with subtree tiles, because ToLaD's tree is only finite down to species.

### 1.2 Lifemap (lifemap.cnrs.fr; PLOS Biol 2016, PMC5179005) [verified from paper]

- The layout is fractal and treemap-like. Each clade is a half-circle sized by the square root of its species count. Child arcs share 180 degrees in proportion to species counts.
- The stack is the classic OpenStreetMap one: **PostGIS, then Mapnik, then mod_tile/renderd raster tiles, then Leaflet 0.7**, with Solr for search. The deepest OTOL species needs **52 zoom levels**. A naive pyramid would hold about 1.1x10^32 tiles, so tiles are rendered on request and cached (about 200 GB).
- The current pylifemap/LifemapR tooling uses OpenLayers, deck.gl, d3 and Observable Plot.
- **Lesson:** map tiles work for a *fixed* finite tree, but they hit a fixed depth limit (Web Mercator and Leaflet coordinates break down around zoom 30+ without custom CRS work). They need a server or a huge pregenerated pyramid, can't recolour (alive/dead) client-side, and can't do procedural infinite depth. **Not suitable for ToLaD**, although the "tile only what's requested" idea carries over.

---

## 2. Renderer options compared (state as of Oct 2026)

| Option | Fit for ToLaD | Notes |
|---|---|---|
| **Raw WebGL2 (hand-rolled or `twgl.js`)** | **Best** | Supported effectively everywhere, including iOS 15+ (WebGL2 since Safari 15). Instancing, `uint`/bitwise in GLSL ES 3.00, `gl_VertexID`/`gl_InstanceID`, UBOs, transform feedback. You get exactly the primitives you need with no scene-graph overhead. Cost: you write the text, line and picking code yourself. `regl` is pleasant but WebGL1-era and slow-moving (last npm update about Nov 2024 [secondary]). Prefer `twgl` or about 300 LOC of your own helpers. |
| **WebGPU** | Later / optional | caniuse (Oct 2026): iOS Safari 26+ supported, Chrome Android supported, Samsung Internet 24+ supported, **desktop Safari "partial"**, **Firefox Android disabled by default**. Global coverage about 86% full plus 2% partial [verified]. Compute shaders would help with GPU culling and mesh generation, but a fallback is still required and the workload doesn't need it. Design the renderer interface so a WebGPU backend can be added. |
| **PixiJS v8** (latest 8.22.0, Oct 2026) | OK for prototype | WebGPU with automatic WebGL fallback, good batching, BitmapText with SDF/MSDF support, mobile-oriented work (transient MSAA on TBDR GPUs in 8.19+) [verified]. But a scene-graph `Container`/`Graphics` per branch won't scale to 100k mutable primitives, and you would write custom `Mesh` shaders anyway. Transforms are float32, so the relative-frame scheme must still live in app code. |
| **deck.gl 9.4** (Sept 2026) | Poor | Built for geospatial data. `OrthographicView` works, but precision tooling (`coordinateOrigin`, `*_OFFSETS`) is geo-only, and fp64 is deprecated or niche [verified]. Its model of rebuilding layer props per frame adds CPU cost on phones. WebGPU is still experimental. The bundle is large. Good for a quick desktop data-exploration spike, wrong for the product. |
| **three.js (WebGPURenderer + WebGL2 fallback, TSL)** | Poor-OK | Mature, and `InstancedMesh` plus custom TSL shaders would work. However, it brings 3D scene, camera and material baggage, its float32 world matrices fight the relative-frame approach, and its text story (troika) costs one draw call per text object, which breaks with thousands of labels [secondary]. |
| **Canvas2D** | Prototype/fallback | OneZoom proves it's viable with aggressive LOD. It is CPU-bound path rasterization, though: mesh edges, thousands of tapered and partially coloured branches, and DPR-3 screens will fall short of 60fps on mid-range phones [judgement]. Useful as a first throwaway visual prototype and possibly as a no-WebGL fallback. |
| **Skia / CanvasKit (wasm)** | No | About 1.5-2.3 MB brotli of wasm [secondary]. It renders through WebGL anyway, and adds nothing for simple instanced primitives. |

### 2.1 Primitive design (WebGL2)

All of these are **one instanced draw call per primitive type per chunk** (or per frame, with a per-instance chunk index into a UBO or texture of chunk transforms).

- **Branches: tapered quads (trapezoids).** Per-instance data: `p0, p1` (local frame, float32), `w0, w1` (start/end width, which gives taper), `aliveFrac` (0..1, u8norm), `flags`. The vertex shader extrudes a quad perpendicular to `p1-p0`, adding about 1 px of padding for AA (screen-space padding computed from the chunk's scale uniform). The fragment shader computes signed distance to the two long edges, giving analytic coverage with no MSAA (MSAA on mobile at DPR 3 is expensive).
  - **Alive/dead split:** the fragment shader gets the across-width coordinate `v` in [0,1] and colours it green if `v < aliveFrac`, else gray, with an AA'd boundary. That gives "partially green" for free with no extra geometry. Alternatives are along-length or centre-stripe splits; all are one line of shader code.
  - **Curves:** either pre-tessellate each curved branch into 4-16 segments in the worker (simplest, and joins are easy because widths vary smoothly), or use a quadratic-Bezier SDF in the fragment shader (fewer vertices, more ALU). Start with tessellation; it is easier to make crack-free.
  - Prior art: `regl-gpu-lines` (rreusser) does instanced screen-projected lines with joins and caps. Its notes warn that joins ignore varying width, so taper should be gentle per segment [verified].
- **Nodes and leaves:** instanced quads with SDF circles or rounded-rect fragment shaders.
- **Text:** do **not** use DOM labels or one draw call per label (troika-style). Use instanced glyph quads from an SDF/MSDF atlas, with layout done in the worker, so each frame is one draw call.
  - MSDF (`msdf-bmfont-xml` / `msdf-atlas-gen`) gives sharp corners for a fixed Latin set, prebuilt at build time.
  - For arbitrary scripts (common names in many languages, CJK), use **dynamic single-channel SDF glyphs** generated at runtime from canvas text (Mapbox's `tiny-sdf` approach, run on an OffscreenCanvas in the worker) and packed into a growable atlas (shelf packer).
  - Label placement: greedy priority order (bigger and more popular taxa first) into a screen-space occupancy grid, computed in the worker for the settled view. Keep placed labels stable during gestures to avoid flicker; only re-place on settle or every N frames.
- **Images** (taxon thumbnails, later): texture atlas pages, with LRU eviction of pages. Watch the GPU memory budget (see risks).
- **Picking:** CPU-side. The worker already has each chunk's geometry in local frames, so transform the tap point into chunk space and query a per-chunk grid or BVH. This avoids GPU readback stalls (`readPixels` stalls badly on mobile).

### 2.2 Frame budget

- About 16.6 ms per frame, minus browser overhead, leaves about 8-10 ms of your own work on a mid-range phone [judgement]. Draw-call count matters more than instance count: aim for under 100 draws per frame and under 200k instances.
- **Fill rate is the real mobile limit.** At DPR 3, a 1080x2400 screen is about 2.6 MP. Cap the backing-store DPR at about 2 (or adapt it), and drop to roughly 0.75x resolution *during* gestures, restoring full resolution on settle (dynamic resolution). Avoid large translucent overdraw: mesh edges and density layers are the danger here.
- Render **on demand**: request a rAF only while there is input, inertia, a flight animation or newly arrived data. This saves battery and thermal headroom (thermal throttling is what turns 60fps into 40fps after 2 minutes).
- Adopt OneZoom's **adaptive detail threshold**: raise the minimum on-screen size for drawing a subtree when frame time exceeds budget, and lower it when idle.

---

## 3. Infinite-zoom numerics

### 3.1 The problem

float32 has a 24-bit mantissa, so about 7 significant digits. A vertex at world coordinate 1.0 with a view 1e-7 wide jitters, and GPU vertex math is float32 (`highp` in GLSL ES 3.00 is float32). float64 on the CPU gives about 16 digits. ToLaD's depth is thousands of nested levels (tree, then populations, then many generations of pedigree), so the total scale ratio is far beyond 10^16, and in fact beyond 10^308. **No global coordinate system works, not even emulated fp64 or double-double.** The view must be expressed relative to a local node.

### 3.2 Recommended scheme: hierarchical similarity frames plus an anchor [judgement, generalizing OneZoom]

- **Every node defines a local frame.** A child's frame relative to its parent is a 2D similarity transform `T_child = (dx, dy, s, θ)` (OneZoom uses `x, y, r` with no rotation; rotation helps fan or spiral layouts). It is stored in float32 in the tile. Precision is only needed *relative to the parent*, so float32 is plenty.
- **Camera = (anchorNodeId, M_view)**, where `M_view` maps the anchor's local frame to screen in **float64** (JS numbers).
- **Every frame** (CPU, float64):
  1. If the anchor's on-screen scale leaves a band (say 0.5x-2000x of screen, OneZoom-style), re-anchor. Zooming in, pick the visible child covering the screen centre and compose its transform. Zooming out, move to the parent and compose the inverse. This is O(depth change), which is tiny per frame.
  2. Walk from the anchor *up* (inverse transforms) and *down* (forward transforms) to every visible **chunk root**, composing float64 3x3 affine matrices. Each chunk gets one `mat3` uniform (or one row in a transform UBO/texture) mapping chunk-local to clip space.
  3. The GPU only ever sees chunk-local float32 vertex positions (magnitudes around 1-1000) times a float32 matrix whose entries are screen-sized. **No jitter at any depth.** This is the same idea as Cesium's "relative-to-centre" rendering, applied recursively.
- **Chunk geometry stays static in GPU buffers.** Only the per-chunk matrices change during pan and zoom, so the per-frame CPU work is O(visible chunks), not O(visible primitives). This beats OneZoom, which recomputes every visible node's position in JS each frame. That is affordable in Canvas2D, but would waste the GPU's advantage here.
- **Chunk depth limit:** a chunk must not span more scale range than float32 can represent within it. If a chunk's internal scale range is about 1:10^4 and you never draw anything smaller than about 0.5 px, error stays under 10^-3 px. Rule: **cut chunks so that max/min node scale inside a chunk is at most about 10^3-10^4**, and draw descendants below that as separate chunks with their own matrices.
- **Zoom value** shown in UI or URLs: store `(anchor path or id, log2 scale within anchor, offset)`. For shareable URLs, encode the anchor as its stable address (§5.4) plus local view parameters. Never use a global zoom double.
- **Flights between distant nodes:** animate in log-scale space and re-anchor along the path (OneZoom caps each step at 10^7). Go up to the common ancestor, then down. Interpolate `log(scale)` linearly with eased timing so the speed feels constant.
- **Watch for:** cracks between parent and child chunks (the same edge computed via two different matrix paths). Mitigate by having the child chunk draw the connecting branch segment, or by computing both sides from the same composed matrix. Also mind GC of the anchor (OneZoom's warning).

### 3.3 Layout stability under lazy loading (critical)

A node's layout of its children must depend **only on data stored with that node** (child weights and counts), never on deeper, not-yet-loaded data. Otherwise geometry shifts as tiles arrive. So each tile stores, for every boundary node, the aggregate weights its layout needs, and each child's `T_child` can be computed from those alone. OneZoom gets this for free by preloading all topology; ToLaD must design for it.

### 3.4 Width encoding note

Width as a function of log(count), expressed in local frame units, scales geometrically with zoom, which is natural for infinite zoom but makes leaf-level branches microscopic until zoomed. Width in screen pixels (a stroke) breaks the "zoom reveals detail" feel. A common compromise is local-frame width clamped to a min/max pixel range in the vertex shader (cheap, since the scale uniform is known). Note too that log scaling breaks additivity (children's widths no longer sum to the parent's), so the visual design must pick between "flow conservation" and "log legibility". This decision is flagged for the design doc.

---

## 4. Below species: population mesh and pedigree rendering

### 4.1 Procedural generation constraints

- **Determinism across devices and engines:** use integer-only hashing (e.g. a PCG/xorshift/splitmix variant on two 32-bit lanes with `Math.imul` and `>>> 0` in JS). IEEE `+ - * / sqrt` are deterministic, but **`Math.sin/cos/exp/log/pow` are not guaranteed bit-identical across V8, JSC and SpiderMonkey**, and GPU float math varies by vendor. Derive any distribution samples from integer bits through exactly-rounded ops only, or via lookup tables.
- **Addressing:** individual = `(speciesId, populationPath, generation, index)`. The seed is `hash(parentSeed, childIndex)` down the path, so any node's data is reproducible from its address without generating its siblings.
- **Generation runs in the worker** (CPU, JS or wasm), producing chunk buffers in local frames, exactly like real-data tiles. The renderer doesn't care whether a chunk came from the network or from the generator.

### 4.2 Cheap dense DAG edges

- **Layered layout:** generations are rows along the time axis and individuals are slots within a row, ordered by lineage (e.g. by a parent's slot) to minimize crossings. Edges then only connect adjacent rows, so they are short and local, and no general graph layout (force-directed etc.) is ever needed. cosmos.gl and sigma.js solve a different problem (arbitrary graphs with force layout); don't use them.
- **Shader-generated edges (zero upload):** for a visible window of rows `[g0, g1]` and slots `[i0, i1]`, issue `drawArraysInstanced(…, count = rows × slots × 2)`. The vertex shader derives `(gen, slot, whichParent)` from `gl_InstanceID`, computes the parent slot via the *same integer hash* as the CPU (WebGL2 GLSL has `uint`, `^`, `>>`, `*` with 32-bit wraparound), and emits a 1-2 px AA line quad. The CPU uses the identical function for picking and labels. This renders hundreds of thousands of edges with almost no memory.
- **LOD ladder** (switch on density = edges per pixel):
  1. Very dense: population **flow bands** (Sankey-like ribbons between population blocks, with width from population size and colour from alive fraction).
  2. Medium: **density texture**. Render edges additively into a low-res float or half-float FBO (`EXT_color_buffer_half_float`; check support on mobile, with an RGBA8 fallback), then tone-map. Overdraw at low resolution is cheap.
  3. Sparse: individual edges and nodes with labels.
  Crossfade between levels over a scale range to avoid popping.
- **Tree to mesh transition:** at species level, the species branch becomes a population band. The band's local frame is the parent frame for the mesh chunks, so the same anchor and re-anchor machinery continues seamlessly.

---

## 5. Data streaming

### 5.1 Tiles = subtrees, not spatial quads

Because geometry lives in nested relative frames, the natural unit is a **subtree tile**. Each tile is the subtree rooted at node N, truncated at a node budget (about 2-20k nodes) or a depth/scale budget (which also matches the §3.2 chunk rule), with "stub" entries pointing to child tiles. Request tiles for visible stubs whose projected size exceeds a threshold, prioritized by screen size and closeness to the screen centre. This is hierarchical LOD for free: coarse ancestors are always loaded before descendants.

Open Tree synthetic tree (about 2.3-2.6M tips): with a budget of about 10k nodes that's roughly 500 topology tiles. Total topology without names is probably a few tens of MB raw and much less compressed [judgement]. The root tile plus the first couple of levels should be in the initial payload (under about 200 KB).

### 5.2 Format

- **Custom columnar binary over typed arrays** [judgement: best fit]:
  - A header (magic, version, counts, section offsets).
  - Sections, all 4-byte aligned so they can be zero-copy viewed:
    - `Uint32 firstChild` / `Uint16 childCount`, or preorder plus `subtreeSize`
    - `Float32` layout weights
    - `Float32` or quantized `Uint16` log-counts
    - `Uint8` aliveFrac
    - `Uint32` taxon ids
    - string table offsets (names in *separate* metadata tiles)
  - Decoding is `new Float32Array(buf, off, n)`, which is effectively free.
- **FlatBuffers**: zero-copy too, but per-field accessor calls are slower in hot loops and its row orientation fits poorly. **Arrow IPC**: a good columnar format, but the JS library is heavy for what you need; reasonable if the offline pipeline is Arrow/Parquet-based, as long as the client reads raw buffers. **Protobuf**: needs a decode pass, so avoid it for geometry.
- Quantize where possible (Uint16 positions within a chunk's bounding box, Uint8 colours and fractions). This halves GPU memory and download size.

### 5.3 Hosting and compression (static CDN)

- **Option A (simplest):** one file per tile (`/t/{tileId}.bin`). Cloudflare and other CDNs apply brotli or zstd `Content-Encoding` automatically, or you can upload precompressed files. HTTP caching works as normal.
- **Option B:** a single archive with an index, fetched via **HTTP Range requests**, which is the PMTiles model. PMTiles itself is z/x/y-addressed [verified], so either map tile ids into its address space or write a ~100 LOC custom index. Range responses usually can't use transparent `Content-Encoding`, so compress per tile inside the archive and decompress in the worker. `DecompressionStream('gzip'/'deflate')` is universal. Brotli and zstd support in `DecompressionStream` is still inconsistent [verified for zstd: not in Chrome or Safari], so use a small wasm decoder if needed.
- Start with A. Move to B only if file count becomes painful (millions of tiles) or the host lacks good compression.

### 5.4 Workers, caching, memory

- **Data worker:** fetch, decompress, decode, layout, procedural generation, label layout and picking indices. It posts instance buffers to the main thread as **Transferables** (zero-copy ownership transfer).
- **SharedArrayBuffer** needs cross-origin isolation (COOP `same-origin` plus COEP `require-corp` or `credentialless`). Cloudflare Pages and Netlify can set these via `_headers`; GitHub Pages needs the `coi-serviceworker` hack with a reload on first visit [verified]. COEP also breaks un-CORS'd third-party images (e.g. Wikimedia thumbnails need CORS or CORP). **Recommendation: don't depend on SAB.** Transferables are enough. If you later want a render worker with shared camera state, add isolation then.
- **OffscreenCanvas:** WebGL in workers has worked on Safari since 17 (iOS 17+) [verified: WebKit bug threads, caniuse]. **Phase 1:** render on the main thread, since per-frame work there is tiny (uniforms plus draws) and heavy work is in the data worker. **Phase 2 (if React or UI jank ever shows):** move rendering to a worker with `transferControlToOffscreen` and forward pointer events. That adds a little latency but isolates the frame loop. Feature-detect *inside* the worker, because main-thread detection doesn't reflect worker WebGL support [verified].
- **Caching:** HTTP cache plus Cache Storage via a service worker (Workbox) for offline and repeat visits. Re-decoding the custom format is cheap, so IndexedDB isn't needed for tiles; it may be useful for user state. Keep an in-memory LRU in the worker with a byte budget, and evict GPU buffers for chunks off-screen beyond N levels.
- **Memory budget (iOS Safari):** tabs reportedly get killed at about 300-500 MB on older iPhones, with no API to query the budget (WebKit bug 300782, Oct 2025) [secondary]. Budget about 150 MB of JS heap plus about 100 MB of GPU (buffers plus atlases). Avoid resizing the WebGL canvas repeatedly (a known iOS leak, so size once and handle orientation carefully). Handle `webglcontextlost`/`restored` by rebuilding GPU buffers from the worker's cache.

---

## 6. Gestures and the hot path

- Use **Pointer Events** on the canvas with `touch-action: none` set *directly on the canvas*. Also `preventDefault` on `gesturestart`/`gesturechange` (Safari) and on ctrl+wheel (trackpad pinch on desktop) [verified via use-gesture docs].
- Library: `@use-gesture/vanilla` (10.3.1, maintained) is fine, as is about 200 LOC of custom code (two-pointer centroid and distance, wheel normalization). Custom code is attractive because you want zoom-about-centroid in **log-scale space** and inertia expressed as `(vx, vy, vlogScale)` with exponential decay.
- Use `getCoalescedEvents()` for smoother tracking where available. Apply input once per rAF, not per event.
- **Never put camera state in React state.** Gesture handlers mutate a plain camera object (or post to the render worker) and request a frame. React only learns about the view through throttled callbacks (e.g. breadcrumb or URL updates at about 4 Hz, or on settle).
- Run all chunk transform math, culling and draw submission inside rAF without allocations (preallocate Float64Array scratch matrices). GC pauses on mid-range Android show up as dropped frames.

## 7. React vs Solid/Svelte/vanilla

- When the canvas loop sits outside the framework, the framework's per-frame cost is **zero**, so snappiness doesn't depend on the choice. React 19 plus a memoized `<Canvas>` that mounts the imperative engine via a ref is the standard pattern (react-three-fiber and react-map-gl both work this way).
- Real differences:
  - **Startup:** react-dom is about 45 KB gz, versus about 7 KB for Solid and about 4 KB for Preact. On a mid-range phone over 4G this is roughly 50-150 ms of parse/execute [judgement].
  - **Overlay UI churn:** e.g. a breadcrumb that updates during zoom. Solid's fine-grained updates are cheaper, but throttled React updates are fine.
- **Verdict:** React is fine if the team prefers it. Keep the engine framework-agnostic (a plain TS package with `engine.setCamera`, `engine.on('select')` and so on) so the choice stays reversible. If nobody is attached to React, Preact (with compat) or Solid is a free win in bundle size, but it isn't worth fighting about.

---

## 8. Recommended stack and architecture

```
┌────────────────────────── Main thread ──────────────────────────┐
│ React (or Preact) shell: search, info panel, breadcrumbs, menus  │
│        │ props/events (throttled, never per-frame)               │
│ Engine (plain TS)                                                │
│  ├─ Input: Pointer Events → camera {anchorId, M_view(f64)}       │
│  │          inertia in log-scale space, on-demand rAF            │
│  ├─ Camera: re-anchor; compose f64 matrices anchor→chunk roots   │
│  ├─ Cull/LOD: chunk bboxes in local frames, adaptive threshold   │
│  └─ Renderer (WebGL2, twgl-level helpers)                        │
│      branches (tapered instanced quads, alive/dead split)        │
│      nodes (SDF circles) · text (SDF/MSDF glyph instances)       │
│      mesh edges (shader-generated from gl_InstanceID + hash)     │
│      density FBO for dense meshes · dynamic resolution           │
└───────▲──────────── postMessage(Transferable ArrayBuffers) ──────┘
        │ requests: {chunkId, priority}      ▲ results: chunk buffers,
        ▼                                     │ label runs, pick indices
┌──────────────────────── Data worker ────────────────────────────┐
│ fetch → decompress → decode columnar tile → layout (local frames)│
│ procedural generator (integer hash, deterministic)               │
│ label placement (priority + occupancy grid) · SDF glyph gen      │
│ LRU caches (bytes budget) · picking BVH/grid per chunk           │
└───────▲─────────────────────────────────────────────────────────┘
        │ HTTP (CDN, brotli) + Service Worker Cache Storage
┌───────┴─────────────── Offline pipeline (Python/Rust) ──────────┐
│ OpenTree synth + counts estimates → aggregate weights per node   │
│ → subtree tiling (node/scale budget) → columnar .bin tiles       │
│ → metadata tiles (names, ranks, images) → upload to CDN          │
└─────────────────────────────────────────────────────────────────┘
```

**Libraries:**
- `twgl.js` (or none)
- `@use-gesture/vanilla` (optional)
- `msdf-atlas-gen` for the build-time Latin atlas
- a `tiny-sdf`-style runtime glyph generator
- `comlink` (optional) for worker RPC
- Workbox for the service worker
- Vite as the build tool

**Phased plan:**
1. **Spike (1-2 weeks):** WebGL2 instanced tapered-branch renderer, plus the anchor/re-anchor camera on a synthetic, infinitely deep procedural tree. Test on a real mid-range Android (Mali and Adreno) and an iPhone. Measure frame time under pinch at depths of 10^3+ levels. This de-risks the two hardest problems together.
2. Subtree tiles from OpenTree, the worker pipeline, and the SDF text system.
3. Population and pedigree mesh with shader-generated edges plus the LOD ladder.
4. Optional: render worker (OffscreenCanvas), WebGPU backend, PWA/offline.

---

## 9. Risks

1. **Re-anchoring and chunk-matrix bugs:** jitter, cracks between parent and child chunks, teleporting when the anchor gets GC'd, and flights across 10^100 scale. Mitigation: a property-based test harness that zooms randomly to depth 10^4 and asserts screen-space continuity, plus a debug overlay showing the anchor and chunk bounds (OneZoom has one).
2. **Cross-device determinism of procedural content:** float transcendental functions differ across JS engines and GPUs. Mitigation: integer-only hash/RNG, one shared implementation in TS and GLSL, and golden tests comparing CPU output with GPU output read back in CI (headless Chrome) and on devices.
3. **Layout instability when tiles arrive** if a layout depends on unloaded data (§3.3). Mitigation: aggregate weights stored at the boundaries.
4. **iOS memory kills:** at about 300-500 MB, with no budget API, the tab silently reloads. Mitigation: strict byte-budget LRUs for JS and GPU, quantized buffers, atlas eviction, and a long-session soak test on an older iPhone.
5. **Fill rate and thermals on high-DPR phones:** mitigate with DPR cap, dynamic resolution during gestures, on-demand rendering and adaptive LOD threshold.
6. **Text at scale and i18n:** CJK and other scripts make prebuilt MSDF atlases huge, so use runtime SDF glyph generation. Label collision costs CPU, so keep it in the worker and stabilize placements during motion.
7. **WebGL context loss and mobile driver bugs** (historically more on Mali [secondary]): handle context restore, keep shaders simple, and test on both GPU vendors early.
8. **Main-thread contention** from React re-renders, layout or GC in the gesture path. Mitigation: strict separation, allocation-free frame loop, and phase-2 OffscreenCanvas as an escape hatch.
9. **Static-hosting constraints:** COOP/COEP is needed only if SAB is used, so avoid it. Millions of tile files can be handled with range-request archives later. CORS is needed for third-party images (Wikimedia, EOL) if they are drawn into WebGL textures; cross-origin images *require* CORS to be uploaded to WebGL.
10. **WebGPU fragmentation** if adopted early: desktop Safari is "partial", Firefox Android is off. Keep WebGL2 as the baseline.
11. **Accessibility and SEO:** a canvas is opaque. Provide DOM search, a list or outline of the current view, and stable URLs.
12. **Scope risk in the mesh/pedigree layer:** the "fun" part is also the most novel rendering. The LOD ladder (bands, then density, then edges) needs careful design so it reads as meaningful rather than noise.

---

## Sources

- OneZoom source (cloned and read): https://github.com/OneZoom/OZtree, specifically `OZprivate/rawJS/OZTreeModule/src/{position_helper.js, projection/re_calc.js, render/renderer.js, factory/garbage_collection.js}`
- Lifemap paper (PLOS Biol 2016): https://pmc.ncbi.nlm.nih.gov/articles/PMC5179005
- pylifemap: https://github.com/Lifemap-ToL/pylifemap
- WebGPU support: https://caniuse.com/webgpu ; https://web.dev/blog/webgpu-supported-major-browsers ; https://appdevelopermagazine.com/webgpu-in-ios-26/
- OffscreenCanvas: https://caniuse.com/offscreencanvas ; https://bugs.webkit.org/show_bug.cgi?id=183720 ; https://www2.webkit.org/show_bug.cgi?id=253431
- PixiJS: https://github.com/pixijs/pixijs/releases ; https://pixijs.com/blog/pixi-v8-launches
- deck.gl: https://deck.gl/docs/whats-new ; https://deck.gl/docs/developer-guide/coordinate-systems ; https://deck.gl/docs/api-reference/extensions/fp64-extension
- three.js WebGPURenderer: https://threejs.org/manual/en/webgpurenderer ; https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- CanvasKit size: https://startdebugging.net/2026/09/canvaskit-vs-skwasm-for-flutter-web-in-2026/
- Instanced lines: https://github.com/rreusser/regl-gpu-lines/
- Text labels at scale: https://discourse.threejs.org/t/performant-approach-for-displaying-text-labels-10000/21863 ; https://discourse.threejs.org/t/100-dynamic-troika-three-text-labels-with-1s-updates/90287 ; https://levelup.gitconnected.com/msdf-font-rendering-in-webgl-91ce192d2bec
- Graph renderers: https://openjsf.org/blog/introducing-cosmos-gl ; https://v4.sigmajs.org/
- PMTiles: https://docs.protomaps.com/pmtiles/
- COOP/COEP on static hosts: https://docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers ; https://app.cinevva.com/tutorials/coop-coep-sharedarraybuffer
- DecompressionStream: https://developer.mozilla.org/docs/Web/API/DecompressionStream/DecompressionStream ; https://caniuse.com/mdn-api_decompressionstream_decompressionstream_zstd
- iOS memory: https://bugs.webkit.org/show_bug.cgi?id=300782 ; https://bugs.webkit.org/show_bug.cgi?id=219780 ; https://bugs.webkit.org/show_bug.cgi?id=195325
- Gestures: https://github.com/pmndrs/use-gesture/releases ; https://developer.mozilla.org/Web/CSS/touch-action
- regl status: https://depscope.dev/pkg/npm/regl
