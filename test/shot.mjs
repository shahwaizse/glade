import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "test", "bin");
const PORT = 4197;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const server = spawn("node", ["server.js"], {
  cwd: ROOT, env: { ...process.env, GLADE_PORT: String(PORT), PATH: `${BIN}${path.delimiter}${process.env.PATH}` },
  stdio: ["ignore", "ignore", "inherit"],
});
const real = path.join(ROOT, "web", "gen-images", "1.jpg");
const real2 = path.join(ROOT, "web", "gen-images", "2.jpg");
const img = fs.existsSync(real) ? real : path.join(ROOT, "test", "fixture.png");
if (!fs.existsSync(real)) fs.writeFileSync(img, PNG);
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
await page.goto(`http://localhost:${PORT}/`);
await page.setInputFiles("#imgfile", fs.existsSync(real2) ? [img, real2] : [img]);
await page.fill("#prompt", "match this design");
await page.waitForSelector("#thumbs .thumb img");
await page.screenshot({ path: path.join(ROOT, "test", "shot.png") });
await browser.close();
server.kill("SIGTERM");
fs.rmSync(img, { force: true });
console.log("wrote test/shot.png");
