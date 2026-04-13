import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CampEnvironment,
  CampOverview,
  CampRecord,
  CampStatus,
  CreateCampInput,
  HostRuntimeInfo,
  WorktreeSummary,
} from "../shared/types";

const execFileAsync = promisify(execFile);

type ExecutionTarget = Pick<CampRecord, "environment" | "rootPath" | "wslDistro">;

function pathToCampId(seed: string) {
  return seed.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function normalizeComparablePath(target: ExecutionTarget, value: string) {
  if (target.environment === "wsl") {
    return value.replace(/\/+$/g, "");
  }

  if (process.platform === "win32") {
    return path.win32.resolve(value).toLowerCase();
  }

  return path.resolve(value);
}

async function runCommand(target: ExecutionTarget, command: string, args: string[]) {
  if (target.environment === "wsl") {
    if (process.platform !== "win32") {
      throw new Error("WSL camps require the native Windows build of Glade.");
    }

    const wslArgs = [];
    if (target.wslDistro) {
      wslArgs.push("-d", target.wslDistro);
    }
    wslArgs.push("--cd", target.rootPath, "--", command, ...args);
    const result = await execFileAsync("wsl.exe", wslArgs, { windowsHide: true });
    return result.stdout.trim();
  }

  const result = await execFileAsync(command, args, {
    cwd: target.rootPath,
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function runGit(args: string[], target: ExecutionTarget) {
  return runCommand(target, "git", args);
}

async function detectBranch(target: ExecutionTarget) {
  try {
    const branch = await runGit(["branch", "--show-current"], target);
    return branch || "detached";
  } catch {
    return "untracked";
  }
}

async function detectStatus(target: ExecutionTarget): Promise<CampStatus> {
  try {
    const output = await runGit(["status", "--short"], target);
    return output.length > 0 ? "active" : "resting";
  } catch {
    return "untracked";
  }
}

async function detectWorktrees(target: ExecutionTarget): Promise<WorktreeSummary[]> {
  try {
    const output = await runGit(["worktree", "list", "--porcelain"], target);
    if (!output) {
      return [];
    }

    const currentPath = normalizeComparablePath(target, target.rootPath);
    const blocks = output.split("\n\n");

    return blocks
      .map((block) => {
        const lines = block.split("\n").filter(Boolean);
        const entry: Partial<WorktreeSummary> = {};

        for (const line of lines) {
          if (line.startsWith("worktree ")) {
            entry.path = line.replace("worktree ", "");
          }

          if (line.startsWith("branch refs/heads/")) {
            entry.branch = line.replace("branch refs/heads/", "");
          }

          if (line === "bare") {
            entry.branch = "bare";
          }
        }

        if (!entry.path) {
          return null;
        }

        return {
          branch: entry.branch ?? "detached",
          isCurrent: normalizeComparablePath(target, entry.path) === currentPath,
          path: entry.path,
        };
      })
      .filter((entry): entry is WorktreeSummary => entry !== null);
  } catch {
    return [];
  }
}

function getDefaultEnvironment(): CampEnvironment {
  return "native";
}

function getCampName(rootPath: string, environment: CampEnvironment) {
  return environment === "wsl"
    ? path.posix.basename(rootPath)
    : path.basename(rootPath);
}

export function getHostRuntimeInfo(): HostRuntimeInfo {
  return {
    defaultWslDistro: process.env.WSL_DISTRO_NAME ?? null,
    hostPlatform:
      process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "macos"
          : "linux",
    isWslHost: process.platform === "linux" && Boolean(process.env.WSL_DISTRO_NAME),
    supportedCampEnvironments: process.platform === "win32" ? ["native", "wsl"] : ["native"],
  };
}

export async function resolveCampDefinition(input: CreateCampInput): Promise<CampRecord> {
  const environment = input.environment ?? getDefaultEnvironment();
  const target: ExecutionTarget = {
    environment,
    rootPath: input.rootPath,
    wslDistro: input.wslDistro ?? null,
  };
  const repoRoot = await runGit(["rev-parse", "--show-toplevel"], target);

  if (!repoRoot) {
    throw new Error("That folder is not inside a git repository.");
  }

  const normalizedRoot =
    environment === "wsl"
      ? repoRoot
      : process.platform === "win32"
        ? path.win32.normalize(repoRoot)
        : path.resolve(repoRoot);
  const timestamp = new Date().toISOString();

  return {
    addedAt: timestamp,
    environment,
    id: pathToCampId(`${environment}-${input.wslDistro ?? "default"}-${normalizedRoot}`),
    lastOpenedAt: timestamp,
    name: input.name?.trim() || getCampName(normalizedRoot, environment),
    rootPath: normalizedRoot,
    wslDistro: input.wslDistro ?? null,
  };
}

export async function getCampOverview(camp: CampRecord): Promise<CampOverview> {
  const target: ExecutionTarget = {
    environment: camp.environment,
    rootPath: camp.rootPath,
    wslDistro: camp.wslDistro,
  };
  const [branch, status, worktrees] = await Promise.all([
    detectBranch(target),
    detectStatus(target),
    detectWorktrees(target),
  ]);

  return {
    ...camp,
    branch,
    mcpServers: [],
    status,
    tokenLedger: {
      completion: 0,
      prompt: 0,
      total: 0,
    },
    worktrees,
  };
}
