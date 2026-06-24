// Boots the Glade server against mock harnesses and verifies, over HTTP:
//   1. image attachments are saved to uploads/ and their path reaches the harness
//   2. a usage-limit signal triggers automatic failover to the next harness,
//      with a continuation note carried across.
// Run: node test/smoke.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "test", "bin");
const PORT = 4199;
const CONFIG = path.join(ROOT, "glade.config.json");
const MOCKS = ["mock-limit", "mock-ok", "mock-codex-json"];

const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };

// 1x1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(`http://localhost:${PORT}/api/state`);
        if (r.ok) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error("server did not start"));
      setTimeout(tick, 150);
    };
    tick();
  });
}

async function readNdjson(res) {
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) try { events.push(JSON.parse(line)); } catch {}
    }
  }
  return events;
}

async function main() {
  for (const f of MOCKS) fs.chmodSync(path.join(BIN, f), 0o755);

  const hadConfig = fs.existsSync(CONFIG);
  const backup = hadConfig ? fs.readFileSync(CONFIG) : null;
  fs.copyFileSync(path.join(ROOT, "test", "glade.config.test.json"), CONFIG);

  // clear any leftover uploads so the count assertion is meaningful
  const uploads = path.join(ROOT, "uploads");
  fs.rmSync(uploads, { recursive: true, force: true });

  const server = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, GLADE_PORT: String(PORT), PATH: `${BIN}${path.delimiter}${process.env.PATH}` },
    stdio: ["ignore", "ignore", "inherit"],
  });

  try {
    await waitForServer();
    ok("server booted with mock harnesses");

    const res = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "make a demo widget", images: [{ name: "x.png", data: PNG }] }),
    });
    const events = await readNdjson(res);

    const sw = events.find((e) => e.type === "switch");
    sw && sw.from === "mock-limit" && sw.to === "mock-ok"
      ? ok("failover: switched mock-limit → mock-ok on usage limit")
      : fail(`expected a switch event, got: ${JSON.stringify(events.map((e) => e.type))}`);

    const result = events.find((e) => e.type === "result");
    result && /image=yes/.test(result.text)
      ? ok("attached image path reached the fallback harness")
      : fail(`fallback harness did not see the image: ${result && result.text}`);
    result && /continued=yes/.test(result.text)
      ? ok("continuation note carried across the switch")
      : fail(`fallback harness did not get continuation note: ${result && result.text}`);

    const saved = fs.existsSync(uploads) ? fs.readdirSync(uploads) : [];
    saved.length >= 1
      ? ok(`image saved to uploads/ (${saved[0]})`)
      : fail("no image written to uploads/");

    // the limit-signalling harness's noisy thoughts should not leak as result
    !events.some((e) => e.type === "result" && /usage limit/i.test(e.text))
      ? ok("usage-limit text was not surfaced as a result")
      : fail("usage-limit text leaked into a result event");

    await fetch(`http://localhost:${PORT}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ harness: "mock-ok" }),
    });
    const selectedRes = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "use the selected harness" }),
    });
    const selectedEvents = await readNdjson(selectedRes);
    const starts = selectedEvents.filter((e) => e.type === "start").map((e) => e.harness);
    starts[0] === "mock-ok" && !selectedEvents.some((e) => e.type === "switch")
      ? ok("selected harness runs before fallback entries")
      : fail(`selected harness was not first: ${JSON.stringify(starts)}`);

    await fetch(`http://localhost:${PORT}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ harness: "glade-missing-harness", harnessFallback: ["glade-missing-harness", "mock-ok"] }),
    });
    const unavailableRes = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "fall through unavailable harness" }),
    });
    const unavailableEvents = await readNdjson(unavailableRes);
    const unavailableSwitch = unavailableEvents.find((e) => e.type === "switch");
    unavailableSwitch && unavailableSwitch.from === "glade-missing-harness" && unavailableSwitch.to === "mock-ok" && /unavailable/.test(unavailableSwitch.reason || "")
      ? ok("missing harness falls through to the next harness")
      : fail(`missing harness did not switch correctly: ${JSON.stringify(unavailableEvents)}`);

    await fetch(`http://localhost:${PORT}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ harness: "mock-codex-json", harnessFallback: ["mock-codex-json"] }),
    });
    const codexRes = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "parse codex json events" }),
    });
    const codexEvents = await readNdjson(codexRes);
    codexEvents.some((e) => e.type === "tool" && e.name === "exec" && /pwd/.test(e.detail || ""))
      ? ok("current Codex JSON command events become tool feed rows")
      : fail(`Codex command event not forwarded: ${JSON.stringify(codexEvents)}`);
    codexEvents.some((e) => e.type === "thought" && /codex status visible/.test(e.text || ""))
      ? ok("current Codex JSON agent messages become status text")
      : fail(`Codex agent message not forwarded: ${JSON.stringify(codexEvents)}`);
  } finally {
    server.kill("SIGTERM");
    if (hadConfig) fs.writeFileSync(CONFIG, backup);
    else fs.rmSync(CONFIG, { force: true });
  }

  console.log(process.exitCode ? "\nSMOKE FAILED\n" : "\nSMOKE PASSED\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
