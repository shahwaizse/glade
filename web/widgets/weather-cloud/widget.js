export default {
  title: "Weather",
  size: "small",

  async mount(el, glade) {
    el.innerHTML = `
      <style>
        .wc-wrap { display:flex; flex-direction:column; align-items:center; gap:6px; padding:10px 6px; text-align:center; }
        .wc-cloud { font-size:48px; line-height:1; animation: wc-jump 1.6s ease-in-out infinite; filter: drop-shadow(0 6px 10px rgba(0,0,0,.35)); }
        @keyframes wc-jump {
          0%, 100% { transform: translateY(0) scale(1, 1); }
          30%      { transform: translateY(-14px) scale(0.96, 1.05); }
          50%      { transform: translateY(0) scale(1.06, 0.92); }
          65%      { transform: translateY(-5px) scale(0.99, 1.02); }
          80%      { transform: translateY(0) scale(1, 1); }
        }
        .wc-temp { font-size: 30px; font-weight: 600; color: var(--ink); }
        .wc-label { color: var(--ink-dim); font-size: 13px; }
        .wc-place { color: var(--accent); font-size: 12px; letter-spacing: .03em; }
        .wc-meta { display:flex; gap:12px; color: var(--ink-dim); font-size: 11px; margin-top: 2px; }
        .wc-err { color: var(--ink-dim); font-size: 13px; padding: 16px; text-align:center; }
      </style>
      <div class="wc-wrap">
        <div class="wc-cloud">☁️</div>
        <div class="wc-label">Fetching weather…</div>
      </div>`;

    try {
      const w = await glade.call({});
      el.querySelector(".wc-wrap").innerHTML = `
        <div class="wc-cloud">${w.icon}</div>
        <div class="wc-temp">${w.temp}${w.unit}</div>
        <div class="wc-label">${w.label} · feels like ${w.feelsLike}${w.unit}</div>
        <div class="wc-place">${w.place}</div>
        <div class="wc-meta">
          <span>💧 ${w.humidity}%</span>
          <span>🌬️ ${w.wind} km/h</span>
        </div>`;
    } catch (e) {
      el.innerHTML = `<div class="wc-err">Couldn't fetch weather: ${e.message}</div>`;
    }

    this._timer = setInterval(() => glade.refresh(), 10 * 60 * 1000);
  },

  unmount() {
    clearInterval(this._timer);
  },
};
