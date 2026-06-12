/*
 * JARVIS — voice control for Glade.
 * Uses the browser's Web Speech API (no keys, no backend).
 * Say "Jarvis, <command>" while listening, or press the orb and just speak.
 * Commands are routed through Glade's own command bar, so the harness
 * builds/edits widgets exactly as if you'd typed the request.
 */

const WAKE = /\b(jarvis|jervis|travis)\b[,.!?]*\s*/i;

export default {
  title: "JARVIS",
  size: "medium",

  async mount(el, glade) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    el.innerHTML = `
      <style>
        .jv { display:flex; flex-direction:column; align-items:center; gap:14px; padding:10px 6px; text-align:center; }
        .jv-orb {
          width:84px; height:84px; border-radius:50%; cursor:pointer; border:none;
          background: radial-gradient(circle at 35% 35%, rgba(120,255,210,.35), rgba(20,40,35,.9));
          box-shadow: 0 0 18px rgba(120,255,210,.25), inset 0 0 22px rgba(120,255,210,.15);
          transition: box-shadow .3s, transform .2s;
          display:flex; align-items:center; justify-content:center; font-size:30px;
        }
        .jv-orb:hover { transform: scale(1.05); }
        .jv.listening .jv-orb {
          box-shadow: 0 0 34px var(--accent), inset 0 0 30px rgba(120,255,210,.35);
          animation: jv-pulse 1.6s ease-in-out infinite;
        }
        @keyframes jv-pulse { 50% { box-shadow: 0 0 14px rgba(120,255,210,.3), inset 0 0 18px rgba(120,255,210,.2); } }
        .jv-status { color: var(--ink-dim); font-size: 12px; letter-spacing:.06em; text-transform:uppercase; min-height:16px; }
        .jv-heard { color: var(--ink); font-size:14px; min-height:20px; max-width:100%; overflow:hidden; text-overflow:ellipsis; }
        .jv-hint { color: var(--ink-dim); font-size:11px; opacity:.7; }
        .jv-row { display:flex; gap:8px; align-items:center; }
        .jv-toggle { font-size:11px; }
      </style>
      <div class="jv">
        <button class="jv-orb" title="Toggle listening">🎙️</button>
        <div class="jv-status">offline</div>
        <div class="jv-heard"></div>
        <div class="jv-row">
          <label class="jv-hint jv-toggle"><input type="checkbox" class="jv-wake" checked> require wake word “Jarvis”</label>
          <label class="jv-hint jv-toggle"><input type="checkbox" class="jv-voice" checked> spoken replies</label>
        </div>
        <div class="jv-hint">Say “Jarvis, build me a pomodoro timer” — commands go straight to Glade.</div>
      </div>`;

    const root = el.querySelector(".jv");
    const orb = el.querySelector(".jv-orb");
    const status = el.querySelector(".jv-status");
    const heard = el.querySelector(".jv-heard");
    const wakeBox = el.querySelector(".jv-wake");
    const voiceBox = el.querySelector(".jv-voice");

    if (!SR) {
      status.textContent = "speech recognition unsupported";
      heard.textContent = "Use Chrome or Edge for voice control.";
      orb.disabled = true;
      return;
    }

    const speak = (text) => {
      if (!voiceBox.checked || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    };

    const sendToGlade = (command) => {
      heard.textContent = `“${command}”`;
      status.textContent = "on it, sir";
      speak("On it, sir.");
      // Route through Glade's own command bar so the normal generation
      // overlay, streaming, and widget reload all happen.
      const promptEl = document.getElementById("prompt");
      const cmd = document.getElementById("cmd");
      if (promptEl && cmd) {
        promptEl.value = command;
        cmd.dispatchEvent(new Event("submit", { cancelable: true }));
      } else {
        fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: command }),
        });
      }
    };

    let active = false;
    let rec = null;
    this._stop = null;

    const startRec = () => {
      rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const text = e.results[i][0].transcript.trim();
          if (!e.results[i].isFinal) { interim = text; continue; }
          if (!text) continue;
          if (wakeBox.checked) {
            const m = text.match(WAKE);
            if (!m) { heard.textContent = `(ignored: “${text}”)`; continue; }
            const command = text.slice(m.index + m[0].length).trim();
            if (command) sendToGlade(command);
            else { status.textContent = "yes? awaiting command"; speak("Yes?"); }
          } else {
            sendToGlade(text);
          }
        }
        if (interim) heard.textContent = interim + "…";
      };

      rec.onerror = (e) => {
        if (e.error === "not-allowed") {
          status.textContent = "microphone blocked";
          active = false;
          root.classList.remove("listening");
        }
      };
      // Chrome stops recognition periodically — restart while active.
      rec.onend = () => { if (active) try { rec.start(); } catch {} };

      try { rec.start(); } catch {}
    };

    const setActive = (on) => {
      active = on;
      root.classList.toggle("listening", on);
      if (on) {
        status.textContent = wakeBox.checked ? "listening for “jarvis”" : "listening";
        startRec();
      } else {
        status.textContent = "offline";
        heard.textContent = "";
        if (rec) { rec.onend = null; try { rec.stop(); } catch {} rec = null; }
      }
    };

    orb.onclick = () => setActive(!active);
    wakeBox.onchange = () => { if (active) status.textContent = wakeBox.checked ? "listening for “jarvis”" : "listening"; };

    el._jarvisCleanup = () => setActive(false);
  },

  unmount(el) {
    el._jarvisCleanup?.();
    window.speechSynthesis?.cancel();
  },
};
