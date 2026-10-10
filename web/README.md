# ToLaD web

## Main view: the Panthera fan (`src/fan/`)

The default page is a OneZoom-style fan of one polytomy, the big cats (Panthera), with
real numbers from `data/mammals` (tile 10, hard-coded in `panthera.ts`). The rules:
width = individuals, green = alive, gray = dead, height = time.

- **Height = time** on a log years-before-present axis (`TimeScale`, offset `TIME_C` =
  10 yr, about a big cat's lifespan, so the taper has no kink near "now"): the fork is
  Panthera's origin, living species reach the "now" line, extinct ones stop at their last
  appearance. The axis is always shown.
- **Width** at any height = the individuals whose strands pass through it (not yet dead),
  as linear (default) or log sibling shares, one fixed world width per individual (the
  scale bar's number). A branch is everyone ever at its base and thins as dead strands
  peel off; at the tip only the living remain. The gray edge is drawn as **steps**
  (`layout.ts Steps`): grids of 2^k equal heights (equal log-time bands) from the fork to
  "now", nested, each step holding the branch's exact width averaged over its height
  (adaptive Simpson), so a step is the individuals at some height inside it and the area
  is kept. The grid shown is the one whose steps are 22–44 px tall on screen (`STEP_PX`);
  over the top 40% of each octave of time zoom the steps slide to their halves' widths
  (`STEP_BLEND`), so zooming never pops. Step lines are fixed in world units; panning
  never changes them. The green lane has
  one width from base to tip (log mode: W·g(alive)/g(ever)), only the gray peels off. The
  stem is drawn as its children's strands side by side, so each green lane runs unbroken
  from now to the root (1 px floor).
- **Individuals** (`twigs.ts`): zooming in, the same two lanes resolve into strands; there
  is no switch to another picture. Procgen (`packages/procgen`; `speciesModel` builds a
  constant-size model from ever, alive, span and generation length) gives the individuals.
  - Green lane: one deep-green strand per index slot holding someone alive now, from now
    all the way down: green lines all the way back.
  - Gray lane: one strand slot per procgen index (procgen keeps children near their
    parents in index space, so a slot is roughly a family line). Each dead individual's
    life is drawn on its slot: pale green if it has a living descendant, gray if its line
    ended. Dead tips stop 3 px short of "now".
  - Threads: each child's mother thread (the line the strands and the lineage search
    follow) and a thinner father thread (the interbreeding mesh) curve up from the parent's
    strand into the child's base. Threads end exactly on procgen's `parents()`.
  - Continuity: the green lane turns into a texture of its strands once the width scale
    bar reads ~100 individuals (`TEXTURE_IND`: from 150 down to 50, while strands are still
    well under a pixel apart): ~1 px columns that keep their fraction of the lane, each as
    bright as the share of its index slots holding someone alive now, with the lane dimmed
    under it. As strands get 2–10 px apart they fade in (the texture fades out) while the
    lane dims under them. Then individuals, threads, and `lion#…` handles appear. Every line
    drawn is a real strand or individual (no flow lines or grooves). The gray lane has a
    texture of its own dead (`grayTexture`) from ~100 individuals per scale bar, or as
    soon as its slots are pixels apart, until there are few enough lives on screen to draw
    each (6000, fading over the last half): cells of a slot (every s-th index, s a power
    of two, ≥2 px apart) by a band of t generations (t a power of two, ~6 px tall), each
    as bright as the real lives on it cover the band (their own lifespans) and pale green
    if they have living descendants. Finer slots fade in over the octave. Threads to the
    parents fade in from 4 px strands (and as they get few enough), not at a switch.
    Gray strands follow the stepped lane: straight within a step, resuming at their new x
    after a step line. Only visible generations, index ranges and texture cells are
    computed.
  - "Has a living descendant" is exact (children, then down the mother line) within a
    lookup budget; past it, a critical-branching estimate decides, deterministically.
- **Layout** (`layout.ts`): a rectangular tree, fixed in world units; nothing depends on
  the camera but the step grid. Below the fork the stem is its children's slices side by
  side (no gaps). Just above it each child jogs sideways over `JOG` (1 world unit; a
  sheared band, so its horizontal width never changes) to its column: a straight vertical
  band up to its tip. Columns sit in tree order with a fixed gap: 20% of the smaller
  neighbour's base width, at least 2.5% of the stem's (`gapBetween`). The green lane runs
  along each column's left edge, the gray lane steps narrower on its right; black space
  opens near "now" as the gray lanes thin. Labels stand on the column tops, biggest
  species first (one that would overlap waits for a closer zoom), kept on screen and clear
  of the buttons (pushed down beside their tip if needed).
- **Camera** (`camera.ts`): axis-aligned, never rotated or sheared. One uniform pinch
  (shift/alt+wheel zoom one axis). Limits: 10 years take at most 10% of the screen
  (`MAX_YEARS_FRAC`), so it always spans ~100 years or more (the camera keeps the requested
  time zoom `ty` and shows the capped one, so zooming out undoes a zoom-in; zooming in just
  below "now" stops while "now" is on screen, pan down to go further); width zoom-in stops at ~90 px per strand (nothing leans, so there is no slope limit);
  zoom-out stops at the whole fan; panning keeps part of the fan on screen. Living strands
  are exactly vertical (left-aligned lanes). Double-tap fits a branch, then zooms 16× in
  width and 2× or more in time, stopping when the strands of the lane under the finger are
  ~90 px apart. In the green lane it lands on a living strand. Tap a branch for the
  species card, an individual for the `lion#…` card.
- **How well the history is known** (`history.ts`, `view.drawHistoryEdge`): for species
  whose curated history drives the counts (lion, tiger, snow leopard), the branch's outer
  (gray, right) edge carries the history's honesty at each height. Spans held at a
  measured level are drawn plain; interpolated or modelled spans get a subtle dashed line
  on the edge, grade D or unverified spans a fainter dotted one (`spanStyle`,
  `historySpans`, `EDGE_DASH`). The patterns are in screen pixels and anchored to the
  "now" line, so they look the same at every zoom and move with the branch. The green lane
  edge stays plain: its width is the number alive now, a single figure. A dot coloured by
  grade (`GRADE_COLOR`: A blue, B violet, C amber, D red) marks each data point's year on
  the edge; a dot shows once it is 9 px below the last one shown and the branch is a
  few px wide there, fading in with zoom (a census a year after the last waits). Species without a history are drawn as before
  (their even spread is a model too, but nothing marks it yet).
- **Species card**: with a history, a sparkline of log(population) against year: points
  coloured by grade with their ranges as bars, the spans between them solid, dashed or
  dotted like the edge (`styleBetween`). Tap it for every point: year, n (range), grade,
  kind, the citation linked to its source, and the note. The list scrolls (max 34% of the
  screen height), so the card stays under the width scale bar. A history shown only
  (`use = "display"`, the leopard) says it does not drive the widths.
- **Ribbons** are built in screen space from the breakpoints (stem end, fork, jog, the
  step lines on screen, tip) and clipped to the screen in float64 before they reach the
  canvas.
- **No flashing**: the old view-referenced packing (`Pack.setRef`) re-anchored the camera
  every frame and changed the shapes under it; it is gone, and the camera keeps the point
  under the fingers fixed in world units. Step grids morph, texture lattices and links
  fade, so no level of detail switches back and forth (`camera.test.ts` scripts smooth
  pinches and pans and checks for jumps and flip-flops).
- `node scripts/fanshot.mjs [out] [prefix]` screenshots `dist-single` at 390×844
  (`STEPS_FILE` = JSON list of `[name, js]` steps run against `window.__fan`;
  `CLIP=x,y,w,h` keeps only part of the page).

Known limits: the green lane holds the living by index slot, and only ~⅓ of slots hold
someone alive now, so deep in it the living strands are sparser than one per slot. The
two greens (deep = alive, pale = dead with living descendants) appear only inside the
mesh; in the fan's lanes the pale-green share is under a pixel in linear mode. Parent
threads can be long, because procgen parents sit several slots away.

The time river is still there at `?river`.

## Time river (`?river`)

The river shows the real mammal dataset (`../data/mammals`, format v1) as a births-rate
time river; `?synthetic` brings back the spike's infinite synthetic tree.

- `src/data/`: `river.ts` decodes a `.tld` file and lays it out (pure, runs in the data
  worker `worker.ts` and in tests); `tile-source.ts` is the `TreeSource` that loads the
  skeleton, then tiles when a stub is on screen; `names.ts` has display names (a small
  hand-made common-name table: v1 data has scientific names only).
- `npm run build:single` writes `dist-single/index.html`: JS, CSS and all data (base64)
  in one file that works from `file://` with no network (`node scripts/check-single.mjs`).
- `node scripts/shot.mjs` screenshots the opening view and named clades;
  `npm run perf` runs the real-data perf phases (`PERF_SYNTH=1` for the spike's dives).

The rest of this file describes the spike.

This spike tests the two hardest problems before any real data exists:

- **Deep-zoom numerics.** It zooms more than 1000 levels into an infinitely deep synthetic tree with no jitter, cracks or teleporting.
- **Mobile performance.** It uses a WebGL2 instanced-band renderer.

See `../research/00-synthesis.md` (plan step 0) and `../research/03-rendering.md` §3 and §8.

```bash
npm install
npm run dev -- --host     # dev server on the LAN, port 5173
npm test                  # Vitest: tree, camera/frame math, 1000+ level continuity test
npm run build             # type-check + production build into dist/
npm run perf              # headless Chromium mobile-emulation perf run (needs a build first)
```

Add `?debug` to the URL, or press the **debug** button, to open the overlay. It shows:

- the anchor node id and depth;
- the x/t zoom exponents;
- frame time (avg/p95) and the CPU part of it;
- instance, draw-call and chunk counts.

Debug mode also outlines every drawn chunk in orange.

## Controls

| | Touch | Desktop |
|---|---|---|
| Pan | one finger drag | mouse drag |
| Zoom (both axes) | pinch | wheel / trackpad pinch |
| Zoom width only / time only | – | shift+wheel / alt+wheel |
| Fit a clade | double-tap a band (again: its parent) | double-click |
| Back to LUCA | **LUCA** button | same |
| Linear ↔ log widths | **linear/log widths** button (animated) | same |

Pan and zoom carry momentum. Zoom momentum decays in log-zoom space.

## Layout of the code

Everything under `src/engine/` is plain TypeScript. React (`src/App.tsx`) only mounts the canvas and the buttons. Camera and per-frame state never go through React.

| File | What it does |
|---|---|
| `tree.ts` | `TreeSource` interface (`root`, `children`, `info`) and `SyntheticTree`. The synthetic tree is infinitely deep and deterministic. Structure (2–4 children, integer weights, integer start/end times, extinct or surviving) is decided by `Math.imul` hashing only. Task `river` swaps real tiles in behind this interface. |
| `layout.ts` | Nested sibling shares `g(n)/Σg`: linear g = n, log g = 1 + log10 n. The shares are precomputed per node and mixed by `mix` for the animated toggle. The green lane fraction follows the active mode. Also does chunk membership and memory pruning. |
| `frame.ts` | Float64 frame math. A frame maps a node's local `[0,1]²` to the screen with **separate width (kx) and time (kt) scales**. |
| `camera.ts` | Re-anchoring camera: an anchor node plus a float64 frame. It descends into the child under the screen centre once that child is ≥ 64 px on both axes, and ascends when the anchor drops under 32 px or the centre leaves it. Every number it handles stays roughly screen-sized at any depth. |
| `scene.ts` | Decides what to draw each frame. **Chunks** span ≤ 4 levels and ≤ 1:1000 scale per axis. Their geometry is stored once as float32 in the chunk root's frame, and per frame only one float64-composed transform per chunk is computed. Nodes too big for float32 (ancestors around the anchor) go through a float64 **near path** that clips them to the viewport in screen space. A child chunk only opens once its root covers ≥ 32×32 px. Until then, a flat proxy band in the parent chunk stands in for it. This cut per-frame scene cost about 7× during fast dives. |
| `renderer.ts` | Raw WebGL2. One instanced draw per chunk. Each node is drawn as tapered trapezoids: thread → band, plus a taper-out for extinct clades. Side edges get analytic AA in the fragment shader, and the green/gray lane split is AA'd too. Any clade with something alive gets a 1 px green floor. |
| `input.ts` | Pointer Events (`touch-action: none`), pinch about the centroid, wheel, double-tap, and fling velocity. |
| `engine.ts` | Glue. Renders on demand, caps DPR at 2, and drops resolution to 0.75× during gestures if frames are slow. LOD adapts OneZoom-style. Also runs the animations: log/linear, fit-clade flights interpolated in log-scale per axis, and inertia. Exposes test hooks on `window.__tolad`. |
| `dive.ts` | Scripted zoom into a pseudo-random descendant chain. Used by the continuity test and the perf run. |

## Open it on a phone (WSL2)

`npm run dev -- --host` binds to all interfaces inside WSL2. WSL2 sits behind a NAT, though, so the phone can't reach that address directly. Pick **one** of the options below. In every case the phone and the PC must be on the same Wi-Fi (except option 3).

### Option 1: mirrored networking (Windows 11 22H2+, simplest long-term)

1. Put this in `%UserProfile%\.wslconfig` on Windows:
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
2. Run `wsl --shutdown` in PowerShell, then reopen your WSL terminal.
3. Allow inbound traffic through the Hyper-V firewall once, in an **admin** PowerShell:
   ```powershell
   Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
   New-NetFirewallRule -DisplayName "Vite 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
   ```
4. Run `npm run dev -- --host`.
5. On the phone, open `http://<your PC's Wi-Fi IP>:5173`. To find that IP, run `ipconfig` in Windows and look at the "Wireless LAN adapter Wi-Fi" IPv4 Address.

### Option 2: port proxy (default NAT mode)

In WSL, get the WSL IP:

```bash
hostname -I | awk '{print $1}'      # e.g. 172.31.138.216
```

Then in an **admin** PowerShell on Windows:

```powershell
netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=172.31.138.216
New-NetFirewallRule -DisplayName "Vite 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
```

Open `http://<your PC's Wi-Fi IP>:5173` on the phone.

The WSL IP changes after each reboot or `wsl --shutdown`. When it does, re-run the `netsh` line (`netsh interface portproxy reset` clears old entries).

To undo everything:

```powershell
netsh interface portproxy reset
Remove-NetFirewallRule -DisplayName "Vite 5173"
```

### Option 3: a tunnel (no Windows changes, works off-LAN too)

```bash
npm run dev -- --host
# in a second WSL terminal:
npx cloudflared tunnel --url http://localhost:5173
```

It prints a `https://….trycloudflare.com` URL; open it on the phone. `ngrok http 5173` works the same way. `vite.config.ts` sets `server.allowedHosts: true` so the tunnel host isn't rejected.

Tunnels add latency to page loads, not to rendering, so frame times measured on the phone are still valid. They also give you HTTPS, which some phone browser features require.

### What to measure on the device

1. Open `/?debug`.
2. Pinch and pan at the root, then dive deep. Double-tap repeatedly to fly down a lineage, or keep pinching.
3. Repeat at depth 1000+. The anchor depth is shown in the overlay.
4. Note the `frame avg / p95` line.

Target: 60 fps (≈16.7 ms) at depth 10^3+ on a mid-range Android and on an iPhone. If the phone has remote debugging enabled (Chrome `chrome://inspect` / Safari Web Inspector), you can reach depth 1000 instantly from the console:

```js
__tolad.diveInstant(1000)
__tolad.diveAnimated(50)
```

## Performance run (headless)

`npm run perf` starts `vite preview` and opens the app in headless Chromium (Playwright) with these settings:

- a 390×844 viewport;
- DPR 3 (the backing store is capped at DPR 2, so 780×1688);
- touch enabled;
- **4× CPU throttling** via CDP.

It then replays real touch pinches and pans through CDP `Input.dispatchTouchEvent` (they arrive as Pointer Events), at the root and at ~1000 levels. It also runs animated dives (0 → 60 and ~1000 → ~1060 levels) and a log/linear toggle. Every frame is recorded.

Output goes to `perf-out/`: `perf.json` plus screenshots.

**Caveat:** headless Chromium has no GPU, so WebGL runs on SwiftShader (software rasterisation on the CPU), throttled 4× on top. The frame *interval* numbers are therefore dominated by software fill of ~1.3 MP and are **not representative of a phone**. The *cpu* column (JS + GL command submission per frame) is the more meaningful number. Real devices are the real test.
