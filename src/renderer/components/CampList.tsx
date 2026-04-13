import type { CampRecord } from "../../shared/types";

interface CampListProps {
  activeCampId: string | null;
  camps: CampRecord[];
  onRefresh: () => void;
  onRemoveCamp: (campId: string) => void;
  onSelectCamp: (campId: string) => void;
}

export function CampList({
  activeCampId,
  camps,
  onRefresh,
  onRemoveCamp,
  onSelectCamp,
}: CampListProps) {
  return (
    <section className="panel camp-list">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Camps</span>
          <h3>Camp Roster</h3>
        </div>
        <button className="ghost-button" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      {camps.length ? (
        <div className="camp-card-list">
          {camps.map((camp) => (
            <div
              className={`camp-card ${camp.id === activeCampId ? "selected" : ""}`}
              key={camp.id}
            >
              <button className="camp-card__button" onClick={() => onSelectCamp(camp.id)} type="button">
                <span className="camp-card__name">{camp.name}</span>
                <span className="camp-card__meta">{camp.rootPath}</span>
                <span className="camp-card__status">
                  {camp.environment}
                  {camp.wslDistro ? ` • ${camp.wslDistro}` : ""}
                </span>
              </button>

              {camp.id === activeCampId ? null : (
                <button
                  className="danger-button"
                  onClick={() => onRemoveCamp(camp.id)}
                  type="button"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No camps yet. Import any existing git repo to get started.</p>
        </div>
      )}
    </section>
  );
}
