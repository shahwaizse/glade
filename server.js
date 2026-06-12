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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 5e6) reject(new Error("body too large"));
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

function runHarness(prompt, res) {
  const config = loadConfig();
  const harness = config.harness;
  const args = [...(config.harnessArgs[harness] || [])];
  // claude takes the prompt after -p; codex exec takes it as final arg
  args.push(HARNESS_PROMPT_PREFIX + prompt);

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  const emit = (obj) => res.write(JSON.stringify(obj) + "\n");
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
    return res.end();
  }

  child.on("error", (err) => {
    emit({ type: "error", message: `harness error: ${err.message}` });
    res.end();
  });

  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      forwardHarnessLine(line, emit);
    }
  });
  child.stderr.on("data", (chunk) => {
    emit({ type: "log", text: chunk.toString().slice(0, 2000) });
  });
  child.on("close", (code) => {
    emit({ type: "done", code });
    res.end();
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
      const { prompt } = JSON.parse((await readBody(req)) || "{}");
      if (!prompt || !prompt.trim()) return sendJSON(res, 400, { error: "empty prompt" });
      return runHarness(prompt.trim(), res);
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
