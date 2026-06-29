// Drives the real Glade UI to verify the widget library end to end: the 6-dot
// handle (top-left of the chrome) as a drag-to-move AND click-to-open-menu
// control, saving a stateful widget (with its state) and a backend-backed
// widget to the library, the live picker grid with previews, and summoning a
// widget back into the room with its state restored.
//
// Runs an isolated copy of the server in a temp dir (the server has no npm
// deps) so a Glade instance you already have running — and your real canvas —
// are never touched. No coding harness is invoked.
// Run: node test/ui-library.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = path.join(ROOT, "test", ".tmp-library");
const PORT = 4195;
const BASE = `http://localhost:${PORT}`;
const URL = `${BASE}/`;

const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };
const j = (p, opts) => fetch(BASE + p, opts).then((r) => r.json());
const post = (p, body) => j(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

const COUNTER_WIDGET = `export default {
  title: "Counter",
  size: "small",
  async mount(el, glade) {
    let n = Number(glade.store.get("n", 0)) || 0;
    el.innerHTML = '<button class="g-btn" id="inc" style="font-size:18px">count: <span id="v">' + n + '</span></button>';
    el.querySelector("#inc").onclick = () => {
      n += 1;
      glade.store.set("n", n);
      el.querySelector("#v").textContent = String(n);
    };
  },
};
`;
const STAMP_WIDGET = `export default {
  title: "Stamp",
  size: "small",
  async mount(el, glade) {
    el.innerHTML = '<div id="s" style="padding:10px;font-size:18px">loading…</div>';
    try { const r = await glade.call({}); el.querySelector("#s").textContent = "stamp:" + r.stamp; }
    catch (e) { el.querySelector("#s").textContent = "err:" + e.message; }
  },
};
`;
const STAMP_BACKEND = `module.exports = async () => ({ stamp: "BK42" });\n`;

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

function setupTempServer() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "server.js"), path.join(TMP, "server.js"));
  fs.cpSync(path.join(ROOT, "web"), path.join(TMP, "web"), { recursive: true });
  // a clean canvas with a stateful widget and a backend-backed widget
  fs.rmSync(path.join(TMP, "web/widgets"), { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, "web/widgets/lib-counter"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "web/widgets/stamp"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "backends"), { recursive: true });
  fs.writeFileSync(path.join(TMP, "web/widgets/lib-counter/widget.js"), COUNTER_WIDGET);
  fs.writeFileSync(path.join(TMP, "web/widgets/stamp/widget.js"), STAMP_WIDGET);
  fs.writeFileSync(path.join(TMP, "backends/stamp.js"), STAMP_BACKEND);
  fs.writeFileSync(path.join(TMP, "web/widgets/manifest.json"), JSON.stringify({ widgets: [
    { slug: "lib-counter", title: "Counter", size: "small", env: [] },
    { slug: "stamp", title: "Stamp", size: "small", env: [] },
  ] }, null, 2));
}

const SEL = {
  counter: '.widget[data-slug="lib-counter"]',
  v: '.widget[data-slug="lib-counter"] #v',
  menu: '.widget[data-slug="lib-counter"] .drag-dot',
  close: '.widget[data-slug="lib-counter"] .widget-close',
  card: '#library .lib-card[data-slug="lib-counter"]',
};

async function main() {
  setupTempServer();

  // ROOT (not TMP) as cwd so the child never holds a handle on the temp dir we
  // delete afterwards; the server roots itself at its own __dirname regardless.
  const server = spawn("node", [path.join(TMP, "server.js")], {
    cwd: ROOT, env: { ...process.env, GLADE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"],
  });

  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // deterministic, non-overlapping placement so clicks never hit the wrong widget
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("glade-geom", JSON.stringify({
        "lib-counter": { x: 40, y: 70, w: 320, h: 200, z: 11 },
        "stamp": { x: 760, y: 70, w: 320, h: 200, z: 12 },
      }));
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(URL);

    // --- the widget mounts and is stateful ---
    await page.waitForSelector(SEL.counter, { timeout: 5000 });
    ok("sandbox widget mounted");
    for (let i = 0; i < 3; i++) await page.click(`${SEL.counter} #inc`);
    await page.waitForFunction((s) => document.querySelector(s)?.textContent === "3", SEL.v, { timeout: 3000 });
    ok("widget state increments (count = 3)");

    // --- the top-left 6-dot handle is the interactive menu control ---
    const role = await page.getAttribute(SEL.menu, "role");
    role === "button" ? ok("the top-left 6-dot handle is the options control (role=button)") : fail(`drag-dot not a menu control: role=${role}`);

    // --- clicking the handle opens a menu and saves the widget ---
    await page.click(SEL.menu);
    await page.waitForSelector(".widget-menu-pop.on", { timeout: 3000 });
    ok("clicking the 6-dot handle opens the widget menu");
    await page.click(".widget-menu-pop .wm-item:has-text('Save widget')");
    await page.waitForFunction(() => /saved/i.test(document.getElementById("flash")?.textContent || ""), null, { timeout: 4000 });
    ok("“Save widget” saves to the library (flash shown)");

    // --- the server stored the widget WITH its captured state ---
    const lib = await j("/api/library");
    const saved = (lib.widgets || []).find((w) => w.slug === "lib-counter");
    saved && saved.hasState && saved.state && saved.state.n === 3
      ? ok("library stored the widget with its state (n = 3)")
      : fail(`library entry wrong: ${JSON.stringify(saved)}`);

    // --- the library is independent of rooms (so it transfers between them) ---
    const room = await post("/api/rooms/save", { name: "lib-keep" });
    const libAfterRoom = await j("/api/library");
    room.ok && (libAfterRoom.widgets || []).some((w) => w.slug === "lib-counter")
      ? ok("library persists across room operations (cross-room transfer)")
      : fail("library did not survive a room save");

    // --- dragging the handle MOVES the widget and does NOT open the menu ---
    const before = await page.$eval(SEL.counter, (el) => parseFloat(el.style.left) || 0);
    const box = await page.locator(SEL.menu).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2 + 50, { steps: 10 });
    await page.mouse.up();
    const after = await page.$eval(SEL.counter, (el) => parseFloat(el.style.left) || 0);
    const popCount = await page.locator(".widget-menu-pop").count();
    after > before + 30 && popCount === 0
      ? ok("dragging the 6-dot handle moves the widget without opening the menu")
      : fail(`drag misbehaved: before=${before} after=${after} popCount=${popCount}`);

    // --- the menu closes on Escape ---
    await page.click(SEL.menu);
    await page.waitForSelector(".widget-menu-pop.on", { timeout: 3000 });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".widget-menu-pop").length === 0, null, { timeout: 3000 });
    ok("widget menu closes on Escape");

    // --- diverge live state from the saved snapshot, then remove the widget ---
    for (let i = 0; i < 2; i++) await page.click(`${SEL.counter} #inc`);
    await page.waitForFunction((s) => document.querySelector(s)?.textContent === "5", SEL.v, { timeout: 3000 });
    await page.click(SEL.close);
    await page.waitForFunction((s) => !document.querySelector(s), SEL.counter, { timeout: 4000 });
    ok("widget removed from the room (live state had diverged to 5)");

    // --- the picker shows a LIVE preview reflecting the SAVED state (3, not 5) ---
    await page.click("#librarybtn");
    await page.waitForSelector(`${SEL.card} .lib-frame`, { timeout: 4000 });
    ok("widget picker opens as a live grid");
    await page.waitForFunction(
      (s) => /count:\s*3/.test(document.querySelector(s)?.textContent || ""),
      `${SEL.card} .lib-frame`, { timeout: 5000 }
    );
    ok("picker renders a LIVE preview seeded from the saved state (count = 3)");

    // --- selecting a card brings it into the room with its state restored ---
    await page.click(`${SEL.card} .lib-preview`);
    await page.waitForSelector(SEL.counter, { timeout: 5000 });
    await page.waitForFunction((s) => document.querySelector(s)?.textContent === "3", SEL.v, { timeout: 4000 });
    ok("selecting a widget summons it into the room with restored state (count = 3)");
    const libClosed = await page.evaluate(() => {
      const el = document.getElementById("library");
      return !el || el.hidden || !el.classList.contains("on");
    });
    libClosed ? ok("picker closes after selecting a widget") : fail("picker stayed open after select");

    // --- a backend-backed widget: save copies the backend; preview runs it ---
    await page.waitForFunction(() => /stamp:BK42/.test(document.querySelector('.widget[data-slug="stamp"]')?.textContent || ""), null, { timeout: 5000 });
    await page.click('.widget[data-slug="stamp"] .drag-dot');
    await page.click(".widget-menu-pop .wm-item:has-text('Save widget')");
    await page.waitForFunction(() => /saved/i.test(document.getElementById("flash")?.textContent || ""), null, { timeout: 4000 });
    const lib2 = await j("/api/library");
    const stamp = (lib2.widgets || []).find((w) => w.slug === "stamp");
    stamp && stamp.hasBackend ? ok("backend-backed widget saved with its backend") : fail(`stamp entry wrong: ${JSON.stringify(stamp)}`);
    await page.click("#librarybtn");
    await page.waitForSelector('#library .lib-card[data-slug="stamp"] .lib-frame', { timeout: 4000 });
    await page.waitForFunction(
      () => /stamp:BK42/.test(document.querySelector('#library .lib-card[data-slug="stamp"] .lib-frame')?.textContent || ""),
      null, { timeout: 5000 }
    );
    ok("picker preview runs the saved backend (stamp:BK42)");
    await page.keyboard.press("Escape");

    errors.length === 0 ? ok("no uncaught page errors during the flow") : fail(`page errors: ${errors.join(" | ")}`);
  } catch (err) {
    fail(err.message);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    await new Promise((r) => { server.once("close", r); setTimeout(r, 2000); });
    try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
  }

  console.log(process.exitCode ? "\nLIBRARY UI TEST FAILED\n" : "\nLIBRARY UI TEST PASSED\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
