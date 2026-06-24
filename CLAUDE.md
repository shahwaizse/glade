# Glade — Widget Contract

Glade is a self-extending UI. A user types a request into Glade; you (the harness) fulfill it by creating a **widget** (frontend module) and, if needed, a **backend** (Node script). The Glade server hot-loads backends and the UI re-mounts widgets automatically — **never restart the server, never run npm install, never modify the shell** (`server.js`, `web/index.html`, `web/app.js`, `web/styles.css`) unless the user explicitly asks to change Glade itself.

Widgets must be **self-serving**: pick sensible defaults, never wait for configuration. The only exception is secrets (API keys), declared via `env` in the manifest — Glade renders the input panel for those automatically.

## 1. Widget module — `web/widgets/<slug>/widget.js`

`<slug>` is short kebab-case (e.g. `file-explorer`). ES module with a default export:

```js
export default {
  title: "File Explorer",          // shown in the widget chrome
  size: "medium",                  // "small" | "medium" | "large" | "full"
  async mount(el, glade) {
    // el: the widget's content element — render anything into it.
    const files = await glade.call({ dir: "~" });
    el.innerHTML = `...`;
  },
  unmount(el) {}                   // optional cleanup (intervals, listeners)
};
```

The `glade` object handed to `mount(el, glade)`:

- `glade.call(payload)` → POST `/api/widget/<slug>`; returns the backend result (throws on error).
- `glade.subscribe(payload, onMessage)` → open a streaming backend (SSE); returns an unsubscribe fn. Use for live data: log tails, tickers, monitors, chat. Auto-closed on unmount.
- `glade.fetch(url, opts)` → outbound HTTP via the server proxy (no CORS limits). Returns `{ status, headers, text, json() }`. Prefer this over hand-rolling `https` in a backend for simple GETs.
- `glade.emit(channel, data)` / `glade.on(channel, fn)` → the widget bus. Talk to other widgets (a clock drives a pomodoro, a location feeds weather+maps, a selection filters another widget). `on` returns an unsubscribe fn and auto-cleans on unmount.
- `glade.store.get(k, default)` / `.set(k, v)` / `.del(k)` → persistence namespaced to this widget (localStorage).
- `glade.refresh()` → re-mount this widget.

Style guidance: Glade is a dark, minimal workspace. Use the provided CSS variables and classes inside widgets: `--ink` (text), `--ink-dim` (secondary text), `--accent` (focused/active controls), `--surface` (panel background), and `--line` (borders). Class `g-btn` for buttons, `g-input` for inputs, `g-list` / `g-row` for list layouts. Keep widgets quiet, legible, and responsive; avoid glass blur, decorative gradients, and oversized rounded panels. Inline `<style>` scoped to the widget root is fine.

**Constructs (libraries you may reach for).** `web/index.html` ships a version-pinned import map of *leaf* libraries. Import them on demand inside a widget — do **not** add other CDNs without the user asking:

```js
const d3 = await import("d3");              // data viz
const { Chart } = await import("chart.js"); // charts
const { marked } = await import("marked");  // markdown  (+ "dompurify" to sanitize)
// also: "maplibre-gl", "uplot", "qrcode", "codemirror", "@xterm/xterm"
```

These are libraries you *call*; they don't impose a framework. Prefer plain DOM + these leaf libs over inventing a build step. If a widget might run offline, guard the import and degrade gracefully.

## 2. Backend — `backends/<slug>.js` (only if the widget needs server-side work)

CommonJS, hot-reloaded on every call (edits apply instantly):

```js
module.exports = async function (payload, ctx) {
  // payload: JSON body from glade.call()
  // ctx.env: process.env merged with the project .env (user-supplied secrets live here)
  // ctx.root: absolute path of the glade folder
  // ctx.state: a per-widget object that PERSISTS across calls and hot-reloads
  //   (backends are re-required every call, so module-scope vars are wiped —
  //   keep shared/multiplayer/long-lived state on ctx.state instead).
  // Use only Node built-ins (fs, path, os, child_process, https, fetch...). No npm packages.
  return { anything: "JSON-serializable" };
};
```

Errors thrown here are shown in the widget; throw `new Error("readable message")` for failures.

**Streaming backend (optional).** For live data, also export a `stream` function. It is driven by `glade.subscribe()` over SSE and stays open until the widget unmounts:

```js
module.exports.stream = async function (payload, ctx) {
  // ctx.send(event) -> push a JSON event to the widget
  // ctx.onClose(fn) -> register cleanup (clear intervals, kill children)
  const t = setInterval(() => ctx.send({ ts: Date.now() }), 1000);
  ctx.onClose(() => clearInterval(t));
};
```

You can have both: `module.exports` (the request/response handler) and `module.exports.stream`.

## 3. Register — `web/widgets/manifest.json`

Append to the `widgets` array (keep existing entries):

```json
{ "slug": "file-explorer", "title": "File Explorer", "size": "medium", "env": [] }
```

`env` lists required env var names (e.g. `["OPENWEATHER_API_KEY"]`). If any are missing from `.env`, Glade pops a panel asking the user for values — you never handle key input yourself. In the backend, read them from `ctx.env`. Local-machine widgets (filesystem, processes, git) need **no** env vars.

## 4. Checklist

1. Create `web/widgets/<slug>/widget.js`.
2. Create `backends/<slug>.js` if server-side work is needed.
3. Add the manifest entry with accurate `env`.
4. Sanity-check your backend: `node -e "require('./backends/<slug>.js')({}, {env: process.env, root: process.cwd()}).then(r => console.log(JSON.stringify(r).slice(0,300)))"`.
5. Reply with one short sentence describing what you built — it is shown to the user.

To modify an existing widget, edit its files in place. To remove one, the user uses the widget's close button — don't delete widgets unless asked.

## 5. Platform capabilities (server)

These already exist in the shell — use them, don't reinvent them:

- **Snapshots / undo.** Every generation auto-snapshots the canvas to `.glade/history/`. The user can undo (`Ctrl/Cmd-Z`, or the palette) and restore any earlier state. Builds are non-destructive — you don't need to be timid, but also don't delete the user's other widgets.
- **Command palette** (`/` or `⌘K`): undo, history, rooms, clear canvas, re-run, harness switch, share/QR, and "open" the core widgets.
- **Core widgets** (built-in, summoned from the palette, not in the manifest): a **Terminal** (`web/core/terminal.js`, backed by `/api/shell/*`) and a **Glade** introspection panel (`web/core/glade-panel.js`). Don't recreate these unless asked for something different.
- **Attachments:** the user can paste/drop *any* file or text (not just images); paths arrive in your prompt under `uploads/`.
- **Network:** the server binds all interfaces and exposes a LAN URL/QR (palette → Share).

## 6. Self-modification ritual ("Glade builds Glade")

Normally you must NOT touch the shell (`server.js`, `web/index.html`, `web/app.js`, `web/styles.css`). The one exception is when the user **explicitly** asks to change Glade itself ("make the command bar do X", "add a dark/light toggle"). Then:

1. The shell is auto-snapshotted before every generation, so changes are recoverable — but be surgical.
2. Editing `server.js` requires a manual restart to take effect; tell the user. Frontend shell files (`app.js`, `styles.css`, `index.html`) apply on browser reload.
3. Preserve existing element IDs and the widget contract — other widgets and the tests depend on them.
