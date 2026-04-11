export type CampStatus = "active" | "resting" | "untracked";

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

export interface CampOverview {
  branch: string;
  id: string;
  mcpServers: string[];
  name: string;
  rootPath: string;
  status: CampStatus;
  tokenLedger: TokenLedger;
  worktrees: WorktreeSummary[];
}

export interface TerminalSessionSummary {
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
  cols?: number;
  cwd: string;
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

export interface GladeApi {
  createTerminal: (input: CreateTerminalInput) => Promise<TerminalSessionSummary>;
  getCampOverview: (cwd?: string) => Promise<CampOverview>;
  killTerminal: (sessionId: string) => Promise<void>;
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  resizeTerminal: (input: ResizeTerminalInput) => Promise<void>;
  writeTerminal: (input: WriteTerminalInput) => Promise<void>;
}

