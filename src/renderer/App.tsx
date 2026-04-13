import { startTransition, useEffect, useMemo, useState } from "react";
import { CampImporter } from "./components/CampImporter";
import { CampList } from "./components/CampList";
import { ChatPane } from "./components/ChatPane";
import { GladeVista } from "./components/GladeVista";
import { SessionConsole } from "./components/SessionConsole";
import { StatusPanel } from "./components/StatusPanel";
import { TavernPanel } from "./components/TavernPanel";
import { ThreadList } from "./components/ThreadList";
import type {
  CampOverview,
  CampRecord,
  CampRegistryState,
  CodexMessage,
  CodexThreadDetail,
  CodexThreadSummary,
  CreateCampInput,
} from "../shared/types";

type GladeOverlay = "camp" | "campfire" | "merchant" | "tavern" | null;

export default function App() {
  const [registry, setRegistry] = useState<CampRegistryState | null>(null);
  const [camp, setCamp] = useState<CampOverview | null>(null);
  const [threads, setThreads] = useState<CodexThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<CodexThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedOverlay, setSelectedOverlay] = useState<GladeOverlay>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRegistry() {
      try {
        const nextRegistry = await window.glade.getCampRegistry();
        if (!cancelled) {
          setRegistry(nextRegistry);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load camps");
        }
      }
    }

    void loadRegistry();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    const activeCampId = registry?.activeCampId;

    if (!activeCampId) {
      setCamp(null);
      return;
    }

    async function loadCampOverview() {
      try {
        const overview = await window.glade.getCampOverview(activeCampId);
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

    void loadCampOverview();

    return () => {
      cancelled = true;
    };
  }, [registry?.activeCampId]);

  useEffect(() => {
    let cancelled = false;
    const cwd = camp?.rootPath;

    async function loadThreads() {
      try {
        const nextThreads = await window.glade.getCodexThreads(cwd);
        if (!cancelled) {
          startTransition(() => {
            setThreads(nextThreads);
            setActiveThreadId((current) =>
              current && nextThreads.some((thread) => thread.id === current)
                ? current
              : (nextThreads[0]?.id ?? null),
            );
          });
          setChatError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load Codex threads");
        }
      }
    }

    void loadThreads();

    return () => {
      cancelled = true;
    };
  }, [camp?.rootPath, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    if (!activeThreadId) {
      setActiveThread(null);
      return;
    }

    async function loadThread() {
      try {
        const detail = await window.glade.getCodexThread(activeThreadId);
        if (!cancelled) {
          setActiveThread(detail);
          setChatError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load thread");
        }
      }
    }

    void loadThread();

    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  const activeRecord = useMemo<CampRecord | null>(() => {
    if (!registry?.activeCampId) {
      return null;
    }

    return registry.camps.find((entry) => entry.id === registry.activeCampId) ?? null;
  }, [registry]);

  const subtitle = useMemo(() => {
    if (!camp) {
      return registry?.camps.length
        ? "Choose a camp and pick up the thread"
        : "Bring your first camp into the glade";
    }

    return `${camp.branch} branch • ${threads.length} archived thread${threads.length === 1 ? "" : "s"} • ${camp.environment}`;
  }, [camp, registry?.camps.length, threads.length]);

  async function handleAddCamp(input: CreateCampInput) {
    setImportError(null);
    setIsImporting(true);

    try {
      const nextRegistry = await window.glade.addCamp(input);
      setRegistry(nextRegistry);
      return true;
    } catch (addError) {
      setImportError(addError instanceof Error ? addError.message : "Failed to add camp");
      return false;
    } finally {
      setIsImporting(false);
    }
  }

  async function handleSelectCamp(campId: string) {
    try {
      const nextRegistry = await window.glade.setActiveCamp(campId);
      setRegistry(nextRegistry);
      setError(null);
      setSelectedOverlay("camp");
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "Failed to switch camps");
    }
  }

  async function handleRemoveCamp(campId: string) {
    try {
      const nextRegistry = await window.glade.removeCamp(campId);
      setRegistry(nextRegistry);
      setError(null);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove camp");
    }
  }

  async function handleSendMessage(prompt: string) {
    if (!camp) {
      return;
    }

    setChatError(null);
    const optimisticUserMessage: CodexMessage = {
      id: `local-user-${Date.now()}`,
      phase: null,
      role: "user",
      text: prompt,
      timestamp: new Date().toISOString(),
    };
    setIsSending(true);
    setActiveThread((current) =>
      current
        ? { ...current, messages: [...current.messages, optimisticUserMessage] }
        : null,
    );

    try {
      const reply = await window.glade.sendCodexMessage({
        cwd: camp.rootPath,
        environment: camp.environment,
        prompt,
        threadId: activeThread?.id,
        wslDistro: camp.wslDistro,
      });

      const assistantMessage: CodexMessage = {
        id: `local-assistant-${Date.now()}`,
        phase: "final",
        role: "assistant",
        text: reply.response,
        timestamp: new Date().toISOString(),
      };

      setActiveThread((current) => {
        if (!current) {
          const fallbackTitle = prompt.replace(/\s+/g, " ").trim().slice(0, 88) || camp.name;
          return {
            cwd: camp.rootPath,
            id: reply.threadId,
            messageCount: 2,
            messages: [optimisticUserMessage, assistantMessage],
            source: "glade",
            title: fallbackTitle,
            updatedAt: assistantMessage.timestamp,
          };
        }

        return {
          ...current,
          id: reply.threadId,
          messageCount: current.messages.length + 1,
          messages: [...current.messages, assistantMessage],
          updatedAt: assistantMessage.timestamp,
        };
      });

      setActiveThreadId(reply.threadId);
      setRefreshKey((value) => value + 1);
    } catch (sendError) {
      setChatError(sendError instanceof Error ? sendError.message : "Failed to send message to Codex");
    } finally {
      setIsSending(false);
    }
  }

  function openFeatureOverlay(feature: "campfire" | "merchant" | "tavern") {
    setSelectedOverlay(feature);
  }

  function closeOverlay() {
    setSelectedOverlay(null);
  }

  function renderOverlay() {
    if (selectedOverlay === "camp") {
      return (
        <aside className="world-overlay world-overlay--camp">
          <div className="world-overlay__header">
            <div>
              <span className="eyebrow">Camp Ledger</span>
              <h3>{activeRecord?.name ?? "Camp roster"}</h3>
            </div>
            <button className="ghost-button" onClick={closeOverlay} type="button">
              Close
            </button>
          </div>

          <div className="world-overlay__scroll">
            <CampList
              activeCampId={registry?.activeCampId ?? null}
              camps={registry?.camps ?? []}
              onRefresh={() => setRefreshKey((value) => value + 1)}
              onRemoveCamp={handleRemoveCamp}
              onSelectCamp={handleSelectCamp}
            />
            <ThreadList
              activeThreadId={activeThreadId}
              onRefresh={() => setRefreshKey((value) => value + 1)}
              onSelectThread={(threadId) => {
                setActiveThreadId(threadId);
                setSelectedOverlay("campfire");
              }}
              threads={threads}
            />
            <CampImporter
              error={importError}
              host={registry?.host ?? null}
              isImporting={isImporting}
              onAddCamp={handleAddCamp}
              onPickFolder={() => window.glade.pickCampDirectory()}
            />
          </div>
        </aside>
      );
    }

    if (selectedOverlay === "campfire") {
      return (
        <aside className="world-overlay world-overlay--campfire">
          <div className="world-overlay__header">
            <div>
              <span className="eyebrow">Campfire</span>
              <h3>{activeRecord?.name ?? "No active camp"}</h3>
            </div>
            <button className="ghost-button" onClick={closeOverlay} type="button">
              Close
            </button>
          </div>

          <div className="world-overlay__scroll">
            <div className="campfire-overlay">
              <div className="campfire-overlay__threads">
                <ThreadList
                  activeThreadId={activeThreadId}
                  onRefresh={() => setRefreshKey((value) => value + 1)}
                  onSelectThread={setActiveThreadId}
                  threads={threads}
                />
              </div>
              <div className="campfire-overlay__chat">
                <ChatPane
                  camp={camp}
                  error={chatError}
                  isSending={isSending}
                  onSendMessage={handleSendMessage}
                  thread={activeThread}
                />
              </div>
            </div>
          </div>
        </aside>
      );
    }

    if (selectedOverlay === "merchant") {
      return (
        <aside className="world-overlay world-overlay--merchant">
          <div className="world-overlay__header">
            <div>
              <span className="eyebrow">Merchant</span>
              <h3>Services & tools</h3>
            </div>
            <button className="ghost-button" onClick={closeOverlay} type="button">
              Close
            </button>
          </div>

          <div className="world-overlay__scroll">
            <StatusPanel camp={camp} host={registry?.host ?? null} />
            <SessionConsole camp={camp} compact />
          </div>
        </aside>
      );
    }

    if (selectedOverlay === "tavern") {
      return (
        <aside className="world-overlay world-overlay--tavern">
          <div className="world-overlay__header">
            <div>
              <span className="eyebrow">Tavern</span>
              <h3>Tonight's soundtrack</h3>
            </div>
            <button className="ghost-button" onClick={closeOverlay} type="button">
              Close
            </button>
          </div>

          <div className="world-overlay__scroll">
            <TavernPanel />
          </div>
        </aside>
      );
    }

    return null;
  }

  return (
    <div className="world-shell">
      <div className="mist-layer" />
      <header className="world-topbar">
        <div className="world-topbar__brand">
          <span className="brand-kicker">Self-hosting starts here</span>
          <h2>Glade</h2>
          <p>{subtitle}</p>
        </div>
        <div className="world-topbar__actions">
          {chatError ? <div className="world-toast">{chatError}</div> : null}
          {error ? <div className="world-toast world-toast--danger">{error}</div> : null}
        </div>
      </header>

      <main className="world-stage">
        <GladeVista
          activeCampId={registry?.activeCampId ?? null}
          camp={camp}
          camps={registry?.camps ?? []}
          onSelectCamp={handleSelectCamp}
          onSelectFeature={openFeatureOverlay}
          threadCount={threads.length}
        />
      </main>

      {selectedOverlay ? <div className="world-backdrop" onClick={closeOverlay} /> : null}
      {renderOverlay()}
    </div>
  );
}
