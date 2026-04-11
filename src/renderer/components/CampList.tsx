import type { CampOverview } from "../../shared/types";

interface CampListProps {
  camp: CampOverview | null;
  onRefresh: () => void;
}

export function CampList({ camp, onRefresh }: CampListProps) {
  return (
    <section className="panel camp-list">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Camps</span>
          <h3>Current Glade</h3>
        </div>
        <button className="ghost-button" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      {camp ? (
        <button className="camp-card selected" type="button">
          <span className="camp-card__name">{camp.name}</span>
          <span className="camp-card__meta">{camp.rootPath}</span>
          <span className="camp-card__status">{camp.status}</span>
        </button>
      ) : (
        <div className="empty-state">
          <p>Reading the forest path...</p>
        </div>
      )}

      <div className="roadmap-note">
        <span className="eyebrow">Next</span>
        <p>Multi-camp browsing, merchants, and Codex-native telemetry will slot in here.</p>
      </div>
    </section>
  );
}

