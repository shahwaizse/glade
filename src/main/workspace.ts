import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { CampOverview, CampStatus, WorktreeSummary } from "../shared/types";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string) {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout.trim();
}

async function detectBranch(cwd: string) {
  try {
    const branch = await runGit(["branch", "--show-current"], cwd);
    return branch || "detached";
  } catch {
    return "untracked";
  }
}

async function detectStatus(cwd: string): Promise<CampStatus> {
  try {
    const output = await runGit(["status", "--short"], cwd);
    return output.length > 0 ? "active" : "resting";
  } catch {
    return "untracked";
  }
}

async function detectWorktrees(cwd: string): Promise<WorktreeSummary[]> {
  try {
    const output = await runGit(["worktree", "list", "--porcelain"], cwd);
    if (!output) {
      return [];
    }

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
          isCurrent: path.resolve(entry.path) === path.resolve(cwd),
          path: entry.path,
        };
      })
      .filter((entry): entry is WorktreeSummary => entry !== null);
  } catch {
    return [];
  }
}

function pathToCampId(cwd: string) {
  return cwd.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export async function getCampOverview(cwd: string): Promise<CampOverview> {
  const [branch, status, worktrees] = await Promise.all([
    detectBranch(cwd),
    detectStatus(cwd),
    detectWorktrees(cwd),
  ]);

  return {
    branch,
    id: pathToCampId(cwd),
    mcpServers: [],
    name: path.basename(cwd),
    rootPath: cwd,
    status,
    tokenLedger: {
      completion: 0,
      prompt: 0,
      total: 0,
    },
    worktrees,
  };
}

