const MODES = {
  focus: { label: "Focus", mins: 25 },
  short: { label: "Short Break", mins: 5 },
  long:  { label: "Long Break", mins: 15 },
};

export default {
  title: "Pomodoro",
  size: "small",
  async mount(el, glade) {
    let mode = "focus";
    let remaining = MODES[mode].mins * 60;
    let timer = null;
    let sessions = 0;

    el.innerHTML = `
      <style>
        .pomo { display:flex; flex-direction:column; align-items:center; gap:14px; padding:10px 0; }
        .pomo-tabs { display:flex; gap:6px; }
        .pomo-tab { background:transparent; border:1px solid rgba(255,255,255,.12); color:var(--ink-dim);
          border-radius:999px; padding:4px 12px; font-size:12px; cursor:pointer; }
        .pomo-tab.active { color:var(--ink); border-color:var(--accent); box-shadow:0 0 10px rgba(120,255,200,.25); }
        .pomo-ring { position:relative; width:150px; height:150px; }
        .pomo-ring svg { transform:rotate(-90deg); }
        .pomo-time { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
        .pomo-time .t { font-size:30px; font-weight:600; color:var(--ink); font-variant-numeric:tabular-nums; }
        .pomo-time .m { font-size:11px; color:var(--ink-dim); letter-spacing:.1em; text-transform:uppercase; }
        .pomo-controls { display:flex; gap:8px; }
        .pomo-count { font-size:11px; color:var(--ink-dim); }
      </style>
      <div class="pomo">
        <div class="pomo-tabs"></div>
        <div class="pomo-ring">
          <svg width="150" height="150">
            <circle cx="75" cy="75" r="66" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="6"/>
            <circle class="prog" cx="75" cy="75" r="66" fill="none" stroke="var(--accent)" stroke-width="6"
              stroke-linecap="round" stroke-dasharray="${2 * Math.PI * 66}" stroke-dashoffset="0"/>
          </svg>
          <div class="pomo-time"><div class="t"></div><div class="m"></div></div>
        </div>
        <div class="pomo-controls">
          <button class="g-btn start"></button>
          <button class="g-btn reset">Reset</button>
        </div>
        <div class="pomo-count"></div>
      </div>`;

    const tabsEl = el.querySelector(".pomo-tabs");
    const timeEl = el.querySelector(".t");
    const modeEl = el.querySelector(".m");
    const progEl = el.querySelector(".prog");
    const startBtn = el.querySelector(".start");
    const countEl = el.querySelector(".pomo-count");
    const CIRC = 2 * Math.PI * 66;

    for (const key of Object.keys(MODES)) {
      const b = document.createElement("button");
      b.className = "pomo-tab";
      b.dataset.mode = key;
      b.textContent = MODES[key].label;
      b.onclick = () => setMode(key);
      tabsEl.appendChild(b);
    }

    function render() {
      const m = String(Math.floor(remaining / 60)).padStart(2, "0");
      const s = String(remaining % 60).padStart(2, "0");
      timeEl.textContent = `${m}:${s}`;
      modeEl.textContent = MODES[mode].label;
      progEl.style.strokeDashoffset = CIRC * (1 - remaining / (MODES[mode].mins * 60));
      startBtn.textContent = timer ? "Pause" : "Start";
      countEl.textContent = `${sessions} focus session${sessions === 1 ? "" : "s"} done`;
      tabsEl.querySelectorAll(".pomo-tab").forEach((b) =>
        b.classList.toggle("active", b.dataset.mode === mode));
    }

    function setMode(key) {
      stop();
      mode = key;
      remaining = MODES[mode].mins * 60;
      render();
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function beep() {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const o = ac.createOscillator(), g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.frequency.value = 880; g.gain.value = 0.08;
        o.start(); o.stop(ac.currentTime + 0.35);
      } catch {}
    }

    function tick() {
      remaining--;
      if (remaining <= 0) {
        stop();
        beep();
        if (mode === "focus") {
          sessions++;
          setMode(sessions % 4 === 0 ? "long" : "short");
        } else {
          setMode("focus");
        }
        return;
      }
      render();
    }

    startBtn.onclick = () => {
      if (timer) stop();
      else timer = setInterval(tick, 1000);
      render();
    };
    el.querySelector(".reset").onclick = () => setMode(mode);

    el._pomoStop = stop;
    render();
  },
  unmount(el) {
    if (el._pomoStop) el._pomoStop();
  },
};
