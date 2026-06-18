# Glade — Vision & Roadmap

> Stored so it outlives any single session. This is the "what Glade really is"
> teardown and the plan that grew from it.

## What Glade actually is (under the marketing)

Glade is ~420 lines of zero-dep Node that shells out to a coding harness
(`claude -p` / `codex`) with a hardcoded system-prompt prefix, watches its
stdout, and writes files into two folders the browser hot-imports. That's the
whole trick — and the trick is the point.

**The soul of Glade is the collapse of "using an app" and "building an app"
into one spoken surface.** The prompt bar and the canvas are the same place.
Every other AI app-builder makes you leave the artifact to edit it (you're in a
chat *about* a thing). Glade has no chat — you speak, the room rearranges.

Design law that follows from this: **never reintroduce the seam.** No settings
page, no separate editor, no build step, no chat panel. The moment Glade makes
you leave the room to change the room, it's just another builder. Every feature
must either (a) widen what you can speak into existence, or (b) make the spoken
world safer / more alive.

## Honest weaknesses we are fixing

1. **No blast-radius control.** Harness runs with `bypassPermissions`, writes
   straight into the repo, no history, no undo. One bad prompt = gone.
2. **Failover is regex theater.** `LIMIT_RE` greps free text for "quota/429".
   Will misfire on any widget that *displays* status codes.
3. **No "the build failed" concept.** Broken widget.js just renders an error.
4. **The generation window is a screensaver** — six blurred stock JPEGs on a
   loop, identical every build, conveying nothing.
5. **Widgets aren't isolated** — all `import()`ed into one global page; one
   `position:fixed` or global `keydown` stomps everything.
6. **The foundation underuses the machine** — no streaming, no websockets, no
   long-running processes, no widget-to-widget comms, no terminal.
7. **No harness switch from the UI** (config-file only; `getState` already
   ships `harness` but nothing consumes it).

## The plan (tiers)

### Tier 1 — tighten the core loop (load-bearing)
- [ ] **Snapshots + undo/history.** Snapshot widgets+backends+manifest before
  every generation into `.glade/history/<ts>`. `/api/history`, `/api/restore`,
  `/api/undo`. The safety net everything crazier stands on.
- [ ] **Paste/drop/attach anything**, not just images. CSV→table, URL→player,
  JSON→inspector, PDF→reader, sqlite→query console. Generalize `saveImages`.
- [ ] **Command palette** (`/`): switch harness, undo, history, clear canvas,
  re-run last, save/open room, voice. Harness picker is its first citizen.
- [ ] **Live build feed** — replace the screensaver with the actual work
  accreting (files appearing, tool/thought events). The mysticism made real.

### Done — the multiplayer bone
- [x] **`ctx.state`** — per-widget server memory that survives backend
  hot-reloads. Without it, module-scope state is wiped every call, so shared /
  multiplayer / pub-sub state was impossible. With it: SSE down + POST up +
  ctx.state world = real-time multiplayer with zero new deps.

### Tier 2 — make the foundation a platform
- [ ] **Widget bus** — `glade.emit/on`. Cards stop being islands; clock drives
  pomodoro, location feeds weather+maps, selection filters another widget.
- [ ] **glade.fetch proxy** — kill the hand-rolled https.get in every backend.
- [ ] **glade.store** — namespaced persistence for widgets.
- [ ] **Streaming backends** — SSE / `glade.subscribe` for log tailers,
  tickers, monitors, chat. Things that *live*, not just *fetch*.
- [ ] **Terminal** — xterm.js (or pure-node pipe-shell) in a glass card. A
  self-extending dev env that can't open a shell is fighting its nature.
- [ ] **Network reach** — bind 0.0.0.0 + LAN URL/QR; (later) ephemeral tunnel.

### Tier 3 — constructs (the speed argument)
- [ ] **Version-pinned ESM import-map** of *leaf* libs the harness is told
  about in CLAUDE.md (three, d3, chart.js, codemirror, marked, dompurify,
  maplibre, uplot). Not frameworks — leaf libs you call, that don't call you.
  Stops the agent re-deriving the same wheel on every cold start.

### Tier 4 — the mysticism tier
- [ ] **Glade builds Glade** — explicit, snapshot-protected self-modification.
- [ ] **Rooms/scenes** — name, save, summon whole canvases by speaking.
- [ ] **Voice + ambient input** — Web Speech API hold-to-talk.
- [ ] **Spoken / draggable layout** — placement persisted, not dumb auto-grid.
- [ ] **Introspection widget** — Glade made legible to itself.

## Library / service references
- esm.sh — no-build ESM CDN (pin exact versions; `?pin` removed in v136, use
  `?deps=pkg@ver` + versioned path; mirror locally for offline).
- xterm.js + node-pty (node-pty is native — relax zero-dep for the shell, or
  use a degraded pure-node pipe-shell).
- Import maps are cross-browser native now.
</content>
</invoke>
