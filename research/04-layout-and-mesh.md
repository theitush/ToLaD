# 04 — Layout shape, sub-species mesh, and procedural individuals

Research note for **ToLaD (Tree of Life and Death)**. Scope: prior art, layout candidates for a width-weighted, time-aware tree spanning ~40 orders of magnitude of width, rendering of the population/pedigree mesh below species, and deterministic lazy generation of up to ~10^40 individuals.

Date: 2026-10-09.

---

## 0. TL;DR

**Recommended shape: a vertical "time river" that becomes a braid, then a weave.**

- **Spine:** time on the Y axis, with LUCA at the bottom and the present at the top. That gives the tall axis of a portrait phone the 4 billion years. Every clade is a band nested inside its parent's band, like a nested streamgraph or a Sankey flow with conservation at every split. Extinct clades taper and end in gray at their extinction time. Surviving clades reach the green "now" rim.
- **Width semantics:** band width at time *t* is proportional to the clade's **births per unit time** (≈ census / generation time). The **area** of a band is then exactly the number of individuals that ever lived in it. "Every leaf is an individual" becomes literal: at the deepest zoom each individual is one unit-area cell of the river. The user's "branch width = number of individuals" is kept as the clade's *cumulative* readout: a label plus a "ledger" bar, and an optional "flow-tree" mode with constant-width branches.
- **Log vs linear:** layout uses **nested sibling shares**, `share_i = g(n_i) / Σ g(n_j)`. Linear is `g(n)=n`, and log is `g(n)=1+log10(n)`. The toggle animates the shares. The layout stays nested and infinitely zoomable in both modes. Under linear, honesty comes from zoom itself, which is how OneZoom works: an exponential zoom *is* a log scale.
- **Camera:** a 2D affine camera with **independent X (width) and Y (time) scales**. "Fit clade" animates both, so a 10^-25-wide, 500-My-long clade can still fill the screen. Coordinates are **re-anchored hierarchically** (OneZoom's trick), so you never need 133-bit floats.
- **Below species:** the band splits into **population sub-bands**, with gene-flow threads and admixture ribbons, using the demes/demesdraw "tubes" idiom. Below that it becomes a **generation-layered pedigree weave**: dots in rows, edges to 1–2 parents in the row below. Both coordinates are procedural, with no force layout. Asexual lineages render as small coalescent trees, so it is "trees all the way down". Tapping an individual shows its ancestor cone saturating the band at the **identical-ancestors point**, about 1.77·log2 N generations in the panmictic case.
- **Procedural individuals:** use the address `species / generation g / index i`. Define the cumulative count `C(g)` first and derive `N(g) = C(g+1) − C(g)`. Public IDs (`human#49837299`) are a **Feistel permutation with cycle-walking** over `[0, total_ever)`. Parent↔child links use **recursive (beta-)binomial splitting** over parent-couple ranges, which gives O(log N) lookup **in both directions** and needs no storage. Locality comes from a brick-wall local shuffle plus rare long-range migrants: short, readable edges, with ancestry that still converges fast.
- **Rejected as the primary shape:** the OneZoom spiral and Lifemap semicircles (no time axis, so they cannot show *when* lineages died), sunburst (bad in portrait), and force-directed meshes (do not scale and are not stable). The radial layout is kept only as an optional "poster" projection of the same coordinates.

---

## 1. Prior art review

| Tool | Layout | Width / size encoding | Time & extinction | Zoom model | Mobile | Lesson for ToLaD |
|---|---|---|---|---|---|---|
| **OneZoom** (Rosindell & Harmon 2012; Wong & Rosindell 2021) | Fractal, self-similar branching; "spiral", "natural" and Lifemap-like "polytomy" views | Branch thickness and angles reflect the richness balance at each split | Time not encoded in shape. The 2012 paper: "timescales are expressed in ways that are independent of shape including color, text, and animation". Time-scaled layouts and extinct species were left as future work. IUCN-threatened leaves shown in red | Continuous geometric zoom with **dynamic re-anchoring of the coordinate system** to remove float precision errors; pre-planned "flights" | Runs smoothly "even on relatively old mobile devices" (iPhone SE). Canvas-based | **Borrow:** re-anchoring, flights, compact topology encoding (comma-free parenthesis string + nested-set row ordering, ≈2.5 bits/species). **Avoid:** a shape with no time meaning, and spiral disorientation ("where am I?") |
| **Lifemap** (de Vienne 2016) | Each clade is a semicircle inside its parent's semicircle, placed randomly; branches never intersect | Size ∝ **square-root** of species count relative to siblings; root proportions forced equal | None | Slippy-map tiles (256 px, OpenStreetMap stack; 52 zoom levels; ~10^32 virtual tiles, rendered on demand and cached) | Mobile web + apps; familiar map gestures | **Borrow:** the map metaphor and gestures are instantly understood on phones. **Avoid:** server-side tiles (incompatible with procedural infinite depth) and random placement. Roderic Page: "because trees are mostly empty space it is easy to get lost" |
| **Open Tree of Life browser** | Node-centric local view ("argus" route); collapses nodes | No width encoding | Synthetic tree has no time-scaled branches | Click node to recenter | Works, "clunky" (Page 2026) | Data source, not a viz model |
| **OTT Viewer** (R. Page 2026) | Summary trees collapsed to a fixed node budget; re-root on click; animated transitions; **hoptree** navigation history | – | – | Discrete re-rooting | n/a | **Borrow:** a fixed label budget (priority queue) and the hoptree/breadcrumb as the "where am I" answer |
| **Taxonium** (Sanderson 2022) | Rectangular; WebGL (deck.gl); millions of tips | – | – | Y-only stretch zoom | OK | WebGL instancing of millions of nodes in a browser is proven. Y-only stretching is cited as a weakness |
| **DeepTree** (Block, Horn et al. 2012; Harvard "Life on Earth") | Rectangular tree on multitouch tables; 70k species, 3.5 Gy | – | Time present | Pinch/pan; pull tree down to reveal detail | Tabletop | User study: visitors read zoom as **either spatial or temporal movement**. ToLaD should make the time axis explicit (ruler, era labels) so the two readings agree |
| **Evogeneao poster + Tree of Life Explorer** (L. Eisenberg) | Radial "living tree": Earth's origin at the bottom centre, present at the outer margin, iso-time dashed arcs | Branch widths illustrative ("the smallest branches are purely illustrative") | **Yes**: extinct lineages end in the past; mass-extinction dips are suggested | Static poster; simple web explorer | Poster | The aesthetic north star. Extinct branches ending in time is exactly ToLaD's "dead" story. Width there is decorative; ToLaD makes it quantitative |
| **Hillis plot** (Hillis, Zwickl, Gutell) | Circular tree of ~3,000 rRNA species, root at centre | Sampling ≈ √(species count) per group | None | Static | Poster (54" wide) | √ sampling is the same compromise as Lifemap. It is beautiful but unreadable without a wall |
| **Tree of Life Web Project** | One page per clade, hand-drawn cladograms | – | Some extinct taxa | Hyperlinks | Web 1.0 | Shows the value of per-clade content pages; largely dormant |
| **iTOL v6/7, phylo.io, Iroki** | Rectangular/circular analysis viewers; auto-collapse; metadata colouring | Optional | Branch lengths if supplied | Bounded zoom | Desktop-oriented | Annotation patterns (colour strips, collapse-to-triangle) are useful; navigation is not infinite |
| **Romerogram / spindle diagrams** (Romer; paleoDiv `phylo.spindles`) | Time vertical, width = taxonomic diversity | Width ∝ diversity at time t | **Yes**: spindles bulge and pinch out at extinctions | Static | – | The direct ancestor of the recommended "river". Known weakness: spindles hide parent/daughter relations and can make the parent paraphyletic. Nesting bands inside parents fixes that |

### What works on mobile and what doesn't

- **Works:** continuous pinch/pan with no mode switches (Lifemap, OneZoom). "Fly to" search animations. Always something visible at every zoom level (the fractal guarantee). Tall content on a tall screen.
- **Fails:** tiny radial labels and rotated text. Sunburst or radial overviews that waste the top and bottom thirds of a portrait screen. Getting lost in empty space (Lifemap). Losing orientation in spirals. Hover-based tooltips. Desktop analysis UIs (iTOL).
- **Needed in ToLaD:** a persistent **breadcrumb/hoptree** (LUCA › Eukarya › … › Homo sapiens › Population › human#…), a **time ruler** pinned to the left edge, a **scale chip** showing the width mode and the current zoom factor, and a **label budget** of about 30–60 labels per frame (summary-tree style priority).

---

## 2. The core design problem and three reframes

Numbers to accommodate:

- Cells ever lived: **10^39–10^40** (Crockford et al. 2023, *Current Biology*). Alive today: ~10^30. Alive share of everything ever is ~10^-10.
- Humans: ~1.2×10^11 ever born vs ~8×10^9 alive (~7%).
- Time: LUCA ~4 Ga down to a 20-minute bacterial generation is ~10^14 generations (~47 bits). Width from all life down to one individual is ~133 bits. IEEE doubles hold 53 bits.

### Reframe 1: log is a property of the zoom, not of the absolute geometry

Absolute log widths (`w = log n`) cannot nest, because `log a + log b ≠ log(a+b)`. Children would overflow their parent, and an infinite-zoom layout needs children inside parents. So:

- **Layout = nested shares.** For children of a node, `share_i = g(n_i) / Σ_j g(n_j)`, where the child's band = the parent's band × share.
  - `g(n) = n` gives **linear**, which is honest.
  - `g(n) = 1 + log10(n)` gives **log**, which preserves order and compresses ratios.
  - `g(n) = n^α` gives a continuous dial: α = 0.5 is Lifemap/Hillis √, and α → 0 is equal split.
- The toggle animates shares (`g` interpolated), so the morph is continuous.
- Under **linear**, eukaryotes are a hairline at root zoom. That is the honest truth, and the zoom compensates: zooming ×10^k is itself the log axis (OneZoom's insight).
- Under **log**, show true counts on labels and a small **linear "ledger" gauge** in the corner, so compression never lies silently.

### Reframe 2: width × time = individuals (area honesty)

On a time axis there are two candidate width semantics:

- **W1, cumulative branch.** Width is constant along a branch and equals total individuals ever in the clade. This matches the literal spec, but it says nothing about *when* the individuals lived. It also can't turn smoothly into a generation lattice, because a species band would be constant-width while N(g) varies 10^6-fold.
- **W2, births-rate river.** Width at time t is ∝ births per unit time ≈ N(t) / generation_time. **Area = number of individuals.** The cumulative count is the band's area, which keeps the spirit of "width = individuals" as "ink = individuals".
  - At the deepest zoom, generation row g has height = generation time and width ∝ N(g)/gen_time, so each individual is **one unit-area cell**. That is the mesh.
  - Fast-reproducing microbes dominate the area, which is honest per-individual.
- **Recommendation:** W2 is the geometry. W1 is offered as (a) the clade label/ledger and (b) an optional "flow-tree" mode that shares topology and time placement with W2, so the two can morph.

### Reframe 3: anisotropic camera

OneZoom zooms uniformly because its fractal keeps every clade's aspect ratio bounded. A time-axis layout cannot: a clade can be 500 My tall and 10^-20 wide.

- Use an affine camera `(x0, sx, t0, st)` with **independent log-scales on X and Y**.
- Interpolate `log sx` and `log st` separately in fly-to animations, so the zoom stays continuous.
- Gestures:
  - Default pinch zooms both axes uniformly.
  - Double-tap a band to "fit clade", which sets both scales.
  - A two-finger pinch whose spread is clearly horizontal or vertical scales only that axis.
- Text and dots render in screen space, so nothing looks stretched.

---

## 3. Layout candidates

Scores run 1 (poor) to 5 (excellent).

| # | Layout | Width honesty | Time / extinction | Infinite zoom continuity | Mesh transition | Portrait phone | Procedural friendliness | Total |
|---|---|---|---|---|---|---|---|---|
| **A** | **Vertical time river** (nested streamgraph, LUCA bottom, now top, W2 area-honest) | 5 | 5 | 4 (needs anisotropic camera) | 5 | 5 | 5 | **29** |
| **B** | Vertical **flow-tree** (time-placed splits, constant-width W1 branches with conservation, like an icicle with y = time) | 4 | 4 | 3 | 3 | 4 | 5 | 23 |
| **G** | **Sankey ribbons** (bezier ribbons between time-placed nodes, merges allowed) | 4 | 4 | 3 | 4 (gene flow, hybrids) | 4 | 3 (crossing minimisation) | 22 |
| **C** | **Radial river** (LUCA centre, now at rim; Evogeneao/Hillis) | 3 (arc length ∝ radius distorts area) | 5 | 3 (locally becomes A) | 3 | 2 | 4 | 20 |
| **F** | Icicle (depth = rank) / sunburst | 5 | 2 (rank ≠ time) | 4 | 2 | icicle 4 / sunburst 2 | 5 | 21/19 |
| **D** | **OneZoom fractal spiral** | 3 | 1–2 (time only as colour/text) | 5 | 2 | 4 | 4 | 19 |
| **E** | Lifemap nested semicircles | 2 (√, random placement) | 1 | 4 | 2 | 3 | 3 (tile pipeline) | 15 |
| **H** | Hyperbolic / fisheye browser | 2 (distorts) | 2 | 4 | 2 | 3 | 4 | 17 |

Notes:

- **A** is the Romerogram/Evogeneao idea made rigorous. Nesting fixes the spindle diagram's paraphyly problem. A split is a flow-conserving fork: the parent band at t_split = the sum of its child bands. Children originate as threads at their origin time. Order siblings **inside-out by origin time**: older lineages central, later ones on the outside (Byron & Wattenberg 2008, *Stacked Graphs — Geometry & Aesthetics*). That minimises wiggle and keeps the drawing deterministic. Use screen-space 1 px gaps only between currently visible siblings, so honesty degrades by less than a pixel.
- **B** reads more like a "tree". It shows the literal "width = total individuals" spec, but gives no sense of when the individuals lived. Offer it as a toggle morph from A, not as the base.
- **G** is a **styling layer for reticulation** on top of A rather than a separate layout. Uses: mitochondria and plastids (endosymbiosis ribbons joining Eukarya), HGT threads among prokaryotes, hybridisation, and gene flow.
- **C**: polar(A). The same (x, t) coordinates map to (angle, radius), so a "poster" overview can morph into A as you zoom. Its circumference grows with time, which flatters late diversification but is not area-honest unless corrected. It wastes portrait space. Use it only as an optional overview skin or share image.
- **D** has the best zoom continuity of any candidate, but cannot place extinction in time. A dead trilobite clade would look like a living one painted gray. Take its engineering (re-anchoring, flights, LOD) rather than its shape.
- **F (sunburst)** puts the root in the centre of a circle. On a 9:19.5 screen, half the pixels are wasted and labels rotate.

### ASCII sketches

**A. Vertical time river, root view (linear-ish shares exaggerated for legibility)**

```
         ┌──────────── phone, portrait ────────────┐
   now ──┤ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ░░░░░░  ▒▒▒ ▒▒ ▒ ▒ │ ◄ green rim = alive
         │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ░░░░░░  ▒▒▒ ▒▒ ▒   │   (✝ gray tips = extinct)
  0.5 Ga ┤ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ░░░░░   ▒▒ ▒▒✝ ▒   │
         │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ░░░░░   ▒▒▒▒  ▒    │ ◄ Cambrian fan-out
    1 Ga ┤  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   ░░░░░    ▒▒▒▒▒     │
         │   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   ░░░░  ╭──▒▒▒       │ ◄ Eukarya leaves Archaea
    2 Ga ┤   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓~~~░░░░──╯ ▲          │ ◄ ~ mitochondrion ribbon
         │    ▓▓▓▓▓▓▓▓▓▓▓▓▓    ░░░                 │    (Sankey-style merge)
    3 Ga ┤     ▓▓▓▓▓▓▓▓▓▓▓    ░░░                  │
         │       ▓▓▓▓▓▓▓▓▓▓  ░░                    │
    4 Ga ┤          ▓▓▓▓▓▓▓░░                      │ ◄ LUCA (single band)
         │ LUCA › Life                [log]  ×1    │ ◄ breadcrumb + scale chip
         └─────────────────────────────────────────┘
   ▓ Bacteria  ░ Archaea  ▒ Eukarya (log shares; in linear they'd be hairlines)
```

**A, zoom sequence: species band → population braid → individual weave**

```
 zoom ≈ species          zoom ≈ populations           zoom ≈ individuals
 (band = flat fill)      (demes "tubes")              (pedigree weave)

 now ▒▒▒▒▒▒▒▒▒▒▒▒       ║ AFR ║  ║EUR║  ║EAS║        ●   ●   ●   ●   ●   ● ← alive (green)
     ▒▒▒▒▒▒▒▒▒▒▒▒       ║     ║╲ ║   ║╱ ║   ║        │╲ ╱│   │╲ ╱│   │╲ ╱
     ▒▒▒▒▒▒▒▒▒▒▒        ║     ║ ╳║   ║╲ ║   ║        │ ╳ │   │ ╳ │   │ ╳     edges to 2 parents
     ▒▒▒▒▒▒▒▒▒          ║     ║╱ ╲   ╱  ╲   ╱        │╱ ╲│   │╱ ╲│   │╱ ╲
     ▒▒▒▒▒▒▒            ║     ║   ╲ ╱    ╲ ╱         ○   ○   ○   ○   ○   ○ ← dead (gray)
      ▒▒▒▒▒             ║     ║    ║  OOA ║          │╲ ╱│ ╲   ╱    ╲ ╱│
       ▒▒▒  ← origin    ║     ╚════╝ ← split        ○   ○   ○ ···········○ ← rare long-range
                         ╲ ╱ = gene-flow threads                            migrant (faint arc)
```

**B. Flow-tree (cumulative widths, conservation at forks); lanes = green alive | gray dead**

```
 now   ║█▒║   ║█▒▒▒║          ║█║        ← green lane width = alive share
       ║█▒║   ║█▒▒▒║    ✝▒▒   ║█║        ← ✝ extinct: band ends in the past
       ║█▒║   ║█▒▒▒║    ║▒▒║  ║█║
       ╚═╦╝   ╚══╦═╝    ╚═╦╝  ║█║
         ╚══╦════╝        ╚═══╩╦╝
            ╚══════════╦═══════╝          ← branch widths sum at each fork
                    ║██▒▒▒▒▒▒║
 LUCA               ╚════════╝
```

**C. Radial river ("poster" projection of A)**

```
                 . · ' ' ' ' ' · .          rim = now (green arcs where alive)
             . '   ▒▒  ✝   ▓▓▓▓   ' .
           .   ░░░  ╲  ▒▒ ▓▓▓▓▓▓▓    .
          :  ░░░░░   ╲▒▒▒ ▓▓▓▓▓▓▓▓    :     iso-time arcs (Evogeneao style)
          :   ░░░░    ╲▒  ▓▓▓▓▓▓▓     :
           '    ░░░░   ●  ▓▓▓▓▓      '      ● LUCA at centre
             ' .   ░░░░ ▓▓▓▓▓    . '
                 ' · . . . . · '
   (portrait phone: top and bottom 25% of screen empty)
```

**D. OneZoom-style fractal spiral (for contrast)**

```
        @@  @                 Self-similar: each larger child continues
     @@  \ /  @@              the spiral, smaller children bud off.
       \  Y  /   @            Zoom continuity is perfect, but distance from
   @--- \/ \/ --@             the root means nothing temporal, so extinct
         \  /                 clades can't "end in the past".
          \/
          |
```

---

## 4. Recommended hybrid in detail: "River → Braid → Weave"

1. **Clade level (LUCA … genus/species): River (A).**
   - Band width = shares of births rate; area = individuals.
   - Colour:
     - Each band is split lengthwise into a **green lane** (width fraction = alive share of the clade's cumulative total under the current width mode) and a **gray lane**.
     - Any alive > 0 gets a 1 px green floor, so "not extinct" is never invisible (bacteria: alive/ever ≈ 10^-10).
     - Extinct clades have no green lane and taper out at their last occurrence.
   - Decision for the user: in log mode, should the green fraction be log-compressed? With `g(alive)/(g(alive)+g(dead))`, humans show ≈47% green and bacteria ≈43%. Linear shows 7% vs 10^-10. Recommendation: green follows the active width mode, and the ledger always shows the true %.
2. **Reticulation: Sankey ribbons (G)** layered on the river: endosymbioses, HGT (toggleable, can be dense), hybrid speciation.
3. **Species → populations: Braid.**
   - Species band subdivides into populations/subspecies with split, merge and admixture pulses, in the style of **demesdraw `tubes`**.
   - Real models can be pulled from **stdpopsim** / the **Demes** YAML format (e.g. human Out-of-Africa models).
   - Migration is drawn as thin diagonal threads whose density is ∝ migration rate.
4. **Populations → individuals: Weave.** The pedigree is laid out in generation rows inside the same band (see §5).
5. **Cross-cutting machinery:**
   - Hierarchical coordinates with re-anchoring. The camera = (anchor node path, local double affine). Re-anchor when the local scale exceeds ~10^6.
   - LOD by on-screen size, nodes culled below 0.5 px.
   - Label budget, hoptree breadcrumb, fly-to search.
   - Optional log-time toggle (demesdraw uses `log_time=True` for the same reason).
   - Optional radial poster skin.

**Semantic zoom thresholds** (computed per band from px per individual: `px_i = bandwidth_px / N(g)`, `row_px = gen_time × st`):

| px per individual | Render |
|---|---|
| < 1 | flat band fill (+ lanes, + subtle noise texture hinting at "grain") |
| 1–6 | instanced dots only (WebGL points), green/gray by alive status |
| 6–40 | dots + parent edges for visible rows only |
| > 40 | dots + edges + `human#…` labels + tap cards |

Cross-fade over about one octave of zoom at each threshold. The band never changes position, so the transition looks like a texture resolving rather than a scene change.

---

## 5. Mesh rendering below species

### Lessons from ARG / genealogy visualization

- **tskit / tree sequences** are the canonical compact encoding of genetic genealogies. **tsbrowse** (Karthikeyan et al. 2025) and **tskit_arg_visualizer** (Kitchens & Wong 2025) show the state of the art.
  - The visualizer fixes **y = time** and sample x, and lets a **D3 force simulation** pick the remaining x. Its docs admit it ignores edge crossings and needs manual fiddling.
  - **ARGscape** is also D3 force-based.
  - Lesson: **force layouts do not scale to ToLaD and are not deterministic or stable under zoom.** Fix both coordinates procedurally: y = birth generation, x = index within the generation (which equals spatial position).
- **GeneaQuilts** (Bezerianos et al. 2010) used matrix "quilts" for thousands of individuals. Lesson: **strictly layered (generation-row) layouts** are what scale. Its stated weakness is no sense of absolute time, which ToLaD avoids by using real time on y.
- **Genealogical vs genetic ancestry.** Genealogical ancestors grow ~2^k per generation back; genetic ancestors grow roughly **linearly** (Coop). Offer a toggle: "show genealogical ancestors" (full cone) vs "show genetic contributors" (a sparse subset sampled deterministically).

### Why pedigree meshes are visually friendly: fast convergence

- In a two-parent Wright–Fisher population of size N, the MRCA of everyone lies ~**log2 N** generations back (Chang 1999).
- At ~**1.77·log2 N** generations, the **identical ancestors point** is reached: every individual then is either an ancestor of *all* present individuals or of none.
- With realistic geography (Rohde, Olson & Chang 2004, *Nature*), the human MRCA is only a few thousand years ago and the IA point a few thousand more.

Consequences for the viz:

- Tap any individual and its **ancestor cone** widens 2^k per generation. After ~log2 N rows it fills the whole band. Draw a horizontal dashed "identical ancestors" line there.
- The **band itself is everyone's ancestry**. When you zoom out, the weave dissolves into the fill, which is literally true and makes the tree above and the mesh below the same object.
- **Descendant cones** forward in time either fill the band (the lineage "won") or die out. An individual with no living descendants can get a distinct desaturated gray. Population extinction is the whole band's cone dying.
- **Asexual lineages** (1 parent) make the weave a forest of coalescing trees. Drawn with the same edge style, the micro-level visibly echoes the macro tree ("trees all the way down"). HGT can appear as rare cross-links.
- **Species origin** in the mesh: where gene-flow threads between two sub-bands stop, the braid separates into two bands. That is exactly the fork in the river above. Incomplete lineage sorting is visible for free.

### Edge drawing at scale

- Draw only edges whose child **and** at least one parent are in the viewport ± 1 row. Otherwise fade-clip at the band edge.
- Short local edges are straight. Rare long-range migrant edges are faint arcs with alpha ∝ 1/length, optionally **edge-bundled** toward population centroids.
- The highlighted cone uses additive blending, so overlapping inbreeding loops brighten. Pedigree collapse becomes visible as bright knots.

---

## 6. Procedural deterministic individuals

### 6.1 Addressing

```
global address  = clade path (taxonomy / procedural pseudo-clades)
                → species S → [population p] → generation g → index i ∈ [0, N_S(g))
species serial  k = C_S(g) + i              (C_S = cumulative births before gen g)
public ID       "human#" + P_S(k)           (P_S = keyed bijection on [0, T_S), T_S = total ever)
```

- **Cumulative first.** Define a monotone `F_S(g)` from population estimates and set `C_S(g) = floor(F_S(g))` and `N_S(g) = C_S(g+1) − C_S(g)`. Exact consistency is free.
  - Inverting `k → (g, i)` is a binary search on g: O(log G) with BigInt comparisons.
  - Use **piecewise segments with closed-form integer sums**: piecewise-constant or arithmetic within short segments, with a precomputed BigInt prefix table per species.
- **Determinism gotcha:** `Math.exp`, `Math.log` and `Math.pow` are **not guaranteed bit-identical across JS engines**. Only `+ − × ÷ sqrt` are IEEE-exact. Keep the ID/parent path **integer-only**, or ship a fixed-point exp/log. Floats are fine for rendering only.
- **Unifying principle, conserved-count recursive splitting at every level.** The root total (~10^40) is split deterministically down the real taxonomy using estimated counts. Unknown diversity (e.g. ~10^12 microbial species) is filled with **procedural pseudo-clades**, then populations, generations, and individuals. Every node's count is the sum of its children's, and every split is seeded by `hash(seed, node_path)`. The same code path serves the layout shares, the labels and the mesh.

### 6.2 Bijective scrambled IDs: Feistel + cycle walking

- `P_S` should be a **keyed Feistel network** over `w = ceil(log2 T_S)` bits (rounded to even, or unbalanced). Use 4–6 rounds and **cycle-walk** until the result is < T_S (Black & Rogaway 2002). The expected number of walks is < 4, or < 2 with a tighter unbalanced split.
  - This is the technique behind format-preserving encryption (NIST FF1/FF3-1) and masscan's "blackrock" table-free shuffle.
  - It is invertible: `P_S^{-1}` runs the rounds backwards, so `human#49837299 → (g, i)` works.
- The round function is an integer hash: SplitMix64, PCG, xxHash/Murmur via `Math.imul`, or Squirrel Eiserloh's "noise-based RNG" pattern (GDC 2017), which is position-hash-as-RNG and fits lazy generation exactly. This doesn't need to be cryptographically strong.
- Product choice: scrambled IDs (`human#49837299` is a random human), or chronological serials (low numbers = earliest humans)? Scrambled looks better and hides the generation structure. Show the birth date on the card.

### 6.3 Big numbers in JS

| Range | Representation |
|---|---|
| < 2^53 (most per-generation indices of multicellular species, all human serials ≈ 2^37) | `Number` fast path |
| ≥ 2^53 (microbe generations: Prochlorococcus ~10^27 alive; global totals ~2^133) | `BigInt` or fixed 4×32-bit limbs |
| Hot loops (hash, Feistel, binomial splits per frame) | Consider a **Rust→WASM core with native `u128`**. BigInt is heap-allocated and roughly an order of magnitude slower than Number ops |

Render-side coordinates never need BigInt. Use **re-anchored local doubles**, with the anchor's node path giving the exact position.

### 6.4 Coalescent-consistent parent ↔ child links: recursive binomial splitting

Goal: from child (g, i) find its 1–2 parents in g−1, **and** from a parent find its children in g. Both must be O(log N), stateless and stable.

```
Generation g-1 (size M):  apply local shuffle L_{g-1} (brick-wall windows, offset alternates by g)
                          pair adjacent shuffled positions into K = M/2 couples (asexual: K = M singles)
Generation g   (size N):  distribute N children over K couples by a balanced binary split tree:

  split(node=[a,b), n):                    # n children to place under couples a..b-1
      if b - a == 1: couple a gets n
      m  = (a+b) >> 1
      nL = Binomial(n, (m-a)/(b-a); rng = hash(seed,S,g,a,b))   # or Beta-Binomial for sweepstakes
      split([a,m), nL);  split([m,b), n-nL)

  children of couple j  = contiguous index range [prefix_j, prefix_j + c_j)  in gen g
  parents(child i)      = descend the split tree comparing i to nL at each node → couple j
  children(couple j)    = descend the same tree to j, summing left counts → prefix_j, c_j
```

- Both directions take O(log K) hash + binomial draws, and the same seed gives the same answer forever.
- **Large-n binomial:**
  - Use exact inversion for small n.
  - For large n, use a deterministic **integer-safe normal approximation** with an inverse-CDF table, avoiding float `Math.log`.
  - **Beta-binomial** splitting raises offspring variance, which lowers Ne. Use it for sweepstakes reproducers (cod, oysters).
- **Locality vs convergence.** Contiguous child ranges keep edges short and near-vertical, because children sit right above their parents. Pure locality, though, gives slow diffusive mixing and sib-mating. Fixes:
  - Local brick-wall shuffle `L_g`: a small Feistel within windows of width w, with the window offset alternating each generation. This gives 1D stepping-stone dispersal.
  - **Rare long-range migrants:** a fraction ε of couples draws a partner via a global Feistel permutation. This is small-world mixing, so ancestry still saturates within ~log2 N + (spatial lag) generations, consistent with Rohde et al.'s structured-population result. These are the faint arcs in the sketch.
  - Population structure: the window shuffle is restricted to a population's sub-range, and migration = partner or parent drawn from a neighbouring population's range at rate m (from the demes model).
- **Overlapping generations** (humans, trees): keep discrete generation rows as the backbone and **jitter displayed birth dates** within the generation interval (cosmetic, deterministic).
- **Real and mock records:**
  - A sparse **overlay table** pins real individuals to slots (S, g, i) and overrides specific edges. Procedural generation fills everything else.
  - Overrides are checked first in both lookup directions.
  - MOCK real individuals carry an explicit `mock: true` flag rendered as a badge.

### 6.5 Attribute generation

`attrs(S, g, i) = f(hash(seed, S, g, i, field))`, covering sex, lifespan, cause of death, locality, display birth date and any traits.

- Inherited traits use hash-mixing of the parents' trait hashes. That is consistent because parents are computable.
- **Alive status** is not random: alive ⇔ display birth date + lifespan > now. This keeps green/gray consistent with the lanes and the rim.

---

## 7. Open questions and risks

1. **Width semantics.** The user said "branch width = number of individuals". Confirm that "area = individuals (river)" + "cumulative width (flow-tree mode/ledger)" is acceptable, or make B the default and A the toggle.
2. **Green in log mode.** The green-lane formula needs a decision (see §4).
3. **Anisotropic zoom UX.** It needs prototyping on real phones. Fallback: uniform zoom plus auto "fit clade" on double-tap.
4. **Microbial scale.** A Prochlorococcus band at 20-minute generations means ~10^14 rows. That is fine lazily, but deep-time population curves for microbes are pure modelling. Label them "modelled".
5. **HGT density** in prokaryotes could swamp the river. Keep it off by default and show it as a band texture rather than individual ribbons.
6. **Cross-engine determinism.** Ban transcendental float math in the generation path from day one, and add golden-value tests (fixed IDs → fixed parents/attributes) to CI.

---

## Sources

- Rosindell & Harmon 2012, *OneZoom: A Fractal Explorer for the Tree of Life*, PLoS Biol: https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.1001406
- Wong & Rosindell 2021, *Dynamic visualisation of million-tip trees: the OneZoom project*, MEE (preprint): https://www.biorxiv.org/content/10.1101/2020.10.14.323055v1.full-text
- OneZoom about page: https://www.onezoom.org/about
- de Vienne 2016, *Lifemap: Exploring the Entire Tree of Life*, PLoS Biol: https://pmc.ncbi.nlm.nih.gov/articles/PMC5179005/
- R. Page 2026, *A new way to view the Tree of Life* (OTT Viewer, summary trees, hoptrees): https://rogue-scholar.org/records/zhrd3-b6k05 ; https://iphylo.org/ott-viewer
- Open Tree of Life web app: https://github.com/OpenTreeOfLife/opentree
- DeepTree / Life on Earth (Block, Horn et al. 2012): https://scholar.harvard.edu/sites/scholar.harvard.edu/files/chiashen/files/deeptree_sdr_harvard.pdf ; zoom-interpretation study: https://link.springer.com/article/10.1007/s10956-020-09893-x
- Evogeneao Tree of Life (L. Eisenberg): https://www.evogeneao.com/en/learn/tree-of-life ; FlowingData note: https://flowingdata.com/2018/10/25/tree-of-life
- Hillis plot: https://sites.utexas.edu/antisense/download-hillis-plot-tree-of-life/
- Spindle diagrams / paleoDiv: https://theropod1.r-universe.dev/paleoDiv/doc/Paleobiodiversity_analysis.html
- Phylo.io: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4948708/ ; Iroki: https://peerj.com/articles/8584 ; iTOL v6: https://pmc.ncbi.nlm.nih.gov/articles/PMC11223838/
- Taxonium (Sanderson 2022, eLife), WebGL large-tree viewer (from prior knowledge)
- Byron & Wattenberg 2008, *Stacked Graphs — Geometry & Aesthetics*, IEEE TVCG (from prior knowledge)
- Crockford et al. 2023, cells ever lived 10^39–10^40, Current Biology: https://carleton.ca/news/story/how-much-life-existed-on-earth/
- tsbrowse (Karthikeyan et al. 2025): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12342996/
- tskit_arg_visualizer (Kitchens & Wong 2025): https://github.com/kitchensjn/tskit_arg_visualizer ; https://arxiv.org/html/2508.03958v1
- ARGscape: https://arxiv.org/pdf/2510.07255
- Demes format & demesdraw: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9630982/ ; https://github.com/grahamgower/demesdraw
- GeneaQuilts (Bezerianos et al. 2010): https://aviz.fr/geneaquilts
- Chang 1999, *Recent common ancestors of all present-day individuals*: https://resolve.cambridge.org/core/journals/advances-in-applied-probability/article/abs/recent-common-ancestors-of-all-presentday-individuals/330372AB57FB1CB3839FAAA46CF81B66
- Rohde, Olson & Chang 2004, Nature: https://www.nature.com/articles/nature02842 ; https://en.wikipedia.org/wiki/Identical_ancestors_point
- Coop, genetic vs genealogical ancestors: https://gcbias.org/2017/11/20/our-vast-shared-family-tree/
- Matsen & Evans, *To what extent does genealogical ancestry imply genetic ancestry?*: https://arxiv.org/pdf/0805.0634
- Format-preserving encryption / cycle walking: https://en.wikipedia.org/wiki/Format-preserving_encryption ; Bellare et al.: https://eprint.iacr.org/2009/251 ; masscan blackrock write-up: https://xfnw-orgwiki.pgs.sh/blog/blackrock.html
- Kelleher et al., msprime 1.0: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9176297/
- S. Eiserloh, *Noise-Based RNG*, GDC 2017 (from prior knowledge)
