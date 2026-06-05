import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { TerminalPane } from "./TerminalPane";
import type {
  AgentProvider,
  AppState,
  CheckSeverity,
  ProjectOverview,
  ProjectProfile,
  WorkItemStatus,
} from "../shared/types";

const workStatuses: WorkItemStatus[] = ["inbox", "ready", "running", "review", "done"];

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [project, setProject] = useState<ProjectOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [draftPath, setDraftPath] = useState("");
  const [draftName, setDraftName] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [workCriteria, setWorkCriteria] = useState("");
  const [terminalAgent, setTerminalAgent] = useState<AgentProvider | "shell">("shell");
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (localStorage.getItem("glade-theme") as "dark" | "light" | null) ?? "dark",
  );

  useEffect(() => {
    void refreshState();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("glade-theme", theme);
  }, [theme]);

  useEffect(() => {
    void refreshProject(state?.activeProjectId ?? undefined);
  }, [state?.activeProjectId]);

  const preflightTotals = useMemo(() => {
    const checks = project?.preflight ?? [];
    return {
      fail: checks.filter((check) => check.severity === "fail").length,
      pass: checks.filter((check) => check.severity === "pass").length,
      warn: checks.filter((check) => check.severity === "warn").length,
    };
  }, [project?.preflight]);

  async function refreshState() {
    try {
      setState(await api.getAppState());
      setError(null);
    } catch (loadError) {
      setError(toMessage(loadError));
    }
  }

  async function refreshProject(projectId?: string) {
    try {
      setProject(await api.getProjectOverview(projectId));
      setError(null);
    } catch (loadError) {
      setError(toMessage(loadError));
    }
  }

  async function importProject() {
    if (!draftPath.trim()) {
      return;
    }

    setIsImporting(true);
    try {
      const nextState = await api.importProject({
        name: draftName.trim() || undefined,
        rootPath: draftPath.trim(),
      });
      setState(nextState);
      setDraftName("");
      setDraftPath("");
      setError(null);
    } catch (importError) {
      setError(toMessage(importError));
    } finally {
      setIsImporting(false);
    }
  }

  async function selectProject(projectId: string) {
    try {
      setState(await api.setActiveProject(projectId));
      setError(null);
    } catch (selectionError) {
      setError(toMessage(selectionError));
    }
  }

  async function updateProfile(profile: Partial<ProjectProfile>) {
    if (!project) {
      return;
    }

    try {
      setProject(await api.updateProject({ id: project.id, profile }));
      void refreshState();
      setError(null);
    } catch (updateError) {
      setError(toMessage(updateError));
    }
  }

  async function updateNotes(notes: string) {
    if (!project) {
      return;
    }

    setProject({ ...project, notes });
    try {
      setProject(await api.updateProject({ id: project.id, notes }));
      setError(null);
    } catch (updateError) {
      setError(toMessage(updateError));
    }
  }

  async function addWorkItem() {
    if (!project || !workTitle.trim()) {
      return;
    }

    try {
      setProject(await api.addWorkItem({
        acceptanceCriteria: workCriteria,
        projectId: project.id,
        title: workTitle,
      }));
      setWorkTitle("");
      setWorkCriteria("");
      setError(null);
    } catch (workError) {
      setError(toMessage(workError));
    }
  }

  async function updateWorkStatus(id: string, status: WorkItemStatus) {
    if (!project) {
      return;
    }

    try {
      setProject(await api.updateWorkItem({ id, projectId: project.id, status }));
      setError(null);
    } catch (workError) {
      setError(toMessage(workError));
    }
  }

  return (
    <div className="app-shell">
      <aside className="project-rail">
        <div className="brand">
          <span>Local software factory</span>
          <h1>Glade</h1>
          <button
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            type="button"
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>

        <section className="panel import-panel">
          <div className="panel-title">
            <span>Import</span>
            <strong>Existing repo</strong>
          </div>
          <label className="field">
            <span>Repo path</span>
            <input value={draftPath} onChange={(event) => setDraftPath(event.target.value)} placeholder="/path/to/repo" />
          </label>
          <label className="field">
            <span>Name</span>
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Optional" />
          </label>
          <div className="row">
            <button className="button primary" disabled={isImporting || !draftPath.trim()} onClick={() => void importProject()} type="button">
              {isImporting ? "Importing" : "Import"}
            </button>
          </div>
        </section>

        <section className="panel project-list">
          <div className="panel-title">
            <span>Projects</span>
            <strong>{state?.projects.length ?? 0} registered</strong>
          </div>
          <div className="stack">
            {state?.projects.map((entry) => (
              <button
                className={`project-card ${entry.id === state.activeProjectId ? "active" : ""}`}
                key={entry.id}
                onClick={() => void selectProject(entry.id)}
                type="button"
              >
                <strong>{entry.name}</strong>
                <span>{entry.rootPath}</span>
              </button>
            ))}
            {state?.projects.length === 0 ? <p className="muted">Import a preconfigured Git repo to begin.</p> : null}
          </div>
        </section>
      </aside>

      <main className="workspace">
        {project ? (
          <>
            <header className="hero">
              <div>
                <span className="kicker">Project command center</span>
                <h2>{project.name}</h2>
                <p>{project.rootPath}</p>
              </div>
              <div className="identity-strip">
                <Metric label="Branch" value={project.branch} />
                <Metric label="Status" value={project.status} />
                <Metric label="Git user" value={project.gitEmail || project.gitName || "missing"} />
                <Metric label="Preflight" value={`${preflightTotals.fail} fail / ${preflightTotals.warn} warn`} tone={preflightTotals.fail ? "bad" : preflightTotals.warn ? "warn" : "good"} />
              </div>
            </header>

            {error ? <div className="toast">{error}</div> : null}

            <div className="grid">
              <section className="panel span-2">
                <div className="panel-title">
                  <span>Isolation</span>
                  <strong>Preflight checks</strong>
                </div>
                <div className="check-grid">
                  {project.preflight.map((check) => (
                    <div className={`check-card ${check.severity}`} key={check.id}>
                      <span>{labelForSeverity(check.severity)}</span>
                      <strong>{check.label}</strong>
                      <p>{check.detail}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel-title">
                  <span>Agents</span>
                  <strong>Launch target</strong>
                </div>
                <div className="segmented">
                  {(["shell", "codex", "claude"] as const).map((agent) => (
                    <button className={terminalAgent === agent ? "selected" : ""} key={agent} onClick={() => setTerminalAgent(agent)} type="button">
                      {agent}
                    </button>
                  ))}
                </div>
                <div className="command-grid">
                  <label className="field">
                    <span>Codex command</span>
                    <input value={project.profile.codexCommand} onChange={(event) => void updateProfile({ codexCommand: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Claude command</span>
                    <input value={project.profile.claudeCommand} onChange={(event) => void updateProfile({ claudeCommand: event.target.value })} />
                  </label>
                </div>
              </section>

              <section className="panel">
                <div className="panel-title">
                  <span>Project profile</span>
                  <strong>Identity config</strong>
                </div>
                <div className="stack">
                  <label className="field">
                    <span>Expected identity marker</span>
                    <input value={project.profile.expectedIdentity} onChange={(event) => void updateProfile({ expectedIdentity: event.target.value })} placeholder="email, org, account, or name" />
                  </label>
                  <label className="field">
                    <span>Expected Git remote</span>
                    <input value={project.profile.expectedRemote} onChange={(event) => void updateProfile({ expectedRemote: event.target.value })} placeholder="git@github.com:org/repo.git" />
                  </label>
                  <label className="field">
                    <span>SSH key path</span>
                    <input value={project.profile.sshKeyPath} onChange={(event) => void updateProfile({ sshKeyPath: event.target.value })} placeholder="/home/me/.ssh/project_key" />
                  </label>
                  <label className="field">
                    <span>Chrome profile</span>
                    <input value={project.profile.browserProfile} onChange={(event) => void updateProfile({ browserProfile: event.target.value })} placeholder="Profile path or exact label" />
                  </label>
                </div>
              </section>

              <section className="panel">
                <div className="panel-title">
                  <span>Intake</span>
                  <strong>Manual work item</strong>
                </div>
                <div className="stack">
                  <label className="field">
                    <span>Title</span>
                    <input value={workTitle} onChange={(event) => setWorkTitle(event.target.value)} placeholder="Implement billing event audit log" />
                  </label>
                  <label className="field">
                    <span>Acceptance criteria</span>
                    <textarea value={workCriteria} onChange={(event) => setWorkCriteria(event.target.value)} placeholder="What must be true when this is done?" />
                  </label>
                  <button className="button primary" disabled={!workTitle.trim()} onClick={() => void addWorkItem()} type="button">Add item</button>
                </div>
              </section>

              <section className="panel">
                <div className="panel-title">
                  <span>Connectors</span>
                  <strong>Scoped sources</strong>
                </div>
                <ConnectorEditor
                  enabled={project.profile.slack.enabled}
                  label="Slack"
                  scope={project.profile.slack.scope}
                  onChange={(slack) => void updateProfile({ slack })}
                />
                <ConnectorEditor
                  enabled={project.profile.notion.enabled}
                  label="Notion"
                  scope={project.profile.notion.scope}
                  onChange={(notion) => void updateProfile({ notion })}
                />
              </section>

              <section className="panel span-2">
                <div className="panel-title">
                  <span>Inbox</span>
                  <strong>{project.workItems.length} work items</strong>
                </div>
                <div className="work-list">
                  {project.workItems.map((item) => (
                    <article className="work-card" key={item.id}>
                      <div>
                        <span>{item.source}</span>
                        <strong>{item.title}</strong>
                        {item.acceptanceCriteria ? <p>{item.acceptanceCriteria}</p> : null}
                      </div>
                      <select value={item.status} onChange={(event) => void updateWorkStatus(item.id, event.target.value as WorkItemStatus)}>
                        {workStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </article>
                  ))}
                  {project.workItems.length === 0 ? <p className="muted">No work items yet. Add one manually, then wire Slack/Notion intake later.</p> : null}
                </div>
              </section>

              <section className="panel">
                <div className="panel-title">
                  <span>Notes</span>
                  <strong>Agent context</strong>
                </div>
                <textarea className="notes" value={project.notes} onChange={(event) => void updateNotes(event.target.value)} placeholder="Project-specific context, architecture rules, preferences, and gotchas." />
              </section>

              <section className="panel terminal-panel span-3">
                <div className="panel-title">
                  <span>Runtime</span>
                  <strong>{terminalAgent} session</strong>
                </div>
                <TerminalPane agent={terminalAgent} project={project} />
              </section>
            </div>
          </>
        ) : (
          <div className="empty-screen">
            <span className="kicker">No project selected</span>
            <h2>Import an existing repo to start the factory.</h2>
            {error ? <div className="toast">{error}</div> : null}
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({ label, tone, value }: { label: string; tone?: "good" | "warn" | "bad"; value: string }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConnectorEditor({
  enabled,
  label,
  onChange,
  scope,
}: {
  enabled: boolean;
  label: string;
  onChange: (value: { enabled: boolean; scope: string }) => void;
  scope: string;
}) {
  return (
    <div className="connector">
      <label className="toggle">
        <input checked={enabled} onChange={(event) => onChange({ enabled: event.target.checked, scope })} type="checkbox" />
        <span>{label}</span>
      </label>
      <textarea
        disabled={!enabled}
        onChange={(event) => onChange({ enabled, scope: event.target.value })}
        placeholder="Allowed workspace, channels, pages, databases, or search scope"
        value={scope}
      />
    </div>
  );
}

function labelForSeverity(severity: CheckSeverity) {
  if (severity === "pass") {
    return "Pass";
  }
  if (severity === "warn") {
    return "Needs config";
  }
  return "Blocked";
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
