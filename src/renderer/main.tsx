import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RendererCrashBoundary } from "./components/RendererCrashBoundary";
import "./styles/app.css";
import "@xterm/xterm/css/xterm.css";

function installCrashOverlay() {
  const showCrash = (title: string, detail: string) => {
    const existing = document.getElementById("glade-crash-overlay");
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement("div");
    overlay.id = "glade-crash-overlay";
    overlay.className = "renderer-crash renderer-crash--overlay";
    overlay.innerHTML = `
      <span class="eyebrow">${title}</span>
      <h1>Glade failed during startup</h1>
      <pre>${detail.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char] ?? char))}</pre>
    `;
    document.body.appendChild(overlay);
  };

  window.addEventListener("error", (event) => {
    const detail = event.error?.stack || event.message || "Unknown renderer error";
    showCrash("Window Error", detail);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error
      ? event.reason.stack || event.reason.message
      : String(event.reason);
    showCrash("Unhandled Rejection", reason);
  });
}

installCrashOverlay();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RendererCrashBoundary>
      <App />
    </RendererCrashBoundary>
  </React.StrictMode>,
);
