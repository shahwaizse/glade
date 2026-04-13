export type CampStatus = "active" | "resting" | "untracked";
export type CampEnvironment = "native" | "wsl";
export type HostPlatform = "linux" | "macos" | "windows";
export type CodexMessageRole = "user" | "assistant";

export interface WorktreeSummary {
  branch: string;
  isCurrent: boolean;
  path: string;
}

export interface TokenLedger {
  completion: number;
  prompt: number;
  total: number;
}

export interface CampRecord {
  addedAt: string;
  environment: CampEnvironment;
  id: string;
  lastOpenedAt: string;
  name: string;
  rootPath: string;
  wslDistro: string | null;
}

export interface CampOverview extends CampRecord {
  branch: string;
  mcpServers: string[];
  status: CampStatus;
  tokenLedger: TokenLedger;
  worktrees: WorktreeSummary[];
}

export interface HostRuntimeInfo {
  defaultWslDistro: string | null;
  hostPlatform: HostPlatform;
  isWslHost: boolean;
  supportedCampEnvironments: CampEnvironment[];
}

export interface CampRegistryState {
  activeCampId: string | null;
  camps: CampRecord[];
  host: HostRuntimeInfo;
}

export interface CreateCampInput {
  environment?: CampEnvironment;
  name?: string;
  rootPath: string;
  wslDistro?: string | null;
}

export interface TerminalSessionSummary {
  campId: string;
  cwd: string;
  id: string;
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
  campId: string;
  cols?: number;
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

export interface CodexThreadSummary {
  cwd: string;
  id: string;
  messageCount: number;
  source: string | null;
  title: string;
  updatedAt: string;
}

export interface CodexMessage {
  id: string;
  phase: string | null;
  role: CodexMessageRole;
  text: string;
  timestamp: string;
}

export interface CodexThreadDetail extends CodexThreadSummary {
  messages: CodexMessage[];
}

export interface LiveCodexReply {
  response: string;
  threadId: string;
}

export interface SendCodexMessageInput {
  cwd: string;
  environment?: CampEnvironment;
  prompt: string;
  threadId?: string | null;
  wslDistro?: string | null;
}

export interface GladeApi {
  addCamp: (input: CreateCampInput) => Promise<CampRegistryState>;
  createTerminal: (input: CreateTerminalInput) => Promise<TerminalSessionSummary>;
  getCampOverview: (campId?: string) => Promise<CampOverview | null>;
  getCampRegistry: () => Promise<CampRegistryState>;
  getCodexThread: (threadId: string) => Promise<CodexThreadDetail | null>;
  getCodexThreads: (cwd?: string) => Promise<CodexThreadSummary[]>;
  killTerminal: (sessionId: string) => Promise<void>;
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  pickCampDirectory: () => Promise<string | null>;
  removeCamp: (campId: string) => Promise<CampRegistryState>;
  resizeTerminal: (input: ResizeTerminalInput) => Promise<void>;
  sendCodexMessage: (input: SendCodexMessageInput) => Promise<LiveCodexReply>;
  setActiveCamp: (campId: string) => Promise<CampRegistryState>;
  writeTerminal: (input: WriteTerminalInput) => Promise<void>;
}
