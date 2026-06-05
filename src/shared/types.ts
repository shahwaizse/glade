export type AgentProvider = "codex" | "claude";
export type CheckSeverity = "pass" | "warn" | "fail";
export type ConnectorKind = "slack" | "notion";
export type ProjectStatus = "clean" | "dirty" | "untracked";
export type WorkItemSource = "manual" | "slack" | "notion";
export type WorkItemStatus = "inbox" | "ready" | "running" | "review" | "done";

export interface ConnectorConfig {
  enabled: boolean;
  scope: string;
}

export interface ProjectProfile {
  browserProfile: string;
  claudeCommand: string;
  codexCommand: string;
  expectedIdentity: string;
  expectedRemote: string;
  notion: ConnectorConfig;
  slack: ConnectorConfig;
  sshKeyPath: string;
}

export interface ProjectRecord {
  addedAt: string;
  id: string;
  lastOpenedAt: string;
  name: string;
  notes: string;
  profile: ProjectProfile;
  rootPath: string;
  workItems: WorkItem[];
}

export interface WorkItem {
  acceptanceCriteria: string;
  createdAt: string;
  id: string;
  source: WorkItemSource;
  sourceUrl: string;
  status: WorkItemStatus;
  title: string;
  updatedAt: string;
}

export interface PreflightCheck {
  detail: string;
  id: string;
  label: string;
  severity: CheckSeverity;
}

export interface WorktreeSummary {
  branch: string;
  isCurrent: boolean;
  path: string;
}

export interface ProjectOverview extends ProjectRecord {
  branch: string;
  gitEmail: string;
  gitName: string;
  originRemote: string;
  preflight: PreflightCheck[];
  status: ProjectStatus;
  worktrees: WorktreeSummary[];
}

export interface AppState {
  activeProjectId: string | null;
  projects: ProjectRecord[];
}

export interface ImportProjectInput {
  name?: string;
  rootPath: string;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  notes?: string;
  profile?: Partial<ProjectProfile>;
}

export interface CreateWorkItemInput {
  acceptanceCriteria?: string;
  projectId: string;
  source?: WorkItemSource;
  sourceUrl?: string;
  title: string;
}

export interface UpdateWorkItemInput {
  acceptanceCriteria?: string;
  id: string;
  projectId: string;
  sourceUrl?: string;
  status?: WorkItemStatus;
  title?: string;
}

export interface TerminalSessionSummary {
  cwd: string;
  id: string;
  projectId: string;
  startedAt: string;
}

export interface TerminalDataEvent {
  data: string;
  sessionId: string;
}

export interface TerminalExitEvent {
  exitCode: number;
  sessionId: string;
}

export interface CreateTerminalInput {
  agent?: AgentProvider | "shell";
  cols?: number;
  projectId: string;
  rows?: number;
}

export interface ResizeTerminalInput {
  cols: number;
  rows: number;
  sessionId: string;
}

export interface WriteTerminalInput {
  data: string;
  sessionId: string;
}
