import { useEffect, useMemo, useState } from "react";
import { CampList } from "./components/CampList";
import { SessionConsole } from "./components/SessionConsole";
import { StatusPanel } from "./components/StatusPanel";
import type { CampOverview } from "../shared/types";

export default function App() {
  const [camp, setCamp] = useState<CampOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadCamp() {
      try {
        const overview = await window.glade.getCampOverview();
        if (!cancelled) {
          setCamp(overview);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load camp");
        }
      }
    }

    void loadCamp();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const subtitle = useMemo(() => {
    if (!camp) {
      return "Preparing the glade";
    }

    return `${camp.branch} branch • ${camp.worktrees.length || 1} tree${camp.worktrees.length === 1 ? "" : "s"}`;
  }, [camp]);

  return (
    <div className="app-shell">
      <div className="mist-layer" />
      <aside className="left-rail">
        <div className="brand-block">
          <span className="brand-kicker">Self-hosting starts here</span>
          <h1>Glade</h1>
          <p>
            A camp-based shell for building software in the same world it lives in.
          </p>
        </div>

        <CampList camp={camp} onRefresh={() => setRefreshKey((value) => value + 1)} />
      </aside>

      <main className="main-stage">
        <header className="stage-header">
          <div>
            <span className="eyebrow">Campfire</span>
            <h2>{camp?.name ?? "Loading camp..."}</h2>
            <p>{subtitle}</p>
          </div>
          <div className="header-pill">{camp?.status ?? "..."}</div>
        </header>

        {error ? (
          <section className="panel error-panel">
            <h3>Camp unavailable</h3>
            <p>{error}</p>
          </section>
        ) : (
          <SessionConsole camp={camp} />
        )}
      </main>

      <aside className="right-rail">
        <StatusPanel camp={camp} />
      </aside>
    </div>
  );
}

