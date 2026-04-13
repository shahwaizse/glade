import type { CampOverview, HostRuntimeInfo } from "../../shared/types";

interface StatusPanelProps {
  camp: CampOverview | null;
  host: HostRuntimeInfo | null;
}

export function StatusPanel({ camp, host }: StatusPanelProps) {
  return (
    <div className="status-stack">
      <section className="panel">
        <span className="eyebrow">Tree</span>
        <h3>{camp?.branch ?? "..."}</h3>
        <p>Branch and worktree context stay visible while you build inside the camp.</p>
      </section>

      <section className="panel">
        <span className="eyebrow">Bridge</span>
        <h3>{host?.hostPlatform ?? "..."}</h3>
        <p>
          Host runtime: {host?.isWslHost ? "WSL/Linux" : host?.hostPlatform ?? "unknown"}.
          {camp ? ` Camp runtime: ${camp.environment}.` : ""}
        </p>
      </section>

      <section className="panel">
        <span className="eyebrow">Ledger</span>
        <h3>{camp?.tokenLedger.total ?? 0} tokens</h3>
        <p>Token tracking is stubbed for now and ready for Codex telemetry to drop in.</p>
      </section>

      <section className="panel">
        <span className="eyebrow">Merchant</span>
        <h3>{camp?.mcpServers.length ?? 0} wares</h3>
        <p>The merchant stall will become the place for MCP servers, tools, and camp services.</p>
      </section>

      <section className="panel">
        <span className="eyebrow">Roots</span>
        <div className="worktree-list">
          {camp?.worktrees.length ? (
            camp.worktrees.map((tree) => (
              <div className="worktree-row" key={tree.path}>
                <strong>{tree.branch}</strong>
                <span>{tree.path}</span>
              </div>
            ))
          ) : (
            <p>No linked worktrees found yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
