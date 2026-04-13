import type { CampOverview, CampRecord } from "../../shared/types";
import { PixiGladeWorld } from "./PixiGladeWorld";

interface GladeVistaProps {
  activeCampId: string | null;
  camp: CampOverview | null;
  camps: CampRecord[];
  onSelectFeature: (feature: "campfire" | "merchant" | "tavern") => void;
  onSelectCamp: (campId: string) => void;
  threadCount: number;
}

export function GladeVista({
  activeCampId,
  camp,
  camps,
  onSelectFeature,
  onSelectCamp,
  threadCount,
}: GladeVistaProps) {
  const visibleCamps = camps.slice(0, 5);

  return (
    <section className="glade-vista glade-vista--world">
      <div className="glade-vista__hud">
        <div className="glade-vista__title">
          <span className="eyebrow">The Glade</span>
          <h1>Glade</h1>
          <p>{camp ? `${camp.name} is active in the clearing.` : "Choose a place in the clearing."}</p>
        </div>
        <div className="glade-vista__chips">
          <span className="vista-chip">{visibleCamps.length} camps</span>
          <span className="vista-chip">{threadCount} threads</span>
          <span className="vista-chip">{camp?.worktrees.length ?? 0} trees</span>
        </div>
      </div>

      <div className="glade-vista__stage">
        <div className="glade-vista__aurora" />
        <div className="glade-vista__mist" />
        <PixiGladeWorld
          activeCampId={activeCampId}
          camp={camp}
          camps={visibleCamps}
          onSelectFeature={onSelectFeature}
          onSelectCamp={onSelectCamp}
        />

        <div className="glade-vista__story">
          <p>
            Glade is starting to become a world instead of a window: each repo is a camp,
            the campfire is your live thread, the Tavern carries the music, and the Merchant
            is waiting for tools and servers.
          </p>
        </div>
      </div>
    </section>
  );
}
