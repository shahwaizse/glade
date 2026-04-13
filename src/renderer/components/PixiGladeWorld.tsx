import { useEffect, useMemo, useRef } from "react";
import type { CampOverview, CampRecord } from "../../shared/types";
import campSpriteUrl from "../assets/world/camp-sprite.svg?url";
import campfireSpriteUrl from "../assets/world/campfire-sprite.svg?url";
import floorTextureUrl from "../assets/world/glade-floor.svg?url";
import merchantSpriteUrl from "../assets/world/merchant-sprite.svg?url";
import tavernSpriteUrl from "../assets/world/tavern-sprite.svg?url";

interface PixiGladeWorldProps {
  activeCampId: string | null;
  camp: CampOverview | null;
  camps: CampRecord[];
  onSelectFeature: (feature: "campfire" | "merchant" | "tavern") => void;
  onSelectCamp: (campId: string) => void;
}

interface WorldNode {
  id: string;
  kind: "camp" | "campfire" | "merchant" | "tavern";
  x: number;
  y: number;
  subtitle: string;
  title: string;
}

const CAMP_POSITIONS = [
  { x: 16, y: 62 },
  { x: 27, y: 35 },
  { x: 46, y: 66 },
  { x: 60, y: 31 },
  { x: 78, y: 58 },
];

export function PixiGladeWorld({
  activeCampId,
  camp,
  camps,
  onSelectFeature,
  onSelectCamp,
}: PixiGladeWorldProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const worldNodes = useMemo<WorldNode[]>(() => {
    const campNodes = camps.slice(0, CAMP_POSITIONS.length).map((entry, index) => ({
      id: entry.id,
      kind: "camp" as const,
      subtitle: entry.environment,
      title: entry.name,
      x: CAMP_POSITIONS[index]?.x ?? 50,
      y: CAMP_POSITIONS[index]?.y ?? 50,
    }));

    return [
      {
        id: "merchant",
        kind: "merchant",
        subtitle: "MCP wares soon",
        title: "Merchant",
        x: 20,
        y: 30,
      },
      {
        id: "campfire",
        kind: "campfire",
        subtitle: camp?.name ?? "Choose a camp",
        title: "Campfire",
        x: 52,
        y: 50,
      },
      {
        id: "tavern",
        kind: "tavern",
        subtitle: "Spotify & atmosphere",
        title: "Tavern",
        x: 82,
        y: 28,
      },
      ...campNodes,
    ];
  }, [camp?.name, camps]);

  useEffect(() => {
    let disposed = false;
    let cleanupTicker: (() => void) | null = null;
    let pixiApp: { destroy: (removeView?: boolean, stageOptions?: unknown) => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function boot() {
      if (!mountRef.current) {
        return;
      }

      const pixi = await import("pixi.js");
      if (disposed || !mountRef.current) {
        return;
      }

      const {
        Application,
        Assets,
        BlurFilter,
        Container,
        Graphics,
        Sprite,
        Texture,
      } = pixi;

      const [
        floorTexture,
        campTexture,
        campfireTexture,
        merchantTexture,
        tavernTexture,
      ] = (await Promise.all([
        Assets.load(floorTextureUrl),
        Assets.load(campSpriteUrl),
        Assets.load(campfireSpriteUrl),
        Assets.load(merchantSpriteUrl),
        Assets.load(tavernSpriteUrl),
      ])) as Array<InstanceType<typeof Texture>>;

      const app = new Application();
      await app.init({
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        preference: "webgl",
        resizeTo: mountRef.current,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });

      if (disposed || !mountRef.current) {
        app.destroy(true);
        return;
      }

      mountRef.current.appendChild(app.canvas);
      app.canvas.classList.add("glade-world-canvas__surface");
      pixiApp = app;

      const root = new Container();
      const ambientLayer = new Container();
      const detailLayer = new Container();
      const markerLayer = new Container();
      app.stage.addChild(root);
      root.addChild(ambientLayer, detailLayer, markerLayer);

      const particles: Array<{
        drift: number;
        graphic: InstanceType<typeof Graphics>;
        phase: number;
        speed: number;
      }> = [];
      const livelyNodes: Array<{
        amplitude: number;
        baseScale: number;
        baseY: number;
        glow?: InstanceType<typeof Graphics>;
        node: WorldNode;
        phase: number;
        shadow: InstanceType<typeof Graphics>;
        speed: number;
        sprite: InstanceType<typeof Sprite>;
        spriteRoot: InstanceType<typeof Container>;
      }> = [];

      const drawIsoDiamond = (
        graphics: InstanceType<typeof Graphics>,
        x: number,
        y: number,
        width: number,
        height: number,
        color: number,
        alpha = 1,
      ) => {
        graphics.beginFill(color, alpha);
        graphics.drawPolygon([
          x,
          y - height / 2,
          x + width / 2,
          y,
          x,
          y + height / 2,
          x - width / 2,
          y,
        ]);
        graphics.endFill();
      };

      const renderScene = () => {
        particles.length = 0;
        livelyNodes.length = 0;
        ambientLayer.removeChildren().forEach((child) => child.destroy());
        detailLayer.removeChildren().forEach((child) => child.destroy());
        markerLayer.removeChildren().forEach((child) => child.destroy());

        const width = app.screen.width;
        const height = app.screen.height;
        const centerX = width / 2;
        const centerY = height / 2 + 16;
        const floorWidth = Math.min(width * 0.58, 840);
        const floorHeight = floorWidth * (640 / 1024);

        const haloLeft = new Graphics();
        haloLeft.beginFill(0x9ecc7a, 0.08);
        haloLeft.drawCircle(width * 0.18, height * 0.16, 150);
        haloLeft.endFill();
        haloLeft.filters = [new BlurFilter({ strength: 28 })];
        ambientLayer.addChild(haloLeft);

        const haloRight = new Graphics();
        haloRight.beginFill(0xf0c97d, 0.06);
        haloRight.drawCircle(width * 0.82, height * 0.18, 130);
        haloRight.endFill();
        haloRight.filters = [new BlurFilter({ strength: 24 })];
        ambientLayer.addChild(haloRight);

        const worldVignette = new Graphics();
        worldVignette.beginFill(0x000000, 0.18);
        worldVignette.drawEllipse(centerX, centerY + floorHeight * 0.34, floorWidth * 0.5, floorHeight * 0.24);
        worldVignette.endFill();
        worldVignette.filters = [new BlurFilter({ strength: 28 })];
        ambientLayer.addChild(worldVignette);

        const floorSprite = new Sprite(floorTexture);
        floorSprite.anchor.set(0.5);
        floorSprite.position.set(centerX, centerY);
        floorSprite.width = floorWidth;
        floorSprite.height = floorHeight;
        floorSprite.alpha = 0.98;
        detailLayer.addChild(floorSprite);

        const floorAura = new Graphics();
        drawIsoDiamond(floorAura, centerX, centerY + 2, floorWidth * 0.72, floorHeight * 0.46, 0xcdb66a, 0.05);
        floorAura.filters = [new BlurFilter({ strength: 18 })];
        detailLayer.addChild(floorAura);

        const clearingEdge = new Graphics();
        clearingEdge.lineStyle(2, 0x9ab96e, 0.08);
        clearingEdge.drawEllipse(centerX, centerY + floorHeight * 0.08, floorWidth * 0.38, floorHeight * 0.14);
        detailLayer.addChild(clearingEdge);

        for (let index = 0; index < 26; index += 1) {
          const mote = new Graphics();
          const x = width * 0.14 + ((width * 0.72) / 26) * index + Math.sin(index * 0.7) * 10;
          const y = height * 0.2 + (index % 6) * 18;
          mote.beginFill(index % 3 === 0 ? 0xd7c67e : 0x8bcf6f, 0.18);
          mote.drawCircle(0, 0, 2 + (index % 3));
          mote.endFill();
          mote.position.set(x, y);
          ambientLayer.addChild(mote);
          particles.push({
            drift: 5 + (index % 5),
            graphic: mote,
            phase: index * 0.5,
            speed: 0.007 + (index % 4) * 0.0012,
          });
        }

        worldNodes.forEach((node, index) => {
          const x = (node.x / 100) * width;
          const y = (node.y / 100) * height;
          const spriteRoot = new Container();
          spriteRoot.position.set(x, y);
          markerLayer.addChild(spriteRoot);

          const shadow = new Graphics();
          shadow.beginFill(0x000000, 0.24);
          shadow.drawEllipse(0, 30, node.kind === "campfire" ? 26 : 30, node.kind === "campfire" ? 9 : 11);
          shadow.endFill();
          shadow.filters = [new BlurFilter({ strength: 8 })];
          spriteRoot.addChild(shadow);

          const footing = new Graphics();
          const footingColor =
            node.kind === "campfire"
              ? 0x6b5b26
              : node.kind === "merchant"
                ? 0x455526
                : node.kind === "tavern"
                  ? 0x3b4727
                  : node.id === activeCampId
                    ? 0x596d31
                    : 0x304528;
          drawIsoDiamond(footing, 0, 10, node.kind === "camp" ? 92 : 84, node.kind === "camp" ? 44 : 40, footingColor, 0.9);
          footing.lineStyle(node.id === activeCampId ? 2 : 1, 0xd8c57d, node.id === activeCampId ? 0.38 : 0.12);
          footing.drawPolygon([0, -10, 42, 10, 0, 30, -42, 10]);
          spriteRoot.addChild(footing);

          let glow: InstanceType<typeof Graphics> | undefined;
          if (node.kind === "campfire" || node.kind === "tavern" || node.kind === "merchant") {
            glow = new Graphics();
            const glowColor =
              node.kind === "campfire" ? 0xffc56d : node.kind === "tavern" ? 0xd39561 : 0xe2c972;
            glow.beginFill(glowColor, node.kind === "campfire" ? 0.18 : 0.1);
            glow.drawCircle(0, node.kind === "campfire" ? -6 : -4, node.kind === "campfire" ? 32 : 24);
            glow.endFill();
            glow.filters = [new BlurFilter({ strength: node.kind === "campfire" ? 16 : 12 })];
            spriteRoot.addChild(glow);
          }

          const spriteTexture =
            node.kind === "campfire"
              ? campfireTexture
              : node.kind === "merchant"
                ? merchantTexture
                : node.kind === "tavern"
                  ? tavernTexture
                  : campTexture;

          const sprite = new Sprite(spriteTexture);
          sprite.anchor.set(0.5, 0.82);
          const spriteWidth =
            node.kind === "campfire"
              ? 104
              : node.kind === "tavern"
                ? 120
                : node.kind === "merchant"
                  ? 100
                  : 110;
          const baseScale = spriteWidth / spriteTexture.width;
          sprite.scale.set(baseScale);
          sprite.position.set(0, 12);
          sprite.alpha = node.kind === "camp" && node.id !== activeCampId ? 0.96 : 1;
          spriteRoot.addChild(sprite);

          livelyNodes.push({
            amplitude: node.kind === "campfire" ? 2.8 : node.kind === "tavern" ? 1.7 : 1.2,
            baseScale,
            baseY: y,
            glow,
            node,
            phase: index * 0.75,
            shadow,
            speed: node.kind === "campfire" ? 0.009 : 0.0042,
            sprite,
            spriteRoot,
          });
        });
      };

      renderScene();

      resizeObserver = new ResizeObserver(() => {
        renderScene();
      });
      resizeObserver.observe(mountRef.current);

      cleanupTicker = () => {
        app.ticker.stop();
      };

      app.ticker.add((ticker) => {
        const elapsed = ticker.lastTime;

        particles.forEach((particle) => {
          const offset = Math.sin(elapsed * particle.speed + particle.phase) * particle.drift;
          particle.graphic.alpha = 0.08 + (Math.sin(elapsed * particle.speed + particle.phase) + 1) * 0.14;
          particle.graphic.y += Math.cos(elapsed * particle.speed + particle.phase) * 0.03;
          particle.graphic.x += offset * 0.002;
        });

        livelyNodes.forEach((entry, index) => {
          const bob = Math.sin(elapsed * entry.speed + entry.phase) * entry.amplitude;
          const pulse = 0.92 + Math.sin(elapsed * 0.005 + entry.phase) * 0.04;
          entry.spriteRoot.y = entry.baseY + bob;
          entry.sprite.scale.set(entry.baseScale * pulse);
          entry.shadow.scale.set(1 + Math.abs(bob) * 0.012, 1 + Math.abs(bob) * 0.008);
          entry.shadow.alpha =
            entry.node.kind === "campfire"
              ? 0.2 + Math.abs(bob) * 0.012
              : 0.18 + Math.abs(bob) * 0.01;

          if (entry.glow) {
            const glowPulse =
              entry.node.kind === "campfire"
                ? 0.22 + Math.sin(elapsed * 0.014 + index) * 0.08
                : 0.08 + Math.sin(elapsed * 0.006 + index) * 0.03;
            entry.glow.alpha = glowPulse;
            entry.glow.scale.set(0.92 + glowPulse * 0.3);
          }
        });
      });
    }

    void boot();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      cleanupTicker?.();
      pixiApp?.destroy(true, { children: true });
    };
  }, [activeCampId, camp?.name, camps, worldNodes]);

  return (
    <div className="glade-world-canvas">
      <div className="glade-world-canvas__mount" ref={mountRef} />

      <div className="glade-world-overlay">
        {worldNodes.map((node) => {
          const isCamp = node.kind === "camp";
          const isActive = node.id === activeCampId;

          if (isCamp) {
            return (
              <button
                className={`world-node world-node--camp ${isActive ? "world-node--active" : ""}`}
                key={node.id}
                onClick={() => onSelectCamp(node.id)}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                type="button"
              >
                <div className="world-node__label">
                  <strong>{node.title}</strong>
                  <span>{node.subtitle}</span>
                </div>
              </button>
            );
          }

          return (
            <button
              className={`world-node world-node--${node.kind}`}
              key={node.id}
              onClick={() => onSelectFeature(node.kind)}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              type="button"
            >
              <div className="world-node__label">
                <strong>{node.title}</strong>
                <span>{node.subtitle}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
