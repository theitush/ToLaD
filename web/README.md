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
- **Individuals** (`twigs.ts`): a column's width at every height is the individuals alive
  there (procgen, `packages/procgen`; `speciesModel`). The texture of individuals drawn
  inside the columns (lines, lives, threads to the parents) was deleted (ToLaD#342): the
  columns are their green and gray lanes.
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
  under the fingers fixed in world units. Step grids morph, so no level of detail switches back and forth (`camera.test.ts` scripts smooth
  pinches and pans and checks for jumps and flip-flops).
- `node scripts/fanshot.mjs [out] [prefix]` screenshots `dist-single` at 390×844
  (`STEPS_FILE` = JSON list of `[name, js]` steps run against `window.__fan`;
  `CLIP=x,y,w,h` keeps only part of the page).

Known limits: the green lane holds the living by index slot, and only ~⅓ of slots hold
someone alive now, so deep in it the living strands are sparser than one per slot. The
two greens (deep = alive, pale = dead with living descendants) appear only inside the
mesh; in the fan's lanes the pale-green share is under a pixel in linear mode. Parent
threads can be long, because procgen parents sit several slots away.

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

