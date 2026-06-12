# Glade — Widget Contract

Glade is a self-extending UI. A user types a request into Glade; you (the harness) fulfill it by creating a **widget** (frontend module) and, if needed, a **backend** (Node script). The Glade server hot-loads backends and the UI re-mounts widgets automatically — **never restart the server, never run npm install, never modify the shell** (`server.js`, `web/index.html`, `web/app.js`, `web/glass.js`, `web/styles.css`) unless the user explicitly asks to change Glade itself.

Widgets must be **self-serving**: pick sensible defaults, never wait for configuration. The only exception is secrets (API keys), declared via `env` in the manifest — Glade renders the input panel for those automatically.

## 1. Widget module — `web/widgets/<slug>/widget.js`

`<slug>` is short kebab-case (e.g. `file-explorer`). ES module with a default export:

```js
export default {
  title: "File Explorer",          // shown in the widget chrome
  size: "medium",                  // "small" | "medium" | "large" | "full"
  async mount(el, glade) {
    // el: the widget's content element — render anything into it.
    // glade.call(payload) -> POST /api/widget/<slug>, returns backend result (throws on error)
    // glade.refresh()     -> re-mount this widget
    const files = await glade.call({ dir: "~" });
    el.innerHTML = `...`;
  },
  unmount(el) {}                   // optional cleanup (intervals, listeners)
};
```

Style guidance: Glade is a dark glass UI. Use the provided CSS variables and classes inside widgets: `--ink` (text), `--ink-dim` (secondary text), `--accent` (mint glow). Class `g-btn` for buttons, `g-input` for inputs, `g-list` / `g-row` for list layouts. Keep widgets dark, translucent, rounded. No external CSS/JS imports; inline `<style>` scoped to the widget root is fine.

## 2. Backend — `backends/<slug>.js` (only if the widget needs server-side work)

CommonJS, hot-reloaded on every call (edits apply instantly):

```js
module.exports = async function (payload, ctx) {
  // payload: JSON body from glade.call()
  // ctx.env: process.env merged with the project .env (user-supplied secrets live here)
  // ctx.root: absolute path of the glade folder
  // Use only Node built-ins (fs, path, os, child_process, https...). No npm packages.
  return { anything: "JSON-serializable" };
};
```

Errors thrown here are shown in the widget; throw `new Error("readable message")` for failures.

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
