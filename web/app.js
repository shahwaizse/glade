/* Glade frontend — command bar, palette, generation feed, widget loader,
 * env panel, the glade widget API (bus / fetch / store / subscribe), core
 * capability widgets, draggable layout, voice, and rooms. */

const stage = document.getElementById("stage");
const grid = document.getElementById("grid");
const cmd = document.getElementById("cmd");
const promptEl = document.getElementById("prompt");
const genwrap = document.getElementById("genwrap");
const genstatus = document.getElementById("genstatus");
const genfeed = document.getElementById("genfeed");
const envpanel = document.getElementById("envpanel");
const envform = document.getElementById("envform");
const envtitle = document.getElementById("envtitle");
const attachBtn = document.getElementById("attach");
const imgInput = document.getElementById("imgfile");
const thumbs = document.getElementById("thumbs");
const micBtn = document.getElementById("mic");
const harnessPill = document.getElementById("harnesspill");
const palette = document.getElementById("palette");
const palinput = document.getElementById("palinput");
const pallist = document.getElementById("pallist");
const palettebtn = document.getElementById("palettebtn");

const mounted = new Map(); // slug -> { def, el, body, core, cleanups[] }
let generating = false;
let lastPrompt = "";
let state = { widgets: [], harness: "claude", harnessChain: [] };
const attached = []; // { name, type, dataUrl, isImage } queued for the next prompt

// ---------- the widget event bus ----------
// Lets widgets talk to each other: glade.emit(channel, data) / glade.on(...).
const bus = new EventTarget();

// ---------- core (built-in) capability widgets ----------
// Shipped with the shell, summoned via the palette, never written to the
// manifest (keeps user widgets pristine). Open set persists in localStorage.
const CORE_WIDGETS = [
  { slug: "terminal", title: "Terminal", size: "large", path: "/core/terminal.js" },
  { slug: "glade-panel", title: "Glade", size: "medium", path: "/core/glade-panel.js" },
];
const coreOpen = () => new Set(JSON.parse(localStorage.getItem("glade-core-open") || "[]"));
const setCoreOpen = (set) => localStorage.setItem("glade-core-open", JSON.stringify([...set]));

// ---------- layout order persistence ----------
const savedOrder = () => JSON.parse(localStorage.getItem("glade-order") || "[]");
function persistOrder() {
  const order = [...grid.children].map((el) => el.dataset.slug).filter(Boolean);
  localStorage.setItem("glade-order", JSON.stringify(order));
}
function applyOrder() {
  const order = savedOrder();
  const rank = (slug) => { const i = order.indexOf(slug); return i === -1 ? 1e9 : i; };
  [...grid.children]
    .sort((a, b) => rank(a.dataset.slug) - rank(b.dataset.slug))
    .forEach((el) => grid.appendChild(el));
}

// ---------- state / widgets ----------

async function loadState() {
  state = await (await fetch("/api/state")).json();
  harnessPill.textContent = state.harness || "claude";

  const liveSlugs = new Set(state.widgets.map((w) => w.slug));
  for (const [slug, m] of mounted) {
    if (m.core) continue; // core widgets aren't governed by server state
    if (!liveSlugs.has(slug)) unmountWidget(slug);
  }
  for (const w of state.widgets) {
    if (mounted.has(w.slug)) {
      const m = mounted.get(w.slug);
      const wasBlocked = m.el.classList.contains("needs-env");
      const nowBlocked = w.missingEnv.length > 0;
      m.el.classList.toggle("needs-env", nowBlocked);
      if (wasBlocked && !nowBlocked) mountWidget(w, m);
      continue;
    }
    await addWidget(w);
  }
  // restore any open core widgets
  for (const slug of coreOpen()) {
    if (!mounted.has(slug)) summonCore(slug);
  }
  applyOrder();
  stage.classList.toggle("empty-state", grid.children.length === 0);
}

function unmountWidget(slug) {
  const m = mounted.get(slug);
  if (!m) return;
  try { m.def.unmount?.(m.body); } catch {}
  for (const fn of m.cleanups) { try { fn(); } catch {} }
  m.el.remove();
  mounted.delete(slug);
}

function widgetShell(w, core) {
  const el = document.createElement("section");
  el.className = `widget glass size-${w.size || "medium"}`;
  el.dataset.slug = w.slug;
  if (core) el.dataset.core = "1";
  el.draggable = false;
  el.innerHTML = `
    <div class="widget-head" draggable="true">
      <span class="drag-dot" title="Drag to rearrange">⋮⋮</span>
      <span class="widget-title"></span>
      <button class="widget-close" title="Remove widget">✕</button>
    </div>
    <div class="widget-body"></div>`;
  el.querySelector(".widget-title").textContent = w.title || w.slug;
  el.querySelector(".widget-close").onclick = async () => {
    if (core) {
      const set = coreOpen(); set.delete(w.slug); setCoreOpen(set);
      unmountWidget(w.slug);
      stage.classList.toggle("empty-state", grid.children.length === 0);
      return;
    }
    await fetch(`/api/widget/${w.slug}`, { method: "DELETE" });
    loadState();
  };
  enableDrag(el);
  grid.appendChild(el);
  return el;
}

async function addWidget(w) {
  const el = widgetShell(w, false);
  const m = { el, body: el.querySelector(".widget-body"), def: {}, core: false, cleanups: [] };
  mounted.set(w.slug, m);

  if (w.missingEnv.length > 0) {
    el.classList.add("needs-env");
    const badge = document.createElement("button");
    badge.className = "env-badge";
    badge.textContent = "needs keys";
    badge.onclick = () => openEnvPanel(w);
    el.querySelector(".widget-head").insertBefore(badge, el.querySelector(".widget-close"));
    openEnvPanel(w);
    return;
  }
  await mountWidget(w, m);
}

// Build the glade API object handed to every widget's mount().
function makeGladeApi(w, m) {
  const ns = `glade:${w.slug}:`;
  return {
    // call the widget's own backend (request/response)
    call: async (payload = {}) => {
      const r = await (await fetch(`/api/widget/${w.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })).json();
      if (!r.ok) throw new Error(r.error || "backend failed");
      return r.result;
    },
    // subscribe to a streaming backend (SSE) — returns an unsubscribe fn
    subscribe: (payload, onMessage) => {
      const src = new EventSource(`/api/stream/${w.slug}?payload=${encodeURIComponent(JSON.stringify(payload || {}))}`);
      src.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
      const close = () => src.close();
      m.cleanups.push(close);
      return close;
    },
    // outbound HTTP without CORS limits, via the server proxy
    fetch: async (url, opts = {}) => {
      const r = await (await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method: opts.method, headers: opts.headers, body: opts.body }),
      })).json();
      if (!r.ok) throw new Error(r.error || "fetch failed");
      return { status: r.status, headers: r.headers, text: r.body, json: () => JSON.parse(r.body) };
    },
    // widget-to-widget bus
    emit: (channel, detail) => bus.dispatchEvent(new CustomEvent(channel, { detail })),
    on: (channel, fn) => {
      const h = (e) => fn(e.detail);
      bus.addEventListener(channel, h);
      const off = () => bus.removeEventListener(channel, h);
      m.cleanups.push(off);
      return off;
    },
    // namespaced persistence
    store: {
      get: (k, d = null) => { const v = localStorage.getItem(ns + k); return v == null ? d : JSON.parse(v); },
      set: (k, v) => localStorage.setItem(ns + k, JSON.stringify(v)),
      del: (k) => localStorage.removeItem(ns + k),
    },
    refresh: () => mountWidget(w, m),
  };
}

async function mountWidget(w, m) {
  m.el.querySelector(".env-badge")?.remove();
  m.body.classList.remove("error");
  m.body.innerHTML = "";
  for (const fn of m.cleanups.splice(0)) { try { fn(); } catch {} }
  try {
    const src = m.core
      ? CORE_WIDGETS.find((c) => c.slug === w.slug).path
      : `/widgets/${w.slug}/widget.js`;
    const mod = await import(`${src}?v=${Date.now()}`);
    m.def = mod.default || {};
    if (m.def.title) m.el.querySelector(".widget-title").textContent = m.def.title;
    if (m.def.size) m.el.className = `widget glass size-${m.def.size}`;
    await m.def.mount(m.body, makeGladeApi(w, m));
  } catch (err) {
    m.body.classList.add("error");
    m.body.textContent = `widget error: ${err.message}`;
  }
}

// Summon a built-in core widget into the grid.
function summonCore(slug) {
  const def = CORE_WIDGETS.find((c) => c.slug === slug);
  if (!def || mounted.has(slug)) return;
  const set = coreOpen(); set.add(slug); setCoreOpen(set);
  const el = widgetShell(def, true);
  const m = { el, body: el.querySelector(".widget-body"), def: {}, core: true, cleanups: [] };
  mounted.set(slug, m);
  mountWidget(def, m);
  stage.classList.remove("empty-state");
}

// ---------- draggable reorder ----------
let dragSlug = null;
function enableDrag(el) {
  const head = el.querySelector(".widget-head");
  head.addEventListener("dragstart", (e) => {
    dragSlug = el.dataset.slug;
    el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  head.addEventListener("dragend", () => { el.classList.remove("dragging"); dragSlug = null; persistOrder(); });
  el.addEventListener("dragover", (e) => {
    if (!dragSlug || dragSlug === el.dataset.slug) return;
    e.preventDefault();
    const dragged = grid.querySelector(`.widget[data-slug="${CSS.escape(dragSlug)}"]`);
    if (!dragged) return;
    const rect = el.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    grid.insertBefore(dragged, after ? el.nextSibling : el);
  });
}

// ---------- env panel ----------

function openEnvPanel(w) {
  envtitle.textContent = `${w.title || w.slug} needs a few keys`;
  envform.innerHTML = "";
  for (const key of w.missingEnv) {
    const field = document.createElement("div");
    field.className = "env-field";
    const label = document.createElement("label");
    label.textContent = key;
    const input = document.createElement("input");
    input.className = "g-input";
    input.name = key;
    input.placeholder = "paste value…";
    input.autocomplete = "off";
    field.append(label, input);
    envform.appendChild(field);
  }
  envpanel.hidden = false;
  requestAnimationFrame(() => envpanel.classList.add("on"));
  envform.querySelector("input")?.focus();
}

function closeEnvPanel() {
  envpanel.classList.remove("on");
  setTimeout(() => (envpanel.hidden = true), 500);
}

document.getElementById("envsave").onclick = async () => {
  const updates = {};
  for (const input of envform.querySelectorAll("input")) {
    if (input.value.trim()) updates[input.name] = input.value.trim();
  }
  if (Object.keys(updates).length) {
    await fetch("/api/env", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }
  closeEnvPanel();
  loadState();
};
document.getElementById("envskip").onclick = closeEnvPanel;

// ---------- attachments (any file, not just images) ----------

const MAX_DIM = 1568;        // downscale longest edge — plenty for vision models
const MAX_ATTACHED = 8;

// Read an image File, downscale if large, return a data URL.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("not an image"));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        if (scale === 1 && reader.result.length < 1.5e6) return resolve(reader.result);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve(canvas.toDataURL(type, 0.9));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Read any file to a data URL (used for non-images).
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read file"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function addFiles(files) {
  for (const file of files) {
    if (attached.length >= MAX_ATTACHED) break;
    const isImage = (file.type || "").startsWith("image/");
    try {
      const dataUrl = isImage ? await loadImage(file) : await readAsDataUrl(file);
      attached.push({ name: file.name || (isImage ? "pasted-image" : "file"), type: file.type, dataUrl, isImage });
    } catch {}
  }
  renderThumbs();
}

// Turn pasted text/URLs into an attachment so "paste anything" works.
function addPastedText(text) {
  if (!text || attached.length >= MAX_ATTACHED) return;
  const isUrl = /^https?:\/\/\S+$/.test(text.trim());
  const name = isUrl ? text.trim() : "pasted-text.txt";
  const mime = isUrl ? "text/uri-list" : "text/plain";
  const dataUrl = `data:${mime};base64,` + btoa(unescape(encodeURIComponent(text)));
  attached.push({ name, type: mime, dataUrl, isImage: false });
  renderThumbs();
}

const fileGlyph = (a) =>
  /text\/uri-list|uri/.test(a.type) ? "🔗" :
  /json/.test(a.type) ? "{ }" :
  /csv|sheet|excel/.test(a.type) ? "▦" :
  /pdf/.test(a.type) ? "PDF" :
  /audio/.test(a.type) ? "♪" :
  /video/.test(a.type) ? "▶" :
  /zip|tar|compress/.test(a.type) ? "🗜" : "📄";

function renderThumbs() {
  thumbs.innerHTML = "";
  thumbs.hidden = attached.length === 0;
  attached.forEach((a, i) => {
    const t = document.createElement("div");
    t.className = "thumb";
    if (a.isImage) {
      const img = document.createElement("img");
      img.src = a.dataUrl;
      img.alt = a.name;
      t.appendChild(img);
    } else {
      const chip = document.createElement("div");
      chip.className = "thumb-file";
      chip.innerHTML = `<span class="tf-glyph">${fileGlyph(a)}</span><span class="tf-name"></span>`;
      chip.querySelector(".tf-name").textContent = (a.name || "file").slice(0, 18);
      chip.title = a.name;
      t.appendChild(chip);
    }
    const x = document.createElement("button");
    x.type = "button";
    x.className = "thumb-x";
    x.textContent = "✕";
    x.title = "Remove";
    x.onclick = () => { attached.splice(i, 1); renderThumbs(); };
    t.appendChild(x);
    thumbs.appendChild(t);
  });
}

attachBtn.onclick = () => imgInput.click();
imgInput.onchange = () => { addFiles(imgInput.files); imgInput.value = ""; };

document.addEventListener("paste", (e) => {
  if (document.activeElement === palinput) return;
  const files = [...(e.clipboardData?.items || [])]
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (files.length) { e.preventDefault(); addFiles(files); return; }
  // pasted plain text while not typing in the prompt → treat as an attachment
  if (document.activeElement !== promptEl) {
    const text = e.clipboardData?.getData("text/plain");
    if (text && text.trim()) { e.preventDefault(); addPastedText(text); }
  }
});

stage.addEventListener("dragover", (e) => { e.preventDefault(); if (!dragSlug) stage.classList.add("dropping"); });
stage.addEventListener("dragleave", (e) => { if (e.target === stage) stage.classList.remove("dropping"); });
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("dropping");
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

// ---------- generation ----------

const VERBS = ["conjuring", "weaving", "growing", "shaping", "summoning"];
const TOOL_GLYPH = { Write: "✎", Edit: "✎", Read: "◉", Bash: "❯", Grep: "⌕", Glob: "⌕", exec: "❯" };

function feedRow(kind, glyph, text) {
  const row = document.createElement("div");
  row.className = `feed-row feed-${kind}`;
  row.innerHTML = `<span class="feed-glyph"></span><span class="feed-text"></span>`;
  row.querySelector(".feed-glyph").textContent = glyph;
  row.querySelector(".feed-text").textContent = text;
  genfeed.appendChild(row);
  while (genfeed.children.length > 40) genfeed.firstChild.remove();
  genfeed.scrollTop = genfeed.scrollHeight;
}

async function generate(prompt, images) {
  generating = true;
  lastPrompt = prompt;
  promptEl.value = "";
  promptEl.blur();

  genfeed.innerHTML = "";
  genstatus.textContent = `${VERBS[Math.floor(Math.random() * VERBS.length)]}…`;
  genwrap.hidden = false;
  requestAnimationFrame(() => genwrap.classList.add("on"));

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, attachments: images }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", finalText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === "tool") {
            const g = TOOL_GLYPH[ev.name] || "•";
            const label = ev.file ? ev.file.replace(/^.*\/(web\/widgets|backends)\//, "$1/") : (ev.detail || ev.name);
            feedRow("tool", g, `${ev.name.toLowerCase()} ${label}`.trim());
            genstatus.textContent = `${ev.name.toLowerCase()} · ${ev.detail || ""}`;
          } else if (ev.type === "thought") {
            feedRow("thought", "✦", ev.text);
            genstatus.textContent = ev.text;
          } else if (ev.type === "switch") {
            feedRow("switch", "⤳", `${ev.from} hit its limit — switching to ${ev.to}`);
            genstatus.textContent = `⤳ switching to ${ev.to}…`;
          } else if (ev.type === "start") {
            feedRow("start", "✧", `${ev.harness} is on it`);
          } else if (ev.type === "result") {
            finalText = ev.text;
          } else if (ev.type === "error") {
            feedRow("error", "✕", ev.message);
            genstatus.textContent = `✕ ${ev.message}`;
          }
        } catch {}
      }
    }
    if (finalText) { feedRow("result", "✓", finalText); genstatus.textContent = finalText; }
  } catch (err) {
    genstatus.textContent = `✕ ${err.message}`;
  }

  await loadState();
  setTimeout(() => {
    genwrap.classList.remove("on");
    setTimeout(() => (genwrap.hidden = true), 800);
    generating = false;
  }, 1400);
}

cmd.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if ((!prompt && attached.length === 0) || generating) return;
  const images = attached.map((a) => ({ name: a.name, data: a.dataUrl }));
  attached.length = 0;
  renderThumbs();
  generate(prompt || "(see attached file)", images);
});

// ---------- command palette ----------

let palItems = [];
let palIndex = 0;

function baseCommands() {
  const cmds = [
    { label: "Undo last build", hint: "revert the most recent generation", run: doUndo },
    { label: "History…", hint: "restore any earlier snapshot", run: openHistory },
    { label: "Save room…", hint: "freeze this canvas under a name", run: doSaveRoom },
    { label: "Open room…", hint: "summon a saved canvas", run: openRooms },
    { label: "Clear canvas", hint: "remove every widget (undoable)", run: clearCanvas },
    { label: "Re-run last prompt", hint: lastPrompt ? `“${lastPrompt.slice(0, 40)}”` : "nothing yet", run: () => lastPrompt && generate(lastPrompt, []) },
    { label: "Share / show QR", hint: "open this Glade on your phone", run: showShare },
  ];
  for (const c of CORE_WIDGETS) {
    cmds.push({ label: `Open ${c.title}`, hint: "built-in capability", run: () => summonCore(c.slug) });
  }
  for (const h of state.harnessChain || []) {
    cmds.push({ label: `Switch harness → ${h}`, hint: h === state.harness ? "active" : "", run: () => switchHarness(h) });
  }
  return cmds;
}

function openPalette(items) {
  palItems = items || baseCommands();
  palIndex = 0;
  palinput.value = "";
  renderPalette("");
  palette.hidden = false;
  requestAnimationFrame(() => palette.classList.add("on"));
  palinput.focus();
}
function closePalette() {
  palette.classList.remove("on");
  setTimeout(() => (palette.hidden = true), 250);
}
function renderPalette(q) {
  const ql = q.toLowerCase();
  const matches = palItems.filter((it) => it.label.toLowerCase().includes(ql));
  palIndex = Math.min(palIndex, Math.max(0, matches.length - 1));
  pallist.innerHTML = "";
  matches.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "pal-row" + (i === palIndex ? " active" : "");
    row.innerHTML = `<span class="pal-label"></span><span class="pal-hint"></span>`;
    row.querySelector(".pal-label").textContent = it.label;
    row.querySelector(".pal-hint").textContent = it.hint || "";
    row.onclick = () => { closePalette(); it.run(); };
    pallist.appendChild(row);
  });
  pallist._matches = matches;
}
palinput.addEventListener("input", () => renderPalette(palinput.value));
palinput.addEventListener("keydown", (e) => {
  const matches = pallist._matches || [];
  if (e.key === "ArrowDown") { e.preventDefault(); palIndex = Math.min(palIndex + 1, matches.length - 1); renderPalette(palinput.value); }
  else if (e.key === "ArrowUp") { e.preventDefault(); palIndex = Math.max(palIndex - 1, 0); renderPalette(palinput.value); }
  else if (e.key === "Enter") { e.preventDefault(); const it = matches[palIndex]; if (it) { closePalette(); it.run(); } }
  else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
});
palette.addEventListener("click", (e) => { if (e.target === palette) closePalette(); });
palettebtn.onclick = () => openPalette();
harnessPill.onclick = () => openPalette((state.harnessChain || []).map((h) => ({
  label: `Switch harness → ${h}`, hint: h === state.harness ? "active" : "", run: () => switchHarness(h),
})));

// ---------- palette actions ----------

async function doUndo() {
  const r = await (await fetch("/api/undo", { method: "POST" })).json();
  flash(r.ok ? "↩ undone" : (r.error || "nothing to undo"));
  loadState();
}
async function switchHarness(h) {
  await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ harness: h }) });
  flash(`harness → ${h}`);
  loadState();
}
async function clearCanvas() {
  for (const w of state.widgets) await fetch(`/api/widget/${w.slug}`, { method: "DELETE" });
  flash("canvas cleared (undoable)");
  loadState();
}
async function doSaveRoom() {
  const name = prompt2("Name this room:");
  if (!name) return;
  const r = await (await fetch("/api/rooms/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })).json();
  flash(r.ok ? `saved room “${r.name}”` : (r.error || "save failed"));
}
async function openRooms() {
  const { rooms } = await (await fetch("/api/rooms")).json();
  if (!rooms.length) return flash("no saved rooms yet");
  openPalette(rooms.map((r) => ({
    label: r.name, hint: `${r.widgetCount || 0} widgets`,
    run: async () => { await fetch("/api/rooms/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: r.name }) }); flash(`opened “${r.name}”`); loadState(); },
  })));
}
async function openHistory() {
  const { history } = await (await fetch("/api/history")).json();
  if (!history.length) return flash("no history yet");
  openPalette(history.map((h) => ({
    label: h.label || new Date(h.ts).toLocaleString(),
    hint: `${new Date(h.ts).toLocaleTimeString()} · ${h.widgetCount ?? "?"} widgets`,
    run: async () => { await fetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: h.id }) }); flash("restored"); loadState(); },
  })));
}
async function showShare() {
  const net = await (await fetch("/api/netinfo")).json();
  const url = (net.urls && net.urls[0]) || `http://localhost:${net.port}`;
  let qrData = "";
  try { const QR = await import("qrcode"); qrData = await QR.toDataURL(url, { margin: 1, width: 220 }); } catch {}
  showModal(`
    <h2>Open Glade anywhere</h2>
    ${qrData ? `<img class="qr" src="${qrData}" alt="QR" />` : ""}
    <div class="share-urls">${(net.urls || []).map((u) => `<code>${u}</code>`).join("")}</div>
  `);
}

// ---------- small UI helpers ----------

function flash(text) {
  let el = document.getElementById("flash");
  if (!el) { el = document.createElement("div"); el.id = "flash"; el.className = "glass"; stage.appendChild(el); }
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("on"), 1800);
}

function prompt2(label) {
  return window.prompt(label) || "";
}

function showModal(html) {
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `<div class="modal glass">${html}<button class="g-btn modal-close">Close</button></div>`;
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.classList.contains("modal-close")) wrap.remove(); });
  stage.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("on"));
}

// ---------- voice ----------

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  let rec = null, listening = false;
  const start = () => {
    if (listening) return;
    rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    let base = promptEl.value;
    rec.onresult = (e) => {
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      promptEl.value = (base + " " + txt).trim();
    };
    rec.onend = () => { listening = false; micBtn.classList.remove("on"); };
    rec.start(); listening = true; micBtn.classList.add("on");
  };
  const stop = () => { if (rec && listening) rec.stop(); };
  micBtn.addEventListener("mousedown", start);
  micBtn.addEventListener("mouseup", stop);
  micBtn.addEventListener("mouseleave", stop);
  micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); start(); });
  micBtn.addEventListener("touchend", (e) => { e.preventDefault(); stop(); });
} else {
  micBtn.style.display = "none";
}

// ---------- global keys ----------

document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (e.key === "/" && !typing && palette.hidden) {
    e.preventDefault();
    openPalette();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    palette.hidden ? openPalette() : closePalette();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
    e.preventDefault();
    doUndo();
  }
});

loadState();
