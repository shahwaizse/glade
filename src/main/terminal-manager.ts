import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type {
  CreateTerminalInput,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionSummary,
} from "../shared/types";

interface TerminalRecord {
  process: IPty;
}

export class TerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>();

  constructor(private readonly sendEvent: (channel: string, payload: unknown) => void) {}

  createTerminal(input: CreateTerminalInput): TerminalSessionSummary {
    const shell =
      process.env.SHELL ??
      (process.platform === "win32" ? "powershell.exe" : "bash");
    const id = randomUUID();
    const processHandle = pty.spawn(shell, [], {
      cols: input.cols ?? 120,
      cwd: input.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
      name: "xterm-256color",
      rows: input.rows ?? 32,
    });

    const summary: TerminalSessionSummary = {
      cwd: input.cwd,
      id,
      startedAt: new Date().toISOString(),
    };

    processHandle.onData((data) => {
      const event: TerminalDataEvent = { data, sessionId: id };
      this.sendEvent("glade:terminal:data", event);
    });

    processHandle.onExit(({ exitCode }) => {
      const event: TerminalExitEvent = { exitCode, sessionId: id };
      this.terminals.delete(id);
      this.sendEvent("glade:terminal:exit", event);
    });

    this.terminals.set(id, {
      process: processHandle,
    });

    return summary;
  }

  write(sessionId: string, data: string) {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }

    terminal.process.write(data);
  }

  resize(sessionId: string, cols: number, rows: number) {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }

    terminal.process.resize(cols, rows);
  }

  kill(sessionId: string) {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      return;
    }

    terminal.process.kill();
    this.terminals.delete(sessionId);
  }

  disposeAll() {
    for (const terminal of this.terminals.values()) {
      terminal.process.kill();
    }

    this.terminals.clear();
  }
}
