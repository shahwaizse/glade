/*
 * Glade server — zero dependencies.
 *
 * Responsibilities:
 *  - Serve the web UI from ./web
 *  - Spawn the coding harness (claude / codex) headlessly against this repo
 *    and stream its progress to the browser as NDJSON
 *  - Hot-load widget backends from ./backends/<slug>.js (fresh require each call)
 *  - Read/write .env for widgets that need secrets
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const WEB = path.join(ROOT, "web");
const BACKENDS = path.join(ROOT, "backends");
const ENV_FILE = path.join(ROOT, ".env");
const MANIFEST = path.join(WEB, "widgets", "manifest.json");
const CONFIG_FILE = path.join(ROOT, "glade.config.json");
const PORT = process.env.GLADE_PORT || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
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
        codex: ["exec", "--full-auto", "--json"],
      },
    },
    readJSON(CONFIG_FILE, {})
  );
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

// ---------- harness ----------

const HARNESS_PROMPT_PREFIX = `You are running inside Glade, a self-extending UI. Read CLAUDE.md in this directory FIRST and follow the widget contract exactly: create the widget module under web/widgets/<slug>/widget.js, an optional backend in backends/<slug>.js, register it in web/widgets/manifest.json, and declare any required env vars in the manifest. Do NOT restart the server; backends are hot-loaded and the UI refreshes itself. Do NOT modify server.js, web/index.html, web/app.js, web/glass.js, or web/styles.css unless the user's request explicitly requires changing Glade's shell.

User request: `;

// Signals that a harness has run out of usage/quota and we should fail over.
const LIMIT_RE =
  /usage limit|rate.?limit|\b429\b|too many requests|quota|exceeded your|limit reached|insufficient[_ ]quota|out of credit|credit balance|overloaded/i;

// Ordered list of harness commands to try. The active harness comes first,
// then any remaining configured harnesses (explicit `harnessFallback` wins).
function harnessChain(config) {
  if (Array.isArray(config.harnessFallback) && config.harnessFallback.length) {
    return config.harnessFallback.filter((h) => (config.harnessArgs || {})[h] !== undefined || true);
  }
  const first = config.harness;
  const rest = Object.keys(config.harnessArgs || {}).filter((h) => h !== first);
  return [first, ...rest];
}

// Build the full prompt for a single attempt: shell instructions + the user
// request, any attached image paths, and (on failover) a note that a previous
// harness left partial work on disk to continue from.
function buildPrompt(userRequest, imagePaths, priorHarness) {
  let prompt = HARNESS_PROMPT_PREFIX + userRequest;
  if (imagePaths && imagePaths.length) {
    prompt +=
      `\n\nThe user attached ${imagePaths.length} image(s). Read them with your file tools before building, ` +
      `treating them as part of the request (a design to match, a screenshot, data to extract, etc.):\n` +
      imagePaths.map((p) => "  " + p).join("\n");
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
  return false; // assistant / system / tool events never trigger a switch
}

// Decode base64 data-URL images from a generate request, write them under
// uploads/, and return their absolute paths for the harness to read.
function saveImages(images) {
  if (!Array.isArray(images) || !images.length) return [];
  const dir = path.join(ROOT, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const extByMime = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg",
  };
  const saved = [];
  images.forEach((img, i) => {
    const data = typeof img === "string" ? img : img && img.data;
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(data || "");
    if (!m) return;
    const ext = extByMime[m[1].toLowerCase()] || "png";
    const file = path.join(dir, `glade-${Date.now()}-${i}.${ext}`);
    fs.writeFileSync(file, Buffer.from(m[2], "base64"));
    saved.push(file);
  });
  return saved;
}

// Run the request against the fallback chain, automatically switching to the
// next harness if the current one reports a usage limit.
function runHarness(userRequest, imagePaths, res) {
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

    runAttempt(harness, buildPrompt(userRequest, imagePaths, priorHarness), config, emit, res, (outcome) => {
      if (outcome === "limit") {
        const next = chain[idx + 1];
        if (next) {
          emit({ type: "switch", from: harness, to: next, reason: "usage limit reached" });
          priorHarness = harness;
          idx += 1;
          return runNext();
        }
        emit({ type: "error", message: `${harness} hit its usage limit and no fallback harness is configured.` });
        return res.end();
      }
      res.end();
    });
  };

  runNext();
}

// Spawn one harness attempt. Calls done("limit" | "done" | "error") exactly once.
function runAttempt(harness, fullPrompt, config, emit, res, done) {
  const args = [...((config.harnessArgs || {})[harness] || []), fullPrompt];
  emit({ type: "start", harness });

  let child;
  try {
    child = spawn(harness, args, {
      cwd: ROOT,
      env: { ...process.env, ...parseEnvFile() },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    emit({ type: "error", message: `failed to spawn ${harness}: ${err.message}` });
    return done("error");
  }

  let limitHit = false;
  let settled = false;
  const finish = (outcome) => {
    if (settled) return;
    settled = true;
    done(outcome);
  };
  const flagLimit = () => {
    if (limitHit) return;
    limitHit = true;
    emit({ type: "log", text: `${harness} signalled a usage limit; failing over…` });
    if (child.exitCode === null) child.kill("SIGTERM"); // stop early so we can switch
  };

  child.on("error", (err) => {
    emit({ type: "error", message: `harness error: ${err.message}` });
    finish(limitHit ? "limit" : "error");
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
    if (LIMIT_RE.test(text)) flagLimit();
    emit({ type: "log", text: text.slice(0, 2000) });
  });
  child.on("close", () => {
    finish(limitHit ? "limit" : "done");
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
        const detail =
          block.input && (block.input.file_path || block.input.command || block.input.description || "");
        emit({ type: "tool", name: block.name, detail: String(detail).slice(0, 200) });
      }
    }
  } else if (ev.type === "result") {
    emit({ type: "result", text: String(ev.result || "").slice(0, 1000) });
  } else if (ev.msg) {
    // Codex --json events
    const m = ev.msg;
    if (m.type === "agent_message" && m.message) {
      emit({ type: "thought", text: String(m.message).slice(0, 400) });
    } else if (m.type === "exec_command_begin") {
      emit({ type: "tool", name: "exec", detail: (m.command || []).join(" ").slice(0, 200) });
    }
  }
}

// ---------- widget backends ----------

async function callWidgetBackend(slug, payload, res) {
  if (!/^[a-z0-9-]+$/.test(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const file = path.join(BACKENDS, slug + ".js");
  if (!fs.existsSync(file)) return sendJSON(res, 404, { error: `no backend for ${slug}` });
  try {
    delete require.cache[require.resolve(file)]; // hot reload
    const handler = require(file);
    const fn = typeof handler === "function" ? handler : handler.handler;
    const result = await fn(payload, { env: { ...process.env, ...parseEnvFile() }, root: ROOT });
    sendJSON(res, 200, { ok: true, result });
  } catch (err) {
    sendJSON(res, 500, { ok: false, error: err.message, stack: String(err.stack).split("\n").slice(0, 5) });
  }
}

function removeWidget(slug, res) {
  if (!/^[a-z0-9-]+$/.test(slug)) return sendJSON(res, 400, { error: "bad slug" });
  const manifest = readJSON(MANIFEST, { widgets: [] });
  manifest.widgets = (manifest.widgets || []).filter((w) => w.slug !== slug);
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  fs.rmSync(path.join(WEB, "widgets", slug), { recursive: true, force: true });
  fs.rmSync(path.join(BACKENDS, slug + ".js"), { force: true });
  sendJSON(res, 200, { ok: true });
}

// ---------- state ----------

function getState(res) {
  const manifest = readJSON(MANIFEST, { widgets: [] });
  const env = parseEnvFile();
  const widgets = (manifest.widgets || []).map((w) => ({
    ...w,
    missingEnv: (w.env || []).filter((k) => !(k in env) && !(k in process.env)),
  }));
  sendJSON(res, 200, { widgets, harness: loadConfig().harness });
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === "/api/state" && req.method === "GET") return getState(res);

    if (p === "/api/generate" && req.method === "POST") {
      const { prompt, images } = JSON.parse((await readBody(req, 30e6)) || "{}");
      const imagePaths = saveImages(images);
      if ((!prompt || !prompt.trim()) && !imagePaths.length)
        return sendJSON(res, 400, { error: "empty prompt" });
      return runHarness((prompt || "").trim() || "(see attached image)", imagePaths, res);
    }

    if (p === "/api/env" && req.method === "POST") {
      const updates = JSON.parse((await readBody(req)) || "{}");
      writeEnvFile(updates);
      return sendJSON(res, 200, { ok: true });
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
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
if (!fs.existsSync(MANIFEST)) fs.writeFileSync(MANIFEST, JSON.stringify({ widgets: [] }, null, 2));

server.listen(PORT, () => {
  console.log(`\n  ✦ Glade is open at http://localhost:${PORT}\n`);
});
