import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type {
  CampRecord,
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
  private disposed = false;

  constructor(private readonly sendEvent: (channel: string, payload: unknown) => void) {}

  private emit(channel: string, payload: unknown) {
    if (this.disposed) {
      return;
    }

    try {
      this.sendEvent(channel, payload);
    } catch {
      // The window can disappear while PTY events are still flushing.
    }
  }

  createTerminal(camp: CampRecord, input: CreateTerminalInput): TerminalSessionSummary {
    this.disposed = false;
    let executable =
      process.env.SHELL ??
      (process.platform === "win32" ? "powershell.exe" : "bash");
    let args: string[] = [];
    let cwd = camp.rootPath;

    if (camp.environment === "wsl") {
      if (process.platform !== "win32") {
        throw new Error("WSL camps require the native Windows build of Glade.");
      }

      executable = "wsl.exe";
      cwd = process.cwd();
      if (camp.wslDistro) {
        args.push("-d", camp.wslDistro);
      }
      args.push("--cd", camp.rootPath);
    }

    const id = randomUUID();
    const processHandle = pty.spawn(executable, args, {
      cols: input.cols ?? 120,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
      name: "xterm-256color",
      rows: input.rows ?? 32,
    });

    const summary: TerminalSessionSummary = {
      campId: camp.id,
      cwd: camp.rootPath,
      id,
      startedAt: new Date().toISOString(),
    };

    processHandle.onData((data) => {
      const event: TerminalDataEvent = { data, sessionId: id };
      this.emit("glade:terminal:data", event);
    });

    processHandle.onExit(({ exitCode }) => {
      const event: TerminalExitEvent = { exitCode, sessionId: id };
      this.terminals.delete(id);
      this.emit("glade:terminal:exit", event);
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
    this.disposed = true;

    for (const terminal of this.terminals.values()) {
      terminal.process.kill();
    }

    this.terminals.clear();
  }
}
