/* Glade frontend — command bar, palette, generation feed, widget loader,
 * env panel, the glade widget API (bus / fetch / store / subscribe), core
 * capability widgets, draggable layout, voice, and rooms. */

const stage = document.getElementById("stage");
const grid = document.getElementById("grid");
const cmd = document.getElementById("cmd");
const promptEl = document.getElementById("prompt");
const genwrap = document.getElementById("genwrap");
const genclose = document.getElementById("genclose");
const genrestore = document.getElementById("genrestore");
const genstatus = document.getElementById("genstatus");
const genfeed = document.getElementById("genfeed");
const flameLoader = document.querySelector(".flame-loader");
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
const librarybtn = document.getElementById("librarybtn");
const freeformModeBtn = document.getElementById("freeformmode");
const snapModeBtn = document.getElementById("snapmode");
const snapPresetWrap = document.getElementById("snappresetwrap");
const snapPresetBtn = document.getElementById("snappresetbtn");
const snapPresetMenu = document.getElementById("snappresetmenu");

const mounted = new Map(); // slug -> { def, el, body, core, cleanups[] }
let generating = false;
let lastPrompt = "";
let state = { widgets: [], harness: "claude", harnessChain: [] };
const attached = []; // { name, type, dataUrl, isImage } queued for the next prompt
let fireClicks = 0;
let fireClickTimer = null;
let eggTimer = null;

// ---------- icons ----------
// Small local SVG set, using the Lucide visual language without a runtime CDN.
const ICONS = {
  plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><path d="M12 19v3"></path>',
  "mic-off": '<path d="M16 9.5V5a4 4 0 0 0-6.1-3.4"></path><path d="M9 9v3a3 3 0 0 0 5.1 2.1"></path><path d="M4 10v2a8 8 0 0 0 12.4 6.7"></path><path d="M12 20v2"></path><path d="m2 2 20 20"></path>',
  send: '<path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path>',
  command: '<path d="M18 5a3 3 0 1 0-3 3h3V5Z"></path><path d="M6 5a3 3 0 1 1 3 3H6V5Z"></path><path d="M18 19a3 3 0 1 1-3-3h3v3Z"></path><path d="M6 19a3 3 0 1 0 3-3H6v3Z"></path><path d="M9 8h6v8H9z"></path>',
  x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M16 3v3a2 2 0 0 0 2 2h3"></path><path d="M8 21v-3a2 2 0 0 0-2-2H3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>',
  grip: '<circle cx="9" cy="6" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="18" r="1"></circle><circle cx="15" cy="6" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="18" r="1"></circle>',
  panels: '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M9 21V9"></path>',
  layout: '<rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect>',
  pencil: '<path d="M12 20h9"></path><path d="m16.5 3.5 4 4L7 21l-4 1 1-4Z"></path>',
  trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path>',
};

const BRAND_ICONS = {
  claude: '<svg class="brand-icon claude-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="currentColor"></path></svg>',
  codex: '<svg class="brand-icon codex-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z" fill="currentColor" opacity=".16"></path><path d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z" fill="currentColor"></path></svg>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

function setIconButton(btn, name, label) {
  btn.innerHTML = icon(name);
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

function brandIcon(name) {
  const key = String(name || "").toLowerCase();
  if (key.includes("claude")) return BRAND_ICONS.claude;
  if (key.includes("codex")) return BRAND_ICONS.codex;
  return icon("panels");
}

function renderHarnessButton() {
  const h = state.harness || "claude";
  harnessPill.innerHTML = `${brandIcon(h)}<span>${h}</span>`;
  harnessPill.setAttribute("aria-label", `Switch harness. Current harness: ${h}`);
}

setIconButton(attachBtn, "plus", "Attach file");
setIconButton(micBtn, "mic", "Start voice input");
setIconButton(document.getElementById("go"), "send", "Send prompt");
setIconButton(genclose, "x", "Hide build progress");
palettebtn.innerHTML = `<span class="slash-mark" aria-hidden="true">/</span><span class="palette-label">Commands</span>`;
librarybtn.innerHTML = `${icon("layout")}<span class="lib-btn-label">Widgets</span>`;
librarybtn.onclick = () => openLibrary();
freeformModeBtn.innerHTML = `${icon("panels")}<span>Free</span>`;
snapModeBtn.innerHTML = `${icon("layout")}<span>Snap</span>`;

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

// ---------- floating-window geometry ----------
// Each widget is an absolutely-positioned window; we persist {x,y,w,h,z} per
// slug in localStorage and auto-place new windows where they don't overlap.
const GEOM_KEY = "glade-geom";
const LAYOUT_KEY = "glade-layout-mode";
const SNAP_GEOM_KEY = "glade-snap-geom";
const SNAP_PRESET_KEY = "glade-snap-preset";
const BOTTOM_RESERVE = 96;   // keep auto-placement clear of the command dock
const DEFAULT_SIZE = { small: [340, 240], medium: [400, 320], large: [560, 420], full: [880, 560] };
const SNAP_PRESETS = [3, 6, 9];
const SNAP_MIN_W = 220;
const SNAP_MIN_H = 160;
const SNAP_DEFAULT_H = 220;
const SNAP_MAX_H = 1800;
const SNAP_HANDLE_MAX_GAP = 34;
const SNAP_HANDLE_MIN_OVERLAP = 48;
const SNAP_EDGE_HIT = 12;
let zTop = 10;
let layoutMode = localStorage.getItem(LAYOUT_KEY) || "free";
let snapPreset = SNAP_PRESETS.includes(Number(localStorage.getItem(SNAP_PRESET_KEY)))
  ? Number(localStorage.getItem(SNAP_PRESET_KEY))
  : 3;
const snapSpacer = document.createElement("div");
snapSpacer.className = "snap-spacer";
grid.appendChild(snapSpacer);
const snapResizerLayer = document.createElement("div");
snapResizerLayer.className = "snap-resizer-layer";
grid.appendChild(snapResizerLayer);

const allGeom = () => { try { return JSON.parse(localStorage.getItem(GEOM_KEY) || "{}"); } catch { return {}; } };
const allSnapGeom = () => { try { return JSON.parse(localStorage.getItem(SNAP_GEOM_KEY) || "{}"); } catch { return {}; } };
const widgetEls = () => [...grid.querySelectorAll(".widget")];
const hasWidgets = () => widgetEls().length > 0;
function saveGeom(slug, patch) {
  if (layoutMode === "snap") return;
  const all = allGeom();
  all[slug] = { ...all[slug], ...patch };
  localStorage.setItem(GEOM_KEY, JSON.stringify(all));
}
function applyGeom(el, g) {
  if (Number.isFinite(g.x)) el.style.left = `${g.x}px`;
  if (Number.isFinite(g.y)) el.style.top = `${g.y}px`;
  if (Number.isFinite(g.w)) el.style.width = `${g.w}px`;
  if (Number.isFinite(g.h)) el.style.height = `${g.h}px`;
  if (Number.isFinite(g.z)) { el.style.zIndex = g.z; zTop = Math.max(zTop, g.z); }
}
const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// First non-overlapping slot, scanning top-left → right; cascade as fallback.
function findSpot(w, h, rect) {
  const pad = 24, step = 36;
  const maxY = rect.height - BOTTOM_RESERVE;
  const others = [...grid.querySelectorAll(".widget")]
    .filter((e) => e.style.left)
    .map((e) => ({ x: parseFloat(e.style.left) || 0, y: parseFloat(e.style.top) || 0, w: e.offsetWidth, h: e.offsetHeight }));
  for (let y = pad; y + h <= maxY; y += step)
    for (let x = pad; x + w <= rect.width - pad; x += step)
      if (!others.some((o) => overlaps({ x, y, w, h }, o))) return { x, y };
  const n = others.length;
  return {
    x: pad + ((n * 30) % Math.max(1, rect.width - w - pad)),
    y: pad + ((n * 24) % Math.max(1, maxY - h - pad)),
  };
}

// Position a freshly-created window: restore saved geometry or auto-place it.
function placeWindow(el, size) {
  const rect = grid.getBoundingClientRect();
  const saved = allGeom()[el.dataset.slug];
  if (saved && Number.isFinite(saved.x)) {
    // clamp a restored window back inside the current viewport
    const w = Math.min(saved.w || DEFAULT_SIZE.medium[0], rect.width - 16);
    const h = Math.min(saved.h || DEFAULT_SIZE.medium[1], rect.height - 16);
    const x = Math.max(0, Math.min(saved.x, rect.width - w));
    const y = Math.max(0, Math.min(saved.y, rect.height - h));
    applyGeom(el, { x, y, w, h, z: saved.z || ++zTop });
    return;
  }
  const [dw, dh] = DEFAULT_SIZE[size] || DEFAULT_SIZE.medium;
  const w = Math.min(dw, rect.width - 48);
  const h = Math.min(dh, rect.height - 48);
  const { x, y } = findSpot(w, h, rect);
  const g = { x, y, w, h, z: ++zTop };
  applyGeom(el, g);
  saveGeom(el.dataset.slug, g);
}

// Keep every window inside the canvas after the viewport resizes.
function clampWindows() {
  if (layoutMode === "snap") { snapWindows(); return; }
  const rect = grid.getBoundingClientRect();
  for (const m of mounted.values()) {
    const el = m.el;
    const w = Math.min(el.offsetWidth, Math.max(260, rect.width - 16));
    const h = Math.min(el.offsetHeight, Math.max(180, rect.height - 16));
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    const x = Math.max(0, Math.min(parseFloat(el.style.left) || 0, rect.width - w));
    const y = Math.max(0, Math.min(parseFloat(el.style.top) || 0, rect.height - h));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
}
let _rsz;
window.addEventListener("resize", () => { clearTimeout(_rsz); _rsz = setTimeout(applyLayoutMode, 120); });

function clearSnapResizers() {
  snapResizerLayer.replaceChildren();
}

function snapMetrics(widgets = widgetEls()) {
  const rect = grid.getBoundingClientRect();
  const pad = rect.width < 640 ? 12 : 18;
  const gap = rect.width < 640 ? 10 : 14;
  const availableW = Math.max(280, rect.width - pad * 2);
  const availableH = Math.max(260, rect.height - BOTTOM_RESERVE - pad * 2);
  return { widgets, rect, pad, gap, availableW, availableH };
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function defaultSnapGeoms(metrics) {
  const count = Math.max(1, metrics.widgets.length);
  const maxFitCols = Math.max(1, Math.floor((metrics.availableW + metrics.gap) / (SNAP_MIN_W + metrics.gap)));
  const cols = Math.max(1, Math.min(snapPreset, maxFitCols, count));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = Math.floor((metrics.availableW - metrics.gap * (cols - 1)) / cols);
  const cellH = Math.max(SNAP_DEFAULT_H, Math.floor((metrics.availableH - metrics.gap * (rows - 1)) / rows));
  const geoms = {};

  metrics.widgets.forEach((el, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    geoms[el.dataset.slug] = {
      x: metrics.pad + col * (cellW + metrics.gap),
      y: metrics.pad + row * (cellH + metrics.gap),
      w: cellW,
      h: cellH,
    };
  });
  return geoms;
}

function sanitizeSnapGeom(g, metrics) {
  const w = clampValue(Number(g?.w) || SNAP_MIN_W, SNAP_MIN_W, metrics.availableW);
  const h = clampValue(Number(g?.h) || SNAP_DEFAULT_H, SNAP_MIN_H, SNAP_MAX_H);
  const maxX = metrics.pad + Math.max(0, metrics.availableW - w);
  return {
    x: clampValue(Number(g?.x) || metrics.pad, metrics.pad, maxX),
    y: Math.max(metrics.pad, Number(g?.y) || metrics.pad),
    w,
    h,
  };
}

function snapGeoms(metrics, reset = false) {
  const saved = reset ? {} : allSnapGeom();
  const defaults = defaultSnapGeoms(metrics);
  const geoms = {};
  for (const el of metrics.widgets) {
    const slug = el.dataset.slug;
    geoms[slug] = sanitizeSnapGeom(saved[slug] || defaults[slug], metrics);
  }
  return geoms;
}

function renderedSnapGeoms(metrics) {
  const geoms = {};
  for (const el of metrics.widgets) {
    geoms[el.dataset.slug] = sanitizeSnapGeom({
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      w: el.offsetWidth,
      h: el.offsetHeight,
    }, metrics);
  }
  return geoms;
}

function saveSnapGeoms(geoms) {
  localStorage.setItem(SNAP_GEOM_KEY, JSON.stringify(geoms));
}

function updateSnapCanvas(metrics, geoms) {
  const bottoms = Object.values(geoms).map((g) => g.y + g.h);
  const contentH = Math.max(metrics.rect.height + 1, Math.ceil(Math.max(metrics.pad, ...bottoms) + metrics.pad + BOTTOM_RESERVE));
  snapSpacer.style.top = `${contentH}px`;
  snapResizerLayer.style.width = `${Math.ceil(metrics.rect.width)}px`;
  snapResizerLayer.style.height = `${contentH}px`;
}

function applySnapGeoms(metrics, geoms, persist = false) {
  for (const el of metrics.widgets) {
    const slug = el.dataset.slug;
    const g = sanitizeSnapGeom(geoms[slug], metrics);
    geoms[slug] = g;
    delete el.dataset.max;
    el.classList.remove("maximized");
    updateWindowButtons(el);
    applyGeom(el, {
      x: Math.round(g.x),
      y: Math.round(g.y),
      w: Math.round(g.w),
      h: Math.round(g.h),
    });
  }
  updateSnapCanvas(metrics, geoms);
  if (persist) saveSnapGeoms(geoms);
}

function snapRects(metrics, geoms) {
  return metrics.widgets.map((el) => ({ slug: el.dataset.slug, ...geoms[el.dataset.slug] })).filter((r) => r.slug);
}

function rangeOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
}

function makeSnapHandle(className, spec, style) {
  const handle = document.createElement("div");
  handle.className = `snap-resizer ${className}`;
  Object.assign(handle.style, style);
  handle.dataset.type = spec.type;
  if (spec.slug) handle.dataset.slug = spec.slug;
  handle.title = spec.type === "bottom" ? "Resize widget" : "Resize widgets";
  enableSnapResizer(handle, spec);
  snapResizerLayer.appendChild(handle);
}

function renderSnapResizers(metrics, geoms) {
  clearSnapResizers();
  const rects = snapRects(metrics, geoms);
  const maxGap = Math.max(metrics.gap + 8, SNAP_HANDLE_MAX_GAP);

  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i], b = rects[j];
      const left = a.x <= b.x ? a : b;
      const right = left === a ? b : a;
      const gapX = right.x - (left.x + left.w);
      const overlapY = rangeOverlap(left.y, left.y + left.h, right.y, right.y + right.h);
      if (gapX >= 4 && gapX <= maxGap && overlapY >= SNAP_HANDLE_MIN_OVERLAP) {
        makeSnapHandle("snap-resizer-vertical", { type: "vertical", left: left.slug, right: right.slug }, {
          left: `${Math.round(left.x + left.w)}px`,
          top: `${Math.round(Math.max(left.y, right.y))}px`,
          width: `${Math.round(gapX)}px`,
          height: `${Math.round(overlapY)}px`,
        });
      }

      const top = a.y <= b.y ? a : b;
      const bottom = top === a ? b : a;
      const gapY = bottom.y - (top.y + top.h);
      const overlapX = rangeOverlap(top.x, top.x + top.w, bottom.x, bottom.x + bottom.w);
      if (gapY >= 4 && gapY <= maxGap && overlapX >= SNAP_HANDLE_MIN_OVERLAP) {
        makeSnapHandle("snap-resizer-horizontal", { type: "horizontal", top: top.slug, bottom: bottom.slug }, {
          left: `${Math.round(Math.max(top.x, bottom.x))}px`,
          top: `${Math.round(top.y + top.h)}px`,
          width: `${Math.round(overlapX)}px`,
          height: `${Math.round(gapY)}px`,
        });
      }
    }
  }

  for (const r of rects) {
    const hasBelow = rects.some((other) =>
      other.slug !== r.slug &&
      other.y >= r.y + r.h - 1 &&
      rangeOverlap(r.x, r.x + r.w, other.x, other.x + other.w) >= SNAP_HANDLE_MIN_OVERLAP
    );
    if (!hasBelow) {
      makeSnapHandle("snap-resizer-horizontal snap-resizer-bottom", { type: "bottom", slug: r.slug }, {
        left: `${Math.round(r.x)}px`,
        top: `${Math.round(r.y + r.h - SNAP_EDGE_HIT / 2)}px`,
        width: `${Math.round(r.w)}px`,
        height: `${SNAP_EDGE_HIT}px`,
      });
    }
  }
}

function startSnapPairResize(handle, e, spec) {
  e.preventDefault();
  e.stopPropagation();

  const metrics = snapMetrics();
  const base = renderedSnapGeoms(metrics);
  const next = { ...base };
  const axisClass = spec.type === "vertical" ? "snap-resizing-cols" : "snap-resizing-rows";
  dragSlug = "snap-resize";
  grid.classList.add("snap-resizing", axisClass);
  handle.classList.add("dragging");

  pointerDrag(handle, e,
    (dx, dy) => {
      if (spec.type === "vertical") {
        const left = base[spec.left], right = base[spec.right];
        if (!left || !right) return;
        const delta = clampValue(dx, SNAP_MIN_W - left.w, right.w - SNAP_MIN_W);
        next[spec.left] = { ...left, w: left.w + delta };
        next[spec.right] = { ...right, x: right.x + delta, w: right.w - delta };
      } else {
        const top = base[spec.top], bottom = base[spec.bottom];
        if (!top || !bottom) return;
        const delta = clampValue(dy, SNAP_MIN_H - top.h, bottom.h - SNAP_MIN_H);
        next[spec.top] = { ...top, h: top.h + delta };
        next[spec.bottom] = { ...bottom, y: bottom.y + delta, h: bottom.h - delta };
      }
      applySnapGeoms(metrics, next);
    },
    () => {
      handle.classList.remove("dragging");
      grid.classList.remove("snap-resizing", axisClass);
      dragSlug = null;
      saveSnapGeoms(next);
      snapWindows();
    });
}

function startSnapBottomResize(handle, e, slug) {
  e.preventDefault();
  e.stopPropagation();

  const metrics = snapMetrics();
  const base = renderedSnapGeoms(metrics);
  const start = base[slug];
  if (!start) return;

  const next = { ...base };
  let lastClientY = e.clientY;
  let active = true;
  let raf = 0;

  dragSlug = "snap-resize";
  grid.classList.add("snap-resizing", "snap-resizing-rows");
  handle.classList.add("dragging");
  handle.setPointerCapture(e.pointerId);

  const apply = () => {
    const rect = grid.getBoundingClientRect();
    const contentY = lastClientY - rect.top + grid.scrollTop;
    const h = clampValue(contentY - start.y, SNAP_MIN_H, SNAP_MAX_H);
    next[slug] = { ...start, h };
    applySnapGeoms(metrics, next);
  };

  const tick = () => {
    if (!active) return;
    const rect = grid.getBoundingClientRect();
    const edge = 42;
    if (lastClientY > rect.bottom - edge && next[slug].h < SNAP_MAX_H) {
      const speed = clampValue((lastClientY - (rect.bottom - edge)) / 2, 4, 24);
      grid.scrollTop += speed;
      apply();
    } else if (lastClientY < rect.top + edge && grid.scrollTop > 0) {
      const speed = clampValue(((rect.top + edge) - lastClientY) / 2, 4, 18);
      grid.scrollTop -= speed;
      apply();
    }
    raf = requestAnimationFrame(tick);
  };

  const move = (ev) => {
    lastClientY = ev.clientY;
    apply();
  };

  const up = () => {
    active = false;
    cancelAnimationFrame(raf);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    try { handle.releasePointerCapture(e.pointerId); } catch {}
    handle.classList.remove("dragging");
    grid.classList.remove("snap-resizing", "snap-resizing-rows");
    dragSlug = null;
    saveSnapGeoms(next);
    snapWindows();
  };

  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  apply();
  raf = requestAnimationFrame(tick);
}

function enableSnapResizer(handle, spec) {
  handle.addEventListener("pointerdown", (e) => {
    if (layoutMode !== "snap" || e.button !== 0) return;
    if (spec.type === "bottom") startSnapBottomResize(handle, e, spec.slug);
    else startSnapPairResize(handle, e, spec);
  });
}

function snapWindows(opts = {}) {
  const metrics = snapMetrics();
  const geoms = snapGeoms(metrics, Boolean(opts.reset));
  applySnapGeoms(metrics, geoms, true);
  renderSnapResizers(metrics, geoms);
}

function renderSnapPresetButton() {
  if (!snapPresetBtn || !snapPresetMenu) return;
  snapPresetBtn.textContent = `${snapPreset}x${snapPreset}`;
  snapPresetBtn.setAttribute("aria-label", `Snap grid preset: ${snapPreset} by ${snapPreset}`);
  for (const btn of snapPresetMenu.querySelectorAll("[data-preset]")) {
    btn.setAttribute("aria-checked", String(Number(btn.dataset.preset) === snapPreset));
  }
}

function closeSnapPresetMenu() {
  if (!snapPresetWrap || !snapPresetMenu || !snapPresetBtn) return;
  snapPresetWrap.classList.remove("open");
  snapPresetMenu.hidden = true;
  snapPresetBtn.setAttribute("aria-expanded", "false");
}

function openSnapPresetMenu() {
  if (!snapPresetWrap || !snapPresetMenu || !snapPresetBtn) return;
  snapPresetMenu.hidden = false;
  snapPresetWrap.classList.add("open");
  snapPresetBtn.setAttribute("aria-expanded", "true");
}

function setSnapPreset(n) {
  if (!SNAP_PRESETS.includes(n)) return;
  snapPreset = n;
  localStorage.setItem(SNAP_PRESET_KEY, String(n));
  renderSnapPresetButton();
  closeSnapPresetMenu();
  if (layoutMode !== "snap") setLayoutMode("snap");
  else {
    grid.scrollTop = 0;
    snapWindows({ reset: true });
  }
}

function restoreFreeWindows() {
  const savedAll = allGeom();
  for (const m of mounted.values()) {
    const el = m.el;
    const saved = savedAll[el.dataset.slug];
    el.classList.remove("maximized");
    delete el.dataset.max;
    if (saved && Number.isFinite(saved.x)) applyGeom(el, saved);
    else placeWindow(el, m.def?.size || "medium");
    updateWindowButtons(el);
  }
  clampWindows();
}

function applyLayoutMode() {
  const snap = layoutMode === "snap";
  stage.dataset.layout = layoutMode;
  grid.classList.toggle("snap-layout", snap);
  freeformModeBtn.setAttribute("aria-pressed", String(!snap));
  snapModeBtn.setAttribute("aria-pressed", String(snap));
  closeSnapPresetMenu();
  if (snap) snapWindows();
  else {
    clearSnapResizers();
    restoreFreeWindows();
  }
}

function setLayoutMode(mode) {
  layoutMode = mode === "snap" ? "snap" : "free";
  localStorage.setItem(LAYOUT_KEY, layoutMode);
  applyLayoutMode();
}

freeformModeBtn.onclick = () => setLayoutMode("free");
snapModeBtn.onclick = () => setLayoutMode("snap");
renderSnapPresetButton();

snapPresetBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (layoutMode !== "snap") setLayoutMode("snap");
  if (snapPresetMenu.hidden) openSnapPresetMenu();
  else closeSnapPresetMenu();
});

snapPresetMenu?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-preset]");
  if (!btn) return;
  setSnapPreset(Number(btn.dataset.preset));
});

document.addEventListener("pointerdown", (e) => {
  if (!snapPresetWrap?.contains(e.target)) closeSnapPresetMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSnapPresetMenu();
});

// ---------- state / widgets ----------

async function loadState() {
  state = await (await fetch("/api/state")).json();
  renderHarnessButton();

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
  applyLayoutMode();
  stage.classList.toggle("empty-state", !hasWidgets());
}

function unmountWidget(slug) {
  const m = mounted.get(slug);
  if (!m) return;
  try { m.def.unmount?.(m.body); } catch {}
  for (const fn of m.cleanups) { try { fn(); } catch {} }
  m.el.remove();
  mounted.delete(slug);
  updateImmersiveState();
}

function widgetShell(w, core) {
  const el = document.createElement("section");
  el.className = `widget glass size-${w.size || "medium"}`;
  el.dataset.slug = w.slug;
  if (core) el.dataset.core = "1";
  el.draggable = false;
  el.innerHTML = `
    <div class="widget-head" tabindex="0">
      <span class="drag-dot"${core
        ? ` title="Drag to move"`
        : ` role="button" tabindex="0" aria-haspopup="menu" aria-expanded="false" aria-label="Widget options" title="Drag to move · click for options"`}>${icon("grip")}</span>
      <span class="widget-title"></span>
      <div class="widget-actions">
        <button type="button" class="widget-fullscreen" title="Maximize widget" aria-label="Maximize widget">${icon("maximize")}</button>
        <button type="button" class="widget-close" title="Remove widget" aria-label="Remove widget">${icon("x")}</button>
      </div>
    </div>
    <div class="widget-body"></div>
    <div class="widget-resize" title="Resize"></div>`;
  el.querySelector(".widget-title").textContent = w.title || w.slug;
  el.querySelector(".widget-head").setAttribute("aria-label", `${w.title || w.slug} window. Drag to move, double click or press Enter to maximize.`);
  el.querySelector(".widget-fullscreen").onclick = () => toggleMaximize(el);
  el.querySelector(".widget-close").onclick = async () => {
    if (core) {
      const set = coreOpen(); set.delete(w.slug); setCoreOpen(set);
      unmountWidget(w.slug);
      applyLayoutMode();
      stage.classList.toggle("empty-state", !hasWidgets());
      return;
    }
    await fetch(`/api/widget/${w.slug}`, { method: "DELETE" });
    loadState();
  };
  grid.appendChild(el);
  placeWindow(el, w.size);
  enableWindow(el);
  if (!core) enableWidgetMenu(el, w);
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
    el.querySelector(".widget-head").insertBefore(badge, el.querySelector(".widget-actions"));
    openEnvPanel(w);
    return;
  }
  await mountWidget(w, m);
}

// ---------- widget state (persisted + capturable) ----------
// A widget's state lives in localStorage under a per-slug namespace, written
// only through glade.store. Centralising the namespace lets us round-trip a
// widget's whole state when it is saved to / summoned from the library.
const storeNs = (slug) => `glade:${slug}:`;

// Snapshot every key a widget has stored, as a plain { key: value } object.
function captureWidgetState(slug) {
  const ns = storeNs(slug);
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(ns)) continue;
    try { out[key.slice(ns.length)] = JSON.parse(localStorage.getItem(key)); } catch {}
  }
  return out;
}

// Seed a widget's namespace from a captured state object (call before it mounts).
function restoreWidgetState(slug, state) {
  if (!state || typeof state !== "object") return;
  const ns = storeNs(slug);
  for (const [key, value] of Object.entries(state)) {
    try { localStorage.setItem(ns + key, JSON.stringify(value)); } catch {}
  }
}

// Build the glade API object handed to every widget's mount().
function makeGladeApi(w, m) {
  const ns = storeNs(w.slug);
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
    // namespaced persistence (corrupt/legacy values degrade to the default)
    store: {
      get: (k, d = null) => {
        try { const v = localStorage.getItem(ns + k); return v == null ? d : JSON.parse(v); }
        catch { return d; }
      },
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
    if (m.def.title) {
      m.el.querySelector(".widget-title").textContent = m.def.title;
      m.el.querySelector(".widget-head").setAttribute("aria-label", `${m.def.title} window. Drag to move, double click or press Enter to maximize.`);
    }
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
  applyLayoutMode();
  stage.classList.remove("empty-state");
}

// ---------- floating-window controller (move / resize / focus / maximize) ----------
let dragSlug = null;   // retained so the stage file-drop overlay can ignore window drags
function bringToFront(el, floor = 0) {
  const currentTop = widgetEls().reduce((top, w) => Math.max(top, parseInt(w.style.zIndex, 10) || 0), 0);
  zTop = Math.max(zTop, currentTop, floor);
  el.style.zIndex = ++zTop;
  saveGeom(el.dataset.slug, { z: zTop });
}

function updateImmersiveState() {
  stage.classList.toggle("immersive", widgetEls().some((el) => el.dataset.max));
}

function updateWindowButtons(el) {
  const btn = el.querySelector(".widget-fullscreen");
  if (!btn) return;
  const on = Boolean(el.dataset.max);
  btn.innerHTML = icon(on ? "minimize" : "maximize");
  btn.title = on ? "Restore widget" : "Maximize widget";
  btn.setAttribute("aria-label", btn.title);
  el.classList.toggle("maximized", on);
  updateImmersiveState();
}

// Generic pointer drag: onMove(dx, dy) runs each frame; onDone persists.
function pointerDrag(target, e, onMove, onDone) {
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  target.setPointerCapture(e.pointerId);
  const move = (ev) => onMove(ev.clientX - sx, ev.clientY - sy);
  const up = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    try { target.releasePointerCapture(e.pointerId); } catch {}
    onDone?.();
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
}

function enableWindow(el) {
  const head = el.querySelector(".widget-head");
  const handle = el.querySelector(".widget-resize");

  // any press inside the window raises it
  el.addEventListener("pointerdown", () => bringToFront(el));

  // move by the header (but not via the close button)
  head.addEventListener("pointerdown", (e) => {
    if (layoutMode === "snap" || e.button !== 0 || e.target.closest(".widget-actions, .env-badge")) return;
    delete el.dataset.max;   // a manual move cancels the "maximized" memory
    updateWindowButtons(el);
    const rect = grid.getBoundingClientRect();
    const ox = parseFloat(el.style.left) || 0, oy = parseFloat(el.style.top) || 0;
    dragSlug = el.dataset.slug;
    el.classList.add("dragging");
    pointerDrag(head, e,
      (dx, dy) => {
        const x = Math.max(0, Math.min(ox + dx, rect.width - el.offsetWidth));
        const y = Math.max(0, Math.min(oy + dy, rect.height - el.offsetHeight));
        el.style.left = `${x}px`; el.style.top = `${y}px`;
      },
      () => {
        el.classList.remove("dragging");
        dragSlug = null;
        saveGeom(el.dataset.slug, { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 });
      });
  });

  // resize from the bottom-right grip
  handle.addEventListener("pointerdown", (e) => {
    if (layoutMode === "snap" || e.button !== 0) return;
    e.stopPropagation();
    bringToFront(el);
    delete el.dataset.max;
    updateWindowButtons(el);
    const rect = grid.getBoundingClientRect();
    const ow = el.offsetWidth, oh = el.offsetHeight;
    const ox = parseFloat(el.style.left) || 0, oy = parseFloat(el.style.top) || 0;
    dragSlug = el.dataset.slug;
    el.classList.add("dragging");
    pointerDrag(handle, e,
      (dx, dy) => {
        const w = Math.max(220, Math.min(ow + dx, rect.width - ox));
        const h = Math.max(120, Math.min(oh + dy, rect.height - oy));
        el.style.width = `${w}px`; el.style.height = `${h}px`;
      },
      () => {
        el.classList.remove("dragging");
        dragSlug = null;
        saveGeom(el.dataset.slug, { w: el.offsetWidth, h: el.offsetHeight });
      });
  });

  // double-click header → maximize / restore (but not via the dot or actions)
  head.addEventListener("dblclick", (e) => {
    if (e.target.closest(".widget-actions, .env-badge, .drag-dot")) return;
    toggleMaximize(el);
  });

  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleMaximize(el);
      return;
    }
    if (e.key === "Escape" && el.dataset.max) {
      e.preventDefault();
      toggleMaximize(el);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) || layoutMode === "snap") return;

    e.preventDefault();
    delete el.dataset.max;
    updateWindowButtons(el);
    const rect = grid.getBoundingClientRect();
    const step = e.altKey ? 1 : 16;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
    const x = parseFloat(el.style.left) || 0;
    const y = parseFloat(el.style.top) || 0;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    if (e.shiftKey) {
      const nextW = Math.max(220, Math.min(w + dx, rect.width - x));
      const nextH = Math.max(140, Math.min(h + dy, rect.height - y));
      applyGeom(el, { w: nextW, h: nextH });
      saveGeom(el.dataset.slug, { w: nextW, h: nextH });
    } else {
      const nextX = Math.max(0, Math.min(x + dx, rect.width - w));
      const nextY = Math.max(0, Math.min(y + dy, rect.height - h));
      applyGeom(el, { x: nextX, y: nextY });
      saveGeom(el.dataset.slug, { x: nextX, y: nextY });
    }
  });
}

// The 6-dot control (top-left of the chrome) doubles as a drag handle and a
// menu trigger: a press that moves past a small threshold drags the window (so
// dragging never fights the menu); a press that stays put opens the widget's
// context menu. Keyboard: focus it and press Enter/Space.
function enableWidgetMenu(el, w) {
  const btn = el.querySelector(".drag-dot");
  if (!btn) return;
  btn.classList.add("has-menu");
  btn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    toggleWidgetMenu(el, btn, w);
  });
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    bringToFront(el);
    const snap = layoutMode === "snap";
    const startX = e.clientX, startY = e.clientY;
    const rect = grid.getBoundingClientRect();
    const ox = parseFloat(el.style.left) || 0, oy = parseFloat(el.style.top) || 0;
    let dragging = false;
    try { btn.setPointerCapture(e.pointerId); } catch {}

    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!dragging) {
        if (snap || Math.hypot(dx, dy) <= 5) return; // below threshold → still a click
        dragging = true;
        delete el.dataset.max;
        updateWindowButtons(el);
        el.classList.add("dragging");
        dragSlug = el.dataset.slug;
        closeWidgetMenu();
      }
      const x = Math.max(0, Math.min(ox + dx, rect.width - el.offsetWidth));
      const y = Math.max(0, Math.min(oy + dy, rect.height - el.offsetHeight));
      el.style.left = `${x}px`; el.style.top = `${y}px`;
    };
    const end = (ev) => {
      btn.removeEventListener("pointermove", move);
      btn.removeEventListener("pointerup", end);
      btn.removeEventListener("pointercancel", end);
      try { btn.releasePointerCapture(e.pointerId); } catch {}
      if (dragging) {
        el.classList.remove("dragging");
        dragSlug = null;
        saveGeom(el.dataset.slug, { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 });
      } else if (ev.type !== "pointercancel") {
        toggleWidgetMenu(el, btn, w);
      }
    };
    btn.addEventListener("pointermove", move);
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", end);
  });
}

let openWidgetMenu = null;
function closeWidgetMenu() {
  if (!openWidgetMenu) return;
  const { pop, btn, onDoc, onKey, onDismiss } = openWidgetMenu;
  pop.remove();
  btn.setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", onDoc, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", onDismiss, true);
  grid.removeEventListener("scroll", onDismiss, true);
  openWidgetMenu = null;
}

// The menu's entries — just "Save widget" for now, but kept as a list so more
// per-widget actions can slot in later.
function widgetMenuItems(el, w) {
  return [
    { label: "Save widget", run: () => saveWidgetToLibrary(w.slug) },
  ];
}

function toggleWidgetMenu(el, btn, w) {
  if (openWidgetMenu && openWidgetMenu.btn === btn) { closeWidgetMenu(); return; }
  closeWidgetMenu();

  const pop = document.createElement("div");
  pop.className = "widget-menu-pop glass";
  pop.setAttribute("role", "menu");
  for (const item of widgetMenuItems(el, w)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wm-item";
    b.setAttribute("role", "menuitem");
    b.textContent = item.label;
    b.onclick = () => { closeWidgetMenu(); item.run(); };
    pop.appendChild(b);
  }
  document.body.appendChild(pop);

  // anchor under the button (left-aligned), flipping up / clamping in if needed
  const r = btn.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  requestAnimationFrame(() => pop.classList.add("on"));
  btn.setAttribute("aria-expanded", "true");

  const onDoc = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) closeWidgetMenu(); };
  const onKey = (e) => { if (e.key === "Escape") closeWidgetMenu(); };
  const onDismiss = () => closeWidgetMenu();
  document.addEventListener("pointerdown", onDoc, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onDismiss, true);
  grid.addEventListener("scroll", onDismiss, true);
  openWidgetMenu = { pop, btn, onDoc, onKey, onDismiss };
}

function toggleMaximize(el) {
  if (el.dataset.max) {
    const g = el.dataset.max === "snap" ? null : JSON.parse(el.dataset.max);
    delete el.dataset.max;
    if (layoutMode === "snap") snapWindows();
    else if (g) {
      applyGeom(el, g);
      saveGeom(el.dataset.slug, g);
    }
  } else {
    el.dataset.max = layoutMode === "snap" ? "snap" : JSON.stringify({
      x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0,
      w: el.offsetWidth, h: el.offsetHeight,
    });
    const rect = grid.getBoundingClientRect();
    if (layoutMode === "snap") grid.scrollTop = 0;
    const g = { x: 16, y: 16, w: rect.width - 32, h: Math.max(220, rect.height - 32) };
    applyGeom(el, g);
    saveGeom(el.dataset.slug, g);
  }
  updateWindowButtons(el);
  bringToFront(el, 40);
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
    input.placeholder = "paste value";
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
    x.innerHTML = icon("x");
    x.setAttribute("aria-label", `Remove ${a.name || "attachment"}`);
    x.title = "Remove attachment";
    x.onclick = () => { attached.splice(i, 1); renderThumbs(); };
    t.appendChild(x);
    thumbs.appendChild(t);
  });
}

attachBtn.onclick = () => imgInput.click();
imgInput.onchange = () => { addFiles(imgInput.files); imgInput.value = ""; };

document.addEventListener("paste", (e) => {
  const active = document.activeElement;
  // Any focused text field other than the prompt (palette, env panel, widget
  // inputs) owns its own paste — don't divert it into the canvas/prompt.
  const foreignField =
    active &&
    active !== promptEl &&
    (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
  if (foreignField) return;
  const files = [...(e.clipboardData?.items || [])]
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (files.length) { e.preventDefault(); addFiles(files); return; }
  // pasted plain text while not typing in the prompt → treat as an attachment
  if (active !== promptEl) {
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

const VERBS = ["igniting", "kindling", "stoking", "forging", "shaping"];
const TOOL_GLYPH = { Write: "W", Edit: "E", Read: "R", Bash: "$", Grep: "G", Glob: "G", exec: "$" };

function minimizeBuild() {
  if (genwrap.hidden || !genwrap.classList.contains("on")) return;
  genwrap.classList.add("minimized");
}

function restoreBuild() {
  if (genwrap.hidden) return;
  genwrap.classList.remove("minimized");
}

genclose?.addEventListener("click", (e) => {
  e.stopPropagation();
  minimizeBuild();
});

genrestore?.addEventListener("click", (e) => {
  e.stopPropagation();
  restoreBuild();
});

genwrap.addEventListener("click", (e) => {
  if (e.target === genwrap) minimizeBuild();
});

function ensureEasterEgg() {
  let egg = document.getElementById("golden-freddy");
  if (egg) return egg;
  egg = document.createElement("div");
  egg.id = "golden-freddy";
  egg.hidden = true;
  egg.innerHTML = `
    <div class="gf-static" aria-hidden="true"></div>
    <img class="gf-figure" src="/assets/golden-freddy.png" alt="" aria-hidden="true" />
    <div class="gf-words" aria-hidden="true">ITS ME</div>`;
  egg.addEventListener("click", () => hideEasterEgg());
  stage.appendChild(egg);
  return egg;
}

function hideEasterEgg() {
  const egg = document.getElementById("golden-freddy");
  if (!egg) return;
  clearTimeout(eggTimer);
  egg.classList.remove("show", "dim");
  setTimeout(() => { egg.hidden = true; }, 260);
}

function triggerEasterEgg() {
  const egg = ensureEasterEgg();
  clearTimeout(eggTimer);
  egg.hidden = false;
  egg.classList.remove("show");
  egg.classList.add("dim");
  requestAnimationFrame(() => {
    setTimeout(() => egg.classList.add("show"), 640);
  });
  eggTimer = setTimeout(hideEasterEgg, 5200);
}

flameLoader?.addEventListener("click", (e) => {
  if (genwrap.hidden || !genwrap.classList.contains("on")) return;
  e.stopPropagation();
  clearTimeout(fireClickTimer);
  fireClicks += 1;
  if (fireClicks >= 3) {
    fireClicks = 0;
    triggerEasterEgg();
    return;
  }
  fireClickTimer = setTimeout(() => { fireClicks = 0; }, 1100);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideEasterEgg();
});

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
  fireClicks = 0;

  genfeed.innerHTML = "";
  genstatus.textContent = `${VERBS[Math.floor(Math.random() * VERBS.length)]} build`;
  genwrap.hidden = false;
  genwrap.classList.remove("minimized");
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
            feedRow("thought", "N", ev.text);
            genstatus.textContent = ev.text;
          } else if (ev.type === "switch") {
            const limited = /limit/i.test(ev.reason || "");
            feedRow("switch", "S", limited ? `${ev.from} hit its limit. Switching to ${ev.to}.` : `${ev.from} unavailable. Switching to ${ev.to}.`);
            genstatus.textContent = `switching to ${ev.to}`;
          } else if (ev.type === "start") {
            feedRow("start", "A", `${ev.harness} started`);
          } else if (ev.type === "result") {
            finalText = ev.text;
          } else if (ev.type === "log") {
            feedRow("log", "·", ev.text);
            genstatus.textContent = ev.text;
          } else if (ev.type === "error") {
            feedRow("error", "!", ev.message);
            genstatus.textContent = `Error: ${ev.message}`;
          }
        } catch {}
      }
    }
    if (finalText) { feedRow("result", "OK", finalText); genstatus.textContent = finalText; }
  } catch (err) {
    genstatus.textContent = `Error: ${err.message}`;
  }

  await loadState();
  setTimeout(() => {
    genwrap.classList.remove("on");
    setTimeout(() => {
      genwrap.classList.remove("minimized");
      genwrap.hidden = true;
    }, 800);
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
    { label: "History", hint: "restore an earlier snapshot", run: openHistory },
    { label: "Save room", hint: "freeze this canvas under a name", run: doSaveRoom },
    { label: "Open room", hint: "open a saved canvas", run: openRooms },
    { label: "Widget library", hint: "browse & summon saved widgets", run: openLibrary },
    { label: "Clear canvas", hint: "remove every widget (undoable)", run: clearCanvas },
    { label: "Rerun last prompt", hint: lastPrompt ? lastPrompt.slice(0, 44) : "nothing yet", run: () => lastPrompt && generate(lastPrompt, []) },
    { label: "Use freeform windows", hint: layoutMode === "free" ? "active" : "floating layout", run: () => setLayoutMode("free") },
    { label: "Snap windows to panels", hint: layoutMode === "snap" ? "active" : "panel layout", run: () => setLayoutMode("snap") },
    { label: "Share QR", hint: "open this Glade on your phone", run: showShare },
  ];
  for (const c of CORE_WIDGETS) {
    cmds.push({ label: `Open ${c.title}`, hint: "built-in capability", run: () => summonCore(c.slug) });
  }
  for (const h of state.harnessChain || []) {
    cmds.push({ label: `Switch harness: ${h}`, hint: h === state.harness ? "active" : "", run: () => switchHarness(h) });
  }
  return cmds;
}

let palCloseTimer = null;
function openPalette(items) {
  clearTimeout(palCloseTimer);
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
  clearTimeout(palCloseTimer);
  palCloseTimer = setTimeout(() => (palette.hidden = true), 250);
}
function renderPalette(q) {
  const ql = q.toLowerCase();
  const matches = palItems.filter((it) => it.label.toLowerCase().includes(ql));
  palIndex = Math.min(palIndex, Math.max(0, matches.length - 1));
  pallist.innerHTML = "";
  if (!matches.length) {
    palinput.removeAttribute("aria-activedescendant");
    pallist.innerHTML = `<div class="pal-empty" role="status">No commands found</div>`;
    pallist._matches = [];
    return;
  }
  matches.forEach((it, i) => {
    const row = document.createElement("div");
    const active = i === palIndex;
    const id = `pal-row-${i}`;
    row.id = id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(active));
    row.className = "pal-row" + (i === palIndex ? " active" : "");
    row.innerHTML = `<span class="pal-label"></span><span class="pal-hint"></span>`;
    row.querySelector(".pal-label").textContent = it.label;
    row.querySelector(".pal-hint").textContent = it.hint || "";
    row.onpointerdown = (e) => e.preventDefault();
    row.onclick = () => runPaletteItem(it);
    if (it.actions?.length) {
      const actions = document.createElement("span");
      actions.className = "pal-actions";
      it.actions.forEach((action) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pal-action";
        btn.innerHTML = icon(action.icon);
        btn.title = action.label;
        btn.setAttribute("aria-label", action.label);
        btn.onpointerdown = (e) => { e.preventDefault(); e.stopPropagation(); };
        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); action.run(it); };
        actions.appendChild(btn);
      });
      row.appendChild(actions);
    }
    pallist.appendChild(row);
    if (active) palinput.setAttribute("aria-activedescendant", id);
  });
  pallist._matches = matches;
  scrollActivePalette();
}

function scrollActivePalette() {
  const active = pallist.querySelector(".pal-row.active");
  if (!active) return;
  const pad = 8;
  const listRect = pallist.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  if (activeRect.top < listRect.top + pad) {
    pallist.scrollTop += activeRect.top - listRect.top - pad;
  } else if (activeRect.bottom > listRect.bottom - pad) {
    pallist.scrollTop += activeRect.bottom - listRect.bottom + pad;
  }
}

function runPaletteItem(it) {
  closePalette();
  it.run();
}

palinput.addEventListener("input", () => { palIndex = 0; renderPalette(palinput.value); });
palinput.addEventListener("keydown", (e) => {
  const matches = pallist._matches || [];
  if (!matches.length && ["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(e.key)) {
    e.preventDefault();
    return;
  }
  if (e.key === "ArrowDown") { e.preventDefault(); palIndex = Math.min(palIndex + 1, matches.length - 1); renderPalette(palinput.value); }
  else if (e.key === "ArrowUp") { e.preventDefault(); palIndex = Math.max(palIndex - 1, 0); renderPalette(palinput.value); }
  else if (e.key === "Home") { e.preventDefault(); palIndex = 0; renderPalette(palinput.value); }
  else if (e.key === "End") { e.preventDefault(); palIndex = Math.max(0, matches.length - 1); renderPalette(palinput.value); }
  else if (e.key === "Enter") { e.preventDefault(); const it = matches[palIndex]; if (it) runPaletteItem(it); }
  else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
});
palette.addEventListener("click", (e) => { if (e.target === palette) closePalette(); });
palettebtn.onclick = () => openPalette();
harnessPill.onclick = () => openPalette((state.harnessChain || []).map((h) => ({
  label: `Switch harness: ${h}`, hint: h === state.harness ? "active" : "", run: () => switchHarness(h),
})));

// ---------- palette actions ----------

async function doUndo() {
  const r = await (await fetch("/api/undo", { method: "POST" })).json();
  flash(r.ok ? "Undone" : (r.error || "nothing to undo"));
  loadState();
}
async function switchHarness(h) {
  await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ harness: h }) });
  flash(`harness: ${h}`);
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
async function renameRoomAction(room) {
  const next = prompt2("Rename room:", room.name);
  if (!next || next === room.name) return;
  const r = await (await fetch("/api/rooms/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: room.name, to: next }),
  })).json();
  flash(r.ok ? `renamed room “${r.name}”` : (r.error || "rename failed"));
  if (r.ok) openRooms();
}
async function deleteRoomAction(room) {
  if (!window.confirm(`Delete room “${room.name}”?`)) return;
  const r = await (await fetch("/api/rooms/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: room.name }),
  })).json();
  flash(r.ok ? `deleted room “${room.name}”` : (r.error || "delete failed"));
  if (r.ok) openRooms();
}
async function openRooms() {
  const { rooms } = await (await fetch("/api/rooms")).json();
  if (!rooms.length) return flash("no saved rooms yet");
  openPalette(rooms.map((r) => ({
    label: r.name, hint: `${r.widgetCount || 0} widgets`,
    actions: [
      { icon: "pencil", label: `Rename ${r.name}`, run: () => renameRoomAction(r) },
      { icon: "trash", label: `Delete ${r.name}`, run: () => deleteRoomAction(r) },
    ],
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

// ---------- widget library / picker ----------
// Save individual widgets (their files + captured state) to a personal shelf,
// then summon them into any room from a live, grid-style picker. Each saved
// widget is mounted as a real, scaled-down, non-interactive preview.

const PREVIEW_FRAME = { small: [320, 240], medium: [400, 320], large: [520, 380], full: [640, 440] };

let libraryEl = null;
let libraryOpen = false;
let libraryPreviews = [];
let libraryResizeObs = null;

// Capture a widget's state and stash its whole self on the library shelf.
async function saveWidgetToLibrary(slug) {
  const widgetState = captureWidgetState(slug);
  try {
    const res = await fetch("/api/library/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, state: widgetState }),
    });
    let r = {};
    try { r = await res.json(); } catch {}
    if (res.ok && r.ok) {
      const stored = Object.keys(widgetState).length;
      flash(`saved “${r.meta?.title || slug}” to the library${stored ? " (with state)" : ""}`);
      if (libraryOpen) renderLibrary();
      return;
    }
    // The library routes are new to the server; a server that predates them
    // 404s with the generic router body ("not found"). Say so plainly rather
    // than echoing a cryptic error.
    if (res.status === 404 && /^not found$/i.test(r.error || "")) {
      return flash("the widget library needs a server restart — run npm start again");
    }
    flash(r.error || "couldn't save widget");
  } catch (err) {
    flash(`save failed: ${err.message}`);
  }
}

// Pull a saved widget into the current canvas, seeding its state before it mounts.
async function addFromLibrary(meta) {
  try {
    const r = await (await fetch("/api/library/add", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: meta.slug }),
    })).json();
    if (!r.ok) return flash(r.error || "couldn't add widget");
    restoreWidgetState(r.slug, r.state);
    closeLibrary();
    await loadState();
    const m = mounted.get(r.slug);
    if (m) { bringToFront(m.el, 40); flashWidget(m.el); }
    flash(r.already ? `“${meta.title || meta.slug}” refreshed in this room` : `added “${meta.title || meta.slug}”`);
  } catch (err) {
    flash(`add failed: ${err.message}`);
  }
}

async function deleteLibraryWidget(meta) {
  if (!window.confirm(`Delete “${meta.title || meta.slug}” from the library?`)) return;
  try {
    await fetch("/api/library/delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: meta.slug }),
    });
  } catch {}
  renderLibrary();
}

function ensureLibraryEl() {
  if (libraryEl) return libraryEl;
  libraryEl = document.createElement("div");
  libraryEl.id = "library";
  libraryEl.hidden = true;
  libraryEl.innerHTML = `
    <div id="librarybox" class="glass" role="dialog" aria-modal="true" aria-label="Widget library">
      <div class="lib-head">
        <h2>Widget library</h2>
        <span class="lib-sub-count" id="lib-count"></span>
        <button type="button" class="lib-close" aria-label="Close library">${icon("x")}</button>
      </div>
      <div class="lib-grid" id="lib-grid"></div>
    </div>`;
  libraryEl.addEventListener("click", (e) => { if (e.target === libraryEl) closeLibrary(); });
  libraryEl.querySelector(".lib-close").onclick = closeLibrary;
  stage.appendChild(libraryEl);
  return libraryEl;
}

async function openLibrary() {
  ensureLibraryEl();
  libraryEl.hidden = false;
  libraryOpen = true;
  requestAnimationFrame(() => libraryEl.classList.add("on"));
  await renderLibrary();
}

function closeLibrary() {
  if (!libraryEl || !libraryOpen) return;
  libraryOpen = false;
  teardownPreviews();
  libraryEl.classList.remove("on");
  setTimeout(() => { if (!libraryOpen) libraryEl.hidden = true; }, 220);
}

function teardownPreviews() {
  if (libraryResizeObs) { libraryResizeObs.disconnect(); libraryResizeObs = null; }
  for (const p of libraryPreviews.splice(0)) {
    try { p.def?.unmount?.(p.body); } catch {}
    for (const fn of p.cleanups.splice(0)) { try { fn(); } catch {} }
  }
}

async function renderLibrary() {
  const gridEl = libraryEl.querySelector("#lib-grid");
  const countEl = libraryEl.querySelector("#lib-count");
  teardownPreviews();
  let widgets = [];
  let needsRestart = false;
  try {
    const res = await fetch("/api/library");
    if (res.status === 404) needsRestart = true;
    else widgets = ((await res.json()).widgets) || [];
  } catch {}
  countEl.textContent = widgets.length ? `${widgets.length} saved` : "";
  gridEl.innerHTML = "";
  if (needsRestart) {
    gridEl.innerHTML = `<div class="lib-empty"><strong>Library needs a server restart</strong><span>The widget library is new — restart Glade (<code>npm start</code>) to turn it on. Your widgets and rooms are untouched.</span></div>`;
    return;
  }
  if (!widgets.length) {
    gridEl.innerHTML = `<div class="lib-empty"><strong>No saved widgets yet</strong><span>Open any widget's ⠿ menu (top-left of the widget) and choose “Save widget” to keep it here — then summon it into any room.</span></div>`;
    return;
  }
  libraryResizeObs = new ResizeObserver((entries) => {
    for (const entry of entries) rescalePreview(entry.target);
  });
  const liveSlugs = new Set((state.widgets || []).map((w) => w.slug));
  for (const meta of widgets) gridEl.appendChild(buildLibraryCard(meta, liveSlugs.has(meta.slug)));
}

function buildLibraryCard(meta, inRoom) {
  const card = document.createElement("div");
  card.className = "lib-card";
  card.dataset.slug = meta.slug;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Add ${meta.title || meta.slug} to the current room`);
  card.innerHTML = `
    <div class="lib-preview"><div class="lib-frame"></div><span class="lib-add">＋ Add to room</span></div>
    <div class="lib-foot">
      <div class="lib-meta">
        <span class="lib-title"></span>
        <span class="lib-sub"></span>
      </div>
      <button type="button" class="lib-del" title="Delete from library" aria-label="Delete from library">${icon("trash")}</button>
    </div>
    ${inRoom ? `<span class="lib-badge">in room</span>` : ``}`;
  card.querySelector(".lib-title").textContent = meta.title || meta.slug;
  const sub = [meta.size || "medium"];
  if (meta.hasBackend) sub.push("backend");
  if (meta.hasState) sub.push("state");
  card.querySelector(".lib-sub").textContent = sub.join(" · ");
  card.querySelector(".lib-del").addEventListener("click", (e) => { e.stopPropagation(); deleteLibraryWidget(meta); });
  card.addEventListener("click", () => addFromLibrary(meta));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addFromLibrary(meta); } });
  mountPreview(meta, card.querySelector(".lib-preview"));
  return card;
}

async function mountPreview(meta, box) {
  const frame = box.querySelector(".lib-frame");
  const [fw, fh] = PREVIEW_FRAME[meta.size] || PREVIEW_FRAME.medium;
  frame.style.width = `${fw}px`;
  frame.style.height = `${fh}px`;
  const preview = { slug: meta.slug, def: {}, body: frame, cleanups: [] };
  libraryPreviews.push(preview);
  if (libraryResizeObs) libraryResizeObs.observe(box);
  rescalePreview(box);
  try {
    const mod = await import(`/api/library/asset/${meta.slug}/widget.js?v=${meta.savedAt || Date.now()}`);
    if (!libraryPreviews.includes(preview)) return; // picker closed mid-load
    preview.def = mod.default || {};
    await preview.def.mount?.(frame, makePreviewApi(meta, preview));
  } catch (err) {
    frame.innerHTML = `<div class="lib-fallback"><strong>${meta.title || meta.slug}</strong><span>preview unavailable</span></div>`;
  }
  requestAnimationFrame(() => rescalePreview(box));
}

// Fit the fixed-size preview frame into its (responsive) box, centered.
function rescalePreview(box) {
  const frame = box.querySelector(".lib-frame");
  if (!frame) return;
  const fw = parseFloat(frame.style.width) || 400;
  const fh = parseFloat(frame.style.height) || 320;
  if (!box.clientWidth || !box.clientHeight) return;
  const scale = Math.min(box.clientWidth / fw, box.clientHeight / fh);
  frame.style.transform = `scale(${scale})`;
  frame.style.left = `${Math.max(0, (box.clientWidth - fw * scale) / 2)}px`;
  frame.style.top = `${Math.max(0, (box.clientHeight - fh * scale) / 2)}px`;
}

// A sandboxed glade API for previews: real backend (the saved copy) + proxy,
// but an isolated bus and an in-memory store seeded from the saved state, so a
// preview can never disturb live widgets or the saved snapshot.
function makePreviewApi(meta, preview) {
  const previewBus = new EventTarget();
  const mem = { ...(meta.state || {}) };
  return {
    call: async (payload = {}) => {
      const r = await (await fetch(`/api/library/widget/${meta.slug}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      })).json();
      if (!r.ok) throw new Error(r.error || "backend failed");
      return r.result;
    },
    subscribe: (payload, onMessage) => {
      const src = new EventSource(`/api/library/stream/${meta.slug}?payload=${encodeURIComponent(JSON.stringify(payload || {}))}`);
      src.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
      const close = () => src.close();
      preview.cleanups.push(close);
      return close;
    },
    fetch: async (url, opts = {}) => {
      const r = await (await fetch("/api/proxy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method: opts.method, headers: opts.headers, body: opts.body }),
      })).json();
      if (!r.ok) throw new Error(r.error || "fetch failed");
      return { status: r.status, headers: r.headers, text: r.body, json: () => JSON.parse(r.body) };
    },
    emit: (channel, detail) => previewBus.dispatchEvent(new CustomEvent(channel, { detail })),
    on: (channel, fn) => {
      const h = (e) => fn(e.detail);
      previewBus.addEventListener(channel, h);
      const off = () => previewBus.removeEventListener(channel, h);
      preview.cleanups.push(off);
      return off;
    },
    store: {
      get: (k, d = null) => (k in mem ? mem[k] : d),
      set: (k, v) => { mem[k] = v; },
      del: (k) => { delete mem[k]; },
    },
    refresh: () => {},
  };
}

// Briefly pulse a freshly-summoned widget so the eye finds where it landed.
function flashWidget(el) {
  el.classList.add("just-added");
  setTimeout(() => el.classList.remove("just-added"), 900);
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && libraryOpen) closeLibrary(); });

// ---------- small UI helpers ----------

function flash(text) {
  let el = document.getElementById("flash");
  if (!el) { el = document.createElement("div"); el.id = "flash"; el.className = "glass"; stage.appendChild(el); }
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("on"), 1800);
}

function prompt2(label, value = "") {
  return window.prompt(label, value) || "";
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
  micBtn.addEventListener("click", () => (listening ? stop() : start()));
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
