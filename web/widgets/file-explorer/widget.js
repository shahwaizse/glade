function fmtSize(n) {
  if (n === null || n === undefined) return "";
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (v >= 10 ? Math.round(v) : v.toFixed(1)) + " " + units[i];
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default {
  title: "File Explorer",
  size: "medium",
  async mount(el, glade) {
    let current = null;

    async function load(dir) {
      el.innerHTML = `<div style="padding:12px;color:var(--ink-dim)">Loading…</div>`;
      let data;
      try {
        data = await glade.call(dir ? { dir } : {});
      } catch (e) {
        el.innerHTML = `
          <div style="padding:12px">
            <div style="color:#ff8080;margin-bottom:8px">${esc(e.message || String(e))}</div>
            <button class="g-btn" data-act="back">Back</button>
          </div>`;
        el.querySelector('[data-act="back"]').onclick = () => load(current || "~");
        return;
      }
      current = data.dir;
      render(data);
    }

    function render(data) {
      const rows = data.items.map((it, i) => `
        <div class="g-row fx-row${it.isDir ? " fx-dir" : ""}" data-i="${i}">
          <span class="fx-icon">${it.isDir ? "📁" : "📄"}</span>
          <span class="fx-name">${esc(it.name)}</span>
          <span class="fx-size">${it.isDir ? "—" : fmtSize(it.size)}</span>
        </div>`).join("");

      el.innerHTML = `
        <style>
          .fx-bar { display:flex; gap:6px; align-items:center; padding:8px 10px; }
          .fx-path { flex:1; color:var(--ink-dim); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; direction:rtl; text-align:left; }
          .fx-list { max-height:340px; overflow-y:auto; padding:0 6px 8px; }
          .fx-row { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; cursor:default; }
          .fx-dir { cursor:pointer; }
          .fx-dir:hover { background:rgba(255,255,255,0.06); }
          .fx-icon { flex:none; }
          .fx-name { flex:1; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .fx-dir .fx-name { color:var(--accent); }
          .fx-size { flex:none; color:var(--ink-dim); font-size:12px; font-variant-numeric:tabular-nums; }
          .fx-empty { padding:16px; color:var(--ink-dim); text-align:center; }
        </style>
        <div class="fx-bar">
          <button class="g-btn" data-act="up" ${data.isRoot ? "disabled" : ""}>↑ Up</button>
          <button class="g-btn" data-act="home">⌂ Home</button>
          <span class="fx-path" title="${esc(data.dir)}">${esc(data.dir)}</span>
        </div>
        <div class="g-list fx-list">
          ${rows || `<div class="fx-empty">Empty folder</div>`}
        </div>`;

      el.querySelector('[data-act="up"]').onclick = () => !data.isRoot && load(data.parent);
      el.querySelector('[data-act="home"]').onclick = () => load(data.home);
      el.querySelectorAll(".fx-dir").forEach(row => {
        row.onclick = () => load(data.dir.replace(/\/$/, "") + "/" + data.items[+row.dataset.i].name);
      });
    }

    await load(null);
  }
};
