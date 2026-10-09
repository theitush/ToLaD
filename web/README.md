# ToLaD web

The app now shows the real mammal dataset (`../data/mammals`, format v1) as a births-rate
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
