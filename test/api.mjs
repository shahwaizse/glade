// Exercises Glade's platform API over HTTP: config/harness switching, snapshot
// history + undo, rooms save/open, the outbound proxy, and persistent shell
// sessions. Uses a throwaway temp canvas so the user's widgets are untouched.
// Run: node test/api.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4197;
const BASE = `http://localhost:${PORT}`;

const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };
const j = (p, opts) => fetch(BASE + p, opts).then((r) => r.json());
const post = (p, body) => j(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { if ((await fetch(`${BASE}/api/state`)).ok) return resolve(); } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error("server did not start"));
      setTimeout(tick, 150);
    };
    tick();
  });
}

function sse(pathname, onMsg, ms = 1500) {
  // minimal SSE reader (no EventSource in node) — resolves with collected events
  return new Promise(async (resolve) => {
    const controller = new AbortController();
    const events = [];
    const timer = setTimeout(() => { controller.abort(); resolve(events); }, ms);
    try {
      const res = await fetch(BASE + pathname, { signal: controller.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (line) { const ev = JSON.parse(line.slice(6)); events.push(ev); onMsg?.(ev, () => { clearTimeout(timer); controller.abort(); resolve(events); }); }
        }
      }
    } catch {}
    clearTimeout(timer);
    resolve(events);
  });
}

async function main() {
  const CONFIG = path.join(ROOT, "glade.config.json");
  const hadConfig = fs.existsSync(CONFIG);
  const backup = hadConfig ? fs.readFileSync(CONFIG) : null;

  // sandbox the canvas: stash real widgets/backends/.glade, restore at the end
  const stash = [];
  for (const rel of ["web/widgets", "backends", ".glade"]) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) { const bak = p + ".testbak"; fs.rmSync(bak, { recursive: true, force: true }); fs.renameSync(p, bak); stash.push([p, bak]); }
  }
  fs.mkdirSync(path.join(ROOT, "web/widgets"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "backends"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "web/widgets/manifest.json"), JSON.stringify({ widgets: [] }, null, 2));

  const server = spawn("node", ["server.js"], {
    cwd: ROOT, env: { ...process.env, GLADE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"],
  });

  try {
    await waitForServer();
    ok("server booted");

    // --- config / harness switching ---
    const cfg = await j("/api/config");
    Array.isArray(cfg.harnessChain) ? ok(`config exposes harness chain (${cfg.harnessChain.join(",")})`) : fail("no harness chain");
    await post("/api/config", { harness: "codex" });
    (await j("/api/config")).harness === "codex" ? ok("harness switch persisted") : fail("harness switch not persisted");
    await post("/api/config", { harness: "claude" });

    // --- snapshots / history / undo ---
    // seed a widget, snapshot, mutate, restore
    const wdir = path.join(ROOT, "web/widgets/probe");
    fs.mkdirSync(wdir, { recursive: true });
    fs.writeFileSync(path.join(wdir, "widget.js"), "export default { title:'P', mount(){} };");
    fs.writeFileSync(path.join(ROOT, "web/widgets/manifest.json"), JSON.stringify({ widgets: [{ slug: "probe", title: "P", size: "small", env: [] }] }, null, 2));
    // trigger a snapshot the cheap way: save a room captures, but history needs /api/generate or removeWidget.
    // deleting a widget snapshots first, so: add, delete -> snapshot holds the widget, undo brings it back.
    const del = await fetch(`${BASE}/api/widget/probe`, { method: "DELETE" }).then((r) => r.json());
    del.ok ? ok("widget delete works (and snapshots first)") : fail("delete failed");
    (await j("/api/state")).widgets.length === 0 ? ok("canvas empty after delete") : fail("widget not removed");
    const hist = await j("/api/history");
    hist.history.length >= 1 ? ok(`history has ${hist.history.length} snapshot(s)`) : fail("no history recorded");
    const undo = await post("/api/undo", {});
    undo.ok ? ok("undo restored the snapshot") : fail(`undo failed: ${undo.error}`);
    (await j("/api/state")).widgets.some((w) => w.slug === "probe") ? ok("undo brought the widget back") : fail("widget not restored by undo");

    // --- rooms ---
    const saved = await post("/api/rooms/save", { name: "Test Room!" });
    saved.ok && saved.name === "test-room" ? ok(`room saved as “${saved.name}”`) : fail(`room save failed: ${JSON.stringify(saved)}`);
    (await j("/api/rooms")).rooms.some((r) => r.name === "test-room") ? ok("room appears in list") : fail("room not listed");
    // clear then re-open the room
    await fetch(`${BASE}/api/widget/probe`, { method: "DELETE" });
    const opened = await post("/api/rooms/open", { name: "test-room" });
    opened.ok ? ok("room opened") : fail(`room open failed: ${opened.error}`);
    (await j("/api/state")).widgets.some((w) => w.slug === "probe") ? ok("opening the room restored its widget") : fail("room open did not restore widgets");

    // --- proxy ---
    const prox = await post("/api/proxy", { url: `${BASE}/api/state` });
    prox.ok && JSON.parse(prox.body).widgets ? ok("proxy fetched a URL and returned its body") : fail(`proxy failed: ${JSON.stringify(prox).slice(0,120)}`);
    const badProx = await post("/api/proxy", { url: "ftp://nope" });
    !badProx.ok || badProx.error ? ok("proxy rejects non-http urls") : fail("proxy accepted a bad url");

    // --- shell ---
    const sh = await post("/api/shell/open", {});
    sh.ok && sh.id ? ok(`shell session opened (${sh.id})`) : fail("shell open failed");
    // attach the stream, then send a command and expect to see its output
    const got = await sse(`/api/shell/stream?id=${encodeURIComponent(sh.id)}`, async (ev, stop) => {
      if (ev.type === "out" && /GLADE_SHELL_OK/.test(ev.data)) stop();
    }, 3000);
    // fire the command shortly after the stream is attached
    setTimeout(() => post("/api/shell/input", { id: sh.id, data: "echo GLADE_SHELL_OK\n" }), 200);
    const got2 = await sse(`/api/shell/stream?id=${encodeURIComponent(sh.id)}`, (ev, stop) => { if (/GLADE_SHELL_OK/.test(ev.data || "")) stop(); }, 3000);
    [...got, ...got2].some((e) => /GLADE_SHELL_OK/.test(e.data || "")) ? ok("shell ran a command and streamed its output") : fail("shell output not received");

    // --- ctx.state persists across hot-reloads (the multiplayer bone) ---
    fs.writeFileSync(path.join(ROOT, "backends/counter.js"),
      "module.exports = async (p, ctx) => { ctx.state.n = (ctx.state.n||0)+1; return { n: ctx.state.n }; };");
    const c1 = await post("/api/widget/counter", {});
    const c2 = await post("/api/widget/counter", {});
    c1.result.n === 1 && c2.result.n === 2 ? ok("ctx.state survives backend hot-reload across calls") : fail(`ctx.state not persisted: ${JSON.stringify([c1, c2])}`);

    // --- netinfo ---
    const net = await j("/api/netinfo");
    net.port === PORT && Array.isArray(net.urls) ? ok("netinfo reports port + LAN urls") : fail("netinfo malformed");
  } catch (err) {
    fail(err.message);
  } finally {
    server.kill("SIGTERM");
    // restore the real canvas
    for (const rel of ["web/widgets", "backends", ".glade"]) fs.rmSync(path.join(ROOT, rel), { recursive: true, force: true });
    for (const [p, bak] of stash) fs.renameSync(bak, p);
    if (hadConfig) fs.writeFileSync(CONFIG, backup); else fs.rmSync(CONFIG, { force: true });
  }

  console.log(process.exitCode ? "\nAPI TEST FAILED\n" : "\nAPI TEST PASSED\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
