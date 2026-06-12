# ✦ Glade

Glade is an AI harness with a **self-extending interface**. It starts as a black screen with a single liquid-glass input. You type what you want — *"show me all my folders"*, *"a clock for Tokyo"*, *"a widget that tails my nginx logs"* — and Glade's coding harness (Claude Code or Codex) builds the UI widget **and** its backend on the spot, wires them together, and mounts the result live. No reloads, no config, no scaffolding.

## Run

```sh
node server.js
# → http://localhost:4173
```

Requires Node 18+ and the `claude` CLI on PATH (or `codex` — set `"harness": "codex"` in `glade.config.json`). Zero npm dependencies.

## How it works

1. You submit a request from the command bar. A glowing generation window appears while the harness works.
2. The server spawns the harness headlessly **inside this folder** with `CLAUDE.md` as its contract: build `web/widgets/<slug>/widget.js` (ES module UI), optionally `backends/<slug>.js` (hot-loaded Node handler exposed at `POST /api/widget/<slug>`), and register both in `web/widgets/manifest.json`.
3. When the harness finishes, the UI refetches the manifest and mounts the new widget with an entrance animation.
4. If a widget declares required env vars (API keys) and they're missing from `.env`, a liquid-glass panel slides in from the right with the key names prefilled — paste values, save, and the widget unblocks.

Widgets that only touch your local machine (filesystem, processes, git) need no setup at all — that's the point.

## Layout

```
server.js                    zero-dep HTTP server + harness runner
CLAUDE.md                    the contract the harness follows
glade.config.json            optional: { "harness": "claude" | "codex" }
web/                         the shell (don't touch — widgets live below)
web/widgets/manifest.json    widget registry
web/widgets/<slug>/widget.js widget UI modules (harness-generated)
backends/<slug>.js           widget backends (harness-generated, hot-loaded)
.env                         user-supplied secrets (gitignored)
```
