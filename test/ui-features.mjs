// Drives the real Glade UI to verify the new shell features end to end:
// command palette, non-image attachment chips, summoning a core widget
// (Terminal), the live build feed, and the harness pill. Uses mock harnesses.
// Run: node test/ui-features.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "test", "bin");
const PORT = 4196;
const CONFIG = path.join(ROOT, "glade.config.json");
const URL = `http://localhost:${PORT}/`;

const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };

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
  for (const f of ["mock-limit", "mock-ok"]) fs.chmodSync(path.join(BIN, f), 0o755);
  const hadConfig = fs.existsSync(CONFIG);
  const backup = hadConfig ? fs.readFileSync(CONFIG) : null;
  fs.copyFileSync(path.join(ROOT, "test", "glade.config.test.json"), CONFIG);

  const csvFile = path.join(ROOT, "test", "fixture.csv");
  fs.writeFileSync(csvFile, "a,b,c\n1,2,3\n");

  const server = spawn("node", ["server.js"], {
    cwd: ROOT, env: { ...process.env, GLADE_PORT: String(PORT), PATH: `${BIN}:${process.env.PATH}` },
    stdio: ["ignore", "ignore", "inherit"],
  });

  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.clear());
    await page.goto(URL);
    ok("page loaded");

    // harness pill reflects the active (mock) harness
    const pill = (await page.textContent("#harnesspill")).trim();
    pill === "mock-limit" ? ok(`harness pill shows active harness (${pill})`) : fail(`pill wrong: ${pill}`);

    // command palette opens with "/"
    await page.keyboard.press("/");
    await page.waitForSelector("#palette:not([hidden]) .pal-row", { timeout: 4000 });
    const rowCount = await page.locator("#pallist .pal-row").count();
    rowCount > 0 ? ok(`palette opens with "/" (${rowCount} commands)`) : fail("palette empty");

    // palette can filter
    await page.fill("#palinput", "terminal");
    await page.waitForFunction(() => document.querySelectorAll("#pallist .pal-row").length >= 1);
    const filtered = await page.locator("#pallist .pal-row").allTextContents();
    filtered.some((t) => /terminal/i.test(t)) ? ok("palette filters by query") : fail(`filter failed: ${filtered}`);

    // summon the Terminal core widget from the palette
    await page.locator("#pallist .pal-row", { hasText: /Open Terminal/i }).first().click();
    await page.waitForSelector('.widget[data-slug="terminal"] .term-out', { timeout: 5000 });
    ok("summoning Terminal mounts a core widget");

    // the terminal core widget actually wires to a shell session
    await page.fill('.widget[data-slug="terminal"] #t-in', "echo HELLO_GLADE");
    await page.press('.widget[data-slug="terminal"] #t-in', "Enter");
    await page.waitForFunction(
      () => /HELLO_GLADE/.test(document.querySelector('.widget[data-slug="terminal"] .term-out')?.textContent || ""),
      null, { timeout: 5000 }
    );
    ok("terminal runs a command and shows output");

    // non-image attachment shows a file chip (not an <img>)
    await page.setInputFiles("#imgfile", csvFile);
    await page.waitForSelector("#thumbs .thumb .thumb-file", { timeout: 4000 });
    const chipText = await page.textContent("#thumbs .thumb .thumb-file");
    /fixture/.test(chipText) ? ok("attaching a CSV shows a file chip") : fail(`chip text wrong: ${chipText}`);

    // submit → live build feed accretes rows, then settles
    await page.fill("#prompt", "make a demo widget");
    await page.click("#go");
    await page.waitForFunction(() => document.querySelectorAll("#genfeed .feed-row").length >= 1, null, { timeout: 8000 });
    ok("generation renders a live build feed");
    await page.waitForFunction(() => /built it/.test(document.getElementById("genstatus").textContent), null, { timeout: 8000 });
    ok("feed shows the harness's final result");

    // open the Glade introspection panel via palette
    await page.keyboard.press("/");
    await page.waitForSelector("#palette:not([hidden]) .pal-row", { timeout: 4000 });
    await page.locator("#pallist .pal-row", { hasText: /Open Glade/i }).first().click();
    await page.waitForSelector('.widget[data-slug="glade-panel"] .gp', { timeout: 5000 });
    const gpText = await page.textContent('.widget[data-slug="glade-panel"] .gp');
    /Harness/.test(gpText) && /Constructs/.test(gpText) ? ok("Glade panel introspects the system") : fail("glade panel missing sections");
  } catch (err) {
    fail(err.message);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    fs.rmSync(csvFile, { force: true });
    if (hadConfig) fs.writeFileSync(CONFIG, backup); else fs.rmSync(CONFIG, { force: true });
  }

  console.log(process.exitCode ? "\nUI FEATURES TEST FAILED\n" : "\nUI FEATURES TEST PASSED\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
