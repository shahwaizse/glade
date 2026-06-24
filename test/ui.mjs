// Drives the real Glade UI in a browser to verify the image-input field and
// the harness-switch status message end to end. Uses the mock harnesses so no
// real coding harness is invoked.
// Run: node test/ui.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "test", "bin");
const PORT = 4198;
const CONFIG = path.join(ROOT, "glade.config.json");
const URL = `http://localhost:${PORT}/`;
const MOCKS = ["mock-limit", "mock-ok", "mock-codex-json"];

const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { if ((await fetch(`http://localhost:${PORT}/api/state`)).ok) return resolve(); } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error("server did not start"));
      setTimeout(tick, 150);
    };
    tick();
  });
}

async function main() {
  for (const f of MOCKS) fs.chmodSync(path.join(BIN, f), 0o755);
  const hadConfig = fs.existsSync(CONFIG);
  const backup = hadConfig ? fs.readFileSync(CONFIG) : null;
  fs.copyFileSync(path.join(ROOT, "test", "glade.config.test.json"), CONFIG);

  const imgFile = path.join(ROOT, "test", "fixture.png");
  fs.writeFileSync(imgFile, PNG_BYTES);

  const server = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, GLADE_PORT: String(PORT), PATH: `${BIN}${path.delimiter}${process.env.PATH}` },
    stdio: ["ignore", "ignore", "inherit"],
  });

  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const page = await browser.newPage();
    const requests = [];
    let genBody = null;
    let genBodyPromise = Promise.resolve();
    page.on("request", (r) => {
      if (r.url().endsWith("/api/generate") && r.method() === "POST") {
        try { requests.push(JSON.parse(r.postData() || "{}")); } catch {}
      }
    });
    // Capture the NDJSON stream the browser actually received from the server —
    // the transient status line is overwritten too fast to assert on reliably.
    page.on("response", async (resp) => {
      if (resp.url().endsWith("/api/generate")) {
        genBodyPromise = resp.text().then((text) => { genBody = text; }).catch(() => {});
      }
    });

    await page.goto(URL);
    ok("page loaded");

    // Attach an image via the hidden file input (the visible ＋ button proxies to it).
    await page.setInputFiles("#imgfile", imgFile);
    await page.waitForSelector("#thumbs .thumb img", { timeout: 4000 });
    ok("attaching an image shows a thumbnail in the command bar");

    // Submit the prompt with the image attached.
    await page.fill("#prompt", "make a demo widget");
    await page.click("#go");

    // The UI should render the fallback harness's final result once failover
    // completes — proof the switch happened and the user saw a working result.
    await page.waitForFunction(
      () => /built it/.test(document.getElementById("genstatus").textContent),
      null,
      { timeout: 8000 }
    );
    ok("UI renders the fallback harness's final result after failover");
    await genBodyPromise;

    // The NDJSON the browser received must contain the switch event.
    const events = (genBody || "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const sw = events.find((e) => e.type === "switch");
    sw && sw.from === "mock-limit" && sw.to === "mock-ok"
      ? ok("browser received the harness-switch event (mock-limit → mock-ok)")
      : fail(`no switch event in stream: ${JSON.stringify(events.map((e) => e.type))}`);

    // The outbound request must carry the attachment payload.
    const req = requests[0];
    const att = req && (req.attachments || req.images);
    att && Array.isArray(att) && att.length === 1 && /^data:image\//.test(att[0].data)
      ? ok("generate request included the attached image data")
      : fail(`generate request missing attachment payload: ${JSON.stringify(req && Object.keys(req))}`);

    // The fallback harness confirms it saw the image path, end to end in the UI.
    const finalStatus = await page.evaluate(() => document.getElementById("genstatus").textContent);
    /image=yes/.test(finalStatus)
      ? ok("attached image reached the fallback harness through the UI path")
      : fail(`fallback harness did not report seeing the image: ${finalStatus}`);

    // Thumbnail tray clears after submit.
    await page.waitForFunction(() => document.getElementById("thumbs").hidden, null, { timeout: 4000 });
    ok("thumbnail tray clears after sending");
  } catch (err) {
    fail(err.message);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    fs.rmSync(imgFile, { force: true });
    if (hadConfig) fs.writeFileSync(CONFIG, backup);
    else fs.rmSync(CONFIG, { force: true });
  }

  console.log(process.exitCode ? "\nUI TEST FAILED\n" : "\nUI TEST PASSED\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
