/* Glade frontend — command bar, generation overlay, widget loader, env panel. */

const stage = document.getElementById("stage");
const grid = document.getElementById("grid");
const cmd = document.getElementById("cmd");
const promptEl = document.getElementById("prompt");
const genwrap = document.getElementById("genwrap");
const genstatus = document.getElementById("genstatus");
const envpanel = document.getElementById("envpanel");
const envform = document.getElementById("envform");
const envtitle = document.getElementById("envtitle");

const mounted = new Map(); // slug -> { def, el }
let generating = false;

// ---------- state / widgets ----------

async function loadState() {
  const state = await (await fetch("/api/state")).json();
  stage.classList.toggle("empty-state", state.widgets.length === 0);

  const liveSlugs = new Set(state.widgets.map((w) => w.slug));
  for (const [slug, m] of mounted) {
    if (!liveSlugs.has(slug)) {
      try { m.def.unmount?.(m.body); } catch {}
      m.el.remove();
      mounted.delete(slug);
    }
  }
  for (const w of state.widgets) {
    if (mounted.has(w.slug)) {
      // env may have just been provided — remount if it was blocked
      const m = mounted.get(w.slug);
      const wasBlocked = m.el.classList.contains("needs-env");
      const nowBlocked = w.missingEnv.length > 0;
      m.el.classList.toggle("needs-env", nowBlocked);
      if (wasBlocked && !nowBlocked) mountWidget(w, m);
      continue;
    }
    await addWidget(w);
  }
}

async function addWidget(w) {
  const el = document.createElement("section");
  el.className = `widget glass size-${w.size || "medium"}`;
  el.innerHTML = `
    <div class="widget-head">
      <span class="widget-title"></span>
      <button class="widget-close" title="Remove widget">✕</button>
    </div>
    <div class="widget-body"></div>`;
  el.querySelector(".widget-title").textContent = w.title || w.slug;
  el.querySelector(".widget-close").onclick = async () => {
    await fetch(`/api/widget/${w.slug}`, { method: "DELETE" });
    loadState();
  };
  grid.appendChild(el);

  const m = { el, body: el.querySelector(".widget-body"), def: {} };
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

async function mountWidget(w, m) {
  m.el.querySelector(".env-badge")?.remove();
  m.body.classList.remove("error");
  m.body.innerHTML = "";
  try {
    const mod = await import(`/widgets/${w.slug}/widget.js?v=${Date.now()}`);
    m.def = mod.default || {};
    if (m.def.title) m.el.querySelector(".widget-title").textContent = m.def.title;
    if (m.def.size) m.el.className = `widget glass size-${m.def.size}`;
    const glade = {
      call: async (payload = {}) => {
        const r = await (await fetch(`/api/widget/${w.slug}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })).json();
        if (!r.ok) throw new Error(r.error || "backend failed");
        return r.result;
      },
      refresh: () => mountWidget(w, m),
    };
    await m.def.mount(m.body, glade);
  } catch (err) {
    m.body.classList.add("error");
    m.body.textContent = `widget error: ${err.message}`;
  }
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

// ---------- generation ----------

const VERBS = ["conjuring", "weaving", "growing", "shaping", "summoning"];

cmd.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt || generating) return;
  generating = true;
  promptEl.value = "";
  promptEl.blur();

  genstatus.textContent = `${VERBS[Math.floor(Math.random() * VERBS.length)]}…`;
  genwrap.hidden = false;
  requestAnimationFrame(() => genwrap.classList.add("on"));

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
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
            genstatus.textContent = `${ev.name.toLowerCase()} · ${ev.detail || ""}`;
          } else if (ev.type === "thought") {
            genstatus.textContent = ev.text;
          } else if (ev.type === "result") {
            finalText = ev.text;
          } else if (ev.type === "error") {
            genstatus.textContent = `✕ ${ev.message}`;
          }
        } catch {}
      }
    }
    if (finalText) genstatus.textContent = finalText;
  } catch (err) {
    genstatus.textContent = `✕ ${err.message}`;
  }

  await loadState();
  setTimeout(() => {
    genwrap.classList.remove("on");
    setTimeout(() => (genwrap.hidden = true), 800);
    generating = false;
  }, finalDelay());
});

function finalDelay() {
  // let the user read the final status line briefly
  return 1400;
}

// focus the bar with "/" anywhere
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== promptEl) {
    e.preventDefault();
    promptEl.focus();
  }
});

loadState();
