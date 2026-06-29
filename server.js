/*
 * Glade server — zero dependencies.
 *
 * Responsibilities:
 *  - Serve the web UI from ./web
 *  - Spawn the coding harness (claude / codex) headlessly against this repo
 *    and stream its progress to the browser as NDJSON
 *  - Snapshot the canvas before every generation so any build can be undone
 *  - Hot-load widget backends from ./backends/<slug>.js (fresh require each call),
 *    including long-lived streaming backends over SSE
 *  - Proxy outbound HTTP for widgets, run persistent shell sessions
 *  - Save/summon named "rooms" (whole canvases) and read/write .env secrets
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const WEB = path.join(ROOT, "web");
const BACKENDS = path.join(ROOT, "backends");
const ENV_FILE = path.join(ROOT, ".env");
const WIDGETS_DIR = path.join(WEB, "widgets");
const MANIFEST = path.join(WIDGETS_DIR, "manifest.json");
const CONFIG_FILE = path.join(ROOT, "glade.config.json");
const GLADE_DIR = path.join(ROOT, ".glade");
const HISTORY_DIR = path.join(GLADE_DIR, "history");
const ROOMS_DIR = path.join(GLADE_DIR, "rooms");
const LIBRARY_DIR = path.join(GLADE_DIR, "library");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const PORT = process.env.GLADE_PORT || 4173;
const MAX_HISTORY = 40;

// Shell files that make up Glade's own body — snapshotted (but not auto-restored)
// so "Glade builds Glade" self-edits are recoverable.
const SHELL_FILES = ["server.js", "web/index.html", "web/app.js", "web/styles.css", "CLAUDE.md"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

// ---------- helpers ----------

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadConfig() {
  return Object.assign(
    {
      harness: "claude",
      // Ordered failover chain. When the active harness reports a usage/rate
      // limit, Glade re-runs the request on the next harness in this list,
      // carrying over the work already on disk. Override in glade.config.json.
      harnessFallback: ["claude", "codex"],
      harnessArgs: {
        claude: [
          "-p",
          "--output-format", "stream-json",
          "--verbose",
          "--permission-mode", "bypassPermissions",
        ],
        codex: ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json"],
      },
    },
    readJSON(CONFIG_FILE, {})
  );
}

// Persist a subset of config (used by the in-UI harness switcher). We only ever
// let the UI rewrite `harness` / `harnessFallback`, never the spawn args.
function saveConfig(updates) {
  const current = readJSON(CONFIG_FILE, {});
  if (typeof updates.harness === "string") current.harness = updates.harness;
  if (Array.isArray(updates.harnessFallback)) current.harnessFallback = updates.harnessFallback;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(current, null, 2) + "\n");
  return loadConfig();
}

function parseEnvFile() {
  const env = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return env;
}

function writeEnvFile(updates) {
  const env = parseEnvFile();
  Object.assign(env, updates);
  const body = Object.entries(env)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.writeFileSync(ENV_FILE, body + (body ? "\n" : ""));
  return env;
}

function readBody(req, max = 5e6) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > max) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------- snapshots / history ----------
//
// Before every generation we copy the whole canvas (widgets + backends + the
// manifest) plus Glade's own shell files into .glade/history/<ts>. Restoring a
// snapshot reverts widgets/backends/manifest to that moment — the safety net
// that makes "ask for anything" non-destructive.

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dst, { recursive: true });
}

function snapshot(meta = {}) {
  try {
    const ts = String(Date.now());
    const dir = path.join(HISTORY_DIR, ts);
    fs.mkdirSync(dir, { recursive: true });
    copyDir(WIDGETS_DIR, path.join(dir, "widgets"));
    copyDir(BACKENDS, path.join(dir, "backends"));
    const shellDir = path.join(dir, "shell");
    fs.mkdirSync(shellDir, { recursive: true });
    for (const rel of SHELL_FILES) {
      const from = path.join(ROOT, rel);
      if (fs.existsSync(from)) {
        const to = path.join(shellDir, rel.replace(/\//g, "__"));
        fs.copyFileSync(from, to);
      }
    }
    const manifest = readJSON(MANIFEST, { widgets: [] });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ ts: Number(ts), at: new Date().toISOString(), widgetCount: (manifest.widgets || []).length, ...meta }, null, 2)
    );
    pruneHistory();
    return ts;
  } catch (err) {
    console.error("snapshot failed:", err.message);
    return null;
  }
}

function pruneHistory() {
  const all = listSnapshots(HISTORY_DIR);
  for (const s of all.slice(MAX_HISTORY)) {
    fs.rmSync(path.join(HISTORY_DIR, String(s.ts)), { recursive: true, force: true });
  }
}

function listSnapshots(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir)
    .map((name) => ({ name, meta: readJSON(path.join(baseDir, name, "meta.json"), {}) }))
    .map((s) => ({ id: s.name, ts: s.meta.ts || Number(s.name) || 0, ...s.meta }))
    .sort((a, b) => b.ts - a.ts);
}

// Replace widgets + backends + manifest with the contents of a snapshot dir.
function restoreFrom(dir) {
  if (!fs.existsSync(dir)) throw new Error("snapshot not found");
  fs.rmSync(WIDGETS_DIR, { recursive: true, force: true });
  fs.rmSync(BACKENDS, { recursive: true, force: true });
  copyDir(path.join(dir, "widgets"), WIDGETS_DIR);
  copyDir(path.join(dir, "backends"), BACKENDS);
  fs.mkdirSync(BACKENDS, { recursive: true });
  fs.mkdirSync(WIDGETS_DIR, { recursive: true });
  if (!fs.existsSync(MANIFEST)) fs.writeFileSync(MANIFEST, JSON.stringify({ widgets: [] }, null, 2));
}

function getHistory(res) {
  sendJSON(res, 200, { history: listSnapshots(HISTORY_DIR) });
}

function restoreSnapshot(id, res) {
  if (!/^[0-9]+$/.test(String(id))) return sendJSON(res, 400, { error: "bad snapshot id" });
  try {
    // snapshot the current state first so a restore is itself undoable
    snapshot({ label: "before restore" });
    restoreFrom(path.join(HISTORY_DIR, String(id)));
    sendJSON(res, 200, { ok: true });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

// Undo = restore the most recent snapshot (the state before the last build).
function undo(res) {
  const snaps = listSnapshots(HISTORY_DIR);
  if (!snaps.length) return sendJSON(res, 200, { ok: false, error: "nothing to undo" });
  try {
    restoreFrom(path.join(HISTORY_DIR, snaps[0].id));
    // consume it so repeated undo walks further back
    fs.rmSync(path.join(HISTORY_DIR, snaps[0].id), { recursive: true, force: true });
    sendJSON(res, 200, { ok: true, restored: snaps[0] });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

// ---------- rooms ----------
//
// A room is a named, frozen copy of the whole canvas. Save one, summon it later,
// teleport between dashboards you spoke into being.

function listRooms(res) {
  sendJSON(res, 200, { rooms: listSnapshots(ROOMS_DIR) });
}

function roomSlug(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function saveRoom(name, res) {
  const slug = roomSlug(name);
  if (!slug) return sendJSON(res, 400, { error: "bad room name" });
  try {
    const dir = path.join(ROOMS_DIR, slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    copyDir(WIDGETS_DIR, path.join(dir, "widgets"));
    copyDir(BACKENDS, path.join(dir, "backends"));
    const manifest = readJSON(MANIFEST, { widgets: [] });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ ts: Date.now(), name: slug, at: new Date().toISOString(), widgetCount: (manifest.widgets || []).length }, null, 2)
    );
    sendJSON(res, 200, { ok: true, name: slug });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

function openRoom(name, res) {
  const slug = roomSlug(name);
  const dir = path.join(ROOMS_DIR, slug);
  if (!fs.existsSync(dir)) return sendJSON(res, 404, { error: "room not found" });
  try {
    snapshot({ label: `before opening room "${slug}"` });
    restoreFrom(dir);
    sendJSON(res, 200, { ok: true });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

function deleteRoom(name, res) {
  const slug = roomSlug(name);
  const dir = path.join(ROOMS_DIR, slug);
  if (!slug || !fs.existsSync(dir)) return sendJSON(res, 404, { error: "room not found" });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    sendJSON(res, 200, { ok: true, name: slug });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

function renameRoom(from, to, res) {
  const oldSlug = roomSlug(from);
  const newSlug = roomSlug(to);
  const oldDir = path.join(ROOMS_DIR, oldSlug);
  const newDir = path.join(ROOMS_DIR, newSlug);
  if (!oldSlug || !fs.existsSync(oldDir)) return sendJSON(res, 404, { error: "room not found" });
  if (!newSlug) return sendJSON(res, 400, { error: "bad room name" });
  if (newSlug !== oldSlug && fs.existsSync(newDir)) return sendJSON(res, 409, { error: "room already exists" });
  try {
    if (newSlug !== oldSlug) fs.renameSync(oldDir, newDir);
    const metaFile = path.join(newDir, "meta.json");
    const meta = readJSON(metaFile, {});
    fs.writeFileSync(metaFile, JSON.stringify({ ...meta, name: newSlug, renamedAt: new Date().toISOString() }, null, 2));
    sendJSON(res, 200, { ok: true, name: newSlug });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

// ---------- widget library ----------
//
// A personal shelf of individual widgets. Where a room snapshots the whole
// canvas, the library keeps single widgets — their files, their manifest entry,
// and the client-side state captured at save time — so any widget can be
// summoned into any room without dragging the rest of the canvas along.

function widgetSlugOk(slug) {
  return typeof slug === "string" && /^[a-z0-9-]+$/.test(slug);
}

function libraryEntryMeta(slug) {
  return readJSON(path.join(LIBRARY_DIR, slug, "meta.json"), null);
}

function listLibrary(res) {
  const out = [];
  if (fs.existsSync(LIBRARY_DIR)) {
    for (const name of fs.readdirSync(LIBRARY_DIR)) {
      const meta = libraryEntryMeta(name);
      if (meta && meta.slug) {
        meta.state = readJSON(path.join(LIBRARY_DIR, name, "state.json"), {});
        out.push(meta);
      }
    }
  }
  out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  sendJSON(res, 200, { widgets: out });
}

// Copy a live widget (its folder, its backend, its manifest entry) plus the
// state the browser captured for it into .glade/library/<slug>.
function saveWidgetToLibrary(spec, res) {
  const slug = spec && spec.slug;
  if (!widgetSlugOk(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const srcWidget = path.join(WIDGETS_DIR, slug);
  const manifest = readJSON(MANIFEST, { widgets: [] });
  const entry = (manifest.widgets || []).find((w) => w.slug === slug);
  if (!fs.existsSync(srcWidget) || !entry) return sendJSON(res, 404, { error: "widget not found" });
  try {
    const dir = path.join(LIBRARY_DIR, slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    copyDir(srcWidget, path.join(dir, "widget"));
    const backendSrc = path.join(BACKENDS, slug + ".js");
    const hasBackend = fs.existsSync(backendSrc);
    if (hasBackend) fs.copyFileSync(backendSrc, path.join(dir, "backend.js"));
    const state = spec.state && typeof spec.state === "object" ? spec.state : {};
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
    fs.writeFileSync(path.join(dir, "entry.json"), JSON.stringify(entry, null, 2));
    const meta = {
      slug,
      title: entry.title || slug,
      size: entry.size || "medium",
      env: entry.env || [],
      hasBackend,
      hasState: Object.keys(state).length > 0,
      savedAt: Date.now(),
    };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    sendJSON(res, 200, { ok: true, meta });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

// Inject a saved widget into the current canvas. Snapshots first (undoable),
// writes the files + manifest entry, and hands the saved state back so the
// browser can seed it before the widget mounts.
function addWidgetFromLibrary(spec, res) {
  const slug = spec && spec.slug;
  if (!widgetSlugOk(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const dir = path.join(LIBRARY_DIR, slug);
  const entry = readJSON(path.join(dir, "entry.json"), null);
  if (!fs.existsSync(dir) || !entry) return sendJSON(res, 404, { error: "not in library" });
  try {
    snapshot({ label: `before adding "${slug}" from library` });
    fs.rmSync(path.join(WIDGETS_DIR, slug), { recursive: true, force: true });
    copyDir(path.join(dir, "widget"), path.join(WIDGETS_DIR, slug));
    const backendSrc = path.join(dir, "backend.js");
    if (fs.existsSync(backendSrc)) {
      fs.mkdirSync(BACKENDS, { recursive: true });
      fs.copyFileSync(backendSrc, path.join(BACKENDS, slug + ".js"));
    }
    const manifest = readJSON(MANIFEST, { widgets: [] });
    manifest.widgets = manifest.widgets || [];
    const already = manifest.widgets.some((w) => w.slug === slug);
    manifest.widgets = already
      ? manifest.widgets.map((w) => (w.slug === slug ? entry : w))
      : [...manifest.widgets, entry];
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    const state = readJSON(path.join(dir, "state.json"), {});
    sendJSON(res, 200, { ok: true, slug, entry, state, already });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

function deleteFromLibrary(spec, res) {
  const slug = spec && spec.slug;
  if (!widgetSlugOk(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const dir = path.join(LIBRARY_DIR, slug);
  if (!fs.existsSync(dir)) return sendJSON(res, 404, { error: "not in library" });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    sendJSON(res, 200, { ok: true, slug });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

// Serve a saved widget's static files so the picker can mount it as a live
// preview. Scoped to the library widget dir with the same traversal guard as
// the main static route.
function serveLibraryAsset(slug, rel, res) {
  if (!widgetSlugOk(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const baseDir = path.join(LIBRARY_DIR, slug, "widget");
  const file = path.normalize(path.join(baseDir, rel || "widget.js"));
  if (!file.startsWith(baseDir)) return sendJSON(res, 403, { error: "forbidden" });
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    return fs.createReadStream(file).pipe(res);
  }
  sendJSON(res, 404, { error: "not found" });
}

function loadLibraryBackend(slug) {
  const file = path.join(LIBRARY_DIR, slug, "backend.js");
  if (!fs.existsSync(file)) return null;
  delete require.cache[require.resolve(file)];
  return require(file);
}

// Request/response backend for a library preview (mirrors callWidgetBackend but
// runs the saved copy, on a separate state namespace so previews never disturb
// the live widget's shared state).
async function callLibraryBackend(slug, payload, res) {
  if (!widgetSlugOk(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const handler = loadLibraryBackend(slug);
  if (!handler) return sendJSON(res, 404, { error: `no backend for ${slug}` });
  try {
    const fn = typeof handler === "function" ? handler : handler.handler;
    if (typeof fn !== "function") throw new Error(`backend ${slug} has no callable handler`);
    const result = await fn(payload, backendCtx("library:" + slug));
    sendJSON(res, 200, { ok: true, result });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message });
  }
}

// ---------- harness ----------

const HARNESS_PROMPT_PREFIX = `You are running inside Glade, a self-extending UI. Read CLAUDE.md in this directory FIRST and follow the widget contract exactly: create the widget module under web/widgets/<slug>/widget.js, an optional backend in backends/<slug>.js, register it in web/widgets/manifest.json, and declare any required env vars in the manifest. Do NOT restart the server; backends are hot-loaded and the UI refreshes itself. Do NOT modify server.js, web/index.html, web/app.js, or web/styles.css unless the user's request explicitly requires changing Glade's shell.

User request: `;

// Signals that a harness has run out of usage/quota and we should fail over.
const LIMIT_RE =
  /usage limit|rate.?limit|\b429\b|too many requests|quota|exceeded your|limit reached|insufficient[_ ]quota|out of credit|credit balance|overloaded/i;

// Ordered list of harness commands to try. The active harness always goes
// first; the fallback list only decides what to try after that.
function harnessChain(config) {
  const configured = Array.isArray(config.harnessFallback) ? config.harnessFallback.filter(Boolean) : [];
  const available = Object.keys(config.harnessArgs || {});
  const first = config.harness || configured[0] || available[0] || "claude";
  const chain = [
    first,
    ...configured.filter((h) => h !== first),
    ...available.filter((h) => h !== first && !configured.includes(h)),
  ];
  return [...new Set(chain)].filter(Boolean);
}

// Build the full prompt for a single attempt: shell instructions + the user
// request, any attached file paths, and (on failover) a note that a previous
// harness left partial work on disk to continue from.
function buildPrompt(userRequest, attachPaths, priorHarness) {
  let prompt = HARNESS_PROMPT_PREFIX + userRequest;
  if (attachPaths && attachPaths.length) {
    prompt +=
      `\n\nThe user attached ${attachPaths.length} file(s). Inspect them with your file tools before building, ` +
      `treating them as part of the request (a design to match, a screenshot, a CSV/JSON/PDF/text to turn into a widget, data to extract, etc.):\n` +
      attachPaths.map((p) => "  " + p).join("\n");
  }
  if (priorHarness) {
    prompt =
      `NOTE: The "${priorHarness}" harness started this task but hit its usage limit before finishing. ` +
      `Its partial work is already on disk in this repo — inspect the current widget/backend/manifest state ` +
      `first and CONTINUE from there to completion rather than starting over.\n\n` + prompt;
  }
  return prompt;
}

// Does a single stdout line (or stderr text) indicate a usage limit?
// Assistant "thoughts" are ignored so a widget *about* rate limiting can't
// trip a false failover — only result/error events and raw logs are scanned.
function lineSignalsLimit(line) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return LIMIT_RE.test(line);
  }
  if (ev.type === "result") {
    return LIMIT_RE.test(`${ev.subtype || ""} ${ev.result || ""} ${ev.error || ""}`);
  }
  if (ev.type === "error") {
    return LIMIT_RE.test(JSON.stringify(ev.error || ev));
  }
  if (ev.type === "turn.failed") {
    return LIMIT_RE.test(JSON.stringify(ev.error || ev.message || ev));
  }
  return false; // assistant / system / tool events never trigger a switch
}

// Decode base64 data-URL attachments from a generate request, write them under
// uploads/, and return their absolute paths for the harness to read. Accepts
// any file type, not just images (CSV, JSON, PDF, text, audio, …).
const EXT_BY_MIME = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp",
  "image/gif": "gif", "image/svg+xml": "svg", "application/pdf": "pdf",
  "application/json": "json", "text/csv": "csv", "text/plain": "txt",
  "text/markdown": "md", "text/html": "html", "application/zip": "zip",
  "audio/mpeg": "mp3", "audio/wav": "wav", "video/mp4": "mp4",
  "application/x-sqlite3": "sqlite", "application/octet-stream": "bin",
};

function saveAttachments(items) {
  if (!Array.isArray(items) || !items.length) return [];
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const saved = [];
  items.forEach((item, i) => {
    const data = typeof item === "string" ? item : item && item.data;
    const m = /^data:([^;]+);base64,(.+)$/i.exec(data || "");
    if (!m) return;
    const mime = m[1].toLowerCase();
    const givenName = (item && item.name) || "";
    const extFromName = path.extname(givenName).replace(/^\./, "").toLowerCase();
    const ext = extFromName || EXT_BY_MIME[mime] || "bin";
    const file = path.join(UPLOADS_DIR, `glade-${Date.now()}-${i}.${ext}`);
    fs.writeFileSync(file, Buffer.from(m[2], "base64"));
    saved.push(file);
  });
  return saved;
}

// Run the request against the fallback chain, automatically switching to the
// next harness if the current one reports a usage limit.
function runHarness(userRequest, attachPaths, res) {
  const config = loadConfig();
  const chain = harnessChain(config);

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });
  const emit = (obj) => res.write(JSON.stringify(obj) + "\n");

  let idx = 0;
  let priorHarness = null;

  const runNext = () => {
    if (idx >= chain.length) {
      emit({ type: "error", message: "All harnesses are at their usage limit — try again later." });
      return res.end();
    }
    const harness = chain[idx];

    runAttempt(harness, buildPrompt(userRequest, attachPaths, priorHarness), config, emit, res, (outcome, detail) => {
      if (outcome === "limit" || outcome === "unavailable") {
        const next = chain[idx + 1];
        if (next) {
          const reason = outcome === "limit" ? "usage limit reached" : "harness unavailable";
          emit({ type: "switch", from: harness, to: next, reason });
          if (outcome === "limit") priorHarness = harness;
          idx += 1;
          return runNext();
        }
        const message = outcome === "limit"
          ? `${harness} hit its usage limit and no fallback harness is configured.`
          : `${harness} could not be started${detail ? `: ${detail}` : ""}`;
        emit({ type: "error", message });
        return res.end();
      }
      res.end();
    });
  };

  runNext();
}

function textSignalsMissingCommand(text, command) {
  const safe = String(command || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:spawn\\s+${safe}\\s+ENOENT|${safe}[^\\n]*(?:not recognized|command not found)|(?:not recognized|command not found)[^\\n]*${safe})`,
    "i"
  ).test(String(text || ""));
}

function harnessArgsFor(config, harness) {
  const args = [...((config.harnessArgs || {})[harness] || [])];
  // Codex deprecated --full-auto and now routes it through the Windows sandbox.
  // On installs without codex-windows-sandbox-setup.exe, every shell command
  // fails before the agent can read or edit files. Glade already runs harnesses
  // against a trusted local repo, matching Codex's explicit bypass mode.
  if (harness === "codex") {
    const hasBypass = args.includes("--dangerously-bypass-approvals-and-sandbox");
    const idx = args.indexOf("--full-auto");
    if (idx >= 0) {
      if (hasBypass) args.splice(idx, 1);
      else args.splice(idx, 1, "--dangerously-bypass-approvals-and-sandbox");
    }
  }
  return args;
}

// Spawn the harness. Resolves with a live child; rejects on a genuine spawn
// failure. On Windows a bare command name that resolves to a .bat/.cmd shim
// (common for npm-installed CLIs) fails with an async ENOENT even though the
// shim exists — libuv's non-shell PATH search there only matches true
// executables. We retry once through a shell in that case, which can find
// and launch it; a genuinely missing command still fails there too (cmd.exe
// writes a "not recognized" stderr line instead, handled by
// textSignalsMissingCommand once the caller is reading the stream).
function spawnHarness(harness, args) {
  const options = {
    cwd: ROOT,
    env: { ...process.env, ...parseEnvFile() },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  };

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(harness, args, options);
    } catch (err) {
      return reject(err);
    }
    if (process.platform !== "win32") return resolve(child);

    let settled = false;
    child.once("spawn", () => {
      settled = true;
      resolve(child);
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      if (err.code !== "ENOENT") return reject(err);
      try {
        resolve(spawn(harness, args, { ...options, shell: true }));
      } catch (err2) {
        reject(err2);
      }
    });
  });
}

// Spawn one harness attempt. Calls done("limit" | "unavailable" | "done" | "error") exactly once.
function runAttempt(harness, fullPrompt, config, emit, res, done) {
  const args = harnessArgsFor(config, harness);
  emit({ type: "start", harness });

  spawnHarness(harness, args).then(
    (child) => beginAttempt(harness, fullPrompt, child, emit, res, done),
    (err) => {
      if (err.code === "ENOENT") {
        emit({ type: "log", text: `${harness} unavailable: ${err.message}` });
        return done("unavailable", err.message);
      }
      emit({ type: "error", message: `failed to spawn ${harness}: ${err.message}` });
      return done("error", err.message);
    }
  );
}

function beginAttempt(harness, fullPrompt, child, emit, res, done) {
  // The prompt (often multi-line, with characters like <, >, & from the
  // widget-contract instructions) goes over stdin rather than argv: argv has
  // no safe, lossless escaping on Windows (cmd.exe can't represent embedded
  // newlines at all), and both `claude -p` and `codex exec` read the prompt
  // from stdin when no positional prompt is given.
  child.stdin.on("error", () => {}); // EPIPE if the harness exits before reading
  child.stdin.write(fullPrompt);
  child.stdin.end();

  let limitHit = false;
  let unavailableHit = false;
  let unavailableMessage = "";
  let settled = false;
  const finish = (outcome, detail) => {
    if (settled) return;
    settled = true;
    done(outcome, detail);
  };
  const flagLimit = () => {
    if (limitHit || unavailableHit) return;
    limitHit = true;
    emit({ type: "log", text: `${harness} signalled a usage limit; failing over…` });
    if (child.exitCode === null) child.kill("SIGTERM"); // stop early so we can switch
  };
  const flagUnavailable = (message) => {
    if (unavailableHit || limitHit) return;
    unavailableHit = true;
    unavailableMessage = String(message || "command not found").trim();
    emit({ type: "log", text: `${harness} unavailable: ${unavailableMessage.slice(0, 300)}` });
    if (child.exitCode === null) child.kill("SIGTERM");
  };

  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      flagUnavailable(err.message);
      return finish("unavailable", err.message);
    }
    emit({ type: "error", message: `harness error: ${err.message}` });
    finish(limitHit ? "limit" : "error", err.message);
  });

  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      if (lineSignalsLimit(line)) flagLimit();
      else if (!limitHit) forwardHarnessLine(line, emit);
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (textSignalsMissingCommand(text, harness)) flagUnavailable(text);
    else if (LIMIT_RE.test(text)) flagLimit();
    emit({ type: "log", text: text.slice(0, 2000) });
  });
  child.on("close", () => {
    finish(unavailableHit ? "unavailable" : limitHit ? "limit" : "done", unavailableMessage);
  });
  res.on("close", () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });
}

// Translate harness stream-json events into compact progress messages.
function forwardHarnessLine(line, emit) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return emit({ type: "log", text: line.slice(0, 500) });
  }
  // Claude Code stream-json
  if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
    for (const block of ev.message.content) {
      if (block.type === "text" && block.text.trim()) {
        emit({ type: "thought", text: block.text.trim().slice(0, 400) });
      } else if (block.type === "tool_use") {
        const input = block.input || {};
        const detail = input.file_path || input.command || input.description || input.pattern || "";
        emit({ type: "tool", name: block.name, detail: String(detail).slice(0, 200), file: input.file_path || "" });
      }
    }
  } else if (ev.type === "result") {
    emit({ type: "result", text: String(ev.result || "").slice(0, 1000) });
  } else if (ev.msg) {
    // Codex --json events
    forwardCodexMessage(ev.msg, emit);
  } else if (ev.type && ev.type.startsWith("item.")) {
    forwardCodexItem(ev, emit);
  }
}

function compactText(value, max = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function commandText(command) {
  if (Array.isArray(command)) return command.join(" ");
  return String(command || "");
}

function forwardCodexMessage(m, emit) {
  if (!m || typeof m !== "object") return;
  if (m.type === "agent_message" && m.message) {
    emit({ type: "thought", text: compactText(m.message) });
  } else if (m.type === "exec_command_begin") {
    emit({ type: "tool", name: "exec", detail: commandText(m.command).slice(0, 200) });
  }
}

function forwardCodexItem(ev, emit) {
  const item = ev.item || {};
  if (item.type === "agent_message") {
    const text = compactText(item.text || item.message);
    if (text) emit({ type: "thought", text });
  } else if (item.type === "command_execution") {
    if (ev.type === "item.started" || item.status === "in_progress") {
      emit({ type: "tool", name: "exec", detail: commandText(item.command).slice(0, 200) });
    }
  } else if (/tool|command|exec/i.test(item.type || "")) {
    const name = item.name || item.tool_name || item.type || "tool";
    const detail = compactText(item.command || item.input || item.arguments || item.path || item.file_path || "", 200);
    emit({ type: "tool", name, detail });
  } else {
    const text = compactText(item.text || item.message || item.summary);
    if (text) emit({ type: "thought", text });
  }
}

// ---------- widget backends ----------

function loadBackend(slug) {
  const file = path.join(BACKENDS, slug + ".js");
  if (!fs.existsSync(file)) return null;
  delete require.cache[require.resolve(file)]; // hot reload
  return require(file);
}

// Per-slug shared memory that SURVIVES backend hot-reloads. Backends are
// re-required on every call, so module-scope state is wiped each time — use
// ctx.state for anything that must persist across calls or be shared between
// clients (multiplayer game worlds, presence, caches, pub/sub rooms).
const SHARED = new Map();
function sharedState(slug) {
  if (!SHARED.has(slug)) SHARED.set(slug, {});
  return SHARED.get(slug);
}

function backendCtx(slug) {
  return { env: { ...process.env, ...parseEnvFile() }, root: ROOT, state: sharedState(slug) };
}

async function callWidgetBackend(slug, payload, res) {
  if (!/^[a-z0-9-]+$/.test(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const handler = loadBackend(slug);
  if (!handler) return sendJSON(res, 404, { error: `no backend for ${slug}` });
  try {
    const fn = typeof handler === "function" ? handler : handler.handler;
    if (typeof fn !== "function") throw new Error(`backend ${slug} has no callable handler`);
    const result = await fn(payload, backendCtx(slug));
    sendJSON(res, 200, { ok: true, result });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message, stack: String(err.stack).split("\n").slice(0, 5) });
  }
}

// Shared Server-Sent-Events driver for streaming backends. A backend opts in by
// exporting `stream(payload, ctx)` where ctx adds `send(event)` and
// `onClose(fn)`. Lets widgets build log tailers, tickers, monitors, chat — and
// lets the picker drive live previews of saved streaming widgets.
function runStreamBackend(fn, ctxBase, payload, req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": glade-stream open\n\n");
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  const closers = [];
  const ctx = {
    ...ctxBase,
    send: (event) => {
      try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
    },
    onClose: (fn) => closers.push(fn),
  };
  const cleanup = () => {
    clearInterval(ping);
    for (const fn of closers) { try { fn(); } catch {} }
  };
  req.on("close", cleanup);
  Promise.resolve()
    .then(() => fn(payload, ctx))
    .catch((err) => {
      ctx.send({ type: "error", error: err.message });
      cleanup();
      res.end();
    });
}

async function streamWidgetBackend(slug, payload, req, res) {
  if (!/^[a-z0-9-]+$/.test(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const handler = loadBackend(slug);
  const fn = handler && handler.stream;
  if (typeof fn !== "function") return sendJSON(res, 404, { error: `no stream backend for ${slug}` });
  runStreamBackend(fn, backendCtx(slug), payload, req, res);
}

async function streamLibraryBackend(slug, payload, req, res) {
  if (!widgetSlugOk(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const handler = loadLibraryBackend(slug);
  const fn = handler && handler.stream;
  if (typeof fn !== "function") return sendJSON(res, 404, { error: `no stream backend for ${slug}` });
  runStreamBackend(fn, backendCtx("library:" + slug), payload, req, res);
}

function removeWidget(slug, res) {
  if (!/^[a-z0-9-]+$/.test(slug)) return sendJSON(res, 400, { error: "bad slug" });
  snapshot({ label: `before removing "${slug}"` });
  const manifest = readJSON(MANIFEST, { widgets: [] });
  manifest.widgets = (manifest.widgets || []).filter((w) => w.slug !== slug);
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  fs.rmSync(path.join(WIDGETS_DIR, slug), { recursive: true, force: true });
  fs.rmSync(path.join(BACKENDS, slug + ".js"), { force: true });
  sendJSON(res, 200, { ok: true });
}

// ---------- outbound proxy (glade.fetch) ----------
//
// Lets a widget reach any HTTP endpoint without CORS limits or re-implementing
// the https boilerplate every backend used to hand-roll.

async function proxyFetch(spec, res) {
  const { url, method = "GET", headers = {}, body } = spec || {};
  if (!url || !/^https?:\/\//i.test(url)) return sendJSON(res, 400, { error: "bad url" });
  try {
    const r = await fetch(url, { method, headers, body: body ?? undefined });
    const text = await r.text();
    const outHeaders = {};
    r.headers.forEach((v, k) => (outHeaders[k] = v));
    sendJSON(res, 200, { ok: true, status: r.status, headers: outHeaders, body: text });
  } catch (err) {
    sendJSON(res, 502, { ok: false, error: err.message });
  }
}

// ---------- persistent shell sessions ----------
//
// A pipe-backed shell per session (no PTY → no curses apps/colors, but real
// command execution with persistent cwd & env). Backs the terminal capability.

const shells = new Map(); // id -> { child, listeners:Set<res>, buffer:string }

function defaultShell() {
  if (process.platform === "win32") {
    return {
      cmd: process.env.ComSpec || "powershell.exe",
      args: (process.env.ComSpec || "").toLowerCase().endsWith("cmd.exe")
        ? ["/Q", "/K"]
        : ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"],
    };
  }
  return { cmd: process.env.SHELL || "/bin/bash", args: ["-i"] };
}

function shellSession(id) {
  let s = shells.get(id);
  if (s) return s;
  const shell = defaultShell();
  const child = spawn(shell.cmd, shell.args, {
    cwd: ROOT,
    env: { ...process.env, ...parseEnvFile(), PS1: "glade$ " },
    windowsHide: true,
  });
  s = { child, listeners: new Set(), buffer: "" };
  const push = (data) => {
    const text = data.toString();
    s.buffer = (s.buffer + text).slice(-100000);
    for (const res of s.listeners) {
      try { res.write(`data: ${JSON.stringify({ type: "out", data: text })}\n\n`); } catch {}
    }
  };
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.on("error", (err) => {
    push(`shell failed to start: ${err.message}\n`);
    for (const res of s.listeners) {
      try { res.write(`data: ${JSON.stringify({ type: "exit", code: 1 })}\n\n`); res.end(); } catch {}
    }
    shells.delete(id);
  });
  child.on("close", (code) => {
    for (const res of s.listeners) {
      try { res.write(`data: ${JSON.stringify({ type: "exit", code })}\n\n`); res.end(); } catch {}
    }
    shells.delete(id);
  });
  shells.set(id, s);
  return s;
}

function shellOpen(res) {
  const id = `sh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  shellSession(id);
  sendJSON(res, 200, { ok: true, id });
}

function shellInput(spec, res) {
  const { id, data } = spec || {};
  const s = shells.get(id);
  if (!s) return sendJSON(res, 404, { ok: false, error: "no such shell" });
  try { s.child.stdin.write(data || ""); } catch (e) { return sendJSON(res, 500, { ok: false, error: e.message }); }
  sendJSON(res, 200, { ok: true });
}

function shellStream(id, req, res) {
  const s = shells.get(id);
  if (!s) return sendJSON(res, 404, { error: "no such shell" });
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": shell stream open\n\n");
  if (s.buffer) res.write(`data: ${JSON.stringify({ type: "out", data: s.buffer })}\n\n`);
  s.listeners.add(res);
  req.on("close", () => s.listeners.delete(res));
}

// ---------- state / capabilities ----------

function localIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function getState(res) {
  const manifest = readJSON(MANIFEST, { widgets: [] });
  const env = parseEnvFile();
  const widgets = (manifest.widgets || []).map((w) => ({
    ...w,
    missingEnv: (w.env || []).filter((k) => !(k in env) && !(k in process.env)),
  }));
  const config = loadConfig();
  sendJSON(res, 200, {
    widgets,
    harness: config.harness,
    harnessChain: harnessChain(config),
  });
}

function getNetInfo(res) {
  sendJSON(res, 200, {
    port: Number(PORT),
    urls: localIPs().map((ip) => `http://${ip}:${PORT}`),
    host: os.hostname(),
  });
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === "/api/state" && req.method === "GET") return getState(res);
    if (p === "/api/netinfo" && req.method === "GET") return getNetInfo(res);

    if (p === "/api/config" && req.method === "GET") {
      const c = loadConfig();
      return sendJSON(res, 200, { harness: c.harness, harnessChain: harnessChain(c), available: Object.keys(c.harnessArgs || {}) });
    }
    if (p === "/api/config" && req.method === "POST") {
      const updates = JSON.parse((await readBody(req)) || "{}");
      const c = saveConfig(updates);
      return sendJSON(res, 200, { ok: true, harness: c.harness, harnessChain: harnessChain(c) });
    }

    if (p === "/api/generate" && req.method === "POST") {
      const { prompt, images, attachments } = JSON.parse((await readBody(req, 60e6)) || "{}");
      const attachPaths = saveAttachments(attachments || images);
      if ((!prompt || !prompt.trim()) && !attachPaths.length)
        return sendJSON(res, 400, { error: "empty prompt" });
      snapshot({ label: (prompt || "(attachment only)").slice(0, 120) });
      return runHarness((prompt || "").trim() || "(see attached file)", attachPaths, res);
    }

    if (p === "/api/history" && req.method === "GET") return getHistory(res);
    if (p === "/api/undo" && req.method === "POST") return undo(res);
    if (p === "/api/restore" && req.method === "POST") {
      const { id } = JSON.parse((await readBody(req)) || "{}");
      return restoreSnapshot(id, res);
    }

    if (p === "/api/rooms" && req.method === "GET") return listRooms(res);
    if (p === "/api/rooms/save" && req.method === "POST") {
      const { name } = JSON.parse((await readBody(req)) || "{}");
      return saveRoom(name, res);
    }
    if (p === "/api/rooms/open" && req.method === "POST") {
      const { name } = JSON.parse((await readBody(req)) || "{}");
      return openRoom(name, res);
    }
    if (p === "/api/rooms/delete" && req.method === "POST") {
      const { name } = JSON.parse((await readBody(req)) || "{}");
      return deleteRoom(name, res);
    }
    if (p === "/api/rooms/rename" && req.method === "POST") {
      const { from, to } = JSON.parse((await readBody(req)) || "{}");
      return renameRoom(from, to, res);
    }

    // widget library
    if (p === "/api/library" && req.method === "GET") return listLibrary(res);
    if (p === "/api/library/save" && req.method === "POST") {
      const spec = JSON.parse((await readBody(req, 5e6)) || "{}");
      return saveWidgetToLibrary(spec, res);
    }
    if (p === "/api/library/add" && req.method === "POST") {
      const spec = JSON.parse((await readBody(req)) || "{}");
      return addWidgetFromLibrary(spec, res);
    }
    if (p === "/api/library/delete" && req.method === "POST") {
      const spec = JSON.parse((await readBody(req)) || "{}");
      return deleteFromLibrary(spec, res);
    }
    const libStreamCall = p.match(/^\/api\/library\/stream\/([a-z0-9-]+)$/);
    if (libStreamCall && req.method === "GET") {
      let payload = {};
      try { payload = JSON.parse(url.searchParams.get("payload") || "{}"); } catch {}
      return streamLibraryBackend(libStreamCall[1], payload, req, res);
    }
    const libWidgetCall = p.match(/^\/api\/library\/widget\/([a-z0-9-]+)$/);
    if (libWidgetCall && req.method === "POST") {
      const payload = JSON.parse((await readBody(req)) || "{}");
      return callLibraryBackend(libWidgetCall[1], payload, res);
    }
    const libAsset = p.match(/^\/api\/library\/asset\/([a-z0-9-]+)\/(.+)$/);
    if (libAsset && req.method === "GET") return serveLibraryAsset(libAsset[1], decodeURIComponent(libAsset[2]), res);

    if (p === "/api/env" && req.method === "POST") {
      const updates = JSON.parse((await readBody(req)) || "{}");
      writeEnvFile(updates);
      return sendJSON(res, 200, { ok: true });
    }

    if (p === "/api/proxy" && req.method === "POST") {
      const spec = JSON.parse((await readBody(req, 20e6)) || "{}");
      return proxyFetch(spec, res);
    }

    // terminal capability
    if (p === "/api/shell/open" && req.method === "POST") return shellOpen(res);
    if (p === "/api/shell/input" && req.method === "POST") {
      const spec = JSON.parse((await readBody(req)) || "{}");
      return shellInput(spec, res);
    }
    if (p === "/api/shell/stream" && req.method === "GET") return shellStream(url.searchParams.get("id"), req, res);

    // streaming widget backend (SSE)
    const streamCall = p.match(/^\/api\/stream\/([a-z0-9-]+)$/);
    if (streamCall && req.method === "GET") {
      let payload = {};
      try { payload = JSON.parse(url.searchParams.get("payload") || "{}"); } catch {}
      return streamWidgetBackend(streamCall[1], payload, req, res);
    }

    const widgetCall = p.match(/^\/api\/widget\/([a-z0-9-]+)$/);
    if (widgetCall && req.method === "POST") {
      const payload = JSON.parse((await readBody(req)) || "{}");
      return callWidgetBackend(widgetCall[1], payload, res);
    }
    if (widgetCall && req.method === "DELETE") return removeWidget(widgetCall[1], res);

    // static files
    if (req.method === "GET") {
      let file = path.normalize(path.join(WEB, p === "/" ? "index.html" : p));
      if (!file.startsWith(WEB)) return sendJSON(res, 403, { error: "forbidden" });
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, {
          "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        return fs.createReadStream(file).pipe(res);
      }
    }
    sendJSON(res, 404, { error: "not found" });
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
});

fs.mkdirSync(BACKENDS, { recursive: true });
fs.mkdirSync(WIDGETS_DIR, { recursive: true });
fs.mkdirSync(HISTORY_DIR, { recursive: true });
fs.mkdirSync(ROOMS_DIR, { recursive: true });
fs.mkdirSync(LIBRARY_DIR, { recursive: true });
if (!fs.existsSync(MANIFEST)) fs.writeFileSync(MANIFEST, JSON.stringify({ widgets: [] }, null, 2));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Glade is open at http://localhost:${PORT}`);
  for (const ip of localIPs()) console.log(`    on your network: http://${ip}:${PORT}`);
  console.log("");
});
