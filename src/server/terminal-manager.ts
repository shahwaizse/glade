import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants } from "node:fs";
import type {
  CreateTerminalInput,
  ProjectRecord,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionSummary,
} from "../shared/types";

interface TerminalRecord {
  process: ChildProcessWithoutNullStreams;
}

export class TerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>();

  constructor(private readonly sendEvent: (channel: string, payload: unknown) => void) {}

  createTerminal(project: ProjectRecord, input: CreateTerminalInput): TerminalSessionSummary {
    const executable = resolveExecutable(project, input.agent);
    const launch = resolveLaunchCommand(executable);
    const id = randomUUID();
    const processHandle = spawn(launch.command, launch.args, {
      cwd: project.rootPath,
      env: createProjectEnv(project),
      shell: false,
      windowsHide: true,
    });

    processHandle.stdout.on("data", (chunk) => {
      const event: TerminalDataEvent = { data: chunk.toString(), sessionId: id };
      this.sendEvent("glade:terminal:data", event);
    });

    processHandle.stderr.on("data", (chunk) => {
      const event: TerminalDataEvent = { data: chunk.toString(), sessionId: id };
      this.sendEvent("glade:terminal:data", event);
    });

    processHandle.on("close", (exitCode) => {
      const event: TerminalExitEvent = { exitCode: exitCode ?? 0, sessionId: id };
      this.terminals.delete(id);
      this.sendEvent("glade:terminal:exit", event);
    });

    this.terminals.set(id, { process: processHandle });
    return {
      cwd: project.rootPath,
      id,
      projectId: project.id,
      startedAt: new Date().toISOString(),
    };
  }

  write(sessionId: string, data: string) {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      return;
    }

    terminal.process.stdin.write(data);
  }

  resize(sessionId: string, cols: number, rows: number) {
    void sessionId;
    void cols;
    void rows;
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

function resolveExecutable(project: ProjectRecord, agent: CreateTerminalInput["agent"]) {
  if (agent === "codex") {
    return project.profile.codexCommand || "codex";
  }

  if (agent === "claude") {
    return project.profile.claudeCommand || "claude";
  }

  return process.env.SHELL ?? (process.platform === "win32" ? "powershell.exe" : "bash");
}

function resolveLaunchCommand(executable: string) {
  if (process.platform === "win32" || !isExecutableAvailable("script")) {
    return {
      args: [] as string[],
      command: executable,
    };
  }

  return {
    args: ["-qfec", executable, "/dev/null"],
    command: "script",
  };
}

function isExecutableAvailable(command: string) {
  const paths = (process.env.PATH ?? "").split(":").filter(Boolean);
  return paths.some((entry) => {
    try {
      accessSync(`${entry}/${command}`, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function createProjectEnv(project: ProjectRecord): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GLADE_PROJECT_ID: project.id,
    GLADE_PROJECT_ROOT: project.rootPath,
    TERM: "xterm-256color",
  };

  if (project.profile.sshKeyPath) {
    env.GIT_SSH_COMMAND = `ssh -i "${project.profile.sshKeyPath}" -o IdentitiesOnly=yes -F /dev/null`;
  } else {
    delete env.GIT_SSH_COMMAND;
  }

  return env;
}
