/* Core capability widget: a real shell, backed by the server's persistent
 * pipe-shell sessions (/api/shell/*). Dependency-free and offline-safe — the
 * harness can reach for xterm via the import map if it wants a fancier one. */
export default {
  title: "Terminal",
  size: "large",
  async mount(el, glade) {
    el.innerHTML = `
      <style>
        .term { display: flex; flex-direction: column; height: 100%; min-height: 240px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
        .term-out {
          flex: 1; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
          color: #c7f0d5; background: #090b0e; border: 1px solid var(--line); border-radius: 8px;
          padding: 12px; line-height: 1.45; margin-bottom: 8px;
        }
        .term-out .echo { color: var(--ink); }
        .term-in { display: flex; align-items: center; gap: 8px; }
        .term-in .ps { color: var(--accent); }
        .term-in input { flex: 1; background: #090b0e; }
        .term-dead { color: #ff9a9a; }
      </style>
      <div class="term">
        <div class="term-out" id="t-out"></div>
        <div class="term-in">
          <span class="ps">$</span>
          <input class="g-input" id="t-in" placeholder="run a command" autocomplete="off" spellcheck="false" />
        </div>
      </div>`;

    const out = el.querySelector("#t-out");
    const input = el.querySelector("#t-in");
    const history = glade.store.get("history", []);
    let hi = history.length;

    const stripControl = (text) => String(text)
      .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");

    const append = (text, cls) => {
      const span = document.createElement("span");
      if (cls) span.className = cls;
      span.textContent = stripControl(text);
      out.appendChild(span);
      out.scrollTop = out.scrollHeight;
    };

    let id = null;
    try {
      const r = await (await fetch("/api/shell/open", { method: "POST" })).json();
      if (!r.ok) throw new Error(r.error || "could not open shell");
      id = r.id;
    } catch (e) {
      append(`failed to open shell: ${e.message}`, "term-dead");
      return;
    }

    const es = new EventSource(`/api/shell/stream?id=${encodeURIComponent(id)}`);
    el._es = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "out") append(msg.data);
        else if (msg.type === "exit") append(`\n[shell exited: ${msg.code}]`, "term-dead");
      } catch {}
    };

    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        const line = input.value;
        append(`$ ${line}\n`, "echo");
        if (line.trim()) { history.push(line); glade.store.set("history", history.slice(-200)); }
        hi = history.length;
        input.value = "";
        try { await fetch("/api/shell/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, data: line + "\n" }) }); }
        catch (err) { append(`\nsend failed: ${err.message}`, "term-dead"); }
      } else if (e.key === "ArrowUp") {
        if (hi > 0) { hi--; input.value = history[hi] || ""; e.preventDefault(); }
      } else if (e.key === "ArrowDown") {
        if (hi < history.length) { hi++; input.value = history[hi] || ""; }
      }
    });
    input.focus();
  },
  unmount(el) { try { el._es?.close(); } catch {} },
};
