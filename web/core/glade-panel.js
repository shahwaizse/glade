/* Core capability widget: Glade, introspecting itself — harness chain, live
 * widgets, snapshot history, saved rooms, the construct library, and the LAN
 * addresses. The room made legible to itself. */
const LIBS = ["three", "d3", "chart.js", "marked", "dompurify", "maplibre-gl", "uplot", "qrcode", "codemirror", "@xterm/xterm"];

export default {
  title: "Glade",
  size: "medium",
  async mount(el, glade) {
    el.innerHTML = `
      <style>
        .gp { display: flex; flex-direction: column; gap: 16px; font-size: 13px; }
        .gp h4 { margin: 0 0 6px; font-size: 12px; color: var(--ink-dim); }
        .gp .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .gp .chip { font: inherit; font-size: 11px; padding: 3px 9px; border-radius: 999px;
          background: var(--surface-2); border: 1px solid var(--line); color: var(--ink-dim); }
        .gp button.chip { cursor: pointer; }
        .gp .chip.on { background: var(--ink); color: #0a0a0a; border-color: transparent; cursor: pointer; }
        .gp .chip.act { cursor: pointer; }
        .gp .chip.act:hover { background: var(--surface-3); color: var(--ink); }
        .gp .lines { display: flex; flex-direction: column; gap: 4px; }
        .gp .line { display: flex; justify-content: space-between; gap: 8px; color: var(--ink); }
        .gp .line .sub { color: var(--ink-dim); font-size: 11.5px; }
        .gp .empty { color: var(--ink-dim); font-size: 12px; }
        .gp code { font-size: 11.5px; color: var(--ink-dim); }
      </style>
      <div class="gp" id="gp"></div>`;
    const root = el.querySelector("#gp");

    const render = async () => {
      const [state, hist, rooms, net] = await Promise.all([
        fetch("/api/state").then((r) => r.json()),
        fetch("/api/history").then((r) => r.json()),
        fetch("/api/rooms").then((r) => r.json()),
        fetch("/api/netinfo").then((r) => r.json()),
      ]);

      const harnessChips = (state.harnessChain || []).map((h) =>
        `<button type="button" class="chip ${h === state.harness ? "on" : "act"}" data-harness="${h}">${h}</button>`).join("");

      const widgetLines = (state.widgets || []).length
        ? state.widgets.map((w) => `<div class="line"><span>${w.title || w.slug}</span><span class="sub">${w.size}</span></div>`).join("")
        : `<div class="empty">No widgets yet</div>`;

      const histLines = (hist.history || []).slice(0, 5).map((h) =>
        `<div class="line"><button type="button" class="chip act" data-restore="${h.id}">Restore</button><span class="sub">${(h.label || "").slice(0, 28) || new Date(h.ts).toLocaleTimeString()}</span></div>`).join("")
        || `<div class="empty">No snapshots yet</div>`;

      const roomChips = (rooms.rooms || []).map((r) =>
        `<button type="button" class="chip act" data-room="${r.name}">${r.name}</button>`).join("") || `<span class="empty">None saved</span>`;

      root.innerHTML = `
        <div><h4>Harness</h4><div class="chips">${harnessChips}</div></div>
        <div><h4>Widgets (${(state.widgets || []).length})</h4><div class="lines">${widgetLines}</div></div>
        <div><h4>Recent snapshots</h4><div class="lines">${histLines}</div></div>
        <div><h4>Rooms</h4><div class="chips">${roomChips}</div></div>
        <div><h4>Constructs available</h4><div class="chips">${LIBS.map((l) => `<span class="chip">${l}</span>`).join("")}</div></div>
        <div><h4>Reachable at</h4><div class="lines">${(net.urls || [`http://localhost:${net.port}`]).map((u) => `<code>${u}</code>`).join("")}</div></div>
      `;

      root.querySelectorAll("[data-harness]").forEach((c) => c.onclick = async () => {
        await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ harness: c.dataset.harness }) });
        render();
      });
      root.querySelectorAll("[data-restore]").forEach((c) => c.onclick = async () => {
        await fetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.dataset.restore }) });
        glade.refresh();
      });
      root.querySelectorAll("[data-room]").forEach((c) => c.onclick = async () => {
        await fetch("/api/rooms/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: c.dataset.room }) });
        glade.refresh();
      });
    };

    await render();
  },
};
